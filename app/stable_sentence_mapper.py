import json, logging, os, re, subprocess, tempfile
from typing import Dict, List, Optional, Tuple, Union
from difflib import SequenceMatcher
from pathlib import Path
import time
from collections import defaultdict


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

class EnhancedStableSentenceToPDFJSMapper:
    """Enhanced mapper with consecutive span detection and whitespace filtering"""
    
    def __init__(self, pdf_path: str, verbose: bool = False):
        self.pdf_path = pdf_path
        self.verbose = verbose
        self.pdfjs_pages = None
        self.page_text_caches = {}
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

    def create_enhanced_extraction_script(self) -> str:
        """Create Node.js script that extracts PDF.js content with stable item indices"""
        return '''
const fs = require('fs');
const path = require('path');

// Try to load pdfjs-dist
let pdfjsLib;
try {
    pdfjsLib = require('pdfjs-dist/build/pdf');
} catch (error) {
    console.error('Error: pdfjs-dist not found. Please install it with: npm install pdfjs-dist');
    process.exit(1);
}

pdfjsLib.GlobalWorkerOptions.workerSrc = null;

async function extractStableTextContent(pdfPath) {
    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found: ${pdfPath}`);
        }
        
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const pdf = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
        
        const pages = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            try {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.0 });
                const textContent = await page.getTextContent();
                
                // Create stable item references with consistent indexing
                const stableItems = textContent.items.map((item, itemIndex) => {
                    const transform = item.transform || [1, 0, 0, 1, 0, 0];
                    
                    // Calculate position consistently
                    const x = transform[4];
                    const y = viewport.height - transform[5]; // Flip Y for top-origin
                    
                    return {
                        // STABLE REFERENCE: Use consistent itemIndex within page
                        stableIndex: itemIndex,
                        pageNumber: pageNum,
                        
                        // Text content
                        str: item.str || '',
                        normalizedText: (item.str || '').toLowerCase().replace(/\\s+/g, ' ').trim(),
                        
                        // Enhanced: Mark whitespace-only items
                        isWhitespaceOnly: /^\\s*$/.test(item.str || ''),
                        hasSignificantText: /\\w/.test(item.str || ''),
                        
                        // Position data
                        x: x,
                        y: y,
                        width: item.width || 0,
                        height: item.height || 0,
                        
                        // Additional metadata for matching
                        dir: item.dir || 'ltr',
                        fontName: item.fontName || 'default',
                        fontSize: item.height || 12,
                        hasEOL: item.hasEOL || false,
                        
                        // Create multiple identification strategies
                        identifiers: {
                            textFingerprint: createTextFingerprint(item.str || '', itemIndex),
                            positionHash: createPositionHash(x, y, item.width || 0, item.height || 0),
                            contextFingerprint: null // Will be filled in context analysis
                        }
                    };
                });
                
                // Add context fingerprints (text before/after for disambiguation)
                stableItems.forEach((item, index) => {
                    const before = index > 0 ? stableItems[index - 1].str : '';
                    const after = index < stableItems.length - 1 ? stableItems[index + 1].str : '';
                    item.identifiers.contextFingerprint = createContextFingerprint(before, item.str, after);
                });
                
                pages.push({
                    pageNumber: pageNum,
                    viewport: {
                        width: viewport.width,
                        height: viewport.height
                    },
                    stableItems: stableItems,
                    itemCount: stableItems.length,
                    significantItemCount: stableItems.filter(item => item.hasSignificantText).length,
                    textContentHash: createPageTextHash(stableItems)
                });
                
            } catch (pageError) {
                pages.push({
                    pageNumber: pageNum,
                    stableItems: [],
                    error: pageError.message
                });
            }
        }
        
        console.log(JSON.stringify(pages));
        
    } catch (error) {
        console.error(`PDF extraction failed: ${error.message}`);
        process.exit(1);
    }
}

function createTextFingerprint(text, index) {
    // Create a unique fingerprint for text content
    const cleanText = text.toLowerCase().replace(/[^\\w]/g, '');
    return `${cleanText}_${index}_${text.length}`;
}

function createPositionHash(x, y, width, height) {
    // Create position-based hash (rounded to avoid float precision issues)
    return `${Math.round(x)}_${Math.round(y)}_${Math.round(width)}_${Math.round(height)}`;
}

function createContextFingerprint(before, current, after) {
    // Create context-aware fingerprint
    const cleanBefore = (before || '').replace(/[^\\w]/g, '').slice(-10);
    const cleanCurrent = (current || '').replace(/[^\\w]/g, '');
    const cleanAfter = (after || '').replace(/[^\\w]/g, '').slice(0, 10);
    return `${cleanBefore}|${cleanCurrent}|${cleanAfter}`;
}

function createPageTextHash(items) {
    // Create hash of entire page text content for verification
    const allText = items.map(item => item.str).join('');
    return allText.length + '_' + (allText.match(/\\w/g) || []).length;
}

const pdfPath = process.argv[2];
if (!pdfPath) {
    console.error('Usage: node script.js <pdf_path>');
    process.exit(1);
}

extractStableTextContent(path.resolve(pdfPath));
'''

    def get_pdfjs_cache_dir(self) -> Path:
        """Get or create the PDF.js cache directory"""
        pdf_basename = Path(self.pdf_path).stem
        cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir

    def load_cached_pdfjs_data(self) -> Optional[List[Dict]]:
        """Load cached PDF.js data if available and recent"""
        try:
            cache_dir = self.get_pdfjs_cache_dir()
            summary_file = cache_dir / 'extraction_summary.json'
            
            if not summary_file.exists():
                return None
            
            # Check if cache is newer than PDF file
            pdf_mtime = os.path.getmtime(self.pdf_path)
            cache_mtime = os.path.getmtime(summary_file)
            
            if cache_mtime < pdf_mtime:
                print(f"📰 Cache is older than PDF file, will re-extract")
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
            
            print(f"✅ Loaded cached PDF.js data: {len(pages_data)} pages from {cache_dir}")
            return pages_data
            
        except Exception as e:
            print(f"⚠️ Failed to load cached data: {e}")
            return None

    def save_pdfjs_data_to_cache(self, pdfjs_data: List[Dict]) -> None:
        """Save PDF.js data to individual page JSON files"""
        try:
            cache_dir = self.get_pdfjs_cache_dir()
            pdf_basename = Path(self.pdf_path).stem
            
            # Save individual page files
            page_files = []
            for page_data in pdfjs_data:
                page_num = page_data['pageNumber']
                page_filename = f"page_{page_num:03d}.json"
                page_file = cache_dir / page_filename
                
                with open(page_file, 'w', encoding='utf-8') as f:
                    json.dump(page_data, f, indent=2, ensure_ascii=False)
                
                page_files.append({
                    'page_number': page_num,
                    'filename': page_filename,
                    'item_count': len(page_data.get('stableItems', [])),
                    'significant_items': len([item for item in page_data.get('stableItems', []) 
                                           if item.get('hasSignificantText', True)]),
                    'has_error': 'error' in page_data
                })
            
            # Save extraction summary
            summary = {
                'pdf_file': self.pdf_path,
                'pdf_basename': pdf_basename,
                'extraction_timestamp': time.time(),
                'extraction_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                'total_pages': len(pdfjs_data),
                'cache_directory': str(cache_dir),
                'pages': page_files,
                'statistics': {
                    'total_items': sum(len(page.get('stableItems', [])) for page in pdfjs_data),
                    'total_significant_items': sum(len([item for item in page.get('stableItems', []) 
                                                      if item.get('hasSignificantText', True)]) 
                                                 for page in pdfjs_data),
                    'pages_with_errors': sum(1 for page in pdfjs_data if 'error' in page)
                }
            }
            
            summary_file = cache_dir / 'extraction_summary.json'
            with open(summary_file, 'w', encoding='utf-8') as f:
                json.dump(summary, f, indent=2, ensure_ascii=False)
            
            print(f"💾 Saved PDF.js data to cache:")
            print(f"   📁 Directory: {cache_dir}")
            print(f"   📄 Pages: {len(page_files)} individual JSON files")
            print(f"   📊 Items: {summary['statistics']['total_items']} total, {summary['statistics']['total_significant_items']} significant")
            
        except Exception as e:
            print(f"❌ Failed to save PDF.js data to cache: {e}")

    def extract_stable_pdfjs_content(self) -> Optional[List[Dict]]:
        """Extract PDF.js content with stable item references, using cache when available"""
        
        if self.pdfjs_pages:
            return self.pdfjs_pages
        
        # Try to load from cache first
        cached_data = self.load_cached_pdfjs_data()
        if cached_data:
            self.pdfjs_pages = cached_data
            return cached_data
        
        try:
            print(f"🔄 Extracting PDF.js content from: {self.pdf_path}")
            
            # Check if we have a Node.js workspace
            workspace_dir = Path(os.path.join(os.getcwd(), "pdf_stable_workspace"))
            
            if workspace_dir.exists() and (workspace_dir / "extract_pdf.js").exists():
                # Use workspace script
                script_path = workspace_dir / "extract_pdf.js"
                
                result = subprocess.run([
                    'node', str(script_path), self.pdf_path
                ], cwd=workspace_dir, capture_output=True, text=True, 
                    encoding='utf-8', errors='replace', timeout=120)
                
            else:
                # Use enhanced inline script
                print("Using enhanced PDF.js extraction script")
                inline_script = self.create_enhanced_extraction_script()
                
                with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as temp_script:
                    temp_script.write(inline_script)
                    temp_script_path = temp_script.name
                
                try:
                    result = subprocess.run([
                        'node', temp_script_path, self.pdf_path
                    ], capture_output=True, text=True, 
                       encoding='utf-8', errors='replace', timeout=120)
                finally:
                    os.unlink(temp_script_path)
            
            if result.returncode != 0:
                print(f"❌ PDF.js extraction failed: {result.stderr}")
                return None
            
            if not result.stdout or not result.stdout.strip():
                print("❌ PDF.js extraction returned empty output")
                return None
            
            # Parse the JSON output
            try:
                pdfjs_data = json.loads(result.stdout)
                print(f"✅ Extracted {len(pdfjs_data)} pages with stable references")
                
                # Save to cache
                self.save_pdfjs_data_to_cache(pdfjs_data)
                
                # Cache the results in memory
                self.pdfjs_pages = pdfjs_data
                return pdfjs_data
                
            except json.JSONDecodeError as e:
                print(f"❌ Failed to parse PDF.js output: {e}")
                return None
                
        except subprocess.TimeoutExpired:
            print("❌ PDF.js extraction timed out after 120 seconds")
            return None
        except Exception as e:
            print(f"❌ Failed to extract PDF.js content: {e}")
            return None

    def create_filtered_item_mapping(self, page_items: List[Dict]) -> Dict:
        """Create a mapping between original indices and filtered indices (excluding whitespace-only items)"""
        
        # Keep track of original to filtered index mapping
        original_to_filtered = {}
        filtered_to_original = {}
        filtered_items = []
        
        filtered_index = 0
        for original_index, item in enumerate(page_items):
            # Check if item has significant text (backward compatible)
            has_significant_text = item.get('hasSignificantText')
            if has_significant_text is None:
                # Fallback: check if text contains word characters
                text = item.get('str', item.get('text', ''))
                has_significant_text = bool(re.search(r'\w', text))
            
            if has_significant_text:  # Keep items with significant text
                original_to_filtered[original_index] = filtered_index
                filtered_to_original[filtered_index] = original_index
                filtered_items.append(item)
                filtered_index += 1
        
        return {
            'original_to_filtered': original_to_filtered,
            'filtered_to_original': filtered_to_original,
            'filtered_items': filtered_items,
            'total_original': len(page_items),
            'total_filtered': len(filtered_items)
        }

    def find_consecutive_span_matches(self, sentence_text: str, page_items: List[Dict], page_num: int) -> List[Dict]:
        """Find consecutive span matches using filtered indices but preserving original stable indices"""
        
        clean_sentence = self._normalize_text(sentence_text)
        if len(clean_sentence) < 5:
            return []
        
        # Create filtered mapping
        try:
            filtered_mapping = self.create_filtered_item_mapping(page_items)
            filtered_items = filtered_mapping['filtered_items']
        except Exception as e:
            print(f"❌ Error creating filtered mapping for page {page_num}: {e}")
            print(f"   Page items structure: {type(page_items)}, length: {len(page_items) if isinstance(page_items, list) else 'N/A'}")
            if page_items and len(page_items) > 0:
                print(f"   First item keys: {list(page_items[0].keys()) if isinstance(page_items[0], dict) else 'Not a dict'}")
            raise
        
        sentence_words = [w for w in clean_sentence.split()]
        if len(filtered_items) < 2:
            return []
        
        
        matches = []
        
        # Try different span sizes, starting with longer spans
        max_span_size = min(len(filtered_items), 20)  # Don't try unreasonably long spans
        
        for span_size in range(max_span_size, 1, -1):  # Start with longer spans
            if len(matches) >= 3:  # Stop if we already have good matches
                break
                
            for start_idx in range(len(filtered_items) - span_size + 1):
                if len(matches) >= 5:  # Limit total matches
                    break
                    
                span_items = filtered_items[start_idx:start_idx + span_size]
                
                try:
                    # Get original stable indices for this span
                    original_indices = []
                    for filtered_idx in range(start_idx, start_idx + span_size):
                        original_idx = filtered_mapping['filtered_to_original'][filtered_idx]
                        original_indices.append(original_idx)
                    
                    # Combine text from span (significant text only) - with error handling
                    combined_text_parts = []
                    for item in span_items:
                        if item.get('hasSignificantText', True):
                            text = item.get('str', item.get('text', ''))
                            if text:
                                combined_text_parts.append(text)
                    
                    combined_text = ' '.join(combined_text_parts)
                    combined_words = [w for w in self._normalize_text(combined_text).split()]
                    
                    if not combined_words:
                        continue
                    
                    # Calculate word overlap
                    overlap_score = self._calculate_enhanced_overlap(sentence_words, combined_words)
                    
                    # Enhanced: Check for consecutive word sequences
                    sequence_score = self._calculate_sequence_score(sentence_words, combined_words)
                    
                    # Combined scoring
                    combined_score = (overlap_score * 0.6) + (sequence_score * 0.4)
                    
                    if combined_score >= 0.4:  # Threshold for consecutive spans
                        # Calculate coverage
                        sentence_set = set(sentence_words)
                        span_set = set(combined_words)
                        coverage = len(sentence_set & span_set) / len(sentence_set) if sentence_set else 0
                        
                        # Final confidence calculation
                        confidence = min(0.95, combined_score + (coverage * 0.1))
                        
                        match = {
                            'page': page_num,
                            'stable_index': original_indices[0],  # First original index
                            'item_span': original_indices,  # All original indices in span
                            'filtered_span': list(range(start_idx, start_idx + span_size)),  # Filtered indices for debugging
                            'confidence': confidence,
                            'match_strategy': f'consecutive_filtered_span_{span_size}',
                            'matched_text': combined_text,
                            'overlap_score': overlap_score,
                            'sequence_score': sequence_score,
                            'coverage_score': coverage,
                            'span_info': {
                                'span_size': span_size,
                                'original_span_size': len(original_indices),
                                'word_count': len(combined_words),
                                'sentence_word_count': len(sentence_words)
                            },
                            'debug_info': {
                                'sentence_words': sentence_words[:10],  # First 10 for debugging
                                'span_words': combined_words[:10],
                                'filtered_start': start_idx,
                                'original_start': original_indices[0],
                                'original_end': original_indices[-1]
                            }
                        }
                        
                        matches.append(match)
                        
                except Exception as e:
                    print(f"❌ Error processing span {start_idx}-{start_idx + span_size} on page {page_num}: {e}")
                    print(f"   Span items type: {type(span_items)}")
                    if span_items:
                        print(f"   First span item keys: {list(span_items[0].keys()) if isinstance(span_items[0], dict) else 'Not a dict'}")
                    continue
        
        # Sort by confidence and span size (prefer longer, more confident spans)
        matches.sort(key=lambda x: (x['confidence'], len(x['item_span'])), reverse=True)
        
        # Remove overlapping matches (keep the best one)
        filtered_matches = []
        used_indices = set()
        
        for match in matches:
            match_indices = set(match['item_span'])
            if not match_indices & used_indices:  # No overlap with already used indices
                filtered_matches.append(match)
                used_indices.update(match_indices)
        
        return filtered_matches[:3]  # Return top 3 non-overlapping matches

    def _calculate_enhanced_overlap(self, sentence_words: List[str], span_words: List[str]) -> float:
        """Calculate enhanced word overlap with partial matching"""
        
        if not sentence_words or not span_words:
            return 0.0
        
        sentence_set = set(sentence_words)
        span_set = set(span_words)
        
        # Exact word overlap
        exact_overlap = len(sentence_set & span_set)

        # early exit if we have a high exact overlap
        if exact_overlap / len(sentence_words) >= .8:
            return exact_overlap / len(sentence_words)

        # Partial word overlap (for stemming, prefixes, etc.)
        partial_matches = 0
        for s_word in sentence_words:
            if s_word not in span_set:
                for span_word in span_words:
                    if len(s_word) >= 4 and len(span_word) >= 4:
                        if (s_word.startswith(span_word[:3]) or span_word.startswith(s_word[:3]) or
                            s_word.endswith(span_word[-3:]) or span_word.endswith(s_word[-3:])):
                            partial_matches += 1
                            break
        
        # Calculate overlap ratio
        total_matches = exact_overlap + (partial_matches * 0.5)
        overlap_ratio = total_matches / len(sentence_words)
        
        return min(1.0, overlap_ratio)

    def _calculate_sequence_score(self, sentence_words: List[str], span_words: List[str]) -> float:
        """Calculate score based on consecutive word sequences"""
        
        if not sentence_words or not span_words:
            return 0.0
        
        # Find longest common subsequence
        matcher = SequenceMatcher(None, sentence_words, span_words)
        matching_blocks = matcher.get_matching_blocks()
        
        # Calculate sequence score based on matching blocks
        total_matching_length = sum(block.size for block in matching_blocks)
        sequence_score = total_matching_length / len(sentence_words)
        
        return min(1.0, sequence_score)

    def create_stable_element_mappings(self, sentences: List[Union[str, Dict]]) -> Dict:
        """Create sentence-to-element mappings using enhanced consecutive span detection"""
        
        print(f"🗺️ Creating enhanced stable element mappings for {len(sentences)} sentences")
        
        # Extract PDF.js content if not already done
        if not self.pdfjs_pages:
            self.extract_stable_pdfjs_content()
        
        if not self.pdfjs_pages:
            print("❌ Could not extract PDF.js content")
            return {'error': 'PDF extraction failed'}
        
        # Create mappings using enhanced consecutive span detection
        mappings = {
            'document_info': {
                'pdf_path': self.pdf_path,
                'total_pages': len(self.pdfjs_pages),
                'total_sentences': len(sentences),
                'created_at': time.time(),
                'mapping_type': 'enhanced_consecutive_spans'
            },
            'page_items': {},  # page_num -> list of stable item info
            'sentence_to_items': {},  # sentence_id -> stable item references
            'item_to_sentences': {},   # item_reference -> list of sentence_ids
            'filtering_stats': {}  # Statistics about whitespace filtering
        }

        return mappings
        
        # First pass: Build stable item references for each page with filtering stats
        print("🏗️ Building stable item references with filtering...")
        for page_data in self.pdfjs_pages:
            page_num = page_data['pageNumber']
            stable_items = page_data.get('stableItems', [])
            
            # Create filtered mapping for this page
            filtered_mapping = self.create_filtered_item_mapping(stable_items)
            
            # Store filtering statistics
            mappings['filtering_stats'][page_num] = {
                'total_items': filtered_mapping['total_original'],
                'significant_items': filtered_mapping['total_filtered'],
                'whitespace_items': filtered_mapping['total_original'] - filtered_mapping['total_filtered'],
                'filter_ratio': filtered_mapping['total_filtered'] / filtered_mapping['total_original'] if filtered_mapping['total_original'] > 0 else 0
            }
            
            # Store stable item references (all items, not just filtered)
            page_items = []
            for item in stable_items:
                # Backward compatible property access
                item_text = item.get('str', '')
                normalized_text = item.get('normalizedText', item_text.lower().strip())
                
                # Check for enhanced properties with fallbacks
                is_whitespace_only = item.get('isWhitespaceOnly')
                if is_whitespace_only is None:
                    is_whitespace_only = not bool(re.search(r'\w', item_text))
                
                has_significant_text = item.get('hasSignificantText')
                if has_significant_text is None:
                    has_significant_text = bool(re.search(r'\w', item_text))
                
                stable_reference = {
                    'stable_index': item['stableIndex'],
                    'page': page_num,
                    'text': item_text,
                    'normalized_text': normalized_text,
                    'is_whitespace_only': is_whitespace_only,
                    'has_significant_text': has_significant_text,
                    'position': {
                        'x': item.get('x', 0),
                        'y': item.get('y', 0),
                        'width': item.get('width', 0),
                        'height': item.get('height', 0)
                    },
                    'identifiers': item.get('identifiers', {}),
                    'font_info': {
                        'font_name': item.get('fontName', 'default'),
                        'font_size': item.get('fontSize', 12)
                    }
                }
                
                # Create multiple selector strategies for this stable item
                stable_reference['selectors'] = self._create_stable_selectors(stable_reference)
                page_items.append(stable_reference)
            
            mappings['page_items'][page_num] = page_items
        
        # Second pass: Map sentences to stable items using enhanced consecutive detection
        print("🔗 Mapping sentences to consecutive stable item spans...")
        found_count = 0
        total_spans = 0
        
        for sentence_id, sentence_text in enumerate(sentences):
            # sentences.json is a simple list of strings, index = sentence_id
            sentence_text = str(sentence_text)

            # filter out excessively long sentences
            
            if sentence_id % 50 == 0:  # Progress indicator
                print(f"🔄 Processing sentence {sentence_id+1}/{len(sentences)}")
            
            try:
                # Find best consecutive span matches for this sentence
                consecutive_matches = self._find_sentence_consecutive_spans(sentence_text, mappings['page_items'])
                
                if consecutive_matches:
                    found_count += 1
                    total_spans += sum(len(match['item_span']) for match in consecutive_matches)
                    
                    # Store sentence mapping with consecutive span references
                    mappings['sentence_to_items'][str(sentence_id)] = {
                        'sentence_id': sentence_id,
                        'text': sentence_text,
                        'consecutive_matches': consecutive_matches,
                        'primary_page': consecutive_matches[0]['page'] if consecutive_matches else None,
                        'confidence': max(match['confidence'] for match in consecutive_matches) if consecutive_matches else 0,
                        'match_strategy': consecutive_matches[0]['match_strategy'] if consecutive_matches else 'none',
                        'total_spans': len(consecutive_matches),
                        'total_items': sum(len(match['item_span']) for match in consecutive_matches),
                        'span_info': {
                            'longest_span': max(len(match['item_span']) for match in consecutive_matches) if consecutive_matches else 0,
                            'shortest_span': min(len(match['item_span']) for match in consecutive_matches) if consecutive_matches else 0,
                            'avg_confidence': sum(match['confidence'] for match in consecutive_matches) / len(consecutive_matches) if consecutive_matches else 0
                        }
                    }
                    
                    # Build reverse mapping (stable items -> sentences)
                    for match in consecutive_matches:
                        for stable_idx in match['item_span']:
                            item_key = f"{match['page']}_{stable_idx}"
                            if item_key not in mappings['item_to_sentences']:
                                mappings['item_to_sentences'][item_key] = []
                            mappings['item_to_sentences'][item_key].append(sentence_id)
                            
            except Exception as e:
                print(f"❌ Error processing sentence {sentence_id}: {sentence_text[:50]}...")
                print(f"   Error: {e}")
                print(f"   Error type: {type(e)}")
                import traceback
                traceback.print_exc()
                # Continue with next sentence instead of failing completely
                continue
        
        # Add comprehensive statistics
        mappings['statistics'] = {
            'total_sentences': len(sentences),
            'mapped_sentences': found_count,
            'mapping_rate': found_count / len(sentences) if sentences else 0,
            'total_stable_items': sum(len(page_items) for page_items in mappings['page_items'].values()),
            'items_with_sentences': len(mappings['item_to_sentences']),
            'total_mapped_spans': total_spans,
            'avg_spans_per_sentence': total_spans / found_count if found_count > 0 else 0,
            'total_pages': len(mappings['page_items']),
            'filtering_summary': {
                'total_items_all_pages': sum(stats['total_items'] for stats in mappings['filtering_stats'].values()),
                'significant_items_all_pages': sum(stats['significant_items'] for stats in mappings['filtering_stats'].values()),
                'avg_filter_ratio': sum(stats['filter_ratio'] for stats in mappings['filtering_stats'].values()) / len(mappings['filtering_stats']) if mappings['filtering_stats'] else 0
            }
        }
        
        print(f"✅ Enhanced consecutive span mapping complete:")
        print(f"   📊 {found_count}/{len(sentences)} sentences mapped ({mappings['statistics']['mapping_rate']:.1%})")
        print(f"   🔗 {total_spans} total spans mapped ({mappings['statistics']['avg_spans_per_sentence']:.1f} avg per sentence)")
        print(f"   🎯 {mappings['statistics']['filtering_summary']['avg_filter_ratio']:.1%} average filter ratio")
        
        return mappings

    def _find_sentence_consecutive_spans(self, sentence_text: str, page_items: Dict) -> List[Dict]:
        """Find matches for a sentence across all pages, prioritizing consecutive spans but including other matches"""
        
        clean_sentence = self._normalize_text(sentence_text)
        # filter out very short or very long sentences
        if len(clean_sentence) < 5 or len(clean_sentence) > 500:
            print(f"❌ Skipping sentence due to length: {len(clean_sentence)} characters")
            return []
        
        all_matches = []
        
        # Search across all pages
        for page_num, items in page_items.items():
            # Strategy 1: Consecutive spans (highest priority)
            consecutive_matches = self.find_consecutive_span_matches(sentence_text, items, page_num)
            for match in consecutive_matches:
                match['priority'] = 100  # Highest priority
                all_matches.append(match)
            
            # Strategy 2: Individual item matches (fallback)
            individual_matches = self.find_individual_item_matches(sentence_text, items, page_num)
            for match in individual_matches:
                match['priority'] = 80  # Lower priority
                all_matches.append(match)
            
            # Strategy 3: Non-consecutive multi-item spans (medium priority)
            multi_item_matches = self.find_multi_item_matches(sentence_text, items, page_num)  
            for match in multi_item_matches:
                match['priority'] = 90  # Medium priority
                all_matches.append(match)
        
        # Sort by priority first, then confidence and span size
        all_matches.sort(key=lambda x: (x['priority'], x['confidence'], len(x.get('item_span', []))), reverse=True)
        
        # Remove overlapping matches, keeping higher priority/confidence ones
        final_matches = self._remove_overlapping_matches(all_matches)
        
        return final_matches[:5]  # Return top 5 matches across all strategies

    def find_individual_item_matches(self, sentence_text: str, page_items: List[Dict], page_num: int) -> List[Dict]:
        """Find individual item matches as fallback when consecutive spans don't work"""
        
        clean_sentence = self._normalize_text(sentence_text)
        sentence_words = [w for w in clean_sentence.split()]
        
        if len(sentence_words) < 2 or len(sentence_words) > 50:  # Filter out very short or long sentences
            return []
        
        matches = []
        
        # Look for individual items with high text overlap
        for item in page_items:
            if not item.get('has_significant_text', True):
                continue
                
            item_text = item.get('text', '')
            item_words = [w for w in self._normalize_text(item_text).split()]
            
            if not item_words:
                continue
            
            # Calculate overlap
            overlap_score = self._calculate_enhanced_overlap(sentence_words, item_words)
            
            if overlap_score >= 0.3:  # Lower threshold for individual items
                confidence = min(0.85, overlap_score)  # Cap confidence lower than consecutive spans
                
                match = {
                    'page': page_num,
                    'stable_index': item['stable_index'],
                    'item_span': [item['stable_index']],
                    'confidence': confidence,
                    'match_strategy': 'individual_item',
                    'matched_text': item_text,
                    'overlap_score': overlap_score,
                    'span_info': {
                        'span_size': 1,
                        'word_count': len(item_words),
                        'sentence_word_count': len(sentence_words)
                    }
                }
                matches.append(match)
        
        # Sort by confidence
        matches.sort(key=lambda x: x['confidence'], reverse=True)
        return matches[:5]  # Top 5 individual matches

    def find_multi_item_matches(self, sentence_text: str, page_items: List[Dict], page_num: int) -> List[Dict]:
        """Find non-consecutive multi-item matches (allowing gaps)"""
        
        clean_sentence = self._normalize_text(sentence_text)
        sentence_words = [w for w in clean_sentence.split()]
        if len(sentence_words) < 4 or len(sentence_words) > 100:  # Only for longer sentences but also not ridiculously long ones
            return []
        
        # Get significant items only
        significant_items = [item for item in page_items if item.get('has_significant_text', True)]
        
        if len(significant_items) < 2:
            return []
        
        matches = []
        
        # Try combinations of 2-5 non-consecutive items
        for combo_size in range(2, min(6, len(significant_items) + 1)):
            if len(matches) >= 3:  # Limit matches
                break
                
            # Try sliding windows with gaps
            for start_idx in range(len(significant_items) - combo_size + 1):
                # Allow gaps between items (not strictly consecutive)
                for gap_size in range(1, min(4, len(significant_items) - start_idx - combo_size + 2)):
                    if start_idx + (combo_size - 1) * gap_size >= len(significant_items):
                        break
                    
                    # Select items with gaps
                    selected_items = []
                    selected_indices = []
                    for i in range(combo_size):
                        idx = start_idx + i * gap_size
                        if idx < len(significant_items):
                            selected_items.append(significant_items[idx])
                            selected_indices.append(significant_items[idx]['stable_index'])
                    
                    if len(selected_items) < 2:
                        continue
                    
                    # Combine text
                    combined_text = ' '.join(item.get('text', '') for item in selected_items)
                    combined_words = [w for w in self._normalize_text(combined_text).split() if len(w) > 1]
                    
                    if not combined_words:
                        continue
                    
                    # Calculate overlap
                    overlap_score = self._calculate_enhanced_overlap(sentence_words, combined_words)
                    
                    if overlap_score >= 0.4:  # Threshold for multi-item matches
                        confidence = min(0.9, overlap_score * 0.9)  # Slightly lower than consecutive
                        
                        match = {
                            'page': page_num,
                            'stable_index': selected_indices[0],
                            'item_span': selected_indices,
                            'confidence': confidence,
                            'match_strategy': f'multi_item_gap_{gap_size}',
                            'matched_text': combined_text,
                            'overlap_score': overlap_score,
                            'span_info': {
                                'span_size': len(selected_items),
                                'gap_size': gap_size,
                                'word_count': len(combined_words),
                                'sentence_word_count': len(sentence_words)
                            }
                        }
                        matches.append(match)
        
        # Sort by confidence
        matches.sort(key=lambda x: x['confidence'], reverse=True)
        return matches[:3]  # Top 3 multi-item matches

    def _remove_overlapping_matches(self, matches: List[Dict]) -> List[Dict]:
        """Remove overlapping matches, keeping higher priority/confidence ones"""
        
        if not matches:
            return matches
        
        final_matches = []
        used_indices = set()
        
        for match in matches:
            match_indices = set(match.get('item_span', []))
            
            # Check overlap with already used indices
            overlap = match_indices & used_indices
            overlap_ratio = len(overlap) / len(match_indices) if match_indices else 1
            
            # Allow small overlaps (< 30%) but prefer non-overlapping
            if overlap_ratio < 0.3:
                final_matches.append(match)
                used_indices.update(match_indices)
        
        return final_matches

    def _create_stable_selectors(self, stable_reference: Dict) -> List[Dict]:
        """Create selector strategies for stable item references"""
        
        selectors = []
        stable_index = stable_reference['stable_index']
        page = stable_reference['page']
        identifiers = stable_reference['identifiers']
        
        # Strategy 1: Stable item index selector (most reliable)
        selectors.append({
            'type': 'stable_index',
            'selector': f'[data-stable-index="{stable_index}"]',
            'stable_index': stable_index,
            'page': page,
            'priority': 100,
            'description': 'Stable PDF.js item index'
        })
        
        # Strategy 2: Text fingerprint selector
        if identifiers.get('textFingerprint'):
            selectors.append({
                'type': 'text_fingerprint',
                'selector': f'[data-text-fingerprint="{identifiers["textFingerprint"]}"]',
                'fingerprint': identifiers['textFingerprint'],
                'priority': 95,
                'description': 'Text content fingerprint'
            })
        
        # Strategy 3: Context fingerprint selector
        if identifiers.get('contextFingerprint'):
            selectors.append({
                'type': 'context_fingerprint',
                'selector': f'[data-context-fingerprint="{identifiers["contextFingerprint"]}"]',
                'context_fingerprint': identifiers['contextFingerprint'],
                'priority': 90,
                'description': 'Context-aware fingerprint'
            })
        
        return selectors

    def _normalize_text(self, text: str) -> str:
        """Enhanced text normalization"""
        if not text:
            return ""
        
        cleaned = text.lower().strip()
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = re.sub(r'[^\w\s\-\.\,\:\;\!\?\'\"]', '', cleaned)
        return cleaned


