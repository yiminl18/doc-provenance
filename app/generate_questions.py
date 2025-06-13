
import sys
import json
import time
from pathlib import Path
from pdfminer.high_level import extract_text

from openai import OpenAI
import os 
from dotenv import dotenv_values

def setup_paths():
    """Add the app directory to Python path so we can import from our Flask app"""
    script_dir = Path(__file__).parent
    app_dir = script_dir.parent / 'app'
    sys.path.insert(0, str(app_dir))

def find_all_pdfs(search_paths):
    """Find all PDF files in the given paths with enhanced status reporting"""
    pdf_files = []
    
    for path_str in search_paths:
        path = Path(path_str)
        
        if path.is_file() and path.suffix.lower() == '.pdf':
            # Single PDF file
            base_name = path.stem
            sentences_file = get_document_sentences_path(base_name)
            has_sentences = sentences_file.exists()
            
            pdf_files.append({
                'pdf_path': path,
                'source_type': 'single_file',
                'base_name': base_name,
                'original_name': path.name,
                'title': path.name,
                'has_sentences': has_sentences,
                'sentences_file': sentences_file if has_sentences else None
            })
            
        elif path.is_dir():
            # Check if this looks like a batch directory
            if path.name.startswith('batch_'):
                pdf_files.extend(scan_batch_directory(path))
            else:
                # Regular directory - scan for PDFs
                pdf_files.extend(scan_regular_directory(path))
                
                # Also check for batch subdirectories
                for subdir in path.iterdir():
                    if subdir.is_dir() and subdir.name.startswith('batch_'):
                        pdf_files.extend(scan_batch_directory(subdir))
    
    return pdf_files

def scan_batch_directory(batch_path):
    """Scan a batch_XXXX directory for processed PDFs"""
    pdf_files = []
    
    try:
        print(f"🗂️ Scanning batch directory: {batch_path}")
        
        # Look for metadata files to find processed PDFs
        metadata_files = list(batch_path.glob("*_metadata.json"))
        
        for metadata_file in metadata_files:
            try:
                # Load metadata to get original name and info
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                base_name = metadata_file.stem.replace('_metadata', '')
                pdf_path = batch_path / f"{base_name}.pdf"
                
                if pdf_path.exists():
                    pdf_info = {
                        'pdf_path': pdf_path,
                        'source_type': 'batch_processed',
                        'base_name': base_name,
                        'original_name': metadata.get('original_name', pdf_path.name),
                        'title': metadata.get('title', pdf_path.name),
                        'batch_id': metadata.get('batch_id', batch_path.name),
                        'metadata': metadata,
                        'sentences_file': batch_path / f"{base_name}_sentences.json",
                        'layout_file': batch_path / f"{base_name}_layout.json"
                    }
                    pdf_files.append(pdf_info)
                    print(f"   📄 Found: {pdf_info['original_name']}")
                
            except Exception as e:
                print(f"   ⚠️ Error reading metadata {metadata_file}: {e}")
                continue
                
    except Exception as e:
        print(f"❌ Error scanning batch directory {batch_path}: {e}")
    
    return pdf_files

def scan_regular_directory(directory_path):
    """Scan a regular directory for PDF files and check for existing sentences"""
    pdf_files = []
    
    try:
        print(f"📁 Scanning directory: {directory_path}")
        
        for pdf_path in directory_path.glob("*.pdf"):
            base_name = pdf_path.stem
            
            # Check if sentences exist in app/sentences
            sentences_file = get_document_sentences_path(base_name)
            has_sentences = sentences_file.exists()
            
            pdf_info = {
                'pdf_path': pdf_path,
                'source_type': 'regular_directory',
                'base_name': base_name,
                'original_name': pdf_path.name,
                'title': pdf_path.name,
                'has_sentences': has_sentences,
                'sentences_file': sentences_file if has_sentences else None
            }
            pdf_files.append(pdf_info)
            
            status = "✅ (sentences available)" if has_sentences else "⚠️ (no sentences)"
            print(f"   📄 Found: {pdf_path.name} {status}")
            
    except Exception as e:
        print(f"❌ Error scanning directory {directory_path}: {e}")
    
    return pdf_files

