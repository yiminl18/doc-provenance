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
    Find layout blocks that best match the original sentence text
    Uses multiple strategies for robust matching
    """
    
    # Clean sentence for matching
    clean_sentence = clean_text_for_matching(sentence_text)
    sentence_words = clean_sentence.split()
    
    matching_blocks = []
    
    for page_data in pages_layout:
        for block in page_data['elements']:
            clean_block_text = clean_text_for_matching(block['text'])
            
            # Strategy 1: Direct substring match (best case)
            if clean_sentence in clean_block_text or clean_block_text in clean_sentence:
                overlap_ratio = min(len(clean_sentence), len(clean_block_text)) / max(len(clean_sentence), len(clean_block_text))
                matching_blocks.append({
                    **block,
                    'match_confidence': 0.9 * overlap_ratio,
                    'match_type': 'substring_match'
                })
                continue
            
            # Strategy 2: Word overlap matching
            block_words = clean_block_text.split()
            common_words = set(sentence_words) & set(block_words)
            
            if len(common_words) >= max(2, len(sentence_words) * 0.3):
                confidence = len(common_words) / len(sentence_words)
                matching_blocks.append({
                    **block,
                    'match_confidence': confidence * 0.8,  # Lower than exact match
                    'match_type': 'word_overlap',
                    'common_words_count': len(common_words)
                })
                continue
            
            # Strategy 3: Sequence matching for partial overlaps
            if len(clean_block_text) > 10:
                similarity = SequenceMatcher(None, clean_sentence, clean_block_text).ratio()
                if similarity > 0.4:
                    matching_blocks.append({
                        **block,
                        'match_confidence': similarity * 0.6,  # Lower confidence
                        'match_type': 'sequence_match',
                        'similarity_ratio': similarity
                    })
    
    # Sort by confidence and take best matches
    matching_blocks.sort(key=lambda x: x['match_confidence'], reverse=True)
    
    # Select the best matches that together cover the sentence well
    selected_blocks = []
    covered_content = set()
    
    for block in matching_blocks[:10]:  # Consider top 10 matches
        if block['match_confidence'] < 0.3:  # Minimum confidence threshold
            break
            
        block_words = set(clean_text_for_matching(block['text']).split())
        new_coverage = block_words - covered_content
        
        # Add block if it contributes new content or has very high confidence
        if new_coverage or block['match_confidence'] > 0.8:
            selected_blocks.append(block)
            covered_content.update(block_words)
            
            # Stop if we have good coverage
            if len(covered_content) >= len(sentence_words) * 0.7:
                break
    
    return selected_blocks[:5]  # Limit to 5 blocks per sentence to avoid over-segmentation

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
        page = block['page']
        # Weight by confidence and content length
        weight = block.get('match_confidence', 0.5) * len(block['text'])
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

def save_compatible_sentence_data(pdf_path, output_dir=None):
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

# Example usage for testing compatibility
if __name__ == "__main__":
    
    current_file_directory = os.path.dirname(os.path.abspath(__file__))

    output_directory = os.path.join(current_file_directory, "layout")
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)
    pdf_directory = os.path.join(current_file_directory, "uploads")

    for pdf_file in os.listdir(pdf_directory):
        if pdf_file.endswith('.pdf'):
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

    