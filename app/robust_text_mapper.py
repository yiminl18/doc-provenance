#!/usr/bin/env python3
"""
Robust PDF Text Mapping Algorithm
Handles the complexities of mapping PDFMiner sentences to PDF.js text items
"""

import re
import difflib
from typing import Dict, List, Optional, Tuple, Any
import logging
from dataclasses import dataclass

@dataclass
class TextMatch:
    """Represents a text match between sentence and PDF.js items"""
    confidence: float
    start_item: int
    end_item: int
    matched_items: List[Dict]
    coordinates: Dict
    match_type: str

class RobustTextMapper:
    """Advanced text mapping between PDFMiner sentences and PDF.js text items"""
    
    def __init__(self, verbose: bool = False):
        self.logger = logging.getLogger('RobustTextMapper')
        if verbose:
            self.logger.setLevel(logging.DEBUG)
        
        # Matching thresholds
        self.exact_match_threshold = 0.95
        self.fuzzy_match_threshold = 0.75
        self.word_sequence_threshold = 0.70
        self.minimum_match_threshold = 0.60
        
        # Text normalization settings
        self.preserve_numbers = True
        self.preserve_special_chars = False
        
    def map_sentence_to_pdfjs(self, sentence: Dict, pdfjs_items: List[Dict], page_num: int) -> Optional[Dict]:
        """
        Map a single sentence to PDF.js text items using multiple strategies
        
        Args:
            sentence: Sentence data with text and metadata
            pdfjs_items: List of PDF.js text items for the page
            page_num: Current page number
            
        Returns:
            Mapping dictionary or None if no good match found
        """
        sentence_text = sentence.get('text', '').strip()
        sentence_id = sentence.get('sentence_id', sentence.get('id', 0))
        
        if not sentence_text or not pdfjs_items:
            return None
        
        self.logger.debug(f"Mapping sentence {sentence_id}: '{sentence_text[:50]}...'")
        
        # Try multiple matching strategies in order of preference
        strategies = [
            ('exact_text', self._find_exact_text_match),
            ('normalized_exact', self._find_normalized_exact_match),
            ('fuzzy_sequence', self._find_fuzzy_sequence_match),
            ('word_overlap', self._find_word_overlap_match),
            ('partial_content', self._find_partial_content_match)
        ]
        
        best_match = None
        best_confidence = 0
        
        for strategy_name, strategy_func in strategies:
            try:
                match = strategy_func(sentence_text, pdfjs_items)
                
                if match and match.confidence > best_confidence and match.confidence >= self.minimum_match_threshold:
                    match.match_type = strategy_name
                    best_match = match
                    best_confidence = match.confidence
                    
                    self.logger.debug(f"Strategy '{strategy_name}' found match with confidence {match.confidence:.3f}")
                    
                    # If we found a very good match, stop trying other strategies
                    if match.confidence >= self.exact_match_threshold:
                        break
                        
            except Exception as e:
                self.logger.debug(f"Strategy '{strategy_name}' failed: {e}")
                continue
        
        if best_match:
            return self._create_sentence_mapping(
                sentence_id, 
                sentence_text, 
                best_match, 
                page_num
            )
        else:
            self.logger.debug(f"No suitable match found for sentence {sentence_id}")
            return None

    def _find_exact_text_match(self, sentence_text: str, pdfjs_items: List[Dict]) -> Optional[TextMatch]:
        """Find exact text match in PDF.js items"""
        
        # Build continuous text from PDF.js items
        continuous_text, item_map = self._build_continuous_text(pdfjs_items)
        
        # Try to find exact match
        sentence_clean = sentence_text.strip()
        
        # Try multiple variations
        variations = [
            sentence_clean,
            sentence_clean.replace('\n', ' '),
            sentence_clean.replace('\r', ''),
            re.sub(r'\s+', ' ', sentence_clean)
        ]
        
        for variation in variations:
            start_pos = continuous_text.find(variation)
            if start_pos != -1:
                end_pos = start_pos + len(variation)
                matched_items = self._get_items_for_text_range(start_pos, end_pos, item_map)
                
                if matched_items:
                    coordinates = self._calculate_coordinates_from_items(matched_items)
                    return TextMatch(
                        confidence=1.0,
                        start_item=matched_items[0]['item_index'],
                        end_item=matched_items[-1]['item_index'],
                        matched_items=matched_items,
                        coordinates=coordinates,
                        match_type='exact'
                    )
        
        return None

    def _find_normalized_exact_match(self, sentence_text: str, pdfjs_items: List[Dict]) -> Optional[TextMatch]:
        """Find exact match after text normalization"""
        
        # Normalize sentence text
        normalized_sentence = self._normalize_text(sentence_text, aggressive=False)
        
        # Build normalized continuous text
        continuous_text, item_map = self._build_continuous_text(pdfjs_items, normalize=True)
        
        start_pos = continuous_text.find(normalized_sentence)
        if start_pos != -1:
            end_pos = start_pos + len(normalized_sentence)
            matched_items = self._get_items_for_text_range(start_pos, end_pos, item_map)
            
            if matched_items:
                coordinates = self._calculate_coordinates_from_items(matched_items)
                return TextMatch(
                    confidence=0.95,
                    start_item=matched_items[0]['item_index'],
                    end_item=matched_items[-1]['item_index'],
                    matched_items=matched_items,
                    coordinates=coordinates,
                    match_type='normalized_exact'
                )
        
        return None

    def _find_fuzzy_sequence_match(self, sentence_text: str, pdfjs_items: List[Dict]) -> Optional[TextMatch]:
        """Find fuzzy sequence match using difflib"""
        
        # Normalize texts
        normalized_sentence = self._normalize_text(sentence_text, aggressive=True)
        continuous_text, item_map = self._build_continuous_text(pdfjs_items, normalize=True, aggressive=True)
        
        # Use difflib to find similar sequences
        matcher = difflib.SequenceMatcher(None, normalized_sentence, continuous_text)
        
        # Find the longest matching subsequence
        match = matcher.find_longest_match(0, len(normalized_sentence), 0, len(continuous_text))
        
        if match.size > 0:
            # Calculate similarity ratio
            similarity = match.size / len(normalized_sentence)
            
            if similarity >= self.fuzzy_match_threshold:
                start_pos = match.b
                end_pos = match.b + match.size
                matched_items = self._get_items_for_text_range(start_pos, end_pos, item_map)
                
                if matched_items:
                    coordinates = self._calculate_coordinates_from_items(matched_items)
                    return TextMatch(
                        confidence=similarity,
                        start_item=matched_items[0]['item_index'],
                        end_item=matched_items[-1]['item_index'],
                        matched_items=matched_items,
                        coordinates=coordinates,
                        match_type='fuzzy_sequence'
                    )
        
        return None

    def _find_word_overlap_match(self, sentence_text: str, pdfjs_items: List[Dict]) -> Optional[TextMatch]:
        """Find match based on word overlap"""
        
        # Extract significant words from sentence
        sentence_words = self._extract_significant_words(sentence_text)
        if len(sentence_words) < 3:  # Need at least 3 significant words
            return None
        
        # Build word map from PDF.js items
        word_items = self._build_word_item_map(pdfjs_items)
        
        # Find best sequence of overlapping words
        best_sequence = self._find_best_word_sequence(sentence_words, word_items)
        
        if best_sequence and best_sequence['confidence'] >= self.word_sequence_threshold:
            matched_items = best_sequence['items']
            coordinates = self._calculate_coordinates_from_items(matched_items)
            
            return TextMatch(
                confidence=best_sequence['confidence'],
                start_item=matched_items[0]['item_index'],
                end_item=matched_items[-1]['item_index'],
                matched_items=matched_items,
                coordinates=coordinates,
                match_type='word_overlap'
            )
        
        return None

    def _find_partial_content_match(self, sentence_text: str, pdfjs_items: List[Dict]) -> Optional[TextMatch]:
        """Find match for partial content (useful for cut-off sentences)"""
        
        # Try matching with different portions of the sentence
        sentence_words = sentence_text.split()
        
        if len(sentence_words) < 5:
            return None  # Too short for partial matching
        
        # Try different substring lengths
        for start_pct in [0, 0.1, 0.2]:
            for end_pct in [0.8, 0.9, 1.0]:
                start_idx = int(len(sentence_words) * start_pct)
                end_idx = int(len(sentence_words) * end_pct)
                
                if end_idx - start_idx < 3:
                    continue
                
                partial_sentence = ' '.join(sentence_words[start_idx:end_idx])
                
                # Try exact match with this partial sentence
                match = self._find_exact_text_match(partial_sentence, pdfjs_items)
                if match:
                    # Adjust confidence based on how much of the sentence we matched
                    coverage = (end_idx - start_idx) / len(sentence_words)
                    match.confidence *= coverage
                    match.match_type = 'partial_content'
                    
                    if match.confidence >= self.minimum_match_threshold:
                        return match
        
        return None

    def _build_continuous_text(self, pdfjs_items: List[Dict], normalize: bool = False, aggressive: bool = False) -> Tuple[str, List[Dict]]:
        """Build continuous text from PDF.js items with position mapping"""
        
        continuous_text = ""
        item_map = []
        
        for i, item in enumerate(pdfjs_items):
            item_text = item.get('str', '')
            
            if normalize:
                item_text = self._normalize_text(item_text, aggressive=aggressive)
            
            start_pos = len(continuous_text)
            
            # Add the text
            continuous_text += item_text
            
            # Add space if item doesn't end the line
            if not item.get('hasEOL', False) and item_text and not item_text.endswith(' '):
                continuous_text += ' '
            
            end_pos = len(continuous_text)
            
            # Record position mapping
            item_map.append({
                'item_index': i,
                'start_pos': start_pos,
                'end_pos': end_pos,
                'original_item': item,
                'text': item_text
            })
        
        return continuous_text, item_map

    def _normalize_text(self, text: str, aggressive: bool = False) -> str:
        """Normalize text for comparison"""
        
        # Basic normalization
        normalized = text.lower().strip()
        
        # Replace multiple whitespaces with single space
        normalized = re.sub(r'\s+', ' ', normalized)
        
        # Remove line breaks
        normalized = normalized.replace('\n', ' ').replace('\r', ' ')
        
        if aggressive:
            # More aggressive normalization for fuzzy matching
            if not self.preserve_numbers:
                normalized = re.sub(r'\d+', '', normalized)
            
            if not self.preserve_special_chars:
                # Keep only alphanumeric characters and spaces
                normalized = re.sub(r'[^a-z0-9\s]', '', normalized)
            else:
                # Keep some punctuation but remove others
                normalized = re.sub(r'[^\w\s\-\.\,\:\;\!\?]', '', normalized)
        
        return normalized.strip()

    def _extract_significant_words(self, text: str) -> List[str]:
        """Extract significant words from text (filter out stop words, short words)"""
        
        # Basic stop words list
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
        }
        
        words = self._normalize_text(text, aggressive=False).split()
        
        significant_words = []
        for word in words:
            # Filter out stop words and very short words
            if (len(word) >= 3 and 
                word not in stop_words and 
                not word.isdigit() and
                re.match(r'^[a-zA-Z0-9\-]+$', word)):
                significant_words.append(word)
        
        return significant_words

    def _build_word_item_map(self, pdfjs_items: List[Dict]) -> List[Dict]:
        """Build map of words to their source items"""
        
        word_items = []
        
        for i, item in enumerate(pdfjs_items):
            item_text = self._normalize_text(item.get('str', ''), aggressive=False)
            words = item_text.split()
            
            for word in words:
                if len(word) >= 2:  # Skip very short words
                    word_items.append({
                        'word': word,
                        'item_index': i,
                        'original_item': item
                    })
        
        return word_items

    def _find_best_word_sequence(self, target_words: List[str], word_items: List[Dict]) -> Optional[Dict]:
        """Find the best sequence of words in the PDF.js items"""
        
        if not target_words or not word_items:
            return None
        
        best_sequence = None
        best_score = 0
        
        # Try different starting positions
        for start_idx in range(len(word_items)):
            sequence = self._match_word_sequence_from_position(target_words, word_items, start_idx)
            
            if sequence and sequence['confidence'] > best_score:
                best_sequence = sequence
                best_score = sequence['confidence']
        
        return best_sequence

    def _match_word_sequence_from_position(self, target_words: List[str], word_items: List[Dict], start_idx: int) -> Optional[Dict]:
        """Try to match word sequence starting from a specific position"""
        
        matched_items = []
        word_matches = 0
        current_idx = start_idx
        
        for target_word in target_words:
            # Look for this word in the next few items
            found = False
            
            for look_ahead in range(5):  # Look ahead up to 5 items
                if current_idx + look_ahead >= len(word_items):
                    break
                
                candidate_word = word_items[current_idx + look_ahead]['word']
                
                # Check for exact match or high similarity
                if (candidate_word == target_word or 
                    difflib.SequenceMatcher(None, target_word, candidate_word).ratio() > 0.8):
                    
                    matched_items.append(word_items[current_idx + look_ahead])
                    word_matches += 1
                    current_idx = current_idx + look_ahead + 1
                    found = True
                    break
            
            if not found:
                # Allow some words to be missing, but penalize
                current_idx += 1
        
        if word_matches >= len(target_words) * 0.7:  # Matched at least 70% of words
            confidence = word_matches / len(target_words)
            
            # Convert word items back to PDF.js items
            unique_items = []
            seen_indices = set()
            
            for word_item in matched_items:
                item_idx = word_item['item_index']
                if item_idx not in seen_indices:
                    unique_items.append({
                        'item_index': item_idx,
                        **word_item['original_item']
                    })
                    seen_indices.add(item_idx)
            
            return {
                'confidence': confidence,
                'items': sorted(unique_items, key=lambda x: x['item_index'])
            }
        
        return None

    def _get_items_for_text_range(self, start_pos: int, end_pos: int, item_map: List[Dict]) -> List[Dict]:
        """Get PDF.js items that overlap with a text range"""
        
        matching_items = []
        
        for item_info in item_map:
            # Check if item overlaps with the range
            if (item_info['start_pos'] < end_pos and item_info['end_pos'] > start_pos):
                matching_items.append({
                    'item_index': item_info['item_index'],
                    **item_info['original_item']
                })
        
        return matching_items

    def _calculate_coordinates_from_items(self, matched_items: List[Dict]) -> Dict:
        """Calculate bounding box coordinates from matched PDF.js items"""
        
        if not matched_items:
            return {}
        
        # Extract coordinates from transform matrices
        left_coords = []
        top_coords = []
        right_coords = []
        bottom_coords = []
        
        for item in matched_items:
            transform = item.get('transform', [1, 0, 0, 1, 0, 0])
            width = item.get('width', 0)
            height = item.get('height', 0)
            
            # PDF.js transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
            x = transform[4] if len(transform) > 4 else 0
            y = transform[5] if len(transform) > 5 else 0
            
            left_coords.append(x)
            top_coords.append(y)
            right_coords.append(x + width)
            bottom_coords.append(y + height)
        
        if left_coords and top_coords:
            return {
                'left': min(left_coords),
                'top': min(top_coords),
                'width': max(right_coords) - min(left_coords),
                'height': max(bottom_coords) - min(top_coords)
            }
        
        return {}

    def _create_sentence_mapping(self, sentence_id: int, sentence_text: str, match: TextMatch, page_num: int) -> Dict:
        """Create the final sentence mapping dictionary"""
        
        return {
            'sentence_id': sentence_id,
            'original_text': sentence_text,
            'highlight_regions': [{
                'page': page_num,
                'left': match.coordinates.get('left', 0),
                'top': match.coordinates.get('top', 0),
                'width': match.coordinates.get('width', 100),
                'height': match.coordinates.get('height', 15),
                'confidence': match.confidence,
                'match_type': match.match_type
            }],
            'match_confidence': match.confidence,
            'fallback_coordinates': None,
            'match_details': {
                'start_item': match.start_item,
                'end_item': match.end_item,
                'total_items': len(match.matched_items),
                'strategy': match.match_type
            }
        }

# Integration function for the pipeline
def create_robust_mapper(verbose: bool = False) -> RobustTextMapper:
    """Factory function to create a robust text mapper"""
    return RobustTextMapper(verbose=verbose)