def check_existing_questions(base_name, output_dir):
    """Check if questions already exist for this document"""
    questions_file = output_dir / f"{base_name}_questions.json"
    
    if questions_file.exists():
        try:
            with open(questions_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            
            questions = existing_data.get('questions', [])
            metadata = existing_data.get('metadata', {})
            
            return {
                'exists': True,
                'file_path': questions_file,
                'questions_count': len(questions),
                'generated_at': metadata.get('generated_at_iso', 'Unknown'),
                'questions': questions
            }
        except Exception as e:
            print(f"⚠️ Error reading existing questions file {questions_file}: {e}")
            return {'exists': False}
    
    return {'exists': False}



def get_document_sentences_path(base_name):
    """Get the path to sentences file in the app/sentences directory"""
    script_dir = Path(__file__).parent
    sentences_dir = script_dir.parent / 'app' / 'sentences'
    return sentences_dir / f"{base_name}_sentences.json"

def get_document_text(pdf_info):
    """Get text from document, preferring sentences files when available"""
    
    base_name = pdf_info['base_name']
    
    # Strategy 1: Try batch sentences file (for batch documents)
    if pdf_info['source_type'] == 'batch_processed':
        sentences_file = pdf_info.get('sentences_file')
        
        if sentences_file and sentences_file.exists():
            try:
                print(f"📖 Loading text from batch sentences file: {sentences_file}")
                with open(sentences_file, 'r', encoding='utf-8') as f:
                    sentences = json.load(f)
                
                if isinstance(sentences, list):
                    text = ' '.join(sentences)
                    print(f"✅ Loaded {len(sentences)} sentences ({len(text)} characters) from batch file")
                    return text
                else:
                    print(f"⚠️ Batch sentences file format unexpected, trying app/sentences")
            except Exception as e:
                print(f"⚠️ Error reading batch sentences file: {e}")
    
    # Strategy 2: Try app/sentences directory (for regular uploaded documents)
    app_sentences_file = get_document_sentences_path(base_name)
    
    if app_sentences_file.exists():
        try:
            print(f"📖 Loading text from app sentences file: {app_sentences_file}")
            with open(app_sentences_file, 'r', encoding='utf-8') as f:
                sentences = json.load(f)
            
            if isinstance(sentences, list):
                text = ' '.join(sentences)
                print(f"✅ Loaded {len(sentences)} sentences ({len(text)} characters) from app/sentences")
                return text
            elif isinstance(sentences, dict):
                # Handle case where sentences might be stored as {0: "sentence", 1: "sentence", ...}
                sentence_list = []
                for key in sorted(sentences.keys(), key=lambda x: int(x) if str(x).isdigit() else x):
                    sentence_list.append(sentences[key])
                text = ' '.join(sentence_list)
                print(f"✅ Loaded {len(sentence_list)} sentences ({len(text)} characters) from app/sentences (dict format)")
                return text
            else:
                print(f"⚠️ App sentences file format unexpected: {type(sentences)}")
        except Exception as e:
            print(f"⚠️ Error reading app sentences file: {e}")
    else:
        print(f"📁 No sentences file found at: {app_sentences_file}")
    
    # Strategy 3: Fallback to direct PDF extraction
    print(f"📄 Falling back to PDF extraction: {pdf_info['pdf_path']}")
    try:
        pdf_text = extract_text(pdf_info['pdf_path'])
        print(f"✅ Extracted {len(pdf_text)} characters from PDF")
        return pdf_text
    except Exception as e:
        print(f"❌ Error extracting text from PDF: {e}")
        return None


def chunk_text(text, chunk_size=8000, overlap=500):
    """Split text into overlapping chunks"""
    chunks = []
    start = 0
    
    while start < len(text):
        end = start + chunk_size
        
        # If this isn't the last chunk, try to break at a sentence boundary
        if end < len(text):
            # Look for sentence endings within the last 500 characters
            last_period = text.rfind('.', end - 500, end)
            last_exclamation = text.rfind('!', end - 500, end)
            last_question = text.rfind('?', end - 500, end)
            
            sentence_end = max(last_period, last_exclamation, last_question)
            if sentence_end > start:
                end = sentence_end + 1
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        
        start = end - overlap  # Overlap to maintain context
    
    return chunks

def generate_document_summary(client, chunks, max_summary_length=4000):
    """Generate a comprehensive summary from document chunks"""
    print(f"📄 Generating summary from {len(chunks)} chunks...")
    
    # If we have many chunks, first create summaries of groups of chunks
    if len(chunks) > 10:
        # Group chunks and create intermediate summaries
        chunk_groups = [chunks[i:i+5] for i in range(0, len(chunks), 5)]
        intermediate_summaries = []
        
        for i, chunk_group in enumerate(chunk_groups):
            print(f"   📝 Summarizing chunk group {i+1}/{len(chunk_groups)}")
            
            combined_text = "\n\n".join(chunk_group)
            
            summary_prompt = f"""Summarize the following section of a document, preserving key facts, findings, methodology, dates, names, and important details:

{combined_text}

Provide a comprehensive summary that captures:
- Main topics and themes
- Key findings or conclusions
- Methodology or approach used
- Important facts, dates, names, numbers
- Any significant details

Summary:"""

            try:
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": "You are an expert at summarizing documents while preserving important details."},
                        {"role": "user", "content": summary_prompt}
                    ],
                    max_tokens=800,
                    temperature=0.3
                )
                
                intermediate_summaries.append(response.choices[0].message.content.strip())
                time.sleep(0.5)  # Small delay between API calls
                
            except Exception as e:
                print(f"⚠️ Error creating intermediate summary: {e}")
                # Fallback: use first part of the combined text
                intermediate_summaries.append(combined_text[:1000] + "...")
        
        # Now create final summary from intermediate summaries
        combined_summaries = "\n\n".join(intermediate_summaries)
        chunks_to_summarize = [combined_summaries]
    else:
        chunks_to_summarize = chunks
    
    # Create final comprehensive summary
    final_summary_prompt = f"""Create a comprehensive summary of this document that will be used to generate meaningful questions. Preserve all important details including:

- Main topics, themes, and purpose
- Key findings, results, and conclusions  
- Methodology, approach, or process described
- Important facts, statistics, dates, names
- Significant details that someone might ask about

Document content:
{chr(10).join(chunks_to_summarize)}

Provide a detailed summary (aim for {max_summary_length} characters) that captures the essence and important details of the entire document:"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are an expert at creating comprehensive summaries that preserve important details for question generation."},
                {"role": "user", "content": final_summary_prompt}
            ],
            max_tokens=1500,
            temperature=0.3
        )
        
        summary = response.choices[0].message.content.strip()
        print(f"✅ Generated summary of {len(summary)} characters")
        return summary
        
    except Exception as e:
        print(f"❌ Error generating final summary: {e}")
        # Fallback: use first chunk
        return chunks[0][:max_summary_length]
    
def parse_gpt_questions_response(questions_text):
    """Robust parsing of GPT response that may contain markdown, extra text, or formatting"""
    
    # Clean up the response text
    questions_text = questions_text.strip()
    
    # Remove markdown code blocks if present
    if questions_text.startswith('```json'):
        questions_text = questions_text.replace('```json', '', 1)
    if questions_text.startswith('```'):
        questions_text = questions_text.replace('```', '', 1)
    if questions_text.endswith('```'):
        questions_text = questions_text.rsplit('```', 1)[0]
    
    # Remove any leading/trailing whitespace after cleanup
    questions_text = questions_text.strip()
    
    # Try direct JSON parsing first
    try:
        parsed = json.loads(questions_text)
        if isinstance(parsed, list):
            return parsed
        else:
            print(f"⚠️ JSON parsed but not a list: {type(parsed)}")
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON decode error: {e}")
        print(f"⚠️ Attempting to parse: {questions_text[:200]}...")
    
    # Fallback 1: Try to find JSON array in the text
    import re
    
    # Look for JSON array pattern
    json_pattern = r'\[[\s\S]*?\]'
    json_matches = re.findall(json_pattern, questions_text)
    
    for match in json_matches:
        try:
            parsed = json.loads(match)
            if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed):
                print(f"✅ Successfully extracted JSON array from text")
                return parsed
        except:
            continue
    
    # Fallback 2: Extract questions using line-by-line parsing
    print("⚠️ Attempting line-by-line question extraction...")
    
    lines = questions_text.split('\n')
    extracted_questions = []
    
    for line in lines:
        line = line.strip()
        
        # Skip empty lines
        if not line:
            continue
            
        # Remove common prefixes and formatting
        line = re.sub(r'^\d+\.\s*', '', line)  # Remove "1. "
        line = re.sub(r'^[-*]\s*', '', line)   # Remove "- " or "* "
        line = line.strip('"\'')               # Remove quotes
        line = line.strip(',')                 # Remove trailing comma
        
        # Check if this looks like a question
        if line.endswith('?') and len(line) > 10:
            extracted_questions.append(line)
        # Also check for questions that might be missing the question mark
        elif any(word in line.lower() for word in ['what', 'when', 'where', 'who', 'why', 'how', 'which']) and len(line) > 10:
            # Add question mark if missing
            if not line.endswith('?'):
                line += '?'
            extracted_questions.append(line)
    
    if extracted_questions:
        print(f"✅ Extracted {len(extracted_questions)} questions using line parsing")
        return extracted_questions
    
    # Fallback 3: Use regex to find quoted strings that look like questions
    print("⚠️ Attempting regex extraction of quoted questions...")
    
    # Find quoted strings
    quoted_pattern = r'"([^"]+\?)"'
    quoted_matches = re.findall(quoted_pattern, questions_text)
    
    if quoted_matches:
        print(f"✅ Found {len(quoted_matches)} quoted questions")
        return quoted_matches
    
    # Fallback 4: Split on question marks and clean up
    print("⚠️ Attempting question mark split parsing...")
    
    question_parts = questions_text.split('?')
    fallback_questions = []
    
    for part in question_parts[:-1]:  # Exclude last part (after final ?)
        part = part.strip()
        # Remove leading punctuation and numbers
        part = re.sub(r'^[^\w]*', '', part)
        part = re.sub(r'^\d+\.\s*', '', part)
        
        if len(part) > 10 and any(word in part.lower() for word in ['what', 'when', 'where', 'who', 'why', 'how']):
            fallback_questions.append(part + '?')
    
    if fallback_questions:
        print(f"✅ Extracted {len(fallback_questions)} questions using question mark splitting")
        return fallback_questions
    
    # Ultimate fallback: return empty list
    print("❌ Could not extract any questions from the response")
    return []


def generate_questions_for_document(pdf_info, num_questions, output_dir, difficulty='easy'):
    """Generate questions for a single document using full content"""
    
    base_name = pdf_info['base_name']
    display_name = pdf_info.get('original_name', pdf_info['pdf_path'].name)
    
    print(f"\n{'='*60}")
    print(f"🔄 Processing: {display_name}")
    print(f"   Source: {pdf_info['source_type']}")
    print(f"   Base name: {base_name}")
    
    # Show sentences availability status
    if pdf_info['source_type'] == 'batch_processed':
        print(f"   Batch sentences: {'✅' if pdf_info.get('sentences_file') and pdf_info['sentences_file'].exists() else '❌'}")
    else:
        print(f"   App sentences: {'✅' if pdf_info.get('has_sentences') else '❌'}")
    
    # Determine output directory
    if output_dir is None:
        script_dir = Path(__file__).parent
        output_dir = script_dir.parent / 'app' / 'questions' / 'easy'
    else:
        output_dir = Path(output_dir)
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if questions already exist
    existing_check = check_existing_questions(base_name, output_dir)
    
    if existing_check['exists']:
        print(f"✅ Questions already exist for {display_name}")
        print(f"   File: {existing_check['file_path']}")
        print(f"   Questions: {existing_check['questions_count']}")
        print(f"   Generated: {existing_check['generated_at']}")
        return True
    
    # Get document text (now uses sentences files when available)
    pdf_text = get_document_text(pdf_info)
    if pdf_text is None:
        print(f"❌ Could not extract text from {display_name}")
        return False
        # Load environment variables from .env file
    env_config = dotenv_values(".env")


    # Access the API key from the environment variable
    api_key = env_config['OPENAI_API_KEY']#os.getenv('OPENAI_API_KEY')
    # Set the OpenAI API key
    client = OpenAI(api_key=api_key)

    
    # Process the document
    if len(pdf_text) <= 12000:
        # Small document - use directly
        document_content = pdf_text
        print("📝 Using full document content (small document)")
    else:
        # Large document - create chunks and summarize
        print("📚 Large document detected - creating comprehensive summary")
        chunks = chunk_text(pdf_text, chunk_size=8000, overlap=500)
        print(f"📄 Split into {len(chunks)} chunks")
        
        document_content = generate_document_summary(client, chunks, max_summary_length=8000)
        
        # Add note about document length to help with question generation
        document_content = f"""[This is a comprehensive summary of a {len(pdf_text):,} character document]

