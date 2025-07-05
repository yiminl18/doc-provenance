import json
import os
import time
import logging
from typing import Dict, List, Optional, Tuple, Union
from pathlib import Path
from collections import defaultdict
import re
import subprocess
import tempfile


def safe_get_file_finder():
    """Safe wrapper for file finder that handles None returns"""
    try:
        from utils import get_file_finder
        return get_file_finder()
    except ImportError:
        return None

def safe_find_file(doc_name: str, extension: str) -> Optional[Dict]:
    """Safely find file with proper error handling"""
    try:
        file_finder = safe_get_file_finder()
        if file_finder is None:
            # Fallback: look in common directories
            common_paths = [
                f"public/test-documents/{doc_name}.{extension}",
                f"gdrive_downloads/**/{doc_name}*.{extension}",
                f"uploads/{doc_name}.{extension}",
                f"sentences/{doc_name}_sentences.json",
                f"layouts/{doc_name}_layout.json",
                f"{doc_name}.{extension}"
            ]
            
            for pattern in common_paths:
                files = list(Path(".").glob(pattern))
                if files:
                    return {
                        'path': str(files[0]),
                        'name': files[0].name
                    }
            return None
        
        result = file_finder.find_file(doc_name, extension)
        return result
        
    except Exception as e:
        print(f"Error finding file {doc_name}.{extension}: {e}")
        return None

