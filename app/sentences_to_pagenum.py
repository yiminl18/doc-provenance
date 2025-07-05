"""
Enhanced Coordinate-Aware Sentence Extraction with Non-Overlapping Element Mapping
Maps sentences to discrete, non-overlapping layout elements for precise PDF highlighting
"""

from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams, LTTextContainer, LTTextBox, LTTextLine, LTChar
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator
from werkzeug.utils import secure_filename
import nltk
import json
import os
from pathlib import Path
import re
import time
from typing import List, Dict, Tuple, Optional, Set
from dataclasses import dataclass, field
from collections import defaultdict
import difflib

from laparams_optimizer import LAParamsConfig, LAParamsOptimizer, ExtractionMetrics

# Ensure NLTK data is available
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt', quiet=True)


def extract_text_from_pdf_original(pdf_path):
    """Use your EXACT original method for text extraction"""
    return extract_text(pdf_path)

def merge_short_sentences_original(sentences, length=30):
    """Use your EXACT original merge logic"""
    merged = []
    i = 0
    n = len(sentences)
   
    while i < n:
        current = sentences[i]
       
        if len(current) >= length:
            merged.append(current)
            i += 1
        else:
            if not merged and i < n - 1:
                sentences[i + 1] = current + " " + sentences[i + 1]
                i += 1
            elif i == n - 1:
                if merged:
                    merged[-1] = merged[-1] + " " + current
                else:
                    merged.append(current)
                i += 1
            else:
                previous = merged[-1] if merged else ""
                next_sent = sentences[i + 1]
               
                if len(previous) <= len(next_sent):
                    merged[-1] = previous + " " + current
                    i += 1
                else:
                    sentences[i + 1] = current + " " + next_sent
                    i += 1
    return merged

def extract_sentences_from_pdf_original(pdf_path):
    """Use your EXACT original sentence extraction pipeline"""
    text = extract_text_from_pdf_original(pdf_path)
    sentences = nltk.sent_tokenize(text)
    sentences = merge_short_sentences_original(sentences)
    return text, sentences


@dataclass
class WordMatch:
    """Represents a word match within a layout element"""
    word: str
    start_pos: int
    end_pos: int
    sentence_id: int

@dataclass
class LayoutElement:
    """Layout element with word-level tracking"""
    element_id: str
    text: str
    page: int
    bbox: Tuple[float, float, float, float]  # x0, y0, x1, y1
    element_type: str
    reading_order: int
    words: List[str] = field(default_factory=list)
    matched_words: Set[str] = field(default_factory=set)
    word_matches: List[WordMatch] = field(default_factory=list)
    
    def __post_init__(self):
        if not self.words:
            # Extract words from text
            self.words = re.findall(r'\b\w+\b', self.text.lower())
    
    def get_available_words(self) -> Set[str]:
        """Get words that haven't been matched yet"""
        return set(self.words) - self.matched_words
    
    def add_word_match(self, word: str, sentence_id: int) -> bool:
        """Add a word match if the word is available"""
        if word.lower() in self.get_available_words():
            self.matched_words.add(word.lower())
            
            # Find position of word in text
            start_pos = self.text.lower().find(word.lower())
            end_pos = start_pos + len(word) if start_pos >= 0 else -1
            
            match = WordMatch(
                word=word,
                start_pos=start_pos,
                end_pos=end_pos,
                sentence_id=sentence_id
            )
            self.word_matches.append(match)
            return True
        return False
    

