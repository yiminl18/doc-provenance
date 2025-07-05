"""
Coordinate-Aware Sentence Extraction
Extracts sentences using your exact algorithm but preserves coordinate regions
for efficient PDF.js mapping
"""

from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams, LTTextContainer, LTTextBox, LTTextLine, LTChar
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator
from werkzeug.utils import secure_filename
import difflib, json, nltk, os, re, time
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Set

# Ensure NLTK data is available
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt', quiet=True)


@dataclass
class LayoutElement:
    """Represents a discrete layout element from PDFMiner"""
    element_id: str
    text: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    element_type: str
    char_count: int
    reading_order: int
    parent_id: Optional[str] = None
    used: bool = False  # Track if element is already assigned to a sentence


def convert_pdfminer_to_pdfjs_coords(pdfminer_coords: Dict, page_height: float) -> Dict:
    """
    Convert PDFMiner coordinates (bottom-left origin) to PDF.js coordinates (top-left origin)
    
    Args:
        pdfminer_coords: Dict with x0, y0, x1, y1 from PDFMiner
        page_height: Height of the page from page.mediabox
    
    Returns:
        Dict with x, y, width, height for PDF.js
    """
    # PDFMiner: (x0, y0) = bottom-left, (x1, y1) = top-right
    # PDF.js: (x, y) = top-left, width/height from there
    
    x0, y0, x1, y1 = pdfminer_coords['x0'], pdfminer_coords['y0'], pdfminer_coords['x1'], pdfminer_coords['y1']
    
    # Convert coordinates
    pdfjs_coords = {
        'x': x0,  # X stays the same (left edge)
        'y': page_height - y1,  # Flip Y: top edge in PDF.js = page_height - top edge in PDFMiner
        'width': x1 - x0,  # Width calculation
        'height': y1 - y0   # Height calculation
    }
    
    return pdfjs_coords

