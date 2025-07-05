#!/usr/bin/env python3
"""
Mapping Pipeline Integration Script
Integrates the PDF mapping generator with your existing document processing pipeline
"""

import os
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional
import argparse
import logging
from pdfminer_to_pdfjs_mapper import PDFMinerToPDFJSMapper
from utils import get_file_finder

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

class DocumentMappingPipeline:
    """Integrates PDF mapping generation with your existing document processing"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.logger = self._setup_logging()
        self.mapping_generator = PDFMinerToPDFJSMapper(verbose=config.get('verbose', True))
        
    def _setup_logging(self) -> logging.Logger:
        logger = logging.getLogger('DocumentMappingPipeline')
        logger.setLevel(logging.DEBUG if self.config.get('verbose') else logging.INFO)
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            
        return logger
    
    def discover_documents(self, sentences_dir: str) -> List[Dict]:
        """Discover all available documents and their associated files"""
        
        self.logger.info(f"Discovering documents in: {sentences_dir}")
        
        # Find all sentence files
        sentences_path = Path(sentences_dir)
        if not sentences_path.exists():
            self.logger.error(f"Sentences directory not found: {sentences_dir}")
            return []
        
        sentence_files = list(sentences_path.glob("*_sentences.json"))
        self.logger.info(f"Found {len(sentence_files)} sentence files")
        
        documents = []
        
        for sentence_file in sentence_files:
            # Extract document name
            doc_name = sentence_file.stem.replace("_sentences", "")
            self.logger.debug(f"Processing document: {doc_name}")
            
            # Find corresponding PDF
            pdf_info = safe_find_file(doc_name, 'pdf')
            
            if pdf_info and os.path.exists(pdf_info['path']):
                documents.append({
                    'doc_name': doc_name,
                    'pdf_path': pdf_info['path'],
                    'sentences_file': str(sentence_file),
                    'pdf_size_mb': os.path.getsize(pdf_info['path']) / (1024 * 1024)
                })
                self.logger.debug(f"✅ Found PDF for {doc_name}: {pdf_info['path']}")
            else:
                self.logger.warning(f"❌ No PDF found for {doc_name}")
        
        self.logger.info(f"Discovered {len(documents)} complete document sets")
        return documents
    
    def process_all_documents(self, sentences_dir: str) -> bool:
        """Process all discovered documents"""
        
        documents = self.discover_documents(sentences_dir)
        
        if not documents:
            self.logger.error("No documents found to process")
            return False
        
        # Create output directory
        mappings_dir = Path(self.config['mappings_output_dir'])
        mappings_dir.mkdir(parents=True, exist_ok=True)
        
        success_count = 0
        total_documents = len(documents)
        
        self.logger.info(f"Processing {total_documents} documents...")
        
        for i, doc_info in enumerate(documents, 1):
            self.logger.info(f"\n📄 Processing document {i}/{total_documents}: {doc_info['doc_name']}")
            self.logger.info(f"   PDF: {doc_info['pdf_path']} ({doc_info['pdf_size_mb']:.1f} MB)")
            self.logger.info(f"   Sentences: {doc_info['sentences_file']}")
            
            try:
                success = self.process_single_document(
                    doc_info['pdf_path'],
                    doc_info['sentences_file'],
                    doc_info['doc_name']
                )
                
                if success:
                    success_count += 1
                    self.logger.info(f"✅ Successfully processed {doc_info['doc_name']}")
                else:
                    self.logger.error(f"❌ Failed to process {doc_info['doc_name']}")
                    
            except Exception as e:
                self.logger.error(f"❌ Exception processing {doc_info['doc_name']}: {e}")
                import traceback
                self.logger.debug(f"Traceback: {traceback.format_exc()}")
        
        self.logger.info(f"\n🎉 Pipeline completed: {success_count}/{total_documents} documents processed successfully")
        
        if success_count > 0:
            self.setup_frontend_integration()
        
        return success_count > 0
    
    def process_single_document(self, pdf_path: str, sentences_file: str, doc_name: str) -> bool:
        """Process a single document using the enhanced mapper"""
        
        try:
            # Load sentences
            self.logger.debug(f"Loading sentences from: {sentences_file}")
            with open(sentences_file, 'r', encoding='utf-8') as f:
                sentences_data = json.load(f)
            
            # Handle different sentence file formats
            if isinstance(sentences_data, list):
                sentences = sentences_data
            elif isinstance(sentences_data, dict) and 'sentences' in sentences_data:
                sentences = sentences_data['sentences']
            else:
                self.logger.error(f"Unknown sentences format in {sentences_file}")
                return False
            
            # Convert sentences to strings if they're dictionaries
            processed_sentences = []
            for sentence in sentences:
                if isinstance(sentence, dict):
                    text = sentence.get('text', str(sentence))
                else:
                    text = str(sentence)
                processed_sentences.append(text.strip())
            
            self.logger.info(f"Loaded {len(processed_sentences)} sentences")
            
            # Extract PDF.js content
            self.logger.debug("Extracting PDF.js content...")
            pdfjs_data = self._extract_pdfjs_content(pdf_path)
            
            if not pdfjs_data:
                self.logger.error("Failed to extract PDF.js content")
                return False
            
            self.logger.info(f"Extracted PDF.js content: {len(pdfjs_data)} pages")
            
            # Create mappings using the enhanced mapper
            self.logger.info("Creating enhanced mappings with improved multi-line support...")
            page_mappings = self.mapping_generator.create_full_document_mapping(
                pdf_path,
                processed_sentences,
                pdfjs_data
            )
            
            if not page_mappings:
                self.logger.error("Failed to create mappings")
                return False
            
            # Save mappings
            mappings_dir = Path(self.config['mappings_output_dir'])
            output_file = mappings_dir / f"{doc_name}_mappings.json"
            
            self._save_mappings(page_mappings, str(output_file), doc_name)
            
            # Copy to public directory
            public_mapping_file = Path("public") / "mappings" / f"{doc_name}_mappings.json"
            public_mapping_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(output_file, public_mapping_file)
            
            self.logger.debug(f"Mapping file copied to: {public_mapping_file}")
            
            # Validate the generated mapping
            self._validate_mapping(str(public_mapping_file), doc_name)
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to process {doc_name}: {e}")
            import traceback
            self.logger.debug(f"Traceback: {traceback.format_exc()}")
            return False
    
    def _extract_pdfjs_content(self, pdf_path: str) -> Optional[List[Dict]]:
        """Extract PDF.js content using the Node.js script"""
        
        try:
            # Check if we have a Node.js workspace
            workspace_dir = Path(os.path.join(os.getcwd(), "pdf_processing_workspace"))
            
            if workspace_dir.exists() and (workspace_dir / "extract_pdf.js").exists():
                # Use workspace script
                script_path = workspace_dir / "extract_pdf.js"
                
                result = subprocess.run([
                    'node', str(script_path), pdf_path
                ], cwd=workspace_dir, capture_output=True, text=True, 
                    encoding='utf-8', errors='replace', timeout=120)
                
            else:
                # Use inline script
                self.logger.debug("Using inline PDF.js extraction script")
                inline_script = self._create_inline_extraction_script()
                
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
                self.logger.error(f"STDERR: {result.stderr}")
                return None
            
            if not result.stdout or not result.stdout.strip():
                self.logger.error("PDF.js extraction returned empty output")
                return None
            
            # Parse the JSON output
            try:
                pdfjs_data = json.loads(result.stdout)
                self.logger.info(f"✅ Extracted {len(pdfjs_data)} pages from PDF.js")
                return pdfjs_data
                
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse PDF.js output: {e}")
                # Try to find JSON start
                lines = result.stdout.split('\n')
                for i, line in enumerate(lines):
                    if line.strip().startswith('['):
                        try:
                            json_part = '\n'.join(lines[i:])
                            pdfjs_data = json.loads(json_part)
                            self.logger.info(f"✅ Successfully parsed PDF.js output from line {i}")
                            return pdfjs_data
                        except json.JSONDecodeError:
                            continue
                return None
                
        except subprocess.TimeoutExpired:
            self.logger.error("PDF.js extraction timed out after 120 seconds")
            return None
        except Exception as e:
            self.logger.error(f"Failed to extract PDF.js content: {e}")
            return None
    
    def _create_inline_extraction_script(self) -> str:
        """Create inline Node.js script for PDF.js extraction"""
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
    
    def _save_mappings(self, mappings: Dict, output_file: str, doc_name: str) -> None:
        """Save mappings with enhanced metadata"""
        
        try:
            # Add generation metadata
            enhanced_mappings = {
                **mappings,
                '_metadata': {
                    'document_name': doc_name,
                    'generated_at': json.dumps(None, default=str),
                    'generator': 'PDFMinerToPDFJSMapper',
                    'version': '2.0',
                    'features': [
                        'multi_line_text_support',
                        'enhanced_bounding_boxes',
                        'fuzzy_text_matching',
                        'coordinate_transformation'
                    ],
                    'coordinate_system': 'pdfminer',
                    'total_pages': len([k for k in mappings.keys() if k != '_metadata']),
                    'total_sentences': sum(len(page) for page in mappings.values() if isinstance(page, dict))
                }
            }
            
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(enhanced_mappings, f, indent=2, ensure_ascii=False)
            
            file_size = os.path.getsize(output_file)
            self.logger.info(f"💾 Saved mappings to {output_file} ({file_size:,} bytes)")
            
        except Exception as e:
            self.logger.error(f"Failed to save mappings: {e}")
            raise
    
    def _validate_mapping(self, mapping_file: str, doc_name: str) -> None:
        """Enhanced mapping validation"""
        
        try:
            with open(mapping_file, 'r', encoding='utf-8') as f:
                mappings = json.load(f)
            
            # Remove metadata for validation
            if '_metadata' in mappings:
                metadata = mappings.pop('_metadata')
                self.logger.debug(f"Mapping metadata: {metadata}")
            
            total_sentences = 0
            successful_mappings = 0
            total_regions = 0
            multi_line_regions = 0
            
            for page_num, page_mappings in mappings.items():
                if not isinstance(page_mappings, dict):
                    continue
                
                for sentence_id, sentence_mapping in page_mappings.items():
                    total_sentences += 1
                    
                    highlight_regions = sentence_mapping.get('highlight_regions', [])
                    
                    if highlight_regions:
                        valid_regions = 0
                        for region in highlight_regions:
                            if all(key in region for key in ['page', 'left', 'top', 'width', 'height']):
                                valid_regions += 1
                                
                                # Check for multi-line regions (enhanced feature)
                                if region.get('match_type', '').endswith('_multiline'):
                                    multi_line_regions += 1
                        
                        if valid_regions > 0:
                            successful_mappings += 1
                            total_regions += valid_regions
            
            success_rate = successful_mappings / total_sentences if total_sentences > 0 else 0
            
            self.logger.info(f"📊 Mapping validation for {doc_name}:")
            self.logger.info(f"   Total sentences: {total_sentences}")
            self.logger.info(f"   Successfully mapped: {successful_mappings} ({success_rate:.1%})")
            self.logger.info(f"   Total highlight regions: {total_regions}")
            self.logger.info(f"   Multi-line regions: {multi_line_regions}")
            
            if success_rate >= 0.8:
                self.logger.info(f"✅ Excellent mapping quality: {success_rate:.1%}")
            elif success_rate >= 0.6:
                self.logger.info(f"⚠️ Good mapping quality: {success_rate:.1%}")
            else:
                self.logger.warning(f"❌ Low mapping quality: {success_rate:.1%}")
            
        except Exception as e:
            self.logger.error(f"Failed to validate mapping for {doc_name}: {e}")
    
    def setup_frontend_integration(self) -> None:
        """Set up frontend integration files"""
        
        try:
            public_mappings_dir = Path("public") / "mappings"
            public_mappings_dir.mkdir(parents=True, exist_ok=True)
            
            # Create index file
            mapping_files = list(public_mappings_dir.glob("*_mappings.json"))
            
            mappings_index = {
                "available_documents": [],
                "generation_timestamp": json.dumps(None, default=str),
                "total_mappings": len(mapping_files),
                "generator": "EnhancedDocumentMappingPipeline",
                "features": [
                    "multi_line_text_support",
                    "enhanced_bounding_boxes",
                    "pdfminer_coordinate_system"
                ]
            }
            
            for mapping_file in mapping_files:
                doc_name = mapping_file.stem.replace("_mappings", "")
                
                # Try to find PDF info
                pdf_info = safe_find_file(doc_name, 'pdf')
                
                # Load mapping stats
                try:
                    with open(mapping_file, 'r', encoding='utf-8') as f:
                        mapping_data = json.load(f)
                    
                    metadata = mapping_data.get('_metadata', {})
                    
                    mappings_index["available_documents"].append({
                        "document_id": doc_name,
                        "mapping_file": f"{mapping_file.name}",
                        "pdf_file": pdf_info['path'] if pdf_info else None,
                        "total_pages": metadata.get('total_pages', 0),
                        "total_sentences": metadata.get('total_sentences', 0),
                        "features": metadata.get('features', [])
                    })
                    
                except Exception as e:
                    self.logger.warning(f"Could not load metadata for {doc_name}: {e}")
                    mappings_index["available_documents"].append({
                        "document_id": doc_name,
                        "mapping_file": f"{mapping_file.name}",
                        "pdf_file": pdf_info['path'] if pdf_info else None
                    })
            
            # Save index
            index_file = public_mappings_dir / "index.json"
            with open(index_file, 'w') as f:
                json.dump(mappings_index, f, indent=2)
            
            self.logger.info(f"📋 Created mappings index: {index_file}")
            self.logger.info(f"   {len(mapping_files)} mappings available for frontend")
            
        except Exception as e:
            self.logger.error(f"Failed to setup frontend integration: {e}")


    
   


def main():
    parser = argparse.ArgumentParser(description='Generate PDF mappings for document highlighting')
    parser.add_argument('--mappings-dir', default='mappings',
                       help='Output directory for mapping files')
    parser.add_argument('--verbose', action='store_true',
                       help='Enable verbose logging')
    parser.add_argument('--setup-frontend', action='store_true',
                       help='Set up frontend integration files')
    
    args = parser.parse_args()
    
    config = {
        'mappings_output_dir': args.mappings_dir,
        'verbose': args.verbose
    }
    
    pipeline = DocumentMappingPipeline(config)
    
    if args.setup_frontend:
        pipeline.setup_frontend_integration()
        return
    
    # Process test documents
    sentences_dir = os.path.join(os.getcwd(), "sentences")
    success = pipeline.process_all_documents(sentences_dir)
    
    if success:
        print("✅ Pipeline completed successfully!")
        print("\nNext steps:")
        print("1. Run with --setup-frontend to create integration files")
        print("2. Add the suggested routes to your Flask backend")
        print("3. Use the PDFHighlighter React component in your frontend")
        print("4. Test highlighting with your prepared questions")
    else:
        print("❌ Pipeline failed!")
        return 1

if __name__ == "__main__":
    exit(main())