#!/usr/bin/env python3
"""
Refactored Question Generator with Difficulty Levels

This script generates questions at easy and medium difficulty levels for documents.
It integrates with the existing PDF processing pipeline and saves questions in 
both structured and flat formats for compatibility.

Usage:
    python generate_questions.py                    # Process all documents
    python generate_questions.py --easy-only        # Generate only easy questions
    python generate_questions.py --medium-only      # Generate only medium questions
    python generate_questions.py --per-difficulty 5 # 5 questions per difficulty
"""

import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime
from typing import List
from openai import OpenAI
import os 
from dotenv import dotenv_values

def setup_paths():
    """Add the app directory to Python path so we can import from our Flask app"""
    script_dir = Path(__file__).parent
    app_dir = script_dir.parent / 'app'
    sys.path.insert(0, str(app_dir))

def find_documents_with_mappings(self) -> List[str]:
        """Find all documents that have mapping files"""
        mappings_dir = Path("stable_mappings")
        
        if not mappings_dir.exists():
            return []
        
        documents = []
        for mapping_file in mappings_dir.glob("*_mappings.json"):
            # Extract document basename
            basename = mapping_file.stem.replace("_mappings", "")
            

            documents.append(basename)


        print(f"Found {len(documents)} documents with mappings")
        return documents

def get_document_sentences_path(base_name):
    """Get the path to sentences file in the app/sentences directory"""
    script_dir = Path(__file__).parent
    sentences_dir = script_dir.parent / 'app' / 'sentences'
    return sentences_dir / f"{base_name}_sentences.json"

def get_document_text(pdf_info):
    """Get text from document, preferring sentences files when available"""
    
    base_name = pdf_info
    
    # Strategy 1: Try app/sentences directory (for regular uploaded documents)
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
        if isinstance(parsed, dict) and 'questions_by_difficulty' in parsed:
            return parsed
        elif isinstance(parsed, list):
            # Legacy format - convert to new format
            return {'questions': parsed}
        else:
            print(f"⚠️ JSON parsed but unexpected format: {type(parsed)}")
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON decode error: {e}")
        print(f"⚠️ Attempting to parse: {questions_text[:200]}...")
    
    # Fallback parsing for malformed JSON
    import re
    
    # Look for JSON object pattern first
    json_pattern = r'\{[\s\S]*?\}'
    json_matches = re.findall(json_pattern, questions_text)
    
    for match in json_matches:
        try:
            parsed = json.loads(match)
            if isinstance(parsed, dict):
                return parsed
        except:
            continue
    
    # Fallback to array parsing
    json_pattern = r'\[[\s\S]*?\]'
    json_matches = re.findall(json_pattern, questions_text)
    
    for match in json_matches:
        try:
            parsed = json.loads(match)
            if isinstance(parsed, list):
                return {'questions': parsed}
        except:
            continue
    
    # Ultimate fallback: return empty
    print("❌ Could not extract any questions from the response")
    return {}