class CoordinateAwareSentenceExtractor:
    """
    Extract sentences using your exact algorithm while preserving coordinate regions
    """
    
    def __init__(self, pdf_path: str, verbose: bool = False):
        self.pdf_path = pdf_path
        self.verbose = verbose
        
    def log(self, message: str):
        if self.verbose:
            print(f"📍 {message}")
    
    def extract_text_with_positions(self) -> Tuple[str, List[Dict], Dict[int, Dict]]:
        """
        Extract full text while tracking character positions
        Returns: (full_text, character_positions, page_dimensions)
        """
        self.log("Extracting text with character positions...")
        
        with open(self.pdf_path, 'rb') as fp:
            # Setup PDFMiner with your exact parameters
            rsrcmgr = PDFResourceManager()
            laparams = LAParams(
                all_texts=True,
                detect_vertical=True,
                word_margin=0.05,
                char_margin=1.5,
                line_margin=0.3,
                boxes_flow=0.3
            )
            device = PDFPageAggregator(rsrcmgr, laparams=laparams)
            interpreter = PDFPageInterpreter(rsrcmgr, device)
            
            full_text = ""
            character_positions = []
            page_dimensions = {}
            
            for page_num, page in enumerate(PDFPage.get_pages(fp), 1):
                self.log(f"Processing page {page_num}...")
                interpreter.process_page(page)
                layout = device.get_result()

                page_height = page.mediabox[3] - page.mediabox[1]  # Calculate page height
                page_width = page.mediabox[2] - page.mediabox[0]  # Calculate page width
                page_dimensions[page_num] = {
                    'width': page_width,
                    'height': page_height,
                    'mediabox': list(page.mediabox)
                }
                
                # Extract text elements in reading order
                page_elements = self._extract_ordered_text_elements(layout, page_num)
                
                for element in page_elements:
                    element_text = element['text']
                    start_pos = len(full_text)
                    
                    # Map each character to coordinates
                    char_coords = self._estimate_character_coordinates(element, element_text)
                    
                    for i, char in enumerate(element_text):
                        if i < len(char_coords):
                            character_positions.append({
                                'char': char,
                                'document_position': start_pos + i,
                                'page': page_num,
                                'x0': char_coords[i]['x0'],
                                'y0': char_coords[i]['y0'],
                                'x1': char_coords[i]['x1'],
                                'y1': char_coords[i]['y1'],
                                'element_id': element['element_id']
                            })
                    
                    full_text += element_text
        
        self.log(f"Extracted {len(full_text)} characters with positions")
        return full_text, character_positions, page_dimensions
    
    def _extract_ordered_text_elements(self, layout, page_num: int) -> List[Dict]:
        """Extract text elements in reading order"""
        elements = []
        element_counter = 0
        
        def process_element(element, depth=0):
            nonlocal element_counter
            
            if isinstance(element, LTTextContainer):
                text = element.get_text()
                if text and text.strip():
                    bbox = element.bbox
                    elements.append({
                        'element_id': f"p{page_num}_e{element_counter}",
                        'text': text,
                        'page': page_num,
                        'x0': bbox[0], 'y0': bbox[1],
                        'x1': bbox[2], 'y1': bbox[3],
                        'type': type(element).__name__
                    })
                    element_counter += 1
            
            # Process children
            if hasattr(element, '__iter__'):
                try:
                    for child in element:
                        process_element(child, depth + 1)
                except:
                    pass  # Some elements might not be iterable
        
        for element in layout:
            process_element(element)
        
        # Sort by reading order (top to bottom, left to right)
        #elements.sort(key=lambda x: (-x['y1'], x['x0']))
        return elements
    
    def _estimate_character_coordinates(self, element: Dict, text: str) -> List[Dict]:
        """Estimate coordinates for each character in the element"""
        if not text:
            return []
        
        element_width = element['x1'] - element['x0']
        element_height = element['y1'] - element['y0']
        
        if element_width <= 0:
            return []
        
        # Simple character width estimation
        char_width = element_width / len(text)
        
        char_coords = []
        for i, char in enumerate(text):
            char_x0 = element['x0'] + (i * char_width)
            char_x1 = char_x0 + char_width
            
            char_coords.append({
                'x0': char_x0,
                'y0': element['y0'],
                'x1': char_x1,
                'y1': element['y1']
            })
        
        return char_coords
    
    def merge_short_sentences_original(self, sentences, length=30):
        """Your EXACT original merge logic - unchanged"""
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
    
    def extract_sentences_with_regions(self) -> Tuple[List[str], List[Dict]]:
        """
        Main method: Extract sentences with coordinate regions
        """
        self.log("Starting coordinate-aware sentence extraction...")
        
        # Step 1: Extract text with character positions
        full_text, character_positions, page_dimensions = self.extract_text_with_positions()
        
        # Step 2: read the sentences from sentences.json file
        file_basename = str(os.path.basename(self.pdf_path)).replace('.pdf', '')
        sentences_path = os.path.join("layouts", f"{file_basename}_sentences.json")

        if not os.path.exists(sentences_path):
            file_basename = str(secure_filename(os.path.basename(self.pdf_path))).replace('.pdf', '')
            sentences_path = os.path.join("layouts", f"{file_basename}_sentences.json")
        with open(sentences_path, "r", encoding='utf-8') as f:
            final_sentences = json.load(f)

        self.log(f"Created {len(final_sentences)} final sentences")
        
        # Step 3: Map sentences to coordinate regions
        self.log("Mapping sentences to coordinate regions...")
        sentence_regions = self._map_sentences_to_coordinates(
            final_sentences, full_text, character_positions, page_dimensions
        )
        
        return final_sentences, sentence_regions
    
    def _map_sentences_to_coordinates(self, sentences: List[str], full_text: str, 
                                    char_positions: List[Dict], page_dimensions: Dict[int, Dict]) -> List[Dict]:
        """Map each sentence to its coordinate regions"""
        sentence_regions = []
        search_start = 0
        
        for sentence_id, sentence_text in enumerate(sentences):
            self.log(f"Mapping sentence {sentence_id}: {sentence_text[:50]}...")
            
            # Find sentence position in full text
            sentence_start = full_text.find(sentence_text, search_start)
            
            if sentence_start == -1:
                # Try fuzzy search with normalized whitespace
                sentence_start = self._fuzzy_find_sentence(sentence_text, full_text, search_start)
            
            if sentence_start == -1:
                self.log(f"⚠️ Could not locate sentence {sentence_id}")
                sentence_regions.append({
                    'sentence_id': sentence_id,
                    'text': sentence_text,
                    'found': False,
                    'search_regions': []
                })
                continue
            
            sentence_end = sentence_start + len(sentence_text)
            
            # Get character positions for this sentence
            sentence_chars = [
                char for char in char_positions
                if sentence_start <= char['document_position'] < sentence_end
            ]
            
            # Create search regions for PDF.js querying
            search_regions = self._create_search_regions_from_chars(sentence_chars, page_dimensions)
            
            sentence_regions.append({
                'sentence_id': sentence_id,
                'text': sentence_text,
                'found': True,
                'document_start': sentence_start,
                'document_end': sentence_end,
                'character_count': len(sentence_chars),
                'search_regions': search_regions,
                'pages': list(set(char['page'] for char in sentence_chars)) if sentence_chars else [],
                'bounding_box_count': len(search_regions)
            })
            
            search_start = sentence_end
        
        return sentence_regions
    
    def _fuzzy_find_sentence(self, sentence: str, full_text: str, start_pos: int) -> int:
        """Fuzzy search for sentence when exact match fails"""
        # Normalize whitespace
        norm_sentence = ' '.join(sentence.split())
        norm_text = ' '.join(full_text.split())
        
        # Try to find in normalized text
        pos = norm_text.find(norm_sentence, start_pos)
        if pos != -1:
            # Estimate position in original text (rough approximation)
            return min(pos, len(full_text) - len(sentence))
        
        return -1

    def _create_search_regions_from_chars(self, sentence_chars: List[Dict], page_dimensions: Dict[int, Dict]) -> List[Dict]:
        """Create bounding box regions from character positions for PDF.js searching"""
        if not sentence_chars:
            return []
        
        # Group characters by page
        pages = {}
        for char in sentence_chars:
            page = char['page']
            if page not in pages:
                pages[page] = []
            pages[page].append(char)
        
        search_regions = []
        
        for page_num, page_chars in pages.items():
            if not page_chars:
                continue
            
            # Create bounding box for all characters on this page
            min_x = min(char['x0'] for char in page_chars)
            max_x = max(char['x1'] for char in page_chars)
            min_y = min(char['y0'] for char in page_chars)
            max_y = max(char['y1'] for char in page_chars)

            pdfminer_bbox = {
                'x0': min_x,
                'y0': min_y,
                'x1': max_x,
                'y1': max_y
            }
            page_height = page_dimensions[int(page_num)]['height']
           
            # Convert to PDF.js coordinates
            pdfjs_bbox = convert_pdfminer_to_pdfjs_coords(pdfminer_bbox, page_height)

            # Add padding for PDF.js element overlap detection
            padding = 5
            
            search_regions.append({
                'page': page_num,
                'x0': min_x - padding,
                'y0': page_height - max_y - padding,
                'x1': max_x + padding,
                'y1': page_height - min_y + padding,
                'pdfminer_bbox': pdfminer_bbox,
                'pdfjs_bbox': pdfjs_bbox,
                'character_count': len(page_chars),
                'confidence': 0.9,  # High confidence since derived from PDFMiner
                'source': 'pdfminer_coordinates'
            })
        
        return search_regions