# API Functions for enhanced consecutive mapping

def process_sentences_file_enhanced(pdf_path: str, sentences_path: str, 
                                   output_file: str = None) -> Dict:
    """
    Process a sentences JSON file and create enhanced consecutive span mappings
    sentences.json format: simple list of strings where index = sentence_id
    """
    try:
        # Load sentences - expecting simple list of strings
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        # Validate format
        if not isinstance(sentences_data, list):
            raise ValueError(f"Expected sentences.json to be a list of strings, got {type(sentences_data)}")
        
        # Ensure all items are strings
        sentences = [str(sentence) for sentence in sentences_data]
        
        print(f"📝 Loaded {len(sentences)} sentences from {sentences_path}")
        print(f"📋 Sample sentences:")
        for i, sentence in enumerate(sentences[:3]):
            print(f"   [{i}]: {sentence[:80]}{'...' if len(sentence) > 80 else ''}")
        
        # Process sentences with enhanced consecutive mapping
        mapper = EnhancedStableSentenceToPDFJSMapper(pdf_path, verbose=True)
        enhanced_mappings = mapper.create_stable_element_mappings(sentences)
        
        print("✅ Enhanced mapping statistics:", enhanced_mappings.get('statistics', {}))
        print("✅ Filtering statistics:", enhanced_mappings.get('filtering_stats', {}))
        
        # Save if output file specified
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(enhanced_mappings, f, indent=2, ensure_ascii=False)
            print(f"💾 Saved enhanced mappings to {output_file}")
        
        return enhanced_mappings
        
    except Exception as e:
        print(f"❌ Error processing sentences file: {e}")
        return {'error': str(e)}


