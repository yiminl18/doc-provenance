import json, logging, os, re, subprocess, tempfile
from typing import Dict, List, Optional, Tuple, Union
from difflib import SequenceMatcher
from pathlib import Path
import time
from collections import defaultdict

def safe_get_file_finder():
    """Safe wrapper for file finder that handles None returns"""
    try:
        from utils import get_file_finder
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
                f"uploads/{doc_name}.{extension}",
                f"sentences/{doc_name}_sentences.json",
                f"layouts/{doc_name}_layout.json",
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

logger = logging.getLogger(__name__)

class EnhancedSentenceToPDFJSMapper:
    """Enhanced mapper that creates robust sentence-to-coordinate mappings"""
    
    def __init__(self, pdf_path: str, verbose: bool = False):
        self.pdf_path = pdf_path
        self.verbose = verbose
        self.pdfjs_pages = None
        self.page_text_caches = {}  # Cache for page text reconstructions
        self.setup_logging()
        
    def setup_logging(self):
        """Setup logging"""
        if self.verbose and not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)

    def create_enhanced_extraction_script(self) -> str:
        """Create enhanced Node.js script for PDF.js extraction with better coordinates"""
        return '''
const fs = require('fs');
const path = require('path');

// Try to load pdfjs-dist
let pdfjsLib;
try {
    pdfjsLib = require('pdfjs-dist/build/pdf');
} catch (error) {
    console.error('Error: pdfjs-dist not found. Please install it with: npm install pdfjs-dist');
    process.exit(1);
}

pdfjsLib.GlobalWorkerOptions.workerSrc = null;

async function extractEnhancedTextContent(pdfPath) {
    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found: ${pdfPath}`);
        }
        
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const pdf = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
        
        const pages = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            try {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.0 });
                const textContent = await page.getTextContent();
                
                // Enhanced text items with better coordinate calculation
                const enhancedItems = textContent.items.map((item, index) => {
                    const transform = item.transform || [1, 0, 0, 1, 0, 0];
                    
                    // Calculate position more accurately
                    const x = transform[4];
                    const y = viewport.height - transform[5]; // Flip Y coordinate for top-origin
                    
                    return {
                        index: index,
                        str: item.str || '',
                        dir: item.dir || 'ltr',
                        width: item.width || 0,
                        height: item.height || 0,
                        x: x,
                        y: y,
                        originalY: transform[5], // Keep original for reference
                        transform: transform,
                        fontName: item.fontName || 'default',
                        hasEOL: item.hasEOL || false,
                        fontSize: item.height || 12
                    };
                });
                
                pages.push({
                    pageNumber: pageNum,
                    viewport: {
                        width: viewport.width,
                        height: viewport.height
                    },
                    items: enhancedItems,
                    itemCount: enhancedItems.length
                });
                
            } catch (pageError) {
                pages.push({
                    pageNumber: pageNum,
                    items: [],
                    error: pageError.message
                });
            }
        }
        
        console.log(JSON.stringify(pages));
        
    } catch (error) {
        console.error(`PDF extraction failed: ${error.message}`);
        process.exit(1);
    }
}

const pdfPath = process.argv[2];
if (!pdfPath) {
    console.error('Usage: node script.js <pdf_path>');
    process.exit(1);
}

extractEnhancedTextContent(path.resolve(pdfPath));
'''
    
    def extract_pdfjs_content(self) -> Optional[List[Dict]]:
        """Extract PDF.js content using enhanced extraction"""
        
        if self.pdfjs_pages:
            return self.pdfjs_pages
        
        try:
            logger.info(f"🔄 Extracting PDF.js content from: {self.pdf_path}")
            
            # Check if we have a Node.js workspace
            workspace_dir = Path(os.path.join(os.getcwd(), "pdf_processing_workspace"))
            
            if workspace_dir.exists() and (workspace_dir / "extract_pdf.js").exists():
                # Use workspace script
                script_path = workspace_dir / "extract_pdf.js"
                
                result = subprocess.run([
                    'node', str(script_path), self.pdf_path
                ], cwd=workspace_dir, capture_output=True, text=True, 
                    encoding='utf-8', errors='replace', timeout=120)
                
            else:
                # Use enhanced inline script
                logger.debug("Using enhanced PDF.js extraction script")
                inline_script = self.create_enhanced_extraction_script()
                
                with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as temp_script:
                    temp_script.write(inline_script)
                    temp_script_path = temp_script.name
                
                try:
                    result = subprocess.run([
                        'node', temp_script_path, self.pdf_path
                    ], capture_output=True, text=True, 
                       encoding='utf-8', errors='replace', timeout=120)
                finally:
                    os.unlink(temp_script_path)
            
            if result.returncode != 0:
                logger.error(f"PDF.js extraction failed:")
                logger.error(f"STDERR: {result.stderr}")
                return None
            
            if not result.stdout or not result.stdout.strip():
                logger.error("PDF.js extraction returned empty output")
                return None
            
            # Parse the JSON output
            try:
                pdfjs_data = json.loads(result.stdout)
                logger.info(f"✅ Extracted {len(pdfjs_data)} pages from PDF.js")
                
                # Cache the results
                self.pdfjs_pages = pdfjs_data
                
                # Pre-build page text caches for faster searching
                self._build_page_text_caches()
                
                return pdfjs_data
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse PDF.js output: {e}")
                return None
                
        except subprocess.TimeoutExpired:
            logger.error("PDF.js extraction timed out after 120 seconds")
            return None
        except Exception as e:
            logger.error(f"Failed to extract PDF.js content: {e}")
            return None
    
    def _build_page_text_caches(self):
        """Pre-build text caches for each page for faster searching"""
        
        if not self.pdfjs_pages:
            return
        
        logger.info("🏗️ Building page text caches...")
        
        for page_data in self.pdfjs_pages:
            page_num = page_data['pageNumber']
            items = page_data.get('items', [])
            
            # Build different text representations
            self.page_text_caches[page_num] = {
                'full_text': self._reconstruct_page_text(items),
                'item_texts': [self._normalize_text(item['str']) for item in items],
                'item_positions': [(item['x'], item['y'], item['width'], item['height']) for item in items],
                'reading_order': self._sort_items_by_reading_order(items)
            }
        
        logger.info(f"✅ Built text caches for {len(self.page_text_caches)} pages")
    
    def _reconstruct_page_text(self, items: List[Dict]) -> str:
        """Reconstruct full page text with smart spacing"""
        
        if not items:
            return ""
        
        # Sort by reading order first
        sorted_items = self._sort_items_by_reading_order(items)
        
        texts = []
        for i, item in enumerate(sorted_items):
            texts.append(item['str'])
            
            # Add spacing between items intelligently
            if i < len(sorted_items) - 1:
                current_item = item
                next_item = sorted_items[i + 1]
                
                # Check if items are on roughly the same line
                y_diff = abs(current_item['y'] - next_item['y'])
                
                if y_diff < max(current_item.get('fontSize', 12), 12) * 0.5:
                    # Same line - check horizontal gap
                    x_gap = next_item['x'] - (current_item['x'] + current_item['width'])
                    if x_gap > 5:  # Significant gap - add space
                        texts.append(' ')
                else:
                    # Different lines - add space
                    texts.append(' ')
        
        return ''.join(texts)
    
    def _sort_items_by_reading_order(self, items: List[Dict]) -> List[Dict]:
        """Sort items by typical reading order (top to bottom, left to right)"""
        
        return sorted(items, key=lambda item: (
            round(item['y'] / 10),  # Group by approximate line (10px tolerance)
            item['x']  # Then by horizontal position
        ))
    
    def find_sentence_in_page_items(self, sentence_text: str, page_num: int, 
                                   confidence_threshold: float = 0.6) -> List[Dict]:
        """Find sentence within specific page items with enhanced matching"""
        
        if not self.pdfjs_pages or page_num not in self.page_text_caches:
            return []
        
        page_data = None
        for page in self.pdfjs_pages:
            if page['pageNumber'] == page_num:
                page_data = page
                break
        
        if not page_data:
            return []
        
        items = page_data['items']
        cache = self.page_text_caches[page_num]
        
        # Clean sentence for matching
        clean_sentence = self._normalize_text(sentence_text)
        
        if len(clean_sentence) < 5:
            return []
        
        logger.debug(f"🔍 Finding sentence in page {page_num}: '{clean_sentence[:50]}...'")
        
        boxes = []
        
        # Strategy 1: Exact substring match in full page text
        full_text = self._normalize_text(cache['full_text'])
        if clean_sentence in full_text:
            logger.debug(f"✅ Found exact match in full page text")
            # Find which items contain this text
            item_boxes = self._map_text_to_items(clean_sentence, items, sentence_text)
            boxes.extend(item_boxes)
        
        # Strategy 2: Multi-word distributed matching
        if not boxes:
            logger.debug(f"🔄 Trying multi-word distributed matching...")
            distributed_boxes = self._find_distributed_match(clean_sentence, items, page_num)
            boxes.extend(distributed_boxes)
        
        # Strategy 3: Fuzzy matching with high threshold
        if not boxes:
            logger.debug(f"🔄 Trying fuzzy matching...")
            fuzzy_boxes = self._find_fuzzy_matches(clean_sentence, items, page_num, confidence_threshold)
            boxes.extend(fuzzy_boxes)
        
        # Sort by confidence and spatial coherence
        boxes = self._rank_and_filter_boxes(boxes, sentence_text)
        
        logger.debug(f"📊 Found {len(boxes)} boxes for sentence in page {page_num}")
        
        return boxes
    
    def _map_text_to_items(self, target_text: str, items: List[Dict], 
                          original_sentence: str) -> List[Dict]:
        """Map found text back to specific PDF items"""
        
        boxes = []
        
        # Try to find the text span across items
        words = target_text.split()
        if not words:
            return boxes
        
        # Build text spans from consecutive items
        for start_idx in range(len(items)):
            current_span_text = ""
            span_items = []
            
            for end_idx in range(start_idx, min(start_idx + 20, len(items))):  # Limit span size
                span_items.append(items[end_idx])
                current_span_text += " " + self._normalize_text(items[end_idx]['str'])
                current_span_text = current_span_text.strip()
                
                # Check if we've found our target text
                if target_text in current_span_text:
                    # Create bounding box for this span
                    combined_box = self._create_combined_box(span_items, items[start_idx]['y'])
                    if combined_box:
                        combined_box.update({
                            'confidence': 0.95,
                            'match_type': 'exact_span',
                            'span_length': len(span_items),
                            'matched_text': current_span_text,
                            'source': 'enhanced_sentence_mapper'
                        })
                        boxes.append(combined_box)
                        
                        # Don't look for more spans starting from this position
                        break
                        
                # Early termination if span is getting too long
                if len(current_span_text) > len(target_text) * 2:
                    break
        
        return boxes
    
    def _find_distributed_match(self, target_text: str, items: List[Dict], 
                               page_num: int) -> List[Dict]:
        """Find text that's distributed across non-consecutive items"""
        
        target_words = target_text.split()
        if len(target_words) < 3:
            return []
        
        # Find items that contain target words
        word_item_map = defaultdict(list)
        
        for idx, item in enumerate(items):
            item_text = self._normalize_text(item['str'])
            item_words = item_text.split()
            
            for target_word in target_words:
                if len(target_word) > 2:  # Skip very short words
                    for item_word in item_words:
                        if (target_word in item_word or item_word in target_word or
                            (len(target_word) > 4 and len(item_word) > 4 and 
                             target_word[:4] == item_word[:4])):
                            word_item_map[target_word].append((idx, item))
        
        # Find best combination of items that covers most words
        if len(word_item_map) >= len(target_words) * 0.6:  # At least 60% word coverage
            all_item_indices = set()
            for word_items in word_item_map.values():
                all_item_indices.update(idx for idx, _ in word_items)
            
            if len(all_item_indices) <= 10:  # Reasonable number of items
                matched_items = [items[idx] for idx in sorted(all_item_indices)]
                
                combined_box = self._create_combined_box(matched_items, matched_items[0]['y'])
                if combined_box:
                    confidence = len(word_item_map) / len(target_words)
                    combined_box.update({
                        'confidence': confidence * 0.8,  # Penalty for distributed
                        'match_type': 'distributed_words',
                        'word_coverage': len(word_item_map),
                        'total_words': len(target_words),
                        'source': 'enhanced_sentence_mapper'
                    })
                    return [combined_box]
        
        return []
    
    def _find_fuzzy_matches(self, target_text: str, items: List[Dict], 
                           page_num: int, threshold: float) -> List[Dict]:
        """Find fuzzy matches with configurable threshold"""
        
        boxes = []
        target_words = set(target_text.split())
        
        # Try different item window sizes
        for window_size in [1, 2, 3, 5]:
            for start_idx in range(len(items) - window_size + 1):
                window_items = items[start_idx:start_idx + window_size]
                
                # Combine window text
                window_text = " ".join(self._normalize_text(item['str']) for item in window_items)
                window_words = set(window_text.split())
                
                if len(window_text) < 10:  # Skip very short windows
                    continue
                
                # Calculate similarities
                word_overlap = len(target_words & window_words) / len(target_words) if target_words else 0
                sequence_sim = SequenceMatcher(None, target_text, window_text).ratio()
                
                # Combined confidence
                confidence = max(word_overlap * 0.7, sequence_sim * 0.6)
                
                if confidence >= threshold:
                    combined_box = self._create_combined_box(window_items, window_items[0]['y'])
                    if combined_box:
                        combined_box.update({
                            'confidence': confidence,
                            'match_type': f'fuzzy_window_{window_size}',
                            'word_overlap': word_overlap,
                            'sequence_similarity': sequence_sim,
                            'source': 'enhanced_sentence_mapper'
                        })
                        boxes.append(combined_box)
        
        return boxes
    
    def _create_combined_box(self, items: List[Dict], baseline_y: float) -> Optional[Dict]:
        """Create bounding box covering multiple items with proper coordinates"""
        
        if not items:
            return None
        
        # Calculate bounding rectangle
        left_coords = [item['x'] for item in items]
        top_coords = [item['y'] for item in items]
        right_coords = [item['x'] + item['width'] for item in items]
        bottom_coords = [item['y'] + item['height'] for item in items]
        
        left = min(left_coords)
        top = min(top_coords)
        width = max(right_coords) - left
        height = max(bottom_coords) - top
        
        # Ensure minimum dimensions
        if width < 10:
            width = 10
        if height < 8:
            height = 12
        
        return {
            'left': left,
            'top': top,
            'width': width,
            'height': height,
            'item_count': len(items),
            'baseline_y': baseline_y
        }
    
    def _rank_and_filter_boxes(self, boxes: List[Dict], original_sentence: str) -> List[Dict]:
        """Rank boxes by quality and filter out poor matches"""
        
        if not boxes:
            return boxes
        
        # Add spatial coherence scores
        for box in boxes:
            # Prefer boxes with reasonable aspect ratios
            aspect_ratio = box['width'] / max(box['height'], 1)
            if 0.5 <= aspect_ratio <= 20:  # Reasonable text aspect ratio
                box['confidence'] *= 1.1
            
            # Prefer boxes that aren't too fragmented
            if box.get('item_count', 1) <= 5:  # Not too many separate items
                box['confidence'] *= 1.05
        
        # Sort by confidence and remove duplicates/overlaps
        boxes.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Remove very low confidence matches
        boxes = [box for box in boxes if box['confidence'] >= 0.5]
        
        # Limit number of boxes
        return boxes[:5]
    
    def _normalize_text(self, text: str) -> str:
        """Enhanced text normalization"""
        if not text:
            return ""
        
        # More thorough cleaning
        cleaned = text.lower().strip()
        cleaned = re.sub(r'\s+', ' ', cleaned)  # Normalize whitespace
        cleaned = re.sub(r'[^\w\s\-\.\,\:\;\!\?\'\"]', '', cleaned)  # Keep basic punctuation
        return cleaned

    def create_element_based_mappings(self, sentences: List[Union[str, Dict]]) -> Dict:
        """
        Create sentence-to-element mappings using element indices and selectors
        Much more robust than coordinates since elements are stable
        
        Args:
            sentences: List of sentences (strings or dicts with 'text' field)
        
        Returns:
            Dict with element-based mappings compatible with frontend filtering
        """
        
        logger.info(f"🗺️ Creating element-based mappings for {len(sentences)} sentences")
        
        # Extract PDF.js content if not already done
        if not self.pdfjs_pages:
            self.extract_pdfjs_content()
        
        if not self.pdfjs_pages:
            logger.error("❌ Could not extract PDF.js content")
            return {'error': 'PDF extraction failed'}
        
        # Create mappings in frontend-friendly format
        mappings = {
            'document_info': {
                'pdf_path': self.pdf_path,
                'total_pages': len(self.pdfjs_pages),
                'total_sentences': len(sentences),
                'created_at': time.time()
            },
            'page_elements': {},  # page_num -> list of element info
            'sentence_to_elements': {},  # sentence_id -> element references
            'element_to_sentences': {}   # element_id -> list of sentence_ids (for reverse lookup)
        }
        
        # First pass: Build page element indices
        logger.info("🏗️ Building page element indices...")
        for page_data in self.pdfjs_pages:
            page_num = page_data['pageNumber']
            items = page_data.get('items', [])
            
            # Create stable element references for this page
            page_elements = []
            for idx, item in enumerate(items):
                element_info = {
                    'element_index': idx,
                    'page': page_num,
                    'text': item['str'],
                    'normalized_text': self._normalize_text(item['str']),
                    'selector_info': {
                        'element_type': 'span',  # PDF.js typically uses spans
                        'expected_attributes': {
                            'dir': item.get('dir', 'ltr'),
                            'style_left': f"{item.get('x', 0):.1f}px",
                            'style_top': f"{item.get('y', 0):.1f}px"
                        }
                    },
                    'position_hint': {
                        'x': item.get('x', 0),
                        'y': item.get('y', 0),
                        'width': item.get('width', 0),
                        'height': item.get('height', 0)
                    },
                    'font_info': {
                        'font_name': item.get('fontName', 'default'),
                        'font_size': item.get('fontSize', 12)
                    }
                }
                
                # Create multiple selector strategies
                element_info['selectors'] = self._create_element_selectors(element_info, idx)
                
                page_elements.append(element_info)
            
            mappings['page_elements'][page_num] = page_elements
        
        # Second pass: Map sentences to elements
        logger.info("🔗 Mapping sentences to elements...")
        found_count = 0
        
        for i, sentence in enumerate(sentences):
            # Handle different sentence formats
            if isinstance(sentence, dict):
                sentence_text = sentence.get('text', str(sentence))
                sentence_id = sentence.get('id', i)
            else:
                sentence_text = str(sentence)
                sentence_id = i
            
            if i % 100 == 0:  # Progress indicator
                logger.info(f"🔄 Processing sentence {i+1}/{len(sentences)}")
            
            # Find best element matches for this sentence
            element_matches = self._find_sentence_elements(sentence_text, mappings['page_elements'])
            
            if element_matches:
                found_count += 1
                
                # Store sentence mapping
                mappings['sentence_to_elements'][str(sentence_id)] = {
                    'sentence_id': sentence_id,
                    'text': sentence_text,
                    'element_matches': element_matches,
                    'primary_page': element_matches[0]['page'] if element_matches else None,
                    'confidence': max(match['confidence'] for match in element_matches) if element_matches else 0,
                    'match_strategy': element_matches[0]['match_strategy'] if element_matches else 'none'
                }
                
                # Build reverse mapping (element -> sentences)
                for match in element_matches:
                    element_key = f"{match['page']}_{match['element_index']}"
                    if element_key not in mappings['element_to_sentences']:
                        mappings['element_to_sentences'][element_key] = []
                    mappings['element_to_sentences'][element_key].append(sentence_id)
        
        # Add summary statistics
        mappings['statistics'] = {
            'total_sentences': len(sentences),
            'mapped_sentences': found_count,
            'mapping_rate': found_count / len(sentences) if sentences else 0,
            'total_elements': sum(len(page_elements) for page_elements in mappings['page_elements'].values()),
            'elements_with_sentences': len(mappings['element_to_sentences'])
        }
        
        logger.info(f"✅ Mapping complete: {found_count}/{len(sentences)} sentences mapped ({mappings['statistics']['mapping_rate']:.1%})")
        
        return mappings
    
    def _create_element_selectors(self, element_info: Dict, index: int) -> List[Dict]:
        """Create multiple selector strategies for finding elements in the frontend"""
        
        selectors = []
        
        # Strategy 1: Index-based selector (most reliable)
        selectors.append({
            'type': 'index',
            'selector': f'span:nth-child({index + 1})',  # CSS nth-child is 1-indexed
            'priority': 100,
            'description': 'Direct element index'
        })
        
        # Strategy 2: Text content selector (good for unique text)
        text = element_info['text'].strip()
        if text and len(text) > 3:
            escaped_text = text.replace('"', '\\"').replace("'", "\\'")
            selectors.append({
                'type': 'text_content',
                'selector': f'span:contains("{escaped_text[:50]}")',  # Limit length
                'priority': 90,
                'description': 'Text content match',
                'text_snippet': text[:50]
            })
        
        # Strategy 3: Position-based selector (fallback)
        pos = element_info['position_hint']
        if pos['x'] and pos['y']:
            selectors.append({
                'type': 'position',
                'selector': f'span[style*="left: {pos["x"]:.0f}px"][style*="top: {pos["y"]:.0f}px"]',
                'priority': 70,
                'description': 'Position-based match',
                'position': pos
            })
        
        # Strategy 4: Combined attributes selector
        attrs = element_info['selector_info']['expected_attributes']
        attr_selector = 'span'
        if attrs.get('dir'):
            attr_selector += f'[dir="{attrs["dir"]}"]'
        
        selectors.append({
            'type': 'attributes',
            'selector': attr_selector,
            'priority': 60,
            'description': 'Attribute-based match'
        })
        
        return selectors
    
    def _find_sentence_elements(self, sentence_text: str, page_elements: Dict) -> List[Dict]:
        """Find the best element matches for a sentence across all pages"""
        
        clean_sentence = self._normalize_text(sentence_text)
        if len(clean_sentence) < 5:
            return []
        
        all_matches = []
        
        # Search across all pages
        for page_num, elements in page_elements.items():
            page_matches = self._find_sentence_in_page_elements(clean_sentence, elements, page_num)
            all_matches.extend(page_matches)
        
        # Sort by confidence and quality
        all_matches.sort(key=lambda x: (x['confidence'], -len(x.get('element_span', []))), reverse=True)
        
        # Group contiguous elements and return best matches
        grouped_matches = self._group_contiguous_elements(all_matches)
        
        return grouped_matches[:5]  # Top 5 element groups
    
    def _find_sentence_in_page_elements(self, clean_sentence: str, elements: List[Dict], page_num: int) -> List[Dict]:
        """Find sentence matches within meaningful text elements of a single page"""
        
        # Filter out meaningless elements first
        meaningful_elements = [el for el in elements if self._is_meaningful_element(el)]
        
        if not meaningful_elements:
            return []
            
        matches = []
        sentence_words = clean_sentence.split()
        
        if len(sentence_words) < 2:
            return []
        
        # Strategy 1: Find substantial text overlap (like PDFTextHighlighter)
        for element in meaningful_elements:
            element_text = element['normalized_text']
            element_words = element_text.split()
            
            
            # Check for substantial overlap
            overlap_score = self._calculate_text_overlap(sentence_words, element_words)
            
            if overlap_score >= 0.3:  # At least 30% word overlap
                matches.append({
                    'page': page_num,
                    'element_index': element['element_index'],
                    'element_span': [element['element_index']],
                    'confidence': min(0.95, overlap_score),
                    'match_strategy': 'substantial_text_overlap',
                    'selectors': element['selectors'],
                    'matched_text': element['text'],
                    'overlap_score': overlap_score,
                    'word_overlap': len(set(sentence_words) & set(element_words))
                })
        
        # Strategy 2: Multi-element sequential matching for longer sentences
        if len(matches) < 2 and len(sentence_words) > 8:
            span_matches = self._find_meaningful_spans(clean_sentence, meaningful_elements, page_num)
            matches.extend(span_matches)
        
        # Strategy 3: Word distribution analysis for complex sentences
        if len(matches) < 3 and len(sentence_words) > 5:
            distributed_matches = self._find_distributed_word_elements(clean_sentence, meaningful_elements, page_num)
            matches.extend(distributed_matches)
        
        # Sort by quality and return best matches
        matches.sort(key=lambda x: (x['confidence'], x.get('overlap_score', 0)), reverse=True)
        
        return matches[:10]  # Limit to top 10 matches per sentence
    
    def _is_meaningful_element(self, element: Dict) -> bool:
        """Check if an element contains meaningful text worth mapping to"""
        
        text = element.get('text', '').strip()
        normalized = element.get('normalized_text', '').strip()
        
        # Must have actual text content
        if not text or not normalized:
            return False
        
        # Skip whitespace-only elements
        if len(normalized) == 0 or normalized.isspace():
            return False
        
        # Skip very short elements (likely punctuation or formatting)
        if len(normalized) < 3:
            return False
        
        # Skip elements that are just punctuation or symbols
        if all(not c.isalnum() for c in normalized):
            return False
        
        # Must contain at least one actual word
        words = normalized.split()
        if len(words) == 0:
            return False
        
        # Skip elements with only very short words (likely artifacts)
        if all(len(word) <= 2 for word in words):
            return False
        
        return True
    
    def _calculate_text_overlap(self, sentence_words: List[str], element_words: List[str]) -> float:
        """Calculate meaningful text overlap between sentence and element"""
        
        if not sentence_words or not element_words:
            return 0.0
        
        # Filter out very short words for better matching
        meaningful_sentence_words = [w for w in sentence_words if len(w) > 2]
        meaningful_element_words = [w for w in element_words if len(w) > 2]
        
        if not meaningful_sentence_words:
            return 0.0
        
        # Calculate word overlap
        sentence_set = set(meaningful_sentence_words)
        element_set = set(meaningful_element_words)
        
        common_words = sentence_set & element_set
        
        # Base overlap score
        overlap_ratio = len(common_words) / len(sentence_set)
        
        # Bonus for partial word matches (prefixes, stems)
        partial_matches = 0
        for s_word in meaningful_sentence_words:
            if s_word not in element_set:
                for e_word in meaningful_element_words:
                    if (len(s_word) > 4 and len(e_word) > 4 and 
                        (s_word.startswith(e_word[:4]) or e_word.startswith(s_word[:4]))):
                        partial_matches += 1
                        break
        
        partial_bonus = (partial_matches / len(meaningful_sentence_words)) * 0.3
        
        # Bonus for sequence preservation
        sequence_bonus = 0.0
        if overlap_ratio > 0.5:
            # Check if common words appear in similar order
            sentence_positions = {word: i for i, word in enumerate(meaningful_sentence_words)}
            element_positions = {word: i for i, word in enumerate(meaningful_element_words)}
            
            common_in_order = 0
            prev_s_pos = -1
            prev_e_pos = -1
            
            for word in sorted(common_words, key=lambda w: sentence_positions[w]):
                s_pos = sentence_positions[word]
                e_pos = element_positions[word]
                
                if s_pos > prev_s_pos and e_pos > prev_e_pos:
                    common_in_order += 1
                
                prev_s_pos = s_pos
                prev_e_pos = e_pos
            
            if len(common_words) > 1:
                sequence_bonus = (common_in_order / len(common_words)) * 0.2
        
        total_score = min(1.0, overlap_ratio + partial_bonus + sequence_bonus)
        
        return total_score
    
    def _find_meaningful_spans(self, clean_sentence: str, meaningful_elements: List[Dict], page_num: int) -> List[Dict]:
        """Find sentence spanning multiple meaningful elements"""
        
        matches = []
        sentence_words = clean_sentence.split()
        
        # Try spans of 2-8 consecutive meaningful elements
        for span_size in range(2, min(9, len(meaningful_elements) + 1)):
            for start_idx in range(len(meaningful_elements) - span_size + 1):
                span_elements = meaningful_elements[start_idx:start_idx + span_size]
                
                # Combine text from span
                combined_words = []
                for elem in span_elements:
                    combined_words.extend(elem['normalized_text'].split())
                
                if not combined_words:
                    continue
                
                # Calculate overlap for this span
                overlap_score = self._calculate_text_overlap(sentence_words, combined_words)
                
                if overlap_score >= 0.4:  # Higher threshold for spans
                    # Calculate coverage - how much of the sentence is covered
                    sentence_set = set(w for w in sentence_words if len(w) > 2)
                    span_set = set(w for w in combined_words if len(w) > 2)
                    coverage = len(sentence_set & span_set) / len(sentence_set) if sentence_set else 0
                    
                    # Combined confidence considering both overlap and coverage
                    confidence = min(0.9, (overlap_score * 0.7) + (coverage * 0.3))
                    
                    matches.append({
                        'page': page_num,
                        'element_index': span_elements[0]['element_index'],
                        'element_span': [elem['element_index'] for elem in span_elements],
                        'confidence': confidence,
                        'match_strategy': f'meaningful_span_{span_size}',
                        'selectors': span_elements[0]['selectors'],
                        'matched_text': ' '.join(elem['text'] for elem in span_elements),
                        'overlap_score': overlap_score,
                        'coverage_score': coverage,
                        'span_info': {
                            'span_size': span_size,
                            'word_count': len(combined_words)
                        }
                    })
        
        return matches
    
    def _find_distributed_word_elements(self, clean_sentence: str, meaningful_elements: List[Dict], page_num: int) -> List[Dict]:
        """Find sentence words distributed across meaningful elements"""
        
        sentence_words = [w for w in clean_sentence.split() if len(w) > 2]
        if len(sentence_words) < 4:  # Need substantial sentence
            return []
        
        # Map words to elements
        word_element_map = {}
        element_word_counts = {}
        
        for element in meaningful_elements:
            element_words = [w for w in element['normalized_text'].split() if len(w) > 2]
            element_index = element['element_index']
            element_word_counts[element_index] = len(element_words)
            
            for word in sentence_words:
                # Exact match
                if word in element_words:
                    if word not in word_element_map:
                        word_element_map[word] = []
                    word_element_map[word].append(element)
                # Partial match for longer words
                elif len(word) > 4:
                    for e_word in element_words:
                        if len(e_word) > 4 and (word.startswith(e_word[:4]) or e_word.startswith(word[:4])):
                            if word not in word_element_map:
                                word_element_map[word] = []
                            word_element_map[word].append(element)
                            break
        
        # Calculate coverage and quality
        covered_words = len(word_element_map)
        word_coverage = covered_words / len(sentence_words)
        
        if word_coverage >= 0.5:  # At least 50% word coverage
            # Collect unique elements
            all_elements = {}
            total_word_score = 0
            
            for word, elements in word_element_map.items():
                # Choose best element for each word (prefer elements with more words)
                best_element = max(elements, key=lambda e: element_word_counts[e['element_index']])
                element_index = best_element['element_index']
                
                if element_index not in all_elements:
                    all_elements[element_index] = best_element
                
                total_word_score += 1
            
            if len(all_elements) <= 12:  # Reasonable number of elements
                confidence = min(0.8, word_coverage * 0.9)  # Cap at 0.8 for distributed
                
                return [{
                    'page': page_num,
                    'element_index': min(all_elements.keys()),
                    'element_span': sorted(all_elements.keys()),
                    'confidence': confidence,
                    'match_strategy': 'meaningful_distributed_words',
                    'selectors': list(all_elements.values())[0]['selectors'],
                    'matched_text': f'Distributed across {len(all_elements)} meaningful elements',
                    'word_coverage': word_coverage,
                    'covered_words': covered_words,
                    'total_words': len(sentence_words),
                    'element_count': len(all_elements)
                }]
        
        return []
    
    def _group_contiguous_elements(self, matches: List[Dict]) -> List[Dict]:
        """Group matches that involve contiguous elements to avoid duplicates"""
        
        if not matches:
            return matches
        
        # Group by page first
        page_groups = {}
        for match in matches:
            page = match['page']
            if page not in page_groups:
                page_groups[page] = []
            page_groups[page].append(match)
        
        final_matches = []
        
        for page, page_matches in page_groups.items():
            # Sort by confidence and element position
            page_matches.sort(key=lambda x: (x['confidence'], x['element_index']), reverse=True)
            
            used_elements = set()
            
            for match in page_matches:
                element_span = set(match['element_span'])
                
                # Check if this match overlaps significantly with already used elements
                overlap = element_span & used_elements
                overlap_ratio = len(overlap) / len(element_span) if element_span else 0
                
                if overlap_ratio < 0.5:  # Less than 50% overlap
                    final_matches.append(match)
                    used_elements.update(element_span)
        
        return final_matches

