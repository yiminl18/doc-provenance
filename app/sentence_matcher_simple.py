import re
import difflib
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import defaultdict
import nltk
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords

# Download required NLTK data (run once)
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

@dataclass
class Element:
    stable_index: int
    text: str
    page: int
    coordinates: Dict
    
@dataclass
class TokenMatch:
    token: str
    element_index: int
    stable_index: int
    position_in_element: int
    position_in_text: int
    confidence: float

@dataclass
class SequenceMatch:
    elements: List[Element]
    stable_indices: List[int]
    matched_tokens: List[str]
    coverage_ratio: float
    sequence_score: float
    text_span: str

class SentenceMatcher:
    def __init__(self):
        self.stop_words = set(stopwords.words('english'))
        
    def normalize_text(self, text: str) -> str:
        """Normalize text for consistent matching"""
        if not text:
            return ""
        
        # Convert to lowercase
        text = text.lower()
        
        # Replace punctuation with spaces but keep some meaningful chars
        text = re.sub(r'[^\w\s\-\.]', ' ', text)
        
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text)
        
        return text.strip()
    
    def tokenize_sentence(self, sentence: str) -> List[str]:
        """Tokenize target sentence into meaningful tokens"""
        normalized = self.normalize_text(sentence)
        
        # Use NLTK for better tokenization
        tokens = word_tokenize(normalized)
        
        # Filter out very short tokens and some punctuation
        tokens = [token for token in tokens if len(token) > 1 or token.isdigit()]
        
        return tokens
    
    def create_text_mapping(self, elements: List[Dict]) -> Tuple[str, List[Element], Dict[int, int]]:
        """Create continuous text from elements and mapping back to elements"""
        
        # Convert to Element objects and sort by stable_index
        element_objects = []
        for elem in elements:
            element_objects.append(Element(
                stable_index=elem.get('stable_index', 0),
                text=elem.get('text', ''),
                page=elem.get('page', 1),
                coordinates=elem.get('coordinates', {})
            ))
        
        # Sort by stable_index (reading order)
        element_objects.sort(key=lambda x: x.stable_index)
        
        # Create continuous text and position mapping
        continuous_text = ""
        position_to_element = {}  # text position -> element index
        
        for elem_idx, element in enumerate(element_objects):
            start_pos = len(continuous_text)
            normalized_text = self.normalize_text(element.text)
            
            if normalized_text:  # Only add non-empty text
                # Map each character position to this element
                for i in range(len(normalized_text)):
                    position_to_element[start_pos + i] = elem_idx
                
                continuous_text += normalized_text + " "  # Add space between elements
        
        return continuous_text.strip(), element_objects, position_to_element
    
    def find_token_matches(self, tokens: List[str], continuous_text: str, 
                          elements: List[Element], position_to_element: Dict[int, int]) -> List[TokenMatch]:
        """Find all occurrences of tokens in the continuous text"""
        
        matches = []
        
        for token in tokens:
            if len(token) < 2:  # Skip very short tokens
                continue
                
            # Find all occurrences of this token
            start = 0
            while True:
                pos = continuous_text.find(token, start)
                if pos == -1:
                    break
                
                # Get the element this position belongs to
                if pos in position_to_element:
                    element_idx = position_to_element[pos]
                    element = elements[element_idx]
                    
                    # Calculate position within the element
                    element_start_pos = None
                    for text_pos, elem_idx in position_to_element.items():
                        if elem_idx == element_idx:
                            if element_start_pos is None or text_pos < element_start_pos:
                                element_start_pos = text_pos
                    
                    position_in_element = pos - element_start_pos if element_start_pos is not None else 0
                    
                    # Calculate confidence based on how well the token fits
                    confidence = self.calculate_token_confidence(token, element.text, position_in_element)
                    
                    matches.append(TokenMatch(
                        token=token,
                        element_index=element_idx,
                        stable_index=element.stable_index,
                        position_in_element=position_in_element,
                        position_in_text=pos,
                        confidence=confidence
                    ))
                
                start = pos + 1
        
        return matches
    
    def calculate_token_confidence(self, token: str, element_text: str, position: int) -> float:
        """Calculate confidence score for a token match within an element"""
        
        if not element_text or not token:
            return 0.0
        
        normalized_element = self.normalize_text(element_text)
        
        # Basic confidence based on exact match
        confidence = 0.5
        
        # Bonus for being a significant part of the element
        if len(token) >= len(normalized_element) * 0.3:
            confidence += 0.2
        
        # Bonus for not being a very common word
        if token not in self.stop_words:
            confidence += 0.2
        
        # Bonus for being at word boundaries
        words_in_element = normalized_element.split()
        if token in words_in_element:
            confidence += 0.1
        
        return min(1.0, confidence)
    
    def group_matches_by_sequence(self, matches: List[TokenMatch], tokens: List[str]) -> List[SequenceMatch]:
        """Group token matches into potential sequence matches"""
        
        # Group matches by stable_index ranges
        stable_indices = sorted(set(match.stable_index for match in matches))
        
        if not stable_indices:
            return []
        
        # Try different contiguous ranges of stable indices
        sequence_candidates = []
        
        for start_idx in range(len(stable_indices)):
            for end_idx in range(start_idx, min(start_idx + 15, len(stable_indices))):  # Limit sequence length
                candidate_indices = stable_indices[start_idx:end_idx + 1]
                sequence = self.evaluate_sequence_candidate(matches, candidate_indices, tokens)
                
                if sequence and sequence.coverage_ratio >= 0.3:  # Minimum coverage threshold
                    sequence_candidates.append(sequence)
        
        # Sort by sequence score
        sequence_candidates.sort(key=lambda x: x.sequence_score, reverse=True)
        
        return sequence_candidates
    
    def evaluate_sequence_candidate(self, matches: List[TokenMatch], 
                                  candidate_indices: List[int], tokens: List[str]) -> Optional[SequenceMatch]:
        """Evaluate a sequence of stable indices as a potential match"""
        
        # Get matches within this sequence
        sequence_matches = [match for match in matches if match.stable_index in candidate_indices]
        
        if not sequence_matches:
            return None
        
        # Get unique tokens matched in this sequence
        matched_tokens = list(set(match.token for match in sequence_matches))
        coverage_ratio = len(matched_tokens) / len(tokens)
        
        # Calculate sequence quality metrics
        
        # 1. Coverage score
        coverage_score = coverage_ratio
        
        # 2. Contiguity score (prefer contiguous stable indices)
        sorted_indices = sorted(candidate_indices)
        gaps = sum(1 for i in range(1, len(sorted_indices)) 
                  if sorted_indices[i] - sorted_indices[i-1] > 1)
        contiguity_score = 1.0 / (1 + gaps * 0.5)
        
        # 3. Token order preservation score
        order_score = self.calculate_token_order_score(sequence_matches, tokens)
        
        # 4. Confidence score (average of token confidences)
        confidence_score = sum(match.confidence for match in sequence_matches) / len(sequence_matches)
        
        # 5. Completeness score (bonus for having start/end tokens)
        completeness_score = self.calculate_completeness_score(matched_tokens, tokens)
        
        # Combined sequence score
        sequence_score = (
            coverage_score * 0.4 +
            contiguity_score * 0.2 +
            order_score * 0.2 +
            confidence_score * 0.1 +
            completeness_score * 0.1
        )
        
        # Get elements for this sequence
        elements = []
        stable_to_element = {}
        
        # We need access to elements, so we'll store them during matching
        # For now, create minimal element info
        for match in sequence_matches:
            if match.stable_index not in stable_to_element:
                stable_to_element[match.stable_index] = Element(
                    stable_index=match.stable_index,
                    text="",  # Will be filled from original elements
                    page=1,
                    coordinates={}
                )
        
        elements = list(stable_to_element.values())
        elements.sort(key=lambda x: x.stable_index)
        
        # Create text span
        text_span = " ".join(matched_tokens)
        
        return SequenceMatch(
            elements=elements,
            stable_indices=candidate_indices,
            matched_tokens=matched_tokens,
            coverage_ratio=coverage_ratio,
            sequence_score=sequence_score,
            text_span=text_span
        )
    
    def calculate_token_order_score(self, sequence_matches: List[TokenMatch], tokens: List[str]) -> float:
        """Calculate how well the token order is preserved"""
        
        if len(sequence_matches) <= 1:
            return 1.0
        
        # Create mapping of token to its position in target sentence
        token_positions = {token: i for i, token in enumerate(tokens)}
        
        # Sort matches by stable index
        sorted_matches = sorted(sequence_matches, key=lambda x: x.stable_index)
        
        # Check order preservation
        correct_order = 0
        total_pairs = 0
        
        for i in range(len(sorted_matches) - 1):
            token1 = sorted_matches[i].token
            token2 = sorted_matches[i + 1].token
            
            if token1 in token_positions and token2 in token_positions:
                pos1 = token_positions[token1]
                pos2 = token_positions[token2]
                
                if pos2 > pos1:  # Correct order
                    correct_order += 1
                total_pairs += 1
        
        return correct_order / max(1, total_pairs)
    
    def calculate_completeness_score(self, matched_tokens: List[str], target_tokens: List[str]) -> float:
        """Calculate bonus for matching important tokens (start, end, long tokens)"""
        
        if not target_tokens:
            return 0.0
        
        score = 0.0
        
        # Bonus for first token
        if target_tokens[0] in matched_tokens:
            score += 0.3
        
        # Bonus for last token  
        if target_tokens[-1] in matched_tokens:
            score += 0.3
        
        # Bonus for longer tokens (likely more important)
        for token in matched_tokens:
            if len(token) >= 4:
                score += 0.1
        
        return min(1.0, score)
    
    def filter_stray_matches(self, sequence_match: SequenceMatch, all_matches: List[TokenMatch]) -> List[int]:
        """Filter out stray matches that are far from the main sequence"""
        
        if not sequence_match.stable_indices:
            return []
        
        main_range = (min(sequence_match.stable_indices), max(sequence_match.stable_indices))
        filtered_indices = []
        
        for match in all_matches:
            # Include if within main range
            if main_range[0] <= match.stable_index <= main_range[1]:
                filtered_indices.append(match.stable_index)
            # Include if very close to main range and high confidence
            elif (abs(match.stable_index - main_range[0]) <= 2 or 
                  abs(match.stable_index - main_range[1]) <= 2) and match.confidence >= 0.7:
                filtered_indices.append(match.stable_index)
        
        return sorted(list(set(filtered_indices)))

    def find_best_sentence_match(self, target_sentence: str, elements: List[Dict]) -> Dict:
        """Main method to find the best sentence match"""
        
        try:
            # Step 1: Create text mapping
            continuous_text, element_objects, position_to_element = self.create_text_mapping(elements)
            
            # Step 2: Tokenize target sentence
            tokens = self.tokenize_sentence(target_sentence)
            
            # Step 3: Find token matches
            token_matches = self.find_token_matches(tokens, continuous_text, element_objects, position_to_element)
            
            # Step 4: Group into sequence matches
            sequence_candidates = self.group_matches_by_sequence(token_matches, tokens)
            
            if not sequence_candidates:
                return {
                    'success': True,
                    'matches': [],
                    'debug_info': {
                        'continuous_text': continuous_text[:200] + "..." if len(continuous_text) > 200 else continuous_text,
                        'tokens': tokens,
                        'token_matches_found': len(token_matches)
                    }
                }
            
            # Step 5: Get best match and filter strays
            best_match = sequence_candidates[0]
            filtered_indices = self.filter_stray_matches(best_match, token_matches)
            
            # Prepare response
            result = {
                'success': True,
                'matches': [{
                    'stable_indices': filtered_indices,
                    'coverage_ratio': best_match.coverage_ratio,
                    'sequence_score': best_match.sequence_score,
                    'matched_tokens': best_match.matched_tokens,
                    'text_span': best_match.text_span
                }],
                'debug_info': {
                    'continuous_text': continuous_text[:500] + "..." if len(continuous_text) > 500 else continuous_text,
                    'target_tokens': tokens,
                    'total_token_matches': len(token_matches),
                    'sequence_candidates': len(sequence_candidates),
                    'best_match_score': best_match.sequence_score
                }
            }
            
            return result
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }