"""
Direct PDF Text Coordinate Mapper
Directly searches PDF for provenance text and returns bounding coordinates
Bypasses sentence mapping complexity by working directly with PDF text elements
"""

import json
import re
import logging
from typing import Dict, List, Optional, Tuple
from difflib import SequenceMatcher
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams, LTTextContainer, LTTextBox, LTTextLine, LTChar
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class TextElement:
    """Represents a text element with its coordinates"""
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    page: int
    font_size: float = 0
    confidence: float = 1.0

class DirectPDFTextMapper:
    """Maps provenance text directly to PDF coordinates without sentence intermediaries"""
    
    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self.text_elements = {}  # Cache by page
        
    def find_provenance_text(self, provenance_text: str, max_pages: int = None) -> List[Dict]:
        """
        Find provenance text directly in PDF and return bounding boxes
        
        Args:
            provenance_text: The exact text to find
            max_pages: Limit search to first N pages (None for all pages)
            
        Returns:
            List of bounding box dictionaries with coordinates and confidence
        """
        logger.info(f"🔍 Searching PDF for: '{provenance_text[:100]}...'")
        
        # Clean the search text
        clean_provenance = self._normalize_text(provenance_text)
        
        if len(clean_provenance) < 5:
            logger.warning("Provenance text too short for reliable search")
            return []
        
        all_matches = []
        
        # Extract text elements from PDF pages
        try:
            with open(self.pdf_path, 'rb') as fp:
                rsrcmgr = PDFResourceManager()
                laparams = LAParams(
                    all_texts=True,
                    detect_vertical=True,
                    word_margin=0.1,
                    char_margin=2.0,
                    line_margin=0.5,
                    boxes_flow=0.5
                )
                device = PDFPageAggregator(rsrcmgr, laparams=laparams)
                interpreter = PDFPageInterpreter(rsrcmgr, device)
                
                for page_num, page in enumerate(PDFPage.get_pages(fp), 1):
                    if max_pages and page_num > max_pages:
                        break
                        
                    logger.debug(f"📄 Searching page {page_num}")
                    
                    # Extract text elements from this page
                    page_elements = self._extract_page_text_elements(
                        page, interpreter, device, page_num
                    )
                    
                    # Search for provenance text in this page
                    page_matches = self._search_text_in_page_elements(
                        clean_provenance, page_elements, provenance_text
                    )
                    
                    all_matches.extend(page_matches)
                    
                    if page_matches:
                        logger.info(f"✅ Found {len(page_matches)} matches on page {page_num}")
        
        except Exception as e:
            logger.error(f"Error searching PDF: {e}")
            return []
        
        logger.info(f"🎯 Total matches found: {len(all_matches)}")
        return all_matches
    
    def _extract_page_text_elements(self, page, interpreter, device, page_num: int) -> List[TextElement]:
        """Extract text elements with coordinates from a PDF page"""
        
        interpreter.process_page(page)
        layout = device.get_result()
        
        elements = []
        
        def extract_text_recursive(obj):
            """Recursively extract text from layout objects"""
            if hasattr(obj, 'get_text'):
                text = obj.get_text().strip()
                if text and len(text) > 0:
                    bbox = obj.bbox
                    font_size = getattr(obj, 'height', 0) if hasattr(obj, 'height') else 0
                    
                    elements.append(TextElement(
                        text=text,
                        x0=bbox[0],
                        y0=bbox[1],
                        x1=bbox[2],
                        y1=bbox[3],
                        page=page_num,
                        font_size=font_size
                    ))
            
            # Recurse into child objects
            if hasattr(obj, '__iter__'):
                for child in obj:
                    extract_text_recursive(child)
        
        for element in layout:
            if isinstance(element, LTTextContainer):
                extract_text_recursive(element)
        
        # Sort elements by reading order (top to bottom, left to right)
        elements.sort(key=lambda x: (-x.y1, x.x0))
        
        logger.debug(f"📄 Extracted {len(elements)} text elements from page {page_num}")
        return elements
    
    def _search_text_in_page_elements(self, clean_provenance: str, 
                                    elements: List[TextElement], 
                                    original_provenance: str) -> List[Dict]:
        """Search for provenance text within page elements"""
        
        matches = []
        
        # Strategy 1: Single element exact match
        for element in elements:
            clean_element_text = self._normalize_text(element.text)
            
            if clean_provenance in clean_element_text:
                logger.debug(f"✅ Exact match in element: '{element.text[:50]}...'")
                
                # Create precise sub-element bounding box
                sub_box = self._create_precise_sub_element_box(
                    element, clean_provenance, clean_element_text
                )
                if sub_box:
                    matches.append(sub_box)
        
        # Strategy 2: Multi-element sequential matching
        if not matches:
            multi_matches = self._find_multi_element_matches(
                clean_provenance, elements, original_provenance
            )
            matches.extend(multi_matches)
        
        # Strategy 3: Fuzzy matching within elements
        if not matches:
            fuzzy_matches = self._find_fuzzy_matches(
                clean_provenance, elements, original_provenance
            )
            matches.extend(fuzzy_matches)
        
        return matches
    
    def _create_precise_sub_element_box(self, element: TextElement, 
                                      target_text: str, element_text: str) -> Optional[Dict]:
        """Create precise bounding box within an element for target text"""
        
        # Find position of target text within element
        start_pos = element_text.find(target_text)
        if start_pos == -1:
            return None
        
        end_pos = start_pos + len(target_text)
        total_length = len(element_text)
        
        if total_length == 0:
            return None
        
        # Calculate proportional positions
        start_ratio = start_pos / total_length
        end_ratio = end_pos / total_length
        
        # Calculate sub-element coordinates
        element_width = element.x1 - element.x0
        sub_x0 = element.x0 + (start_ratio * element_width)
        sub_x1 = element.x0 + (end_ratio * element_width)
        
        # Add small padding and ensure bounds
        padding = 2
        sub_x0 = max(element.x0, sub_x0 - padding)
        sub_x1 = min(element.x1, sub_x1 + padding)
        
        return {
            'page': element.page,
            'x0': sub_x0,
            'y0': element.y0,
            'x1': sub_x1,
            'y1': element.y1,
            'confidence': 0.95,
            'match_type': 'precise_sub_element',
            'source': 'direct_pdf_mapper',
            'matched_text': target_text,
            'original_element_text': element.text[:100] + ('...' if len(element.text) > 100 else ''),
            'character_range': f"{start_pos}-{end_pos}/{total_length}"
        }
    
    def _find_multi_element_matches(self, target_text: str, 
                                  elements: List[TextElement], 
                                  original_text: str) -> List[Dict]:
        """Find target text that spans multiple consecutive elements"""
        
        matches = []
        
        # Try different window sizes (2-4 consecutive elements)
        for window_size in range(2, min(5, len(elements) + 1)):
            for start_idx in range(len(elements) - window_size + 1):
                element_group = elements[start_idx:start_idx + window_size]
                
                # Combine text from this group
                combined_text = ' '.join([el.text for el in element_group])
                clean_combined = self._normalize_text(combined_text)
                
                if target_text in clean_combined:
                    logger.debug(f"✅ Multi-element match across {window_size} elements")
                    
                    # Create bounding boxes for relevant elements
                    group_matches = self._create_multi_element_boxes(
                        element_group, target_text, clean_combined, original_text
                    )
                    matches.extend(group_matches)
                    
                    # Return first good match to avoid overlaps
                    if group_matches:
                        return matches
        
        return matches
    
    def _create_multi_element_boxes(self, element_group: List[TextElement], 
                                  target_text: str, combined_text: str, 
                                  original_text: str) -> List[Dict]:
        """Create bounding boxes for multi-element matches"""
        
        # Find where target starts in combined text
        target_start = combined_text.find(target_text)
        if target_start == -1:
            # Fallback: highlight all elements
            return self._highlight_all_elements(element_group, 0.8, 'multi_element_fallback')
        
        target_end = target_start + len(target_text)
        
        # Map character positions to elements
        char_pos = 0
        result_boxes = []
        
        for element in element_group:
            element_text = self._normalize_text(element.text)
            element_start = char_pos
            element_end = char_pos + len(element_text)
            
            # Check if this element contains part of target
            if element_end > target_start and element_start < target_end:
                # Calculate which part of this element to highlight
                relative_start = max(0, target_start - element_start)
                relative_end = min(len(element_text), target_end - element_start)
                
                if relative_start == 0 and relative_end == len(element_text):
                    # Highlight entire element
                    result_boxes.append({
                        'page': element.page,
                        'x0': element.x0,
                        'y0': element.y0,
                        'x1': element.x1,
                        'y1': element.y1,
                        'confidence': 0.9,
                        'match_type': 'multi_element_full',
                        'source': 'direct_pdf_mapper'
                    })
                else:
                    # Highlight part of element
                    if len(element_text) > 0:
                        start_ratio = relative_start / len(element_text)
                        end_ratio = relative_end / len(element_text)
                        
                        element_width = element.x1 - element.x0
                        sub_x0 = element.x0 + (start_ratio * element_width)
                        sub_x1 = element.x0 + (end_ratio * element_width)
                        
                        result_boxes.append({
                            'page': element.page,
                            'x0': max(element.x0, sub_x0 - 2),
                            'y0': element.y0,
                            'x1': min(element.x1, sub_x1 + 2),
                            'y1': element.y1,
                            'confidence': 0.85,
                            'match_type': 'multi_element_partial',
                            'source': 'direct_pdf_mapper'
                        })
            
            char_pos += len(element_text) + 1  # +1 for space
        
        return result_boxes
    
    def _find_fuzzy_matches(self, target_text: str, elements: List[TextElement], 
                          original_text: str) -> List[Dict]:
        """Find fuzzy matches for target text"""
        
        matches = []
        target_words = set(target_text.split())
        
        if len(target_words) < 3:
            return matches
        
        for element in elements:
            clean_element = self._normalize_text(element.text)
            element_words = set(clean_element.split())
            
            # Calculate word overlap
            common_words = target_words & element_words
            overlap_ratio = len(common_words) / len(target_words)
            
            # Also check sequence similarity
            similarity = SequenceMatcher(None, target_text, clean_element).ratio()
            
            # Use higher of word overlap or sequence similarity
            confidence = max(overlap_ratio, similarity)
            
            if confidence > 0.7:  # High threshold for fuzzy matches
                matches.append({
                    'page': element.page,
                    'x0': element.x0,
                    'y0': element.y0,
                    'x1': element.x1,
                    'y1': element.y1,
                    'confidence': confidence * 0.8,  # Penalty for fuzzy matching
                    'match_type': 'fuzzy_match',
                    'source': 'direct_pdf_mapper',
                    'word_overlap': f"{len(common_words)}/{len(target_words)}",
                    'sequence_similarity': f"{similarity:.2f}"
                })
        
        # Sort by confidence and return top matches
        matches.sort(key=lambda x: x['confidence'], reverse=True)
        return matches[:3]  # Limit to top 3 fuzzy matches
    
    def _highlight_all_elements(self, elements: List[TextElement], 
                              confidence: float, match_type: str) -> List[Dict]:
        """Create highlight boxes for all elements in group"""
        
        boxes = []
        for element in elements:
            boxes.append({
                'page': element.page,
                'x0': element.x0,
                'y0': element.y0,
                'x1': element.x1,
                'y1': element.y1,
                'confidence': confidence,
                'match_type': match_type,
                'source': 'direct_pdf_mapper'
            })
        
        return boxes
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching"""
        if not text:
            return ""
        
        # Handle potential encoding issues
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='ignore')
        
        # Basic normalization
        normalized = re.sub(r'\s+', ' ', text.lower().strip())
        
        # Remove special characters but keep essential punctuation
        normalized = re.sub(r'[^\w\s\-\.\,\:\;\!\?]', '', normalized)
        
        return normalized

# API function for integration with your routes.py
def find_provenance_in_pdf(pdf_path: str, provenance_text: str, max_pages: int = None) -> List[Dict]:
    """
    Main API function to find provenance text directly in PDF
    
    Args:
        pdf_path: Path to the PDF file
        provenance_text: Text to search for
        max_pages: Limit search to first N pages
        
    Returns:
        List of bounding box dictionaries
    """
    try:
        mapper = DirectPDFTextMapper(pdf_path)
        return mapper.find_provenance_text(provenance_text, max_pages)
    except Exception as e:
        logger.error(f"Error in direct PDF text mapping: {e}")
        return []

# Batch processing function for multiple provenance texts
def find_multiple_provenance_in_pdf(pdf_path: str, provenance_texts: List[str], 
                                   max_pages: int = None) -> Dict[str, List[Dict]]:
    """
    Find multiple provenance texts in PDF
    
    Args:
        pdf_path: Path to the PDF file
        provenance_texts: List of texts to search for
        max_pages: Limit search to first N pages
        
    Returns:
        Dict mapping provenance text to list of bounding boxes
    """
    mapper = DirectPDFTextMapper(pdf_path)
    results = {}
    
    for provenance_text in provenance_texts:
        try:
            matches = mapper.find_provenance_text(provenance_text, max_pages)
            results[provenance_text] = matches
        except Exception as e:
            logger.error(f"Error finding provenance '{provenance_text[:50]}...': {e}")
            results[provenance_text] = []
    
    return results