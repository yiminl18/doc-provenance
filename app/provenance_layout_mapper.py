import json
import re
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional, Tuple
import logging

class ProvenanceLayoutMapper:
    """
    Specialized layout mapper focused on high-accuracy provenance highlighting
    """
    
    def __init__(self, layout_data_path: str, debug: bool = False):
        """
        Initialize with layout data from your preprocessing pipeline
        
        Args:
            layout_data_path: Path to the _layout.json file
            debug: Enable debug logging
        """
        self.debug = debug
        self.logger = self._setup_logger()
        
        with open(layout_data_path, 'r', encoding='utf-8') as f:
            self.layout_data = json.load(f)
        
        self.sentences = self.layout_data['sentences']
        self.pages_layout = self.layout_data['pages_layout']
        
        # Build lookup indices for faster searching
        self._build_lookup_indices()
        
        self.logger.info(f"Initialized ProvenanceLayoutMapper with {len(self.sentences)} sentences")
    
    def _setup_logger(self):
        """Setup logging for debugging"""
        logger = logging.getLogger('ProvenanceMapper')
        if self.debug and not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(name)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)
        return logger
    
    def _build_lookup_indices(self):
        """Build indices for faster text searching"""
        self.text_to_elements = {}
        self.word_to_elements = {}
        
        for page_data in self.pages_layout:
            for element in page_data.get('elements', []):
                clean_text = self._clean_text(element['text'])
                
                # Index by full text
                if clean_text:
                    if clean_text not in self.text_to_elements:
                        self.text_to_elements[clean_text] = []
                    self.text_to_elements[clean_text].append(element)
                    
                    # Index by words
                    for word in clean_text.split():
                        if len(word) > 2:  # Skip very short words
                            if word not in self.word_to_elements:
                                self.word_to_elements[word] = []
                            self.word_to_elements[word].append(element)
    
    def get_provenance_bounding_boxes(self, sentence_ids: List[int]) -> Dict[int, List[Dict]]:
        """
        Get high-confidence bounding boxes for provenance sentences
        
        Args:
            sentence_ids: List of sentence IDs that need highlighting
            
        Returns:
            Dict mapping sentence_id to list of bounding boxes with confidence scores
        """
        self.logger.info(f"Getting provenance boxes for {len(sentence_ids)} sentences")
        
        provenance_boxes = {}
        
        for sentence_id in sentence_ids:
            if sentence_id >= len(self.sentences):
                self.logger.warning(f"Sentence ID {sentence_id} out of range")
                continue
            
            sentence_data = self.sentences[sentence_id]
            sentence_text = sentence_data['text']
            
            self.logger.debug(f"Processing sentence {sentence_id}: {sentence_text[:50]}...")
            
            # Try multiple strategies in order of confidence
            boxes = self._get_best_boxes_for_sentence(sentence_text, sentence_id)
            
            if boxes:
                provenance_boxes[sentence_id] = boxes
                self.logger.debug(f"Found {len(boxes)} boxes for sentence {sentence_id}")
            else:
                self.logger.warning(f"No reliable boxes found for sentence {sentence_id}")
        
        return provenance_boxes
    
    def _get_best_boxes_for_sentence(self, sentence_text: str, sentence_id: int) -> List[Dict]:
        """Get the best possible bounding boxes for a single sentence"""
        
        # Strategy 1: Exact substring matching (highest confidence)
        exact_boxes = self._find_exact_substring_matches(sentence_text)
        if exact_boxes:
            self.logger.debug(f"Sentence {sentence_id}: Found exact substring matches")
            return self._filter_and_score_boxes(exact_boxes, sentence_text, 'exact_match')
        
        # Strategy 2: High-confidence word sequence matching
        sequence_boxes = self._find_word_sequence_matches(sentence_text)
        if sequence_boxes:
            self.logger.debug(f"Sentence {sentence_id}: Found word sequence matches")
            return self._filter_and_score_boxes(sequence_boxes, sentence_text, 'sequence_match')
        
        # Strategy 3: Use existing layout mapping if high confidence
        existing_boxes = self._get_existing_high_confidence_boxes(sentence_id)
        if existing_boxes:
            self.logger.debug(f"Sentence {sentence_id}: Using existing high-confidence boxes")
            return existing_boxes
        
        # Strategy 4: Fuzzy matching with validation
        fuzzy_boxes = self._find_fuzzy_matches(sentence_text)
        if fuzzy_boxes:
            self.logger.debug(f"Sentence {sentence_id}: Found fuzzy matches")
            return self._filter_and_score_boxes(fuzzy_boxes, sentence_text, 'fuzzy_match')
        
        # Strategy 5: Fallback positioning estimate
        fallback_boxes = self._estimate_position_from_context(sentence_text, sentence_id)
        if fallback_boxes:
            self.logger.debug(f"Sentence {sentence_id}: Using fallback positioning")
            return fallback_boxes
        
        return []
    
    def _find_exact_substring_matches(self, sentence_text: str) -> List[Dict]:
        """Find layout elements that contain exact substrings of the sentence"""
        clean_sentence = self._clean_text(sentence_text)
        exact_matches = []
        
        for page_data in self.pages_layout:
            for element in page_data.get('elements', []):
                clean_element = self._clean_text(element['text'])
                
                # Check for exact substring matches
                if clean_sentence in clean_element or clean_element in clean_sentence:
                    match_ratio = min(len(clean_sentence), len(clean_element)) / max(len(clean_sentence), len(clean_element))
                    
                    if match_ratio > 0.7:  # High overlap requirement
                        exact_matches.append({
                            **element,
                            'match_confidence': 0.95 * match_ratio,
                            'match_type': 'exact_substring',
                            'coverage_ratio': match_ratio
                        })
        
        return exact_matches
    
    def _find_word_sequence_matches(self, sentence_text: str) -> List[Dict]:
        """Find elements that match significant word sequences from the sentence"""
        clean_sentence = self._clean_text(sentence_text)
        sentence_words = clean_sentence.split()
        
        if len(sentence_words) < 4:  # Too short for reliable sequence matching
            return []
        
        sequence_matches = []
        
        # Generate important word sequences (3-6 words)
        important_sequences = []
        for seq_len in [6, 5, 4, 3]:
            for i in range(len(sentence_words) - seq_len + 1):
                sequence = ' '.join(sentence_words[i:i+seq_len])
                if len(sequence) > 15:  # Only meaningful sequences
                    important_sequences.append(sequence)
        
        for page_data in self.pages_layout:
            for element in page_data.get('elements', []):
                clean_element = self._clean_text(element['text'])
                
                # Check how many important sequences are found
                matches = 0
                total_matched_length = 0
                
                for sequence in important_sequences[:10]:  # Check top 10 sequences
                    if sequence in clean_element:
                        matches += 1
                        total_matched_length += len(sequence)
                
                # Require multiple sequence matches
                if matches >= 2:
                    coverage = total_matched_length / len(clean_sentence)
                    confidence = min(0.9, (matches / 5) * coverage)
                    
                    sequence_matches.append({
                        **element,
                        'match_confidence': confidence,
                        'match_type': 'word_sequence',
                        'sequence_matches': matches,
                        'coverage_ratio': coverage
                    })
        
        return sequence_matches
    
    def _get_existing_high_confidence_boxes(self, sentence_id: int) -> List[Dict]:
        """Extract high-confidence boxes from existing layout mapping"""
        if sentence_id >= len(self.sentences):
            return []
        
        sentence_data = self.sentences[sentence_id]
        existing_boxes = sentence_data.get('bounding_boxes', [])
        
        # Only use boxes with high confidence and good match types
        high_conf_boxes = []
        for box in existing_boxes:
            confidence = box.get('confidence', 0)
            match_type = box.get('match_type', '')
            
            # Strict criteria for existing boxes
            if (confidence > 0.8 and 
                match_type in ['exact_substring', 'contained_substring', 'substring_match']):
                
                # Validate box dimensions (not too large)
                width = box['x1'] - box['x0']
                height = box['y1'] - box['y0']
                
                if width < 600 and height < 100:  # Reasonable size limits
                    high_conf_boxes.append({
                        'page': box['page'],
                        'x0': box['x0'],
                        'y0': box['y0'],
                        'x1': box['x1'],
                        'y1': box['y1'],
                        'confidence': confidence,
                        'match_type': f"existing_{match_type}",
                        'source': 'existing_mapping'
                    })
        
        return high_conf_boxes
    
    def _find_fuzzy_matches(self, sentence_text: str) -> List[Dict]:
        """Find matches using fuzzy string matching"""
        clean_sentence = self._clean_text(sentence_text)
        fuzzy_matches = []
        
        for page_data in self.pages_layout:
            for element in page_data.get('elements', []):
                clean_element = self._clean_text(element['text'])
                
                if len(clean_element) > 20:  # Only substantial text blocks
                    similarity = SequenceMatcher(None, clean_sentence, clean_element).ratio()
                    
                    if similarity > 0.7:  # High similarity threshold
                        fuzzy_matches.append({
                            **element,
                            'match_confidence': similarity * 0.8,  # Penalty for fuzzy matching
                            'match_type': 'fuzzy_match',
                            'similarity_score': similarity
                        })
        
        return fuzzy_matches
    
    def _estimate_position_from_context(self, sentence_text: str, sentence_id: int) -> List[Dict]:
        """Estimate position based on surrounding sentences with known positions"""
        # Find nearby sentences with good bounding boxes
        context_range = 3
        nearby_boxes = []
        
        for offset in range(-context_range, context_range + 1):
            if offset == 0:
                continue
            
            nearby_id = sentence_id + offset
            if 0 <= nearby_id < len(self.sentences):
                nearby_sentence = self.sentences[nearby_id]
                for box in nearby_sentence.get('bounding_boxes', []):
                    if box.get('confidence', 0) > 0.7:
                        nearby_boxes.append({
                            **box,
                            'sentence_offset': offset,
                            'source_sentence_id': nearby_id
                        })
        
        if not nearby_boxes:
            return []
        
        # Estimate position based on nearby boxes
        # This is a simplified approach - could be more sophisticated
        avg_page = int(sum(box['page'] for box in nearby_boxes) / len(nearby_boxes))
        avg_x0 = sum(box['x0'] for box in nearby_boxes) / len(nearby_boxes)
        avg_y0 = sum(box['y0'] for box in nearby_boxes) / len(nearby_boxes)
        
        # Create estimated box
        estimated_box = {
            'page': avg_page,
            'x0': avg_x0,
            'y0': avg_y0,
            'x1': avg_x0 + 200,  # Estimated width
            'y1': avg_y0 + 20,   # Estimated height
            'confidence': 0.3,   # Low confidence for estimates
            'match_type': 'position_estimate',
            'source': 'context_estimation'
        }
        
        return [estimated_box]
    
    def _filter_and_score_boxes(self, boxes: List[Dict], sentence_text: str, match_type: str) -> List[Dict]:
        """Filter and score boxes for final selection"""
        if not boxes:
            return []
        
        # Sort by confidence
        boxes.sort(key=lambda x: x.get('match_confidence', 0), reverse=True)
        
        # Filter reasonable sizes and positions
        filtered_boxes = []
        for box in boxes:
            width = box['x1'] - box['x0']
            height = box['y1'] - box['y0']
            
            # Size validation
            if (width > 10 and height > 5 and  # Minimum size
                width < 800 and height < 200):  # Maximum size
                
                filtered_boxes.append({
                    'page': box['page'],
                    'x0': box['x0'],
                    'y0': box['y0'],
                    'x1': box['x1'],
                    'y1': box['y1'],
                    'confidence': box.get('match_confidence', 0.5),
                    'match_type': match_type,
                    'source': 'provenance_mapper'
                })
        
        # Return top 3 boxes to avoid over-highlighting
        return filtered_boxes[:3]
    
    def _clean_text(self, text: str) -> str:
        """Clean text for matching"""
        if not text:
            return ""
        
        # Normalize whitespace and remove special characters
        cleaned = re.sub(r'\s+', ' ', text.strip())
        cleaned = re.sub(r'[^\w\s\-\.\,]', '', cleaned)
        return cleaned.lower()
    
    def get_provenance_statistics(self, sentence_ids: List[int]) -> Dict[str, Any]:
        """Get statistics about provenance mapping quality"""
        results = self.get_provenance_bounding_boxes(sentence_ids)
        
        total_sentences = len(sentence_ids)
        mapped_sentences = len(results)
        total_boxes = sum(len(boxes) for boxes in results.values())
        
        confidence_scores = []
        match_types = {}
        
        for boxes in results.values():
            for box in boxes:
                confidence_scores.append(box['confidence'])
                match_type = box['match_type']
                match_types[match_type] = match_types.get(match_type, 0) + 1
        
        avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0
        
        return {
            'total_sentences': total_sentences,
            'mapped_sentences': mapped_sentences,
            'mapping_success_rate': mapped_sentences / total_sentences if total_sentences > 0 else 0,
            'total_boxes': total_boxes,
            'avg_boxes_per_sentence': total_boxes / mapped_sentences if mapped_sentences > 0 else 0,
            'avg_confidence': avg_confidence,
            'match_type_distribution': match_types,
            'high_confidence_boxes': len([c for c in confidence_scores if c > 0.8]),
            'medium_confidence_boxes': len([c for c in confidence_scores if 0.5 < c <= 0.8]),
            'low_confidence_boxes': len([c for c in confidence_scores if c <= 0.5])
        }