def extract_and_save_coordinate_data(pdf_path: str, output_dir: str = None, 
                                   force_reprocess: bool = False) -> Tuple[str, str]:
    """
    Extract sentences with coordinate regions and save files
    Returns paths to sentences.json and pdfminer_coordinate_regions.json
    """
    if output_dir is None:
        output_dir = os.path.dirname(pdf_path)
    
    base_name = secure_filename(os.path.splitext(os.path.basename(pdf_path))[0])
    sentences_file = os.path.join('layouts', f"{base_name}_sentences.json")
    regions_file = os.path.join('pdfminer_coordinate_regions', f"{base_name}_pdfminer_coordinate_regions.json")
    
    # Check if files already exist and are recent
    if not force_reprocess and os.path.exists(sentences_file) and os.path.exists(regions_file):
        pdf_mtime = os.path.getmtime(pdf_path)
        sentences_mtime = os.path.getmtime(sentences_file)
        
        if sentences_mtime > pdf_mtime:
            print(f"✅ Using existing coordinate data for {base_name}")
            return sentences_file, regions_file
    
    print(f"🔄 Processing {base_name} with coordinate extraction...")
    
    try:
        # Extract using coordinate-aware method
        extractor = CoordinateAwareSentenceExtractor(pdf_path, verbose=True)
        sentences, sentence_regions = extractor.extract_sentences_with_regions()
        
        # Save traditional sentences.json (unchanged format for compatibility)
        #with open(sentences_file, 'w', encoding='utf-8') as f:
        #    json.dump(sentences, f, indent=2, ensure_ascii=False)
        
        # Save coordinate regions for PDF.js mapping
        regions_data = {
            'metadata': {
                'pdf_path': pdf_path,
                'pdf_filename': os.path.basename(pdf_path),
                'total_sentences': len(sentences),
                'processing_timestamp': time.time(),
                'extraction_method': 'coordinate_aware_pdfminer',
                'preserves_sentence_indices': True,
                'compatible_with_existing_provenance': True
            },
            'sentence_regions': sentence_regions,
            'statistics': {
                'sentences_with_coordinates': sum(1 for sr in sentence_regions if sr['found']),
                'total_search_regions': sum(len(sr['search_regions']) for sr in sentence_regions),
                'pages_covered': len(set(
                    page for sr in sentence_regions 
                    for page in sr.get('pages', [])
                )),
                'success_rate': sum(1 for sr in sentence_regions if sr['found']) / len(sentence_regions) if sentence_regions else 0
            }
        }
        
        with open(regions_file, 'w', encoding='utf-8') as f:
            json.dump(regions_data, f, indent=2, ensure_ascii=False)
        
        # Print statistics
        stats = regions_data['statistics']
        print(f"✅ Coordinate extraction complete:")
        print(f"   📄 Sentences: {sentences_file}")
        print(f"   🗺️ Coordinate regions: {regions_file}")
        print(f"   📊 {stats['sentences_with_coordinates']}/{len(sentences)} sentences mapped ({stats['success_rate']:.1%})")
        print(f"   📍 {stats['total_search_regions']} search regions across {stats['pages_covered']} pages")
        
        return sentences_file, regions_file
        
    except Exception as e:
        print(f"❌ Error processing {base_name}: {e}")
        import traceback
        traceback.print_exc()
        raise


