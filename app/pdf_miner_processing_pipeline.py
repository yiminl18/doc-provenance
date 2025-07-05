"""
Complete PDF Processing Pipeline
Processes PDFs to create all necessary files for coordinate-based highlighting
"""

import os
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from werkzeug.utils import secure_filename

# Import our new modules
from pdfminer_coord_extraction import EnhancedCoordinateExtractor, extract_and_save_coordinate_data
from pdfjs_coordinate_mapper import PDFJSCoordinateMapper, create_stable_mappings_for_document

class CompletePDFProcessor:
    """
    Complete pipeline for processing PDFs with coordinate-based highlighting
    """
    
    def __init__(self, base_dir: str = None):
        self.base_dir = base_dir or os.getcwd()
        
        # Define directory structure
        self.directories = {
            'uploads': os.path.join(self.base_dir, 'uploads'),
            'sentences': os.path.join(self.base_dir, 'layouts'),
            'pdfminer_coordinate_regions': os.path.join(self.base_dir, 'pdfminer_coordinate_regions'),
            'pdfjs_cache': os.path.join(self.base_dir, 'pdfjs_cache'),
            'stable_mappings': os.path.join(self.base_dir, 'stable_mappings2'),
            'processed_pdfs': os.path.join(self.base_dir, 'processed_pdfs')
        }
        
        # Create directories
        for dir_path in self.directories.values():
            os.makedirs(dir_path, exist_ok=True)
    
    def process_pdf_complete(self, pdf_path: str, force_reprocess: bool = False) -> Dict:
        """
        Complete processing pipeline for a PDF
        """
        pdf_basename = Path(pdf_path).stem
        print(f"🚀 Processing {pdf_basename} through complete pipeline...")
        
        processing_result = {
            'pdf_basename': pdf_basename,
            'pdf_path': pdf_path,
            'success': False,
            'steps_completed': [],
            'files_created': {},
            'errors': [],
            'statistics': {}
        }
        
        try:
            # Step 1: Extract sentences with coordinate regions
            print("📍 Step 1: Extracting sentences with coordinate regions...")
            sentences_file, regions_file = self._process_coordinate_extraction(
                pdf_path, pdf_basename, force_reprocess
            )
            
            processing_result['steps_completed'].append('coordinate_extraction')
            processing_result['files_created']['sentences'] = sentences_file
            processing_result['files_created']['pdfminer_coordinate_regions'] = regions_file
            
            # Step 2: Check for PDF.js cache (required for stable mapping)
            print("🔍 Step 2: Checking PDF.js cache...")
            pdfjs_cache_dir = os.path.join(self.directories['pdfjs_cache'], pdf_basename)
            
            if not os.path.exists(pdfjs_cache_dir):
                print(f"⚠️ PDF.js cache not found for {pdf_basename}")
                print(f"   Expected location: {pdfjs_cache_dir}")
                print("   Please ensure PDF.js extraction has been run for this document")
                processing_result['errors'].append('pdfjs_cache_missing')
                pdfjs_cache_dir = os.path.join(self.directories['pdfjs_cache'], secure_filename(pdf_basename))
                # Continue without stable mapping
            if os.path.exists(pdfjs_cache_dir):
                print(f"✅ PDF.js cache found: {pdfjs_cache_dir}")
                
                # Step 3: Create stable element mappings
                print("🗺️ Step 3: Creating stable element mappings...")
                stable_mappings_file = self._create_stable_mappings(
                    pdf_basename, regions_file, pdfjs_cache_dir, force_reprocess
                )
                
                processing_result['steps_completed'].append('stable_mapping')
                processing_result['files_created']['stable_mappings'] = stable_mappings_file
            
            # Step 4: Create processing summary
            print("📊 Step 4: Creating processing summary...")
            summary_file = self._create_processing_summary(secure_filename(pdf_basename), processing_result)
            processing_result['files_created']['summary'] = summary_file
            processing_result['steps_completed'].append('summary_creation')
            
            # Load statistics
            processing_result['statistics'] = self._gather_statistics(processing_result['files_created'])
            
            processing_result['success'] = True
            print(f"🎉 Complete processing successful for {pdf_basename}!")
            
        except Exception as e:
            print(f"❌ Processing failed for {pdf_basename}: {e}")
            processing_result['errors'].append(str(e))
            import traceback
            traceback.print_exc()
        
        return processing_result
    
    def _process_coordinate_extraction(self, pdf_path: str, pdf_basename: str, 
                                     force_reprocess: bool) -> Tuple[str, str]:
        """Process coordinate extraction step"""
        sentences_file = os.path.join(self.directories['sentences'], f"{pdf_basename}_sentences.json")
        regions_file = os.path.join(self.directories['pdfminer_coordinate_regions'], f"{pdf_basename}_pdfminer_coordinate_regions.json")
        
        # Check if we need to reprocess
        if not force_reprocess and os.path.exists(sentences_file) and os.path.exists(regions_file):
            pdf_mtime = os.path.getmtime(pdf_path)
            sentences_mtime = os.path.getmtime(sentences_file)
            
            if sentences_mtime > pdf_mtime:
                print(f"   ✅ Using existing coordinate data")
                return sentences_file, regions_file
        
        # Extract with coordinate awareness
        return extract_and_save_coordinate_data(
            pdf_path, 
            output_dir=None,  # Will use file-specific directories
            force_reprocess=force_reprocess
        )
    
    def _create_stable_mappings(self, pdf_basename: str, regions_file: str, 
                              pdfjs_cache_dir: str, force_reprocess: bool) -> str:
        """Create stable element mappings"""
        stable_mappings_file = os.path.join(
            self.directories['stable_mappings'], 
            f"{secure_filename(pdf_basename)}_stable_mappings.json"
        )
        
        # Check if we need to reprocess
        if not force_reprocess and os.path.exists(stable_mappings_file):
            regions_mtime = os.path.getmtime(regions_file)
            mappings_mtime = os.path.getmtime(stable_mappings_file)
            
            if mappings_mtime > regions_mtime:
                print(f"   ✅ Using existing stable mappings")
                return stable_mappings_file
        
        # Create mapper and generate mappings
        mapper = PDFJSCoordinateMapper(regions_file, pdfjs_cache_dir, verbose=True)
        return mapper.save_stable_element_mappings(stable_mappings_file)
    
    def _create_processing_summary(self, pdf_basename: str, processing_result: Dict) -> str:
        """Create processing summary file"""
        summary_file = os.path.join(
            self.directories['processed_pdfs'], 
            f"{pdf_basename}_processing_summary.json"
        )
        
        summary_data = {
            'pdf_basename': pdf_basename,
            'processing_timestamp': time.time(),
            'processing_date': time.strftime('%Y-%m-%d %H:%M:%S'),
            'success': processing_result['success'],
            'steps_completed': processing_result['steps_completed'],
            'files_created': processing_result['files_created'],
            'errors': processing_result['errors'],
            'processing_method': 'coordinate_aware_with_stable_mapping'
        }
        
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary_data, f, indent=2, ensure_ascii=False)
        
        return summary_file
    
    def _gather_statistics(self, files_created: Dict) -> Dict:
        """Gather statistics from created files"""
        stats = {}
        
        try:
            # Load coordinate regions statistics
            if 'pdfminer_coordinate_regions' in files_created:
                with open(files_created['pdfminer_coordinate_regions'], 'r', encoding='utf-8') as f:
                    regions_data = json.load(f)
                    stats['coordinate_extraction'] = regions_data.get('statistics', {})
            
            # Load stable mappings statistics  
            if 'stable_mappings' in files_created:
                with open(files_created['stable_mappings'], 'r', encoding='utf-8') as f:
                    mappings_data = json.load(f)
                    stats['stable_mapping'] = mappings_data.get('metadata', {})
                    stats['stable_mapping'].update(mappings_data.get('statistics', {}))
            
        except Exception as e:
            print(f"⚠️ Error gathering statistics: {e}")
        
        return stats
    
    def get_processed_documents(self) -> List[Dict]:
        """Get list of all processed documents with their status"""
        processed_docs = []
        
        summary_dir = self.directories['processed_pdfs']
        if not os.path.exists(summary_dir):
            return []
        
        for filename in os.listdir(summary_dir):
            if filename.endswith('_processing_summary.json'):
                try:
                    summary_path = os.path.join(summary_dir, filename)
                    with open(summary_path, 'r', encoding='utf-8') as f:
                        summary = json.load(f)
                    processed_docs.append(summary)
                except Exception as e:
                    print(f"⚠️ Error reading summary {filename}: {e}")
        
        # Sort by processing timestamp (newest first)
        processed_docs.sort(key=lambda x: x.get('processing_timestamp', 0), reverse=True)
        return processed_docs
    
    def get_highlight_data_for_sentence_ids(self, pdf_basename: str, 
                                          sentence_ids: List[int]) -> Optional[Dict]:
        """
        Get highlight data for specific sentence IDs
        This is what your backend will call when serving provenance data
        """
        stable_mappings_file = os.path.join(
            self.directories['stable_mappings'], 
            f"{pdf_basename}_stable_mappings.json"
        )
        
        if not os.path.exists(stable_mappings_file):
            return None
        
        # Import the function from our mapper module
        from pdfjs_coordinate_mapper import get_highlight_data_for_provenance
        return get_highlight_data_for_provenance(stable_mappings_file, sentence_ids)
    
    def validate_processing_chain(self, pdf_path: str) -> Dict:
        """Validate the entire processing chain for a PDF"""
        pdf_basename = Path(pdf_path).stem
        
        validation_result = {
            'pdf_basename': pdf_basename,
            'validation_timestamp': time.time(),
            'steps_validated': [],
            'issues_found': [],
            'overall_status': 'unknown'
        }
        
        try:
            # 1. Validate coordinate extraction
            print(f"🧪 Validating coordinate extraction for {pdf_basename}...")
            from pdfminer_coordinate_extractor import validate_coordinate_extraction
            
            if validate_coordinate_extraction(pdf_path):
                validation_result['steps_validated'].append('coordinate_extraction')
            else:
                validation_result['issues_found'].append('coordinate_extraction_mismatch')
            
            # 2. Check file existence
            required_files = {
                'sentences': f"{pdf_basename}_sentences.json",
                'pdfminer_coordinate_regions': f"{pdf_basename}_pdfminer_coordinate_regions.json", 
                'stable_mappings': f"{pdf_basename}_stable_mappings.json"
            }
            
            for file_type, filename in required_files.items():
                file_path = os.path.join(self.directories[file_type], filename)
                if os.path.exists(file_path):
                    validation_result['steps_validated'].append(f'{file_type}_file_exists')
                else:
                    validation_result['issues_found'].append(f'{file_type}_file_missing')
            
            # 3. Validate data integrity
            if 'pdfminer_coordinate_regions_file_exists' in validation_result['steps_validated']:
                regions_file = os.path.join(self.directories['pdfminer_coordinate_regions'], required_files['pdfminer_coordinate_regions'])
                with open(regions_file, 'r', encoding='utf-8') as f:
                    regions_data = json.load(f)
                
                success_rate = regions_data.get('statistics', {}).get('success_rate', 0)
                if success_rate >= 0.8:
                    validation_result['steps_validated'].append('high_coordinate_success_rate')
                else:
                    validation_result['issues_found'].append(f'low_coordinate_success_rate_{success_rate:.2f}')
            
            # Determine overall status
            if not validation_result['issues_found']:
                validation_result['overall_status'] = 'excellent'
            elif len(validation_result['issues_found']) <= 2:
                validation_result['overall_status'] = 'good'
            else:
                validation_result['overall_status'] = 'needs_attention'
            
        except Exception as e:
            validation_result['issues_found'].append(f'validation_error_{str(e)}')
            validation_result['overall_status'] = 'error'
        
        return validation_result