class EfficientSentenceMapper:
    """
    Efficient sentence-to-stableIndex mapper using divide-and-conquer approach
    Similar to base_strategies.py but for mapping instead of provenance extraction
    """
    
    def __init__(self, pdf_path: str, verbose: bool = False):
        self.pdf_path = pdf_path
        self.verbose = verbose
        self.pdfjs_pages = None
        self.cached_blocks = None
        self.block_scores_cache = {}
        self.setup_logging()
        
    def setup_logging(self):
        """Setup logging"""
        if self.verbose and not logging.getLogger(__name__).handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger = logging.getLogger(__name__)
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)

    def load_pdfjs_cache(self) -> Optional[List[Dict]]:
        """Load cached PDF.js data"""
        try:
            pdf_basename = Path(self.pdf_path).stem
            cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
            summary_file = cache_dir / 'extraction_summary.json'
            
            if not summary_file.exists():
                print(f"❌ No PDF.js cache found for {pdf_basename}")
                return None
            
            # Load summary
            with open(summary_file, 'r', encoding='utf-8') as f:
                summary = json.load(f)
            
            # Load individual page files
            pages_data = []
            for page_info in summary['pages']:
                page_file = cache_dir / page_info['filename']
                if not page_file.exists():
                    print(f"⚠️ Missing page file: {page_file}")
                    return None
                
                with open(page_file, 'r', encoding='utf-8') as f:
                    page_data = json.load(f)
                    pages_data.append(page_data)
            
            print(f"✅ Loaded cached PDF.js data: {len(pages_data)} pages")
            return pages_data
            
        except Exception as e:
            print(f"⚠️ Failed to load cached data: {e}")
            return None

    def extract_significant_items(self, pdfjs_pages: List[Dict]) -> Dict[int, List[Dict]]:
        """Extract significant (non-whitespace) items from PDF.js pages"""
        significant_items = {}
        
        for page_data in pdfjs_pages:
            page_num = page_data['pageNumber']
            stable_items = page_data.get('stableItems', [])
            
            # Filter to significant items only
            page_significant = []
            for item in stable_items:
                if item.get('hasSignificantText', True):
                    page_significant.append({
                        'stable_index': item['stableIndex'],
                        'page': page_num,
                        'text': item.get('str', ''),
                        'normalized_text': item.get('normalizedText', '').lower().strip(),
                        'position': {
                            'x': item.get('x', 0),
                            'y': item.get('y', 0),
                        }
                    })
            
            significant_items[page_num] = page_significant
            
        return significant_items
    
    def get_blocks_cache_dir(self) -> Path:
        """Get or create the blocks cache directory"""
        pdf_basename = Path(self.pdf_path).stem
        cache_dir = Path(os.getcwd()) / 'blocks_cache' / pdf_basename
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir

    def load_cached_blocks(self, block_size: int = 10) -> Optional[List[Dict]]:
        """Load cached blocks if available and recent"""
        try:
            cache_dir = self.get_blocks_cache_dir()
            blocks_file = cache_dir / f'blocks_size_{block_size}.json'
            
            if not blocks_file.exists():
                return None
            
            # Check if cache is newer than PDF file
            pdf_mtime = os.path.getmtime(self.pdf_path)
            cache_mtime = os.path.getmtime(blocks_file)
            
            if cache_mtime < pdf_mtime:
                print(f"📰 Blocks cache is older than PDF file, will regenerate")
                return None
            
            # Check if PDF.js cache is newer than blocks cache
            pdf_basename = Path(self.pdf_path).stem
            pdfjs_cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
            pdfjs_summary = pdfjs_cache_dir / 'extraction_summary.json'
            
            if pdfjs_summary.exists():
                pdfjs_mtime = os.path.getmtime(pdfjs_summary)
                if pdfjs_mtime > cache_mtime:
                    print(f"📰 PDF.js cache is newer than blocks cache, will regenerate")
                    return None
            
            # Load blocks
            with open(blocks_file, 'r', encoding='utf-8') as f:
                blocks_data = json.load(f)
            
            blocks = blocks_data['blocks']
            print(f"✅ Loaded {len(blocks)} cached blocks from {blocks_file}")
            return blocks
            
        except Exception as e:
            print(f"⚠️ Failed to load cached blocks: {e}")
            return None

    def save_blocks_to_cache(self, blocks: List[Dict], block_size: int = 10) -> None:
        """Save blocks to cache"""
        try:
            cache_dir = self.get_blocks_cache_dir()
            blocks_file = cache_dir / f'blocks_size_{block_size}.json'
            
            # Create blocks cache data
            blocks_cache = {
                'pdf_file': self.pdf_path,
                'pdf_basename': Path(self.pdf_path).stem,
                'creation_timestamp': time.time(),
                'creation_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                'block_size': block_size,
                'total_blocks': len(blocks),
                'blocks': blocks,
                'statistics': {
                    'total_items': sum(len(block['items']) for block in blocks),
                    'total_pages': len(set(item['page'] for block in blocks for item in block['items'])),
                    'avg_block_size': sum(len(block['items']) for block in blocks) / len(blocks) if blocks else 0,
                    'text_length': sum(len(block['text']) for block in blocks)
                }
            }
            
            with open(blocks_file, 'w', encoding='utf-8') as f:
                json.dump(blocks_cache, f, indent=2, ensure_ascii=False)
            
            print(f"💾 Saved {len(blocks)} blocks to cache:")
            print(f"   📁 File: {blocks_file}")
            print(f"   📊 Stats: {blocks_cache['statistics']['total_items']} items across {blocks_cache['statistics']['total_pages']} pages")
            
        except Exception as e:
            print(f"❌ Failed to save blocks to cache: {e}")

    def create_item_blocks(self, significant_items: Dict[int, List[Dict]], block_size: int = 10) -> List[Dict]:
        """Create blocks of stableItems with caching support"""
        
        # Try to load from cache first
        if self.cached_blocks is None:
            self.cached_blocks = self.load_cached_blocks(block_size)
        
        if self.cached_blocks:
            return self.cached_blocks
        
        # Generate blocks if not cached
        blocks = []
        
        # Flatten all items across pages, maintaining order
        all_items = []
        for page_num in sorted(significant_items.keys()):
            all_items.extend(significant_items[page_num])
        
        # Create blocks
        for i in range(0, len(all_items), block_size):
            block_items = all_items[i:i + block_size]
            
            if not block_items:
                continue
                
            # Combine text from block items
            block_text = ' '.join(item['text'] for item in block_items)
            
            block = {
                'block_id': len(blocks),
                'start_index': block_items[0]['stable_index'],
                'end_index': block_items[-1]['stable_index'],
                'page_range': (block_items[0]['page'], block_items[-1]['page']),
                'item_count': len(block_items),
                'text': block_text,
                'normalized_text': ' '.join(item['normalized_text'] for item in block_items),
                'items': block_items,
                'stable_indices': [item['stable_index'] for item in block_items]
            }
            
            blocks.append(block)
        
        print(f"📦 Created {len(blocks)} blocks from {len(all_items)} significant items")
        
        # Save to cache
        self.save_blocks_to_cache(blocks, block_size)
        self.cached_blocks = blocks
        
        return blocks

    def get_block_scores_cache_key(self, sentence_text: str, blocks: List[Dict]) -> str:
        """Generate a cache key for block scores"""
        import hashlib
        
        # Create a hash based on sentence text and block structure
        sentence_hash = hashlib.md5(sentence_text.encode('utf-8')).hexdigest()[:8]
        
        # Include block structure in the hash (in case blocks change)
        blocks_info = f"{len(blocks)}_{blocks[0]['block_id'] if blocks else 0}_{blocks[-1]['block_id'] if blocks else 0}"
        blocks_hash = hashlib.md5(blocks_info.encode('utf-8')).hexdigest()[:8]
        
        return f"{sentence_hash}_{blocks_hash}"

    def load_persistent_block_scores(self) -> Dict:
        """Load persistent block scores cache from disk"""
        try:
            cache_dir = self.get_blocks_cache_dir()
            scores_file = cache_dir / 'block_scores_cache.json'
            
            if not scores_file.exists():
                return {}
            
            with open(scores_file, 'r', encoding='utf-8') as f:
                scores_cache = json.load(f)
            
            # Validate cache age (expire after 24 hours)
            cache_age = time.time() - scores_cache.get('last_updated', 0)
            if cache_age > 86400:  # 24 hours
                print("📰 Block scores cache expired, will regenerate")
                return {}
            
            print(f"✅ Loaded {len(scores_cache.get('scores', {}))} cached block score entries")
            return scores_cache.get('scores', {})
            
        except Exception as e:
            print(f"⚠️ Failed to load persistent block scores: {e}")
            return {}

    def save_persistent_block_scores(self, scores_cache: Dict) -> None:
        """Save block scores cache to disk"""
        try:
            cache_dir = self.get_blocks_cache_dir()
            scores_file = cache_dir / 'block_scores_cache.json'
            
            cache_data = {
                'pdf_file': self.pdf_path,
                'last_updated': time.time(),
                'update_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                'total_entries': len(scores_cache),
                'scores': scores_cache
            }
            
            with open(scores_file, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, indent=2, ensure_ascii=False)
            
            print(f"💾 Saved {len(scores_cache)} block score entries to cache")
            
        except Exception as e:
            print(f"❌ Failed to save persistent block scores: {e}")

    def score_blocks_for_sentence(self, sentence_text: str, blocks: List[Dict]) -> Dict[int, float]:
        """Score blocks based on relevance to sentence with caching"""
        
        # Generate cache key
        cache_key = self.get_block_scores_cache_key(sentence_text, blocks)
        
        # Check in-memory cache first
        if cache_key in self.block_scores_cache:
            if self.verbose:
                print(f"🎯 Using cached block scores for sentence")
            return self.block_scores_cache[cache_key]
        
        # Check persistent cache if not in memory
        if not hasattr(self, '_persistent_scores_loaded'):
            self._persistent_scores_cache = self.load_persistent_block_scores()
            self._persistent_scores_loaded = True
        
        if cache_key in self._persistent_scores_cache:
            scores = self._persistent_scores_cache[cache_key]
            # Convert string keys back to int
            scores = {int(k): v for k, v in scores.items()}
            self.block_scores_cache[cache_key] = scores  # Cache in memory too
            if self.verbose:
                print(f"🎯 Using persistent cached block scores for sentence")
            return scores
        

        scores = self._score_blocks_heuristic(sentence_text, blocks)
        
        # Cache the scores
        self.block_scores_cache[cache_key] = scores
        self._persistent_scores_cache[cache_key] = {str(k): v for k, v in scores.items()}  # JSON requires string keys
        
        # Periodically save to disk (every 10 new entries)
        if len(self.block_scores_cache) % 10 == 0:
            self.save_persistent_block_scores(self._persistent_scores_cache)
        
        return scores

    def score_blocks_for_sentence(self, sentence_text: str, blocks: List[Dict]) -> Dict[int, float]:
        """Score blocks based on relevance to sentence (LLM or heuristic)"""
        

        return self._score_blocks_heuristic(sentence_text, blocks)


    def _score_blocks_heuristic(self, sentence_text: str, blocks: List[Dict]) -> Dict[int, float]:
        """Heuristic block scoring based on text similarity, with line break awareness"""
        sentence_words = set(self._normalize_text_preserve_words(sentence_text).split())
        scores = {}
        
        for block in blocks:
            block_words = set(self._normalize_text_preserve_words(block['normalized_text']).split())
            
            if not sentence_words or not block_words:
                scores[block['block_id']] = 1.0
                continue
            
            # Simple Jaccard similarity
            intersection = len(sentence_words & block_words)
            union = len(sentence_words | block_words)
            jaccard = intersection / union if union > 0 else 0
            
            # Bonus for line break sentences - check if this block might contain part of a line-spanning sentence
            linebreak_bonus = 0.0
            if '\n' in sentence_text:
                # Check if block contains words from either side of the line break
                sentence_parts = sentence_text.split('\n')
                for part in sentence_parts:
                    part_words = set(self._normalize_text_preserve_words(part).split())
                    if part_words & block_words:
                        linebreak_bonus += 0.1
            
            # Convert to 1-10 scale
            base_score = 1.0 + (jaccard * 9.0)
            final_score = min(10.0, base_score + linebreak_bonus)
            scores[block['block_id']] = final_score
            
        return scores

    def find_best_mapping_in_blocks(self, sentence_text: str, high_score_blocks: List[Dict], 
                                   start_constraint: Optional[int] = None) -> Optional[Dict]:
        """Find the best mapping within high-scoring blocks, handling line breaks properly"""
        
        # Enhanced normalization that preserves word boundaries across line breaks
        sentence_words = [w for w in self._normalize_text_preserve_words(sentence_text).split()]
        if len(sentence_words) < 2:
            return None
        
        best_match = None
        best_confidence = 0.0
        
        # Try cross-block matching for sentences that span multiple blocks
        all_candidate_items = []
        for block in high_score_blocks:
            candidate_items = block['items']
            if start_constraint is not None:
                candidate_items = [item for item in candidate_items 
                                 if item['stable_index'] >= start_constraint]
            all_candidate_items.extend(candidate_items)
        
        # Sort by stable_index to maintain reading order
        all_candidate_items.sort(key=lambda x: x['stable_index'])
        
        if not all_candidate_items:
            return None
        
        # Try different span sizes across all candidate items
        max_span_size = min(25, len(all_candidate_items))  # Increased for line-spanning sentences
        
        for span_size in range(max_span_size, 1, -1):
            for start_idx in range(len(all_candidate_items) - span_size + 1):
                span_items = all_candidate_items[start_idx:start_idx + span_size]
                
                # Enhanced span text combination with line break awareness
                span_text, span_words = self._combine_span_text_smart(span_items)
                
                if not span_words:
                    continue
                
                # Enhanced confidence calculation for line-spanning text
                confidence = self._calculate_linebreak_aware_confidence(sentence_words, span_words, sentence_text, span_text)
                
                if confidence > best_confidence and confidence >= 0.25:  # Slightly lower threshold for line breaks
                    best_confidence = confidence
                    
                    # Determine which blocks this span covers
                    span_block_ids = set()
                    for block in high_score_blocks:
                        block_indices = set(item['stable_index'] for item in block['items'])
                        span_indices = set(item['stable_index'] for item in span_items)
                        if block_indices & span_indices:
                            span_block_ids.add(block['block_id'])
                    
                    best_match = {
                        'stable_indices': [item['stable_index'] for item in span_items],
                        'pages': list(set(item['page'] for item in span_items)),
                        'matched_text': span_text,
                        'confidence': confidence,
                        'span_size': span_size,
                        'block_ids': list(span_block_ids),
                        'match_strategy': 'cross_block_linebreak_aware',
                        'debug_info': {
                            'sentence_words': sentence_words[:10],
                            'span_words': span_words[:10],
                            'has_linebreak': '\n' in sentence_text,
                            'span_covers_blocks': len(span_block_ids)
                        }
                    }
        
        return best_match

    def _calculate_match_confidence(self, sentence_words: List[str], span_words: List[str]) -> float:
        """Calculate matching confidence between sentence and span words"""
        if not sentence_words or not span_words:
            return 0.0
        
        sentence_set = set(sentence_words)
        span_set = set(span_words)
        
        # Word overlap
        overlap = len(sentence_set & span_set)
        overlap_ratio = overlap / len(sentence_set)
        
        # Length similarity bonus
        length_ratio = min(len(span_words), len(sentence_words)) / max(len(span_words), len(sentence_words))
        
        # Combined confidence
        confidence = (overlap_ratio * 0.8) + (length_ratio * 0.2)
        return min(1.0, confidence)

    def map_sentences_efficiently(self, sentences: List[str], max_sentences: Optional[int] = None) -> Dict:
        """
        Efficiently map sentences using divide-and-conquer approach
        """
        print(f"🚀 Starting efficient sentence mapping for {len(sentences)} sentences")
        
        # Load PDF.js cache
        self.pdfjs_pages = self.load_pdfjs_cache()
        if not self.pdfjs_pages:
            return {'error': 'Could not load PDF.js cache'}
        
        # Extract significant items
        significant_items = self.extract_significant_items(self.pdfjs_pages)
        total_items = sum(len(items) for items in significant_items.values())
        print(f"📄 Extracted {total_items} significant items from {len(significant_items)} pages")
        
        # Create blocks
        blocks = self.create_item_blocks(significant_items, block_size=10)
        
        # Limit sentences for testing
        if max_sentences:
            sentences = sentences[:max_sentences]
            print(f"🔬 Limited to first {max_sentences} sentences for testing")
        
        # Initialize mapping structure
        mappings = {
            'document_info': {
                'pdf_path': self.pdf_path,
                'total_pages': len(significant_items),
                'total_sentences': len(sentences),
                'total_blocks': len(blocks),
                'created_at': time.time(),
                'mapping_type': 'efficient_divide_conquer'
            },
            'sentence_mappings': {},
            'statistics': {
                'sentences_processed': 0,
                'sentences_mapped': 0,
                'avg_confidence': 0.0,
                'processing_time': 0.0
            }
        }
        
        start_time = time.time()
        last_mapped_index = 0  # Sequential constraint
        mapped_count = 0
        confidence_sum = 0.0
        
        for sentence_id, sentence_text in enumerate(sentences):
            if sentence_id % 20 == 0:
                print(f"🔄 Processing sentence {sentence_id+1}/{len(sentences)}")
            
            try:
                # Score blocks for this sentence
                block_scores = self.score_blocks_for_sentence(sentence_text, blocks)
                
                # Select top-scoring blocks
                sorted_blocks = sorted(blocks, 
                                     key=lambda b: block_scores.get(b['block_id'], 1.0), 
                                     reverse=True)
                high_score_blocks = sorted_blocks[:3]  # Top 3 blocks
                
                # Find best mapping with sequential constraint
                start_constraint = last_mapped_index if last_mapped_index > 0 else None
                best_match = self.find_best_mapping_in_blocks(
                    sentence_text, high_score_blocks, start_constraint)
                
                if best_match:
                    mappings['sentence_mappings'][str(sentence_id)] = {
                        'sentence_id': sentence_id,
                        'text': sentence_text,
                        'stable_indices': best_match['stable_indices'],
                        'pages': best_match['pages'],
                        'confidence': best_match['confidence'],
                        'match_strategy': best_match['match_strategy'],
                        'matched_text': best_match['matched_text'],
                        'span_size': best_match['span_size'],
                        'block_ids': best_match['block_ids']
                    }
                    
                    # Update sequential constraint
                    last_mapped_index = max(best_match['stable_indices']) + 1
                    mapped_count += 1
                    confidence_sum += best_match['confidence']
                    
            except Exception as e:
                print(f"❌ Error processing sentence {sentence_id}: {e}")
                continue
        
        # Finalize statistics
        processing_time = time.time() - start_time
        avg_confidence = confidence_sum / mapped_count if mapped_count > 0 else 0.0
        
        mappings['statistics'].update({
            'sentences_processed': len(sentences),
            'sentences_mapped': mapped_count,
            'mapping_rate': mapped_count / len(sentences) if sentences else 0,
            'avg_confidence': avg_confidence,
            'processing_time': processing_time,
            'sentences_per_second': len(sentences) / processing_time if processing_time > 0 else 0
        })
        
        print(f"✅ Efficient mapping complete:")
        print(f"   📊 {mapped_count}/{len(sentences)} sentences mapped ({mappings['statistics']['mapping_rate']:.1%})")
        print(f"   ⚡ {mappings['statistics']['sentences_per_second']:.1f} sentences/second")
        print(f"   🎯 {avg_confidence:.2f} average confidence")
        
        # Finalize session to save any remaining cache data
        self.finalize_session()

        return mappings

    def finalize_session(self):
        """Save any remaining cached data at the end of processing session"""
        if hasattr(self, '_persistent_scores_cache') and self._persistent_scores_cache:
            self.save_persistent_block_scores(self._persistent_scores_cache)
            print(f"💾 Session finalized: saved {len(self._persistent_scores_cache)} block score entries")



    def _normalize_text_preserve_words(self, text: str) -> str:
        """Enhanced text normalization that preserves word boundaries across line breaks"""
        if not text:
            return ""

        # First, handle line breaks by converting them to spaces
        cleaned = text.replace('\n', ' ').replace('\r', ' ')
        cleaned = cleaned.lower().strip()

        # Normalize whitespace but preserve word boundaries
        cleaned = re.sub(r'\s+', ' ', cleaned)

        # Remove punctuation but be more conservative to preserve meaningful separators
        cleaned = re.sub(r'[^\w\s\-]', ' ', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()

        return cleaned

    def _combine_span_text_smart(self, span_items: List[Dict]) -> Tuple[str, List[str]]:
        """Smart text combination that handles line breaks and spacing"""
        if not span_items:
            return "", []
        
        # Combine text with intelligent spacing
        text_parts = []
        for i, item in enumerate(span_items):
            text = item['text'].strip()
            if text:
                # Add spacing logic based on position and context
                if i > 0:
                    prev_text = span_items[i-1]['text'].strip()
                    # Add space if previous text doesn't end with whitespace and current doesn't start with punctuation
                    if prev_text and not prev_text.endswith(' ') and not text.startswith(('.', ',', '!', '?', ';', ':')):
                        text_parts.append(' ')
                text_parts.append(text)
        
        combined_text = ''.join(text_parts)
        
        # Normalize for word extraction
        normalized_combined = self._normalize_text_preserve_words(combined_text)
        span_words = [w for w in normalized_combined.split() if len(w) > 1]
        
        return combined_text, span_words

    def _calculate_linebreak_aware_confidence(self, sentence_words: List[str], span_words: List[str], 
                                            original_sentence: str, span_text: str) -> float:
        """Enhanced confidence calculation that accounts for line breaks and text flow"""
        if not sentence_words or not span_words:
            return 0.0
        
        sentence_set = set(sentence_words)
        span_set = set(span_words)
        
        # Basic word overlap
        overlap = len(sentence_set & span_set)
        overlap_ratio = overlap / len(sentence_set)
        
        # Bonus for line break sentences that are properly handled
        linebreak_bonus = 0.0
        if '\n' in original_sentence:
            # Check if we're capturing text from both sides of the line break
            sentence_parts = original_sentence.split('\n')
            if len(sentence_parts) >= 2:
                part1_words = set(self._normalize_text_preserve_words(sentence_parts[0]).split())
                part2_words = set(self._normalize_text_preserve_words(sentence_parts[1]).split())
                
                part1_in_span = len(part1_words & span_set) / len(part1_words) if part1_words else 0
                part2_in_span = len(part2_words & span_set) / len(part2_words) if part2_words else 0
                
                # Bonus if we capture significant portions from both parts
                if part1_in_span > 0.5 and part2_in_span > 0.5:
                    linebreak_bonus = 0.1
        
        # Sequence preservation bonus (important for line-break text)
        sequence_bonus = self._calculate_sequence_preservation(sentence_words, span_words) * 0.1
        
        # Length similarity
        length_ratio = min(len(span_words), len(sentence_words)) / max(len(span_words), len(sentence_words))
        length_bonus = length_ratio * 0.1
        
        # Combined confidence
        confidence = overlap_ratio + linebreak_bonus + sequence_bonus + length_bonus
        return min(1.0, confidence)

    def _calculate_sequence_preservation(self, sentence_words: List[str], span_words: List[str]) -> float:
        """Calculate how well the sequence of words is preserved"""
        if not sentence_words or not span_words:
            return 0.0
        
        # Find longest common subsequence
        from difflib import SequenceMatcher
        matcher = SequenceMatcher(None, sentence_words, span_words)
        matching_blocks = matcher.get_matching_blocks()
        
        # Calculate sequence preservation score
        total_matching_length = sum(block.size for block in matching_blocks)
        sequence_score = total_matching_length / len(sentence_words)
        
        return min(1.0, sequence_score)


# Cache management utilities

def list_cached_blocks() -> Dict:
    """List all cached block data"""
    cache_base_dir = Path(os.getcwd()) / 'blocks_cache'
    
    if not cache_base_dir.exists():
        return {'cached_pdfs': [], 'total': 0}
    
    cached_pdfs = []
    for pdf_dir in cache_base_dir.iterdir():
        if pdf_dir.is_dir():
            # Look for block files
            block_files = list(pdf_dir.glob('blocks_size_*.json'))
            scores_file = pdf_dir / 'block_scores_cache.json'
            
            for block_file in block_files:
                try:
                    with open(block_file, 'r', encoding='utf-8') as f:
                        block_data = json.load(f)
                    
                    # Check for scores cache
                    scores_info = {'has_scores_cache': False, 'scores_count': 0}
                    if scores_file.exists():
                        try:
                            with open(scores_file, 'r', encoding='utf-8') as f:
                                scores_data = json.load(f)
                            scores_info = {
                                'has_scores_cache': True,
                                'scores_count': scores_data.get('total_entries', 0),
                                'scores_last_updated': scores_data.get('update_date', 'unknown')
                            }
                        except Exception:
                            pass
                    
                    cached_pdfs.append({
                        'basename': pdf_dir.name,
                        'pdf_file': block_data.get('pdf_file', 'unknown'),
                        'creation_date': block_data.get('creation_date', 'unknown'),
                        'block_size': block_data.get('block_size', 10),
                        'total_blocks': block_data.get('total_blocks', 0),
                        'total_items': block_data['statistics'].get('total_items', 0),
                        'cache_dir': str(pdf_dir),
                        'cache_size_mb': sum(f.stat().st_size for f in pdf_dir.rglob('*.json')) / (1024*1024),
                        **scores_info
                    })
                except Exception as e:
                    print(f"⚠️ Error reading blocks cache for {pdf_dir}: {e}")
    
    return {
        'cached_pdfs': sorted(cached_pdfs, key=lambda x: x['creation_date'], reverse=True),
        'total': len(cached_pdfs),
        'total_size_mb': sum(pdf['cache_size_mb'] for pdf in cached_pdfs)
    }

def clear_blocks_cache(pdf_basename: str = None, clear_scores: bool = False) -> bool:
    """Clear blocks cache for a specific PDF or all PDFs"""
    cache_base_dir = Path(os.getcwd()) / 'blocks_cache'
    
    if not cache_base_dir.exists():
        print("No blocks cache directory found")
        return True
    
    try:
        if pdf_basename:
            # Clear specific PDF cache
            pdf_cache_dir = cache_base_dir / pdf_basename
            if pdf_cache_dir.exists():
                if clear_scores:
                    import shutil
                    shutil.rmtree(pdf_cache_dir)
                    print(f"✅ Cleared all blocks cache for {pdf_basename}")
                else:
                    # Clear only block files, keep scores
                    block_files = list(pdf_cache_dir.glob('blocks_size_*.json'))
                    for block_file in block_files:
                        block_file.unlink()
                    print(f"✅ Cleared block files for {pdf_basename} (kept scores cache)")
                return True
            else:
                print(f"⚠️ No blocks cache found for {pdf_basename}")
                return False
        else:
            # Clear all caches  
            import shutil
            shutil.rmtree(cache_base_dir)
            print("✅ Cleared all blocks caches")
            return True
            
    except Exception as e:
        print(f"❌ Error clearing blocks cache: {e}")
        return False

def get_cache_stats() -> Dict:
    """Get comprehensive cache statistics"""
    stats = {
        'pdfjs_cache': {},
        'blocks_cache': {},
        'total_cache_size_mb': 0
    }
    
    # PDF.js cache stats
    pdfjs_cache_dir = Path(os.getcwd()) / 'pdfjs_cache'
    if pdfjs_cache_dir.exists():
        pdfjs_size = sum(f.stat().st_size for f in pdfjs_cache_dir.rglob('*.json')) / (1024*1024)
        pdfjs_count = len([d for d in pdfjs_cache_dir.iterdir() if d.is_dir()])
        stats['pdfjs_cache'] = {
            'exists': True,
            'size_mb': pdfjs_size,
            'pdf_count': pdfjs_count
        }
        stats['total_cache_size_mb'] += pdfjs_size
    
    # Blocks cache stats
    blocks_info = list_cached_blocks()
    stats['blocks_cache'] = {
        'exists': len(blocks_info['cached_pdfs']) > 0,
        'size_mb': blocks_info['total_size_mb'],
        'pdf_count': blocks_info['total'],
        'with_scores_cache': len([p for p in blocks_info['cached_pdfs'] if p['has_scores_cache']])
    }
    stats['total_cache_size_mb'] += blocks_info['total_size_mb']
    
    return stats

# API Functions

def process_sentences_efficiently(pdf_path: str, sentences_path: str, 
                                 output_file: str = None, max_sentences: int = None) -> Dict:
    """
    Process sentences using efficient divide-and-conquer approach
    """
    try:
        # Load sentences
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        if not isinstance(sentences_data, list):
            raise ValueError(f"Expected sentences.json to be a list, got {type(sentences_data)}")
        
        sentences = [str(sentence) for sentence in sentences_data]
        print(f"📝 Loaded {len(sentences)} sentences from {sentences_path}")
        
        # Process with efficient mapper
        mapper = EfficientSentenceMapper(pdf_path, verbose=True)
        mappings = mapper.map_sentences_efficiently(sentences, max_sentences)
        
        # Save if output file specified
        if output_file:
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(mappings, f, indent=2, ensure_ascii=False)
            print(f"💾 Saved efficient mappings to {output_file}")
        
        return mappings
        
    except Exception as e:
        print(f"❌ Error in efficient processing: {e}")
        return {'error': str(e)}

# Main execution for testing
if __name__ == "__main__":
    # Example usage
    uploads_dir = os.path.join(os.getcwd(), "uploads")
    sentences_dir = os.path.join(os.getcwd(), 'sentences')

    files = os.listdir(uploads_dir)
    pdf_files = [f for f in files if f.endswith('.pdf')]

    for pdf_filename in pdf_files:
        basename = pdf_filename.replace('.pdf', '')

        print(f"\n🔄 Processing {basename}")
        
        # Find PDF file
        pdf_file = safe_find_file(basename, "pdf")
        if not pdf_file:
            print(f"❌ PDF not found for {basename}")
            continue
            
        pdf_path = pdf_file['path']
        sentences_path = os.path.join(sentences_dir, f"{basename}_sentences.json")
        
        # Test efficient mapping
        output_file = os.path.join(os.getcwd(), 'efficient_mappings', f"{basename}_efficient_mappings.json")
        
        mapping_results = process_sentences_efficiently(
            pdf_path, sentences_path, output_file, max_sentences=100  # Test with 100 sentences
        )
        
        if 'error' not in mapping_results:
            print(f"✅ Efficient mapping complete for {basename}")
            
        else:
            print(f"❌ Mapping failed for {basename}: {mapping_results['error']}")