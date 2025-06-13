#!/usr/bin/env python3
"""
Test Suite Generator for Document QA System

This script generates a test suite by:
1. Finding all documents with mapping files in stable_mappings/
2. Finding matching question files in questions/
3. Running questions against documents via the /ask endpoint
4. Letting the backend handle all file saving (progressive writing)

Features:
- Rate limiting friendly (sequential processing)
- Early exit conditions for failed answers
- Max 5 questions per document
- Backend handles all file I/O operations
"""

import os
import json
import time
import requests
import logging
from pathlib import Path
from typing import List, Optional
import argparse
from datetime import datetime
from werkzeug.utils import secure_filename

def generate_safe_question_id(base_filename: str, question_text: str) -> str:
    """
    Generate a safe question ID based on PDF filename and timestamp
    This ensures questions are organized by document
    """
    safe_filename = secure_filename(base_filename)
    
    # Create timestamp-based ID
    timestamp = str(int(time.time()))
    
    # Optionally include a hash of the question for uniqueness
    # this is for test_suite deterministic question IDs
    # If question_text is provided, use it to create a unique ID
    if question_text:
        import hashlib
        question_hash = hashlib.md5(question_text.encode()).hexdigest()[:8]
        return f"{safe_filename}_{question_hash}"
    else:
        return f"{safe_filename}_{timestamp}"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class TestSuiteGenerator:
    def __init__(self, 
                 base_url: str = "http://localhost:5000/api",
                 max_questions_per_doc: int = 10,
                 answer_timeout: int = 120,
                 request_delay: float = 2.0):
        """
        Initialize the test suite generator
        
        Args:
            base_url: Base URL for the API
            max_questions_per_doc: Maximum questions to test per document
            answer_timeout: Timeout in seconds for answer generation
            request_delay: Delay between requests (rate limiting)
        """
        self.base_url = base_url
        self.max_questions_per_doc = max_questions_per_doc
        self.answer_timeout = answer_timeout
        self.request_delay = request_delay
        
        # Statistics
        self.stats = {
            'total_documents': 0,
            'documents_processed': 0,
            'documents_skipped': 0,
            'total_questions_attempted': 0,
            'successful_answers': 0,
            'failed_answers': 0,
            'timeouts': 0,
            'early_exits': 0,
            'question_ids_generated': []
        }

    def find_documents_with_mappings(self) -> List[str]:
        """Find all documents that have mapping files"""
        mappings_dir = Path("mappings")
        
        if not mappings_dir.exists():
            logger.warning(f"Mappings directory not found: {mappings_dir}")
            return []
        
        documents = []
        for mapping_file in mappings_dir.glob("*_mappings.json"):
            # Extract document basename
            basename = mapping_file.stem.replace("_mappings", "")
            
            # Verify the PDF exists (check common locations)
            pdf_locations = [
                Path("uploads") / f"{basename}.pdf",
                Path("gdrive_downloads") / "**" / f"{basename}.pdf",
                Path("app/uploads") / f"{basename}.pdf"
            ]
            
            pdf_exists = False
            for location in pdf_locations:
                if location.exists() or list(Path(".").glob(str(location))):
                    pdf_exists = True
                    break
            
            if pdf_exists:
                documents.append(basename)
                logger.info(f"Found document with mappings: {basename}")
            else:
                logger.warning(f"Mapping file found but no PDF: {basename}")
        
        logger.info(f"Found {len(documents)} documents with mappings")
        return documents

    def load_questions_for_document(self, document_basename: str) -> List[str]:
        """Load questions for a specific document by basename"""
        questions_dir = Path("questions")
        question_file = questions_dir / f"{document_basename}_questions.json"

        # Create directory structure: results/{safe_pdf_name}/{question_id}/
        results_dir = os.path.join(Path("test_outputs"), secure_filename(document_basename))


        if not question_file.exists():
            logger.warning(f"No questions file found for {document_basename}: {question_file}")
            return []
        
        try:
            with open(question_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Extract questions from the file
            questions = []
            if isinstance(data, dict) and 'questions' in data:
                questions = data['questions']
            elif isinstance(data, list):
                questions = data

            question_tracker = {generate_safe_question_id(document_basename, question): question for question in questions}
            limited_questions = []
            # check if there is a status.json file in the results/<document_basename>/<question_id> directory
            for question_id in question_tracker.keys():
                status_file = Path(results_dir) / question_id / "status.json"
                if status_file.exists():
                    logger.info(f"Found status file for {question_id}: {status_file}")
                    # read it, if it has 'processing_complete' set to True, skip this question
                    with open(status_file, 'r', encoding='utf-8') as sf:
                        status_data = json.load(sf)
                        if status_data.get('processing_complete', True):
                            logger.info(f"Skipping already processed question: {question_id}")
                        else:
                            limited_questions.append(question_tracker[question_id])
                else:
                    limited_questions.append(question_tracker[question_id])
            logger.info(f"Loaded {len(limited_questions)} questions for {document_basename}")

            return limited_questions

        except Exception as e:
            logger.error(f"Error loading questions from {question_file}: {e}")
            return []

    def ask_question(self, question: str, filename: str) -> Optional[str]:
        """
        Ask a question via the API and return the question_id if successful
        
        The backend handles all file saving operations.
        
        Returns:
            question_id if successful, None if failed
        """
        try:
            # Submit question
            response = requests.post(
                f"{self.base_url}/ask",
                json={
                    "question": question,
                    "filename": f"{filename}.pdf"
                },
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    question_id = data.get('question_id')
                    logger.info(f"Question submitted successfully: {question_id}")
                    return question_id
                else:
                    logger.error(f"API error: {data.get('error', 'Unknown error')}")
            else:
                logger.error(f"HTTP error: {response.status_code}")
                
        except Exception as e:
            logger.error(f"Request failed: {e}")
        
        return None

    def wait_for_answer(self, question_id: str) -> Optional[str]:
        """
        Wait for answer to be ready
        
        Returns:
            Answer text if successful, None if failed/timeout
        """
        start_time = time.time()
        
        while time.time() - start_time < self.answer_timeout:
            try:
                # Check if answer is ready
                response = requests.get(
                    f"{self.base_url}/check-answer/{question_id}",
                    timeout=15
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    if data.get('success') and data.get('ready'):
                        answer = data.get('answer', '').strip()
                        processing_time = time.time() - start_time
                        
                        logger.info(f"Answer ready for {question_id} (took {processing_time:.1f}s)")
                        
                        # Check if answer is meaningful (early exit condition)
                        if not answer or answer.upper() in ['NULL', 'ANSWER IS NOT FOUND']:
                            logger.warning(f"Empty/null answer for {question_id}")
                            self.stats['early_exits'] += 1
                            return None
                        
                        return answer
                        
                    elif data.get('ready') is False:
                        # Still processing, wait a bit
                        elapsed = time.time() - start_time
                        logger.debug(f"Still processing {question_id} ({elapsed:.1f}s elapsed)")
                        time.sleep(5)
                        continue
                    else:
                        logger.warning(f"Unexpected response for {question_id}: {data}")
                        break
                else:
                    logger.error(f"Error checking answer for {question_id}: {response.status_code}")
                    break
                    
            except Exception as e:
                logger.error(f"Error waiting for answer {question_id}: {e}")
                break
        
        logger.warning(f"Timeout waiting for answer: {question_id}")
        self.stats['timeouts'] += 1
        return None

    def get_question_status(self, question_id: str) -> dict:
        """Get comprehensive status for a question"""
        try:
            response = requests.get(
                f"{self.base_url}/question-status/{question_id}",
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    return data.get('status', {})
            
            logger.warning(f"Could not get status for {question_id}")
            return {}
            
        except Exception as e:
            logger.error(f"Error getting status for {question_id}: {e}")
            return {}

    def process_document(self, document_name: str, questions: List[str]) -> int:
        """
        Process all questions for a single document
        
        Returns:
            Number of successful QA pairs generated
        """
        logger.info(f"🔄 Processing document: {document_name}")
        successful_pairs = 0
        question_ids = []
        
        for idx, question in enumerate(questions):
            if idx >= self.max_questions_per_doc:
                break
                
            logger.info(f"  📝 Question {idx + 1}/{min(len(questions), self.max_questions_per_doc)}: {question[:50]}...")
            self.stats['total_questions_attempted'] += 1
            
            # Rate limiting delay
            if idx > 0:
                time.sleep(self.request_delay)
            
            # Ask question (backend handles all file operations)
            question_id = self.ask_question(question, document_name)
            if not question_id:
                logger.error(f"  ❌ Failed to submit question")
                self.stats['failed_answers'] += 1
                continue
            
            question_ids.append(question_id)
            
            # Wait for answer (backend handles provenance generation)
            answer = self.wait_for_answer(question_id)
            if answer:
                logger.info(f"  ✅ Answer generated for {question_id}")
                successful_pairs += 1
                self.stats['successful_answers'] += 1
                self.stats['question_ids_generated'].append(question_id)
            else:
                logger.error(f"  ❌ Failed to get answer for {question_id}")
                self.stats['failed_answers'] += 1
        
        # Final status check for all questions
        if question_ids:
            logger.info(f"  📊 Checking final status for {len(question_ids)} questions...")
            for question_id in question_ids:
                status = self.get_question_status(question_id)
                provenance_count = status.get('provenance_count', 0)
                processing_complete = status.get('processing_complete', False)
                
                logger.debug(f"    {question_id}: {provenance_count} provenances, complete: {processing_complete}")
        
        logger.info(f"📊 Document {document_name}: {successful_pairs} successful QA pairs")
        return successful_pairs

    def generate_test_suite(self):
        """Generate the complete test suite"""
        logger.info("🚀 Starting test suite generation...")
        logger.info("📁 Backend will save all files to TEST_SUITE_DIR")
        
        # Find documents with mappings
        documents = self.find_documents_with_mappings()
        
        if not documents:
            logger.error("❌ No documents with mappings found!")
            return
        
        # Process each document with its specific questions
        self.stats['total_documents'] = len(documents)
        
        for doc_idx, document_name in enumerate(documents):
            logger.info(f"\n📄 Document {doc_idx + 1}/{len(documents)}: {document_name}")
            
            # Load questions specifically for this document
            questions = self.load_questions_for_document(document_name)
            
            if not questions:
                logger.warning(f"  ⚠️  No questions available for {document_name}, skipping...")
                self.stats['documents_skipped'] += 1
                continue
            
            logger.info(f"  📝 Found {len(questions)} questions for {document_name}")
            
            # Process questions for this document
            try:
                success_count = self.process_document(document_name, questions)
                if success_count > 0:
                    self.stats['documents_processed'] += 1
            except KeyboardInterrupt:
                logger.info("🛑 Interrupted by user")
                break
            except Exception as e:
                logger.error(f"❌ Error processing {document_name}: {e}")
                self.stats['documents_skipped'] += 1
                continue
        
        # Print final statistics
        self.print_statistics()

    def print_statistics(self):
        """Print final statistics"""
        logger.info("\n" + "="*60)
        logger.info("📊 TEST SUITE GENERATION COMPLETE")
        logger.info("="*60)
        logger.info(f"Total documents found: {self.stats['total_documents']}")
        logger.info(f"Documents processed: {self.stats['documents_processed']}")
        logger.info(f"Documents skipped: {self.stats['documents_skipped']}")
        logger.info(f"Total questions attempted: {self.stats['total_questions_attempted']}")
        logger.info(f"Successful answers: {self.stats['successful_answers']}")
        logger.info(f"Failed answers: {self.stats['failed_answers']}")
        logger.info(f"Timeouts: {self.stats['timeouts']}")
        logger.info(f"Early exits (no answer): {self.stats['early_exits']}")
        
        success_rate = (self.stats['successful_answers'] / 
                       max(self.stats['total_questions_attempted'], 1)) * 100
        logger.info(f"Success rate: {success_rate:.1f}%")
        
        if self.stats['question_ids_generated']:
            logger.info(f"\n📋 Generated Question IDs:")
            for i, qid in enumerate(self.stats['question_ids_generated'][:10]):  # Show first 10
                logger.info(f"  {i+1}. {qid}")
            if len(self.stats['question_ids_generated']) > 10:
                logger.info(f"  ... and {len(self.stats['question_ids_generated']) - 10} more")
        
        logger.info(f"\n💾 All files saved by backend to TEST_SUITE_DIR")
        logger.info("🎯 Ready for mock server testing!")


def main():
    parser = argparse.ArgumentParser(description="Generate test suite for document QA system")
    parser.add_argument("--base-url", default="http://localhost:5000/api",
                       help="Base URL for the API")
    parser.add_argument("--max-questions", type=int, default=10,
                       help="Maximum questions per document")
    parser.add_argument("--timeout", type=int, default=120,
                       help="Timeout for answer generation (seconds)")
    parser.add_argument("--delay", type=float, default=2.0,
                       help="Delay between requests (seconds)")
    parser.add_argument("--verbose", action="store_true",
                       help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Create generator and run
    generator = TestSuiteGenerator(
        base_url=args.base_url,
        max_questions_per_doc=args.max_questions,
        answer_timeout=args.timeout,
        request_delay=args.delay
    )
    
    try:
        generator.generate_test_suite()
    except KeyboardInterrupt:
        logger.info("\n🛑 Generation interrupted by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        raise


if __name__ == "__main__":
    main()