def process_multiple_pdfs(pdf_paths: List[str], force_reprocess: bool = False) -> Dict:
    """Process multiple PDFs and return summary"""
    processor = CompletePDFProcessor()
    
    results = {
        'total_pdfs': len(pdf_paths),
        'successful': 0,
        'failed': 0,
        'processing_results': [],
        'summary': {}
    }
    
    for pdf_path in pdf_paths:
        print(f"\n{'='*60}")
        result = processor.process_pdf_complete(pdf_path, force_reprocess)
        results['processing_results'].append(result)
        
        if result['success']:
            results['successful'] += 1
        else:
            results['failed'] += 1
    
    # Create summary
    results['summary'] = {
        'success_rate': results['successful'] / results['total_pdfs'] if results['total_pdfs'] > 0 else 0,
        'common_errors': _analyze_common_errors(results['processing_results']),
        'files_created': sum(len(r.get('files_created', {})) for r in results['processing_results']),
        'total_processing_time': sum(r.get('processing_time', 0) for r in results['processing_results'])
    }
    
    print(f"\n🎯 BATCH PROCESSING COMPLETE:")
    print(f"   ✅ Successful: {results['successful']}/{results['total_pdfs']}")
    print(f"   ❌ Failed: {results['failed']}/{results['total_pdfs']}")
    print(f"   📊 Success rate: {results['summary']['success_rate']:.1%}")
    
    return results