# API Functions for Integration

def find_sentence_boxes(pdf_path: str, sentence_text: str, 
                       max_results: int = 5) -> List[Dict]:
    """
    Simple API to find bounding boxes for a sentence (legacy compatibility)
    
    Args:
        pdf_path: Path to PDF file
        sentence_text: Text to find and highlight
        max_results: Maximum number of bounding boxes to return
    
    Returns:
        List of bounding boxes compatible with PDF.js highlighting
    """
    try:
        mapper = EnhancedSentenceToPDFJSMapper(pdf_path)
        
        # Extract content and find in all pages
        if not mapper.extract_pdfjs_content():
            return []
        
        all_boxes = []
        for page_data in mapper.pdfjs_pages:
            page_num = page_data['pageNumber']
            boxes = mapper.find_sentence_in_page_items(sentence_text, page_num)
            
            # Add page number and convert to legacy format
            for box in boxes:
                box['page'] = page_num
                # Convert to coordinate format for backward compatibility
                if 'left' in box and 'top' in box:
                    all_boxes.append({
                        'page': page_num,
                        'x0': box['left'],
                        'y0': box['top'],
                        'x1': box['left'] + box['width'],
                        'y1': box['top'] + box['height'],
                        'confidence': box.get('confidence', 0.8),
                        'source': 'enhanced_sentence_mapper'
                    })
        
        return sorted(all_boxes, key=lambda x: x['confidence'], reverse=True)[:max_results]
        
    except Exception as e:
        logger.error(f"Error finding sentence boxes: {e}")
        return []

