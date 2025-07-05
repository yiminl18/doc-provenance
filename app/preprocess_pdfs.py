from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams, LTTextContainer, LTTextBox, LTTextLine, LTChar
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.converter import PDFPageAggregator
import os, sys, nltk, time, json
import re
from difflib import SequenceMatcher

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

def extract_layout_data_only(pdf_path):
    """Extract ONLY the layout/positioning data, separate from text"""
    
    with open(pdf_path, 'rb') as fp:
        # Setup PDF processing for layout extraction
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
        
        # Storage for layout data only
        pages_layout = []
        
        # Process each page for layout information
        for page_num, page in enumerate(PDFPage.get_pages(fp), 1):
            print(f"Extracting layout from page {page_num}...")
            interpreter.process_page(page)
            layout = device.get_result()
            
            # Extract text elements with positions
            page_elements = []
            
            for element in layout:
                if isinstance(element, LTTextContainer):
                    text_blocks = extract_text_blocks_with_positions(element, page_num)
                    page_elements.extend(text_blocks)
            
            # Sort elements by reading order (top to bottom, left to right)
            page_elements.sort(key=lambda x: (-x['y1'], x['x0']))
            
            pages_layout.append({
                'page_num': page_num,
                'elements': page_elements
            })
        
        return pages_layout

def extract_text_blocks_with_positions(container, page_num):
    """Extract text blocks with bounding boxes"""
    text_blocks = []
    
    def process_element(element, depth=0):
        if hasattr(element, 'get_text'):
            text = element.get_text().strip()
            if text and len(text) > 1:  # Filter out single characters
                bbox = element.bbox  # (x0, y0, x1, y1)
                
                text_blocks.append({
                    'text': text,
                    'page': page_num,
                    'x0': bbox[0],
                    'y0': bbox[1], 
                    'x1': bbox[2],
                    'y1': bbox[3],
                    'width': bbox[2] - bbox[0],
                    'height': bbox[3] - bbox[1],
                    'element_type': type(element).__name__,
                    'depth': depth
                })
        
        # Process child elements
        if hasattr(element, '__iter__'):
            for child in element:
                process_element(child, depth + 1)
    
    process_element(container)
    return text_blocks

def create_sentence_to_layout_mapping(original_sentences, pages_layout):
    """
    Map original sentences (using your exact pipeline) to layout positions
    This preserves sentence indices while adding positioning data
    """
    
    enhanced_sentences = []
    
    for sentence_id, sentence_text in enumerate(original_sentences):
        print(f"Mapping sentence {sentence_id}: {sentence_text[:50]}...")
        
        # Find best matching text blocks for this sentence
        sentence_layout = find_best_layout_matches(sentence_text, pages_layout)
        
        enhanced_sentences.append({
            'sentence_id': sentence_id,
            'text': sentence_text,  # EXACT text from your original pipeline
            'layout_matches': sentence_layout,
            'page_spans': list(set([block['page'] for block in sentence_layout])),
            'primary_page': get_primary_page_for_sentence(sentence_layout),
            'bounding_boxes': [
                {
                    'page': block['page'],
                    'x0': block['x0'],
                    'y0': block['y0'],
                    'x1': block['x1'], 
                    'y1': block['y1'],
                    'confidence': block.get('match_confidence', 0.0),
                    'match_type': block.get('match_type', 'unknown')
                }
                for block in sentence_layout
            ]
        })
    
    return enhanced_sentences

