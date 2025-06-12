#!/usr/bin/env python3
"""
Test Suite Consolidator

This script consolidates individual question files into single JSON files per document.

Structure:
test_outputs/<document_name>/<document_name>_<question_id>/
├── answer.json
├── provenance.json
├── metadata.json
└── ...other files...

Consolidates to:
consolidated_test_suite/<document_name>_test_suite.json

Format:
[
  {
    "q1": {
      "question": "What is this paper about?",
      "answer": "This paper discusses...",
      "provenance": [...],
      "metadata": {...}
    }
  },
  {
    "q2": {
      "question": "How was the study conducted?",
      "answer": "The study was conducted...",
      "provenance": [...],
      "metadata": {...}
    }
  }
]
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Any
import argparse
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class TestSuiteConsolidator:
    def __init__(self, 
                 input_dir: str = "test_outputs",
                 output_dir: str = "consolidated_test_suite"):
        """
        Initialize the consolidator
        
        Args:
            input_dir: Directory containing test outputs
            output_dir: Directory to save consolidated files
        """
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Statistics
        self.stats = {
            'documents_processed': 0,
            'documents_skipped': 0,
            'total_questions': 0,
            'successful_consolidations': 0,
            'failed_consolidations': 0
        }

    def find_document_directories(self) -> List[str]:
        """Find all document directories in test outputs"""
        documents_dir = self.input_dir
        
        if not documents_dir.exists():
            logger.error(f"Documents directory not found: {documents_dir}")
            return []
        
        document_names = []
        for item in documents_dir.iterdir():
            if item.is_dir():
                document_names.append(item.name)
        
        logger.info(f"Found {len(document_names)} document directories")
        return sorted(document_names)

    def load_json_file(self, file_path: Path) -> Any:
        """Safely load a JSON file"""
        try:
            if not file_path.exists():
                return None
            
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load {file_path}: {e}")
            return None

    def extract_question_data(self, question_dir: Path) -> Dict[str, Any]:
        """Extract and consolidate data from a question directory"""
        question_data = {}
        
        # Load answer.json
        answer_data = self.load_json_file(question_dir / "answer.json")
        if answer_data:
            # Extract question and answer text
            question_text = ""
            answer_text = ""
            
            if isinstance(answer_data.get('question'), list) and answer_data['question']:
                question_text = answer_data['question'][0]
            elif isinstance(answer_data.get('question'), str):
                question_text = answer_data['question']
            
            if isinstance(answer_data.get('answer'), list) and answer_data['answer']:
                answer_text = answer_data['answer'][0]
            elif isinstance(answer_data.get('answer'), str):
                answer_text = answer_data['answer']
            
            question_data['question'] = question_text
            question_data['answer'] = answer_text
            
            # Include processing time if available
            if 'processing_time' in answer_data:
                question_data['processing_time'] = answer_data['processing_time']
        else:
            logger.warning(f"No answer.json found in {question_dir}")
            return {}
        
        # Load provenance.json
        provenance_data = self.load_json_file(question_dir / "provenance.json")
        if provenance_data:
            question_data['provenance'] = provenance_data
        else:
            logger.warning(f"No provenance.json found in {question_dir}")
            question_data['provenance'] = []
        
        # Load metadata.json
        metadata_data = self.load_json_file(question_dir / "metadata.json")
        if metadata_data:
            # Filter out processing logs and status - keep only essential metadata
            filtered_metadata = {}
            
            # Keep essential fields
            essential_fields = [
                'question_id', 'document_name', 'created_at', 'processing_time',
                'provenance_count', 'processing_complete', 'question', 'max_provenances'
            ]
            
            for field in essential_fields:
                if field in metadata_data:
                    filtered_metadata[field] = metadata_data[field]
            
            question_data['metadata'] = filtered_metadata
        else:
            logger.warning(f"No metadata.json found in {question_dir}")
            question_data['metadata'] = {}
        
        return question_data

    def consolidate_document(self, document_name: str) -> bool:
        """Consolidate all questions for a single document"""
        logger.info(f"🔄 Consolidating document: {document_name}")
        
        document_dir = self.input_dir / document_name
        
        if not document_dir.exists():
            logger.error(f"Document directory not found: {document_dir}")
            return False
        
        # Find all question directories
        question_dirs = []
        for item in document_dir.iterdir():
            if item.is_dir():
                question_dirs.append(item)
        
        if not question_dirs:
            logger.warning(f"No question directories found in {document_dir}")
            return False

        # Sort question directories by name
        question_dirs.sort(key=lambda x: x.name)
        
        logger.info(f"  📝 Found {len(question_dirs)} questions for {document_name}")
        
        # Process each question
        consolidated_data = []
        successful_questions = 0
        
        for question_dir in question_dirs:
            question_id = str(os.path.split(question_dir)[-1]).split('_')[-1]  # Get the "_<question_id>" part of the folder name
            logger.debug(f"    Processing {question_id}")
            
            try:
                question_data = self.extract_question_data(question_dir)
                
                if question_data:
                    # Create the structure: {question_id: {data}}
                    consolidated_entry = {question_id: question_data}
                    consolidated_data.append(consolidated_entry)
                    successful_questions += 1
                    self.stats['total_questions'] += 1
                    
                    logger.debug(f"    ✅ Consolidated {question_id}")
                else:
                    logger.warning(f"    ❌ Failed to extract data for {question_id}")
                    
            except Exception as e:
                logger.error(f"    ❌ Error processing {question_id}: {e}")
                continue
        
        if not consolidated_data:
            logger.warning(f"No valid questions found for {document_name}")
            return False
        
        # Save consolidated file
        output_file = self.output_dir / f"{document_name}_test_suite.json"
        
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(consolidated_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"  ✅ Saved {successful_questions} questions to {output_file.name}")
            return True
            
        except Exception as e:
            logger.error(f"  ❌ Failed to save {output_file}: {e}")
            return False

    def consolidate_all(self):
        """Consolidate all documents"""
        logger.info("🚀 Starting test suite consolidation...")
        
        document_names = self.find_document_directories()
        
        if not document_names:
            logger.error("❌ No documents found to consolidate!")
            return
        
        logger.info(f"📁 Found {len(document_names)} documents to consolidate")
        
        # Process each document
        for i, document_name in enumerate(document_names, 1):
            logger.info(f"\n📄 Document {i}/{len(document_names)}: {document_name}")
            
            try:
                success = self.consolidate_document(document_name)
                
                if success:
                    self.stats['documents_processed'] += 1
                    self.stats['successful_consolidations'] += 1
                else:
                    self.stats['documents_skipped'] += 1
                    self.stats['failed_consolidations'] += 1
                    
            except Exception as e:
                logger.error(f"❌ Error consolidating {document_name}: {e}")
                self.stats['documents_skipped'] += 1
                self.stats['failed_consolidations'] += 1
        
        # Create summary file
        self.create_summary()
        
        # Print statistics
        self.print_statistics()

    def create_summary(self):
        """Create a summary file with all consolidated documents"""
        summary_data = {
            'consolidation_info': {
                'created_at': datetime.now().isoformat(),
                'input_directory': str(self.input_dir),
                'output_directory': str(self.output_dir),
                'total_documents': self.stats['documents_processed'],
                'total_questions': self.stats['total_questions']
            },
            'documents': []
        }
        
        # List all consolidated files
        for consolidated_file in self.output_dir.glob("*_test_suite.json"):
            document_name = consolidated_file.stem.replace("_test_suite", "")
            
            try:
                with open(consolidated_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                summary_data['documents'].append({
                    'document_name': document_name,
                    'filename': consolidated_file.name,
                    'question_count': len(data),
                    'file_size_kb': round(consolidated_file.stat().st_size / 1024, 2)
                })
                
            except Exception as e:
                logger.warning(f"Could not analyze {consolidated_file}: {e}")
        
        # Save summary
        summary_file = self.output_dir / "consolidation_summary.json"
        try:
            with open(summary_file, 'w', encoding='utf-8') as f:
                json.dump(summary_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"📊 Created summary file: {summary_file.name}")
            
        except Exception as e:
            logger.error(f"Failed to create summary file: {e}")

    def print_statistics(self):
        """Print final statistics"""
        logger.info("\n" + "="*60)
        logger.info("📊 CONSOLIDATION COMPLETE")
        logger.info("="*60)
        logger.info(f"Documents processed: {self.stats['documents_processed']}")
        logger.info(f"Documents skipped: {self.stats['documents_skipped']}")
        logger.info(f"Total questions consolidated: {self.stats['total_questions']}")
        logger.info(f"Successful consolidations: {self.stats['successful_consolidations']}")
        logger.info(f"Failed consolidations: {self.stats['failed_consolidations']}")
        
        success_rate = (self.stats['successful_consolidations'] / 
                       max(len(self.find_document_directories()), 1)) * 100
        logger.info(f"Success rate: {success_rate:.1f}%")
        
        logger.info(f"\n📁 Output directory: {self.output_dir.absolute()}")
        logger.info("🎯 Consolidated files ready for use!")
        
        # List created files
        consolidated_files = list(self.output_dir.glob("*_test_suite.json"))
        if consolidated_files:
            logger.info(f"\n📋 Created {len(consolidated_files)} consolidated files:")
            for i, file_path in enumerate(consolidated_files, 1):
                file_size = round(file_path.stat().st_size / 1024, 2)
                logger.info(f"  {i}. {file_path.name} ({file_size} KB)")

    def validate_consolidated_file(self, file_path: Path) -> bool:
        """Validate a consolidated file structure"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if not isinstance(data, list):
                logger.error(f"Invalid structure in {file_path}: not a list")
                return False
            
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    logger.error(f"Invalid item {i} in {file_path}: not a dict")
                    return False
                
                if len(item) != 1:
                    logger.error(f"Invalid item {i} in {file_path}: should have exactly one key")
                    return False
                
                question_id = list(item.keys())[0]
                question_data = item[question_id]
                
                required_fields = ['question', 'answer', 'provenance', 'metadata']
                for field in required_fields:
                    if field not in question_data:
                        logger.warning(f"Missing field '{field}' in {question_id} of {file_path}")
            
            logger.info(f"✅ {file_path.name} structure is valid")
            return True
            
        except Exception as e:
            logger.error(f"Error validating {file_path}: {e}")
            return False

    def validate_all_files(self):
        """Validate all consolidated files"""
        logger.info("🔍 Validating consolidated files...")
        
        consolidated_files = list(self.output_dir.glob("*_test_suite.json"))
        valid_files = 0
        
        for file_path in consolidated_files:
            if self.validate_consolidated_file(file_path):
                valid_files += 1
        
        logger.info(f"📊 Validation complete: {valid_files}/{len(consolidated_files)} files are valid")


def main():
    parser = argparse.ArgumentParser(description="Consolidate test suite files")
    parser.add_argument("--input-dir", default="test_outputs",
                       help="Input directory containing test outputs")
    parser.add_argument("--output-dir", default="consolidated_test_suite",
                       help="Output directory for consolidated files")
    parser.add_argument("--validate", action="store_true",
                       help="Validate consolidated files after creation")
    parser.add_argument("--verbose", action="store_true",
                       help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Create consolidator and run
    consolidator = TestSuiteConsolidator(
        input_dir=args.input_dir,
        output_dir=args.output_dir
    )
    
    try:
        consolidator.consolidate_all()
        
        if args.validate:
            consolidator.validate_all_files()
            
    except KeyboardInterrupt:
        logger.info("\n🛑 Consolidation interrupted by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        raise


if __name__ == "__main__":
    main()