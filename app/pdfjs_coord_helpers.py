"""
PDF.js Coordinate Mapping Helper Functions for Flask Integration
Use these in your existing Flask endpoints for real-time sentence mapping debugging
"""

import os
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set, Any
from dataclasses import dataclass, field
import time
import logging

logger = logging.getLogger(__name__)

@dataclass
class DebugSentenceResult:
    """Result of testing a single sentence mapping"""
    sentence_id: Optional[int]
    sentence_text: str
    success: bool
    method_used: str
    confidence: float
    word_coverage: float
    matched_elements: List[Dict]
    consumed_words: Dict[int, Set[str]]
    bounding_box: Dict
    processing_time: float
    error_message: Optional[str] = None
    debug_info: Dict = field(default_factory=dict)

@dataclass
class ElementConsumption:
    """Tracks what portions of an element's text have been consumed."""
    stable_index: int
    page_number: int
    original_text: str
    consumed_words: Set[str] = field(default_factory=set)
    consumed_by_sentences: List[int] = field(default_factory=list)
    remaining_words: Set[str] = field(default_factory=set)
    
    def __post_init__(self):
        if not self.remaining_words:
            self.remaining_words = set(self._normalize_text(self.original_text).split())
    
    def consume_words(self, words: Set[str], sentence_id: int) -> Set[str]:
        consumable = words.intersection(self.remaining_words)
        if consumable:
            self.consumed_words.update(consumable)
            self.remaining_words -= consumable
            self.consumed_by_sentences.append(sentence_id)
        return consumable
    
    def get_consumption_ratio(self) -> float:
        total_words = len(self.consumed_words) + len(self.remaining_words)
        return len(self.consumed_words) / total_words if total_words > 0 else 0.0
    
    def _normalize_text(self, text: str) -> str:
        import re
        text = re.sub(r'\s+', ' ', text.lower().strip())
        text = re.sub(r'[^\w\s]', '', text)
        return text