# Usage example and testing
def test_provenance_mapper(layout_file_path: str, test_sentence_ids: List[int]):
    """Test the provenance mapper with sample data"""
    mapper = ProvenanceLayoutMapper(layout_file_path, debug=True)
    
    print("🔍 Testing Provenance Layout Mapper")
    print("=" * 50)
    
    # Get bounding boxes
    results = mapper.get_provenance_bounding_boxes(test_sentence_ids)
    
    # Show results
    for sentence_id, boxes in results.items():
        sentence_text = mapper.sentences[sentence_id]['text']
        print(f"\n📄 Sentence {sentence_id}: {sentence_text[:50]}...")
        print(f"   Found {len(boxes)} bounding boxes:")
        
        for i, box in enumerate(boxes):
            print(f"   Box {i+1}: Page {box['page']}, "
                  f"({box['x0']:.1f}, {box['y0']:.1f}) → ({box['x1']:.1f}, {box['y1']:.1f}), "
                  f"Confidence: {box['confidence']:.2f}, Type: {box['match_type']}")
    
    # Get statistics
    stats = mapper.get_provenance_statistics(test_sentence_ids)
    print(f"\n📊 Mapping Statistics:")
    print(f"   Success Rate: {stats['mapping_success_rate']:.1%}")
    print(f"   Average Confidence: {stats['avg_confidence']:.2f}")
    print(f"   High Confidence Boxes: {stats['high_confidence_boxes']}")
    print(f"   Match Types: {stats['match_type_distribution']}")
    
    return results, stats

# Integration helper for your existing system
def get_provenance_boxes_for_highlighting(layout_file_path: str, provenance_data: List[Dict]) -> Dict[int, List[Dict]]:
    """
    Main integration function for your provenance highlighting system
    
    Args:
        layout_file_path: Path to your _layout.json file
        provenance_data: List of provenance objects with sentence_ids
        
    Returns:
        Dict mapping sentence_id to bounding boxes for highlighting
    """
    # Extract all sentence IDs from provenance data
    all_sentence_ids = set()
    for prov in provenance_data:
        sentence_ids = prov.get('sentences_ids', []) or prov.get('provenance_ids', [])
        all_sentence_ids.update(sentence_ids)
    
    if not all_sentence_ids:
        return {}
    
    # Get high-confidence bounding boxes
    mapper = ProvenanceLayoutMapper(layout_file_path)
    return mapper.get_provenance_bounding_boxes(list(all_sentence_ids))