def check_existing_questions(base_name, output_dir, difficulty_levels):
    """Check if questions already exist for this document"""
    
    # Check for structured format
    structured_file = output_dir / f"{base_name}_questions_by_difficulty.json"
    if structured_file.exists():
        try:
            with open(structured_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            
            # Check if we have questions for the requested difficulty levels
            questions_by_difficulty = existing_data.get('questions_by_difficulty', {})
            has_all_requested = all(
                level in questions_by_difficulty and 
                len(questions_by_difficulty[level].get('questions', [])) > 0
                for level in difficulty_levels
            )
            
            if has_all_requested:
                total_questions = sum(
                    len(questions_by_difficulty[level].get('questions', []))
                    for level in difficulty_levels
                )
                
                return {
                    'exists': True,
                    'file_path': structured_file,
                    'questions_count': total_questions,
                    'generated_at': existing_data.get('generated_at', 'Unknown'),
                    'format': 'structured'
                }
        except Exception as e:
            print(f"⚠️ Error reading structured questions file {structured_file}: {e}")
    
    return {'exists': False}

def generate_difficulty_questions(client, document_content, pdf_info, difficulty_levels, questions_per_difficulty):
    """Generate questions for specific difficulty levels"""
    
    difficulty_descriptions = {
        'easy': {
            'description': 'Direct fact extraction - answers can be found by simple text search',
            'characteristics': 'Focus on who, what, when, where questions. Answers should be directly extractable from the text.',
            'examples': '"Who is a subject in the document?", "What happened on a specific date?", "When did something happen?"'
        },
        'medium': {
            'description': 'Simple synthesis - requires combining information from multiple sentences or sections', 
            'characteristics': 'Require reading 2-3 sentences or sections. Involve simple comparisons or summaries.',
            'examples': '"How do two things in the document compare?", "What are limitations?", "What were key results or outcomes?"'
        }
    }
    
    # Build the prompt for difficulty-based question generation
    difficulties_to_generate = [level for level in difficulty_levels if level in difficulty_descriptions]
    
    prompt_parts = [
        f"Generate questions for this document at {len(difficulties_to_generate)} difficulty levels.",
        f"Generate {questions_per_difficulty} questions for each difficulty level.",
        "",
        "Document content:",
        document_content,
        "",
        "Difficulty levels:"
    ]
    
    for difficulty in difficulties_to_generate:
        desc = difficulty_descriptions[difficulty]
        prompt_parts.extend([
            f"",
            f"**{difficulty.upper()} Questions ({questions_per_difficulty} questions)**",
            f"- {desc['description']}",
            f"- {desc['characteristics']}",
            f"- Examples: {desc['examples']}"
        ])
    
    prompt_parts.extend([
        "",
        "Return your response as a JSON object in this exact format:",
        "{",
        '  "questions_by_difficulty": {'
    ])
    
    for i, difficulty in enumerate(difficulties_to_generate):
        comma = "," if i < len(difficulties_to_generate) - 1 else ""
        prompt_parts.extend([
            f'    "{difficulty}": {{',
            f'      "questions": ["Question 1?", "Question 2?", "Question {questions_per_difficulty}?"]',
            f'    }}{comma}'
        ])
    
    prompt_parts.extend([
        "  }",
        "}",
        "",
        "Important: Return ONLY valid JSON - no markdown, no code blocks, no explanations."
    ])
    
    prompt = "\n".join(prompt_parts)
    
    try:
        print(f"🤖 Calling GPT-4o to generate {difficulties_to_generate} questions...")
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a question generation expert. You MUST respond with valid JSON only - no markdown, no explanations, no code blocks. Generate questions that match the specified difficulty levels exactly. DO NOT ask these questions literally. Use the summaries to infer subjects, verbs, dates, places, etc about the document and create questions based on that context."
                },
                {"role": "user", "content": prompt}
            ],
            max_tokens=1200,
            temperature=0.7
        )

        # Get and parse the response
        questions_text = response.choices[0].message.content.strip()
        print(f"📝 GPT-4o raw response: {questions_text[:150]}...")

        # Parse the response
        parsed_response = parse_gpt_questions_response(questions_text)

        if not parsed_response:
            print("❌ Could not extract any valid questions from GPT response")
            return None

        return parsed_response

    except Exception as e:
        print(f"❌ Error calling GPT-4o: {e}")
        return None

