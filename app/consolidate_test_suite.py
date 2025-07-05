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

import argparse, json, logging, os
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
from datetime import datetime
from collections import defaultdict

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class TestSuiteConsolidator:
    def __init__(self, 
                 input_dirs: List[str] = None,
                 output_dir: str = "consolidated_test_suite"):
        """
        Initialize the consolidator
        
        Args:
            input_dir: Directory containing test outputs
            output_dir: Directory to save consolidated files
        """
        if input_dirs is None:
            input_dirs = ["test_outputs", "test_outputs_prev", "test_outputs_prev1"]
        
        self.input_dirs = [Path(d) for d in input_dirs]
        self.output_dir = Path(output_dir)
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        
        # Statistics
        self.stats = {
            'documents_processed': 0,
            'documents_skipped': 0,
            'total_questions': 0,
            'successful_consolidations': 0,
            'failed_consolidations': 0,
            'provenance_selections': defaultdict(int),  # Track selection reasons
            'unique_provenances_assigned': 0
        }

    def find_all_documents(self) -> Dict[str, List[Path]]:
        """Find all document directories across all input directories"""
        all_documents = defaultdict(list)
        
        for input_dir in self.input_dirs:
            if not input_dir.exists():
                logger.warning(f"Input directory not found: {input_dir}")
                continue
            
            logger.info(f"🔍 Scanning {input_dir}")
            
            for item in input_dir.iterdir():
                if item.is_dir():
                    document_name = item.name
                    all_documents[document_name].append(item)
        
        logger.info(f"📁 Found {len(all_documents)} unique documents across all directories")
        
        # Log document availability
        for doc_name, paths in all_documents.items():
            sources = [p.parent.name for p in paths]
            logger.debug(f"  {doc_name}: available in {sources}")
        
        return all_documents
    
    def find_questions_for_document(self, document_paths: List[Path]) -> Dict[str, List[Tuple[Path, str]]]:
        """Find all questions for a document across multiple directories"""
        all_questions = defaultdict(list)
        
        for doc_path in document_paths:
            source_dir = doc_path.parent.name
            
            if not doc_path.exists():
                continue
            
            for item in doc_path.iterdir():
                if item.is_dir():
                    # question_id also can be <document_name>_<question_id>
                    folder_name = item.name
                    if '_q' in folder_name:
                        question_id = folder_name.split('_q')[-1]
                    elif '_question' in folder_name:
                        question_id = folder_name.split('_question')[-1]
                    else:
                        # Try to extract the last part after underscore
                        parts = folder_name.split('_')
                        question_id = parts[-1] if len(parts) > 1 else folder_name
                    
                    all_questions[question_id].append((item, source_dir))
        
        return all_questions

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
        
    def count_provenance_sentences(self, provenance_data: List[Dict]) -> int:
        """Count total sentences across all provenances"""
        if not provenance_data or not isinstance(provenance_data, list):
            return 999999  # Consider invalid provenance as "worst"
        
        total_sentences = 0
        for prov in provenance_data:
            if isinstance(prov, dict):
                # Count sentences in provenance_ids or sentences_ids
                prov_ids = prov.get('provenance_ids', [])
                sentence_ids = prov.get('sentences_ids', [])
                input_sentence_ids = prov.get('input_sentence_ids', [])
                
                # Use the largest list as the sentence count
                sentence_count = max(
                    len(prov_ids) if isinstance(prov_ids, list) else 0,
                    len(sentence_ids) if isinstance(sentence_ids, list) else 0,
                    len(input_sentence_ids) if isinstance(input_sentence_ids, list) else 0
                )
                
                total_sentences += sentence_count
        
        return total_sentences

    def assign_unique_provenance_ids(self, provenance_data: List[Dict]) -> List[Dict]:
        """Assign unique provenance IDs to provenance data"""
        if not provenance_data or not isinstance(provenance_data, list):
            return provenance_data
        
        new_provenance_id = 0
        
        updated_provenance = []
        for prov in provenance_data:
            if isinstance(prov, dict):
                # Create a copy and assign new unique ID
                prov_copy = prov.copy()
                prov_copy['provenance_id'] = new_provenance_id
                prov_copy['original_provenance_id'] = prov.get('provenance_id', 'unknown')
                
                updated_provenance.append(prov_copy)
                new_provenance_id += 1
                self.stats['unique_provenances_assigned'] += 1
            else:
                updated_provenance.append(prov)
        
        return updated_provenance

    def select_best_question_data(self, question_candidates: List[Tuple[Path, str]], question_id: str) -> Optional[Dict]:
        """Select the best question data from multiple candidates"""
        if not question_candidates:
            return None
        
        best_candidate = None
        best_sentence_count = 999999
        alternatives = []
        
        logger.debug(f"    🔍 Evaluating {len(question_candidates)} candidates for question {question_id}")
        
        for question_dir, source_dir in question_candidates:
            try:
                # Load all the data for this candidate
                answer_data = self.load_json_file(question_dir / "answer.json")
                provenance_data = self.load_json_file(question_dir / "provenance.json")
                metadata_data = self.load_json_file(question_dir / "metadata.json")
                
                if not answer_data:
                    logger.debug(f"      ❌ {source_dir}: No answer.json")
                    continue
                
                # Count sentences in provenance
                sentence_count = self.count_provenance_sentences(provenance_data)
                
                # Create candidate info
                candidate_info = {
                    'source_dir': source_dir,
                    'question_dir': question_dir,
                    'sentence_count': sentence_count,
                    'answer_data': answer_data,
                    'provenance_data': provenance_data or [],
                    'metadata_data': metadata_data or {},
                    'has_valid_answer': bool(answer_data.get('answer')),
                    'has_provenance': bool(provenance_data),
                    'provenance_count': len(provenance_data) if isinstance(provenance_data, list) else 0
                }
                
                alternatives.append({
                    'source': source_dir,
                    'sentence_count': sentence_count,
                    'provenance_count': candidate_info['provenance_count'],
                    'has_answer': candidate_info['has_valid_answer']
                })
                
                logger.debug(f"      📊 {source_dir}: {sentence_count} sentences, {candidate_info['provenance_count']} provenances")
                
                # Selection criteria (in order of priority):
                # 1. Must have a valid answer
                # 2. Prefer fewer sentences (better provenance)
                # 3. Prefer having some provenance over none
                
                is_better = False
                selection_reason = ""
                
                if not candidate_info['has_valid_answer']:
                    logger.debug(f"      ❌ {source_dir}: No valid answer")
                    continue
                
                if best_candidate is None:
                    is_better = True
                    selection_reason = "first_valid"
                elif not best_candidate['has_valid_answer'] and candidate_info['has_valid_answer']:
                    is_better = True
                    selection_reason = "has_answer"
                elif sentence_count < best_sentence_count:
                    is_better = True
                    selection_reason = "shorter_provenance"
                elif sentence_count == best_sentence_count and candidate_info['has_provenance'] and not best_candidate['has_provenance']:
                    is_better = True
                    selection_reason = "has_provenance"
                
                if is_better:
                    best_candidate = candidate_info
                    best_sentence_count = sentence_count
                    logger.debug(f"      ✅ {source_dir}: New best ({selection_reason})")
                    
            except Exception as e:
                logger.warning(f"      ❌ Error evaluating {source_dir}: {e}")
                continue
        
        if not best_candidate:
            logger.warning(f"    ❌ No valid candidates found for question {question_id}")
            return None
        
        # Track selection statistics
        selection_reason = "shorter_provenance" if best_sentence_count < 999999 else "default"
        self.stats['provenance_selections'][selection_reason] += 1
        
        # Extract and structure the question data
        question_data = {}
        
        # Extract question and answer text
        answer_data = best_candidate['answer_data']
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
        
        # Process provenance with unique IDs
        provenance_with_unique_ids = self.assign_unique_provenance_ids(best_candidate['provenance_data'])
        question_data['provenance'] = provenance_with_unique_ids
        
        # Process metadata
        metadata_data = best_candidate['metadata_data']
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
        
        # Add source information
        question_data['source_info'] = {
            'selected_from': best_candidate['source_dir'],
            'reason': selection_reason,
            'sentence_count': best_sentence_count,
            'provenance_count': len(provenance_with_unique_ids),
            'alternatives': alternatives,
            'selection_timestamp': datetime.now().isoformat()
        }
        
        logger.debug(f"    ✅ Selected from {best_candidate['source_dir']} ({best_sentence_count} sentences)")
        
        return question_data

    def consolidate_document(self, document_name: str, document_paths: List[Path]) -> bool:
        """Consolidate all questions for a single document from multiple sources"""
        logger.info(f"🔄 Consolidating document: {document_name}")
        source_names = [p.parent.name for p in document_paths]
        logger.info(f"  📂 Sources: {', '.join(source_names)}")
        
        # Find all questions across all sources
        all_questions = self.find_questions_for_document(document_paths)
        
        if not all_questions:
            logger.warning(f"  ❌ No questions found for {document_name}")
            return False
        
        logger.info(f"  📝 Found {len(all_questions)} unique questions")
        
        # Process each question
        consolidated_data = []
        successful_questions = 0
        
        # Sort questions by ID for consistent output
        sorted_question_ids = sorted(all_questions.keys(), key=lambda x: (len(x), x))
        
        for question_id in sorted_question_ids:
            question_candidates = all_questions[question_id]
            logger.debug(f"  🔍 Processing question {question_id} ({len(question_candidates)} candidates)")
            
            try:
                question_data = self.select_best_question_data(question_candidates, question_id)
                
                if question_data:
                    # Create the structure: {question_id: {data}}
                    consolidated_entry = {question_id: question_data}
                    consolidated_data.append(consolidated_entry)
                    successful_questions += 1
                    self.stats['total_questions'] += 1
                    
                    logger.debug(f"    ✅ Consolidated {question_id}")
                else:
                    logger.warning(f"    ❌ Failed to select best data for {question_id}")
                    
            except Exception as e:
                logger.error(f"    ❌ Error processing {question_id}: {e}")
                continue
        
        if not consolidated_data:
            logger.warning(f"  ❌ No valid questions consolidated for {document_name}")
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
        """Consolidate all documents from all input directories"""
        logger.info("🚀 Starting enhanced test suite consolidation...")
        
        # Find all documents across directories
        all_documents = self.find_all_documents()
        
        if not all_documents:
            logger.error("❌ No documents found to consolidate!")
            return
        
        logger.info(f"📁 Found {len(all_documents)} unique documents across all input directories")
        
        # Process each document
        for i, (document_name, document_paths) in enumerate(sorted(all_documents.items()), 1):
            logger.info(f"\n📄 Document {i}/{len(all_documents)}: {document_name}")
            
            try:
                success = self.consolidate_document(document_name, document_paths)
                
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
                'input_directories': [str(d) for d in self.input_dirs],
                'output_directory': str(self.output_dir),
                'total_documents': self.stats['documents_processed'],
                'total_questions': self.stats['total_questions'],
                'unique_provenances_assigned': self.stats['unique_provenances_assigned'],
                'consolidation_strategy': 'shortest_provenance_preferred'
            },
            'selection_statistics': dict(self.stats['provenance_selections']),
            'documents': []
        }
        
        # List all consolidated files
        for consolidated_file in self.output_dir.glob("*_test_suite.json"):
            document_name = consolidated_file.stem.replace("_test_suite", "")
            
            try:
                with open(consolidated_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Analyze source distribution
                source_distribution = defaultdict(int)
                total_provenances = 0
                total_sentences = 0
                
                for item in data:
                    question_id = list(item.keys())[0]
                    question_data = item[question_id]
                    
                    source = question_data.get('source_info', {}).get('selected_from', 'unknown')
                    source_distribution[source] += 1
                    
                    sentence_count = question_data.get('source_info', {}).get('sentence_count', 0)
                    if sentence_count != 999999:
                        total_sentences += sentence_count
                    
                    prov_count = len(question_data.get('provenance', []))
                    total_provenances += prov_count
                
                summary_data['documents'].append({
                    'document_name': document_name,
                    'filename': consolidated_file.name,
                    'question_count': len(data),
                    'total_provenances': total_provenances,
                    'total_sentences': total_sentences,
                    'avg_sentences_per_question': round(total_sentences / len(data), 2) if data else 0,
                    'source_distribution': dict(source_distribution),
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
        logger.info("\n" + "="*70)
        logger.info("📊 ENHANCED CONSOLIDATION COMPLETE")
        logger.info("="*70)
        logger.info(f"Documents processed: {self.stats['documents_processed']}")
        logger.info(f"Documents skipped: {self.stats['documents_skipped']}")
        logger.info(f"Total questions consolidated: {self.stats['total_questions']}")
        logger.info(f"Unique provenance IDs assigned: {self.stats['unique_provenances_assigned']}")
        logger.info(f"Successful consolidations: {self.stats['successful_consolidations']}")
        logger.info(f"Failed consolidations: {self.stats['failed_consolidations']}")
        
        # Show selection statistics
        if self.stats['provenance_selections']:
            logger.info(f"\n📈 Provenance Selection Reasons:")
            for reason, count in self.stats['provenance_selections'].items():
                logger.info(f"  {reason}: {count}")
        
        success_rate = (self.stats['successful_consolidations'] / 
                       max(self.stats['successful_consolidations'] + self.stats['failed_consolidations'], 1)) * 100
        logger.info(f"\nSuccess rate: {success_rate:.1f}%")
        
        logger.info(f"\n📁 Output directory: {self.output_dir.absolute()}")
        logger.info("🎯 Enhanced consolidated files ready for use!")
        
        # List created files
        consolidated_files = list(self.output_dir.glob("*_test_suite.json"))
        if consolidated_files:
            logger.info(f"\n📋 Created {len(consolidated_files)} consolidated files:")
            for i, file_path in enumerate(consolidated_files, 1):
                file_size = round(file_path.stat().st_size / 1024, 2)
                logger.info(f"  {i}. {file_path.name} ({file_size} KB)")


def main():
    parser = argparse.ArgumentParser(description="Consolidate test suite files")
    parser.add_argument("--input-dirs", nargs='+', 
                       default=["test_outputs", "test_outputs_prev", "test_outputs_prev1"],
                       help="Input directories containing test outputs")
    parser.add_argument("--output-dir", default="consolidated_test_suite",
                       help="Output directory for consolidated files")
    parser.add_argument("--verbose", action="store_true",
                       help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Create consolidator and run
    consolidator = TestSuiteConsolidator(
        input_dirs=args.input_dirs,
        output_dir=args.output_dir
    )
    
    try:
        consolidator.consolidate_all()
        
            
    except KeyboardInterrupt:
        logger.info("\n🛑 Consolidation interrupted by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        raise


if __name__ == "__main__":
    main()