def find_best_layout_matches(sentence_text, pages_layout):
    """
    Enhanced layout matching with better validation and stricter criteria
    """
    
    # Clean sentence for matching
    clean_sentence = clean_text_for_matching(sentence_text)
    sentence_words = clean_sentence.split()
    
    # Skip very short sentences (likely formatting artifacts)
    if len(sentence_words) < 3:
        return []
    
    matching_blocks = []
    
    for page_data in pages_layout:
        for block in page_data['elements']:
            clean_block_text = clean_text_for_matching(block['text'])
            block_words = clean_block_text.split()
            
            # Skip very short blocks
            if len(block_words) < 2:
                continue
            
            # Strategy 1: Exact or near-exact substring match (highest priority)
            if clean_sentence in clean_block_text:
                matching_blocks.append({
                    **block,
                    'match_confidence': 0.95,
                    'match_type': 'exact_substring'
                })
                continue
            elif clean_block_text in clean_sentence:
                # Block text is contained within sentence
                overlap_ratio = len(clean_block_text) / len(clean_sentence)
                matching_blocks.append({
                    **block,
                    'match_confidence': 0.9 * overlap_ratio,
                    'match_type': 'contained_substring'
                })
                continue
            
            # Strategy 2: High-confidence word overlap with strict validation
            common_words = set(sentence_words) & set(block_words)
            common_word_count = len(common_words)
            
            # More stringent requirements for word overlap
            min_common_words = max(3, len(sentence_words) * 0.4)  # Increased from 0.3
            word_overlap_ratio = common_word_count / len(sentence_words)
            block_coverage_ratio = common_word_count / len(block_words)
            
            # Only accept if we have good coverage AND the block isn't too large
            if (common_word_count >= min_common_words and 
                word_overlap_ratio >= 0.4 and
                block_coverage_ratio >= 0.3):  # Block should also be mostly covered
                
                # Additional validation: check for key phrase matches
                key_phrases_match = check_key_phrases_match(sentence_text, block['text'])
                
                # Penalize very large blocks (likely false positives)
                size_penalty = min(1.0, 500.0 / len(clean_block_text))  # Penalize blocks > 500 chars
                
                confidence = (word_overlap_ratio * 0.6 + block_coverage_ratio * 0.4) * size_penalty
                
                if key_phrases_match:
                    confidence *= 1.2  # Boost confidence for key phrase matches
                
                matching_blocks.append({
                    **block,
                    'match_confidence': min(0.85, confidence),  # Cap at 0.85 for word overlap
                    'match_type': 'validated_word_overlap',
                    'common_words_count': common_word_count,
                    'word_overlap_ratio': word_overlap_ratio,
                    'block_coverage_ratio': block_coverage_ratio,
                    'key_phrases_match': key_phrases_match
                })
                continue
            
            # Strategy 3: Sequence matching for partial overlaps (more conservative)
            if len(clean_block_text) > 20 and len(clean_sentence) > 20:
                similarity = SequenceMatcher(None, clean_sentence, clean_block_text).ratio()
                if similarity > 0.6:  # Increased threshold from 0.4
                    matching_blocks.append({
                        **block,
                        'match_confidence': similarity * 0.7,  # Reduced multiplier
                        'match_type': 'sequence_match',
                        'similarity_ratio': similarity
                    })
    
    # Enhanced selection logic
    return select_best_matches_enhanced(matching_blocks, sentence_text, sentence_words)

def check_key_phrases_match(sentence_text, block_text):
    """
    Check if key phrases from the sentence appear in the block
    This helps validate that the match is semantically correct
    """
    sentence_clean = clean_text_for_matching(sentence_text)
    block_clean = clean_text_for_matching(block_text)
    
    # Extract potential key phrases (sequences of 2-4 words)
    sentence_words = sentence_clean.split()
    key_phrases = []
    
    # Generate 2-4 word phrases
    for length in [4, 3, 2]:
        for i in range(len(sentence_words) - length + 1):
            phrase = ' '.join(sentence_words[i:i+length])
            if len(phrase) > 6:  # Only meaningful phrases
                key_phrases.append(phrase)
    
    # Check if any key phrases appear in the block
    matches = 0
    for phrase in key_phrases[:10]:  # Check top 10 phrases
        if phrase in block_clean:
            matches += 1
    
    # Return True if we find multiple phrase matches
    return matches >= 2

