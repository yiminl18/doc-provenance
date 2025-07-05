import json
import os
from typing import List, Dict, Tuple, Optional
from pathlib import Path
import re

class ReadingOrderSorter:
    """
    Sorts PDF.js items into reading order using spatial coordinates
    to improve matching with pdfminer sentence extraction
    """
    
    def __init__(self, column_threshold: float = 50.0, line_threshold: float = 10.0):
        """
        Args:
            column_threshold: X-distance threshold to detect column breaks
            line_threshold: Y-distance threshold to group items on same line
        """
        self.column_threshold = column_threshold
        self.line_threshold = line_threshold
    
    def sort_page_items_reading_order(self, page_items: List[Dict]) -> List[Dict]:
        """
        Sort page items into reading order using spatial coordinates
        Returns items with added reading_order_index
        """
        if not page_items:
            return page_items
        
        # Filter out whitespace-only items for ordering (but keep them)
        significant_items = [item for item in page_items 
                           if item.get('hasSignificantText', True)]
        
        if not significant_items:
            return page_items
        
        # Group items into lines based on Y coordinate
        lines = self._group_items_into_lines(significant_items)
        
        # Sort lines by Y coordinate (top to bottom)
        sorted_lines = sorted(lines, key=lambda line: min(item['y'] for item in line))
        
        # Within each line, detect columns and sort left to right
        reading_order_items = []
        reading_order_index = 0
        
        for line_items in sorted_lines:
            # Sort items in line by columns
            ordered_line_items = self._sort_line_by_columns(line_items)
            
            # Add reading order indices
            for item in ordered_line_items:
                item['reading_order_index'] = reading_order_index
                reading_order_items.append(item)
                reading_order_index += 1
        
        # Add back whitespace items in approximate positions
        all_ordered_items = self._insert_whitespace_items(
            reading_order_items, page_items
        )
        
        return all_ordered_items
    
    def _group_items_into_lines(self, items: List[Dict]) -> List[List[Dict]]:
        """Group items that appear on the same line based on Y coordinate"""
        if not items:
            return []
        
        # Sort by Y coordinate first
        sorted_items = sorted(items, key=lambda item: item['y'])
        
        lines = []
        current_line = [sorted_items[0]]
        current_y = sorted_items[0]['y']
        
        for item in sorted_items[1:]:
            y_diff = abs(item['y'] - current_y)
            
            if y_diff <= self.line_threshold:
                # Same line
                current_line.append(item)
            else:
                # New line
                lines.append(current_line)
                current_line = [item]
                current_y = item['y']
        
        # Add the last line
        if current_line:
            lines.append(current_line)
        
        return lines
    
    def _sort_line_by_columns(self, line_items: List[Dict]) -> List[Dict]:
        """Sort items within a line, handling multi-column layouts"""
        if len(line_items) <= 1:
            return line_items
        
        # Simple case: sort by X coordinate (left to right)
        sorted_items = sorted(line_items, key=lambda item: item['x'])
        
        # Advanced: detect column breaks
        columns = []
        current_column = [sorted_items[0]]
        
        for i in range(1, len(sorted_items)):
            prev_item = sorted_items[i-1]
            current_item = sorted_items[i]
            
            # Calculate gap between items
            prev_right = prev_item['x'] + prev_item.get('width', 0)
            current_left = current_item['x']
            gap = current_left - prev_right
            
            if gap > self.column_threshold:
                # Column break detected
                columns.append(current_column)
                current_column = [current_item]
            else:
                current_column.append(current_item)
        
        # Add the last column
        if current_column:
            columns.append(current_column)
        
        # Flatten columns back to reading order
        result = []
        for column in columns:
            result.extend(column)
        
        return result
    
    def _insert_whitespace_items(self, ordered_significant_items: List[Dict], 
                                all_items: List[Dict]) -> List[Dict]:
        """Insert whitespace items back into the reading order"""
        
        # Create a map of original stable indices to reading order
        significant_indices = {item['stableIndex']: idx 
                             for idx, item in enumerate(ordered_significant_items)}
        
        # Find whitespace items
        whitespace_items = [item for item in all_items 
                          if not item.get('hasSignificantText', True)]
        
        result = ordered_significant_items.copy()
        
        # Insert whitespace items based on spatial proximity
        for ws_item in whitespace_items:
            # Find closest significant item
            closest_idx = self._find_closest_significant_item(
                ws_item, ordered_significant_items
            )
            
            if closest_idx is not None:
                # Insert after the closest item
                ws_item['reading_order_index'] = closest_idx + 0.5
                result.insert(closest_idx + 1, ws_item)
            else:
                # Add at end
                ws_item['reading_order_index'] = len(result)
                result.append(ws_item)
        
        # Renumber all indices
        for idx, item in enumerate(result):
            item['reading_order_index'] = idx
        
        return result
    
    def _find_closest_significant_item(self, ws_item: Dict, 
                                     significant_items: List[Dict]) -> Optional[int]:
        """Find the index of the closest significant item to a whitespace item"""
        if not significant_items:
            return None
        
        ws_x, ws_y = ws_item['x'], ws_item['y']
        min_distance = float('inf')
        closest_idx = 0
        
        for idx, item in enumerate(significant_items):
            # Calculate Euclidean distance
            distance = ((item['x'] - ws_x) ** 2 + (item['y'] - ws_y) ** 2) ** 0.5
            
            if distance < min_distance:
                min_distance = distance
                closest_idx = idx
        
        return closest_idx
    
    def create_reading_order_text(self, ordered_items: List[Dict]) -> str:
        """Create concatenated text in reading order for comparison"""
        text_parts = []
        
        for item in ordered_items:
            text = item.get('str', '').strip()
            if text and item.get('hasSignificantText', True):
                text_parts.append(text)
        
        return ' '.join(text_parts)
    
    def analyze_reading_order_quality(self, ordered_items: List[Dict], 
                                    original_sentences: List[str]) -> Dict:
        """Analyze how well the reading order matches the expected sentence order"""
        
        # Create reading order text
        reading_order_text = self.create_reading_order_text(ordered_items)
        
        # Create expected text from sentences
        expected_text = ' '.join(original_sentences)
        
        # Normalize both for comparison
        normalized_reading = self._normalize_text(reading_order_text)
        normalized_expected = self._normalize_text(expected_text)
        
        # Calculate similarity metrics
        from difflib import SequenceMatcher
        similarity = SequenceMatcher(None, normalized_reading, normalized_expected).ratio()
        
        return {
            'text_similarity': similarity,
            'reading_order_length': len(reading_order_text),
            'expected_length': len(expected_text),
            'length_ratio': len(reading_order_text) / len(expected_text) if expected_text else 0,
            'word_count_reading': len(reading_order_text.split()),
            'word_count_expected': len(expected_text.split()),
            'sample_reading_order': reading_order_text[:200],
            'sample_expected': expected_text[:200]
        }
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        if not text:
            return ""
        
        cleaned = text.lower().strip()
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = re.sub(r'[^\w\s]', '', cleaned)
        return cleaned


