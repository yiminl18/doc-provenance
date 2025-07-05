import os
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set
from difflib import SequenceMatcher
from dataclasses import dataclass, field
import nltk

@dataclass
class PDFJSElement:
    """Represents a PDF.js text element with its properties."""
    stable_index: int
    page_number: int
    text: str
    normalized_text: str
    x: float
    y: float
    width: float
    height: float
    font_name: str
    font_size: float
    reading_order_index: int
    identifiers: Dict
    is_whitespace_only: bool = False
    has_significant_text: bool = True

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
            # Initialize remaining_words from original_text
            self.remaining_words = set(self._normalize_text(self.original_text).split())
    
    def consume_words(self, words: Set[str], sentence_id: int) -> Set[str]:
        """
        Consume words from this element and return what was actually consumed.
        
        Args:
            words: Set of words to try to consume
            sentence_id: ID of the sentence consuming these words
            
        Returns:
            Set of words that were actually consumed from this element
        """
        consumable = words.intersection(self.remaining_words)
        
        if consumable:
            self.consumed_words.update(consumable)
            self.remaining_words -= consumable
            self.consumed_by_sentences.append(sentence_id)
        
        return consumable
    
    def get_consumption_ratio(self) -> float:
        """Get the ratio of consumed words to total words."""
        total_words = len(self.consumed_words) + len(self.remaining_words)
        return len(self.consumed_words) / total_words if total_words > 0 else 0.0
    
    def has_available_words(self, words: Set[str]) -> bool:
        """Check if any of the requested words are still available."""
        return bool(words.intersection(self.remaining_words))
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for word extraction."""
        import re
        text = re.sub(r'\s+', ' ', text.lower().strip())
        text = re.sub(r'[^\w\s]', '', text)
        return text

@dataclass
class SentenceMatch:
    """Represents a sentence matched to PDF.js elements."""
    sentence_id: int
    sentence_text: str
    page_number: int
    matched_elements: List[int]  # stable_index values
    consumed_words: Dict[int, Set[str]]  # stable_index -> consumed words
    confidence: float
    match_method: str
    character_coverage: float
    bounding_box: Dict
    word_coverage: float = 0.0  # Ratio of sentence words found in elements
    
    def to_dict(self) -> Dict:
        """Convert SentenceMatch to JSON-serializable dictionary."""
        return {
            'sentence_id': self.sentence_id,
            'sentence_text': self.sentence_text,
            'page_number': self.page_number,
            'matched_elements': self.matched_elements,
            'consumed_words': {str(k): list(v) for k, v in self.consumed_words.items()},
            'confidence': self.confidence,
            'match_method': self.match_method,
            'character_coverage': self.character_coverage,
            'word_coverage': self.word_coverage,
            'bounding_box': self.bounding_box
        }

class PDFJSElementMatcher:
    def __init__(self, 
                 pdfjs_cache_dir: str, 
                 sentence_mappings_dir: str,
                 sentences_dir: str,
                 output_dir: str):
        """
        Initialize the PDF.js element matcher.
        
        Args:
            pdfjs_cache_dir: Directory containing cached PDF.js data
            sentence_mappings_dir: Directory containing sentence-to-page mappings
            sentences_dir: Directory containing extracted sentences
            output_dir: Directory to save the final stable mappings
        """
        self.pdfjs_cache_dir = Path(pdfjs_cache_dir)
        self.sentence_mappings_dir = Path(sentence_mappings_dir)
        self.sentences_dir = Path(sentences_dir)
        self.output_dir = Path(output_dir)
        
        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Configuration for matching
        self.min_confidence_threshold = 0.7
        self.fuzzy_match_threshold = 0.8
        self.word_overlap_threshold = 0.6
        self.min_word_coverage = 0.4  # Minimum ratio of sentence words that must be found
        
        # Element consumption tracking (per page)
        self.element_consumption: Dict[int, Dict[int, ElementConsumption]] = {}
    
    def process_document(self, document_basename: str) -> bool:
        """
        Process a single document to create sentence-to-element mappings.
        
        Args:
            document_basename: Base name of document (without .pdf extension)
            
        Returns:
            bool: True if processing succeeded
        """
        try:
            print(f"🔍 Processing PDF.js element matching for: {document_basename}")
            
            # Load required data
            sentences = self._load_sentences(document_basename)
            page_mappings = self._load_page_mappings(document_basename)
            pdfjs_data = self._load_pdfjs_cache(document_basename)
            
            if not all([sentences, page_mappings, pdfjs_data]):
                print(f"❌ Missing required data for {document_basename}")
                return False
            
            # Create sentence-to-element mappings
            stable_mappings = self._create_stable_mappings(
                sentences, page_mappings, pdfjs_data
            )
            
            # Save results
            self._save_stable_mappings(document_basename, stable_mappings)
            
            print(f"✅ Successfully created stable mappings for {document_basename}")
            return True
            
        except Exception as e:
            print(f"❌ Error processing {document_basename}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    def _load_sentences(self, basename: str) -> Optional[List[str]]:
        """Load extracted sentences."""
        sentences_path = self.sentences_dir / f"{basename}_sentences.json"
        if not sentences_path.exists():
            print(f"⚠️ Sentences file not found: {sentences_path}")
            return None
            
        with open(sentences_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_page_mappings(self, basename: str) -> Optional[List[Dict]]:
        """Load sentence-to-page mappings."""
        mappings_path = self.sentence_mappings_dir / f"{basename}_sentence_page_mappings.json"
        if not mappings_path.exists():
            print(f"⚠️ Page mappings file not found: {mappings_path}")
            return None
            
        with open(mappings_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Handle the correct format where sentence_mappings is a list
            if isinstance(data, dict) and 'sentence_mappings' in data:
                return data['sentence_mappings']
            elif isinstance(data, list):
                return data
            else:
                print(f"⚠️ Unexpected format in mappings file: {mappings_path}")
                return None
    
    def _load_pdfjs_cache(self, basename: str) -> Optional[Dict[int, List[PDFJSElement]]]:
        """Load cached PDF.js data for all pages."""
        cache_dir = self.pdfjs_cache_dir / basename
        if not cache_dir.exists():
            print(f"⚠️ PDF.js cache directory not found: {cache_dir}")
            return None
        
        pdfjs_data = {}
        page_files = sorted(cache_dir.glob("page_*.json"))
        
        for page_file in page_files:
            # Extract page number from filename (e.g., page_001.json -> 1)
            page_match = re.search(r'page_(\d+)\.json', page_file.name)
            if not page_match:
                continue
                
            page_num = int(page_match.group(1))
            
            try:
                with open(page_file, 'r', encoding='utf-8') as f:
                    page_data = json.load(f)
                
                # Convert to PDFJSElement objects
                elements = []
                stable_items = page_data.get('stableItems', [])
                
                for item in stable_items:
                    element = PDFJSElement(
                        stable_index=item['stableIndex'],
                        page_number=page_num,
                        text=item['str'],
                        normalized_text=item.get('normalizedText', item['str'].lower()),
                        x=item['x'],
                        y=item['y'],
                        width=item['width'],
                        height=item['height'],
                        font_name=item.get('fontName', ''),
                        font_size=item.get('fontSize', 0),
                        reading_order_index=item.get('reading_order_index', 0),
                        identifiers=item.get('identifiers', {}),
                        is_whitespace_only=item.get('isWhitespaceOnly', False),
                        has_significant_text=item.get('hasSignificantText', True)
                    )
                    elements.append(element)
                
                # Sort by reading order
                elements.sort(key=lambda x: x.reading_order_index)
                pdfjs_data[page_num] = elements
                
            except Exception as e:
                print(f"⚠️ Error loading page {page_num}: {str(e)}")
                continue
        
        return pdfjs_data if pdfjs_data else None
    
    def _create_stable_mappings(self, 
                               sentences: List[str], 
                               page_mappings: List[Dict], 
                               pdfjs_data: Dict[int, List[PDFJSElement]]) -> Dict:
        """Create the final sentence-to-element stable mappings."""
        
        # Initialize element consumption tracking for all pages
        self._initialize_element_consumption(pdfjs_data)
        
        sentence_mappings = {}
        statistics = {
            'total_sentences': len(sentences),
            'mapped_sentences': 0,
            'mapping_methods': {},
            'average_confidence': 0.0,
            'total_stable_items': sum(len(elements) for elements in pdfjs_data.values()),
            'consumption_stats': {}
        }
        
        # Create a lookup dictionary for page mappings by sentence_id
        page_mapping_lookup = {}
        for mapping in page_mappings:
            sentence_id = mapping['sentence_id']
            page_mapping_lookup[sentence_id] = mapping
        
        # Process sentences in order to ensure proper consumption tracking
        for sentence_id in range(len(sentences)):
            sentence_text = sentences[sentence_id]
            sentence_id_str = str(sentence_id)
            
            # Get page assignment for this sentence
            page_info = page_mapping_lookup.get(sentence_id)
            if not page_info:
                sentence_mappings[sentence_id_str] = {
                    'sentence_id': sentence_id,
                    'sentence_text': sentence_text,
                    'found': False,
                    'reason': 'no_page_mapping'
                }
                continue
                
            # Get the pages this sentence appears on (could be multiple)
            sentence_pages = page_info.get('pages', [])
            if not sentence_pages:
                sentence_mappings[sentence_id_str] = {
                    'sentence_id': sentence_id,
                    'sentence_text': sentence_text,
                    'found': False,
                    'reason': 'no_pages_assigned'
                }
                continue
            
            # Try to match on pages in order, prioritizing first page
            best_match = None
            for page_number in sentence_pages:
                # Get PDF.js elements for this page
                page_elements = pdfjs_data.get(page_number, [])
                if not page_elements:
                    continue
                
                all_candidates = []
                
                # Try exact sequential match (this should catch our example case)
                exact_match = self._try_exact_sequential_match_ignore_consumption(
                    sentence_id, sentence_text, page_elements, page_number
                )

                if exact_match:
                    exact_match.confidence = min(0.99, exact_match.confidence + 0.1)
                    exact_match.match_method += "_assigned_page"
                    all_candidates.append(exact_match)
                    print(f"🎯 Found exact match on page {page_number} (confidence: {exact_match.confidence:.3f})")
        
                if all_candidates:
                    best_exact = max(all_candidates, key=lambda x: x.confidence)
                    # If we have a high-confidence exact match, use it
                    if best_exact.confidence >= 0.95:
                        best_match = best_exact
                        break
                
                # Find matching elements using consumption-aware matching
                match_result = self._match_sentence_to_elements_with_consumption(
                    sentence_id, sentence_text, page_elements, page_number
                )
                
                if match_result and (best_match is None or match_result.confidence > best_match.confidence):
                    best_match = match_result
                    # If we found a good match on the first page, prefer it
                    if page_number == sentence_pages[0] and match_result.confidence >= self.min_confidence_threshold:
                        break
            
            # If single-page matching failed but we have multiple pages, try cross-page matching
            if (not best_match or best_match.word_coverage < self.min_word_coverage) and len(sentence_pages) > 1:
                cross_page_match = self._try_cross_page_match(
                    sentence_id, sentence_text, sentence_pages, pdfjs_data
                )
                
                if cross_page_match and (best_match is None or cross_page_match.confidence > best_match.confidence):
                    best_match = cross_page_match
            
            if best_match:
                # Consume the words from the matched elements
                self._consume_words_from_match(best_match)
                
                # **FIXED: Convert sets to lists for JSON serialization**
                consumed_words_serializable = {}
                for stable_idx, word_set in best_match.consumed_words.items():
                    consumed_words_serializable[str(stable_idx)] = list(word_set) if isinstance(word_set, set) else word_set
                
                sentence_mappings[sentence_id_str] = {
                    'sentence_id': sentence_id,
                    'sentence_text': sentence_text,
                    'page_number': best_match.page_number,
                    'all_pages': sentence_pages,
                    'spans_multiple_pages': len(sentence_pages) > 1 and best_match.match_method == 'cross_page_match',
                    'found': True,
                    'stable_elements': self._format_stable_elements_with_consumption(
                        best_match.matched_elements, 
                        self._get_all_elements_for_match(best_match, pdfjs_data),
                        best_match.consumed_words
                    ),
                    'confidence': best_match.confidence,
                    'match_method': best_match.match_method,
                    'character_coverage': best_match.character_coverage,
                    'word_coverage': best_match.word_coverage,
                    'bounding_box': best_match.bounding_box,
                    'element_count': len(best_match.matched_elements),
                    'words_consumed': consumed_words_serializable,
                    'cross_page_elements': self._get_cross_page_element_breakdown(best_match, sentence_pages, pdfjs_data) if best_match.match_method == 'cross_page_match' else None
                }
                
                statistics['mapped_sentences'] += 1
                method = best_match.match_method
                statistics['mapping_methods'][method] = statistics['mapping_methods'].get(method, 0) + 1
            else:
                sentence_mappings[sentence_id_str] = {
                    'sentence_id': sentence_id,
                    'sentence_text': sentence_text,
                    'page_number': sentence_pages[0] if sentence_pages else None,
                    'all_pages': sentence_pages,
                    'found': False,
                    'reason': 'no_available_elements_after_consumption'
                }
        
        # Calculate consumption statistics
        statistics['consumption_stats'] = self._calculate_consumption_stats()
        
        # Calculate average confidence
        if statistics['mapped_sentences'] > 0:
            total_confidence = sum(
                mapping.get('confidence', 0) 
                for mapping in sentence_mappings.values() 
                if mapping.get('found', False)
            )
            statistics['average_confidence'] = total_confidence / statistics['mapped_sentences']
        
        statistics['mapping_rate'] = statistics['mapped_sentences'] / statistics['total_sentences']
        
        return {
            'sentence_mappings': sentence_mappings,
            'statistics': statistics,
            'metadata': {
                'total_pages': len(pdfjs_data),
                'processing_version': '1.0',
                'min_confidence_threshold': self.min_confidence_threshold,
                'consumption_tracking_enabled': True
            }
        }
    
    def _try_exact_sequential_match_ignore_consumption(self, 
                                                     sentence_id: int, 
                                                     sentence_text: str, 
                                                     page_elements: List[PDFJSElement],
                                                     page_number: int) -> Optional[SentenceMatch]:
        """
        **NEW: Exact sequential matching that IGNORES consumption for reservation phase**
        
        This method finds exact text matches without considering element consumption.
        Used in the pre-pass to identify high-value exact matches that should be reserved.
        """
        
        sentence_clean = self._normalize_text(sentence_text)
        sentence_words = set(sentence_clean.split())
        
        # **SAFETY CHECK: Handle empty sentences**
        if not sentence_clean.strip() or not sentence_words:
            return None
        
        # Build text using ALL elements (ignore consumption)
        available_text_parts = []
        element_word_map = {}  # Maps words to elements
        available_elements = []
        
        for element in page_elements:
            if element.is_whitespace_only or not element.has_significant_text:
                continue
            
            # Use full text (ignore consumption)
            element_text = element.text
            available_words = self._normalize_text(element.text).split()
            
            if element_text.strip():
                available_text_parts.append(element_text)
                available_elements.append(element)
                
                # Map words to this element
                for word in available_words:
                    element_word_map[word] = element.stable_index
        
        # Check for exact match in full text
        available_text = ' '.join(available_text_parts)
        available_text_clean = self._normalize_text(available_text)
        
        if sentence_clean in available_text_clean:
            # Found exact match! Now find which elements contribute
            matched_elements = []
            consumed_words = {}
            
            # For exact matches, map all sentence words to their elements
            for word in sentence_words:
                if word in element_word_map:
                    stable_index = element_word_map[word]
                    if stable_index not in consumed_words:
                        consumed_words[stable_index] = set()
                        matched_elements.append(stable_index)
                    consumed_words[stable_index].add(word)
            
            if matched_elements:
                bounding_box = self._calculate_bounding_box(matched_elements, page_elements)
                
                # Calculate coverage
                available_sentence_words = sentence_words.intersection(set(element_word_map.keys()))
                word_coverage = len(available_sentence_words) / len(sentence_words) if len(sentence_words) > 0 else 0.0
                
                return SentenceMatch(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    page_number=page_number,
                    matched_elements=matched_elements,
                    consumed_words=consumed_words,
                    confidence=0.99,  # Very high confidence for exact matches
                    match_method='exact_sequential_match_no_consumption',
                    character_coverage=1.0,
                    word_coverage=word_coverage,
                    bounding_box=bounding_box
                )
        
        return None
        """
        **FIXED: Improved exact sequential matching that handles consumption and division by zero**
        
        This method tries to find exact text matches while respecting element consumption.
        """
        
        sentence_clean = self._normalize_text(sentence_text)
        sentence_words = set(sentence_clean.split())
        
        # **SAFETY CHECK: Handle empty sentences**
        if not sentence_clean.strip() or not sentence_words:
            print(f"⚠️ Empty or invalid sentence {sentence_id}: '{sentence_text[:100] if sentence_text else 'None'}...'")
            return None
        
        # Get consumption state for this page
        page_consumption = self.element_consumption.get(page_number, {})
        
        # Build text using only available (unconsumed) parts of elements
        available_text_parts = []
        element_word_map = {}  # Maps position in available text to element
        available_elements = []
        
        for element in page_elements:
            if element.is_whitespace_only or not element.has_significant_text:
                continue
            
            consumption = page_consumption.get(element.stable_index)
            if consumption and consumption.remaining_words:
                # Use only remaining words
                available_words = sorted(consumption.remaining_words)
                element_text = ' '.join(available_words)
            else:
                # Element not consumed yet, use full text
                element_text = element.text
                available_words = self._normalize_text(element.text).split()
            
            if element_text.strip():
                available_text_parts.append(element_text)
                available_elements.append(element)
                
                # Map words to this element
                for word in available_words:
                    element_word_map[word] = element.stable_index
        
        # Check for exact match in available text
        available_text = ' '.join(available_text_parts)
        available_text_clean = self._normalize_text(available_text)
        
        if sentence_clean in available_text_clean:
            # Found exact match! Now find which elements contribute
            matched_elements = []
            consumed_words = {}
            
            # For exact matches, consume all sentence words from matching elements
            for word in sentence_words:
                if word in element_word_map:
                    stable_index = element_word_map[word]
                    if stable_index not in consumed_words:
                        consumed_words[stable_index] = set()
                        matched_elements.append(stable_index)
                    consumed_words[stable_index].add(word)
            
            if matched_elements:
                bounding_box = self._calculate_bounding_box(matched_elements, page_elements)
                
                # **FIXED: Prevent division by zero**
                available_sentence_words = sentence_words.intersection(set(element_word_map.keys()))
                word_coverage = len(available_sentence_words) / len(sentence_words) if len(sentence_words) > 0 else 0.0
                
                return SentenceMatch(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    page_number=page_number,
                    matched_elements=matched_elements,
                    consumed_words=consumed_words,
                    confidence=0.98,  # High confidence for exact matches
                    match_method='exact_sequential_match',
                    character_coverage=1.0,
                    word_coverage=word_coverage,
                    bounding_box=bounding_box
                )
        
        return None
    
    def _initialize_element_consumption(self, pdfjs_data: Dict[int, List[PDFJSElement]]):
        """Initialize consumption tracking for all elements."""
        self.element_consumption = {}
        
        for page_number, elements in pdfjs_data.items():
            self.element_consumption[page_number] = {}
            
            for element in elements:
                if not element.is_whitespace_only and element.has_significant_text:
                    self.element_consumption[page_number][element.stable_index] = ElementConsumption(
                        stable_index=element.stable_index,
                        page_number=page_number,
                        original_text=element.text
                    )
    
    def _get_all_elements_for_match(self, 
                                   match: SentenceMatch, 
                                   pdfjs_data: Dict[int, List[PDFJSElement]]) -> List[PDFJSElement]:
        """Get all PDF.js elements involved in a match, potentially across pages."""
        all_elements = []
        
        if match.match_method == 'cross_page_match':
            # Collect elements from all relevant pages
            for page_number, page_elements in pdfjs_data.items():
                for element in page_elements:
                    if element.stable_index in match.matched_elements:
                        all_elements.append(element)
        else:
            # Single page match
            page_elements = pdfjs_data.get(match.page_number, [])
            all_elements = [elem for elem in page_elements 
                           if elem.stable_index in match.matched_elements]
        
        return all_elements
    
    def _get_cross_page_element_breakdown(self, 
                                         match: SentenceMatch, 
                                         sentence_pages: List[int],
                                         pdfjs_data: Dict[int, List[PDFJSElement]]) -> Dict:
        """Get a breakdown of which elements are on which pages for cross-page matches."""
        breakdown = {}
        
        for page_number in sentence_pages:
            page_elements = pdfjs_data.get(page_number, [])
            page_element_indices = []
            page_consumed_words = {}
            
            for element in page_elements:
                if element.stable_index in match.matched_elements:
                    page_element_indices.append(element.stable_index)
                    if element.stable_index in match.consumed_words:
                        # **FIXED: Convert sets to lists for JSON serialization**
                        word_set = match.consumed_words[element.stable_index]
                        page_consumed_words[element.stable_index] = list(word_set) if isinstance(word_set, set) else word_set
            
            if page_element_indices:
                breakdown[f'page_{page_number}'] = {
                    'elements': page_element_indices,
                    'words_consumed': page_consumed_words,
                    'element_count': len(page_element_indices)
                }
        
        return breakdown
    
    def _consume_words_from_match(self, match: SentenceMatch):
        """Consume words from elements based on the match result, handling cross-page matches."""
        if match.match_method == 'cross_page_match':
            # For cross-page matches, we need to consume from multiple pages
            for stable_index, words_to_consume in match.consumed_words.items():
                # Find which page this element belongs to
                element_page = None
                for page_number, page_consumption in self.element_consumption.items():
                    if stable_index in page_consumption:
                        element_page = page_number
                        break
                
                if element_page and stable_index in self.element_consumption[element_page]:
                    self.element_consumption[element_page][stable_index].consume_words(
                        words_to_consume, match.sentence_id
                    )
        else:
            # Single page consumption (original logic)
            page_consumption = self.element_consumption.get(match.page_number, {})
            
            for stable_index, words_to_consume in match.consumed_words.items():
                if stable_index in page_consumption:
                    page_consumption[stable_index].consume_words(words_to_consume, match.sentence_id)
    
    def _calculate_consumption_stats(self) -> Dict:
        """Calculate statistics about element consumption."""
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
        
        for page_number, page_consumption in self.element_consumption.items():
            page_stats = {
                'total_elements': len(page_consumption),
                'fully_consumed': 0,
                'partially_consumed': 0,
                'unused': 0,
                'average_consumption_ratio': 0.0
            }
            
            page_consumption_total = 0.0
            
            for element_consumption in page_consumption.values():
                ratio = element_consumption.get_consumption_ratio()
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
    
    def _match_sentence_to_elements_with_consumption(self, 
                                                   sentence_id: int, 
                                                   sentence_text: str, 
                                                   page_elements: List[PDFJSElement],
                                                   page_number: int) -> Optional[SentenceMatch]:
        """Match a sentence to PDF.js elements considering consumption state."""
        
        sentence_words = set(self._normalize_text(sentence_text).split())
        if len(sentence_words) == 0:
            return None
        
        page_consumption = self.element_consumption.get(page_number, {})
        
        # Strategy 1: Try sequential matching with available words only
        match = self._try_sequential_match_with_consumption(
            sentence_id, sentence_text, sentence_words, page_elements, page_consumption
        )
        if match and match.confidence >= self.min_confidence_threshold:
            return match
        
        # Strategy 2: Word-based matching considering available words
        match = self._try_word_based_match_with_consumption(
            sentence_id, sentence_text, sentence_words, page_elements, page_consumption
        )
        if match and match.word_coverage >= self.min_word_coverage:
            return match
        
        return None
    
    def _try_cross_page_match(self, 
                             sentence_id: int, 
                             sentence_text: str, 
                             sentence_pages: List[int], 
                             pdfjs_data: Dict[int, List[PDFJSElement]]) -> Optional[SentenceMatch]:
        """
        Try to match a sentence across multiple pages.
        This is called when single-page matching fails but the sentence is assigned to multiple pages.
        """
        
        sentence_words = set(self._normalize_text(sentence_text).split())
        if len(sentence_words) == 0:
            return None
        
        cross_page_elements = []
        cross_page_consumed = {}
        total_word_coverage = 0
        last_page_y_position = float('inf')  # Track reading order across pages
        
        for page_number in sentence_pages:
            page_elements = pdfjs_data.get(page_number, [])
            if not page_elements:
                continue
                
            page_consumption = self.element_consumption.get(page_number, {})
            page_matched_elements = []
            page_consumed_words = {}
            page_matched_words = set()
            
            # Find best matching elements on this page
            for element in page_elements:
                if element.is_whitespace_only or not element.has_significant_text:
                    continue
                    
                consumption = page_consumption.get(element.stable_index)
                if consumption and consumption.remaining_words:
                    available_words = consumption.remaining_words
                else:
                    available_words = set(self._normalize_text(element.text).split())
                
                # Check overlap with remaining sentence words
                remaining_sentence_words = sentence_words - page_matched_words
                overlap = remaining_sentence_words.intersection(available_words)
                
                if overlap:
                    # Check reading order continuity for cross-page sentences
                    if self._is_valid_cross_page_continuation(
                        element, page_number, last_page_y_position, sentence_pages
                    ):
                        page_matched_elements.append(element.stable_index)
                        page_consumed_words[element.stable_index] = overlap
                        page_matched_words.update(overlap)
                        
                        # Update last position for reading order checking
                        if page_number > sentence_pages[0]:  # Not the first page
                            last_page_y_position = min(last_page_y_position, element.y)
            
            if page_matched_elements:
                cross_page_elements.extend(page_matched_elements)
                cross_page_consumed.update(page_consumed_words)
                
                # Calculate coverage so far
                all_matched_words = set()
                for words in cross_page_consumed.values():
                    all_matched_words.update(words)
                # **FIXED: Prevent division by zero**
                total_word_coverage = len(all_matched_words) / len(sentence_words) if len(sentence_words) > 0 else 0.0
                
                # If we have good coverage, we can stop
                if total_word_coverage >= 0.8:
                    break
        
        if cross_page_elements and total_word_coverage >= self.min_word_coverage:
            # Calculate bounding box across pages (this is tricky, so we'll use the first page)
            first_page_elements = [idx for idx in cross_page_elements 
                                 if any(elem.stable_index == idx 
                                       for elem in pdfjs_data.get(sentence_pages[0], []))]
            
            if first_page_elements:
                bounding_box = self._calculate_bounding_box(
                    first_page_elements, pdfjs_data[sentence_pages[0]]
                )
            else:
                bounding_box = {'x': 0, 'y': 0, 'width': 0, 'height': 0}
            
            return SentenceMatch(
                sentence_id=sentence_id,
                sentence_text=sentence_text,
                page_number=sentence_pages[0],  # Primary page
                matched_elements=cross_page_elements,
                consumed_words=cross_page_consumed,
                confidence=0.85 * total_word_coverage,  # Slightly lower confidence for cross-page
                match_method='cross_page_match',
                character_coverage=total_word_coverage,
                word_coverage=total_word_coverage,
                bounding_box=bounding_box
            )
        
        return None
    
    def _is_valid_cross_page_continuation(self, 
                                        element: PDFJSElement, 
                                        page_number: int, 
                                        last_page_y_position: float,
                                        sentence_pages: List[int]) -> bool:
        """
        Check if an element represents a valid continuation of a cross-page sentence.
        
        Args:
            element: The PDF.js element to check
            page_number: Current page number
            last_page_y_position: Y position of last matched element on previous page
            sentence_pages: List of pages this sentence spans
            
        Returns:
            bool: True if this element could be a valid continuation
        """
        
        # For the first page, any element is valid
        if page_number == sentence_pages[0]:
            return True
        
        # For subsequent pages, check reading order
        # Element should be near the top of the page (reasonable continuation)
        page_height = 800  # Approximate page height, adjust based on your PDFs
        top_quarter_threshold = page_height * 0.75  # PDF coordinates are bottom-up
        
        # Element should be in the top portion of the page for cross-page continuation
        if element.y >= top_quarter_threshold:
            return True
        
        # Also allow if this element is positioned logically after the last element
        # (taking into account that we're on a new page)
        return True  # For now, be permissive
    
    def _try_sequential_match_with_consumption(self, 
                                             sentence_id: int, 
                                             sentence_text: str, 
                                             sentence_words: Set[str],
                                             page_elements: List[PDFJSElement],
                                             page_consumption: Dict[int, ElementConsumption]) -> Optional[SentenceMatch]:
        """Try sequential matching considering what words are still available."""
        
        # Build available text from elements that still have unconsumed words
        available_text_parts = []
        element_word_map = {}  # Maps word positions to stable_index
        
        word_position = 0
        for element in page_elements:
            if element.is_whitespace_only or not element.has_significant_text:
                continue
                
            consumption = page_consumption.get(element.stable_index)
            if consumption:
                available_words = consumption.remaining_words
                if available_words:
                    element_text = ' '.join(sorted(available_words))  # Sort for consistency
                    available_text_parts.append(element_text)
                    
                    # Map each word to this element
                    for word in available_words:
                        element_word_map[word] = element.stable_index
            else:
                # Element not tracked, assume all words available
                element_words = set(self._normalize_text(element.text).split())
                available_text_parts.append(element.text)
                for word in element_words:
                    element_word_map[word] = element.stable_index
        
        available_text = ' '.join(available_text_parts)
        sentence_clean = self._normalize_text(sentence_text)
        
        # Check if sentence can be found in available text
        if sentence_clean in available_text:
            # Find which words from the sentence are available
            available_sentence_words = sentence_words.intersection(set(element_word_map.keys()))
            
            # **FIXED: Prevent division by zero**
            word_coverage_ratio = len(available_sentence_words) / len(sentence_words) if len(sentence_words) > 0 else 0.0
            
            if word_coverage_ratio >= self.min_word_coverage:
                # Map words to elements
                consumed_words = {}
                matched_elements = set()
                
                for word in available_sentence_words:
                    stable_index = element_word_map[word]
                    matched_elements.add(stable_index)
                    
                    if stable_index not in consumed_words:
                        consumed_words[stable_index] = set()
                    consumed_words[stable_index].add(word)
                
                bounding_box = self._calculate_bounding_box(list(matched_elements), page_elements)
                
                return SentenceMatch(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    page_number=page_elements[0].page_number,
                    matched_elements=list(matched_elements),
                    consumed_words=consumed_words,
                    confidence=0.95 * word_coverage_ratio,  # Scale confidence by coverage
                    match_method='sequential_consumption_aware',
                    character_coverage=word_coverage_ratio,
                    word_coverage=word_coverage_ratio,
                    bounding_box=bounding_box
                )
        
        return None
    
    def _try_word_based_match_with_consumption(self, 
                                             sentence_id: int, 
                                             sentence_text: str, 
                                             sentence_words: Set[str],
                                             page_elements: List[PDFJSElement],
                                             page_consumption: Dict[int, ElementConsumption]) -> Optional[SentenceMatch]:
        """Try word-based matching considering consumption state."""
        
        matched_elements = []
        consumed_words = {}
        total_available_words = set()
        
        for element in page_elements:
            if element.is_whitespace_only or not element.has_significant_text:
                continue
                
            consumption = page_consumption.get(element.stable_index)
            if consumption and consumption.remaining_words:
                available_words = consumption.remaining_words
            else:
                # Element not tracked or no consumption tracking, use all words
                available_words = set(self._normalize_text(element.text).split())
            
            total_available_words.update(available_words)
            
            # Check overlap with sentence words
            overlap = sentence_words.intersection(available_words)
            
            if overlap:
                matched_elements.append(element.stable_index)
                consumed_words[element.stable_index] = overlap
        
        if matched_elements:
            # Calculate how much of the sentence we can cover
            all_matched_words = set()
            for words in consumed_words.values():
                all_matched_words.update(words)
            
            # **FIXED: Prevent division by zero**
            word_coverage = len(all_matched_words) / len(sentence_words) if len(sentence_words) > 0 else 0.0
            
            if word_coverage >= self.min_word_coverage:
                bounding_box = self._calculate_bounding_box(matched_elements, page_elements)
                
                return SentenceMatch(
                    sentence_id=sentence_id,
                    sentence_text=sentence_text,
                    page_number=page_elements[0].page_number,
                    matched_elements=matched_elements,
                    consumed_words=consumed_words,
                    confidence=word_coverage,
                    match_method='word_based_consumption_aware',
                    character_coverage=word_coverage,
                    word_coverage=word_coverage,
                    bounding_box=bounding_box
                )
        
        return None
    
    def _calculate_bounding_box(self, 
                               stable_indices: List[int], 
                               page_elements: List[PDFJSElement]) -> Dict:
        """Calculate bounding box for a set of elements."""
        elements = [elem for elem in page_elements if elem.stable_index in stable_indices]
        
        if not elements:
            return {'x': 0, 'y': 0, 'width': 0, 'height': 0}
        
        min_x = min(elem.x for elem in elements)
        min_y = min(elem.y for elem in elements)
        max_x = max(elem.x + elem.width for elem in elements)
        max_y = max(elem.y + elem.height for elem in elements)
        
        return {
            'x': min_x,
            'y': min_y,
            'width': max_x - min_x,
            'height': max_y - min_y
        }
    
    def _format_stable_elements_with_consumption(self, 
                                               stable_indices: List[int], 
                                               page_elements: List[PDFJSElement],
                                               consumed_words: Dict[int, Set[str]]) -> List[Dict]:
        """Format stable elements for output including consumption information."""
        formatted_elements = []
        
        for stable_index in stable_indices:
            element = next((elem for elem in page_elements if elem.stable_index == stable_index), None)
            if element:
                # **FIXED: Convert sets to lists for JSON serialization**
                word_set = consumed_words.get(stable_index, set())
                words_consumed = list(word_set) if isinstance(word_set, set) else word_set
                
                # **FIXED: Prevent division by zero**
                element_words = self._normalize_text(element.text).split()
                consumption_ratio = len(words_consumed) / len(element_words) if len(element_words) > 0 else 0.0
                
                formatted_elements.append({
                    'stable_index': element.stable_index,
                    'page': element.page_number,
                    'text': element.text,
                    'words_consumed': words_consumed,
                    'consumption_ratio': consumption_ratio,
                    'coordinates': {
                        'x': element.x,
                        'y': element.y,
                        'width': element.width,
                        'height': element.height
                    },
                    'font_info': {
                        'font_name': element.font_name,
                        'font_size': element.font_size
                    },
                    'identifiers': element.identifiers,
                    'reading_order_index': element.reading_order_index
                })
        
        return formatted_elements
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching."""
        if not text:
            return ""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        # Convert to lowercase and remove punctuation for better matching
        text = re.sub(r'[^\w\s]', '', text.lower())
        return text
    
    def _save_stable_mappings(self, basename: str, mappings: Dict):
        """Save the stable mappings to file."""
        output_path = self.output_dir / f"{basename}_stable_mappings.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(mappings, f, indent=2, ensure_ascii=False)


# Integration function for processing all documents
def process_all_documents(config: Dict[str, str]):
    """Process all documents in the system."""
    
    matcher = PDFJSElementMatcher(
        pdfjs_cache_dir=config['pdfjs_cache_dir'],
        sentence_mappings_dir=config['sentence_mappings_dir'],
        sentences_dir=config['sentences_dir'],
        output_dir=config['output_dir']
    )
    
    # Find all documents that have both sentences and page mappings
    sentences_dir = Path(config['sentences_dir'])
    sentence_files = list(sentences_dir.glob("*_sentences.json"))
    
    print(f"🔍 Found {len(sentence_files)} documents to process")
    
    success_count = 0
    for sentence_file in sentence_files:
        basename = sentence_file.name.replace('_sentences.json', '')
        
        if matcher.process_document(basename):
            success_count += 1
    
    print(f"✅ Successfully processed {success_count}/{len(sentence_files)} documents")


# Example usage
if __name__ == "__main__":
    config = {
        'pdfjs_cache_dir': 'pdfjs_cache',
        'sentence_mappings_dir': 'sentence_page_mappings',
        'sentences_dir': 'sentences',
        'output_dir': 'stable_mappings'
    }
    
    process_all_documents(config)