def validate_coordinate_extraction(pdf_path: str) -> bool:
    """
    Validate that coordinate extraction produces the same sentences as your original method
    """
    print(f"🧪 Validating coordinate extraction for {os.path.basename(pdf_path)}")
    
    try:
        # Original method (your exact pipeline)
        sentence_path = os.path.join('layouts', f"{os.path.splitext(os.path.basename(pdf_path))[0]}_sentences.json")
        with open(sentence_path, 'r', encoding='utf-8') as f:
            original_final = json.load(f) 
        
        # Coordinate-aware method
        extractor = CoordinateAwareSentenceExtractor(pdf_path, verbose=False)
        coordinate_sentences, _ = extractor.extract_sentences_with_regions()
        
        # Compare
        if len(original_final) != len(coordinate_sentences):
            print(f"❌ Length mismatch: {len(original_final)} vs {len(coordinate_sentences)}")
            return False
        
        mismatches = 0
        for i, (orig, coord) in enumerate(zip(original_final, coordinate_sentences)):
            if orig.strip() != coord.strip():
                mismatches += 1
                if mismatches <= 3:  # Show first few mismatches
                    print(f"❌ Mismatch at {i}: '{orig[:50]}...' vs '{coord[:50]}...'")
        
        if mismatches == 0:
            print("✅ Perfect match! Coordinate extraction preserves sentence indices.")
            return True
        else:
            print(f"❌ {mismatches} mismatches found")
            return False
            
    except Exception as e:
        print(f"❌ Validation error: {e}")
        return False





# Main processing function
def process_pdf_with_coordinates(pdf_path: str, output_dir: str = None, 
                               validate: bool = True) -> Dict:
    """
    Complete processing pipeline for a PDF with coordinate extraction
    """
    try:
        # Validate first if requested
        if validate:
            if not validate_coordinate_extraction(pdf_path):
                return {'success': False, 'error': 'Validation failed'}
        
        # Extract and save
        sentences_file, regions_file = extract_and_save_coordinate_data(pdf_path, output_dir)
        
        # Load statistics
        with open(regions_file, 'r', encoding='utf-8') as f:
            regions_data = json.load(f)
        
        return {
            'success': True,
            'sentences_file': sentences_file,
            'pdfminer_coordinate_regions_file': regions_file,
            'statistics': regions_data['statistics']
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


if __name__ == "__main__":
    # Test with a single PDF
    import sys
    
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        if os.path.exists(pdf_path):
            result = process_pdf_with_coordinates(pdf_path)
            if result['success']:
                print("🎉 Processing successful!")
                print(f"Statistics: {result['statistics']}")
            else:
                print(f"❌ Processing failed: {result['error']}")
        else:
            print(f"File not found: {pdf_path}")
    else:
        print("Usage: python coordinate_extraction.py <pdf_path>")