def apply_reading_order_to_cached_pdfjs(pdf_basename: str, 
                                      sentences_path: str = None) -> Dict:
    """
    Apply reading order sorting to cached PDF.js data and optionally compare with sentences
    """
    
    try:
        # Load cached PDF.js data
        cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
        summary_file = cache_dir / 'extraction_summary.json'
        
        if not summary_file.exists():
            return {'error': f'No cached data found for {pdf_basename}'}
        
        with open(summary_file, 'r', encoding='utf-8') as f:
            summary = json.load(f)
        
        # Load sentences if path provided
        sentences = []
        if sentences_path and os.path.exists(sentences_path):
            with open(sentences_path, 'r', encoding='utf-8') as f:
                sentences = json.load(f)
        
        sorter = ReadingOrderSorter()
        results = {
            'pdf_basename': pdf_basename,
            'total_pages': summary['total_pages'],
            'pages': {},
            'overall_quality': {}
        }
        
        # Process each page
        for page_info in summary['pages']:
            page_file = cache_dir / page_info['filename']
            
            with open(page_file, 'r', encoding='utf-8') as f:
                page_data = json.load(f)
            
            page_num = page_data['pageNumber']
            original_items = page_data.get('stableItems', [])
            
            # Apply reading order sorting
            ordered_items = sorter.sort_page_items_reading_order(original_items)
            
            # Analyze quality if sentences available
            quality_metrics = {}
            if sentences:
                quality_metrics = sorter.analyze_reading_order_quality(
                    ordered_items, sentences
                )
            
            results['pages'][page_num] = {
                'original_item_count': len(original_items),
                'ordered_item_count': len(ordered_items),
                'significant_items': len([item for item in ordered_items 
                                        if item.get('hasSignificantText', True)]),
                'quality_metrics': quality_metrics,
                'sample_reading_order': sorter.create_reading_order_text(ordered_items)[:300]
            }
            
            # Save ordered items back to cache (optional)
            page_data['stableItemsReadingOrder'] = ordered_items
            with open(page_file, 'w', encoding='utf-8') as f:
                json.dump(page_data, f, indent=2, ensure_ascii=False)
        
        # Overall quality assessment
        if sentences:
            all_quality_metrics = [page_data['quality_metrics'] 
                                 for page_data in results['pages'].values() 
                                 if page_data['quality_metrics']]
            
            if all_quality_metrics:
                results['overall_quality'] = {
                    'avg_similarity': sum(m['text_similarity'] for m in all_quality_metrics) / len(all_quality_metrics),
                    'avg_length_ratio': sum(m['length_ratio'] for m in all_quality_metrics) / len(all_quality_metrics),
                    'total_reading_words': sum(m['word_count_reading'] for m in all_quality_metrics),
                    'total_expected_words': sum(m['word_count_expected'] for m in all_quality_metrics)
                }
        
        return results
        
    except Exception as e:
        return {'error': str(e)}


