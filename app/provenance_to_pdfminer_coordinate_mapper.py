"""
PDF.js Compatible Text Mapper
Extracts text and coordinates in a way that's consistent with PDF.js rendering
Handles coordinate system differences and text extraction variations
"""

import json
import re
import logging
import subprocess
import tempfile
import os
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher
from dataclasses import dataclass

logger = logging.getLogger(__name__)

def safe_get_file_finder():
    """Safe wrapper for file finder that handles None returns"""
    try:
        from utils.file_finder import get_file_finder
        return get_file_finder()
    except ImportError:
        return None

def safe_find_file(doc_name: str, extension: str) -> Optional[Dict]:
    """Safely find file with proper error handling"""
    try:
        file_finder = safe_get_file_finder()
        if file_finder is None:
            # Fallback: look in common directories
            common_paths = [
                f"public/test-documents/{doc_name}.{extension}",
                f"gdrive_downloads/**/{doc_name}*.{extension}",
                f"{doc_name}.{extension}"
            ]
            
            for pattern in common_paths:
                files = list(Path(".").glob(pattern))
                if files:
                    return {
                        'path': str(files[0]),
                        'name': files[0].name
                    }
            
            return None
        
        result = file_finder.find_file(doc_name, extension)
        return result
        
    except Exception as e:
        print(f"Error finding file {doc_name}.{extension}: {e}")
        return None

@dataclass
class PDFJSTextItem:
    """Represents a text item as PDF.js would extract it"""
    text: str
    x: float
    y: float
    width: float
    height: float
    page: int
    transform: List[float]  # PDF.js transform matrix
    font_name: str = "default"
    confidence: float = 1.0

