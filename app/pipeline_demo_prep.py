"""
Pipeline orchestrator for processing PVC sample documents.
Handles the nested directory structure and coordinates all processing steps.
"""

import os
import sys
import json
import glob
import subprocess
from pathlib import Path
from typing import List, Dict, Tuple
import argparse
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class PVCPipeline:
    def __init__(self, download_dir: str, base_output_dir: str = None):
        """
        Initialize the PVC processing pipeline.
        
        Args:
            download_dir: Path to DOWNLOAD_DIR/pvc-sample/
            base_output_dir: Base directory for all outputs (defaults to current working directory)
        """
        self.download_dir = Path(download_dir)
        self.base_output_dir = Path(base_output_dir) if base_output_dir else Path.cwd()
        
        # Create output directories
        self.sentences_dir = self.base_output_dir / "SENTENCES_DIR"
        self.mappings_dir = self.base_output_dir / "sentence_page_mappings"
        self.questions_dir = self.base_output_dir / "questions_extract"
        self.test_suite_dir = self.base_output_dir / "consolidated_test_suite"
        
        # Create all output directories
        for dir_path in [self.sentences_dir, self.mappings_dir, self.questions_dir, self.test_suite_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
            
        logger.info(f"Pipeline initialized with download_dir: {self.download_dir}")
        logger.info(f"Output directories created under: {self.base_output_dir}")
    
    def discover_pdfs(self) -> List[Tuple[str, str, str]]:
        """
        Discover all PDFs in the nested directory structure.
        
        Returns:
            List of tuples: (provisional_case_name, hash, full_pdf_path)
        """
        pdfs = []
        
        # Walk through provisional_case_name directories
        for case_dir in self.download_dir.iterdir():
            if not case_dir.is_dir():
                continue
                
            provisional_case_name = case_dir.name
            logger.info(f"Processing case directory: {provisional_case_name}")
            
            # Find all PDFs in this case directory
            pdf_files = list(case_dir.glob("*.pdf"))
            
            for pdf_path in pdf_files:
                # Extract hash from filename (assuming format: <hash>.pdf)
                hash_name = pdf_path.stem
                
                # Verify metadata file exists
                metadata_path = case_dir / f"{hash_name}_metadata.json"
                if not metadata_path.exists():
                    logger.warning(f"Missing metadata for {pdf_path}, skipping...")
                    continue
                
                pdfs.append((provisional_case_name, hash_name, str(pdf_path)))
                logger.debug(f"Found PDF: {provisional_case_name}/{hash_name}")
        
        logger.info(f"Discovered {len(pdfs)} PDFs total")
        return pdfs
    
    def run_sentence_extraction(self, pdf_path: str, hash_name: str) -> bool:
        """
        Run sentence extraction for a single PDF.
        
        Args:
            pdf_path: Full path to the PDF
            hash_name: Hash identifier for output files
            
        Returns:
            True if successful, False otherwise
        """
        output_path = self.sentences_dir / f"{hash_name}_sentences.json"
        
        if output_path.exists():
            logger.info(f"Sentences already extracted for {hash_name}, skipping...")
            return True
        
        try:
            # Assuming you have a sentence extraction script
            # Modify this command based on your actual script
            cmd = [
                sys.executable, "extract_sentences.py",
                "--pdf_path", pdf_path,
                "--output_path", str(output_path)
            ]
            
            logger.info(f"Extracting sentences for {hash_name}...")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully extracted sentences for {hash_name}")
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Sentence extraction failed for {hash_name}: {e}")
            logger.error(f"STDERR: {e.stderr}")
            return False
    
    def run_sentence_mapping(self, pdf_path: str, hash_name: str) -> bool:
        """
        Run sentence-to-page mapping for a single PDF.
        
        Args:
            pdf_path: Full path to the PDF
            hash_name: Hash identifier for files
            
        Returns:
            True if successful, False otherwise
        """
        sentences_path = self.sentences_dir / f"{hash_name}_sentences.json"
        output_path = self.mappings_dir / f"{hash_name}_sentence_page_mappings.json"
        
        if not sentences_path.exists():
            logger.error(f"Sentences file not found for {hash_name}, cannot create mapping")
            return False
            
        if output_path.exists():
            logger.info(f"Sentence mappings already exist for {hash_name}, skipping...")
            return True
        
        try:
            # Assuming you have a mapping script
            cmd = [
                sys.executable, "create_sentence_mappings.py",
                "--pdf_path", pdf_path,
                "--sentences_path", str(sentences_path),
                "--output_path", str(output_path)
            ]
            
            logger.info(f"Creating sentence mappings for {hash_name}...")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully created sentence mappings for {hash_name}")
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Sentence mapping failed for {hash_name}: {e}")
            logger.error(f"STDERR: {e.stderr}")
            return False
    
    def run_question_generation(self, pdf_path: str, hash_name: str, flask_url: str = "http://localhost:5000") -> bool:
        """
        Generate questions using Flask API (requires running Flask instance).
        
        Args:
            pdf_path: Full path to the PDF
            hash_name: Hash identifier for files
            flask_url: Base URL for Flask API
            
        Returns:
            True if successful, False otherwise
        """
        sentences_path = self.sentences_dir / f"{hash_name}_sentences.json"
        output_path = self.questions_dir / f"{hash_name}_questions.json"
        
        if not sentences_path.exists():
            logger.error(f"Sentences file not found for {hash_name}, cannot generate questions")
            return False
            
        if output_path.exists():
            logger.info(f"Questions already generated for {hash_name}, skipping...")
            return True
        
        try:
            # Assuming you have a question generation script that calls Flask API
            cmd = [
                sys.executable, "generate_questions.py",
                "--pdf_path", pdf_path,
                "--sentences_path", str(sentences_path),
                "--output_path", str(output_path),
                "--flask_url", flask_url
            ]
            
            logger.info(f"Generating questions for {hash_name}...")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully generated questions for {hash_name}")
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Question generation failed for {hash_name}: {e}")
            logger.error(f"STDERR: {e.stderr}")
            return False
    
    def run_test_suite_generation(self, pdf_path: str, hash_name: str, flask_url: str = "http://localhost:5000") -> bool:
        """
        Generate test suite using Flask API.
        
        Args:
            pdf_path: Full path to the PDF
            hash_name: Hash identifier for files
            flask_url: Base URL for Flask API
            
        Returns:
            True if successful, False otherwise
        """
        questions_path = self.questions_dir / f"{hash_name}_questions.json"
        mappings_path = self.mappings_dir / f"{hash_name}_sentence_page_mappings.json"
        output_path = self.test_suite_dir / f"{hash_name}_test_suite.json"
        
        if not questions_path.exists():
            logger.error(f"Questions file not found for {hash_name}, cannot generate test suite")
            return False
            
        if output_path.exists():
            logger.info(f"Test suite already exists for {hash_name}, skipping...")
            return True
        
        try:
            # Assuming you have generate_test_suite.py script
            cmd = [
                sys.executable, "generate_test_suite.py",
                "--pdf_path", pdf_path,
                "--questions_path", str(questions_path),
                "--mappings_path", str(mappings_path),
                "--output_path", str(output_path),
                "--flask_url", flask_url
            ]
            
            logger.info(f"Generating test suite for {hash_name}...")
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            logger.info(f"Successfully generated test suite for {hash_name}")
            return True
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Test suite generation failed for {hash_name}: {e}")
            logger.error(f"STDERR: {e.stderr}")
            return False
    
    def consolidate_test_suite(self, hash_name: str) -> bool:
        """
        Consolidate all generated data into final test suite (offline step).
        
        Args:
            hash_name: Hash identifier for files
            
        Returns:
            True if successful, False otherwise
        """
        # This would be your consolidation logic
        # For now, just a placeholder
        logger.info(f"Consolidating test suite for {hash_name}...")
        
        # Check if all required files exist
        required_files = [
            self.sentences_dir / f"{hash_name}_sentences.json",
            self.mappings_dir / f"{hash_name}_sentence_page_mappings.json",
            self.questions_dir / f"{hash_name}_questions.json"
        ]
        
        for file_path in required_files:
            if not file_path.exists():
                logger.error(f"Required file missing for consolidation: {file_path}")
                return False
        
        # Your consolidation logic would go here
        # For now, we'll just mark it as successful
        return True
    
    def run_pipeline(self, steps: List[str] = None, flask_url: str = "http://localhost:5000", 
                    max_documents: int = None, provisional_case_filter: str = None):
        """
        Run the complete pipeline or specified steps.
        
        Args:
            steps: List of steps to run. If None, runs all steps.
                  Options: ['extract', 'mapping', 'questions', 'test_suite', 'consolidate']
            flask_url: URL for Flask API
            max_documents: Maximum number of documents to process (for testing)
            provisional_case_filter: Only process documents from this case name
        """
        if steps is None:
            steps = ['extract', 'mapping', 'questions', 'test_suite', 'consolidate']
        
        logger.info(f"Starting pipeline with steps: {steps}")
        
        # Discover PDFs
        pdfs = self.discover_pdfs()
        
        # Apply filters
        if provisional_case_filter:
            pdfs = [(case, hash_name, path) for case, hash_name, path in pdfs if case == provisional_case_filter]
            logger.info(f"Filtered to {len(pdfs)} PDFs for case: {provisional_case_filter}")
        
        if max_documents:
            pdfs = pdfs[:max_documents]
            logger.info(f"Limited to {len(pdfs)} PDFs for testing")
        
        # Process each PDF
        for i, (provisional_case_name, hash_name, pdf_path) in enumerate(pdfs, 1):
            logger.info(f"Processing {i}/{len(pdfs)}: {provisional_case_name}/{hash_name}")
            
            success = True
            
            # Step 1: Extract sentences
            if 'extract' in steps:
                success &= self.run_sentence_extraction(pdf_path, hash_name)
            
            # Step 2: Create sentence mappings
            if 'mapping' in steps and success:
                success &= self.run_sentence_mapping(pdf_path, hash_name)
            
            # Step 3: Generate questions (requires Flask)
            if 'questions' in steps and success:
                success &= self.run_question_generation(pdf_path, hash_name, flask_url)
            
            # Step 4: Generate test suite (requires Flask)
            if 'test_suite' in steps and success:
                success &= self.run_test_suite_generation(pdf_path, hash_name, flask_url)
            
            # Step 5: Consolidate (offline)
            if 'consolidate' in steps and success:
                success &= self.consolidate_test_suite(hash_name)
            
            if success:
                logger.info(f"Successfully processed: {provisional_case_name}/{hash_name}")
            else:
                logger.error(f"Failed to process: {provisional_case_name}/{hash_name}")
        
        logger.info("Pipeline execution completed!")


def main():
    parser = argparse.ArgumentParser(description="PVC Document Processing Pipeline")
    parser.add_argument("download_dir", help="Path to DOWNLOAD_DIR/pvc-sample/")
    parser.add_argument("--output_dir", help="Base output directory (default: current directory)")
    parser.add_argument("--steps", nargs="+", 
                       choices=['extract', 'mapping', 'questions', 'test_suite', 'consolidate'],
                       help="Pipeline steps to run (default: all)")
    parser.add_argument("--flask_url", default="http://localhost:5000", 
                       help="Flask API URL")
    parser.add_argument("--max_docs", type=int, 
                       help="Maximum number of documents to process (for testing)")
    parser.add_argument("--case_filter", 
                       help="Only process documents from this provisional case name")
    parser.add_argument("--verbose", "-v", action="store_true", 
                       help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Initialize and run pipeline
    pipeline = PVCPipeline(args.download_dir, args.output_dir)
    pipeline.run_pipeline(
        steps=args.steps,
        flask_url=args.flask_url,
        max_documents=args.max_docs,
        provisional_case_filter=args.case_filter
    )


if __name__ == "__main__":
    main()