class PDFJSCoordinateDebugger:
    """
    Helper class for debugging PDF.js coordinate mapping in your Flask app
    """
    
    def __init__(self, 
                 pdfjs_cache_dir: str = 'pdfjs_cache',
                 sentence_mappings_dir: str = 'sentence_page_mappings', 
                 sentences_dir: str = 'sentences',
                 min_confidence_threshold: float = 0.7):
        
        self.pdfjs_cache_dir = Path(pdfjs_cache_dir)
        self.sentence_mappings_dir = Path(sentence_mappings_dir)
        self.sentences_dir = Path(sentences_dir)
        self.min_confidence_threshold = min_confidence_threshold
        
        # Cache for loaded documents
        self._document_cache = {}
        self._element_consumption_cache = {}
    
    def get_available_documents(self) -> List[str]:
        """Get list of documents available for debugging"""
        documents = []
        
        if self.pdfjs_cache_dir.exists():
            for cache_dir in self.pdfjs_cache_dir.iterdir():
                if cache_dir.is_dir():
                    # Check if it has required files
                    page_files = list(cache_dir.glob("page_*.json"))
                    if page_files:
                        documents.append(cache_dir.name)
        
        return sorted(documents)
    
    def load_document_data(self, document_basename: str, force_reload: bool = False) -> Dict[str, Any]:
        """
        Load all required data for a document
        
        Returns:
            Dict with 'sentences', 'page_mappings', 'pdfjs_data', 'element_consumption'
        """
        
        if not force_reload and document_basename in self._document_cache:
            return self._document_cache[document_basename]
        
        try:
            # Load sentences
            sentences = self._load_sentences(document_basename)
            
            # Load page mappings
            page_mappings = self._load_page_mappings(document_basename)
            
            # Load PDF.js cache data
            pdfjs_data = self._load_pdfjs_cache(document_basename)
            
            # Initialize element consumption tracking
            element_consumption = self._initialize_element_consumption(pdfjs_data)
            
            document_data = {
                'sentences': sentences,
                'page_mappings': page_mappings,
                'pdfjs_data': pdfjs_data,
                'element_consumption': element_consumption,
                'loaded_at': time.time()
            }
            
            self._document_cache[document_basename] = document_data
            return document_data
            
        except Exception as e:
            logger.error(f"Error loading document {document_basename}: {e}")
            raise
    
    def test_sentence_mapping(self, 
                            document_basename: str, 
                            sentence_text: str, 
                            sentence_id: Optional[int] = None,
                            reset_consumption: bool = False) -> DebugSentenceResult:
        """
        Test mapping a single sentence to PDF.js elements
        
        Args:
            document_basename: Name of document (without .pdf)
            sentence_text: Text of sentence to map
            sentence_id: Optional sentence ID (for tracking)
            reset_consumption: Whether to reset element consumption before testing
            
        Returns:
            DebugSentenceResult with mapping details
        """
        
        start_time = time.time()
        
        try:
            # Load document data
            doc_data = self.load_document_data(document_basename)
            
            if reset_consumption:
                doc_data['element_consumption'] = self._initialize_element_consumption(doc_data['pdfjs_data'])
            
            # Find best match for this sentence
            match_result = self._find_best_match_for_sentence(
                sentence_text, 
                sentence_id or 0,
                doc_data['pdfjs_data'],
                doc_data['element_consumption'],
                doc_data['page_mappings']
            )
            
            processing_time = time.time() - start_time
            
            if match_result:
                return DebugSentenceResult(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    success=True,
                    method_used=match_result['method'],
                    confidence=match_result['confidence'],
                    word_coverage=match_result['word_coverage'],
                    matched_elements=match_result['matched_elements'],
                    consumed_words=match_result['consumed_words'],
                    bounding_box=match_result['bounding_box'],
                    processing_time=processing_time,
                    debug_info=match_result.get('debug_info', {})
                )
            else:
                return DebugSentenceResult(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    success=False,
                    method_used='no_match',
                    confidence=0.0,
                    word_coverage=0.0,
                    matched_elements=[],
                    consumed_words={},
                    bounding_box={},
                    processing_time=processing_time,
                    error_message="No matching elements found"
                )
                
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Error testing sentence mapping: {e}")
            
            return DebugSentenceResult(
                sentence_id=sentence_id,
                sentence_text=sentence_text,
                success=False,
                method_used='error',
                confidence=0.0,
                word_coverage=0.0,
                matched_elements=[],
                consumed_words={},
                bounding_box={},
                processing_time=processing_time,
                error_message=str(e)
            )
    
    def test_multiple_sentences(self, 
                               document_basename: str, 
                               sentences: List[str],
                               reset_consumption_between: bool = False) -> List[DebugSentenceResult]:
        """
        Test mapping multiple sentences
        
        Args:
            document_basename: Name of document
            sentences: List of sentence texts to test
            reset_consumption_between: Whether to reset consumption between each sentence
            
        Returns:
            List of DebugSentenceResult objects
        """
        
        results = []
        
        for i, sentence_text in enumerate(sentences):
            result = self.test_sentence_mapping(
                document_basename, 
                sentence_text, 
                sentence_id=i,
                reset_consumption=reset_consumption_between
            )
            results.append(result)
        
        return results
    
    def get_document_sentences(self, document_basename: str, limit: Optional[int] = None) -> List[str]:
        """Get list of sentences from a document"""
        try:
            doc_data = self.load_document_data(document_basename)
            sentences = doc_data['sentences']
            
            if limit:
                return sentences[:limit]
            return sentences
            
        except Exception as e:
            logger.error(f"Error getting sentences for {document_basename}: {e}")
            return []
    
    def get_element_consumption_stats(self, document_basename: str) -> Dict[str, Any]:
        """Get current element consumption statistics"""
        try:
            doc_data = self.load_document_data(document_basename)
            element_consumption = doc_data['element_consumption']
            
            stats = {
                'pages': {},
                'overall': {
                    'total_elements': 0,
                    'fully_consumed': 0,
                    'partially_consumed': 0,
                    'unused': 0,
                    'average_consumption_ratio': 0.0
                }
            }
            
            total_consumption = 0.0
            total_elements = 0
            
            for page_number, page_consumption in element_consumption.items():
                page_stats = {
                    'total_elements': len(page_consumption),
                    'fully_consumed': 0,
                    'partially_consumed': 0,
                    'unused': 0,
                    'average_consumption_ratio': 0.0
                }
                
                page_consumption_total = 0.0
                
                for element_consumption_obj in page_consumption.values():
                    ratio = element_consumption_obj.get_consumption_ratio()
                    page_consumption_total += ratio
                    total_consumption += ratio
                    total_elements += 1
                    
                    if ratio == 1.0:
                        page_stats['fully_consumed'] += 1
                    elif ratio > 0.0:
                        page_stats['partially_consumed'] += 1
                    else:
                        page_stats['unused'] += 1
                
                if page_stats['total_elements'] > 0:
                    page_stats['average_consumption_ratio'] = page_consumption_total / page_stats['total_elements']
                
                stats['pages'][page_number] = page_stats
            
            # Overall stats
            stats['overall']['total_elements'] = total_elements
            if total_elements > 0:
                stats['overall']['average_consumption_ratio'] = total_consumption / total_elements
            
            for page_stats in stats['pages'].values():
                stats['overall']['fully_consumed'] += page_stats['fully_consumed']
                stats['overall']['partially_consumed'] += page_stats['partially_consumed']
                stats['overall']['unused'] += page_stats['unused']
            
            return stats
            
        except Exception as e:
            logger.error(f"Error getting consumption stats for {document_basename}: {e}")
            return {}
    
    def reset_document_consumption(self, document_basename: str) -> bool:
        """Reset element consumption for a document"""
        try:
            doc_data = self.load_document_data(document_basename)
            doc_data['element_consumption'] = self._initialize_element_consumption(doc_data['pdfjs_data'])
            return True
        except Exception as e:
            logger.error(f"Error resetting consumption for {document_basename}: {e}")
            return False
    
    # Internal methods (simplified versions of your existing logic)
    
    def _load_sentences(self, basename: str) -> List[str]:
        """Load extracted sentences"""
        sentences_path = self.sentences_dir / f"{basename}_sentences.json"
        if not sentences_path.exists():
            raise FileNotFoundError(f"Sentences file not found: {sentences_path}")
            
        with open(sentences_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_page_mappings(self, basename: str) -> List[Dict]:
        """Load sentence-to-page mappings"""
        mappings_path = self.sentence_mappings_dir / f"{basename}_sentence_page_mappings.json"
        if not mappings_path.exists():
            return []  # Optional file
            
        with open(mappings_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and 'sentence_mappings' in data:
                return data['sentence_mappings']
            elif isinstance(data, list):
                return data
            else:
                return []
    
    def _load_pdfjs_cache(self, basename: str) -> Dict[int, List[Dict]]:
        """Load cached PDF.js data for all pages"""
        cache_dir = self.pdfjs_cache_dir / basename
        if not cache_dir.exists():
            raise FileNotFoundError(f"PDF.js cache directory not found: {cache_dir}")
        
        pdfjs_data = {}
        page_files = sorted(cache_dir.glob("page_*.json"))
        
        for page_file in page_files:
            page_match = re.search(r'page_(\d+)\.json', page_file.name)
            if not page_match:
                continue
                
            page_num = int(page_match.group(1))
            
            with open(page_file, 'r', encoding='utf-8') as f:
                page_data = json.load(f)
            
            # Convert to simplified element format
            elements = []
            stable_items = page_data.get('stableItems', [])
            
            for item in stable_items:
                element = {
                    'stable_index': item['stableIndex'],
                    'page_number': page_num,
                    'text': item['str'],
                    'normalized_text': item.get('normalizedText', item['str'].lower()),
                    'x': item['x'],
                    'y': item['y'],
                    'width': item['width'],
                    'height': item['height'],
                    'font_name': item.get('fontName', ''),
                    'font_size': item.get('fontSize', 0),
                    'reading_order_index': item.get('reading_order_index', 0),
                    'identifiers': item.get('identifiers', {}),
                    'is_whitespace_only': item.get('isWhitespaceOnly', False),
                    'has_significant_text': item.get('hasSignificantText', True)
                }
                elements.append(element)
            
            elements.sort(key=lambda x: x['reading_order_index'])
            pdfjs_data[page_num] = elements
        
        return pdfjs_data
    
    def _initialize_element_consumption(self, pdfjs_data: Dict[int, List[Dict]]) -> Dict[int, Dict[int, ElementConsumption]]:
        """Initialize consumption tracking for all elements"""
        element_consumption = {}
        
        for page_number, elements in pdfjs_data.items():
            element_consumption[page_number] = {}
            
            for element in elements:
                if not element['is_whitespace_only'] and element['has_significant_text']:
                    element_consumption[page_number][element['stable_index']] = ElementConsumption(
                        stable_index=element['stable_index'],
                        page_number=page_number,
                        original_text=element['text']
                    )
        
        return element_consumption
    
    def _find_best_match_for_sentence(self, 
                                    sentence_text: str, 
                                    sentence_id: int,
                                    pdfjs_data: Dict[int, List[Dict]],
                                    element_consumption: Dict[int, Dict[int, ElementConsumption]],
                                    page_mappings: List[Dict]) -> Optional[Dict]:
        """
        Find the best match for a sentence (simplified version of your logic)
        This is where you'd put your actual matching algorithm
        """
        
        # Get assigned pages for this sentence (if available)
        assigned_pages = []
        if page_mappings and sentence_id < len(page_mappings):
            page_mapping = page_mappings[sentence_id]
            assigned_pages = page_mapping.get('pages', [])
        
        # Strategy 1: Try exact text matching on assigned pages first
        for page_number in assigned_pages or sorted(pdfjs_data.keys()):
            page_elements = pdfjs_data.get(page_number, [])
            
            exact_match = self._try_exact_match_on_page(
                sentence_text, sentence_id, page_elements, 
                element_consumption.get(page_number, {}), page_number
            )
            
            if exact_match:
                return exact_match
        
        # Strategy 2: Try word-based matching
        word_match = self._try_word_based_matching(
            sentence_text, sentence_id, pdfjs_data, element_consumption
        )
        
        return word_match
    
    def _try_exact_match_on_page(self, sentence_text: str, sentence_id: int, 
                                page_elements: List[Dict], 
                                page_consumption: Dict[int, ElementConsumption],
                                page_number: int) -> Optional[Dict]:
        """Try exact text matching on a specific page"""
        
        sentence_clean = self._normalize_text(sentence_text)
        
        # Try single element exact match
        for element in page_elements:
            if not element['has_significant_text'] or element['is_whitespace_only']:
                continue
            
            consumption = page_consumption.get(element['stable_index'])
            if consumption:
                available_text = ' '.join(sorted(consumption.remaining_words))
            else:
                available_text = element['normalized_text']
            
            if sentence_clean in available_text:
                # Found exact match!
                sentence_words = set(self._normalize_text(sentence_text).split())
                consumed_words = {}
                matched_elements = []
                
                # Consume words if consumption tracking is available
                if consumption:
                    consumed = consumption.consume_words(sentence_words, sentence_id)
                    consumed_words[element['stable_index']] = consumed
                else:
                    consumed_words[element['stable_index']] = sentence_words
                
                matched_elements.append({
                    'stable_index': element['stable_index'],
                    'page': page_number,
                    'text': element['text'],
                    'words_consumed': list(consumed_words[element['stable_index']]),
                    'consumption_ratio': len(consumed_words[element['stable_index']]) / len(sentence_words) if sentence_words else 0,
                    'coordinates': {
                        'x': element['x'],
                        'y': element['y'],
                        'width': element['width'],
                        'height': element['height']
                    }
                })
                
                return {
                    'method': 'exact_single_element',
                    'confidence': 0.98,
                    'word_coverage': 1.0,
                    'matched_elements': matched_elements,
                    'consumed_words': consumed_words,
                    'bounding_box': {
                        'x': element['x'],
                        'y': element['y'],
                        'width': element['width'],
                        'height': element['height']
                    },
                    'debug_info': {
                        'page_number': page_number,
                        'element_count': 1,
                        'match_type': 'exact_text'
                    }
                }
        
        return None
    
    def _try_word_based_matching(self, sentence_text: str, sentence_id: int,
                               pdfjs_data: Dict[int, List[Dict]],
                               element_consumption: Dict[int, Dict[int, ElementConsumption]]) -> Optional[Dict]:
        """Try word-based matching across all available elements"""
        
        sentence_words = set(self._extract_meaningful_words(sentence_text))
        if not sentence_words:
            return None
        
        matched_elements = []
        consumed_words = {}
        pages_used = set()
        
        # Go through elements in reading order
        for page_number in sorted(pdfjs_data.keys()):
            page_elements = pdfjs_data[page_number]
            page_consumption = element_consumption.get(page_number, {})
            
            for element in page_elements:
                if not element['has_significant_text'] or element['is_whitespace_only']:
                    continue
                
                consumption = page_consumption.get(element['stable_index'])
                if consumption:
                    available_words = consumption.remaining_words
                else:
                    available_words = set(self._normalize_text(element['text']).split())
                
                # Check overlap with sentence words
                overlap = sentence_words.intersection(available_words)
                
                if overlap:
                    if consumption:
                        consumed = consumption.consume_words(overlap, sentence_id)
                    else:
                        consumed = overlap
                    
                    if consumed:
                        consumed_words[element['stable_index']] = consumed
                        matched_elements.append({
                            'stable_index': element['stable_index'],
                            'page': page_number,
                            'text': element['text'],
                            'words_consumed': list(consumed),
                            'consumption_ratio': len(consumed) / len(set(element['normalized_text'].split())) if element['normalized_text'] else 0,
                            'coordinates': {
                                'x': element['x'],
                                'y': element['y'],
                                'width': element['width'],
                                'height': element['height']
                            }
                        })
                        pages_used.add(page_number)
        
        if not matched_elements:
            return None
        
        # Calculate overall metrics
        all_consumed_words = set()
        for words in consumed_words.values():
            all_consumed_words.update(words)
        
        word_coverage = len(all_consumed_words) / len(sentence_words)
        confidence = min(0.8, word_coverage * 1.1)
        
        if word_coverage < 0.4:
            return None
        
        # Calculate bounding box
        if matched_elements:
            min_x = min(elem['coordinates']['x'] for elem in matched_elements)
            min_y = min(elem['coordinates']['y'] for elem in matched_elements)
            max_x = max(elem['coordinates']['x'] + elem['coordinates']['width'] for elem in matched_elements)
            max_y = max(elem['coordinates']['y'] + elem['coordinates']['height'] for elem in matched_elements)
            
            bounding_box = {
                'x': min_x,
                'y': min_y,
                'width': max_x - min_x,
                'height': max_y - min_y
            }
        else:
            bounding_box = {}
        
        return {
            'method': 'word_based_multi_element',
            'confidence': confidence,
            'word_coverage': word_coverage,
            'matched_elements': matched_elements,
            'consumed_words': consumed_words,
            'bounding_box': bounding_box,
            'debug_info': {
                'pages_used': list(pages_used),
                'element_count': len(matched_elements),
                'match_type': 'word_overlap',
                'total_words_matched': len(all_consumed_words)
            }
        }
    
    def _extract_meaningful_words(self, text: str) -> List[str]:
        """Extract meaningful words from text for matching"""
        words = re.findall(r'\b\w+\b', text.lower())
        
        stopwords = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did'
        }
        
        return [word for word in words if len(word) >= 3 and word not in stopwords]
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching"""
        text = re.sub(r'\s+', ' ', text.lower().strip())
        text = re.sub(r'[^\w\s]', '', text)
        return text


# Utility functions for Flask integration

def create_pdfjs_debugger(config: Dict[str, str]) -> PDFJSCoordinateDebugger:
    """Factory function to create debugger instance"""
    return PDFJSCoordinateDebugger(
        pdfjs_cache_dir=config.get('pdfjs_cache_dir', 'pdfjs_cache'),
        sentence_mappings_dir=config.get('sentence_mappings_dir', 'sentence_page_mappings'),
        sentences_dir=config.get('sentences_dir', 'sentences'),
        min_confidence_threshold=config.get('min_confidence_threshold', 0.7)
    )

def format_debug_result_for_api(result: DebugSentenceResult) -> Dict[str, Any]:
    """Format debug result for JSON API response"""
    return {
        'sentence_id': result.sentence_id,
        'sentence_text': result.sentence_text,
        'success': result.success,
        'method_used': result.method_used,
        'confidence': result.confidence,
        'word_coverage': result.word_coverage,
        'matched_elements': result.matched_elements,
        'consumed_words': {str(k): list(v) for k, v in result.consumed_words.items()},
        'bounding_box': result.bounding_box,
        'processing_time': result.processing_time,
        'error_message': result.error_message,
        'debug_info': result.debug_info
    }