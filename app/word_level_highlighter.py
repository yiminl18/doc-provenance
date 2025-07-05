import json
import re
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional, Tuple

def normalize_text_for_word_matching(text: str) -> str:
    """Normalize text while preserving word boundaries"""
    if not text:
        return ""
    
    # Convert to lowercase
    normalized = text.lower()
    
    # Replace non-alphanumeric with spaces (preserves word boundaries)
    normalized = re.sub(r'[^\w\s]', ' ', normalized)
    
    # Normalize whitespace to single spaces
    normalized = re.sub(r'\s+', ' ', normalized)
    
    return normalized.strip()

def find_word_positions_in_text(text: str, target_words: List[str]) -> List[Tuple[int, int, str]]:
    """
    Find start and end positions of target words in text
    Returns list of (start_pos, end_pos, word) tuples
    """
    positions = []
    normalized_text = normalize_text_for_word_matching(text)
    
    # Create a mapping of normalized position to original position
    original_to_norm = []
    norm_to_original = {}
    
    norm_pos = 0
    for orig_pos, char in enumerate(text):
        if char.isalnum() or char.isspace():
            norm_char = char.lower() if char.isalnum() else ' '
            if norm_pos < len(normalized_text) and normalized_text[norm_pos] == norm_char:
                norm_to_original[norm_pos] = orig_pos
                norm_pos += 1
    
    # Find each target word
    for target_word in target_words:
        norm_target = normalize_text_for_word_matching(target_word)
        
        # Find all occurrences of this word
        start = 0
        while True:
            pos = normalized_text.find(norm_target, start)
            if pos == -1:
                break
            
            # Check if it's a whole word (word boundaries)
            is_word_start = pos == 0 or normalized_text[pos-1].isspace()
            is_word_end = pos + len(norm_target) >= len(normalized_text) or normalized_text[pos + len(norm_target)].isspace()
            
            if is_word_start and is_word_end:
                # Map back to original positions
                orig_start = norm_to_original.get(pos, 0)
                orig_end = norm_to_original.get(pos + len(norm_target) - 1, len(text) - 1) + 1
                
                positions.append((orig_start, orig_end, target_word))
            
            start = pos + 1
    
    return positions

def create_word_level_boxes(element: Dict, target_text: str) -> List[Dict]:
    """
    Create precise word-level bounding boxes within a PDF element
    """
    element_text = element.get('text', '')
    if not element_text or not target_text:
        return []
    
    # Extract words from target text
    target_words = [word.strip() for word in re.split(r'[^\w]+', target_text) if word.strip()]
    
    if not target_words:
        return []
    
    # Find positions of target words in element text
    word_positions = find_word_positions_in_text(element_text, target_words)
    
    if not word_positions:
        return []
    
    # Calculate element dimensions
    element_width = element['x1'] - element['x0']
    element_height = element['y1'] - element['y0']
    total_chars = len(element_text)
    
    if total_chars == 0 or element_width <= 0:
        return []
    
    # Estimate character dimensions
    avg_char_width = element_width / total_chars
    
    # Estimate line height (assuming multi-line text)
    lines = element_text.split('\n')
    line_height = element_height / len(lines) if len(lines) > 1 else element_height
    
    boxes = []
    
    for start_pos, end_pos, word in word_positions:
        # Calculate which line this word is on
        text_before = element_text[:start_pos]
        line_breaks_before = text_before.count('\n')
        
        # Calculate position within the line
        last_line_break = text_before.rfind('\n')
        if last_line_break == -1:
            chars_in_line_before = start_pos
        else:
            chars_in_line_before = start_pos - last_line_break - 1
        
        # Calculate bounding box for this word
        word_length = end_pos - start_pos
        
        # X coordinates
        start_x = element['x0'] + (chars_in_line_before * avg_char_width)
        end_x = start_x + (word_length * avg_char_width)
        
        # Y coordinates (top-down coordinate system)
        start_y = element['y0'] + (line_breaks_before * line_height)
        end_y = start_y + line_height
        
        # Add padding and ensure bounds
        padding = 2
        start_x = max(element['x0'], start_x - padding)
        end_x = min(element['x1'], end_x + padding)
        
        boxes.append({
            'page': element.get('page', 1),
            'x0': start_x,
            'y0': start_y,
            'x1': end_x,
            'y1': end_y,
            'confidence': 0.95,
            'match_type': 'word_level_precise',
            'source': 'word_level_highlighter',
            'word': word,
            'line_number': line_breaks_before,
            'char_position': start_pos,
            'word_length': word_length
        })
    
    return boxes

