"""
Google Drive Sampler for Provisional Cases
Focused on sampling and downloading PDFs from specific provisional case names
"""

import hashlib, json, logging, os, requests, time
import pandas as pd
from typing import Dict, List, Optional, Set
from pathlib import Path

from .google_workspace import GoogleDrive, GoogleDriveFileInfo
from .pdf_gdrive_processing import is_pdf_text_extractable

logger = logging.getLogger(__name__)

class GoogleDriveProvisionalSampler:
    """
    Samples and downloads PDFs from Google Drive based on provisional case names
    """
    
    def __init__(self, downloads_dir: str):
        self.downloads_dir = downloads_dir
        os.makedirs(downloads_dir, exist_ok=True)
        
        # Drive service components
        self.drive_inventory_df = None
        self.google_drive_service = None
        self.drive_services_available = False
        
        # Provisional case names from your folder list
        self.target_provisional_cases = [
            "1715882152079-fun",
            "1715882251765-owf", 
            "1715882318071-yhp",
            "1715882417085-kcz",
            "1715882543626-ykv",
            "1715882527885-mnn",
            "1715882574890-use",
            "1715882649197-pdl",
            "1715882749531-bdd",
            "1715882774129-shw",
            "1715882814317-ytw",
            "1715882959322-bdk",
            "1715882467835-moy",
            "1715882863650-ffp",
            "1715882873999-fhs",
            "1715882946665-xei",
            "1715883061291-prb",
            "1715883096213-slo",
            "1715883120362-kna",
            "1715883146586-uvs",
            "1715883169518-bvy",
            "1715883181434-wbz",
            "1715883196940-yth",
            "1715883209324-oud",
            "1715883222088-yoz",
            "1715883245205-hfl",
            "1715883255533-zpn",
            "1715883276861-vcq",
            "1715883313551-naj"
        ]
    
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
            
            # Check if provisional_case_name column exists
            if 'provisional_case_name' not in self.drive_inventory_df.columns:
                print(f"❌ Column 'provisional_case_name' not found in inventory")
                print(f"Available columns: {list(self.drive_inventory_df.columns)}")
                return False
            
            # Basic data cleaning
            if 'pdf_page_count' in self.drive_inventory_df.columns:
                self.drive_inventory_df['pdf_page_count'] = self.drive_inventory_df['pdf_page_count'].str.replace('^-$', '0', regex=True)
                self.drive_inventory_df['page_num'] = self.drive_inventory_df['pdf_page_count'].fillna(0).astype(int)
            else:
                # If no page count column, create a dummy one
                self.drive_inventory_df['page_num'] = 0
            
            # Extract file IDs from URLs if needed
            if 'gdrive_id' in self.drive_inventory_df.columns:
                self.drive_inventory_df['extracted_file_id'] = self.drive_inventory_df['gdrive_id'].apply(self._extract_file_id_from_url)
            else:
                print(f"❌ No file ID column found (looking for 'gdrive_id')")
                return False
            
            # Filter for target provisional cases and PDFs
            before_filter = len(self.drive_inventory_df)
            
            # Filter by provisional case names
            self.drive_inventory_df = self.drive_inventory_df[
                self.drive_inventory_df['provisional_case_name'].isin(self.target_provisional_cases)
            ].copy()
            
            after_provisional_filter = len(self.drive_inventory_df)
            print(f"📋 After filtering by provisional case names: {after_provisional_filter} entries")
            # Filter for PDFs with extractable file IDs
            if 'mimeType' in self.drive_inventory_df.columns:
                self.drive_inventory_df = self.drive_inventory_df[
                    (self.drive_inventory_df['mimeType'] == 'application/pdf') & 
                    (self.drive_inventory_df['extracted_file_id'].notna())
                ].copy()
            else:
                # If no mimeType, assume all are PDFs but still filter for valid file IDs
                self.drive_inventory_df = self.drive_inventory_df[
                    self.drive_inventory_df['extracted_file_id'].notna()
                ].copy()
            
            # Prefer files with more pages (more likely to have substantial text)
            #if 'page_num' in self.drive_inventory_df.columns:
            #    print(f"some pagenums: {self.drive_inventory_df['page_num'].dropna().unique()}")