def select_best_matches_enhanced(matching_blocks, sentence_text, sentence_words):
    """
    Enhanced selection of the best matching blocks with better validation
    """
    if not matching_blocks:
        return []
    
    # Sort by confidence
    matching_blocks.sort(key=lambda x: x['match_confidence'], reverse=True)
    
    # If we have exact/substring matches, prefer those
    exact_matches = [b for b in matching_blocks if b['match_type'] in ['exact_substring', 'contained_substring']]
    if exact_matches:
        return exact_matches[:2]  # Return top 2 exact matches
    
    # For other matches, apply more stringent selection
    selected_blocks = []
    covered_content = set()
    total_sentence_words = set(sentence_words)
    
    for block in matching_blocks:
        # Skip low confidence matches
        if block['match_confidence'] < 0.5:  # Increased threshold
            break
        
        block_words = set(clean_text_for_matching(block['text']).split())
        new_coverage = block_words & total_sentence_words
        
        # Calculate how much new content this block adds
        truly_new_coverage = new_coverage - covered_content
        
        # Add block if it contributes significant new content or has very high confidence
        coverage_contribution = len(truly_new_coverage) / len(total_sentence_words)
        
        if (coverage_contribution > 0.2 or  # Contributes 20%+ new coverage
            block['match_confidence'] > 0.8 or  # Very high confidence
            (len(selected_blocks) == 0 and block['match_confidence'] > 0.6)):  # First block with decent confidence
            
            selected_blocks.append(block)
            covered_content.update(new_coverage)
            
            # Stop if we have good coverage or enough blocks
            coverage_ratio = len(covered_content) / len(total_sentence_words)
            if coverage_ratio >= 0.8 or len(selected_blocks) >= 3:
                break
    
    return selected_blocks

def validate_sentence_layout_mapping(sentence_data, debug=False):
    """
    Validate that sentence layout mappings make sense
    Returns validated sentences with quality scores
    """
    validated_sentences = []
    
    for sentence in sentence_data:
        sentence_id = sentence['sentence_id']
        sentence_text = sentence['text']
        bounding_boxes = sentence['bounding_boxes']
        
        if debug:
            print(f"\n🔍 Validating sentence {sentence_id}: {sentence_text[:50]}...")
        
        # Calculate quality metrics
        total_confidence = sum(box['confidence'] for box in bounding_boxes)
        avg_confidence = total_confidence / len(bounding_boxes) if bounding_boxes else 0
        
        # Check for reasonable box sizes
        reasonable_boxes = []
        for box in bounding_boxes:
            width = box['x1'] - box['x0']
            height = box['y1'] - box['y0']
            area = width * height
            
            # Filter out unreasonably large boxes (likely false positives)
            if area < 50000 and height < 200 and width < 600:  # Reasonable size limits
                reasonable_boxes.append(box)
            elif box['confidence'] > 0.8:  # Keep high-confidence boxes even if large
                reasonable_boxes.append(box)
            elif debug:
                print(f"   ⚠️ Filtering large box: {width:.1f}×{height:.1f} (area: {area:.1f})")
        
        # Update sentence with validated boxes
        validated_sentence = {
            **sentence,
            'bounding_boxes': reasonable_boxes,
            'quality_metrics': {
                'original_box_count': len(bounding_boxes),
                'validated_box_count': len(reasonable_boxes),
                'avg_confidence': avg_confidence,
                'has_high_confidence_match': any(box['confidence'] > 0.8 for box in reasonable_boxes),
                'mapping_quality': 'high' if avg_confidence > 0.7 else 'medium' if avg_confidence > 0.4 else 'low'
            }
        }
        
        validated_sentences.append(validated_sentence)
        
        if debug and len(reasonable_boxes) != len(bounding_boxes):
            print(f"   ✅ Kept {len(reasonable_boxes)}/{len(bounding_boxes)} boxes (avg conf: {avg_confidence:.2f})")
    
    return validated_sentences

def clean_text_for_matching(text):
    """Clean text for robust matching"""
    if not text:
        return ""
    
    # Normalize whitespace and remove special characters
    cleaned = re.sub(r'\s+', ' ', text)  # Multiple spaces to single space
    cleaned = re.sub(r'[^\w\s\-\.]', '', cleaned)  # Keep only alphanumeric, spaces, hyphens, periods
    cleaned = cleaned.lower().strip()
    
    return cleaned