def create_line_aware_boxes(element: Dict, target_text: str) -> List[Dict]:
    """
    Create line-aware bounding boxes that respect line boundaries
    """
    element_text = element.get('text', '')
    if not element_text or not target_text:
        return []
    
    # Normalize texts for matching
    norm_element = normalize_text_for_word_matching(element_text)
    norm_target = normalize_text_for_word_matching(target_text)
    
    # Find where target starts and ends in normalized text
    start_pos = norm_element.find(norm_target)
    if start_pos == -1:
        return []
    
    end_pos = start_pos + len(norm_target)
    
    # Map back to original text positions (approximate)
    orig_start = start_pos
    orig_end = end_pos
    
    # Split element text into lines
    lines = element_text.split('\n')
    
    # Calculate element dimensions
    element_width = element['x1'] - element['x0']
    element_height = element['y1'] - element['y0']
    line_height = element_height / len(lines) if len(lines) > 1 else element_height
    
    boxes = []
    current_pos = 0
    
    for line_num, line in enumerate(lines):
        line_start = current_pos
        line_end = current_pos + len(line)
        
        # Check if this line contains part of our target text
        if line_end > orig_start and line_start < orig_end:
            # Calculate what part of this line to highlight
            highlight_start = max(0, orig_start - line_start)
            highlight_end = min(len(line), orig_end - line_start)
            
            if highlight_end > highlight_start:
                # Calculate line dimensions
                avg_char_width = element_width / max(1, len(line))
                
                # X coordinates for this line segment
                start_x = element['x0'] + (highlight_start * avg_char_width)
                end_x = element['x0'] + (highlight_end * avg_char_width)
                
                # Y coordinates for this line
                start_y = element['y0'] + (line_num * line_height)
                end_y = start_y + line_height
                
                # Add padding
                padding = 2
                start_x = max(element['x0'], start_x - padding)
                end_x = min(element['x1'], end_x + padding)
                
                boxes.append({
                    'page': element.get('page', 1),
                    'x0': start_x,
                    'y0': start_y,
                    'x1': end_x,
                    'y1': end_y,
                    'confidence': 0.9,
                    'match_type': 'line_aware_precise',
                    'source': 'word_level_highlighter',
                    'line_number': line_num,
                    'line_text': line[highlight_start:highlight_end],
                    'line_total': line
                })
        
        current_pos = line_end + 1  # +1 for the newline character
    
    return boxes