# Utility functions for PDF.js cache management

def list_cached_pdfs() -> Dict:
    """List all cached PDF.js extractions"""
    cache_base_dir = Path(os.getcwd()) / 'pdfjs_cache'
    
    if not cache_base_dir.exists():
        return {'cached_pdfs': [], 'total': 0}
    
    cached_pdfs = []
    for pdf_dir in cache_base_dir.iterdir():
        if pdf_dir.is_dir():
            summary_file = pdf_dir / 'extraction_summary.json'
            if summary_file.exists():
                try:
                    with open(summary_file, 'r', encoding='utf-8') as f:
                        summary = json.load(f)
                    
                    cached_pdfs.append({
                        'basename': pdf_dir.name,
                        'pdf_file': summary.get('pdf_file', 'unknown'),
                        'extraction_date': summary.get('extraction_date', 'unknown'),
                        'total_pages': summary.get('total_pages', 0),
                        'total_items': summary['statistics'].get('total_items', 0),
                        'cache_dir': str(pdf_dir),
                        'cache_size_mb': sum(f.stat().st_size for f in pdf_dir.rglob('*.json')) / (1024*1024)
                    })
                except Exception as e:
                    print(f"⚠️ Error reading cache summary for {pdf_dir}: {e}")
    
    return {
        'cached_pdfs': sorted(cached_pdfs, key=lambda x: x['extraction_date'], reverse=True),
        'total': len(cached_pdfs),
        'total_size_mb': sum(pdf['cache_size_mb'] for pdf in cached_pdfs)
    }