def get_primary_page_for_sentence(layout_blocks):
    """Get the page that contains the most content for this sentence"""
    if not layout_blocks:
        return 1
        
    page_weights = {}
    for block in layout_blocks:
        page = block.get('page', 1)
        
        # Handle different ways text might be stored or missing
        text_content = ''
        if 'text' in block:
            text_content = block['text']
        elif 'original_element_text' in block:
            text_content = block['original_element_text']
        elif 'target_text' in block:
            text_content = block['target_text']
        
        # Weight by confidence and content length (fallback to confidence only if no text)
        confidence = block.get('match_confidence', 0.5)
        text_length = len(text_content) if text_content else 1  # Minimum weight of 1
        
        weight = confidence * text_length
        page_weights[page] = page_weights.get(page, 0) + weight
    
    if not page_weights:
        return 1
        
    return max(page_weights.items(), key=lambda x: x[1])[0]

def extract_sentences_with_compatible_layout(pdf_path):
    """
    MAIN FUNCTION: Extract sentences using your original pipeline + add layout data
    This ensures sentence indices remain exactly the same as your current system
    """
    
    print(f"🔄 Processing {pdf_path} with compatible layout extraction...")
    
    # Step 1: Extract text and sentences using your EXACT original method
    print("📄 Extracting text using original pipeline...")
    original_text, original_sentences = extract_sentences_from_pdf_original(pdf_path)
    print(f"✅ Extracted {len(original_sentences)} sentences using original method")
    
    # Step 2: Extract layout data separately
    print("🗺️ Extracting layout data...")
    pages_layout = extract_layout_data_only(pdf_path)
    print(f"✅ Extracted layout data from {len(pages_layout)} pages")
    
    # Step 3: Map original sentences to layout positions
    print("🔗 Mapping sentences to layout positions...")
    enhanced_sentences = create_sentence_to_layout_mapping(original_sentences, pages_layout)
    print(f"✅ Created layout mapping for {len(enhanced_sentences)} sentences")
    
    return original_sentences, enhanced_sentences, pages_layout

def save_compatible_sentence_data(pdf_path, output_dir='layouts'):
    """
    Process a PDF and save both traditional sentences and enhanced layout data
    GUARANTEES sentence index compatibility with your existing system
    """
    if output_dir is None:
        output_dir = os.path.dirname(pdf_path)
    
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    
    try:
        # Extract using compatible method
        original_sentences, enhanced_sentences, pages_layout = extract_sentences_with_compatible_layout(pdf_path)
        
        # Save traditional sentences.json (IDENTICAL to your current method)
        sentences_file = os.path.join(output_dir, f"{base_name}_sentences.json")
        with open(sentences_file, 'w', encoding='utf-8') as f:
            json.dump(original_sentences, f, indent=2, ensure_ascii=False)
        
        # Save enhanced layout data
        layout_file = os.path.join(output_dir, f"{base_name}_layout.json")
        layout_data = {
            'sentences': enhanced_sentences,
            'pages_layout': pages_layout,
            'metadata': {
                'total_sentences': len(original_sentences),
                'total_pages': len(pages_layout),
                'processed_at': time.time(),
                'pdf_path': pdf_path,
                'pdf_filename': os.path.basename(pdf_path),
                'method': 'compatible_layout_extraction',
                'sentence_extraction_method': 'original_pipeline_preserved',
                'layout_mapping_version': '1.0'
            },
            'compatibility': {
                'preserves_sentence_indices': True,
                'uses_original_text_extraction': True,
                'compatible_with_existing_provenance': True
            }
        }
        
        with open(layout_file, 'w', encoding='utf-8') as f:
            json.dump(layout_data, f, indent=2, ensure_ascii=False)
        
        # Calculate mapping statistics
        total_boxes = sum(len(sent['bounding_boxes']) for sent in enhanced_sentences)
        high_confidence_boxes = sum(
            len([box for box in sent['bounding_boxes'] if box['confidence'] > 0.7])
            for sent in enhanced_sentences
        )
        
        avg_confidence = (
            sum(
                sum(box['confidence'] for box in sent['bounding_boxes'])
                for sent in enhanced_sentences
            ) / max(1, total_boxes)
        )
        
        print(f"\n✅ COMPATIBLE PROCESSING COMPLETE:")
        print(f"📄 Original sentences: {sentences_file}")
        print(f"🗺️ Enhanced layout: {layout_file}")
        print(f"📊 Statistics:")
        print(f"   - Total sentences: {len(original_sentences)}")
        print(f"   - Total bounding boxes: {total_boxes}")
        print(f"   - High confidence boxes: {high_confidence_boxes}")
        print(f"   - Average confidence: {avg_confidence:.2f}")
        print(f"🔗 SENTENCE INDEX COMPATIBILITY: GUARANTEED")
        
        return sentences_file, layout_file, {
            'total_sentences': len(original_sentences),
            'total_boxes': total_boxes,
            'high_confidence_boxes': high_confidence_boxes,
            'avg_confidence': avg_confidence
        }
        
    except Exception as e:
        print(f"❌ Error in compatible processing: {e}")
        import traceback
        traceback.print_exc()
        raise

