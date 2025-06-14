"""
PDF.js Coordinate Mapper
Maps coordinate regions to PDF.js stable elements for precise highlighting
"""

import json
import os
from typing import List, Dict, Optional, Tuple
from pathlib import Path

class PDFJSCoordinateMapper:
    """
    Maps coordinate regions from PDFMiner to PDF.js stable elements
    """
    
    def __init__(self, pdfminer_coordinate_regions_path: str, pdfjs_cache_dir: str, verbose: bool = False):
        self.pdfminer_coordinate_regions_path = pdfminer_coordinate_regions_path
        self.pdfjs_cache_dir = pdfjs_cache_dir
        self.verbose = verbose
        
        # Load coordinate regions
        with open(pdfminer_coordinate_regions_path, 'r', encoding='utf-8') as f:
            self.regions_data = json.load(f)
        
        # Load PDF.js cache data
        self.pdfjs_data = self._load_pdfjs_cache()
        
    def log(self, message: str):
        if self.verbose:
            print(f"🗺️ {message}")
    
    def _load_pdfjs_cache(self) -> List[Dict]:
        """Load PDF.js cache data from directory"""
        cache_dir = Path(self.pdfjs_cache_dir)
        
        # Look for extraction_summary.json
        summary_file = cache_dir / 'extraction_summary.json'
        if not summary_file.exists():
            raise FileNotFoundError(f"PDF.js cache summary not found: {summary_file}")
        
        # Load summary
        with open(summary_file, 'r', encoding='utf-8') as f:
            summary = json.load(f)
        
        # Load individual page files
        pages_data = []
        for page_info in summary['pages']:
            page_file = cache_dir / page_info['filename']
            with open(page_file, 'r', encoding='utf-8') as f:
                page_data = json.load(f)
                pages_data.append(page_data)
        
        self.log(f"Loaded PDF.js cache: {len(pages_data)} pages")
        return pages_data
    
    def create_sentence_to_stable_element_mappings(self) -> Dict:
        """
        Create mappings from sentence IDs to PDF.js stable elements
        """
        self.log("Creating sentence to stable element mappings...")
        
        mappings = {}
        sentence_regions = self.regions_data['sentence_regions']
        
        for sentence_region in sentence_regions:
            sentence_id = sentence_region['sentence_id']
            
            if not sentence_region.get('found', False):
                mappings[sentence_id] = {
                    'sentence_text': sentence_region['text'],
                    'found': False,
                    'stable_elements': []
                }
                continue
            
            # Find PDF.js elements that overlap with search regions
            stable_elements = self._find_overlapping_stable_elements(
                sentence_region['search_regions'],
                sentence_region['text']
            )
            
            mappings[sentence_id] = {
                'sentence_text': sentence_region['text'],
                'found': True,
                'stable_elements': stable_elements,
                'search_regions': sentence_region['search_regions'],
                'mapping_confidence': self._calculate_mapping_confidence(stable_elements),
                'element_count': len(stable_elements)
            }
            
            self.log(f"Sentence {sentence_id}: {len(stable_elements)} stable elements found")
        
        return mappings
    
    def _find_overlapping_stable_elements(self, search_regions: List[Dict], 
                                        sentence_text: str) -> List[Dict]:
        """Find PDF.js stable elements that overlap with coordinate regions"""
        matching_elements = []
        
        for region in search_regions:
            page_num = region['page']
            
            # Find PDF.js page data
            pdfjs_page = next(
                (page for page in self.pdfjs_data if page['pageNumber'] == page_num),
                None
            )
            
            if not pdfjs_page:
                self.log(f"⚠️ PDF.js page {page_num} not found")
                continue
            
            # Check each stable item for overlap
            for item in pdfjs_page.get('stableItems', []):
                # Skip whitespace-only items
                if not item.get('hasSignificantText', True):
                    continue
                
                # Check for spatial overlap
                overlap_info = self._calculate_overlap(region, item)
                
                if overlap_info['overlaps']:
                    # Add text similarity scoring
                    text_similarity = self._calculate_text_similarity(
                        sentence_text, item.get('str', '')
                    )
                    
                    element_data = {
                        'stable_index': item['stableIndex'],
                        'page': page_num,
                        'text': item.get('str', ''),
                        'normalized_text': item.get('normalizedText', ''),
                        'coordinates': {
                            'x': item.get('x', 0),
                            'y': item.get('y', 0),
                            'width': item.get('width', 0),
                            'height': item.get('height', 0)
                        },
                        'overlap_confidence': overlap_info['confidence'],
                        'text_similarity': text_similarity,
                        'combined_confidence': (overlap_info['confidence'] * 0.7 + text_similarity * 0.3),
                        'identifiers': item.get('identifiers', {}),
                        'match_source': 'coordinate_overlap'
                    }
                    
                    matching_elements.append(element_data)
        
        # Sort by combined confidence and remove duplicates
        matching_elements = self._deduplicate_and_sort_elements(matching_elements)
        
        return matching_elements
    
    def _calculate_overlap(self, region: Dict, pdfjs_item: Dict) -> Dict:
        """Calculate overlap between coordinate region and PDF.js item"""
        # PDF.js coordinates
        item_x = pdfjs_item.get('x', 0)
        item_y = pdfjs_item.get('y', 0) 
        item_width = pdfjs_item.get('width', 0)
        item_height = pdfjs_item.get('height', 0)
        
        item_x1 = item_x + item_width
        item_y1 = item_y + item_height
        
        # Check for overlap
        x_overlap = max(0, min(region['x1'], item_x1) - max(region['x0'], item_x))
        y_overlap = max(0, min(region['y1'], item_y1) - max(region['y0'], item_y))
        
        overlaps = x_overlap > 0 and y_overlap > 0
        
        if not overlaps:
            return {'overlaps': False, 'confidence': 0.0}
        
        # Calculate confidence based on intersection over union
        intersection_area = x_overlap * y_overlap
        region_area = (region['x1'] - region['x0']) * (region['y1'] - region['y0'])
        item_area = item_width * item_height
        
        if region_area <= 0 or item_area <= 0:
            return {'overlaps': True, 'confidence': 0.1}
        
        # Use intersection over smaller area (more forgiving)
        smaller_area = min(region_area, item_area)
        confidence = intersection_area / smaller_area
        
        return {
            'overlaps': True,
            'confidence': min(1.0, confidence),
            'intersection_area': intersection_area,
            'region_area': region_area,
            'item_area': item_area
        }
    
    def _calculate_text_similarity(self, sentence_text: str, item_text: str) -> float:
        """Calculate text similarity between sentence and PDF.js item"""
        if not sentence_text or not item_text:
            return 0.0
        
        # Normalize texts
        sentence_words = set(self._normalize_text(sentence_text).split())
        item_words = set(self._normalize_text(item_text).split())
        
        if not sentence_words or not item_words:
            return 0.0
        
        # Calculate Jaccard similarity
        intersection = len(sentence_words & item_words)
        union = len(sentence_words | item_words)
        
        return intersection / union if union > 0 else 0.0
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        import re
        text = text.lower().strip()
        text = re.sub(r'[^\w\s]', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text
    
    def _deduplicate_and_sort_elements(self, elements: List[Dict]) -> List[Dict]:
        """Remove duplicates and sort by confidence"""
        # Remove duplicates based on stable_index
        seen_indices = set()
        unique_elements = []
        
        for element in elements:
            stable_index = element['stable_index']
            if stable_index not in seen_indices:
                seen_indices.add(stable_index)
                unique_elements.append(element)
        
        # Sort by combined confidence
        unique_elements.sort(key=lambda x: x['combined_confidence'], reverse=True)
        
        return unique_elements
    
    def _calculate_mapping_confidence(self, stable_elements: List[Dict]) -> float:
        """Calculate overall mapping confidence for a sentence"""
        if not stable_elements:
            return 0.0
        
        # Use average of top 3 elements
        top_elements = stable_elements[:3]
        confidences = [elem['combined_confidence'] for elem in top_elements]
        
        return sum(confidences) / len(confidences)
    
    def save_stable_element_mappings(self, output_path: str) -> str:
        """Create and save the stable element mappings"""
        mappings = self.create_sentence_to_stable_element_mappings()
        
        # Calculate statistics
        total_sentences = len(mappings)
        mapped_sentences = sum(1 for m in mappings.values() if m['found'] and m['stable_elements'])
        total_elements = sum(len(m['stable_elements']) for m in mappings.values())
        
        mapping_data = {
            'metadata': {
                'pdfminer_coordinate_regions_file': self.pdfminer_coordinate_regions_path,
                'pdfjs_cache_dir': self.pdfjs_cache_dir,
                'creation_timestamp': json.dumps(os.path.getctime(self.pdfminer_coordinate_regions_path)),
                'mapping_method': 'coordinate_region_overlap',
                'total_sentences': total_sentences,
                'mapped_sentences': mapped_sentences,
                'mapping_rate': mapped_sentences / total_sentences if total_sentences > 0 else 0,
                'total_stable_elements': total_elements
            },
            'sentence_mappings': mappings,
            'statistics': {
                'sentences_by_confidence': self._analyze_confidence_distribution(mappings),
                'elements_per_sentence': total_elements / mapped_sentences if mapped_sentences > 0 else 0,
                'pages_covered': len(set(
                    elem['page'] for mapping in mappings.values()
                    for elem in mapping.get('stable_elements', [])
                ))
            }
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(mapping_data, f, indent=2, ensure_ascii=False)
        
        self.log(f"Saved mappings to {output_path}")
        print(f"✅ Stable element mappings created:")
        print(f"   📊 {mapped_sentences}/{total_sentences} sentences mapped ({mapping_data['metadata']['mapping_rate']:.1%})")
        print(f"   🔗 {total_elements} stable elements ({mapping_data['statistics']['elements_per_sentence']:.1f} avg per sentence)")
        print(f"   📄 {mapping_data['statistics']['pages_covered']} pages covered")
        
        return output_path
    
    def _analyze_confidence_distribution(self, mappings: Dict) -> Dict:
        """Analyze the distribution of mapping confidences"""
        confidences = [
            m['mapping_confidence'] for m in mappings.values()
            if m['found'] and m['stable_elements']
        ]
        
        if not confidences:
            return {'high': 0, 'medium': 0, 'low': 0}
        
        high_conf = sum(1 for c in confidences if c >= 0.7)
        medium_conf = sum(1 for c in confidences if 0.4 <= c < 0.7)
        low_conf = sum(1 for c in confidences if c < 0.4)
        
        return {
            'high': high_conf,
            'medium': medium_conf,
            'low': low_conf,
            'avg_confidence': sum(confidences) / len(confidences)
        }


def create_stable_mappings_for_document(pdf_basename: str, 
                                      pdfminer_coordinate_regions_dir: str = None,
                                      pdfjs_cache_base_dir: str = None,
                                      output_dir: str = None) -> str:
    """
    Create stable element mappings for a document
    """
    # Set default directories
    if pdfminer_coordinate_regions_dir is None:
        pdfminer_coordinate_regions_dir = os.path.join(os.getcwd(), 'pdfminer_coordinate_regions')
    if pdfjs_cache_base_dir is None:
        pdfjs_cache_base_dir = os.path.join(os.getcwd(), 'pdfjs_cache')
    if output_dir is None:
        output_dir = os.path.join(os.getcwd(), 'stable_mappings')
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Find coordinate regions file
    pdfminer_coordinate_regions_file = os.path.join(pdfminer_coordinate_regions_dir, f"{pdf_basename}_pdfminer_coordinate_regions.json")
    if not os.path.exists(pdfminer_coordinate_regions_file):
        raise FileNotFoundError(f"Coordinate regions file not found: {pdfminer_coordinate_regions_file}")
    
    # Find PDF.js cache directory
    pdfjs_cache_dir = os.path.join(pdfjs_cache_base_dir, pdf_basename)
    if not os.path.exists(pdfjs_cache_dir):
        raise FileNotFoundError(f"PDF.js cache directory not found: {pdfjs_cache_dir}")
    
    # Create mapper and generate mappings
    mapper = PDFJSCoordinateMapper(pdfminer_coordinate_regions_file, pdfjs_cache_dir, verbose=True)
    
    # Save mappings
    output_file = os.path.join(output_dir, f"{pdf_basename}_stable_mappings.json")
    return mapper.save_stable_element_mappings(output_file)


def get_stable_elements_for_sentence(stable_mappings_file: str, sentence_id: int) -> List[Dict]:
    """
    Get stable elements for a specific sentence ID
    This is what your frontend will call for highlighting
    """
    with open(stable_mappings_file, 'r', encoding='utf-8') as f:
        mapping_data = json.load(f)
    
    sentence_mapping = mapping_data['sentence_mappings'].get(str(sentence_id))
    
    if not sentence_mapping or not sentence_mapping.get('found', False):
        return []
    
    return sentence_mapping.get('stable_elements', [])


def get_highlight_data_for_provenance(stable_mappings_file: str, 
                                    sentence_ids: List[int]) -> Dict:
    """
    Get highlight data for a list of sentence IDs (e.g., from provenance)
    Returns data formatted for PDF.js highlighting
    """
    with open(stable_mappings_file, 'r', encoding='utf-8') as f:
        mapping_data = json.load(f)
    
    highlight_data = {
        'sentence_count': len(sentence_ids),
        'highlights_by_page': {},
        'stable_elements': [],
        'bounding_boxes': []
    }
    
    for sentence_id in sentence_ids:
        sentence_mapping = mapping_data['sentence_mappings'].get(str(sentence_id))
        
        if not sentence_mapping or not sentence_mapping.get('found', False):
            continue
        
        for element in sentence_mapping.get('stable_elements', []):
            page = element['page']
            
            if page not in highlight_data['highlights_by_page']:
                highlight_data['highlights_by_page'][page] = []
            
            highlight_data['highlights_by_page'][page].append({
                'stable_index': element['stable_index'],
                'coordinates': element['coordinates'],
                'confidence': element['combined_confidence'],
                'sentence_id': sentence_id
            })
            
            highlight_data['stable_elements'].append(element['stable_index'])
            highlight_data['bounding_boxes'].append({
                'page': page,
                'x': element['coordinates']['x'],
                'y': element['coordinates']['y'],
                'width': element['coordinates']['width'],
                'height': element['coordinates']['height'],
                'sentence_id': sentence_id,
                'stable_index': element['stable_index']
            })
    
    return highlight_data


if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) > 1:
        pdf_basename = sys.argv[1]
        try:
            output_file = create_stable_mappings_for_document(pdf_basename)
            print(f"🎉 Stable mappings created: {output_file}")
        except Exception as e:
            print(f"❌ Error: {e}")
    else:
        print("Usage: python pdfjs_coordinate_mapper.py <pdf_basename>")