def clear_pdf_cache(pdf_basename: str = None) -> bool:
    """Clear PDF.js cache for a specific PDF or all PDFs"""
    cache_base_dir = Path(os.getcwd()) / 'pdfjs_cache'
    
    if not cache_base_dir.exists():
        print("No cache directory found")
        return True
    
    try:
        if pdf_basename:
            # Clear specific PDF cache
            pdf_cache_dir = cache_base_dir / pdf_basename
            if pdf_cache_dir.exists():
                import shutil
                shutil.rmtree(pdf_cache_dir)
                print(f"✅ Cleared cache for {pdf_basename}")
                return True
            else:
                print(f"⚠️ No cache found for {pdf_basename}")
                return False
        else:
            # Clear all caches
            import shutil
            shutil.rmtree(cache_base_dir)
            print("✅ Cleared all PDF.js caches")
            return True
            
    except Exception as e:
        print(f"❌ Error clearing cache: {e}")
        return False

def load_cached_page_data(pdf_basename: str, page_num: int) -> Optional[Dict]:
    """Load a specific page's data from cache for debugging"""
    cache_dir = Path(os.getcwd()) / 'pdfjs_cache' / pdf_basename
    page_file = cache_dir / f'page_{page_num:03d}.json'
    
    if not page_file.exists():
        return None
    
    try:
        with open(page_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Error loading page data: {e}")
        return None

def compare_cached_vs_fresh_extraction(pdf_path: str) -> Dict:
    """Compare cached PDF.js data with fresh extraction for debugging"""
    try:
        pdf_basename = Path(pdf_path).stem
        
        # Load cached data
        mapper_cached = EnhancedStableSentenceToPDFJSMapper(pdf_path, verbose=False)
        cached_data = mapper_cached.load_cached_pdfjs_data()
        
        if not cached_data:
            return {'error': 'No cached data found'}
        
        # Force fresh extraction
        mapper_fresh = EnhancedStableSentenceToPDFJSMapper(pdf_path, verbose=False)
        mapper_fresh.pdfjs_pages = None  # Clear any cached data
        
        # Temporarily move cache to avoid loading it
        cache_dir = mapper_fresh.get_pdfjs_cache_dir()
        temp_cache_dir = cache_dir.parent / f"{cache_dir.name}_temp"
        cache_dir.rename(temp_cache_dir)
        
        try:
            fresh_data = mapper_fresh.extract_stable_pdfjs_content()
        finally:
            # Restore cache
            temp_cache_dir.rename(cache_dir)
        
        if not fresh_data:
            return {'error': 'Fresh extraction failed'}
        
        # Compare
        comparison = {
            'cached_pages': len(cached_data),
            'fresh_pages': len(fresh_data),
            'pages_match': len(cached_data) == len(fresh_data),
            'page_comparisons': []
        }
        
        for i, (cached_page, fresh_page) in enumerate(zip(cached_data, fresh_data)):
            cached_items = len(cached_page.get('stableItems', []))
            fresh_items = len(fresh_page.get('stableItems', []))
            
            comparison['page_comparisons'].append({
                'page_num': i + 1,
                'cached_items': cached_items,
                'fresh_items': fresh_items,
                'items_match': cached_items == fresh_items
            })
        
        return comparison
        
    except Exception as e:
        return {'error': str(e)}


# Enhanced debug function with cache inspection
def debug_sentence_mapping_with_cache(pdf_path: str, sentence_text: str, 
                                     expected_spans: List[int] = None, 
                                     inspect_cache: bool = True) -> Dict:
    """Debug sentence mapping with cache inspection capabilities"""
    try:
        pdf_basename = Path(pdf_path).stem
        mapper = EnhancedStableSentenceToPDFJSMapper(pdf_path, verbose=True)
        
        debug_info = {
            'pdf_basename': pdf_basename,
            'sentence': sentence_text,
            'cache_info': {}
        }
        
        # Check cache status
        if inspect_cache:
            cache_dir = mapper.get_pdfjs_cache_dir()
            summary_file = cache_dir / 'extraction_summary.json'
            
            if summary_file.exists():
                with open(summary_file, 'r', encoding='utf-8') as f:
                    cache_summary = json.load(f)
                debug_info['cache_info'] = {
                    'has_cache': True,
                    'extraction_date': cache_summary.get('extraction_date'),
                    'total_pages': cache_summary.get('total_pages'),
                    'total_items': cache_summary['statistics'].get('total_items'),
                    'cache_files': [p['filename'] for p in cache_summary['pages']]
                }
            else:
                debug_info['cache_info'] = {'has_cache': False}
        
        # Extract/load PDF.js content
        if not mapper.extract_stable_pdfjs_content():
            return {'error': 'Failed to extract stable PDF.js content', **debug_info}
        
        # Get page items
        page_items = {}
        for page_data in mapper.pdfjs_pages:
            page_num = page_data['pageNumber']
            stable_items = page_data.get('stableItems', [])
            
            page_items[page_num] = []
            for item in stable_items:
                page_items[page_num].append({
                    'stable_index': item['stableIndex'],
                    'text': item['str'],
                    'normalized_text': item['normalizedText'],
                    'has_significant_text': item.get('hasSignificantText', True),
                    'is_whitespace_only': item.get('isWhitespaceOnly', False)
                })
        
        # Find matches
        matches = mapper._find_sentence_consecutive_spans(sentence_text, page_items)
        
        # Enhanced debug information
        debug_info.update({
            'normalized_sentence': mapper._normalize_text(sentence_text),
            'sentence_words': [w for w in mapper._normalize_text(sentence_text).split() if len(w) > 1],
            'matches_found': len(matches),
            'matches': matches,
            'expected_spans': expected_spans,
            'extraction_successful': True
        })
        
        # If expected spans provided, analyze the gap
        if expected_spans and matches:
            best_match = matches[0]
            found_spans = best_match['item_span']
            
            debug_info['span_analysis'] = {
                'expected_range': f"{min(expected_spans)}-{max(expected_spans)}",
                'found_range': f"{min(found_spans)}-{max(found_spans)}",
                'expected_count': len(expected_spans),
                'found_count': len(found_spans),
                'missing_spans': [s for s in expected_spans if s not in found_spans],
                'extra_spans': [s for s in found_spans if s not in expected_spans],
                'overlap': len(set(expected_spans) & set(found_spans)),
                'coverage': len(set(expected_spans) & set(found_spans)) / len(expected_spans)
            }
            
            # Show text for missing spans (if we can find the page)
            if debug_info['span_analysis']['missing_spans']:
                missing_span_texts = []
                for page_num, items in page_items.items():
                    for item in items:
                        if item['stable_index'] in debug_info['span_analysis']['missing_spans']:
                            missing_span_texts.append({
                                'span': item['stable_index'],
                                'text': repr(item['text']),
                                'normalized': item['normalized_text'],
                                'significant': item['has_significant_text']
                            })
                
                debug_info['span_analysis']['missing_span_texts'] = missing_span_texts
        
        return debug_info
        
    except Exception as e:
        return {'error': str(e)}

if __name__ == "__main__":
    sentences_dir = os.path.join(os.getcwd(), "sentences")
    for file in os.listdir(sentences_dir):

        basename = os.path.basename(file)
        basename = str(basename).replace('_sentences.json', '')
        print(f"Processing file: {basename}")
        pdf_file = safe_find_file(basename, "pdf")
        pdf_path = pdf_file['path'] 
        sentences_path = os.path.join(sentences_dir, file)

   

        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)

        output_file = os.path.join(os.getcwd(), 'stabler_mappings', f"{basename}_mappings.json")

        mapping = process_sentences_file_enhanced(pdf_path, sentences_path, output_file)
      
        print(f"Mapping complete for {basename}")