def find_multiple_sentences(pdf_path: str, sentences: List[str]) -> Dict[str, List[Dict]]:
    """
    Find bounding boxes for multiple sentences (legacy compatibility)
    
    Args:
        pdf_path: Path to PDF file
        sentences: List of sentence texts to find
    
    Returns:
        Dict mapping sentence text to list of bounding boxes
    """
    mapper = EnhancedSentenceToPDFJSMapper(pdf_path)
    results = {}
    
    # Extract content once
    if not mapper.extract_pdfjs_content():
        return {sentence: [] for sentence in sentences}
    
    for sentence in sentences:
        try:
            boxes = find_sentence_boxes(pdf_path, sentence)
            results[sentence] = boxes
        except Exception as e:
            logger.error(f"Error finding sentence '{sentence[:50]}...': {e}")
            results[sentence] = []
    
    return results

def process_sentences_file_legacy(pdf_path: str, sentences_path: str, 
                                 output_file: str = None) -> Dict:
    """
    Legacy function for backward compatibility - creates coordinate-based mappings
    
    Args:
        pdf_path: Path to PDF file
        sentences_path: Path to sentences JSON file
        output_file: Optional output file for mappings
    
    Returns:
        Dict with sentence mappings in legacy format
    """
    try:
        # Load sentences
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        # Handle different formats
        if isinstance(sentences_data, list):
            sentences = sentences_data
        elif isinstance(sentences_data, dict) and 'sentences' in sentences_data:
            sentences = sentences_data['sentences']
        else:
            raise ValueError("Unknown sentences file format")
        
        # Process sentences using legacy approach
        mapper = EnhancedSentenceToPDFJSMapper(pdf_path, verbose=True)
        
        sentence_mappings = {}
        
        for i, sentence in enumerate(sentences):
            # Handle string vs dict sentence formats
            if isinstance(sentence, dict):
                sentence_text = sentence.get('text', str(sentence))
            else:
                sentence_text = str(sentence)
            
            logger.info(f"Processing sentence {i+1}/{len(sentences)}")
            
            boxes = find_sentence_boxes(pdf_path, sentence_text)
            
            sentence_mappings[str(i)] = {
                'sentence_id': i,
                'text': sentence_text,
                'bounding_boxes': boxes,
                'found': len(boxes) > 0
            }
        
        # Create summary
        found_count = sum(1 for mapping in sentence_mappings.values() if mapping['found'])
        
        result = {
            'pdf_path': pdf_path,
            'sentences_path': sentences_path,
            'total_sentences': len(sentences),
            'found_sentences': found_count,
            'success_rate': found_count / len(sentences) if sentences else 0,
            'sentence_mappings': sentence_mappings,
            'generated_at': time.time(),
            'mapping_type': 'coordinate_based'
        }
        
        # Save if output file specified
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved legacy mappings to {output_file}")
        
        return result
        
    except Exception as e:
        logger.error(f"Error processing sentences file: {e}")
        return {'error': str(e)}