def enhanced_sentence_matching_with_reading_order(pdf_basename: str, 
                                                 sentences_path: str) -> Dict:
    """
    Enhanced sentence matching using reading-order-sorted PDF.js items
    """
    
    try:
        # First, apply reading order sorting
        reading_order_results = apply_reading_order_to_cached_pdfjs(
            pdf_basename, sentences_path
        )
        
        if 'error' in reading_order_results:
            return reading_order_results
        
        # Load sentences
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences = json.load(f)
        
        # Load reading-order-sorted PDF.js data
        cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
        
        mappings = {
            'document_info': {
                'pdf_basename': pdf_basename,
                'total_sentences': len(sentences),
                'mapping_strategy': 'reading_order_enhanced',
                'reading_order_quality': reading_order_results.get('overall_quality', {})
            },
            'sentence_mappings': {},
            'statistics': {}
        }
        
        # For each sentence, find best matches in reading-order items
        total_mapped = 0
        
        for sentence_idx, sentence_text in enumerate(sentences):
            sentence_text = str(sentence_text).strip()
            
            if len(sentence_text) < 10:  # Skip very short sentences
                continue
            
            # Find matches across all pages using reading order
            best_matches = find_sentence_in_reading_order(
                sentence_text, cache_dir, reading_order_results
            )
            
            if best_matches:
                total_mapped += 1
                mappings['sentence_mappings'][str(sentence_idx)] = {
                    'sentence_id': sentence_idx,
                    'text': sentence_text,
                    'matches': best_matches,
                    'confidence': max(match['confidence'] for match in best_matches),
                    'primary_page': best_matches[0]['page'],
                    'total_spans': sum(len(match['reading_order_span']) for match in best_matches)
                }
        
        mappings['statistics'] = {
            'total_sentences': len(sentences),
            'mapped_sentences': total_mapped,
            'mapping_rate': total_mapped / len(sentences) if sentences else 0
        }
        
        return mappings
        
    except Exception as e:
        return {'error': str(e)}


