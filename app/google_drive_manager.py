"""
Google Drive management functionality
Handles initialization, document browsing, downloading, and batch processing
"""

import hashlib
import json
import logging
import os
import pandas as pd
import tempfile
import time
from typing import Dict, List, Optional, Tuple

from .google_workspace import GoogleDrive, GoogleDriveFileInfo
from .utils import estimate_pdf_size_from_pages, is_pdf_text_extractable

logger = logging.getLogger(__name__)

drive_inventory_df = None
google_drive_service = None
drive_services_available = False

class GoogleDriveManager:
    """
    Manages Google Drive operations for PDF processing
    """
    
    def __init__(self, downloads_dir: str):
        self.downloads_dir = downloads_dir
        self.drive_inventory_df = None
        self.google_drive_service = None
        self.drive_services_available = False
        
        os.makedirs(downloads_dir, exist_ok=True)
    
    def initialize_drive_services(self) -> bool:
        """Initialize Google Drive services and load inventory"""
        try:
            print("📂 Initializing Google Drive services...")
            pickle_path = os.path.join(os.path.expanduser("~"), "data/filepath_viz/processed_ner_outputs/df_ij_entities_20250521.pkl")

            if not os.path.exists(pickle_path):
                print(f"❌ Drive inventory file not found: {pickle_path}")
                return False

            # Load drive inventory
            self.drive_inventory_df = pd.read_pickle(pickle_path)
            
            print(f"📂 Loaded Drive inventory with {len(self.drive_inventory_df)} entries")
            self.drive_inventory_df['pdf_page_count'] = self.drive_inventory_df['pdf_page_count'].str.replace('^-$', '0', regex=True)
            self.drive_inventory_df['page_num'] = self.drive_inventory_df['pdf_page_count'].fillna(0).astype(int)
            
            # Extract file IDs from URLs
            self.drive_inventory_df['extracted_file_id'] = self.drive_inventory_df['gdrive_id'].apply(self._extract_file_id_from_url)
            
            # Filter for valid PDFs
            self.drive_inventory_df = self.drive_inventory_df[
                (self.drive_inventory_df['mimeType'] == 'application/pdf') & 
                (self.drive_inventory_df['extracted_file_id'].notna()) &
                (self.drive_inventory_df['page_num'].fillna(0) <= 100) &
                (self.drive_inventory_df['page_num'].fillna(0) > 0)
            ].copy()
            
            print(f"✅ Filtered to {len(self.drive_inventory_df)} PDFs with extractable file IDs")
            
            # Initialize Google Drive service
            self.google_drive_service = GoogleDrive()
            self.google_drive_service.connect()
            print("📂 Connected to Google Drive service")
            
            self.drive_services_available = True
            logger.info(f"✅ Loaded {len(self.drive_inventory_df)} PDFs from Drive inventory")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Drive services: {e}")
            self.drive_services_available = False
            return False
    
    def _extract_file_id_from_url(self, url) -> Optional[str]:
        """Extract file ID from Google Drive URL"""
        if pd.isna(url):
            return None
        url_str = str(url)
        if 'drive.google.com/file/d/' in url_str:
            try:
                file_id = url_str.split('file/d/')[1].split('/')[0]
                if '?' in file_id:
                    file_id = file_id.split('?')[0]
                return file_id
            except:
                return None
        return None
    
    def get_counties(self) -> List[Dict]:
        """Get counties with PDF statistics"""
        if not self.drive_services_available or self.drive_inventory_df is None:
            return []
        
        county_stats = self.drive_inventory_df.groupby('county').agg({
            'gdrive_name': 'count',
            'agency': 'nunique',
            'page_num': 'sum'
        }).rename(columns={
            'gdrive_name': 'pdf_count', 
            'agency': 'agency_count',
            'page_num': 'total_pages'
        }).reset_index()
        
        counties = []
        for _, row in county_stats.iterrows():
            counties.append({
                'name': row['county'],
                'pdf_count': int(row['pdf_count']),
                'agency_count': int(row['agency_count']),
                'total_pages': int(row.get('total_pages', 0)),
                'estimated_size_mb': round(estimate_pdf_size_from_pages(row.get('total_pages', 0)) / (1024*1024), 1)
            })
        
        return sorted(counties, key=lambda x: x['pdf_count'], reverse=True)
    
    def get_agencies_by_county(self, county: str) -> List[Dict]:
        """Get agencies within a county"""
        if not self.drive_services_available or self.drive_inventory_df is None:
            return []
        
        county_df = self.drive_inventory_df[self.drive_inventory_df['county'] == county]
        agency_stats = county_df.groupby('agency').agg({
            'gdrive_name': 'count',
            'subject_name': lambda x: x.dropna().nunique() if x.notna().any() else 0,
            'page_num': 'sum'
        }).rename(columns={
            'gdrive_name': 'pdf_count', 
            'subject_name': 'subject_count',
            'page_num': 'total_pages'
        }).reset_index()
        
        agencies = []
        for _, row in agency_stats.iterrows():
            agencies.append({
                'name': row['agency'],
                'pdf_count': int(row['pdf_count']),
                'subject_count': int(row['subject_count'])
            })
            
        return sorted(agencies, key=lambda x: x['pdf_count'], reverse=True)
    
    def get_files_by_agency(self, county: str, agency: str) -> List[Dict]:
        """Get PDF files for a specific agency"""
        if not self.drive_services_available or self.drive_inventory_df is None:
            return []
        
        agency_df = self.drive_inventory_df[
            (self.drive_inventory_df['county'] == county) & 
            (self.drive_inventory_df['agency'] == agency)
        ]
        
        files = []
        for _, row in agency_df.iterrows():
            files.append({
                'id': row['id'] if 'id' in row and pd.notna(row['id']) else None,
                'name': row['gdrive_name'],
                'path': row['gdrive_path'],
                'local_path': row['local_path'],
                'subject': row['subject_name'] if pd.notna(row['subject_name']) else 'Unknown',
                'incident_date': row['incident_date'] if pd.notna(row['incident_date']) else None,
                'case_numbers': row['case_numbers'] if pd.notna(row['case_numbers']) else None,
                'cluster': row['Clusters'] if 'Clusters' in row else None,
                'page_num': int(row['page_num']) if pd.notna(row['page_num']) else 0,
                'estimated_size_kb': estimate_pdf_size_from_pages(row.get('page_num', 0)) // 1024
            })
            
        # Sort by page count (smaller files first for easier testing)
        files.sort(key=lambda x: x['page_num'])
        return files
    
    def generate_path_hash(self, gdrive_path: str, filename: str) -> str:
        """Generate a hash from the full Google Drive path + filename"""
        full_path = f"{gdrive_path}/{filename}"
        return hashlib.sha256(full_path.encode('utf-8')).hexdigest()[:12]
    
    def create_safe_filename_with_hash(self, gdrive_path: str, original_filename: str) -> str:
        """Create a safe filename with path hash prefix"""
        from werkzeug.utils import secure_filename
        path_hash = self.generate_path_hash(gdrive_path, original_filename)
        safe_name = secure_filename(original_filename)
        name, ext = os.path.splitext(safe_name)
        return f"{path_hash}{ext}"
    
    def save_path_mapping(self, path_hash: str, gdrive_path: str, filename: str, safe_filename: str):
        """Save mapping between hash and original path"""
        mapping_file = os.path.join(self.downloads_dir, 'path_mappings.json')
        
        # Load existing mappings
        if os.path.exists(mapping_file):
            with open(mapping_file, 'r') as f:
                mappings = json.load(f)
        else:
            mappings = {}
        
        # Add new mapping
        mappings[path_hash] = {
            'gdrive_path': gdrive_path,
            'original_filename': filename,
            'safe_filename': safe_filename,
            'created_at': time.time()
        }
        
        # Save updated mappings
        with open(mapping_file, 'w', encoding='utf-8') as f:
            json.dump(mappings, f, indent=2, ensure_ascii=False)
    
    def download_and_process_file(self, file_id: str) -> Dict:
        """Download a file from Google Drive and prepare it for processing"""
        try:
            # Extract actual file ID if it's a full URL
            if file_id.startswith('https://drive.google.com/file/d/'):
                actual_file_id = GoogleDrive.url_to_id(file_id)
            else:
                actual_file_id = file_id
                
            logger.info(f"📥 Processing file ID: {actual_file_id}")
            
            # Find file in inventory
            file_rows = self.drive_inventory_df[self.drive_inventory_df['extracted_file_id'] == actual_file_id]
            
            if file_rows.empty:
                # Fallback search
                file_rows = self.drive_inventory_df[
                    self.drive_inventory_df['gdrive_id'].str.contains(actual_file_id, na=False)
                ]
                
            if file_rows.empty:
                return {
                    'success': False,
                    'error': f'File not found in inventory. ID: {actual_file_id}'
                }
                
            file_row = file_rows.iloc[0]
            filename = file_row['gdrive_name']
            gdrive_path = file_row['gdrive_path']

            safe_filename = self.create_safe_filename_with_hash(gdrive_path, filename)
            filepath = os.path.join(self.downloads_dir, safe_filename)
            path_hash = self.generate_path_hash(gdrive_path, filename)
            
            logger.info(f"📥 Downloading file: {filename} (ID: {actual_file_id})")
            
            # Create GoogleDriveFileInfo object
            file_info = GoogleDriveFileInfo(
                id=actual_file_id,
                name=filename,
                mimeType='application/pdf',
                parents=[]
            )
            
            # Download the file
            self.google_drive_service.download_pdf_file(file_info, filepath)
            
            # Check if file was actually downloaded
            if not os.path.exists(filepath):
                return {
                    'success': False,
                    'error': 'File download failed - file not created'
                }
                
            # Check if PDF has extractable text
            if not is_pdf_text_extractable(filepath):
                os.remove(filepath)
                return {
                    'success': False,
                    'error': 'PDF does not contain extractable text (likely scanned/image PDF)'
                }
            
            # Save path mapping
            self.save_path_mapping(path_hash, gdrive_path, filename, safe_filename)
            
            return {
                'success': True,
                'filepath': filepath,
                'safe_filename': safe_filename,
                'path_hash': path_hash,
                'original_path': gdrive_path,
                'original_filename': filename,
                'metadata': {
                    'county': file_row.get('county', 'Unknown'),
                    'agency': file_row.get('agency', 'Unknown'),
                    'subject': file_row.get('subject_name', 'Unknown')
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Download error: {str(e)}")
            return {
                'success': False,
                'error': f'Download failed: {str(e)}'
            }
    
    def sample_extractable_documents(self, max_documents: int = 5, max_attempts: int = 20) -> Dict:
        """Sample random PDFs and find extractable ones"""
        if not self.drive_services_available or self.drive_inventory_df is None:
            return {
                'success': False,
                'error': 'Google Drive services not properly initialized'
            }
        
        logger.info(f"🎲 Sampling and processing up to {max_documents} extractable PDFs")
        
        # Sample random PDFs
        sample_size = min(max_attempts, len(self.drive_inventory_df))
        sampled_files = self.drive_inventory_df.sample(n=sample_size)
        
        successful_documents = []
        attempts = 0
        
        for _, file_row in sampled_files.iterrows():
            attempts += 1
            if len(successful_documents) >= max_documents:
                break
                
            try:
                filename = file_row['gdrive_name']
                gdrive_path = file_row['gdrive_path']
                file_id = file_row['extracted_file_id']
                
                logger.info(f"🔍 Attempt {attempts}: Testing {filename} (ID: {file_id})")
                
                # Download and validate the file
                download_result = self.download_and_process_file(file_id)
                
                if download_result['success']:
                    # Create document metadata
                    document_metadata = {
                        'filename': download_result['safe_filename'],
                        'original_name': download_result['original_filename'],
                        'path_hash': download_result['path_hash'],
                        'gdrive_path': download_result['original_path'],
                        'gdrive_url': file_row['gdrive_id'],
                        'file_id': file_id,
                        'source': 'google_drive_sampling',
                        'processed_at': time.time(),
                        
                        # Drive inventory metadata
                        'county': file_row.get('county', 'Unknown'),
                        'agency': file_row.get('agency', 'Unknown'),
                        'subject': file_row.get('ner_subject', 'Unknown'),
                        'incident_date': file_row.get('incident_date'),
                        'page_num': int(file_row.get('page_num', 0)),
                        'cluster': file_row.get('Clusters'),
                        
                        'ready_for_qa': True,
                        'processing_complete': True
                    }
                    
                    successful_documents.append({
                        'document_id': download_result['path_hash'],
                        'filename': download_result['safe_filename'],
                        'title': download_result['original_filename'],
                        'metadata': document_metadata,
                        'backend_ready': True
                    })
                    
                    logger.info(f"🎉 Successfully processed {filename} -> {download_result['safe_filename']}")
                    
            except Exception as e:
                logger.error(f"❌ Error processing {filename}: {e}")
                continue
        
        logger.info(f"🎉 Successfully processed {len(successful_documents)} documents after {attempts} attempts")
        
        return {
            'success': True,
            'message': f'Successfully sampled and processed {len(successful_documents)} documents',
            'documents': successful_documents,
            'stats': {
                'attempts': attempts,
                'success_rate': f"{len(successful_documents)}/{attempts}",
                'total_available': len(self.drive_inventory_df)
            },
            'ready_for_frontend': True
        }
    
    def get_status(self) -> Dict:
        """Get status of Google Drive services"""
        return {
            'drive_services_available': self.drive_services_available,
            'has_inventory_df': self.drive_inventory_df is not None,
            'inventory_size': len(self.drive_inventory_df) if self.drive_inventory_df is not None else 0,
            'has_google_service': self.google_drive_service is not None,
            'token_exists': os.path.exists('token.json')
        }
    
#@main.route('/drive/sample-layout-documents', methods=['POST'])
def sample_documents_with_layout():
    """Sample random PDFs until we get the requested number with successful layout extraction"""
    try:
        # Get parameters from request
        data = request.get_json() or {}
        target_documents = data.get('target_documents', 5)
        max_total_attempts = data.get('max_total_attempts', 1000)  # Higher limit since layout extraction is harder
        
        if drive_inventory_df is None or google_drive_service is None:
            return jsonify({
                'success': False,
                'error': 'Google Drive services not properly initialized'
            }), 503
        
        #logger.info(f"🎯 Sampling until we get {target_documents} documents with successful layout extraction")
        
        successful_documents = []
        total_attempts = 0
        text_extractable_count = 0
        layout_success_count = 0
        
        # Keep sampling until we hit our target or max attempts
        while len(successful_documents) < target_documents and total_attempts < max_total_attempts:
            # Sample a batch of files (to avoid re-sampling the same files)
            remaining_attempts = max_total_attempts - total_attempts
            batch_size = min(10, remaining_attempts)
            
            # Get a random sample, excluding already processed files
            available_files = drive_inventory_df[
                ~drive_inventory_df['extracted_file_id'].isin([doc['file_id'] for doc in successful_documents])
            ]
            
            if len(available_files) == 0:
                logger.warning("⚠️ No more unique files to sample")
                break
                
            batch_files = available_files.sample(n=min(batch_size, len(available_files)))
            
            for _, file_row in batch_files.iterrows():
                total_attempts += 1
                if len(successful_documents) >= target_documents:
                    break
                    
                try:
                    filename = file_row['gdrive_name']
                    gdrive_path = file_row['gdrive_path']
                    file_id = file_row['extracted_file_id']
                    
                    #logger.info(f"🔍 Attempt {total_attempts}: Testing {filename} for layout extraction")
                    
                    # Create path hash and safe filename
                    path_hash = generate_path_hash(gdrive_path, filename)
                    safe_filename = create_safe_filename_with_hash(gdrive_path, filename)
                    filepath = os.path.join(DOWNLOADS_DIR, filename)
                    
                    # Skip if already processed
                    if os.path.exists(filepath):
                        #logger.info(f"⏭️ Skipping {filename} - already exists")
                        continue
                    
                    # Create GoogleDriveFileInfo object
                    file_info = GoogleDriveFileInfo(
                        id=file_id,
                        name=filename,
                        mimeType='application/pdf',
                        parents=[]
                    )
                    
                    # Download the file
                    google_drive_service.download_pdf_file(file_info, filepath)
                    
                    # Check if file was downloaded
                    if not os.path.exists(filepath):
                        logger.warning(f"⚠️ Download failed for {filename}")
                        continue
                    
                    # STEP 1: Check if PDF has extractable text
                    if not is_pdf_text_extractable(filepath):
                        #logger.info(f"❌ PDF not extractable: {filename}")
                        os.remove(filepath)
                        continue
                    
                    text_extractable_count += 1
                    #logger.info(f"✅ Text extractable: {filename} - Testing layout extraction...")
                    
                    # STEP 2: Try layout extraction (the critical test)
                    layout_data = None
                    layout_success = False
                    
                    try:
                        layout_data = extract_sentences_with_compatible_layout(filepath)
                        
                        # Validate that layout data is meaningful
                        if (layout_data and 
                            isinstance(layout_data, dict) and 
                            'sentences' in layout_data and 
                            len(layout_data['sentences']) > 10):  # Minimum sentence threshold
                            
                            # Save layout data
                            layout_saved = save_compatible_sentence_data(filepath, layout_data)
                            
                            if layout_saved:
                                layout_success = True
                                layout_success_count += 1
                                #logger.info(f"🎯 SUCCESS: Layout extracted for {filename} ({len(layout_data['sentences'])} sentences)")
                            else:
                                logger.warning(f"⚠️ Layout extraction succeeded but save failed for {filename}")
                        #else:
                            #logger.info(f"❌ Layout extraction returned insufficient data for {filename}")
                            
                    except Exception as layout_error:
                        logger.info(f"❌ Layout extraction failed for {filename}: {layout_error}")
                    
                    # If layout extraction failed, clean up and continue
                    if not layout_success:
                        os.remove(filepath)
                        continue
                    
                    # STEP 3: Full processing for successful layout documents
                    try:
                        #logger.info(f"🔄 Full processing for {filename}...")
                        
                        # Extract text and sentences
                        pdf_text = doc_provenance.base_strategies.extract_text_from_pdf(filepath)
                        sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
                        sentences_saved = save_document_sentences(filepath, sentences)
                        
                        # Create comprehensive document metadata
                        document_metadata = {
                            'filename': safe_filename,
                            'original_name': filename,
                            'path_hash': path_hash,
                            'gdrive_path': gdrive_path,
                            'gdrive_url': file_row['gdrive_id'],
                            'file_id': file_id,
                            'source': 'google_drive_layout_sampling',
                            'processed_at': time.time(),
                            
                            # Content metadata
                            'text_length': len(pdf_text),
                            'sentence_count': len(sentences),
                            'sentences_available': sentences_saved,
                            'layout_available': True,  # We know this is true
                            'layout_sentence_count': len(layout_data['sentences']),
                            
                            # Drive inventory metadata
                            'county': file_row.get('county', 'Unknown'),
                            'agency': file_row.get('agency', 'Unknown'),
                            'subject': file_row.get('ner_subject', 'Unknown'),
                            'incident_date': file_row.get('incident_date'),
                            'page_num': int(file_row.get('page_num', 0)),
                            'cluster': file_row.get('Clusters'),
                            
                            # Processing status
                            'ready_for_qa': True,
                            'ready_for_layout_qa': True,
                            'processing_complete': True
                        }
                        
                        # Save document metadata
                        metadata_path = os.path.join(UPLOADS_DIR, f"{os.path.splitext(safe_filename)[0]}_metadata.json")
                        with open(metadata_path, 'w', encoding='utf-8') as f:
                            json.dump(document_metadata, f, indent=2, ensure_ascii=False, default=str)
                        
                        # Save path mapping
                        save_path_mapping(path_hash, gdrive_path, filename, filepath)
                        
                        # Add to successful documents
                        successful_documents.append({
                            'document_id': path_hash,
                            'filename': safe_filename,
                            'title': filename,
                            'metadata': document_metadata,
                            'backend_ready': True,
                            'layout_ready': True,
                            'file_id': file_id
                        })
                        
                        #logger.info(f"🎉 COMPLETE: {filename} -> {safe_filename} (#{len(successful_documents)}/{target_documents})")
                        
                    except Exception as process_error:
                        logger.error(f"❌ Full processing failed for {filename}: {process_error}")
                        # Clean up on processing failure
                        try:
                            os.remove(filepath)
                            # Remove layout file if it exists
                            layout_path = os.path.join(filepath, f"{os.path.splitext(safe_filename)[0]}_layout.json")
                            if os.path.exists(layout_path):
                                os.remove(layout_path)
                        except:
                            pass
                        continue
                        
                except Exception as e:
                    logger.error(f"❌ Error processing {filename}: {e}")
                    # Clean up on error
                    if 'filepath' in locals() and os.path.exists(filepath):
                        try:
                            os.remove(filepath)
                        except:
                            pass
                    continue
        
        success_rate = len(successful_documents) / total_attempts if total_attempts > 0 else 0
        layout_success_rate = layout_success_count / text_extractable_count if text_extractable_count > 0 else 0
        
        #logger.info(f"🎯 FINAL RESULTS: {len(successful_documents)}/{target_documents} target documents")
        #logger.info(f"📊 Success rates: {text_extractable_count}/{total_attempts} text extractable, {layout_success_count}/{text_extractable_count} layout success")
        
        return jsonify({
            'success': True,
            'message': f'Successfully sampled {len(successful_documents)} documents with layout extraction',
            'documents': successful_documents,
            'stats': {
                'target_documents': target_documents,
                'achieved_documents': len(successful_documents),
                'total_attempts': total_attempts,
                'text_extractable_count': text_extractable_count,
                'layout_success_count': layout_success_count,
                'overall_success_rate': f"{len(successful_documents)}/{total_attempts} ({success_rate:.2%})",
                'layout_success_rate': f"{layout_success_count}/{text_extractable_count} ({layout_success_rate:.2%})",
                'ready_for_qa': len(successful_documents)
            },
            'ready_for_frontend': True
        })
        
    except Exception as e:
        logger.error(f"❌ Error in layout sampling: {e}")
        return jsonify({
            'success': False,
            'error': f'Layout sampling failed: {str(e)}'
        }), 500
    
# Add this new route to routes.py

#@main.route('/drive/batch-sample-layout', methods=['POST'])
def batch_sample_layout_documents():
    """
    Enhanced batch sampling that can run for hours to find layout-compatible PDFs
    Designed for curl usage to build a library of documents
    """
    try:
        data = request.get_json() or {}
        target_documents = data.get('target_documents', 5)  # Higher default
        max_total_attempts = data.get('max_total_attempts', 1000)  # Much higher limit
        batch_size = data.get('batch_size', 50)  # Process in batches
        save_failures = data.get('save_failures', True)  # Log what didn't work
        
        if drive_inventory_df is None or google_drive_service is None:
            return jsonify({
                'success': False,
                'error': 'Google Drive services not properly initialized'
            }), 503
        
        #logger.info(f"🎯 BATCH SAMPLING: Target {target_documents} documents, max {max_total_attempts} attempts")
        
        # Create a dedicated batch directory
        batch_id = f"batch_{int(time.time())}"
        batch_dir = os.path.join(DOWNLOADS_DIR, batch_id)
        os.makedirs(batch_dir, exist_ok=True)
        
        # Create log file for this batch
        batch_log_file = os.path.join(batch_dir, 'batch_log.txt')
        failure_log_file = os.path.join(batch_dir, 'failures.txt')
        
        def log_batch(message):
            timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
            log_msg = f"[{timestamp}] {message}\n"
            with open(batch_log_file, 'a', encoding='utf-8') as f:
                f.write(log_msg)
            #logger.info(message)
        
        def log_failure(filename, reason, error=None):
            if save_failures:
                timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
                failure_msg = f"[{timestamp}] {filename}: {reason}"
                if error:
                    failure_msg += f" - {str(error)}"
                failure_msg += "\n"
                with open(failure_log_file, 'a', encoding='utf-8') as f:
                    f.write(failure_msg)
        
        log_batch(f"Starting batch sampling - Target: {target_documents}, Max attempts: {max_total_attempts}")
        
        successful_documents = []
        total_attempts = 0
        text_extractable_count = 0
        layout_success_count = 0
        download_failures = 0
        
        # Filter and prepare candidate files
        #logger.info("Preparing candidate files...")
        candidate_files = drive_inventory_df[
            (drive_inventory_df['page_num'].fillna(0) > 0) &  # Has pages
            (drive_inventory_df['page_num'].fillna(0) <= 50) &  # Not too large
            (drive_inventory_df['extracted_file_id'].notna())  # Has valid file ID
        ].copy()
        
        # Shuffle for randomness
        candidate_files = candidate_files.sample(frac=1).reset_index(drop=True)
        log_batch(f"Found {len(candidate_files)} candidate files")
        
        # Track already processed file IDs to avoid duplicates
        processed_file_ids = set()
        
        batch_start_time = time.time()
        
        # Process in batches to allow for periodic status updates
        while len(successful_documents) < target_documents and total_attempts < max_total_attempts:
            remaining_attempts = max_total_attempts - total_attempts
            current_batch_size = min(batch_size, remaining_attempts)
            
            # Get next batch of files to try
            available_candidates = candidate_files[
                ~candidate_files['extracted_file_id'].isin(processed_file_ids)
            ]
            
            if len(available_candidates) == 0:
                log_batch("No more candidate files available")
                break
            
            batch_files = available_candidates.head(current_batch_size)
            
            log_batch(f"Processing batch: {len(batch_files)} files (Success so far: {len(successful_documents)}/{target_documents})")
            
            for _, file_row in batch_files.iterrows():
                total_attempts += 1
                if len(successful_documents) >= target_documents:
                    break
                
                filename = file_row['gdrive_name']
                gdrive_path = file_row['gdrive_path']
                file_id = file_row['extracted_file_id']
                page_count = int(file_row.get('page_num', 0))
                
                # Add to processed set immediately
                processed_file_ids.add(file_id)
                
                if total_attempts % 50 == 0:  # Log progress every 50 attempts
                    elapsed = time.time() - batch_start_time
                    rate = total_attempts / elapsed * 60  # attempts per minute
                    log_batch(f"Progress: {total_attempts}/{max_total_attempts} attempts, "
                             f"{len(successful_documents)}/{target_documents} success, "
                             f"Rate: {rate:.1f} attempts/min")
                
                try:
                    # Create safe filename and path
                    path_hash = generate_path_hash(gdrive_path, filename)
                    safe_filename = secure_filename(filename)
                    filepath = os.path.join(batch_dir, safe_filename)
                    
                    # Skip if already exists (from previous runs)
                    if os.path.exists(filepath):
                        log_failure(filename, "already_exists")
                        continue
                    
                    # Download with timeout and retry logic
                    download_success = False
                    for download_attempt in range(3):  # 3 download attempts
                        try:
                            file_info = GoogleDriveFileInfo(
                                id=file_id,
                                name=filename,
                                mimeType='application/pdf',
                                parents=[]
                            )
                            
                            # Download with a reasonable timeout
                            google_drive_service.download_pdf_file(file_info, filepath)
                            
                            if os.path.exists(filepath) and os.path.getsize(filepath) > 1000:
                                download_success = True
                                break
                            else:
                                if os.path.exists(filepath):
                                    os.remove(filepath)
                                log_failure(filename, f"download_failed_attempt_{download_attempt + 1}")
                                
                        except Exception as download_error:
                            log_failure(filename, f"download_error_attempt_{download_attempt + 1}", download_error)
                            if os.path.exists(filepath):
                                try:
                                    os.remove(filepath)
                                except:
                                    pass
                            time.sleep(1)  # Brief pause between retries
                    
                    if not download_success:
                        download_failures += 1
                        continue
                    
                    # Quick text extractability check
                    try:
                        if not is_pdf_text_extractable(filepath):
                            log_failure(filename, "not_text_extractable")
                            os.remove(filepath)
                            continue
                        text_extractable_count += 1
                    except Exception as extract_check_error:
                        log_failure(filename, "extract_check_failed", extract_check_error)
                        os.remove(filepath)
                        continue
                    
                    # The critical test: Layout extraction
                    layout_success = False
                    try:
                        # Use your existing compatible layout extraction
                        original_sentences, enhanced_sentences, pages_layout = extract_sentences_with_compatible_layout(filepath)
                        
                        # Validate layout data quality
                        if (enhanced_sentences and 
                            len(enhanced_sentences) >= 10 and  # Minimum sentences
                            pages_layout and len(pages_layout) > 0):
                            
                            # Save layout data
                            layout_data = {
                                'sentences': enhanced_sentences,
                                'pages_layout': pages_layout,
                                'metadata': {
                                    'total_sentences': len(original_sentences),
                                    'total_pages': len(pages_layout),
                                    'processed_at': time.time(),
                                    'pdf_path': filepath,
                                    'pdf_filename': safe_filename,
                                    'method': 'batch_compatible_layout_extraction',
                                    'batch_id': batch_id,
                                    'gdrive_info': {
                                        'file_id': file_id,
                                        'original_name': filename,
                                        'gdrive_path': gdrive_path,
                                        'page_count': page_count,
                                        'county': file_row.get('county', 'Unknown'),
                                        'agency': file_row.get('agency', 'Unknown')
                                    }
                                }
                            }
                            
                            # Save layout file
                            layout_file = os.path.join(batch_dir, f"{os.path.splitext(safe_filename)[0]}_layout.json")
                            with open(layout_file, 'w', encoding='utf-8') as f:
                                json.dump(layout_data, f, indent=2, ensure_ascii=False)
                            
                            # Save traditional sentences file
                            sentences_file = os.path.join(batch_dir, f"{os.path.splitext(safe_filename)[0]}_sentences.json")
                            with open(sentences_file, 'w', encoding='utf-8') as f:
                                json.dump(original_sentences, f, indent=2, ensure_ascii=False)
                            
                            layout_success = True
                            layout_success_count += 1
                            
                            log_batch(f"✅ SUCCESS #{len(successful_documents) + 1}: {filename} "
                                     f"({len(enhanced_sentences)} sentences, {len(pages_layout)} pages)")
                            
                        else:
                            log_failure(filename, f"insufficient_layout_data: "
                                       f"sentences={len(enhanced_sentences) if enhanced_sentences else 0}, "
                                       f"pages={len(pages_layout) if pages_layout else 0}")
                            
                    except Exception as layout_error:
                        log_failure(filename, "layout_extraction_failed", layout_error)
                    
                    # Clean up if layout extraction failed
                    if not layout_success:
                        try:
                            os.remove(filepath)
                        except:
                            pass
                        continue
                    
                    # If we get here, we have a successful document
                    document_metadata = {
                        'document_id': path_hash,
                        'filename': safe_filename,
                        'original_name': filename,
                        'title': filename,
                        'source': 'google_drive_batch_sampling',
                        'batch_id': batch_id,
                        'gdrive_info': {
                            'file_id': file_id,
                            'gdrive_path': gdrive_path,
                            'county': file_row.get('county', 'Unknown'),
                            'agency': file_row.get('agency', 'Unknown'),
                            'page_count': page_count
                        },
                        'processing_info': {
                            'text_length': len(' '.join(original_sentences)),
                            'sentence_count': len(original_sentences),
                            'layout_sentence_count': len(enhanced_sentences),
                            'pages_count': len(pages_layout),
                            'processed_at': time.time()
                        },
                        'files': {
                            'pdf': filepath,
                            'sentences': sentences_file,
                            'layout': layout_file
                        },
                        'ready_for_qa': True,
                        'ready_for_layout_qa': True
                    }
                    
                    # Save document metadata
                    metadata_file = os.path.join(batch_dir, f"{os.path.splitext(safe_filename)[0]}_metadata.json")
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(document_metadata, f, indent=2, ensure_ascii=False)
                    
                    successful_documents.append(document_metadata)
                    
                except Exception as e:
                    log_failure(filename, "unexpected_error", e)
                    # Clean up any partial files
                    try:
                        if 'filepath' in locals() and os.path.exists(filepath):
                            os.remove(filepath)
                    except:
                        pass
                    continue
            
            # Brief pause between batches
            time.sleep(2)
        
        total_time = time.time() - batch_start_time
        success_rate = len(successful_documents) / total_attempts if total_attempts > 0 else 0
        text_success_rate = text_extractable_count / total_attempts if total_attempts > 0 else 0
        layout_success_rate = layout_success_count / text_extractable_count if text_extractable_count > 0 else 0
        
        # Create final summary
        summary = {
            'batch_id': batch_id,
            'target_documents': target_documents,
            'achieved_documents': len(successful_documents),
            'total_attempts': total_attempts,
            'text_extractable_count': text_extractable_count,
            'layout_success_count': layout_success_count,
            'download_failures': download_failures,
            'total_time_minutes': total_time / 60,
            'attempts_per_minute': total_attempts / (total_time / 60) if total_time > 0 else 0,
            'overall_success_rate': f"{len(successful_documents)}/{total_attempts} ({success_rate:.2%})",
            'text_extraction_rate': f"{text_extractable_count}/{total_attempts} ({text_success_rate:.2%})",
            'layout_success_rate': f"{layout_success_count}/{text_extractable_count} ({layout_success_rate:.2%})",
            'batch_directory': batch_dir
        }
        
        # Save summary to batch directory
        summary_file = os.path.join(batch_dir, 'batch_summary.json')
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        
        log_batch(f"🎉 BATCH COMPLETE: {len(successful_documents)}/{target_documents} documents in {total_time/60:.1f} minutes")
        log_batch(f"Success rates: Overall {success_rate:.2%}, Text {text_success_rate:.2%}, Layout {layout_success_rate:.2%}")
        
        return jsonify({
            'success': True,
            'message': f'Batch sampling completed: {len(successful_documents)} documents',
            'summary': summary,
            'documents': successful_documents,
            'batch_directory': batch_dir,
            'log_files': {
                'batch_log': batch_log_file,
                'failure_log': failure_log_file,
                'summary': summary_file
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Error in batch sampling: {e}")
        return jsonify({
            'success': False,
            'error': f'Batch sampling failed: {str(e)}'
        }), 500


#@main.route('/drive/list-batches', methods=['GET'])
def list_batch_results():
    """List all completed batch sampling results"""
    try:
        batch_dirs = []
        
        if os.path.exists(DOWNLOADS_DIR):
            for item in os.listdir(DOWNLOADS_DIR):
                item_path = os.path.join(DOWNLOADS_DIR, item)
                if os.path.isdir(item_path) and item.startswith('batch_'):
                    summary_file = os.path.join(item_path, 'batch_summary.json')
                    if os.path.exists(summary_file):
                        try:
                            with open(summary_file, 'r') as f:
                                summary = json.load(f)
                            batch_dirs.append(summary)
                        except:
                            pass
        
        return jsonify({
            'success': True,
            'batches': sorted(batch_dirs, key=lambda x: x.get('batch_id', ''), reverse=True)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


#@main.route('/drive/copy-batch-to-uploads/<batch_id>', methods=['POST'])
def copy_batch_to_uploads(batch_id):
    """Copy successful documents from a batch to the uploads directory for use in the app"""
    try:
        batch_dir = os.path.join(DOWNLOADS_DIR, batch_id)
        if not os.path.exists(batch_dir):
            return jsonify({
                'success': False,
                'error': 'Batch directory not found'
            }), 404
        
        summary_file = os.path.join(batch_dir, 'batch_summary.json')
        if not os.path.exists(summary_file):
            return jsonify({
                'success': False,
                'error': 'Batch summary not found'
            }), 404
        
        with open(summary_file, 'r') as f:
            summary = json.load(f)
        
        upload_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        os.makedirs(upload_dir, exist_ok=True)
        
        copied_files = []
        
        # Find all successful documents in the batch
        for file in os.listdir(batch_dir):
            if file.endswith('_metadata.json'):
                metadata_path = os.path.join(batch_dir, file)
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                
                # Copy PDF file
                pdf_source = metadata['files']['pdf']
                pdf_dest = os.path.join(upload_dir, metadata['filename'])
                
                # Copy sentences file
                sentences_source = metadata['files']['sentences']
                sentences_dest = os.path.join(upload_dir, f"{os.path.splitext(metadata['filename'])[0]}_sentences.json")
                
                # Copy layout file
                layout_source = metadata['files']['layout']
                layout_dest = os.path.join(upload_dir, f"{os.path.splitext(metadata['filename'])[0]}_layout.json")
                
                # Copy metadata file
                metadata_dest = os.path.join(upload_dir, file)
                
                try:
                    import shutil
                    shutil.copy2(pdf_source, pdf_dest)
                    shutil.copy2(sentences_source, sentences_dest)
                    shutil.copy2(layout_source, layout_dest)
                    shutil.copy2(metadata_path, metadata_dest)
                    
                    copied_files.append({
                        'filename': metadata['filename'],
                        'original_name': metadata['original_name'],
                        'files_copied': ['pdf', 'sentences', 'layout', 'metadata']
                    })
                    
                except Exception as copy_error:
                    logger.error(f"Failed to copy {metadata['filename']}: {copy_error}")
        
        return jsonify({
            'success': True,
            'message': f'Copied {len(copied_files)} documents to uploads directory',
            'copied_files': copied_files,
            'batch_summary': summary
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

#@main.route('/drive/download', methods=['POST'])
def download_and_process_drive_file():
    """Download PDF from Drive using the working download_pdf_file method"""
    try:
        # Get file ID from request body
        data = request.get_json()
        if not data or 'file_id' not in data:
            return jsonify({
                'success': False,
                'error': 'file_id is required in request body'
            }), 400
            
        file_id = data['file_id']
        
        # Extract actual file ID if it's a full URL
        if file_id.startswith('https://drive.google.com/file/d/'):
            actual_file_id = GoogleDrive.url_to_id(file_id)
        else:
            actual_file_id = file_id
            
        #logger.info(f"📥 Processing file ID: {actual_file_id}")
        
        # Check if services are available
        if drive_inventory_df is None or google_drive_service is None:
            return jsonify({
                'success': False,
                'error': 'Google Drive services not properly initialized'
            }), 503
            
        # Search using the extracted_file_id column
        file_rows = drive_inventory_df[drive_inventory_df['extracted_file_id'] == actual_file_id]
        
        # Fallback: search in the original gdrive_id column with full URL
        if file_rows.empty:
            file_rows = drive_inventory_df[
                drive_inventory_df['gdrive_id'].str.contains(actual_file_id, na=False)
            ]
            
        if file_rows.empty:
            # Debug info
            sample_ids = drive_inventory_df['extracted_file_id'].head(5).tolist()
            sample_urls = drive_inventory_df['gdrive_id'].head(5).tolist()
            
            return jsonify({
                'success': False,
                'error': f'File not found in inventory. ID: {actual_file_id}',
                'debug': {
                    'searched_file_id': actual_file_id,
                    'sample_extracted_ids': sample_ids,
                    'sample_gdrive_urls': sample_urls
                }
            }), 404
            
        file_row = file_rows.iloc[0]
        filename = file_row['gdrive_name']
        gdrive_path = file_row['gdrive_path']

        safe_filename = create_safe_filename_with_hash(gdrive_path, filename)
        filepath = os.path.join(DOWNLOADS_DIR, safe_filename)

        path_hash = generate_path_hash(gdrive_path, filename)
        
        # Use the extracted file ID for download
        download_file_id = file_row['extracted_file_id']
        
        #logger.info(f"📥 Downloading file: {filename} (ID: {download_file_id})")
        
        
        # Ensure unique filename
        counter = 1
        while os.path.exists(os.path.join(DOWNLOADS_DIR, path_hash)):
            name, ext = os.path.splitext(secure_filename(path_hash))
            safe_filename = f"{name}_{counter}{ext}"
            counter += 1
            
        output_path = os.path.join(DOWNLOADS_DIR, path_hash)
        
        #logger.info(f"📥 Downloading file: {filename} to {filepath}")
        
        # Create a GoogleDriveFileInfo object for the existing method
        file_info = GoogleDriveFileInfo(
            id=download_file_id,
            name=filename,
            mimeType='application/pdf',
            parents=[]
        )
        
        # Use the existing download method
        google_drive_service.download_pdf_file(file_info, output_path)
        
        # Check if file was actually downloaded
        if not os.path.exists(output_path):
            return jsonify({
                'success': False,
                'error': 'File download failed - file not created'
            }), 500
            
        # Check if PDF has extractable text
        if not is_pdf_text_extractable(output_path):  # Pass filepath instead of bytes
            os.remove(filepath)  # Clean up
            return jsonify({
                'success': False,
                'error': 'PDF does not contain extractable text (likely scanned/image PDF)'
            }), 400
        
        #logger.info(f"✅ PDF has extractable text, processing...")
        
        # Process the PDF
        try:
            full_pdf_preprocess_enhanced()
            pdf_text = doc_provenance.base_strategies.extract_text_from_pdf(output_path)
            sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
            sentences_saved = save_document_sentences(output_path, sentences)
            
            #logger.info(f"✅ Successfully processed {output_path}")
            
            return jsonify({
                'success': True,
                'filename': output_path,
                'path_hash': path_hash,
                'original_path': gdrive_path,
                'message': f'Successfully downloaded and processed {filename}',
                'metadata': {
                    'sentence_count': len(sentences),
                    'text_length': len(pdf_text),
                    'sentences_available': sentences_saved,
                    'source': 'google_drive',
                    'county': file_row.get('county', 'Unknown'),
                    'agency': file_row.get('agency', 'Unknown'),
                    'subject': file_row.get('subject_name', 'Unknown')
                }
            })
            
        except Exception as process_error:
            # Clean up the file if processing failed
            try:
                os.remove(filepath)
            except:
                pass
            logger.error(f"❌ Processing failed: {process_error}")
            return jsonify({
                'success': False,
                'error': f'Failed to process PDF: {str(process_error)}'
            }), 500
        
    except Exception as e:
        logger.error(f"❌ Unexpected error: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500
