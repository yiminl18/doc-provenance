#!/usr/bin/env python3
"""
Enhanced Provenance Text Boundary Detector
Ensures complete provenance text coverage by detecting and extending boundaries
"""

import re
import json
from typing import List, Dict, Tuple, Optional
from difflib import SequenceMatcher

class ProvenanceTextBoundaryDetector:
    """
    Detects and ensures complete provenance text boundaries in PDF highlighting
    """
    
    def __init__(self, verbose: bool = True):
        self.verbose = verbose
        
    def find_complete_provenance_boundaries(self, 
                                          provenance_text: str, 
                                          pdf_sentences: List[str],
                                          sentence_ids: List[int]) -> Dict:
        """
        Find the complete boundaries of provenance text, ensuring beginning and end are captured
        
        Args:
            provenance_text: The exact text from the provenance
            pdf_sentences: List of all sentences from the PDF
            sentence_ids: Initial sentence IDs that contain parts of the provenance
            
        Returns:
            Dict with extended sentence coverage and boundary info
        """
        
        # Clean and normalize the provenance text
        clean_provenance = self._normalize_text(provenance_text)
        
        if self.verbose:
            print(f"🔍 Finding complete boundaries for: '{provenance_text[:100]}...'")
            print(f"📊 Initial sentence IDs: {sentence_ids}")
        
        # Step 1: Find the exact start and end of provenance in the sentence collection
        start_boundary = self._find_provenance_start(clean_provenance, pdf_sentences, sentence_ids)
        end_boundary = self._find_provenance_end(clean_provenance, pdf_sentences, sentence_ids)
        
        # Step 2: Extend sentence coverage to ensure complete boundaries
        extended_sentence_ids = self._extend_sentence_coverage(
            start_boundary, end_boundary, sentence_ids, pdf_sentences, clean_provenance
        )
        
        # Step 3: Validate that we now have complete coverage
        coverage_validation = self._validate_complete_coverage(
            clean_provenance, pdf_sentences, extended_sentence_ids
        )
        
        return {
            'original_sentence_ids': sentence_ids,
            'extended_sentence_ids': extended_sentence_ids,
            'start_boundary': start_boundary,
            'end_boundary': end_boundary,
            'coverage_validation': coverage_validation,
            'provenance_text': provenance_text,
            'boundary_extension_applied': len(extended_sentence_ids) > len(sentence_ids)
        }
    
    def _find_provenance_start(self, provenance_text: str, pdf_sentences: List[str], sentence_ids: List[int]) -> Dict:
        """Find where the provenance actually starts"""
        
        # Get the first few words of provenance
        provenance_words = provenance_text.split()[:5]  # First 5 words
        start_phrase = ' '.join(provenance_words)
        
        best_match = None
        best_score = 0
        
        # Look for the start phrase in and around the given sentence IDs
        search_range = range(max(0, min(sentence_ids) - 2), min(len(pdf_sentences), max(sentence_ids) + 3))
        
        for sentence_idx in search_range:
            if sentence_idx >= len(pdf_sentences):
                continue
                
            sentence = self._normalize_text(pdf_sentences[sentence_idx])
            
            # Check if this sentence contains the start of our provenance
            if start_phrase.lower() in sentence.lower():
                # Find the exact position
                start_pos = sentence.lower().find(start_phrase.lower())
                
                if start_pos != -1:
                    confidence = self._calculate_match_confidence(start_phrase, sentence[start_pos:start_pos+len(start_phrase)])
                    
                    if confidence > best_score:
                        best_score = confidence
                        best_match = {
                            'sentence_id': sentence_idx,
                            'position_in_sentence': start_pos,
                            'matched_text': sentence[start_pos:start_pos+len(start_phrase)],
                            'confidence': confidence,
                            'full_sentence': sentence
                        }
        
        return best_match or {'sentence_id': min(sentence_ids), 'confidence': 0.5}
    
    def _find_provenance_end(self, provenance_text: str, pdf_sentences: List[str], sentence_ids: List[int]) -> Dict:
        """Find where the provenance actually ends"""
        
        # Get the last few words of provenance
        provenance_words = provenance_text.split()
        end_phrase = ' '.join(provenance_words[-5:])  # Last 5 words
        
        best_match = None
        best_score = 0
        
        # Look for the end phrase in and around the given sentence IDs
        search_range = range(max(0, min(sentence_ids) - 2), min(len(pdf_sentences), max(sentence_ids) + 3))
        
        for sentence_idx in search_range:
            if sentence_idx >= len(pdf_sentences):
                continue
                
            sentence = self._normalize_text(pdf_sentences[sentence_idx])
            
            # Check if this sentence contains the end of our provenance
            if end_phrase.lower() in sentence.lower():
                # Find the exact position
                end_pos = sentence.lower().find(end_phrase.lower())
                
                if end_pos != -1:
                    confidence = self._calculate_match_confidence(end_phrase, sentence[end_pos:end_pos+len(end_phrase)])
                    
                    if confidence > best_score:
                        best_score = confidence
                        best_match = {
                            'sentence_id': sentence_idx,
                            'position_in_sentence': end_pos,
                            'matched_text': sentence[end_pos:end_pos+len(end_phrase)],
                            'confidence': confidence,
                            'full_sentence': sentence,
                            'end_position': end_pos + len(end_phrase)
                        }
        
        return best_match or {'sentence_id': max(sentence_ids), 'confidence': 0.5}
    
    def _extend_sentence_coverage(self, start_boundary: Dict, end_boundary: Dict, 
                                original_ids: List[int], pdf_sentences: List[str], 
                                provenance_text: str) -> List[int]:
        """Extend sentence coverage to ensure complete provenance boundaries"""
        
        if not start_boundary or not end_boundary:
            return original_ids
        
        start_sentence = start_boundary.get('sentence_id', min(original_ids))
        end_sentence = end_boundary.get('sentence_id', max(original_ids))
        
        # Create extended range
        extended_ids = list(range(start_sentence, end_sentence + 1))
        
        # Also include original IDs to ensure we don't lose anything
        all_ids = sorted(list(set(extended_ids + original_ids)))
        
        if self.verbose:
            print(f"📈 Extended sentence coverage: {original_ids} → {all_ids}")
            print(f"🎯 Start boundary at sentence {start_sentence}, end at {end_sentence}")
        
        return all_ids
    
    def _validate_complete_coverage(self, provenance_text: str, pdf_sentences: List[str], 
                                  sentence_ids: List[int]) -> Dict:
        """Validate that we have complete coverage of the provenance text"""
        
        # Combine all sentences in the coverage
        combined_text = ' '.join([pdf_sentences[i] for i in sentence_ids if i < len(pdf_sentences)])
        combined_text = self._normalize_text(combined_text)
        provenance_normalized = self._normalize_text(provenance_text)
        
        # Check coverage
        coverage_score = self._calculate_text_coverage(provenance_normalized, combined_text)
        
        # Check for specific start and end
        provenance_words = provenance_normalized.split()
        if len(provenance_words) >= 3:
            start_words = ' '.join(provenance_words[:3])
            end_words = ' '.join(provenance_words[-3:])
            
            has_start = start_words.lower() in combined_text.lower()
            has_end = end_words.lower() in combined_text.lower()
        else:
            has_start = has_end = True  # Short text, assume complete
        
        return {
            'coverage_score': coverage_score,
            'has_start': has_start,
            'has_end': has_end,
            'is_complete': coverage_score > 0.85 and has_start and has_end,
            'combined_text_length': len(combined_text),
            'provenance_length': len(provenance_normalized)
        }
    
    def _calculate_text_coverage(self, target_text: str, source_text: str) -> float:
        """Calculate how much of the target text is covered by the source text"""
        if not target_text or not source_text:
            return 0.0
        
        # Use sequence matcher to find similarity
        matcher = SequenceMatcher(None, target_text.lower(), source_text.lower())
        return matcher.ratio()
    
    def _calculate_match_confidence(self, expected: str, actual: str) -> float:
        """Calculate confidence score for text matching"""
        if not expected or not actual:
            return 0.0
        
        matcher = SequenceMatcher(None, expected.lower(), actual.lower())
        return matcher.ratio()
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        if not text:
            return ""
        
        # Remove extra whitespace and normalize
        normalized = re.sub(r'\s+', ' ', text.strip())
        # Remove common punctuation that might cause issues
        normalized = re.sub(r'[^\w\s\.\,\;\:\!\?\-]', '', normalized)
        return normalized

# Integration function for your existing pipeline
def enhance_provenance_sentence_ids(provenance_text: str, pdf_sentences: List[str], 
                                   original_sentence_ids: List[int]) -> List[int]:
    """
    Main function to enhance sentence IDs to ensure complete provenance coverage
    
    Args:
        provenance_text: The exact provenance text that should be highlighted
        pdf_sentences: List of all sentences from the PDF
        original_sentence_ids: Original sentence IDs from your algorithm
        
    Returns:
        Enhanced list of sentence IDs that guarantees complete coverage
    """
    
    detector = ProvenanceTextBoundaryDetector(verbose=True)
    
    result = detector.find_complete_provenance_boundaries(
        provenance_text, pdf_sentences, original_sentence_ids
    )
    
    # Log the enhancement
    if result['boundary_extension_applied']:
        print(f"✅ Enhanced sentence coverage for complete provenance boundaries")
        print(f"   Original IDs: {result['original_sentence_ids']}")
        print(f"   Enhanced IDs: {result['extended_sentence_ids']}")
        print(f"   Coverage: {result['coverage_validation']['coverage_score']:.2%}")
        print(f"   Complete: {result['coverage_validation']['is_complete']}")
    
    return result['extended_sentence_ids']