def get_word_level_provenance_boxes(layout_file_path: str, sentence_ids: List[int], provenance_text: str) -> Dict[int, List[Dict]]:
    """
    Get word-level provenance boxes that highlight only the specific words/lines mentioned
    """
    try:
        with open(layout_file_path, 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        sentences = layout_data.get('sentences', [])
        pages_layout = layout_data.get('pages_layout', [])
        
        if not sentences or not pages_layout:
            return {}
        
        # Find best matching sentence
        all_sentence_texts = [sent.get('text', '') for sent in sentences]
        best_sentence_id = find_best_sentence_match_word_level(provenance_text, all_sentence_texts)
        
        if best_sentence_id is not None:
            print(f"✅ Word-level match found: sentence {best_sentence_id}")
            target_sentence_ids = [best_sentence_id]
        else:
            print(f"⚠️ Using provided sentence IDs: {sentence_ids}")
            target_sentence_ids = sentence_ids
        
        result_boxes = {}
        
        for sentence_id in target_sentence_ids:
            if sentence_id >= len(sentences):
                continue
            
            sentence_data = sentences[sentence_id]
            sentence_bounds = sentence_data.get('bounding_boxes', [])
            
            if not sentence_bounds:
                continue
            
            # Get page layout
            sentence_page = sentence_data.get('primary_page', sentence_bounds[0].get('page', 1))
            page_layout = None
            for page in pages_layout:
                if page.get('page_num') == sentence_page:
                    page_layout = page
                    break
            
            if not page_layout:
                continue
            
            # Find elements within sentence bounds
            valid_elements = []
            for element in page_layout.get('elements', []):
                if not element.get('text') or len(element['text']) < 3:
                    continue
                
                if element_within_sentence_bounds(element, sentence_bounds):
                    valid_elements.append(element)
            
            print(f"📄 Found {len(valid_elements)} valid elements for sentence {sentence_id}")
            
            # Try word-level matching first
            sentence_boxes = []
            
            for element in valid_elements:
                if text_contains_provenance_words(element.get('text', ''), provenance_text):
                    # Try word-level boxes first
                    word_boxes = create_word_level_boxes(element, provenance_text)
                    if word_boxes:
                        print(f"   ✅ Created {len(word_boxes)} word-level boxes")
                        sentence_boxes.extend(word_boxes)
                    else:
                        # Fall back to line-aware boxes
                        line_boxes = create_line_aware_boxes(element, provenance_text)
                        if line_boxes:
                            print(f"   ✅ Created {len(line_boxes)} line-aware boxes")
                            sentence_boxes.extend(line_boxes)
            
            if sentence_boxes:
                result_boxes[sentence_id] = sentence_boxes
                print(f"✅ Created {len(sentence_boxes)} precise boxes for sentence {sentence_id}")
        
        return result_boxes
        
    except Exception as e:
        print(f"❌ Error in word-level matching: {e}")
        return {}

def find_best_sentence_match_word_level(provenance_text: str, all_sentences: List[str]) -> Optional[int]:
    """Find best sentence match for word-level highlighting"""
    norm_provenance = normalize_text_for_word_matching(provenance_text)
    
    for sentence_id, sentence_text in enumerate(all_sentences):
        norm_sentence = normalize_text_for_word_matching(sentence_text)
        
        # Check for high overlap
        if norm_provenance in norm_sentence or norm_sentence in norm_provenance:
            return sentence_id
        
        # Check word overlap
        prov_words = set(norm_provenance.split())
        sent_words = set(norm_sentence.split())
        
        if prov_words and len(prov_words & sent_words) / len(prov_words) > 0.8:
            return sentence_id
    
    return None

def text_contains_provenance_words(element_text: str, provenance_text: str) -> bool:
    """Check if element contains significant words from provenance"""
    norm_element = normalize_text_for_word_matching(element_text)
    norm_provenance = normalize_text_for_word_matching(provenance_text)
    
    if norm_provenance in norm_element:
        return True
    
    # Check word overlap
    prov_words = set(norm_provenance.split())
    elem_words = set(norm_element.split())
    
    if prov_words and len(prov_words & elem_words) / len(prov_words) > 0.6:
        return True
    
    return False

def element_within_sentence_bounds(element: Dict, sentence_bounds: List[Dict], padding: int = 10) -> bool:
    """Check if element is within sentence bounds"""
    for bound in sentence_bounds:
        if not (
            element.get('x1', 0) < bound.get('x0', 0) - padding or
            element.get('x0', 0) > bound.get('x1', 100) + padding or
            element.get('y1', 0) < bound.get('y0', 0) - padding or
            element.get('y0', 0) > bound.get('y1', 20) + padding
        ):
            return True
    return False

def debug_word_level_matching(layout_file_path: str, sentence_id: int, provenance_text: str):
    """Debug word-level matching to see exactly what gets highlighted"""
    try:
        boxes = get_word_level_provenance_boxes(layout_file_path, [sentence_id], provenance_text)
        
        if boxes and sentence_id in boxes:
            print(f"\n🎯 Word-level highlighting results:")
            print(f"   Provenance: '{provenance_text}'")
            print(f"   Found {len(boxes[sentence_id])} highlight boxes:")
            
            for i, box in enumerate(boxes[sentence_id]):
                print(f"\n   Box {i+1}:")
                print(f"     Coordinates: ({box['x0']:.1f}, {box['y0']:.1f}) → ({box['x1']:.1f}, {box['y1']:.1f})")
                print(f"     Size: {box['x1'] - box['x0']:.1f} × {box['y1'] - box['y0']:.1f}")
                print(f"     Type: {box['match_type']}")
                
                if 'word' in box:
                    print(f"     Word: '{box['word']}'")
                if 'line_text' in box:
                    print(f"     Line text: '{box['line_text']}'")
                if 'line_number' in box:
                    print(f"     Line number: {box['line_number']}")
        else:
            print(f"❌ No word-level boxes found")
            
    except Exception as e:
        print(f"❌ Error in word-level debugging: {e}")

# Test script
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        layout_file_path = sys.argv[1]
        provenance_text = 'In Proceedings of 31st European Conference on Cognitive Ergonomics (ECCE 2019), September 10-13, 2019, BELFAST, <, United Kingdom. pages.'
        
        print("🎯 Testing Word-Level Provenance Highlighting")
        print("=" * 60)
        
        debug_word_level_matching(layout_file_path, 6, provenance_text)
    else:
        print("Usage: python word_level_highlighter.py /path/to/layout.json")