# Utility functions for testing and debugging

def test_element_mapping(pdf_path: str, sentence_text: str) -> Dict:
    """
    Test element mapping for a single sentence
    
    Args:
        pdf_path: Path to PDF file
        sentence_text: Sentence to test
    
    Returns:
        Dict with test results
    """
    try:
        mapper = EnhancedSentenceToPDFJSMapper(pdf_path, verbose=True)
        
        if not mapper.extract_pdfjs_content():
            return {'error': 'Failed to extract PDF.js content'}
        
        # Test element-based mapping
        element_mappings = mapper.create_element_based_mappings([sentence_text])
        
        if 'error' in element_mappings:
            return element_mappings
        
        # Test legacy coordinate mapping
        legacy_boxes = find_sentence_boxes(pdf_path, sentence_text)
        
        return {
            'sentence': sentence_text,
            'element_mapping': element_mappings.get('sentence_elements', {}).get('0', {}),
            'legacy_boxes': legacy_boxes,
            'pdf_pages': len(mapper.pdfjs_pages),
            'extraction_successful': True
        }
        
    except Exception as e:
        return {'error': str(e)}

def batch_test_mappings(sentences_dir: str, max_tests: int = 5) -> Dict:
    """
    Batch test element mappings for multiple documents
    
    Args:
        sentences_dir: Directory containing sentence files
        max_tests: Maximum number of documents to test
    
    Returns:
        Dict with batch test results
    """
    results = {
        'tested_documents': [],
        'total_tests': 0,
        'successful_tests': 0,
        'failed_tests': 0
    }
    
    if not os.path.exists(sentences_dir):
        return {'error': f'Sentences directory not found: {sentences_dir}'}
    
    sentence_files = [f for f in os.listdir(sentences_dir) if f.endswith('_sentences.json')][:max_tests]
    
    for file in sentence_files:
        basename = file.replace('_sentences.json', '')
        pdf_file = safe_find_file(basename, "pdf")
        
        if not pdf_file:
            continue
            
        results['total_tests'] += 1
        
        try:
            # Load first sentence for testing
            with open(os.path.join(sentences_dir, file), 'r') as f:
                sentences_data = json.load(f)
            
            if isinstance(sentences_data, list) and sentences_data:
                test_sentence = sentences_data[0]
            elif isinstance(sentences_data, dict) and 'sentences' in sentences_data and sentences_data['sentences']:
                test_sentence = sentences_data['sentences'][0]
            else:
                continue
            
            if isinstance(test_sentence, dict):
                test_sentence = test_sentence.get('text', str(test_sentence))
            
            # Test mapping
            test_result = test_element_mapping(pdf_file['path'], str(test_sentence)[:100])
            
            if 'error' not in test_result:
                results['successful_tests'] += 1
                test_result['document'] = basename
                results['tested_documents'].append(test_result)
            else:
                results['failed_tests'] += 1
                
        except Exception as e:
            results['failed_tests'] += 1
            logger.error(f"Test failed for {basename}: {e}")
    
    results['success_rate'] = results['successful_tests'] / results['total_tests'] if results['total_tests'] > 0 else 0
    
    return results
                