def find_sentence_in_reading_order(sentence_text: str, cache_dir: Path, 
                                 reading_order_results: Dict) -> List[Dict]:
    """Find sentence matches in reading-order-sorted items"""
    
    from difflib import SequenceMatcher
    
    def normalize_text(text):
        return re.sub(r'\s+', ' ', text.lower().strip())
    
    normalized_sentence = normalize_text(sentence_text)
    sentence_words = normalized_sentence.split()
    
    matches = []
    
    # Search each page
    for page_num in reading_order_results['pages']:
        page_file = cache_dir / f'page_{page_num:03d}.json'
        
        with open(page_file, 'r', encoding='utf-8') as f:
            page_data = json.load(f)
        
        ordered_items = page_data.get('stableItemsReadingOrder', [])
        
        # Try different window sizes for matching
        for window_size in range(min(20, len(ordered_items)), 0, -1):
            for start_idx in range(len(ordered_items) - window_size + 1):
                window_items = ordered_items[start_idx:start_idx + window_size]
                
                # Only consider items with significant text
                significant_items = [item for item in window_items 
                                   if item.get('hasSignificantText', True)]
                
                if not significant_items:
                    continue
                
                # Combine text from window
                window_text = ' '.join(item.get('str', '') for item in significant_items)
                normalized_window = normalize_text(window_text)
                window_words = normalized_window.split()
                
                # Calculate similarity
                similarity = SequenceMatcher(None, sentence_words, window_words).ratio()
                
                if similarity >= 0.6:  # Threshold for good matches
                    # Get reading order indices and stable indices
                    reading_order_span = [item['reading_order_index'] for item in window_items]
                    stable_indices = [item['stableIndex'] for item in window_items]
                    
                    match = {
                        'page': page_num,
                        'confidence': similarity,
                        'reading_order_span': reading_order_span,
                        'stable_indices': stable_indices,
                        'matched_text': window_text,
                        'match_strategy': f'reading_order_window_{window_size}',
                        'window_info': {
                            'start_reading_order': reading_order_span[0] if reading_order_span else -1,
                            'end_reading_order': reading_order_span[-1] if reading_order_span else -1,
                            'span_size': len(reading_order_span),
                            'significant_items': len(significant_items)
                        }
                    }
                    matches.append(match)
    
    # Sort by confidence and return top matches
    matches.sort(key=lambda x: x['confidence'], reverse=True)
    return matches[:3]


# CLI function for testing
def test_reading_order_sorting(pdf_idx: int):
    """Test reading order sorting on cached PDF.js data"""
    

    pdf_dir = os.listdir('pdfjs_cache')


    pdf_to_match = pdf_dir[pdf_idx]

    print(f"📄 Matching PDF: {pdf_to_match}")

    pdf_basename = pdf_to_match.split('/')[-1]


    sentences_path = f"sentences/{pdf_basename}_sentences.json"
    
    if os.path.exists(sentences_path):
        print(f"📝 Using sentences from: {sentences_path}")
        results = apply_reading_order_to_cached_pdfjs(pdf_basename, sentences_path)
    else:
        print("📝 No sentences file found, running without comparison")
        results = apply_reading_order_to_cached_pdfjs(pdf_basename)
    
    if 'error' in results:
        print(f"❌ Error: {results['error']}")
        return
    
    print(f"✅ Reading order sorting complete:")
    print(f"   📄 Pages processed: {results['total_pages']}")
    
    for page_num, page_data in results['pages'].items():
        print(f"   📃 Page {page_num}:")
        print(f"      Items: {page_data['ordered_item_count']} total, {page_data['significant_items']} significant")
        
        if page_data['quality_metrics']:
            metrics = page_data['quality_metrics']
            print(f"      Quality: {metrics['text_similarity']:.2f} similarity, {metrics['length_ratio']:.2f} length ratio")
            print(f"      Sample: {metrics['sample_reading_order'][:100]}...")
    
    if results['overall_quality']:
        overall = results['overall_quality']
        print(f"   🎯 Overall Quality:")
        print(f"      Average similarity: {overall['avg_similarity']:.3f}")
        print(f"      Average length ratio: {overall['avg_length_ratio']:.3f}")
        print(f"      Words: {overall['total_reading_words']} reading vs {overall['total_expected_words']} expected")


if __name__ == "__main__":
    import sys

    pdf_idx = int(sys.argv[1])
    
    test_reading_order_sorting(pdf_idx)