#
            #    self.drive_inventory_df = self.drive_inventory_df[
            #        (self.drive_inventory_df['page_num'] > 0) &
            #        (self.drive_inventory_df['page_num'] <= 50)  # Not too large
            #    ].copy()
            
            final_count = len(self.drive_inventory_df)
            print(f"✅ Final filtered dataset: {final_count} PDFs from target provisional cases")
            
            if final_count == 0:
                print("❌ No PDFs found matching criteria")
                return False
            
            # Show some statistics
            self._print_sampling_stats()
            
            # Initialize Google Drive service
            self.google_drive_service = GoogleDrive()
            self.google_drive_service.connect()
            print("📂 Connected to Google Drive service")
            
            self.drive_services_available = True
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Drive services: {e}")
            print(f"❌ Error details: {e}")
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
        return url_str  # Assume it's already a file ID
    
    def _print_sampling_stats(self):
        """Print statistics about available files for sampling"""
        if self.drive_inventory_df is None or len(self.drive_inventory_df) == 0:
            return
        
        print("\n📊 Sampling Statistics:")
        
        # Files per provisional case
        case_counts = self.drive_inventory_df['provisional_case_name'].value_counts()
        print(f"Files per provisional case (top 10):")
        for case, count in case_counts.head(10).items():
            print(f"  {case}: {count} files")
        
        # Page count distribution if available
        if 'page_num' in self.drive_inventory_df.columns:
            page_stats = self.drive_inventory_df['page_num'].describe()
            print(f"\nPage count distribution:")
            print(f"  Mean: {page_stats['mean']:.1f} pages")
            print(f"  Range: {page_stats['min']:.0f} - {page_stats['max']:.0f} pages")
        
        # Total files available
        print(f"\nTotal files available for sampling: {len(self.drive_inventory_df)}")
        print(f"Unique provisional cases represented: {self.drive_inventory_df['provisional_case_name'].nunique()}")
    
    def sample_documents(self, 
                        target_count: int = 5, 
                        max_attempts: int = 20,
                        prefer_diverse_cases: bool = True,
                        min_pages: int = 0) -> Dict:
        """
        Sample documents from the target provisional cases
        
        Args:
            target_count: Number of documents to successfully sample
            max_attempts: Maximum download attempts
            prefer_diverse_cases: Try to get files from different provisional cases
            min_pages: Minimum number of pages (if page data available)
            
        Returns:
            Sampling results
        """
        if not self.drive_services_available:
            return {
                'success': False,
                'error': 'Google Drive services not initialized'
            }
        
        print(f"🎲 Sampling {target_count} documents from provisional cases...")
        
        successful_documents = []
        failed_attempts = []
        attempts = 0
        
        # Create sampling strategy
        if prefer_diverse_cases:
            candidate_files = self._create_diverse_sampling_list(min_pages)
        else:
            candidate_files = self.drive_inventory_df[
                self.drive_inventory_df['page_num'] >= min_pages
            ].sample(frac=1).reset_index(drop=True)  # Shuffle
        
        print(f"📋 Created candidate list of {len(candidate_files)} files")
        
        for _, file_row in candidate_files.iterrows():
            if len(successful_documents) >= target_count:
                break
            if attempts >= max_attempts:
                break
                
            attempts += 1
            
            try:
                file_id = file_row['extracted_file_id']
                provisional_case = file_row['provisional_case_name']
                filename = file_row.get('gdrive_name', f"document_{file_id}")
                
                print(f"🔍 Attempt {attempts}: {provisional_case} - {filename}")
                
                # Download and validate
                download_result = self._download_and_validate_file(file_row)
                
                if download_result['success']:
                    document_info = {
                        'document_id': download_result['path_hash'],
                        'filename': download_result['safe_filename'],
                        'original_name': filename,
                        'provisional_case_name': provisional_case,
                        'file_id': file_id,
                        'source': 'provisional_case_sampling',
                        'local_path': download_result['filepath'],
                        'case_directory': download_result['case_directory'],
                        'metadata': {
                            'provisional_case': provisional_case,
                            'page_count': int(file_row.get('page_num', 0)),
                            'county': file_row.get('county', 'Unknown'),
                            'agency': file_row.get('agency', 'Unknown'),
                            'gdrive_id': file_row.get('gdrive_id', file_id),
                            'processed_at': time.time()
                        }
                    }
                    
                    successful_documents.append(document_info)
                    print(f"✅ Success: {provisional_case} - {filename}")
                    
                else:
                    failed_attempts.append({
                        'file_id': file_id,
                        'provisional_case': provisional_case,
                        'filename': filename,
                        'error': download_result['error']
                    })
                    print(f"❌ Failed: {download_result['error']}")
                    
            except Exception as e:
                failed_attempts.append({
                    'file_id': file_row.get('extracted_file_id', 'unknown'),
                    'provisional_case': file_row.get('provisional_case_name', 'unknown'),
                    'error': f'Sampling exception: {str(e)}'
                })
                print(f"❌ Exception: {str(e)}")
        
        # Generate results
        success_rate = len(successful_documents) / attempts if attempts > 0 else 0
        
        print(f"\n🎉 Sampling complete:")
        print(f"  Successfully sampled: {len(successful_documents)}/{target_count}")
        print(f"  Total attempts: {attempts}")
        print(f"  Success rate: {success_rate:.1%}")
        
        # Show diversity if requested
        if prefer_diverse_cases and successful_documents:
            cases_represented = set(doc['provisional_case_name'] for doc in successful_documents)
            print(f"  Provisional cases represented: {len(cases_represented)}")
            for case in sorted(cases_represented):
                count = sum(1 for doc in successful_documents if doc['provisional_case_name'] == case)
                print(f"    {case}: {count} document(s)")
        
        return {
            'success': True,
            'message': f'Successfully sampled {len(successful_documents)} documents',
            'documents': successful_documents,
            'failed_attempts': failed_attempts,
            'stats': {
                'target_count': target_count,
                'achieved_count': len(successful_documents),
                'total_attempts': attempts,
                'success_rate': success_rate,
                'cases_represented': len(set(doc['provisional_case_name'] for doc in successful_documents))
            }
        }
    
    def _create_diverse_sampling_list(self, min_pages: int) -> pd.DataFrame:
        """Create a sampling list that prioritizes diversity across provisional cases"""
        
        # Filter by minimum pages
        filtered_df = self.drive_inventory_df[
            self.drive_inventory_df['page_num'] >= min_pages
        ].copy()
        
        if len(filtered_df) == 0:
            return filtered_df
        
        # Sort by page count (prefer files with more content)
        filtered_df = filtered_df.sort_values('page_num', ascending=False)
        
        # Create diverse sampling: take best file from each case first, then second best, etc.
        diverse_list = []
        case_groups = filtered_df.groupby('provisional_case_name')
        
        max_rounds = max(len(group) for _, group in case_groups)
        
        for round_num in range(max_rounds):
            for case_name, group in case_groups:
                if round_num < len(group):
                    diverse_list.append(group.iloc[round_num])
        
        return pd.DataFrame(diverse_list).reset_index(drop=True)
    
    def _download_and_validate_file(self, file_row: pd.Series) -> Dict:
        """Download and validate a single file"""
        try:
            file_id = file_row['extracted_file_id']
            filename = file_row.get('gdrive_name', f"document_{file_id}")
            provisional_case = file_row['provisional_case_name']
            gdrive_id = file_row.get('gdrive_id', file_id)  # Full gdrive URL or ID
            
            # Create organized directory structure: DOWNLOAD_DIR/pvc-sample/<provisional_case_name>/
            case_dir = os.path.join(self.downloads_dir, 'pvc-sample', provisional_case)
            os.makedirs(case_dir, exist_ok=True)
            
            # Create safe filename with gdrive_id: <secure_filename>_<gdrive_id>.pdf
            safe_filename = self._create_safe_filename_with_gdrive_id(filename, gdrive_id)
            filepath = os.path.join(case_dir, safe_filename)
            
            # Skip if already downloaded
            if os.path.exists(filepath):
                if is_pdf_text_extractable(filepath):
                    return {
                        'success': True,
                        'filepath': filepath,
                        'safe_filename': safe_filename,
                        'case_directory': case_dir,
                        'provisional_case': provisional_case,
                        'path_hash': self._generate_path_hash(provisional_case, filename, gdrive_id),
                        'message': 'File already exists and is valid'
                    }
                else:
                    os.remove(filepath)  # Remove invalid cached file
            
            # Create GoogleDriveFileInfo object
            file_info = GoogleDriveFileInfo(
                id=file_id,
                name=filename,
                mimeType='application/pdf',
                parents=[]
            )
            
            # Download the file
            self.google_drive_service.download_pdf_file(file_info, filepath)
            
            # Validate download
            if not os.path.exists(filepath):
                return {
                    'success': False,
                    'error': 'Download failed - file not created'
                }
            
            # Check if PDF has extractable text
            if not is_pdf_text_extractable(filepath):
                os.remove(filepath)
                return {
                    'success': False,
                    'error': 'PDF does not contain extractable text'
                }
            
            return {
                'success': True,
                'filepath': filepath,
                'safe_filename': safe_filename,
                'case_directory': case_dir,
                'provisional_case': provisional_case,
                'path_hash': self._generate_path_hash(provisional_case, filename, gdrive_id)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Download exception: {str(e)}'
            }
    
    def _create_safe_filename_with_gdrive_id(self, original_filename: str, gdrive_id: str) -> str:
        """Create a safe filename with gdrive_id: <secure_filename>_<gdrive_id>.pdf"""
        from werkzeug.utils import secure_filename
        
        # Clean the original filename
        safe_name = secure_filename(original_filename)
        
        # Remove .pdf extension temporarily
        if safe_name.lower().endswith('.pdf'):
            safe_name = safe_name[:-4]
        
        # Extract just the file ID from gdrive_id (in case it's a full URL)
        clean_gdrive_id = self._extract_file_id_from_url(gdrive_id) or gdrive_id
        clean_gdrive_id = secure_filename(clean_gdrive_id)
        
        # Create final filename: <secure_filename>_<gdrive_id>.pdf
        return f"{safe_name}_{clean_gdrive_id}.pdf"
    
    def _generate_path_hash(self, provisional_case: str, filename: str, gdrive_id: str = None) -> str:
        """Generate a hash for the document"""
        if gdrive_id:
            combined = f"{provisional_case}_{filename}_{gdrive_id}"
        else:
            combined = f"{provisional_case}_{filename}"
        return hashlib.sha256(combined.encode('utf-8')).hexdigest()[:12]
    
    def get_available_provisional_cases(self) -> Dict:
        """Get information about available provisional cases"""
        if not self.drive_services_available or self.drive_inventory_df is None:
            return {
                'success': False,
                'error': 'Drive services not available'
            }
        
        case_info = []
        case_stats = self.drive_inventory_df.groupby('provisional_case_name').agg({
            'extracted_file_id': 'count',
            'page_num': ['mean', 'max', 'min']
        }).round(1)
        
        case_stats.columns = ['file_count', 'avg_pages', 'max_pages', 'min_pages']
        
        for case_name in case_stats.index:
            stats = case_stats.loc[case_name]
            case_info.append({
                'provisional_case_name': case_name,
                'file_count': int(stats['file_count']),
                'avg_pages': float(stats['avg_pages']),
                'max_pages': int(stats['max_pages']),
                'min_pages': int(stats['min_pages']),
                'in_target_list': case_name in self.target_provisional_cases
            })
        
        # Sort by file count
        case_info.sort(key=lambda x: x['file_count'], reverse=True)
        
        return {
            'success': True,
            'total_cases': len(case_info),
            'target_cases_found': len([c for c in case_info if c['in_target_list']]),
            'total_files': len(self.drive_inventory_df),
            'cases': case_info
        }
    
    def get_downloaded_files_summary(self) -> Dict:
        """Get a summary of downloaded files organized by provisional case"""
        pvc_sample_dir = os.path.join(self.downloads_dir, 'pvc-sample')
        
        if not os.path.exists(pvc_sample_dir):
            return {
                'success': True,
                'message': 'No downloads yet',
                'total_cases': 0,
                'total_files': 0,
                'cases': {}
            }
        
        summary = {
            'success': True,
            'total_cases': 0,
            'total_files': 0,
            'cases': {},
            'base_directory': pvc_sample_dir
        }
        
        try:
            for case_name in os.listdir(pvc_sample_dir):
                case_path = os.path.join(pvc_sample_dir, case_name)
                
                if os.path.isdir(case_path):
                    files = []
                    
                    for filename in os.listdir(case_path):
                        if filename.endswith('.pdf'):
                            file_path = os.path.join(case_path, filename)
                            stat = os.stat(file_path)
                            
                            # Extract gdrive_id from filename
                            if '_' in filename:
                                parts = filename.rsplit('_', 1)
                                if len(parts) == 2:
                                    gdrive_id = parts[1].replace('.pdf', '')
                                else:
                                    gdrive_id = 'unknown'
                            else:
                                gdrive_id = 'unknown'
                            
                            # Check for sentences file
                            sentences_file = os.path.join(case_path, f"{os.path.splitext(filename)[0]}_sentences.json")
                            has_sentences = os.path.exists(sentences_file)
                            
                            files.append({
                                'filename': filename,
                                'size_bytes': stat.st_size,
                                'modified': stat.st_mtime,
                                'gdrive_id': gdrive_id,
                                'has_sentences': has_sentences,
                                'full_path': file_path
                            })
                    
                    if files:
                        summary['cases'][case_name] = {
                            'file_count': len(files),
                            'case_directory': case_path,
                            'files': files
                        }
                        summary['total_cases'] += 1
                        summary['total_files'] += len(files)
        
        except Exception as e:
            summary['error'] = str(e)
        
        return summary
    
    def get_status(self) -> Dict:
        """Get status of the sampler"""
        return {
            'drive_services_available': self.drive_services_available,
            'inventory_loaded': self.drive_inventory_df is not None,
            'inventory_size': len(self.drive_inventory_df) if self.drive_inventory_df is not None else 0,
            'target_provisional_cases_count': len(self.target_provisional_cases),
            'downloads_directory': self.downloads_dir,
            'organized_downloads_directory': os.path.join(self.downloads_dir, 'pvc-sample')
        }