def process_sentences_file(pdf_path: str, sentences_path: str, 
                          output_file: str = None) -> Dict:
    """
    Process a sentences JSON file and create mappings
    
    Args:
        pdf_path: Path to PDF file
        sentences_file: Path to sentences JSON file
        output_file: Optional output file for mappings
    
    Returns:
        Dict with sentence mappings
    """
    try:
        # Load sentences
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        # Handle different formats
        if isinstance(sentences_data, list):
            sentences = sentences_data
        elif isinstance(sentences_data, dict) and 'sentences' in sentences_data:
            sentences = sentences_data['sentences']
        else:
            raise ValueError("Unknown sentences file format")
        
        # Process sentences
        mapper = EnhancedSentenceToPDFJSMapper(pdf_path, verbose=True)
        
        sentence_mappings = mapper.create_element_based_mappings(sentences)
        

        
        print(sentence_mappings['statistics'])
        
        # Save if output file specified
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(sentence_mappings, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved mappings to {output_file}")
        
        return sentence_mappings
        
    except Exception as e:
        logger.error(f"Error processing sentences file: {e}")
        return {'error': str(e)}

    
   
    
def main():
    # Process documents
   
    sentences_dir = os.path.join(os.getcwd(), "sentences")
    for file in os.listdir(sentences_dir):

        basename = os.path.basename(file)
        basename = str(basename).replace('_sentences.json', '')
        print(f"Processing file: {basename}")
        pdf_file = safe_find_file(basename, "pdf")
        pdf_path = pdf_file['path'] 
        sentences_path = os.path.join(sentences_dir, file)


        mapping = process_sentences_file(pdf_path, sentences_path)
    


        # Save mapping to JSON file
        output_file = os.path.join(os.getcwd(), 'element_mappings', f"{basename}_mappings.json")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(mapping, f, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    main()