class PDFJSCompatibleMapper:
    """Maps provenance text using PDF.js-compatible text extraction"""
    
    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self.nodejs_workspace = None
        self.setup_nodejs_workspace()
        
    def setup_nodejs_workspace(self):
        """Set up Node.js workspace for PDF.js extraction"""
        try:
            # Create workspace directory
            workspace_dir = "pdf_processing_workspace"
            os.makedirs(workspace_dir, exist_ok=True)
            self.nodejs_workspace = os.path.abspath(workspace_dir)
            
            # Create package.json if needed
            package_json_path = os.path.join(self.nodejs_workspace, "package.json")
            if not os.path.exists(package_json_path):
                package_json = {
                    "name": "pdf-text-extractor",
                    "version": "1.0.0",
                    "dependencies": {
                        "pdfjs-dist": "^3.11.174"
                    }
                }
                
                with open(package_json_path, 'w') as f:
                    json.dump(package_json, f, indent=2)
            
            # Check if pdfjs-dist is installed
            node_modules_path = os.path.join(self.nodejs_workspace, "node_modules", "pdfjs-dist")
            if not os.path.exists(node_modules_path):
                logger.info("Installing pdfjs-dist...")
                subprocess.run(['npm', 'install'], cwd=self.nodejs_workspace, check=True)
            
            # Create extraction script
            self.create_extraction_script()
            
        except Exception as e:
            logger.error(f"Failed to setup Node.js workspace: {e}")
            self.nodejs_workspace = None
    
    def create_extraction_script(self):
        """Create PDF.js text extraction script"""
        if not self.nodejs_workspace:
            return
            
        script_path = os.path.join(self.nodejs_workspace, "extract_text.js")
        
        script_content = '''
const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/build/pdf');

// Disable workers for Node.js environment
pdfjsLib.GlobalWorkerOptions.workerSrc = null;

async function extractTextWithCoordinates(pdfPath) {
    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found: ${pdfPath}`);
        }
        
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        
        // Load PDF document
        const pdf = await pdfjsLib.getDocument({ 
            data,
            verbosity: 0
        }).promise;
        
        const pages = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            try {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const viewport = page.getViewport({ scale: 1.0 });
                
                // Process text items exactly as PDF.js would
                const items = textContent.items.map((item, index) => {
                    // Ensure all required properties exist with PDF.js defaults
                    const transform = item.transform || [1, 0, 0, 1, 0, 0];
                    const width = item.width || 0;
                    const height = item.height || 0;
                    
                    // Calculate coordinates using PDF.js coordinate system
                    const x = transform[4];
                    const y = viewport.height - transform[5]; // Convert to top-left origin
                    
                    return {
                        str: item.str || '',
                        x: x,
                        y: y,
                        width: width,
                        height: height,
                        transform: transform,
                        dir: item.dir || 'ltr',
                        fontName: item.fontName || 'default',
                        hasEOL: item.hasEOL || false,
                        // Additional metadata for mapping
                        originalIndex: index,
                        pageHeight: viewport.height,
                        pageWidth: viewport.width
                    };
                });
                
                // Sort items by reading order (top to bottom, left to right)
                items.sort((a, b) => {
                    const yDiff = a.y - b.y;
                    if (Math.abs(yDiff) < 5) { // Same line threshold
                        return a.x - b.x;
                    }
                    return yDiff;
                });
                
                pages.push({
                    pageNumber: pageNum,
                    items: items,
                    viewport: {
                        width: viewport.width,
                        height: viewport.height,
                        scale: viewport.scale
                    }
                });
                
            } catch (pageError) {
                console.error(`Error processing page ${pageNum}: ${pageError.message}`);
                pages.push({
                    pageNumber: pageNum,
                    items: [],
                    error: pageError.message
                });
            }
        }
        
        // Output results as JSON
        console.log(JSON.stringify(pages));
        
    } catch (error) {
        console.error(`PDF extraction failed: ${error.message}`);
        process.exit(1);
    }
}

// Get PDF path from command line arguments
const pdfPath = process.argv[2];
if (!pdfPath) {
    console.error('Usage: node extract_text.js <pdf_path>');
    process.exit(1);
}

extractTextWithCoordinates(path.resolve(pdfPath));
'''
        
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
    
    def extract_pdfjs_text_content(self) -> List[Dict]:
        """Extract text content using PDF.js exactly as the frontend would"""
        
        if not self.nodejs_workspace:
            logger.error("Node.js workspace not available")
            return []
        
        script_path = os.path.join(self.nodejs_workspace, "extract_text.js")
        
        try:
            result = subprocess.run([
                'node', script_path, self.pdf_path
            ], cwd=self.nodejs_workspace, capture_output=True, text=True, timeout=60)
            
            if result.returncode != 0:
                logger.error(f"PDF.js extraction failed: {result.stderr}")
                return []
            
            # Parse the JSON output
            pdfjs_data = json.loads(result.stdout)
            logger.info(f"✅ Extracted text from {len(pdfjs_data)} pages using PDF.js")
            return pdfjs_data
            
        except subprocess.TimeoutExpired:
            logger.error("PDF.js extraction timed out")
            return []
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse PDF.js output: {e}")
            return []
        except Exception as e:
            logger.error(f"PDF.js extraction error: {e}")
            return []
    
    def find_provenance_text(self, provenance_text: str, max_pages: int = None) -> List[Dict]:
        """
        Find provenance text using PDF.js-compatible extraction
        
        Args:
            provenance_text: Text to search for
            max_pages: Limit search to first N pages
            
        Returns:
            List of bounding boxes compatible with PDF.js coordinate system
        """
        logger.info(f"🔍 PDF.js-compatible search for: '{provenance_text[:100]}...'")
        
        # Extract text using PDF.js
        pdfjs_pages = self.extract_pdfjs_text_content()
        if not pdfjs_pages:
            return []
        
        # Clean search text
        clean_provenance = self._normalize_text(provenance_text)
        
        if len(clean_provenance) < 5:
            logger.warning("Provenance text too short for reliable search")
            return []
        
        all_matches = []
        
        for page_data in pdfjs_pages:
            page_num = page_data.get('pageNumber', 1)
            
            if max_pages and page_num > max_pages:
                break
            
            items = page_data.get('items', [])
            viewport = page_data.get('viewport', {})
            
            if not items:
                continue
            
            logger.debug(f"📄 Searching page {page_num} with {len(items)} text items")
            
            # Convert PDF.js items to our format
            text_items = self._convert_pdfjs_items(items, page_num, viewport)
            
            # Search for provenance text
            page_matches = self._search_in_pdfjs_items(
                clean_provenance, text_items, provenance_text
            )
            
            all_matches.extend(page_matches)
            
            if page_matches:
                logger.info(f"✅ Found {len(page_matches)} matches on page {page_num}")
        
        logger.info(f"🎯 Total PDF.js-compatible matches: {len(all_matches)}")
        return all_matches
    
    def _convert_pdfjs_items(self, items: List[Dict], page_num: int, viewport: Dict) -> List[PDFJSTextItem]:
        """Convert PDF.js items to our internal format"""
        
        text_items = []
        
        for item in items:
            # Skip empty text items
            if not item.get('str', '').strip():
                continue
            
            text_items.append(PDFJSTextItem(
                text=item.get('str', ''),
                x=item.get('x', 0),
                y=item.get('y', 0),
                width=item.get('width', 0),
                height=item.get('height', 0),
                page=page_num,
                transform=item.get('transform', [1, 0, 0, 1, 0, 0]),
                font_name=item.get('fontName', 'default')
            ))
        
        return text_items
    
    def _search_in_pdfjs_items(self, clean_provenance: str, 
                             text_items: List[PDFJSTextItem], 
                             original_provenance: str) -> List[Dict]:
        """Search for provenance text in PDF.js text items"""
        
        matches = []
        
        # Strategy 1: Single item exact match
        for item in text_items:
            clean_item_text = self._normalize_text(item.text)
            
            if clean_provenance in clean_item_text:
                logger.debug(f"✅ Exact match in PDF.js item: '{item.text[:50]}...'")
                
                sub_box = self._create_pdfjs_sub_item_box(
                    item, clean_provenance, clean_item_text
                )
                if sub_box:
                    matches.append(sub_box)
        
        # Strategy 2: Multi-item sequential matching
        if not matches:
            multi_matches = self._find_multi_item_matches(
                clean_provenance, text_items, original_provenance
            )
            matches.extend(multi_matches)
        
        # Strategy 3: Fuzzy matching
        if not matches:
            fuzzy_matches = self._find_fuzzy_matches_in_items(
                clean_provenance, text_items
            )
            matches.extend(fuzzy_matches)
        
        return matches
    
    def _create_pdfjs_sub_item_box(self, item: PDFJSTextItem, 
                                  target_text: str, item_text: str) -> Optional[Dict]:
        """Create sub-item bounding box compatible with PDF.js coordinates"""
        
        # Find position of target text within item
        start_pos = item_text.find(target_text)
        if start_pos == -1:
            return None
        
        end_pos = start_pos + len(target_text)
        total_length = len(item_text)
        
        if total_length == 0:
            return None
        
        # Calculate proportional positions
        start_ratio = start_pos / total_length
        end_ratio = end_pos / total_length
        
        # Calculate sub-item coordinates (PDF.js style)
        sub_width = item.width * (end_ratio - start_ratio)
        sub_x = item.x + (item.width * start_ratio)
        
        # Convert back to PDF.js coordinate system for highlighting
        # Note: PDF.js uses bottom-left origin, but we converted to top-left
        return {
            'page': item.page,
            'x0': sub_x,
            'y0': item.y,
            'x1': sub_x + sub_width,
            'y1': item.y + item.height,
            'confidence': 0.95,
            'match_type': 'pdfjs_sub_item_precise',
            'source': 'pdfjs_compatible_mapper',
            'matched_text': target_text,
            'original_item_text': item.text,
            'character_range': f"{start_pos}-{end_pos}/{total_length}",
            'transform': item.transform,
            'font_name': item.font_name
        }
    
    def _find_multi_item_matches(self, target_text: str, 
                               text_items: List[PDFJSTextItem], 
                               original_text: str) -> List[Dict]:
        """Find target text spanning multiple PDF.js items"""
        
        matches = []
        
        # Try different window sizes
        for window_size in range(2, min(6, len(text_items) + 1)):
            for start_idx in range(len(text_items) - window_size + 1):
                item_group = text_items[start_idx:start_idx + window_size]
                
                # Combine text from items, handling PDF.js text spacing
                combined_text = self._combine_pdfjs_item_texts(item_group)
                clean_combined = self._normalize_text(combined_text)
                
                if target_text in clean_combined:
                    logger.debug(f"✅ Multi-item match across {window_size} PDF.js items")
                    
                    # Create boxes for relevant items
                    group_matches = self._create_multi_item_boxes(
                        item_group, target_text, clean_combined
                    )
                    matches.extend(group_matches)
                    
                    if group_matches:
                        return matches  # Return first good match
        
        return matches
    
    def _combine_pdfjs_item_texts(self, items: List[PDFJSTextItem]) -> str:
        """Combine texts from PDF.js items, handling spacing like PDF.js does"""
        
        if not items:
            return ""
        
        combined = []
        
        for i, item in enumerate(items):
            combined.append(item.text)
            
            # Add space if this item doesn't end the line and there's a next item
            if i < len(items) - 1:
                next_item = items[i + 1]
                
                # Check if items are on same line (similar y coordinates)
                if abs(item.y - next_item.y) < 5:  # Same line threshold
                    # Check if there's a gap between items
                    gap = next_item.x - (item.x + item.width)
                    if gap > 2:  # Add space if there's a gap
                        combined.append(' ')
                else:
                    # Different lines, add space
                    combined.append(' ')
        
        return ''.join(combined)
    
    def _create_multi_item_boxes(self, item_group: List[PDFJSTextItem], 
                               target_text: str, combined_text: str) -> List[Dict]:
        """Create bounding boxes for multi-item matches"""
        
        target_start = combined_text.find(target_text)
        if target_start == -1:
            # Fallback: highlight all items
            return self._highlight_all_items(item_group, 0.8, 'multi_item_fallback')
        
        target_end = target_start + len(target_text)
        
        # Map character positions to items
        char_pos = 0
        result_boxes = []
        
        for item in item_group:
            item_text = self._normalize_text(item.text)
            item_start = char_pos
            item_end = char_pos + len(item_text)
            
            # Check if this item contains part of target
            if item_end > target_start and item_start < target_end:
                # Calculate portion of item to highlight
                relative_start = max(0, target_start - item_start)
                relative_end = min(len(item_text), target_end - item_start)
                
                if relative_start == 0 and relative_end == len(item_text):
                    # Highlight entire item
                    result_boxes.append({
                        'page': item.page,
                        'x0': item.x,
                        'y0': item.y,
                        'x1': item.x + item.width,
                        'y1': item.y + item.height,
                        'confidence': 0.9,
                        'match_type': 'multi_item_full',
                        'source': 'pdfjs_compatible_mapper',
                        'transform': item.transform
                    })
                else:
                    # Highlight part of item
                    if len(item_text) > 0:
                        start_ratio = relative_start / len(item_text)
                        end_ratio = relative_end / len(item_text)
                        
                        sub_width = item.width * (end_ratio - start_ratio)
                        sub_x = item.x + (item.width * start_ratio)
                        
                        result_boxes.append({
                            'page': item.page,
                            'x0': sub_x,
                            'y0': item.y,
                            'x1': sub_x + sub_width,
                            'y1': item.y + item.height,
                            'confidence': 0.85,
                            'match_type': 'multi_item_partial',
                            'source': 'pdfjs_compatible_mapper',
                            'transform': item.transform
                        })
            
            char_pos += len(item_text) + 1  # +1 for potential space
        
        return result_boxes
    
    def _find_fuzzy_matches_in_items(self, target_text: str, 
                                   text_items: List[PDFJSTextItem]) -> List[Dict]:
        """Find fuzzy matches in PDF.js items"""
        
        matches = []
        target_words = set(target_text.split())
        
        if len(target_words) < 3:
            return matches
        
        for item in text_items:
            clean_item = self._normalize_text(item.text)
            item_words = set(clean_item.split())
            
            # Calculate overlap
            common_words = target_words & item_words
            overlap_ratio = len(common_words) / len(target_words)
            similarity = SequenceMatcher(None, target_text, clean_item).ratio()
            
            confidence = max(overlap_ratio, similarity)
            
            if confidence > 0.7:
                matches.append({
                    'page': item.page,
                    'x0': item.x,
                    'y0': item.y,
                    'x1': item.x + item.width,
                    'y1': item.y + item.height,
                    'confidence': confidence * 0.8,
                    'match_type': 'pdfjs_fuzzy_match',
                    'source': 'pdfjs_compatible_mapper',
                    'transform': item.transform,
                    'word_overlap': f"{len(common_words)}/{len(target_words)}"
                })
        
        # Return top matches
        matches.sort(key=lambda x: x['confidence'], reverse=True)
        return matches[:3]
    
    def _highlight_all_items(self, items: List[PDFJSTextItem], 
                           confidence: float, match_type: str) -> List[Dict]:
        """Create highlight boxes for all items"""
        
        boxes = []
        for item in items:
            boxes.append({
                'page': item.page,
                'x0': item.x,
                'y0': item.y,
                'x1': item.x + item.width,
                'y1': item.y + item.height,
                'confidence': confidence,
                'match_type': match_type,
                'source': 'pdfjs_compatible_mapper',
                'transform': item.transform
            })
        
        return boxes
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching"""
        if not text:
            return ""
        
        # Handle encoding issues
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='ignore')
        
        # Basic normalization
        normalized = re.sub(r'\s+', ' ', text.lower().strip())
        normalized = re.sub(r'[^\w\s\-\.\,\:\;\!\?]', '', normalized)
        normalized = re.sub(r'\s+', ' ', normalized)
        
        return normalized

# API functions for integration
def find_provenance_with_pdfjs_compatibility(pdf_path: str, provenance_text: str, 
                                           max_pages: int = None) -> List[Dict]:
    """
    Find provenance text using PDF.js-compatible extraction
    """
    try:
        mapper = PDFJSCompatibleMapper(pdf_path)
        return mapper.find_provenance_text(provenance_text, max_pages)
    except Exception as e:
        logger.error(f"Error in PDF.js-compatible mapping: {e}")
        return []

# Batch processing version
def find_multiple_provenance_with_pdfjs_compatibility(pdf_path: str, 
                                                    provenance_texts: List[str], 
                                                    max_pages: int = None) -> Dict[str, List[Dict]]:
    """
    Find multiple provenance texts using PDF.js-compatible extraction
    """
    mapper = PDFJSCompatibleMapper(pdf_path)
    results = {}
    
    for provenance_text in provenance_texts:
        try:
            matches = mapper.find_provenance_text(provenance_text, max_pages)
            results[provenance_text] = matches
        except Exception as e:
            logger.error(f"Error finding provenance '{provenance_text[:50]}...': {e}")
            results[provenance_text] = []
    
    return results

# specific to mapping sentence_id from _sentences.json files
def map_sentences_to_pdfjs(basename: str) -> Dict[str, List[Dict]]:
    """
    Find multiple provenance texts using PDF.js-compatible extraction
    """

    pdf_info = safe_find_file(basename, "pdf")

    pdf_path = pdf_info['path']

    mapper = PDFJSCompatibleMapper(pdf_path)
    results = {}

    sentences_info = safe_find_file(basename, "sentences")

    with open(sentences_info['path'], 'r', encoding='utf-8') as f:
        sentences_data = json.load(f)
    
    for i, sentence in enumerate(sentences_data):
        results["sentence_id"] = i
        try:
            matches = mapper.find_provenance_text(sentence)
            results["bounding_boxes"] = matches
        except Exception as e:
            logger.error(f"Error finding sentence {i} '{sentence[:50]}...': {e}")
            results["bounding_boxes"] = []
    
    return results