{document_content}

[Note: The full document contains more detailed information than shown in this summary]"""
    
    try:
        print("🤖 Calling GPT-4o to generate questions...")
       
        # Enhanced prompt that specifically requests clean JSON
        prompt = f"""Generate {num_questions} diverse and meaningful questions about this document.
 
                 Requirements:
                 - Return ONLY a valid JSON array of strings
                 - Each string should be a complete question ending with ?
                 - No markdown formatting, no code blocks, no extra text
                 - Questions should cover factual, analytical, and methodological aspects
 
                 Document content:
                 {document_content}
 
                 Response format (example):
                 ["What is the main topic?", "When was this conducted?", "What methodology was used?"]
 
                 JSON array of {num_questions} questions:"""
         
         # Call GPT-4o with more specific system prompt
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a question generation expert. You MUST respond with valid JSON only - no markdown, no explanations, no code blocks. Return a JSON array of question strings."
                },
                {"role": "user", "content": prompt}
            ],
            max_tokens=800,
            temperature=0.7
        )

        # Get and clean the response
        questions_text = response.choices[0].message.content.strip()
        print(f"📝 GPT-4o raw response: {questions_text[:150]}...")

        # Use the robust parsing function
        generated_questions = parse_gpt_questions_response(questions_text)

        if not generated_questions:
            print("❌ Could not extract any valid questions from GPT response")
            print(f"🔍 Full response was: {questions_text}")
            return False

        # Ensure we don't exceed the requested number
        generated_questions = generated_questions[:num_questions]

        print(f"✅ Generated {len(generated_questions)} questions")
        for i, q in enumerate(generated_questions, 1):
            print(f"   {i}. {q}")

    except Exception as e:
        print(f"❌ Error calling GPT-4o: {e}")
        return False
    
    # Determine text source for metadata
    text_source = "unknown"
    if pdf_info['source_type'] == 'batch_processed' and pdf_info.get('sentences_file'):
        text_source = "batch_sentences_file"
    elif pdf_info.get('has_sentences'):
        text_source = "app_sentences_file" 
    else:
        text_source = "pdf_extraction"
    
    # Prepare output data with enhanced metadata
    output_data = {
        'filename': pdf_info['pdf_path'].name,
        'base_name': base_name,
        'original_name': pdf_info.get('original_name', pdf_info['pdf_path'].name),
        'title': pdf_info.get('title', pdf_info['pdf_path'].name),
        'questions': generated_questions,
        'metadata': {
            'generated_at': time.time(),
            'generated_at_iso': time.strftime('%Y-%m-%d %H:%M:%S'),
            'model': 'gpt-4o',
            'num_requested': num_questions,
            'num_generated': len(generated_questions),
            'original_text_length': len(pdf_text),
            'processed_text_length': len(document_content),
            'was_summarized': len(pdf_text) > 12000,
            'source_type': pdf_info['source_type'],
            'text_source': text_source,  # How we got the text
            'script_version': '3.1'
        }
    }
    
    # Add batch-specific metadata if available
    if pdf_info['source_type'] == 'batch_processed':
        batch_metadata = pdf_info.get('metadata', {})
        output_data['batch_info'] = {
            'batch_id': pdf_info.get('batch_id'),
            'gdrive_info': batch_metadata.get('gdrive_info', {}),
            'processing_info': batch_metadata.get('processing_info', {})
        }
    
    # Save questions
    output_file = output_dir / f"{base_name}_questions.json"
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        print(f"💾 Saved questions to: {output_file}")
        return True
        
    except Exception as e:
        print(f"❌ Error saving questions: {e}")
        return False




def process_directory(directory_path, num_questions=5, output_dir=None):
    """Process all PDF files in a directory"""
    directory = Path(directory_path)
    
    if not directory.exists():
        print(f"❌ Directory not found: {directory_path}")
        return
    
    # Find all PDF files
    pdf_files = list(directory.glob("*.pdf"))
    
    if not pdf_files:
        print(f"❌ No PDF files found in: {directory_path}")
        return
    
    print(f"📁 Found {len(pdf_files)} PDF files in {directory_path}")
    
    successful = 0
    failed = 0
    
    for pdf_file in pdf_files:
        print(f"\n{'='*50}")
        success = generate_questions_for_document(pdf_file, num_questions, output_dir)
        if success:
            successful += 1
        else:
            failed += 1
        time.sleep(1)  # Small delay to be nice to the API
    
    print(f"\n🎉 Processing complete!")
    print(f"✅ Successful: {successful}")
    print(f"❌ Failed: {failed}")

def main():

    
    # Setup paths for imports
    setup_paths()
    
    
    num_questions = 10
    path = Path(os.path.join(os.getcwd(), 'app', 'uploads'))
    downloads_path = Path(os.path.join(os.getcwd(), 'app', 'gdrive_downloads'))
    paths = [path, downloads_path]
    output_dir = Path(os.path.join(os.getcwd(), 'app', 'questions'))
    
    pdf_files = find_all_pdfs(paths)
    
    if not pdf_files:
        print("❌ No PDF files found in the specified paths")
        sys.exit(1)
    
    print(f"\n📋 Found {len(pdf_files)} PDF files:")
    
    # Count by source and sentences availability
    source_counts = {}
    sentences_available = 0
    
    for pdf_info in pdf_files:
        display_name = pdf_info.get('original_name', pdf_info['pdf_path'].name)
        source_type = pdf_info['source_type']
        
        # Count by source
        source_counts[source_type] = source_counts.get(source_type, 0) + 1
        
        # Check sentences availability
        has_sentences = False
        if pdf_info['source_type'] == 'batch_processed':
            has_sentences = pdf_info.get('sentences_file') and pdf_info['sentences_file'].exists()
        else:
            has_sentences = pdf_info.get('has_sentences', False)
        
        if has_sentences:
            sentences_available += 1
        
        sentences_status = "✅" if has_sentences else "❌"
        print(f"   📄 {display_name} ({source_type}) {sentences_status}")
    
    print(f"\n📊 Summary:")
    for source_type, count in source_counts.items():
        print(f"   {source_type}: {count} documents")
    print(f"   Documents with sentences: {sentences_available}/{len(pdf_files)}")
    
    
    # Process all files
    successful = 0
    failed = 0
    skipped = 0
    
    for pdf_info in pdf_files:
        success = generate_questions_for_document(
            pdf_info, 
            num_questions, 
            output_dir
        )
        
        if success is True:
            successful += 1
        elif success is False:
            failed += 1
        else:
            skipped += 1
            
        time.sleep(1)  # Rate limiting
    
    print(f"\n🎉 Processing complete!")
    print(f"✅ Successful: {successful}")
    print(f"⏭️ Skipped (already processed): {skipped}")
    print(f"❌ Failed: {failed}")

if __name__ == "__main__":
    main()