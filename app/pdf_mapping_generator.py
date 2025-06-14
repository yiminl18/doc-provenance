#!/usr/bin/env python3
"""
Fixed PDF Mapping Pipeline - Handles Node.js dependencies properly
"""

import os
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict
import argparse
import logging

class FixedPDFMappingGenerator:
    """Fixed version that properly handles Node.js dependencies"""
    
    def __init__(self, verbose: bool = True):
        self.logger = self._setup_logging(verbose)
        self.nodejs_workspace = None
        self.setup_nodejs_workspace()
        
    def _setup_logging(self, verbose: bool) -> logging.Logger:
        logger = logging.getLogger('FixedPDFMappingGenerator')
        logger.setLevel(logging.DEBUG if verbose else logging.INFO)
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            
        return logger

    def setup_nodejs_workspace(self):
        """Create a dedicated Node.js workspace with pdfjs-dist installed"""
        try:
            # Create workspace directory
            workspace_dir = Path("pdf_processing_workspace")
            workspace_dir.mkdir(exist_ok=True)
            
            self.nodejs_workspace = workspace_dir.absolute()
            self.logger.info(f"Node.js workspace: {self.nodejs_workspace}")
            
            # Create package.json if it doesn't exist
            package_json_path = self.nodejs_workspace / "package.json"
            if not package_json_path.exists():
                package_json = {
                    "name": "pdf-mapping-generator",
                    "version": "1.0.0",
                    "description": "PDF text extraction for mapping generation",
                    "main": "extract_pdf.js",
                    "dependencies": {
                        "pdfjs-dist": "^3.11.174"
                    }
                }
                
                with open(package_json_path, 'w') as f:
                    json.dump(package_json, f, indent=2)
                self.logger.info("Created package.json")
            
            # Check if node_modules exists and has pdfjs-dist
            node_modules_path = self.nodejs_workspace / "node_modules" / "pdfjs-dist"
            
            if not node_modules_path.exists():
                self.logger.info("Installing pdfjs-dist in workspace...")
                
                # Run npm install in the workspace
                result = subprocess.run([
                    'npm', 'install'
                ], cwd=self.nodejs_workspace, capture_output=True, text=True)
                
                if result.returncode != 0:
                    self.logger.error(f"npm install failed: {result.stderr}")
                    
                    # Try alternative installation methods
                    self.logger.info("Trying alternative installation...")
                    
                    # Try yarn if available
                    yarn_result = subprocess.run([
                        'yarn', 'add', 'pdfjs-dist@3.11.174'
                    ], cwd=self.nodejs_workspace, capture_output=True, text=True)
                    
                    if yarn_result.returncode != 0:
                        # Final fallback: try global installation check
                        self.logger.warning("Local installation failed, checking global installation...")
                        return self.check_global_pdfjs()
                else:
                    self.logger.info("✅ pdfjs-dist installed successfully")
            else:
                self.logger.info("✅ pdfjs-dist already available in workspace")
            
            # Create the extraction script
            self.create_extraction_script()
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to setup Node.js workspace: {e}")
            return self.check_global_pdfjs()

    def check_global_pdfjs(self):
        """Check if pdfjs-dist is available globally"""
        try:
            result = subprocess.run([
                'node', '-e', 'require("pdfjs-dist"); console.log("OK");'
            ], capture_output=True, text=True)
            
            if result.returncode == 0:
                self.logger.info("✅ Found global pdfjs-dist installation")
                self.nodejs_workspace = None  # Use global
                return True
            else:
                self.logger.error("❌ pdfjs-dist not found globally or locally")
                self.logger.error("Please install it with: npm install -g pdfjs-dist")
                return False
                
        except Exception as e:
            self.logger.error(f"Failed to check global pdfjs-dist: {e}")
            return False

    def create_extraction_script(self):
        """Create the PDF.js extraction script in the workspace"""
        if not self.nodejs_workspace:
            return  # Using global installation
            
        script_path = self.nodejs_workspace / "extract_pdf.js"
        
        script_content = '''
const fs = require('fs');
const path = require('path');

// Import pdfjs-dist from the local node_modules
const pdfjsLib = require('pdfjs-dist/build/pdf');

// Disable workers for Node.js environment
pdfjsLib.GlobalWorkerOptions.workerSrc = null;

async function extractTextContent(pdfPath) {
    try {
        // Validate input file
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found: ${pdfPath}`);
        }
        
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        
        // Load PDF document
        const pdf = await pdfjsLib.getDocument({ 
            data,
            verbosity: 0  // Reduce console output
        }).promise;
        
        const pages = [];
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            try {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                // Process text items
                const items = textContent.items.map(item => {
                    // Ensure all required properties exist
                    return {
                        str: item.str || '',
                        dir: item.dir || 'ltr',
                        width: item.width || 0,
                        height: item.height || 0,
                        transform: item.transform || [1, 0, 0, 1, 0, 0],
                        fontName: item.fontName || 'default',
                        hasEOL: item.hasEOL || false
                    };
                });
                
                pages.push({
                    pageNumber: pageNum,
                    items: items
                });
                
                // Progress indicator for large PDFs
                if (pdf.numPages > 5 && pageNum % 5 === 0) {
                    console.error(`Processed ${pageNum}/${pdf.numPages} pages...`);
                }
                
            } catch (pageError) {
                console.error(`Error processing page ${pageNum}: ${pageError.message}`);
                // Add empty page to maintain page numbering
                pages.push({
                    pageNumber: pageNum,
                    items: [],
                    error: pageError.message
                });
            }
        }
        
        // Output results as JSON
        console.log(JSON.stringify(pages));
        
    } catch (error) {
        console.error(`PDF extraction failed: ${error.message}`);
        process.exit(1);
    }
}

// Get PDF path from command line arguments
const pdfPath = process.argv[2];
if (!pdfPath) {
    console.error('Usage: node extract_pdf.js <pdf_path>');
    process.exit(1);
}

// Resolve absolute path
const absolutePdfPath = path.resolve(pdfPath);
console.error(`Extracting text from: ${absolutePdfPath}`);

extractTextContent(absolutePdfPath);
'''
        
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
        
        self.logger.info(f"Created extraction script: {script_path}")

    def extract_pdfjs_content(self, pdf_path: str) -> Optional[List[List[Dict]]]:
        """
        Extract text content using PDF.js with proper dependency handling
        """
        try:
            pdf_path = os.path.abspath(pdf_path)
            
            if not os.path.exists(pdf_path):
                self.logger.error(f"PDF file not found: {pdf_path}")
                return None
            
            self.logger.info(f"Extracting PDF.js content from: {pdf_path}")
            
            if self.nodejs_workspace:
                # Use workspace-based extraction
                script_path = self.nodejs_workspace / "extract_pdf.js"
                
                result = subprocess.run([
                    'node', str(script_path), pdf_path
                ], cwd=self.nodejs_workspace, capture_output=True, text=True, 
                    encoding='utf-8', errors='replace', timeout=120)
                
            else:
                # Use global installation with inline script
                inline_script = self.create_inline_script()
                
                with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as temp_script:
                    temp_script.write(inline_script)
                    temp_script_path = temp_script.name
                
                try:
                    result = subprocess.run([
                    'node', temp_script_path, pdf_path
                ], capture_output=True, text=True, 
                   encoding='utf-8', errors='replace', timeout=120)
                finally:
                    os.unlink(temp_script_path)
            
            if result.returncode != 0:
                self.logger.error(f"PDF.js extraction failed:")
                self.logger.error(f"STDOUT: {result.stdout}")
                self.logger.error(f"STDERR: {result.stderr}")
                return None

            # Additional safety check for empty output
            if not result.stdout or not result.stdout.strip():
                self.logger.error("PDF.js extraction returned empty output")
                return None
            
            # Parse the JSON output
            try:
                pdfjs_data = json.loads(result.stdout)
                # Validate the structure
                if not isinstance(pdfjs_data, list):
                    self.logger.error(f"Invalid PDF.js output format: expected list, got {type(pdfjs_data)}")
                    return None
                
                self.logger.info(f"✅ Extracted {len(pdfjs_data)} pages from PDF.js")
                return pdfjs_data
                
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse PDF.js output: {e}")
                self.logger.error(f"Raw output (first 500 chars): {result.stdout[:500]}...")

                # Try to find where the JSON might start (in case there's extra output)
                stdout_lines = result.stdout.split('\n')
                for i, line in enumerate(stdout_lines):
                    if line.strip().startswith('['):
                        try:
                            # Try parsing from this line onwards
                            json_part = '\n'.join(stdout_lines[i:])
                            pdfjs_data = json.loads(json_part)
                            self.logger.info(f"✅ Successfully parsed PDF.js output starting from line {i}")
                            return pdfjs_data
                        except json.JSONDecodeError:
                            continue
                        
                return None
                
        except subprocess.TimeoutExpired:
            self.logger.error("PDF.js extraction timed out after 120 seconds")
            return None
        except UnicodeDecodeError as unicode_error:
            self.logger.error(f"Unicode encoding error in PDF.js extraction: {unicode_error}")
            self.logger.error("This typically means the PDF contains characters that can't be encoded in the system's default encoding")
            return None
        except Exception as e:
            self.logger.error(f"Failed to extract PDF.js content: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return None

    def create_inline_script(self) -> str:
        """Create inline script for global pdfjs-dist usage"""
        return '''
const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/build/pdf');

pdfjsLib.GlobalWorkerOptions.workerSrc = null;

async function extractTextContent(pdfPath) {
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
                const textContent = await page.getTextContent();
                
                pages.push({
                    pageNumber: pageNum,
                    items: textContent.items.map(item => ({
                        str: item.str || '',
                        dir: item.dir || 'ltr',
                        width: item.width || 0,
                        height: item.height || 0,
                        transform: item.transform || [1, 0, 0, 1, 0, 0],
                        fontName: item.fontName || 'default',
                        hasEOL: item.hasEOL || false
                    }))
                });
                
            } catch (pageError) {
                pages.push({
                    pageNumber: pageNum,
                    items: [],
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

const pdfPath = process.argv[2];
if (!pdfPath) {
    console.error('Usage: node script.js <pdf_path>');
    process.exit(1);
}

extractTextContent(path.resolve(pdfPath));
'''

    def generate_mapping_for_document(self, pdf_path: str, sentences_file: str, output_dir: str) -> bool:
        """
        Generate complete mapping for a PDF document using PDFMiner-style sentences
        """
        try:
            self.logger.info(f"Generating mapping for {pdf_path}")
            
            # Load sentences data - handle your specific format
            with open(sentences_file, 'r', encoding='utf-8') as f:
                sentences_data = json.load(f)
            
            # Extract sentences list based on your format
            if isinstance(sentences_data, list):
                # Direct list of sentences
                sentences_list = sentences_data
            elif isinstance(sentences_data, dict) and 'sentences' in sentences_data:
                # Dictionary with 'sentences' key
                sentences_list = sentences_data['sentences']
            else:
                self.logger.error(f"Unexpected sentences format: {type(sentences_data)}")
                return False
            
            # Handle different sentence formats (string vs dict)
            processed_sentences = []
            for i, sentence in enumerate(sentences_list):
                if isinstance(sentence, dict):
                    # Extract text from dictionary
                    text = sentence.get('text', str(sentence))
                else:
                    # Direct string
                    text = str(sentence)
                
                processed_sentences.append(text.strip())
            
            self.logger.info(f"Loaded {len(processed_sentences)} sentences")
            
            # Extract PDF.js text content
            pdfjs_data = self.extract_pdfjs_content(pdf_path)
            if not pdfjs_data:
                self.logger.error("Failed to extract PDF.js content")
                return False
            
            # Use specialized PDFMiner-to-PDF.js mapper
            from pdfminer_to_pdfjs_mapper import PDFMinerToPDFJSMapper
            
            mapper = PDFMinerToPDFJSMapper(verbose=self.logger.level == logging.DEBUG)
            
            # Create comprehensive mapping
            page_mappings = mapper.create_full_document_mapping(
                pdf_path,
                processed_sentences,
                pdfjs_data
            )
            
            # Save mappings
            doc_name = Path(pdf_path).stem
            output_file = os.path.join(output_dir, f"{doc_name}_mappings.json")
            self._save_mappings(page_mappings, output_file)
            
            # Generate summary stats
            self._log_mapping_stats(page_mappings)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to generate mapping: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            return False

    def _generate_page_mappings(self, page_num: int, sentences_data: Dict, pdfjs_page_data: Dict) -> Dict:
        """Generate mappings for sentences on a specific page"""
        page_mappings = {}
        
        # Handle the case where sentences_data might be a list or have a 'sentences' key
        if isinstance(sentences_data, list):
            sentences_list = sentences_data
        elif 'sentences' in sentences_data:
            sentences_list = sentences_data['sentences']
        else:
            sentences_list = []
        
        # Get sentences that appear on this page
        page_sentences = []
        for sentence in sentences_list:
            if isinstance(sentence, dict):
                # Handle your format with page_spans
                if sentence.get('page_spans') and page_num in sentence['page_spans']:
                    page_sentences.append(sentence)
            else:
                # Handle simple sentence list - for now, assume all appear on all pages
                # You can modify this logic based on your actual data structure
                page_sentences.append({
                    'sentence_id': len(page_sentences),
                    'text': str(sentence),
                    'page_spans': [page_num]
                })
        
        self.logger.info(f"Processing page {page_num} with {len(page_sentences)} sentences")
        
        for sentence in page_sentences:
            sentence_id = sentence.get('sentence_id', sentence.get('id', 0))
            mapping = self._map_sentence_to_pdfjs(sentence, pdfjs_page_data.get('items', []), page_num)
            
            if mapping:
                page_mappings[sentence_id] = mapping
                self.logger.debug(f"Mapped sentence {sentence_id} with confidence {mapping.get('match_confidence', 0):.2f}")
            else:
                self.logger.warning(f"Failed to map sentence {sentence_id}")
        
        return page_mappings

    def _map_sentence_to_pdfjs(self, sentence: Dict, pdfjs_items: List[Dict], page_num: int) -> Optional[Dict]:
        """Map a single sentence to PDF.js text items using robust algorithm"""
        
        # Initialize the robust mapper if not already done
        if not hasattr(self, '_text_mapper'):
            from robust_text_mapper import RobustTextMapper
            self._text_mapper = RobustTextMapper(verbose=self.logger.level == logging.DEBUG)
        
        # Use the robust mapping algorithm
        mapping_result = self._text_mapper.map_sentence_to_pdfjs(sentence, pdfjs_items, page_num)

        # After getting the mapping result, filter to primary page
        if mapping_result and 'highlight_regions' in mapping_result:
            highlight_regions = mapping_result['highlight_regions']

            # Determine primary page (page with most area)
            page_areas = defaultdict(float)
            for region in highlight_regions:
                page = region.get('page')
                area = region.get('width', 0) * region.get('height', 0)
                if page and area > 0:
                    page_areas[page] += area

            if page_areas:
                primary_page = max(page_areas.items(), key=lambda x: x[1])[0]

                # Filter to primary page only
                primary_page_highlights = [
                    region for region in highlight_regions 
                    if region.get('page') == primary_page
                ]

                mapping_result['highlight_regions'] = primary_page_highlights
                mapping_result['primary_page'] = primary_page
                mapping_result['spans_multiple_pages'] = len(set(r.get('page') for r in highlight_regions)) > 1

        return mapping_result

    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        import re
        return re.sub(r'\s+', ' ', text.lower().strip())

    def _save_mappings(self, mappings: Dict, output_file: str) -> None:
        """Save mappings to JSON file with proper encoding"""
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        try:
            # Ensure we save with UTF-8 encoding and handle Unicode properly
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(mappings, f, indent=2, ensure_ascii=False)
            
            self.logger.info(f"Saved mappings to {output_file}")
            
            # Verify the file was written correctly
            file_size = os.path.getsize(output_file)
            self.logger.info(f"Mapping file size: {file_size:,} bytes")
            
        except Exception as e:
            self.logger.error(f"Failed to save mappings: {e}")
            raise

    def _log_mapping_stats(self, mappings: Dict) -> None:
        """Log statistics about the generated mappings"""
        if not mappings:
            self.logger.warning("No mappings generated")
            return
            
        total_pages = len(mappings)
        total_sentences = sum(len(page_mappings) for page_mappings in mappings.values())
        
        # Calculate confidence distribution
        confidence_scores = []
        method_counts = {}
        
        for page_mappings in mappings.values():
            for sentence_mapping in page_mappings.values():
                confidence = sentence_mapping.get('match_confidence', 0)
                confidence_scores.append(confidence)
                
                # Count methods used
                for region in sentence_mapping.get('highlight_regions', []):
                    method = region.get('match_type', 'unknown')
                    method_counts[method] = method_counts.get(method, 0) + 1
        
        if confidence_scores:
            avg_confidence = sum(confidence_scores) / len(confidence_scores)
            high_conf_count = sum(1 for c in confidence_scores if c > 0.8)
            medium_conf_count = sum(1 for c in confidence_scores if 0.6 <= c <= 0.8)
            low_conf_count = sum(1 for c in confidence_scores if c < 0.6)
            
            self.logger.info(f"Mapping Statistics:")
            self.logger.info(f"  Total pages: {total_pages}")
            self.logger.info(f"  Total sentences mapped: {total_sentences}")
            self.logger.info(f"  Average confidence: {avg_confidence:.3f}")
            self.logger.info(f"  High confidence (>0.8): {high_conf_count}")
            self.logger.info(f"  Medium confidence (0.6-0.8): {medium_conf_count}")
            self.logger.info(f"  Low confidence (<0.6): {low_conf_count}")
            self.logger.info(f"  Methods used: {method_counts}")
        else:
            self.logger.warning("No confidence scores available")

def main():
    """CLI interface for the fixed mapping generator"""
    
    parser = argparse.ArgumentParser(description='Generate PDF mappings with proper Node.js setup')
    parser.add_argument('pdf_file', help='Path to PDF file')
    parser.add_argument('sentences_file', help='Path to sentences JSON file')
    parser.add_argument('output_dir', help='Output directory for mappings')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    
    args = parser.parse_args()
    
    # Validate inputs
    if not os.path.exists(args.pdf_file):
        print(f"Error: PDF file not found: {args.pdf_file}")
        return 1
    
    if not os.path.exists(args.sentences_file):
        print(f"Error: Sentences file not found: {args.sentences_file}")
        return 1
    
    # Generate mappings
    generator = FixedPDFMappingGenerator(verbose=args.verbose)
    success = generator.generate_mapping_for_document(
        args.pdf_file, 
        args.sentences_file, 
        args.output_dir
    )
    
    if success:
        print("✅ Mapping generation completed successfully!")
        return 0
    else:
        print("❌ Mapping generation failed!")
        return 1

if __name__ == "__main__":
    exit(main())