class SentencePageWordMapper:
    """
    Map sentences to pages using layout elements with word-level sharing
    """
    
    def __init__(self, pdf_path: str, verbose: bool = False):
        self.pdf_path = pdf_path
        self.verbose = verbose
        self.base_name = secure_filename(os.path.splitext(os.path.basename(pdf_path))[0])
        
        # Load data
        self.sentences = self._load_sentences()
        self.layout_elements = self._extract_layout_elements_in_reading_order()
        
        # Results
        self.sentence_mappings: List[Dict] = []
        self.unmapped_sentences: List[Dict] = []
        
    def log(self, message: str):
        if self.verbose:
            print(f"📖 {message}")
    
    def _load_sentences(self) -> List[str]:
        """Load sentences from existing sentences file"""

        extracted_sentences = extract_sentences_from_pdf_original(self.pdf_path)[1]
        self.log(f"Loaded {len(extracted_sentences)} sentences from original extraction")
        sentences_layouts_path = os.path.join("layouts", f"{self.base_name}_sentences.json")
        if not os.path.exists(sentences_layouts_path):
            self.log(f"❌ Sentences layouts file not found: {sentences_layouts_path}")
        else:
            with open(sentences_layouts_path, 'r', encoding='utf-8') as f:
               layout_sentences = json.load(f)
               self.log(f"Loaded {len(layout_sentences)} sentences from {sentences_layouts_path}")

        sentences_path = os.path.join("sentences", f"{self.base_name}_sentences.json")

        if not os.path.exists(sentences_path):
            self.log(f"❌ Sentences file not found: {sentences_path}")
            with open(sentences_path, 'w', encoding='utf-8') as f:
                json.dump(extracted_sentences, f, indent=2, ensure_ascii=False)
        else:
            with open(sentences_path, 'r', encoding='utf-8') as f:
                sentences = json.load(f)
                self.log(f"Loaded {len(sentences)} sentences from {sentences_path}")
                if len(sentences) > len(extracted_sentences):
                    with open(sentences_path, 'w', encoding='utf-8') as f:
                        json.dump(extracted_sentences, f, indent=2, ensure_ascii=False)
      
        return extracted_sentences
    
    def _extract_layout_elements_in_reading_order(self) -> List[LayoutElement]:
        """Extract layout elements in the same order as PDFMiner's extract_text"""
        self.log("Extracting layout elements in reading order...")
        
        try:
            with open(self.pdf_path, 'rb') as fp:
                # Use default LAParams to match extract_text behavior
                rsrcmgr = PDFResourceManager()
                laparams = LAParams()
                device = PDFPageAggregator(rsrcmgr, laparams=laparams)
                interpreter = PDFPageInterpreter(rsrcmgr, device)
                
                elements = []
                element_counter = 0
                
                for page_num, page in enumerate(PDFPage.get_pages(fp), 1):
                    interpreter.process_page(page)
                    layout = device.get_result()
                    
                    # Extract elements in the same order as extract_text would process them
                    page_elements = self._extract_page_elements_in_order(layout, page_num, element_counter)
                    elements.extend(page_elements)
                    element_counter += len(page_elements)
                
                self.log(f"Extracted {len(elements)} layout elements in reading order")
                return elements
                
        except Exception as e:
            self.log(f"❌ Error extracting layout elements: {e}")
            return []
    
    def _extract_page_elements_in_order(self, layout, page_num: int, start_counter: int) -> List[LayoutElement]:
        """Extract elements from a page in reading order (same as extract_text)"""
        elements = []
        element_counter = start_counter
        
        def process_layout_object(obj, reading_order: int):
            nonlocal element_counter
            
            if isinstance(obj, LTTextContainer):
                text = obj.get_text()
                if text and text.strip():
                    element = LayoutElement(
                        element_id=f"p{page_num}_e{element_counter}",
                        text=text,
                        page=page_num,
                        bbox=(obj.bbox[0], obj.bbox[1], obj.bbox[2], obj.bbox[3]),
                        element_type=type(obj).__name__,
                        reading_order=reading_order
                    )
                    elements.append(element)
                    element_counter += 1
                    return 1
            
            return 0
        
        # Process layout objects in the order they appear (same as extract_text)
        reading_order = 0
        for obj in layout:
            reading_order += process_layout_object(obj, reading_order)
            
            # Also process nested objects
            if hasattr(obj, '__iter__'):
                try:
                    for child in obj:
                        reading_order += process_layout_object(child, reading_order)
                except:
                    pass
        
        return elements
    
    def create_sentence_page_mappings(self) -> Tuple[List[Dict], List[Dict]]:
        """
        Create sentence-to-page mappings with word-level element sharing
        
        Returns:
            (successful_mappings, unmapped_sentences)
        """
        self.log(f"Creating sentence-to-page mappings for {len(self.sentences)} sentences...")
        
        for sentence_id, sentence_text in enumerate(self.sentences):
            self.log(f"Processing sentence {sentence_id}: {sentence_text[:50]}...")
            
            # Find the best page(s) for this sentence
            page_mapping = self._find_sentence_pages(sentence_text, sentence_id)
            
            if page_mapping['pages']:
                self.sentence_mappings.append(page_mapping)
                self.log(f"✅ Mapped sentence {sentence_id} to page(s) {page_mapping['pages']}")
            else:
                unmapped = {
                    'sentence_id': sentence_id,
                    'text': sentence_text,
                    'reason': page_mapping.get('failure_reason', 'no_matching_words_found'),
                    'attempted_words': page_mapping.get('attempted_words', []),
                    'diagnostics': self._analyze_unmapped_sentence(sentence_text)
                }
                self.unmapped_sentences.append(unmapped)
                self.log(f"❌ Could not map sentence {sentence_id}")
                
                # Print unmapped sentence details
                print(f"\n❌ UNMAPPED SENTENCE {sentence_id}:")
                print(f"Text: {sentence_text}")
                print(f"Length: {len(sentence_text)} characters")
                print(f"Reason: {unmapped['reason']}")
                print(f"Diagnostics: {unmapped['diagnostics']}")
        
        success_rate = len(self.sentence_mappings) / len(self.sentences) if self.sentences else 0
        self.log(f"✅ Mapping complete: {len(self.sentence_mappings)}/{len(self.sentences)} sentences mapped ({success_rate:.1%})")
        
        return self.sentence_mappings, self.unmapped_sentences
    
    def _find_sentence_pages(self, sentence_text: str, sentence_id: int) -> Dict:
        """
        **MAIN FIX: Try exact text matching first, then fixed word matching**
        """
        
        # **Strategy 1: Exact text matching**
        exact_match = self._try_exact_text_in_elements(sentence_text, sentence_id)
        if exact_match:
            return exact_match
        
        # **Strategy 2: Fixed word matching (no duplication)**
        word_match = self._try_fixed_word_matching(sentence_text, sentence_id)
        if word_match:
            return word_match
        
        # **No matches found**
        return {
            'sentence_id': sentence_id,
            'text': sentence_text,
            'pages': [],
            'failure_reason': 'no_text_or_word_matches',
            'attempted_words': self._extract_meaningful_words(sentence_text)
        }
    
    def _try_exact_text_in_elements(self, sentence_text: str, sentence_id: int) -> Optional[Dict]:
        """Try to find exact sentence text within elements"""
        sentence_clean = self._normalize_text(sentence_text)
        
        # Group elements by page
        elements_by_page = defaultdict(list)
        for element in self.layout_elements:
            elements_by_page[element.page].append(element)
        
        # Check each page for exact matches
        for page_num, page_elements in elements_by_page.items():
            # Try single element exact match
            for element in page_elements:
                element_text_clean = self._normalize_text(element.text)
                if sentence_clean in element_text_clean:
                    self.log(f"🎯 EXACT match found in single element on page {page_num}")
                    return self._create_exact_match_result(sentence_text, sentence_id, page_num, [element])
            
            # Try multi-element exact match (sentence spans elements)
            for i in range(len(page_elements)):
                for j in range(i + 1, min(i + 5, len(page_elements) + 1)):  # Try up to 5 elements
                    combined_text = ' '.join(self._normalize_text(elem.text) for elem in page_elements[i:j])
                    if sentence_clean in combined_text:
                        self.log(f"🎯 EXACT match found across {j-i} elements on page {page_num}")
                        return self._create_exact_match_result(sentence_text, sentence_id, page_num, page_elements[i:j])
        
        return None
    
    def _create_exact_match_result(self, sentence_text: str, sentence_id: int, page_num: int, elements: List[LayoutElement]) -> Dict:
        """Create result for exact text match"""
        matched_words = self._extract_meaningful_words(sentence_text)
        
        matched_elements = []
        for element in elements:
            matched_elements.append({
                'element_id': element.element_id,
                'page': element.page,
                'matched_words': matched_words,  # All words for exact match
                'bbox': element.bbox,
                'reading_order': element.reading_order
            })
        
        return {
            'sentence_id': sentence_id,
            'text': sentence_text,
            'pages': [page_num],
            'matched_words': matched_words,
            'word_coverage': 1.0,
            'confidence': 0.98,
            'total_matches': len(matched_words),
            'matched_elements': matched_elements,
            'page_word_counts': {str(page_num): matched_words},
            'method': 'exact_text_match'
        }
    
    def _try_fixed_word_matching(self, sentence_text: str, sentence_id: int) -> Optional[Dict]:
        """
        **MAIN FIX: Word matching that prevents duplication**
        Each word can only be counted once across ALL pages.
        """
        
        sentence_words = self._extract_meaningful_words(sentence_text)
        
        if not sentence_words:
            return {
                'sentence_id': sentence_id,
                'text': sentence_text,
                'pages': [],
                'failure_reason': 'no_meaningful_words',
                'attempted_words': []
            }
        
        # **FIX: Track matches globally to prevent duplication**
        global_matched_words = set()
        page_matches = defaultdict(list)
        matched_elements = []
        total_matches = 0
        
        # Go through elements in reading order (this is important!)
        for element in self.layout_elements:
            element_matches = []
            
            # Try to match words from the sentence to available words in this element
            for word in sentence_words:
                # **KEY FIX: Only match if word hasn't been matched globally yet**
                if word not in global_matched_words and element.add_word_match(word, sentence_id):
                    element_matches.append(word)
                    global_matched_words.add(word)  # Mark as used globally
                    total_matches += 1
            
            if element_matches:
                page_matches[element.page].extend(element_matches)
                matched_elements.append({
                    'element_id': element.element_id,
                    'page': element.page,
                    'matched_words': element_matches,
                    'bbox': element.bbox,
                    'reading_order': element.reading_order
                })
        
        if not page_matches:
            return {
                'sentence_id': sentence_id,
                'text': sentence_text,
                'pages': [],
                'failure_reason': 'no_available_word_matches',
                'attempted_words': sentence_words
            }
        
        # Determine the best page(s)
        # Sort pages by number of matched words
        page_scores = [(page, len(words)) for page, words in page_matches.items()]
        page_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Include pages that have significant matches
        min_matches = max(1, page_scores[0][1] * 0.3)  # At least 30% of the best page's matches
        selected_pages = [page for page, score in page_scores if score >= min_matches]
        
        # **FIX: Calculate TRUE word coverage (no double counting)**
        word_coverage = len(global_matched_words) / len(sentence_words)
        confidence = min(1.0, word_coverage * 1.2)  # Boost confidence slightly
        
        return {
            'sentence_id': sentence_id,
            'text': sentence_text,
            'pages': selected_pages,
            'matched_words': list(global_matched_words),  # Only unique words
            'word_coverage': word_coverage,
            'confidence': confidence,
            'total_matches': len(global_matched_words),  # True count, no duplicates
            'matched_elements': matched_elements,
            'page_word_counts': {str(page): list(words) for page, words in page_matches.items()},  # Remove duplicates within page too
            'method': 'fixed_word_level_element_sharing'
        }
    
    def _extract_meaningful_words(self, text: str) -> List[str]:
        """Extract meaningful words from text for matching"""
        # Simple tokenization
        words = re.findall(r'\b\w+\b', text.lower())
        return words
        # Remove stopwords and very short words
        stopwords = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
            'he', 'she', 'it', 'they', 'we', 'you', 'i', 'me', 'him', 'her', 'us', 'them',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'from', 'up', 'out', 'down', 'off',
            'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
            'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
            'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very'
        }
        
        # Filter words
        meaningful_words = []
        for word in words:
            if len(word) >= 3 and word not in stopwords:
                # Avoid extremely common words that appear everywhere
                if word not in {'also', 'said', 'like', 'just', 'time', 'way', 'see', 'get', 'make', 'take'}:
                    meaningful_words.append(word)
        
        # Limit to most distinctive words for very long sentences
        if len(meaningful_words) > 50:
            # Keep longer words preferentially
            meaningful_words.sort(key=len, reverse=True)
            meaningful_words = meaningful_words[:50]
        
    def _normalize_text(self, text: str) -> str:
        """Normalize text for matching"""
        # Remove extra whitespace and convert to lowercase
        text = re.sub(r'\s+', ' ', text.lower().strip())
        # Remove punctuation for better matching
        text = re.sub(r'[^\w\s]', '', text)
        return text
    
    def _analyze_unmapped_sentence(self, sentence_text: str) -> Dict:
        """Analyze why a sentence couldn't be mapped"""
        words = self._extract_meaningful_words(sentence_text)
        
        return {
            'length': len(sentence_text),
            'word_count': len(sentence_text.split()),
            'meaningful_word_count': len(words),
            'is_very_long': len(sentence_text) > 1000,
            'is_very_short': len(sentence_text) < 20,
            'available_elements': len([e for e in self.layout_elements if e.get_available_words()]),
            'sample_words': words[:10] if words else []
        }
    
    def get_page_mapping_summary(self) -> Dict:
        """Get summary statistics about the page mappings"""
        if not self.sentence_mappings:
            return {'total_sentences': len(self.sentences), 'mapped_sentences': 0}
        
        # Calculate statistics
        total_pages_used = set()
        sentences_per_page = defaultdict(int)
        word_coverage_scores = []
        confidence_scores = []
        
        for mapping in self.sentence_mappings:
            pages = mapping['pages']
            total_pages_used.update(pages)
            
            for page in pages:
                sentences_per_page[page] += 1
            
            word_coverage_scores.append(mapping.get('word_coverage', 0))
            confidence_scores.append(mapping.get('confidence', 0))
        
        return {
            'total_sentences': len(self.sentences),
            'mapped_sentences': len(self.sentence_mappings),
            'unmapped_sentences': len(self.unmapped_sentences),
            'success_rate': len(self.sentence_mappings) / len(self.sentences) if self.sentences else 0,
            'pages_used': len(total_pages_used),
            'avg_sentences_per_page': sum(sentences_per_page.values()) / len(sentences_per_page) if sentences_per_page else 0,
            'avg_word_coverage': sum(word_coverage_scores) / len(word_coverage_scores) if word_coverage_scores else 0,
            'avg_confidence': sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0,
            'page_distribution': dict(sentences_per_page)
        }
    
    def save_mappings(self, output_file: str = None) -> str:
        """Save the sentence-to-page mappings"""
        if output_file is None:
            output_file = os.path.join("sentence_page_mappings", f"{self.base_name}_sentence_page_mappings.json")
        
        # Create comprehensive output
        results = {
            'metadata': {
                'pdf_path': self.pdf_path,
                'total_sentences': len(self.sentences),
                'total_layout_elements': len(self.layout_elements),
                'processing_timestamp': time.time(),
                'method': 'word_level_element_sharing',
                'reading_order_preserved': True
            },
            'sentence_mappings': self.sentence_mappings,
            'unmapped_sentences': self.unmapped_sentences,
            'statistics': self.get_page_mapping_summary(),
            'element_usage_summary': self._get_element_usage_summary()
        }
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        self.log(f"💾 Saved mappings to {output_file}")
        return output_file
    
    def _get_element_usage_summary(self) -> Dict:
        """Get summary of how layout elements are being used"""
        elements_with_matches = [e for e in self.layout_elements if e.word_matches]
        total_word_matches = sum(len(e.word_matches) for e in self.layout_elements)
        
        # Elements by number of sentences they support
        elements_by_sentence_count = defaultdict(int)
        for element in elements_with_matches:
            sentence_count = len(set(match.sentence_id for match in element.word_matches))
            elements_by_sentence_count[sentence_count] += 1
        
        return {
            'total_elements': len(self.layout_elements),
            'elements_with_matches': len(elements_with_matches),
            'total_word_matches': total_word_matches,
            'avg_matches_per_element': total_word_matches / len(self.layout_elements) if self.layout_elements else 0,
            'elements_by_sentence_count': dict(elements_by_sentence_count),
            'shared_elements': len([e for e in elements_with_matches 
                                  if len(set(match.sentence_id for match in e.word_matches)) > 1])
        }


