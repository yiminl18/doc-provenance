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
import nltk
import json
import os
from pathlib import Path
import re
import time
from typing import List, Dict, Tuple, Optional

# Ensure NLTK data is available
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt', quiet=True)

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
    
    def extract_text_with_positions(self) -> Tuple[str, List[Dict], Dict[str, Dict]]:
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
                word_margin=0.1,
                char_margin=2.0,
                line_margin=0.5,
                boxes_flow=0.5
            )
            device = PDFPageAggregator(rsrcmgr, laparams=laparams)
            interpreter = PDFPageInterpreter(rsrcmgr, device)

            layout_path = os.path.join('layouts', f"{os.path.splitext(os.path.basename(self.pdf_path))[0]}_layout.json")
            print(f"Loading layout from {layout_path}")
            with open(layout_path, 'r', encoding='utf-8') as lf:
                layout_file = json.load(lf)

            # list of pages with keys page_num and elements
            pages_layout = layout_file.get('sentences')

            full_text = ""
            character_positions = []
            page_dimensions = {}
            
            for page_num, page in enumerate(PDFPage.get_pages(fp), 1):
                self.log(f"Processing page {page_num}...")
                
                page_height = page.mediabox[3] - page.mediabox[1]  # Calculate page height
                page_width = page.mediabox[2] - page.mediabox[0]  # Calculate page width
                page_dimensions[page_num] = {
                    'width': page_width,
                    'height': page_height,
                    'mediabox': list(page.mediabox)
                }
                
               

                # Extract text elements in reading order
                page_elements = layout_file.get('pages_layout', {})[page_num - 1].get('elements', [])
                self.log(f"Found {len(page_elements)} text elements on page {page_num}")
                
                for element in page_elements:
                    element_text = element['text']
                    start_pos = len(full_text)
                    
                   
                    
                    #for i, char in enumerate(element_text):
                    #    if i < len(char_coords):
                    #        character_positions.append({
                    #            'char': char,
                    #            'document_position': start_pos + i,
                    #            'page': page_num,
                    #            'x0': char_coords[i]['x0'],
                    #            'y0': char_coords[i]['y0'],
                    #            'x1': char_coords[i]['x1'],
                    #            'y1': char_coords[i]['y1'],
                    #            'element_id': element['element_id']
                    #        })
                    #
                    full_text += element_text
        
        self.log(f"Extracted {len(full_text)} characters with positions")
        return full_text, pages_layout, page_dimensions
    
    def extract_sentences_with_regions(self) -> Tuple[List[str], List[Dict]]:
        """
        Main method: Extract sentences with coordinate regions
        """
        self.log("Starting coordinate-aware sentence extraction...")
        
        # Step 1: Extract text with character positions
        full_text, pages_layout, page_dimensions = self.extract_text_with_positions()
        
        # Step 2: read the sentences from sentences.json file
        file_basename = os.path.splitext(os.path.basename(self.pdf_path))[0]
        sentences_path = os.path.join("layouts", f"{file_basename}_sentences.json")
        with open(sentences_path, "r", encoding='utf-8') as f:
            final_sentences = json.load(f)

        self.log(f"Created {len(final_sentences)} final sentences")
        
        # Step 3: Map sentences to coordinate regions
        self.log("Mapping sentences to coordinate regions...")
        sentence_regions = self._map_sentences_to_coordinates(
            final_sentences, full_text, pages_layout, page_dimensions
        )
        
        return final_sentences, sentence_regions
    
    def _map_sentences_to_coordinates(self, sentences: List[str], full_text: str, 
                                    layout_elements: Dict[str, Dict], page_dimensions: Dict[int, Dict]) -> List[Dict]:
        """Map each sentence to its coordinate regions"""
        sentence_regions = []
        search_start = 0
        
        for sentence_id, sentence_text in enumerate(sentences):
            self.log(f"Mapping sentence {sentence_id}: {sentence_text[:50]}...")
            
            # Find sentence position in full text
            sentence_start = full_text.find(sentence_text, search_start)

            
            sentence_end = sentence_start + len(sentence_text)
            
            # Get character positions for this sentence
            sentence_layouts = layout_elements[sentence_id]
            
            # Create search regions for PDF.js querying
            search_regions = self._create_search_regions_from_elements(sentence_layouts['layout_matches'], page_dimensions)

            sentence_regions.append({
                'sentence_id': sentence_id,
                'text': sentence_text,
                'found': True,
                'document_start': sentence_start,
                'document_end': sentence_end,
                'layout_matches': len(sentence_layouts['layout_matches']) if 'layout_matches' in sentence_layouts else 0,
                'search_regions': search_regions,
                'pages': sentence_layouts['page_spans'] if sentence_layouts else [],
                'bounding_box_count': len(search_regions)
            })
            
            search_start = sentence_end
        
        return sentence_regions
    
    

    def _create_search_regions_from_elements(self, sentence_elements: List[Dict], page_dimensions: Dict[int, Dict]) -> List[Dict]:
        """Create bounding box regions from character positions for PDF.js searching"""
        if not sentence_elements:
            return []
        
        # Group elements by page
        pages = {}
        for elem in sentence_elements:
            page = elem['page']
            if page not in pages:
                pages[page] = []
            pages[page].append(elem)

        search_regions = []
        
        for page_num, page_elems in pages.items():
            if not page_elems:
                continue
            self.log(f"Creating search regions for page {page_num} with {len(page_elems)} elements")
            # Create bounding box for all elements on this page
            min_x = min(elem['x0'] for elem in page_elems)
            max_x = max(elem['x1'] for elem in page_elems)
            min_y = min(elem['y0'] for elem in page_elems)
            max_y = max(elem['y1'] for elem in page_elems)

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
                'element_count': len(page_elems),
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
    
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
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