def verify_sentence_compatibility(original_sentences, new_sentences):
    """
    Verify that sentence extraction produces identical results
    """
    if len(original_sentences) != len(new_sentences):
        print(f"❌ LENGTH MISMATCH: {len(original_sentences)} vs {len(new_sentences)}")
        return False
    
    mismatches = 0
    for i, (orig, new) in enumerate(zip(original_sentences, new_sentences)):
        if orig != new:
            mismatches += 1
            if mismatches <= 3:  # Show first 3 mismatches
                print(f"❌ MISMATCH at index {i}:")
                print(f"   Original: {orig[:100]}...")
                print(f"   New:      {new[:100]}...")
    
    if mismatches == 0:
        print("✅ PERFECT COMPATIBILITY: All sentences match exactly")
        return True
    else:
        print(f"❌ COMPATIBILITY ISSUE: {mismatches} sentences don't match")
        return False
    
# After your current sentence extraction, add validation
def fix_existing_layout_mapping(layout_file_path):
    """Fix existing layout mapping with enhanced validation"""
    
    with open(layout_file_path, 'r', encoding='utf-8') as f:
        layout_data = json.load(f)
    
    # Validate and fix sentence mappings
    validated_sentences = validate_sentence_layout_mapping(
        layout_data['sentences'], 
        debug=True
    )
    
    # Update the data
    layout_data['sentences'] = validated_sentences
    layout_data['metadata']['validation_applied'] = True
    layout_data['metadata']['validation_timestamp'] = time.time()
    
    # Save updated file
    with open(layout_file_path, 'w', encoding='utf-8') as f:
        json.dump(layout_data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Enhanced validation applied to {len(validated_sentences)} sentences")

def full_pdf_preprocess(pdf_directory, pdf_file, output_directory):
    
    pdf_path = os.path.join(pdf_directory, pdf_file)
    filename = os.path.splitext(pdf_file)[0]
    print(f"🧪 TESTING SENTENCE INDEX COMPATIBILITY FOR {filename}")
    print("=" * 60)
    # Test original method
    print("1️⃣ Extracting with original method...")
    original_text, original_sentences = extract_sentences_from_pdf_original(pdf_path)
    # Test compatible method
    print("2️⃣ Extracting with compatible method...")
    new_sentences, enhanced_sentences, pages_layout = extract_sentences_with_compatible_layout(pdf_path)
    # Verify compatibility
    print("3️⃣ Verifying compatibility...")
    is_compatible = verify_sentence_compatibility(original_sentences, new_sentences)
    if is_compatible:
        print("\n🎉 SUCCESS: Sentence indices will be preserved!")
        print("Your existing provenance data will work perfectly.")
        # Save files
        sentences_file, layout_file, stats = save_compatible_sentence_data(pdf_path, output_directory)
        print(f"\n📁 Files saved:")
        print(f"   Sentences: {sentences_file}")
        print(f"   Layout: {layout_file}")
    else:
        print("\n❌ FAILURE: Sentence extraction differs from original")
        print("This method would break compatibility with existing provenance data.")

if __name__ == "__main__":

    pdf_director = UPLOADS_DIR

    pdf_files = [f for f in os.listdir(pdf_director) if f.endswith('.pdf')]

    for pdf_file in pdf_files:
        print(f"\n🔍 Processing PDF: {pdf_file}")
        try:
            full_pdf_preprocess(pdf_director, pdf_file, 'layouts')
        except Exception as e:
            print(f"❌ Error processing {pdf_file}: {e}")
            import traceback
            traceback.print_exc()