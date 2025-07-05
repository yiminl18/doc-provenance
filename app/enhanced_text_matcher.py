"""
Enhanced text matching for precise provenance highlighting
Provides character-level and sub-element text matching capabilities
"""

import json
import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

def get_enhanced_provenance_boxes(layout_file_path: str, sentence_ids: List[int], 
                                provenance_text: str) -> Dict[int, List[Dict]]:
    """
    Main entry point for enhanced provenance text matching
    Returns precise bounding boxes for provenance text within specified sentences
    """
    try:
        with open(layout_file_path, 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        # Clean the provenance text for matching
        clean_provenance = clean_text_for_matching(provenance_text)
        
        logger.info(f"🔍 Enhanced matching for: '{clean_provenance[:100]}...'")
        
        precise_boxes = {}
        for sentence_id in sentence_ids:
            # Get sentence data and bounds
            sentence_data = []
            bounding_boxes = []
            for sent in layout_data.get('sentences', []):
                if sent.get('sentence_id') == sentence_id:
                    sentence_data = sent
                    if sent.get('bounding_boxes'):
                        bounding_boxes = sent['bounding_boxes']
            if not sentence_data or not bounding_boxes:
                continue
            
            sentence_bounds = bounding_boxes
            sentence_page = sentence_data.get('primary_page')

            # get layout matches
            layout_matches = sentence_data.get('layout_matches', [])
            if not layout_matches:
                logger.warning(f"No layout matches found for sentence {sentence_id}")
                continue
            
            # Filter elements within sentence bounds
            #valid_elements = get_elements_in_sentence_bounds(page_layout['elements'], sentence_bounds)
            
            logger.info(f"📄 Found {len(layout_matches)} valid elements for sentence {sentence_id}")
            
            # Try multi-element matching with sub-element precision
            matching_boxes = find_multi_element_matches(layout_matches, clean_provenance)
            
            if matching_boxes:
                precise_boxes[sentence_id] = matching_boxes
                logger.info(f"✅ Found {len(matching_boxes)} precise matches for sentence {sentence_id}")
            else:
                logger.info(f"❌ No precise matches found for sentence {sentence_id}")
        
        return precise_boxes
        
    except Exception as e:
        logger.error(f"Error in enhanced text matching: {e}")
        return {}

def clean_text_for_matching(text: str) -> str:
    """Clean text for robust matching"""
    if not text:
        return ""
    
    # Normalize whitespace and remove special characters
    cleaned = re.sub(r'\s+', ' ', text.strip())
    cleaned = re.sub(r'[^\w\s\-\.]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned.strip())
    return cleaned.lower()

def get_elements_in_sentence_bounds(page_elements: List[Dict], sentence_bounds: List[Dict]) -> List[Dict]:
    """Filter page elements to those within sentence bounding boxes"""
    valid_elements = []
    
    for element in page_elements:
        if not element.get('text') or len(element['text']) < 3:
            continue
        
        # Check if element overlaps with any sentence bound
        element_in_sentence = False
        for bound in sentence_bounds:
            if not (element.get('x1', 0) < bound.get('x0', 0) - 10 or 
                   element.get('x0', 0) > bound.get('x1', 100) + 10 or
                   element.get('y1', 0) < bound.get('y0', 0) - 5 or 
                   element.get('y0', 0) > bound.get('y1', 20) + 5):
                element_in_sentence = True
                break
        
        if element_in_sentence:
            valid_elements.append(element)
    
    # Sort elements by reading order (top to bottom, left to right)
    valid_elements.sort(key=lambda x: (-x.get('y1', 0), x.get('x0', 0)))
    
    return valid_elements

def find_multi_element_matches(elements: List[Dict], target_text: str) -> List[Dict]:
    """
    Find matches that may span across multiple consecutive PDF elements
    Uses sub-element positioning for precise highlighting
    """
    matching_boxes = []
    
    logger.info(f"🔍 Finding matches for: '{target_text[:50]}...' across {len(elements)} elements")
    
    # Strategy 1: Single element with sub-element precision
    for i, element in enumerate(elements):
        clean_element = clean_text_for_matching(element['text'])
        
        if target_text in clean_element:
            logger.info(f"   ✅ Exact match in single element!")
            sub_boxes = find_target_in_element_precise(element, target_text)
            if sub_boxes:
                matching_boxes.extend(sub_boxes)
                return matching_boxes  # Return first good match
        
        # Check for high word overlap in single element
        target_words = set(target_text.split())
        element_words = set(clean_element.split())
        common_words = target_words & element_words
        
        if len(common_words) >= len(target_words) * 0.8:  # 80% overlap
            logger.info(f"   ✅ High word overlap: {len(common_words)}/{len(target_words)}")
            sub_boxes = find_target_in_element_precise(element, target_text)
            if sub_boxes:
                sub_boxes[0]['match_type'] = 'sub_element_word_overlap'
                sub_boxes[0]['confidence'] = len(common_words) / len(target_words)
                matching_boxes.extend(sub_boxes)
                return matching_boxes
    
    # Strategy 2: Multi-element sequential matching
    logger.info(f"   🔄 Trying multi-element matching...")
    
    for start_idx in range(len(elements)):
        for end_idx in range(start_idx + 1, min(start_idx + 4, len(elements) + 1)):
            element_sequence = elements[start_idx:end_idx]
            
            # Combine text from this sequence
            combined_text = ' '.join([elem['text'] for elem in element_sequence])
            clean_combined = clean_text_for_matching(combined_text)
            
            if target_text in clean_combined:
                logger.info(f"   ✅ Multi-element exact match found!")
                matching_boxes.extend(create_multi_element_sub_boxes(
                    element_sequence, target_text, combined_text
                ))
                return matching_boxes
            
            # Check for high word overlap across elements
            target_words = set(target_text.split())
            combined_words = set(clean_combined.split())
            common_words = target_words & combined_words
            
            if len(common_words) >= len(target_words) * 0.7:  # 70% overlap
                logger.info(f"   ✅ Multi-element word overlap: {len(common_words)}/{len(target_words)}")
                matching_boxes.extend(create_multi_element_sub_boxes(
                    element_sequence, target_text, combined_text, partial=True
                ))
                return matching_boxes
    
    logger.info(f"   ❌ No good matches found")
    return matching_boxes

def find_target_in_element_precise(element: Dict, target_text: str) -> List[Dict]:
    """
    Find target text within an element and return precise sub-element boxes
    """
    element_text = element.get('text', '')
    
    # Try exact match first
    sub_boxes = create_sub_element_boxes(element, target_text, element_text)
    if sub_boxes:
        return sub_boxes
    
    # Try partial matching for long target texts
    target_words = target_text.split()
    if len(target_words) > 3:
        # Try matching first few words
        partial_target = ' '.join(target_words[:3])
        sub_boxes = create_sub_element_boxes(element, partial_target, element_text)
        if sub_boxes:
            logger.info(f"   ✅ Partial match with first 3 words: '{partial_target}'")
            sub_boxes[0]['match_type'] = 'sub_element_partial'
            sub_boxes[0]['confidence'] = 0.7
            return sub_boxes
        
        # Try matching last few words
        partial_target = ' '.join(target_words[-3:])
        sub_boxes = create_sub_element_boxes(element, partial_target, element_text)
        if sub_boxes:
            logger.info(f"   ✅ Partial match with last 3 words: '{partial_target}'")
            sub_boxes[0]['match_type'] = 'sub_element_partial'
            sub_boxes[0]['confidence'] = 0.7
            return sub_boxes
    
    return []

def create_sub_element_boxes(element: Dict, target_text: str, element_text: str) -> List[Dict]:
    """
    Create multiple smaller bounding boxes within a single PDF element
    based on where the target text appears
    """
    
    # Clean texts for matching
    clean_element = clean_text_for_matching(element_text)
    clean_target = clean_text_for_matching(target_text)

    logger.info(f"🔍 Searching for target: '{clean_target}' in {clean_element}")
    
    # Find where target text starts in element text
    start_pos = clean_element.find(clean_target)
    logger.info(f"Starts at position: {start_pos} in element text")
    
    if start_pos == -1:
        return []
    
    # Calculate element dimensions
    logger.info(f"Element dimensions: {element['x0']}, {element['y0']} to {element['x1']}, {element['y1']}")
    element_width = element['x1'] - element['x0']
    element_height = element['y1'] - element['y0']
    total_chars = len(clean_element)
    
    if total_chars == 0 or element_width <= 0:
        return []
    
    # Estimate character width (rough approximation)
    char_width = element_width / total_chars
    
    # Calculate approximate positions
    start_x = element['x0'] + (start_pos * char_width)
    end_x = element['x0'] + ((start_pos + len(clean_target)) * char_width)
    
    # Ensure we don't go outside element bounds
    start_x = max(element['x0'], start_x - 2)  # Small padding
    end_x = min(element['x1'], end_x + 2)     # Small padding
    
    # Create sub-element bounding box
    sub_box = {
        'page': element.get('page'),
        'x0': start_x,
        'y0': element['y0'],
        'x1': end_x,
        'y1': element['y1'],
        'confidence': 0.85,  # Good confidence for estimated positioning
        'match_type': 'sub_element_estimated',
        'source': 'character_level_estimation',
        'original_element_width': element_width,
        'estimated_char_width': char_width,
        'target_start_pos': start_pos
    }

    logger.info(f"Created sub-element box: {sub_box}")
    
    return [sub_box]

def create_multi_element_sub_boxes(element_sequence: List[Dict], target_text: str, 
                                 combined_text: str, partial: bool = False) -> List[Dict]:
    """
    Create sub-element boxes when target text spans multiple elements
    """
    sub_boxes = []
    
    clean_target = clean_text_for_matching(target_text)
    clean_combined = clean_text_for_matching(combined_text)
    
    # Find where target starts in combined text
    target_start = clean_combined.find(clean_target)
    
    if target_start == -1:
        # Fallback: highlight all elements in sequence
        logger.info(f"   ⚠️ Using fallback: highlighting all elements in sequence")
        for elem in element_sequence:
            sub_boxes.append({
                'page': elem.get('page'),
                'x0': elem['x0'],
                'y0': elem['y0'],
                'x1': elem['x1'],
                'y1': elem['y1'],
                'confidence': 0.6 if partial else 0.8,
                'match_type': 'multi_element_fallback',
                'source': 'multi_element_matcher'
            })
        return sub_boxes
    
    # Calculate character positions across elements
    char_pos = 0
    target_end = target_start + len(clean_target)
    
    for elem in element_sequence:
        elem_text = elem.get('text', '')
        clean_elem_text = clean_text_for_matching(elem_text)
        elem_length = len(clean_elem_text)
        
        elem_start = char_pos
        elem_end = char_pos + elem_length
        
        # Check if this element contains part of our target
        if elem_end > target_start and elem_start < target_end:
            # This element contains part of our target text
            relative_start = max(0, target_start - elem_start)
            relative_end = min(elem_length, target_end - elem_start)
            
            # Create sub-element box for this portion
            elem_width = elem['x1'] - elem['x0']
            char_width = elem_width / elem_length if elem_length > 0 else 0
            
            start_x = elem['x0'] + (relative_start * char_width)
            end_x = elem['x0'] + (relative_end * char_width)
            
            # Ensure bounds
            start_x = max(elem['x0'], start_x - 2)
            end_x = min(elem['x1'], end_x + 2)
            
            sub_boxes.append({
                'page': elem.get('page'),
                'x0': start_x,
                'y0': elem['y0'],
                'x1': end_x,
                'y1': elem['y1'],
                'confidence': 0.7 if partial else 0.9,
                'match_type': 'multi_element_sub_precise',
                'source': 'multi_element_matcher',
                'element_portion': f"{relative_start}-{relative_end}"
            })
        
        char_pos += elem_length + 1  # +1 for space between elements
    
    return sub_boxes