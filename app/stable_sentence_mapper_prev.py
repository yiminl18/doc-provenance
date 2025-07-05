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


class StableSentenceToPDFJSMapper:
    """Enhanced mapper that creates stable sentence-to-element mappings using PDF.js textContent items"""
    
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

    def extract_stable_pdfjs_content(self) -> Optional[List[Dict]]:
        """Extract PDF.js content with stable item references"""
        
        if self.pdfjs_pages:
            return self.pdfjs_pages
        
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
                
                # Cache the results
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

    def create_stable_element_mappings(self, sentences: List[Union[str, Dict]]) -> Dict:
        """
        Create sentence-to-element mappings using stable PDF.js item references
        """
        
        print(f"🗺️ Creating stable element mappings for {len(sentences)} sentences")
        
        # Extract PDF.js content if not already done
        if not self.pdfjs_pages:
            self.extract_stable_pdfjs_content()
        
        if not self.pdfjs_pages:
            print("❌ Could not extract PDF.js content")
            return {'error': 'PDF extraction failed'}
        
        # Create mappings using stable references
        mappings = {
            'document_info': {
                'pdf_path': self.pdf_path,
                'total_pages': len(self.pdfjs_pages),
                'total_sentences': len(sentences),
                'created_at': time.time(),
                'mapping_type': 'stable_item_references'
            },
            'page_items': {},  # page_num -> list of stable item info
            'sentence_to_items': {},  # sentence_id -> stable item references
            'item_to_sentences': {}   # item_reference -> list of sentence_ids
        }
        
        # First pass: Build stable item references for each page
        print("🏗️ Building stable item references...")
        for page_data in self.pdfjs_pages:
            page_num = page_data['pageNumber']
            stable_items = page_data.get('stableItems', [])
            
            # Store stable item references
            page_items = []
            for item in stable_items:
                stable_reference = {
                    'stable_index': item['stableIndex'],
                    'page': page_num,
                    'text': item['str'],
                    'normalized_text': item['normalizedText'],
                    'position': {
                        'x': item['x'],
                        'y': item['y'],
                        'width': item['width'],
                        'height': item['height']
                    },
                    'identifiers': item['identifiers'],
                    'font_info': {
                        'font_name': item['fontName'],
                        'font_size': item['fontSize']
                    }
                }
                
                # Create multiple selector strategies for this stable item
                stable_reference['selectors'] = self._create_stable_selectors(stable_reference)
                page_items.append(stable_reference)
            
            mappings['page_items'][page_num] = page_items
        
        # Second pass: Map sentences to stable items
        print("🔗 Mapping sentences to stable items...")
        found_count = 0
        
        for i, sentence in enumerate(sentences):
            # Handle different sentence formats
            if isinstance(sentence, dict):
                sentence_text = sentence.get('text', str(sentence))
                sentence_id = sentence.get('id', i)
            else:
                sentence_text = str(sentence)
                sentence_id = i
            
            if i % 100 == 0:  # Progress indicator
                print(f"🔄 Processing sentence {i+1}/{len(sentences)}")
            
            # Find best stable item matches for this sentence
            stable_matches = self._find_sentence_stable_items(sentence_text, mappings['page_items'])
            
            if stable_matches:
                found_count += 1
                
                # Store sentence mapping with stable references
                mappings['sentence_to_items'][str(sentence_id)] = {
                    'sentence_id': sentence_id,
                    'text': sentence_text,
                    'stable_matches': stable_matches,
                    'primary_page': stable_matches[0]['page'] if stable_matches else None,
                    'confidence': max(match['confidence'] for match in stable_matches) if stable_matches else 0,
                    'match_strategy': stable_matches[0]['match_strategy'] if stable_matches else 'none'
                }
                
                # Build reverse mapping (stable items -> sentences)
                for match in stable_matches:
                    item_key = f"{match['page']}_{match['stable_index']}"
                    if item_key not in mappings['item_to_sentences']:
                        mappings['item_to_sentences'][item_key] = []
                    mappings['item_to_sentences'][item_key].append(sentence_id)
        
        # Add summary statistics
        mappings['statistics'] = {
            'total_sentences': len(sentences),
            'mapped_sentences': found_count,
            'mapping_rate': found_count / len(sentences) if sentences else 0,
            'total_stable_items': sum(len(page_items) for page_items in mappings['page_items'].values()),
            'items_with_sentences': len(mappings['item_to_sentences'])
        }
        
        print(f"✅ Stable mapping complete: {found_count}/{len(sentences)} sentences mapped ({mappings['statistics']['mapping_rate']:.1%})")
        
        return mappings

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
        
        # Strategy 4: Position hash selector (fallback)
        if identifiers.get('positionHash'):
            selectors.append({
                'type': 'position_hash',
                'selector': f'[data-position-hash="{identifiers["positionHash"]}"]',
                'position_hash': identifiers['positionHash'],
                'priority': 80,
                'description': 'Position-based hash'
            })
        
        # Strategy 5: Combined attribute selector (last resort)
        text = stable_reference['text'][:20].replace('"', '\\"')
        selectors.append({
            'type': 'text_content_fallback',
            'selector': f'span:contains("{text}")',
            'priority': 60,
            'description': 'Text content fallback'
        })
        
        return selectors

    def _find_sentence_stable_items(self, sentence_text: str, page_items: Dict) -> List[Dict]:
        """Find stable item matches for a sentence across all pages"""
        
        clean_sentence = self._normalize_text(sentence_text)
        if len(clean_sentence) < 5:
            return []
        
        all_matches = []
        
        # Search across all pages
        for page_num, items in page_items.items():
            page_matches = self._find_sentence_in_page_stable_items(clean_sentence, items, page_num)
            all_matches.extend(page_matches)
        
        # Sort by confidence and quality
        all_matches.sort(key=lambda x: (x['confidence'], -len(x.get('item_span', []))), reverse=True)
        
        # Group contiguous items and return best matches
        grouped_matches = self._group_contiguous_stable_items(all_matches)
        
        return grouped_matches[:5]  # Top 5 stable item groups

    def _find_sentence_in_page_stable_items(self, clean_sentence: str, items: List[Dict], page_num: int) -> List[Dict]:
        """Find sentence matches within stable items of a single page"""
        
        matches = []
        sentence_words = clean_sentence.split()
        
        if len(sentence_words) < 2:
            return []
        
        # Strategy 1: Find substantial text overlap in individual items
        for item in items:
            item_text = item['normalized_text']
            if len(item_text) < 5:
                continue
            
            item_words = item_text.split()
            overlap_score = self._calculate_text_overlap(sentence_words, item_words)
            
            if overlap_score >= 0.3:  # At least 30% word overlap
                matches.append({
                    'page': page_num,
                    'stable_index': item['stable_index'],
                    'item_span': [item['stable_index']],
                    'confidence': min(0.95, overlap_score),
                    'match_strategy': 'stable_item_text_overlap',
                    'selectors': item['selectors'],
                    'matched_text': item['text'],
                    'overlap_score': overlap_score,
                    'identifiers': item['identifiers']
                })
        
        # Strategy 2: Multi-item spans for longer sentences
        if len(matches) < 2 and len(sentence_words) > 8:
            span_matches = self._find_stable_item_spans(clean_sentence, items, page_num)
            matches.extend(span_matches)
        
        # Sort by quality
        matches.sort(key=lambda x: (x['confidence'], x.get('overlap_score', 0)), reverse=True)
        
        return matches[:10]  # Limit matches per page

    def _find_stable_item_spans(self, clean_sentence: str, items: List[Dict], page_num: int) -> List[Dict]:
        """Find sentence spanning multiple stable items"""
        
        matches = []
        sentence_words = clean_sentence.split()
        
        # Try spans of 2-8 consecutive items
        for span_size in range(2, min(9, len(items) + 1)):
            for start_idx in range(len(items) - span_size + 1):
                span_items = items[start_idx:start_idx + span_size]
                
                # Combine text from span
                combined_words = []
                for item in span_items:
                    combined_words.extend(item['normalized_text'].split())
                
                if not combined_words:
                    continue
                
                # Calculate overlap for this span
                overlap_score = self._calculate_text_overlap(sentence_words, combined_words)
                
                if overlap_score >= 0.4:  # Higher threshold for spans
                    # Calculate coverage
                    sentence_set = set(w for w in sentence_words if len(w) > 2)
                    span_set = set(w for w in combined_words if len(w) > 2)
                    coverage = len(sentence_set & span_set) / len(sentence_set) if sentence_set else 0
                    
                    # Combined confidence
                    confidence = min(0.9, (overlap_score * 0.7) + (coverage * 0.3))
                    
                    matches.append({
                        'page': page_num,
                        'stable_index': span_items[0]['stable_index'],
                        'item_span': [item['stable_index'] for item in span_items],
                        'confidence': confidence,
                        'match_strategy': f'stable_span_{span_size}',
                        'selectors': span_items[0]['selectors'],
                        'matched_text': ' '.join(item['text'] for item in span_items),
                        'overlap_score': overlap_score,
                        'coverage_score': coverage,
                        'span_info': {
                            'span_size': span_size,
                            'word_count': len(combined_words)
                        }
                    })
        
        return matches

    def _calculate_text_overlap(self, sentence_words: List[str], item_words: List[str]) -> float:
        """Calculate meaningful text overlap between sentence and item words"""
        
        if not sentence_words or not item_words:
            return 0.0
        
        # Filter out very short words for better matching
        meaningful_sentence_words = [w for w in sentence_words if len(w) > 2]
        meaningful_item_words = [w for w in item_words if len(w) > 2]
        
        if not meaningful_sentence_words:
            return 0.0
        
        # Calculate word overlap
        sentence_set = set(meaningful_sentence_words)
        item_set = set(meaningful_item_words)
        
        common_words = sentence_set & item_set
        overlap_ratio = len(common_words) / len(sentence_set)
        
        # Bonus for partial word matches (prefixes, stems)
        partial_matches = 0
        for s_word in meaningful_sentence_words:
            if s_word not in item_set:
                for i_word in meaningful_item_words:
                    if (len(s_word) > 4 and len(i_word) > 4 and 
                        (s_word.startswith(i_word[:4]) or i_word.startswith(s_word[:4]))):
                        partial_matches += 1
                        break
        
        partial_bonus = (partial_matches / len(meaningful_sentence_words)) * 0.3
        
        total_score = min(1.0, overlap_ratio + partial_bonus)
        return total_score

    def _group_contiguous_stable_items(self, matches: List[Dict]) -> List[Dict]:
        """Group matches that involve contiguous stable items"""
        
        if not matches:
            return matches
        
        # Group by page first
        page_groups = {}
        for match in matches:
            page = match['page']
            if page not in page_groups:
                page_groups[page] = []
            page_groups[page].append(match)
        
        final_matches = []
        
        for page, page_matches in page_groups.items():
            # Sort by confidence and stable index
            page_matches.sort(key=lambda x: (x['confidence'], x['stable_index']), reverse=True)
            
            used_items = set()
            
            for match in page_matches:
                item_span = set(match['item_span'])
                
                # Check overlap with already used items
                overlap = item_span & used_items
                overlap_ratio = len(overlap) / len(item_span) if item_span else 0
                
                if overlap_ratio < 0.5:  # Less than 50% overlap
                    final_matches.append(match)
                    used_items.update(item_span)
        
        return final_matches

    def _normalize_text(self, text: str) -> str:
        """Enhanced text normalization"""
        if not text:
            return ""
        
        cleaned = text.lower().strip()
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = re.sub(r'[^\w\s\-\.\,\:\;\!\?\'\"]', '', cleaned)
        return cleaned