def _analyze_common_errors(processing_results: List[Dict]) -> Dict:
    """Analyze common errors across processing results"""
    error_counts = {}
    
    for result in processing_results:
        for error in result.get('errors', []):
            error_type = error.split('_')[0] if '_' in error else error
            error_counts[error_type] = error_counts.get(error_type, 0) + 1
    
    return dict(sorted(error_counts.items(), key=lambda x: x[1], reverse=True))


def find_pdfs_in_uploads() -> List[str]:
    """Find all PDFs in the uploads directory"""
    uploads_dir = os.path.join(os.getcwd(), 'uploads')
    
    if not os.path.exists(uploads_dir):
        return []
    
    pdf_paths = []
    for filename in os.listdir(uploads_dir):
        if filename.lower().endswith('.pdf'):
            pdf_paths.append(os.path.join(uploads_dir, filename))
    
    return sorted(pdf_paths)


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        # Process specific PDF
        pdf_path = sys.argv[1]
        if os.path.exists(pdf_path):
            processor = CompletePDFProcessor()
            result = processor.process_pdf_complete(pdf_path, force_reprocess='--force' in sys.argv)
            
            if result['success']:
                print(f"\n🎉 Processing complete! Files created:")
                for file_type, file_path in result['files_created'].items():
                    print(f"   {file_type}: {file_path}")
            else:
                print(f"\n❌ Processing failed. Errors:")
                for error in result['errors']:
                    print(f"   - {error}")
        else:
            print(f"File not found: {pdf_path}")
    
    else:
        # Process all PDFs in uploads
        pdf_paths = find_pdfs_in_uploads()
        
        if pdf_paths:
            print(f"Found {len(pdf_paths)} PDFs in uploads directory")
            force_reprocess = '--force' in sys.argv
            
            results = process_multiple_pdfs(pdf_paths, force_reprocess = True)
            
            print(f"\n📋 Batch processing summary:")
            print(f"   Success rate: {results['summary']['success_rate']:.1%}")
            print(f"   Files created: {results['summary']['files_created']}")
            
            if results['summary']['common_errors']:
                print(f"   Common errors: {results['summary']['common_errors']}")
        
        else:
            print("No PDFs found in uploads directory")
            print("Usage: python complete_processing_pipeline.py <pdf_path> [--force]")