def generate_questions_for_document(pdf_info, difficulty_levels, questions_per_difficulty, output_dir):
    """Generate difficulty-based questions for a single document"""
    
    base_name = pdf_info
    
    print(f"\n{'='*60}")
    print(f"   Base name: {base_name}")
    print(f"   Difficulty levels: {', '.join(difficulty_levels)}")
    print(f"   Questions per difficulty: {questions_per_difficulty}")
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if questions already exist
    existing_check = check_existing_questions(base_name, output_dir, difficulty_levels)
    
    if existing_check['exists']:
        print(f"✅ Questions already exist for {base_name}")
        print(f"   File: {existing_check['file_path']}")
        print(f"   Questions: {existing_check['questions_count']}")
        print(f"   Format: {existing_check['format']}")
        print(f"   Generated: {existing_check['generated_at']}")
        return True
    
    # Get document text
    pdf_text = get_document_text(pdf_info)
    if pdf_text is None:
        print(f"❌ Could not extract text from {base_name}")
        return False
    
    # Load OpenAI client
    env_config = dotenv_values(".env")
    api_key = env_config['OPENAI_API_KEY']
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
    
    # Generate questions
    questions_data = generate_difficulty_questions(
        client, document_content, pdf_info, difficulty_levels, questions_per_difficulty
    )
    
    if not questions_data:
        print(f"❌ Failed to generate questions for {base_name}")
        return False
    
    # Prepare output data
    timestamp = datetime.now()
    
    # Determine text source for metadata
    text_source = "app_sentences_file"
    
    # Create structured format
    structured_data = {
        'document': base_name,
        'generated_at': timestamp.isoformat(),
        'questions_by_difficulty': {},
        'metadata': {
            'base_name': base_name,
            'generated_at_iso': timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'model': 'gpt-4o',
            'difficulty_levels': difficulty_levels,
            'questions_per_difficulty': questions_per_difficulty,
            'original_text_length': len(pdf_text),
            'processed_text_length': len(document_content),
            'was_summarized': len(pdf_text) > 12000,
            'text_source': text_source,
            'script_version': '4.0_difficulty'
        }
    }
    
    # Process questions by difficulty
    all_questions_flat = []
    total_questions = 0
    
    for difficulty in difficulty_levels:
        if difficulty in questions_data.get('questions_by_difficulty', {}):
            difficulty_questions = questions_data['questions_by_difficulty'][difficulty].get('questions', [])
            
            # Add to structured format
            structured_data['questions_by_difficulty'][difficulty] = {
                'description': f"{difficulty.capitalize()} questions - {'direct extraction' if difficulty == 'easy' else 'simple synthesis'}",
                'questions': [
                    {
                        'id': f"{difficulty}_{i+1}",
                        'question': q,
                        'difficulty': difficulty
                    }
                    for i, q in enumerate(difficulty_questions)
                ]
            }
            
            # Add to flat list
            all_questions_flat.extend(difficulty_questions)
            total_questions += len(difficulty_questions)
            
            print(f"✅ Generated {len(difficulty_questions)} {difficulty} questions")
            for i, q in enumerate(difficulty_questions, 1):
                print(f"   {difficulty[0].upper()}{i}. {q}")
    
    structured_data['total_questions'] = total_questions
    
    # Save structured format
    structured_file = output_dir / f"{base_name}_questions_by_difficulty.json"
    try:
        with open(structured_file, 'w', encoding='utf-8') as f:
            json.dump(structured_data, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved structured questions to: {structured_file}")
    except Exception as e:
        print(f"❌ Error saving structured questions: {e}")
        return False
    
    # Save flat format for compatibility
    flat_data = {
        'base_name': base_name,
        'questions': all_questions_flat,
        'metadata': {
            **structured_data['metadata'],
            'has_difficulty_levels': True,
            'source_file': f"{base_name}_questions_by_difficulty.json",
            'total_questions': total_questions
        }
    }
    
    if 'batch_info' in structured_data:
        flat_data['batch_info'] = structured_data['batch_info']
    
    flat_file = output_dir / f"{base_name}_questions.json"
    try:
        with open(flat_file, 'w', encoding='utf-8') as f:
            json.dump(flat_data, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved flat questions to: {flat_file}")
    except Exception as e:
        print(f"❌ Error saving flat questions: {e}")
        return False
    
    return True

def main():
    parser = argparse.ArgumentParser(description="Generate difficulty-based questions for documents")
    parser.add_argument("--easy-only", action="store_true", help="Generate only easy questions")
    parser.add_argument("--medium-only", action="store_true", help="Generate only medium questions")
    parser.add_argument("--per-difficulty", type=int, default=5, help="Questions per difficulty level")
    parser.add_argument("--output-dir", help="Output directory (default: ./questions_difficulty)")
    
    args = parser.parse_args()
    
    # Setup paths for imports
    setup_paths()
    
    # Determine difficulty levels
    if args.easy_only:
        difficulty_levels = ['easy']
    elif args.medium_only:
        difficulty_levels = ['medium']
    else:
        difficulty_levels = ['easy', 'medium']  # Default: both easy and medium
    
    # Setup paths
    path = Path(os.path.join(os.getcwd(), 'app', 'uploads'))
    paths = [path]
    
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = Path(os.path.join(os.getcwd(), 'questions_difficulty'))
    
    # Find PDFs
    pdf_files = find_documents_with_mappings(paths)
    
    if not pdf_files:
        print("❌ No PDF files found in the specified paths")
        sys.exit(1)
    
    print(f"\n📋 Found {len(pdf_files)} PDF files:")

    # pdf_files is just basename of documents

    successful = 0
    failed = 0
    skipped = 0
    for pdf_info in pdf_files:
        success = generate_questions_for_document(
            pdf_info, 
            difficulty_levels,
            args.per_difficulty,
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
    print(f"📁 Output directory: {output_dir}")

if __name__ == "__main__":
    main()