def process_pdf_sentence_page_mapping(pdf_path: str, verbose: bool = True) -> str:
    """
    Convenience function to create sentence-to-page mappings for a PDF
    
    Returns:
        Path to the generated mappings file
    """
    mapper = SentencePageWordMapper(pdf_path, verbose=verbose)
    successful_mappings, unmapped_sentences = mapper.create_sentence_page_mappings()
    
    output_file = mapper.save_mappings()
    
    # Print summary
    stats = mapper.get_page_mapping_summary()
    print(f"\n🎉 Sentence-to-page mapping complete for {os.path.basename(pdf_path)}")
    print(f"✅ Successfully mapped: {stats['mapped_sentences']}/{stats['total_sentences']} sentences ({stats['success_rate']:.1%})")
    print(f"📄 Pages used: {stats['pages_used']}")
    print(f"📊 Average word coverage: {stats['avg_word_coverage']:.2f}")
    print(f"🎯 Average confidence: {stats['avg_confidence']:.2f}")
    
    if unmapped_sentences:
        print(f"\n❌ Failed to map {len(unmapped_sentences)} sentences")
        print("   Common reasons:")
        reasons = [s['reason'] for s in unmapped_sentences]
        for reason, count in Counter(reasons).most_common():
            print(f"     {reason}: {count}")
    
    element_stats = mapper._get_element_usage_summary()
    print(f"\n🔗 Element sharing statistics:")
    print(f"   Shared elements: {element_stats['shared_elements']}/{element_stats['elements_with_matches']}")
    print(f"   Total word matches: {element_stats['total_word_matches']}")
    
    return output_file


if __name__ == "__main__":
    import sys
    from collections import Counter

    if len(sys.argv) > 1:
         pdf_dir = sys.argv[1]

         if os.path.isdir(pdf_dir):
             pdf_files = list(Path(pdf_dir).glob("*.pdf"))
             if not pdf_files:
                 print(f"No PDF files found in directory: {pdf_dir}")
                 sys.exit(1)
             for pdf_path in pdf_files:
                 pdf_path = str(pdf_path)
                 print(f"Processing PDF: {pdf_path}")
                 result_file = process_pdf_sentence_page_mapping(pdf_path, verbose=True)
                 print(f"📄 Results saved to: {result_file}")
         else:
             print(f"PDF directory not found: {pdf_dir}")
    else:
        print("Usage: python sentence_page_word_mapper.py <pdf_dir>")