#!/usr/bin/env python3
"""
Enhanced PDFMiner-to-PDF.js mapper with improved multi-line text handling
"""

import re
import nltk
import difflib
from typing import Dict, List, Optional, Tuple, Any
import logging
from dataclasses import dataclass

# Download required NLTK data if not present
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

class PDFMinerToPDFJSMapper:
    """
    Enhanced mapper with improved multi-line text support and bounding box calculations
    """
    
    def __init__(self, verbose: bool = False):
        self.logger = logging.getLogger('PDFMinerToPDFJSMapper')
        if verbose:
            self.logger.setLevel(logging.DEBUG)
        else:
            self.logger.setLevel(logging.INFO)
        
        # Add handler if none exists
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
        
        # Confidence thresholds
        self.high_confidence_threshold = 0.90
        self.medium_confidence_threshold = 0.75
        self.low_confidence_threshold = 0.60
        
    def create_full_document_mapping(self, pdf_path: str, pdfminer_sentences: List[str], pdfjs_pages_data: List[Dict]) -> Dict:
        """
        Create comprehensive mapping between PDFMiner sentences and PDF.js items
        """
        
        self.logger.info(f"Creating enhanced mapping for {len(pdfminer_sentences)} sentences across {len(pdfjs_pages_data)} pages")
        
        # Step 1: Reconstruct the full PDFMiner text
        full_pdfminer_text = self._reconstruct_full_text_from_sentences(pdfminer_sentences)
        
        # Step 2: Build full PDF.js text with position tracking
        full_pdfjs_text, pdfjs_text_map = self._build_full_pdfjs_text_with_positions(pdfjs_pages_data)
        
        # Step 3: Find sentence positions using enhanced strategies
        sentence_positions = self._find_sentence_positions_in_full_text(pdfminer_sentences, full_pdfminer_text, full_pdfjs_text)
        
        # Step 4: Create enhanced page mappings with improved bounding boxes
        page_mappings = self._create_enhanced_page_mappings(sentence_positions, pdfjs_text_map, pdfjs_pages_data)
        
        return page_mappings
    
    def _reconstruct_full_text_from_sentences(self, sentences: List[str]) -> str:
        """Reconstruct full text from sentences"""
        full_text = ". ".join(sentences)
        if not full_text.endswith('.'):
            full_text += "."
        
        self.logger.debug(f"Reconstructed text length: {len(full_text)} characters")
        return full_text
    
    def _build_full_pdfjs_text_with_positions(self, pdfjs_pages_data: List[Dict]) -> Tuple[str, List[Dict]]:
        """Build continuous text from PDF.js pages with enhanced position tracking"""
        
        full_text = ""
        position_map = []
        
        for page_num, page_data in enumerate(pdfjs_pages_data, 1):
            items = page_data.get('items', [])
            
            for item_idx, item in enumerate(items):
                text_start = len(full_text)
                item_text = item.get('str', '')
                
                # Add the text
                full_text += item_text
                
                # Smart spacing - add space if needed
                if not item.get('hasEOL', False) and item_text and not item_text.endswith(' '):
                    full_text += ' '
                
                text_end = len(full_text)
                
                # Enhanced coordinate extraction
                transform = item.get('transform', [1, 0, 0, 1, 0, 0])
                coordinates = {
                    'left': transform[4] if len(transform) > 4 else 0,
                    'top': transform[5] if len(transform) > 5 else 0,
                    'width': item.get('width', 0),
                    'height': item.get('height', 0),
                    'font_size': self._extract_font_size(transform),
                    'font_name': item.get('fontName', 'default')
                }
                
                position_map.append({
                    'page': page_num,
                    'item_index': item_idx,
                    'text_start': text_start,
                    'text_end': text_end,
                    'original_text': item_text,
                    'coordinates': coordinates,
                    'original_item': item,
                    'has_eol': item.get('hasEOL', False)
                })
        
        self.logger.debug(f"Built PDF.js text: {len(full_text)} characters, {len(position_map)} items")
        return full_text, position_map
    
    def _extract_font_size(self, transform: List[float]) -> float:
        """Extract font size from transform matrix"""
        if len(transform) >= 4:
            # Font size is typically the scale factor
            return abs(transform[0]) if transform[0] != 0 else abs(transform[3])
        return 12.0  # Default font size
    
    def _find_sentence_positions_in_full_text(self, sentences: List[str], pdfminer_text: str, pdfjs_text: str) -> List[Dict]:
        """Enhanced sentence position finding with multiple strategies"""
        
        sentence_positions = []
        alignment_offset = self._find_text_alignment_offset(pdfminer_text, pdfjs_text)
        current_search_start = 0
        
        for sent_idx, sentence in enumerate(sentences):
            self.logger.debug(f"Finding position for sentence {sent_idx}: '{sentence[:50]}...'")
            
            position_info = self._find_single_sentence_position(
                sentence, 
                sent_idx,
                pdfjs_text, 
                current_search_start,
                alignment_offset
            )
            
            if position_info:
                sentence_positions.append(position_info)
                current_search_start = position_info['end_pos'] + 1
                self.logger.debug(f"✅ Found sentence {sent_idx} at positions {position_info['start_pos']}-{position_info['end_pos']}")
            else:
                self.logger.warning(f"❌ Could not find position for sentence {sent_idx}")
                sentence_positions.append({
                    'sentence_index': sent_idx,
                    'sentence_text': sentence,
                    'start_pos': -1,
                    'end_pos': -1,
                    'confidence': 0.0,
                    'match_type': 'not_found'
                })
        
        success_count = sum(1 for pos in sentence_positions if pos['start_pos'] >= 0)
        self.logger.info(f"Successfully positioned {success_count}/{len(sentences)} sentences")
        
        return sentence_positions
    
    def _find_text_alignment_offset(self, pdfminer_text: str, pdfjs_text: str) -> int:
        """Find alignment offset between texts"""
        norm_pdfminer = self._normalize_for_alignment(pdfminer_text)
        norm_pdfjs = self._normalize_for_alignment(pdfjs_text)
        
        matcher = difflib.SequenceMatcher(None, norm_pdfminer, norm_pdfjs)
        match = matcher.find_longest_match(0, len(norm_pdfminer), 0, len(norm_pdfjs))
        
        if match.size > 100:
            offset = match.b - match.a
            self.logger.debug(f"Found alignment match of {match.size} characters, offset: {offset}")
            return offset
        
        return 0
    
    def _normalize_for_alignment(self, text: str) -> str:
        """Enhanced text normalization"""
        try:
            if isinstance(text, bytes):
                text = text.decode('utf-8', errors='ignore')
            
            # Remove extra whitespace and normalize
            normalized = re.sub(r'\s+', ' ', text.lower().strip())
            
            # Remove punctuation that might differ
            normalized = re.sub(r'[^\w\s]', '', normalized)
            
            # Remove non-printable characters
            normalized = ''.join(char for char in normalized if char.isprintable() or char.isspace())
            
            return normalized
            
        except Exception as e:
            self.logger.debug(f"Error normalizing text: {e}")
            return re.sub(r'\s+', ' ', str(text).lower().strip())
    
    def _find_single_sentence_position(self, sentence: str, sent_idx: int, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Enhanced single sentence position finding"""
        
        strategies = [
            ('exact_match', self._find_exact_match),
            ('normalized_match', self._find_normalized_match),
            ('fuzzy_match', self._find_fuzzy_match),
            ('word_sequence_match', self._find_word_sequence_match),
            ('partial_match', self._find_partial_match)
        ]
        
        for strategy_name, strategy_func in strategies:
            try:
                result = strategy_func(sentence, full_text, search_start, alignment_offset)
                
                if result and result['confidence'] >= self.low_confidence_threshold:
                    result['sentence_index'] = sent_idx
                    result['sentence_text'] = sentence
                    result['match_type'] = strategy_name
                    
                    self.logger.debug(f"Strategy '{strategy_name}' succeeded for sentence {sent_idx} with confidence {result['confidence']:.3f}")
                    return result
                    
            except Exception as e:
                self.logger.debug(f"Strategy '{strategy_name}' failed for sentence {sent_idx}: {e}")
                continue
        
        return None
    
    def _find_exact_match(self, sentence: str, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Find exact text match"""
        clean_sentence = sentence.strip()
        
        pos = full_text.find(clean_sentence, search_start)
        if pos >= 0:
            return {
                'start_pos': pos,
                'end_pos': pos + len(clean_sentence),
                'confidence': 1.0
            }
        
        # Try with normalized whitespace
        normalized_sentence = re.sub(r'\s+', ' ', clean_sentence)
        pos = full_text.find(normalized_sentence, search_start)
        
        if pos >= 0:
            return {
                'start_pos': pos,
                'end_pos': pos + len(normalized_sentence),
                'confidence': 0.95
            }
        
        return None
    
    def _find_normalized_match(self, sentence: str, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Find match after normalization"""
        norm_sentence = self._normalize_for_alignment(sentence)
        norm_full_text = self._normalize_for_alignment(full_text)
        
        pos = norm_full_text.find(norm_sentence, max(0, search_start + alignment_offset))
        
        if pos >= 0:
            original_pos = max(0, pos - alignment_offset)
            return {
                'start_pos': original_pos,
                'end_pos': original_pos + len(sentence),
                'confidence': 0.90
            }
        
        return None
    
    def _find_fuzzy_match(self, sentence: str, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Enhanced fuzzy matching"""
        norm_sentence = self._normalize_for_alignment(sentence)
        
        window_start = max(0, search_start)
        window_end = min(len(full_text), search_start + len(sentence) * 3)
        search_window = full_text[window_start:window_end]
        norm_window = self._normalize_for_alignment(search_window)
        
        matcher = difflib.SequenceMatcher(None, norm_sentence, norm_window)
        match = matcher.find_longest_match(0, len(norm_sentence), 0, len(norm_window))
        
        if match.size > len(norm_sentence) * 0.7:
            confidence = match.size / len(norm_sentence)
            
            if confidence >= self.low_confidence_threshold:
                start_pos = window_start + match.b
                end_pos = start_pos + match.size
                
                return {
                    'start_pos': start_pos,
                    'end_pos': end_pos,
                    'confidence': confidence
                }
        
        return None
    
    def _find_word_sequence_match(self, sentence: str, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Find match based on word sequence"""
        sentence_words = self._extract_significant_words(sentence)
        
        if len(sentence_words) < 3:
            return None
        
        window_start = max(0, search_start)
        window_end = min(len(full_text), search_start + len(sentence) * 4)
        search_text = full_text[window_start:window_end]
        
        best_match = self._find_word_sequence_in_text(sentence_words, search_text)
        
        if best_match and best_match['confidence'] >= self.low_confidence_threshold:
            return {
                'start_pos': window_start + best_match['start'],
                'end_pos': window_start + best_match['end'],
                'confidence': best_match['confidence']
            }
        
        return None
    
    def _find_partial_match(self, sentence: str, full_text: str, search_start: int, alignment_offset: int) -> Optional[Dict]:
        """Find partial sentence matches"""
        words = sentence.split()
        if len(words) < 5:
            return None
        
        for start_pct in [0, 0.1]:
            for end_pct in [0.8, 0.9, 1.0]:
                start_idx = int(len(words) * start_pct)
                end_idx = int(len(words) * end_pct)
                
                if end_idx - start_idx < 3:
                    continue
                
                partial_sentence = ' '.join(words[start_idx:end_idx])
                pos = full_text.find(partial_sentence, search_start)
                
                if pos >= 0:
                    coverage = (end_idx - start_idx) / len(words)
                    confidence = coverage * 0.85
                    
                    if confidence >= self.low_confidence_threshold:
                        return {
                            'start_pos': pos,
                            'end_pos': pos + len(partial_sentence),
                            'confidence': confidence
                        }
        
        return None
    
    def _extract_significant_words(self, text: str) -> List[str]:
        """Extract significant words for matching"""
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
        words = re.findall(r'\b\w{3,}\b', text.lower())
        significant_words = [w for w in words if w not in stop_words]
        return significant_words[:10]
    
    def _find_word_sequence_in_text(self, words: List[str], text: str) -> Optional[Dict]:
        """Find word sequence in text"""
        text_lower = text.lower()
        found_positions = []
        
        for word in words:
            pos = text_lower.find(word)
            if pos >= 0:
                found_positions.append((word, pos, pos + len(word)))
        
        if len(found_positions) >= len(words) * 0.7:
            start_pos = min(pos[1] for pos in found_positions)
            end_pos = max(pos[2] for pos in found_positions)
            confidence = len(found_positions) / len(words)
            
            return {
                'start': start_pos,
                'end': end_pos,
                'confidence': confidence
            }
        
        return None
    
    def _create_enhanced_page_mappings(self, sentence_positions: List[Dict], pdfjs_text_map: List[Dict], pdfjs_pages_data: List[Dict]) -> Dict:
        """Create enhanced page mappings with improved multi-line support"""
        
        page_mappings = {}
        
        for position_info in sentence_positions:
            if position_info['start_pos'] < 0:
                continue
            
            sent_idx = position_info['sentence_index']
            start_pos = position_info['start_pos']
            end_pos = position_info['end_pos']
            
            # Find overlapping PDF.js items
            overlapping_items = []
            for item_info in pdfjs_text_map:
                if (item_info['text_start'] < end_pos and item_info['text_end'] > start_pos):
                    overlapping_items.append(item_info)
            
            if overlapping_items:
                # Sort items by position
                overlapping_items.sort(key=lambda x: (x['page'], x['text_start']))
                
                # Group by page
                pages_touched = {}
                for item in overlapping_items:
                    page = item['page']
                    if page not in pages_touched:
                        pages_touched[page] = []
                    pages_touched[page].append(item)
                
                # Create enhanced mappings for each page
                for page, page_items in pages_touched.items():
                    if page not in page_mappings:
                        page_mappings[page] = {}
                    
                    # Create enhanced highlight regions
                    regions = self._create_enhanced_highlight_regions(page_items, page, position_info)
                    
                    page_mappings[page][sent_idx] = {
                        'sentence_id': sent_idx,
                        'original_text': position_info['sentence_text'],
                        'highlight_regions': regions,
                        'match_confidence': position_info['confidence'],
                        'text_span_info': {
                            'total_items': len(page_items),
                            'text_start': min(item['text_start'] for item in page_items),
                            'text_end': max(item['text_end'] for item in page_items),
                            'pages_spanned': len(pages_touched)
                        },
                        'fallback_coordinates': None
                    }
        
        self.logger.info(f"Created enhanced mappings for {len(page_mappings)} pages")
        return page_mappings
    
    def _create_enhanced_highlight_regions(self, page_items: List[Dict], page: int, position_info: Dict) -> List[Dict]:
        """Enhanced highlight region creation with proper multi-line support"""
        
        if not page_items:
            return []
        
        # Sort items by position
        sorted_items = sorted(page_items, key=lambda x: (x['coordinates']['top'], x['coordinates']['left']))
        
        # Detect lines using font size and position
        lines = self._group_items_by_line(sorted_items)
        
        self.logger.debug(f"Sentence {position_info['sentence_index']} spans {len(lines)} lines")
        
        if len(lines) == 1:
            # Single line - simple bounding box
            coordinates = self._calculate_enhanced_bounding_box(page_items)
            return [{
                'page': page,
                'left': coordinates['left'],
                'top': coordinates['top'],
                'width': coordinates['width'],
                'height': coordinates['height'],
                'confidence': position_info['confidence'],
                'match_type': position_info['match_type']
            }]
        else:
            # Multi-line - enhanced bounding box covering all lines
            coordinates = self._calculate_enhanced_bounding_box(page_items)
            
            # Ensure proper coverage from first line top to last line bottom
            first_line_top = min(item['coordinates']['top'] for item in lines[0])
            last_line_items = lines[-1]
            last_line_bottom = max(
                item['coordinates']['top'] + item['coordinates']['height'] 
                for item in last_line_items
            )
            
            # Calculate comprehensive bounds
            all_lefts = [item['coordinates']['left'] for line in lines for item in line]
            all_rights = [
                item['coordinates']['left'] + item['coordinates']['width'] 
                for line in lines for item in line
            ]
            
            enhanced_coordinates = {
                'left': min(all_lefts),
                'top': first_line_top,
                'width': max(all_rights) - min(all_lefts),
                'height': last_line_bottom - first_line_top
            }
            
            self.logger.debug(f"Enhanced multi-line region: {enhanced_coordinates}")
            
            return [{
                'page': page,
                'left': enhanced_coordinates['left'],
                'top': enhanced_coordinates['top'],
                'width': enhanced_coordinates['width'],
                'height': enhanced_coordinates['height'],
                'confidence': position_info['confidence'],
                'match_type': f"{position_info['match_type']}_multiline"
            }]
    
    def _group_items_by_line(self, sorted_items: List[Dict]) -> List[List[Dict]]:
        """Group PDF.js items by line using enhanced heuristics"""
        
        if not sorted_items:
            return []
        
        lines = []
        current_line = [sorted_items[0]]
        
        # Use font size for line tolerance
        base_font_size = sorted_items[0]['coordinates'].get('font_size', 12)
        line_tolerance = base_font_size * 0.5
        
        for item in sorted_items[1:]:
            current_top = item['coordinates']['top']
            line_top = current_line[0]['coordinates']['top']
            
            # Also consider font size consistency
            item_font_size = item['coordinates'].get('font_size', 12)
            font_size_diff = abs(item_font_size - base_font_size)
            
            if (abs(current_top - line_top) <= line_tolerance and 
                font_size_diff <= base_font_size * 0.2):  # Allow 20% font size variation
                current_line.append(item)
            else:
                lines.append(current_line)
                current_line = [item]
                base_font_size = item_font_size
                line_tolerance = base_font_size * 0.5
        
        lines.append(current_line)
        return lines
    
    def _calculate_enhanced_bounding_box(self, items: List[Dict]) -> Dict:
        """Enhanced bounding box calculation with proper multi-line support"""
        
        if not items:
            return {'left': 0, 'top': 0, 'width': 100, 'height': 20}
        
        # Collect all coordinates
        left_coords = []
        top_coords = []
        right_coords = []
        bottom_coords = []
        line_heights = []
        
        for item in items:
            coords = item['coordinates']
            left = coords['left']
            top = coords['top']
            width = coords['width']
            height = coords['height']
            
            right = left + width
            bottom = top + height
            
            left_coords.append(left)
            top_coords.append(top)
            right_coords.append(right)
            bottom_coords.append(bottom)
            line_heights.append(height)
        
        # Basic bounds
        min_left = min(left_coords)
        min_top = min(top_coords)
        max_right = max(right_coords)
        max_bottom = max(bottom_coords)
        
        # Enhanced height calculation for multi-line text
        unique_tops = sorted(set(top_coords))
        
        if len(unique_tops) > 1:
            # Multi-line: ensure adequate height coverage
            total_height = max_bottom - min_top
            avg_line_height = sum(line_heights) / len(line_heights)
            min_expected_height = len(unique_tops) * avg_line_height
            
            # Use the larger of calculated or expected height
            final_height = max(total_height, min_expected_height)
            
            self.logger.debug(f"Enhanced multi-line calculation:")
            self.logger.debug(f"  Lines: {len(unique_tops)}, Height: {total_height:.2f} → {final_height:.2f}")
            
        else:
            # Single line
            final_height = max_bottom - min_top
        
        return {
            'left': min_left,
            'top': min_top,
            'width': max_right - min_left,
            'height': final_height
        }


# Factory function for compatibility
def create_pdfminer_mapper(verbose: bool = False) -> PDFMinerToPDFJSMapper:
    """Factory function to create enhanced PDFMiner-to-PDF.js mapper"""
    return PDFMinerToPDFJSMapper(verbose=verbose)