# API Functions for stable mapping

def process_sentences_file_stable(pdf_path: str, sentences_path: str, 
                                 output_file: str = None) -> Dict:
    """
    Process a sentences JSON file and create stable mappings
    """
    try:
        # Load sentences
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        # Handle different formats
        if isinstance(sentences_data, list):
            sentences = sentences_data
        elif isinstance(sentences_data, dict) and 'sentences' in sentences_data:
            sentences = sentences_data['sentences']
        else:
            raise ValueError("Unknown sentences file format")
        
        # Process sentences with stable mapping
        mapper = StableSentenceToPDFJSMapper(pdf_path, verbose=True)
        stable_mappings = mapper.create_stable_element_mappings(sentences)
        
        print("✅ Stable mapping statistics:", stable_mappings.get('statistics', {}))
        
        # Save if output file specified
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(stable_mappings, f, indent=2, ensure_ascii=False)
            print(f"💾 Saved stable mappings to {output_file}")
        
        return stable_mappings
        
    except Exception as e:
        print(f"❌ Error processing sentences file: {e}")
        return {'error': str(e)}


# Test function
def test_stable_mapping(pdf_path: str, sentence_text: str) -> Dict:
    """Test stable mapping for a single sentence"""
    try:
        mapper = StableSentenceToPDFJSMapper(pdf_path, verbose=True)
        
        if not mapper.extract_stable_pdfjs_content():
            return {'error': 'Failed to extract stable PDF.js content'}
        
        # Test stable mapping
        stable_mappings = mapper.create_stable_element_mappings([sentence_text])
        
        return {
            'sentence': sentence_text,
            'stable_mapping': stable_mappings.get('sentence_to_items', {}).get('0', {}),
            'pdf_pages': len(mapper.pdfjs_pages),
            'extraction_successful': True,
            'mapping_type': 'stable_item_references'
        }
        
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

        output_file = os.path.join(os.getcwd(), 'stable_mappings', f"{basename}_mappings.json")

        mapping = process_sentences_file_stable(pdf_path, sentences_path, output_file)
    


        # Save mapping to JSON file
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(mapping, f, indent=4, ensure_ascii=False)
 