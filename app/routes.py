import doc_provenance, hashlib, io, json, logging, os, random, sys, time, traceback
from datetime import datetime, timedelta
from io import StringIO
from googleapiclient.http import MediaIoBaseDownload
import pandas as pd
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, send_file
from threading import Thread
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text
import doc_provenance.base_strategies
from  functools import wraps
from .preprocess_pdfs import save_compatible_sentence_data, extract_sentences_with_compatible_layout, verify_sentence_compatibility, full_pdf_preprocess
from .utils import estimate_pdf_size_from_pages, is_pdf_text_extractable
from .provenance_layout_mapper import ProvenanceLayoutMapper, get_provenance_boxes_for_highlighting
from .google_workspace import GoogleDrive, GoogleDriveFileInfo
main = Blueprint('main', __name__)

drive_inventory_df = None
google_drive_service = None
drive_services_available = False

sufficient_provenance_strategy_pool = ['raw','LLM_vanilla', 'embedding_sufficient_top_down','embedding_sufficient_bottem_up','LLM_score_sufficient_bottem_up','LLM_score_sufficient_top_down', 'divide_and_conquer_sufficient'] 
minimal_provenance_strategy_pool = ['null', 'exponential_greedy','sequential_greedy'] 

# Algorithm configurations - combination of sufficient anmd minimal strategy pools; 
# sufficient == raw -> only minimal strategies are used
# minimal == null -> only sufficient strategies are used
# all other combinations are a process where the first step is sufficient and the second step is minimal

ALGORITHM_CONFIGURATIONS = {
    'sufficient': sufficient_provenance_strategy_pool,
    'minimal':  minimal_provenance_strategy_pool
}

# =============================================================================

# Configuration for the experiment

PROCESSING_TIMEOUT = 60  # 1 minute timeout for processing
EXPERIMENT_TOP_K = 5  # User-facing limit for this experiment
MAX_PROVENANCE_PROCESSING = 20  # Internal limit to prevent infinite processing

class ProcessingTimeoutError(Exception):
    """Custom timeout exception for processing"""
    pass

# =============================================================================

# Directory configurations
RESULT_DIR = os.path.join(os.getcwd(), 'app/results')
UPLOAD_DIR = os.path.join(os.getcwd(), 'app/uploads')
STUDY_LOGS_DIR = os.path.join(os.getcwd(), 'app/study_logs')
QUESTIONS_DIR = os.path.join(os.getcwd(), 'app/questions')
SENTENCES_DIR = os.path.join(os.getcwd(), 'app/sentences')
DOWNLOAD_DIR = os.path.join(os.getcwd(), 'app/gdrive_downloads')

# =============================================================================

# Create directories
for directory in [RESULT_DIR, UPLOAD_DIR, STUDY_LOGS_DIR, QUESTIONS_DIR, SENTENCES_DIR]:
    os.makedirs(directory, exist_ok=True)

def generate_path_hash(gdrive_path, filename):
    """Generate a hash from the full Google Drive path + filename"""
    full_path = f"{gdrive_path}/{filename}"
    return hashlib.sha256(full_path.encode('utf-8')).hexdigest()[:12]

def create_safe_filename_with_hash(gdrive_path, original_filename):
    """Create a safe filename with path hash prefix"""
    path_hash = generate_path_hash(gdrive_path, original_filename)
    safe_name = secure_filename(original_filename)
    name, ext = os.path.splitext(safe_name)
    return f"{path_hash}{ext}"

def save_path_mapping(path_hash, gdrive_path, filename, safe_filename):
    """Save mapping between hash and original path"""
    mapping_file = os.path.join(DOWNLOAD_DIR, 'path_mappings.json')
    
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

# In routes.py - Add this at the top to debug routing
@main.route('/test', methods=['GET', 'POST'])
def test_route():
    return jsonify({
        'success': True,
        'method': request.method,
        'message': 'Basic routing works'
    })

# List all routes for debugging
@main.route('/debug/routes')
def list_routes():
    from flask import current_app
    routes = []
    for rule in current_app.url_map.iter_rules():
        routes.append({
            'endpoint': rule.endpoint,
            'methods': list(rule.methods),
            'rule': str(rule)
        })
    return jsonify(routes)

# Simple rate limiting decorator
def rate_limit(calls_per_minute=60):
    def decorator(func):
        func.last_called = []
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            now = time.time()
            # Remove calls older than 1 minute
            func.last_called = [call_time for call_time in func.last_called if now - call_time < 60]
            
            if len(func.last_called) >= calls_per_minute:
                return jsonify({
                    'success': False,
                    'error': 'Rate limit exceeded. Please try again later.'
                }), 429
            
            func.last_called.append(now)
            return func(*args, **kwargs)
        return wrapper
    return decorator

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# CASEFILE BROWSING / GOOGLE DRIVE API
# =============================================================================

def initialize_drive_services():
    global drive_inventory_df, google_drive_service, drive_services_available

    try:
        print("📂 Initializing Google Drive services...")
        pickle_path = os.path.join(os.path.expanduser("~"), "data/filepath_viz/processed_ner_outputs/df_ij_entities_20250521.pkl")

        if not os.path.exists(pickle_path):
            print(f"❌ Drive inventory file not found: {pickle_path}")
            return

    
        # Load your CSV
        drive_inventory_df = pd.read_pickle(pickle_path)
         # Extract file IDs from the gdrive_id column (which contains full URLs)
        def extract_file_id_from_url(url):
            if pd.isna(url):
                return None
            url_str = str(url)
            if 'drive.google.com/file/d/' in url_str:
                try:
                    file_id = url_str.split('file/d/')[1].split('/')[0]
                    # Remove any query parameters
                    if '?' in file_id:
                        file_id = file_id.split('?')[0]
                    return file_id
                except:
                    return None
            return None
        
        print(f"📂 Loaded Drive inventory with {len(drive_inventory_df)} entries")
        drive_inventory_df['pdf_page_count'] = drive_inventory_df['pdf_page_count'].str.replace('^-$', '0', regex=True)
        drive_inventory_df['page_num'] = drive_inventory_df['pdf_page_count'].fillna(0).astype(int)
        
        # Create a new column with just the file IDs
        drive_inventory_df['extracted_file_id'] = drive_inventory_df['gdrive_id'].apply(extract_file_id_from_url)
        
        # Filter for PDFs that have extractable file IDs
        drive_inventory_df = drive_inventory_df[
            (drive_inventory_df['mimeType'] == 'application/pdf') & 
            (drive_inventory_df['extracted_file_id'].notna()) &  # Must have a file ID
            (drive_inventory_df['page_num'].fillna(0) <= 100) &
            (drive_inventory_df['page_num'].fillna(0) > 0)
        ].copy()
        
        print(f"✅ Filtered to {len(drive_inventory_df)} PDFs with extractable file IDs")
        
        # Initialize Google Drive service
        google_drive_service = GoogleDrive()
        google_drive_service.connect()
        print("📂 Connected to Google Drive service")
        drive_services_available = True

        logger.info(f"✅ Loaded {len(drive_inventory_df)} PDFs from Drive inventory")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to initialize Drive services: {e}")
        drive_services_available = False
        return False
    
# Call it when the module loads
#try:
#    initialize_drive_services()
#except Exception as e:
#    print(f"Warning: Could not initialize drive services: {e}")
#    drive_services_available = False
    
@main.route('/drive/init', methods=['POST'])
def init_drive_services():
    """Manually initialize drive services"""
    global drive_services_available
    try:
        success = initialize_drive_services()
        if success: 
            drive_services_available = True
        return jsonify({
            'success': True,
            'message': 'Drive services initialized successfully',
            'inventory_size': len(drive_inventory_df) if drive_inventory_df is not None else 0
        })
    except Exception as e:
        drive_services_available = False
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/drive/status', methods=['GET'])
def drive_status():
    """Check drive services status"""
    return jsonify({
        'drive_services_available': drive_services_available,
        'has_inventory_df': drive_inventory_df is not None,
        'inventory_size': len(drive_inventory_df) if drive_inventory_df is not None else 0,
        'has_google_service': google_drive_service is not None,
        'token_exists': os.path.exists('token.json')
    })


@main.route('/drive/counties', methods=['GET'])
def get_drive_counties():
    """Get counties with PDF statistics"""
    try:
        logger.info("📍 Counties endpoint called")
        
        if not drive_services_available:
            logger.warning("⚠️ Drive services not available, attempting to initialize...")
            if not initialize_drive_services():
                return jsonify({
                    'success': False,
                    'error': 'Google Drive services not available. Please check configuration.',
                    'need_init': True
                }), 503
        
        if drive_inventory_df is None:
            return jsonify({
                'success': False,
                'error': 'Drive inventory not loaded',
                'need_init': True
            }), 503
            
        logger.info(f"📊 Processing {len(drive_inventory_df)} rows for county stats")
        
        county_stats = drive_inventory_df.groupby('county').agg({
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
        
        logger.info(f"✅ Returning {len(counties)} counties")
        return jsonify({
            'success': True,
            'counties': sorted(counties, key=lambda x: x['pdf_count'], reverse=True)
        })
        
    except Exception as e:
        logger.error(f"❌ Error in get_drive_counties: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False, 
            'error': str(e)
        }), 500

@main.route('/drive/agencies/<county>', methods=['GET'])
def get_drive_agencies_by_county(county):
    """Get agencies within a county"""
    try:
        county_df = drive_inventory_df[drive_inventory_df['county'] == county]
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
            
        return jsonify({
            'success': True,
            'agencies': sorted(agencies, key=lambda x: x['pdf_count'], reverse=True)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/drive/files/<county>/<agency>', methods=['GET'])
def get_drive_files_by_agency(county, agency):
    """Get PDF files for a specific agency"""
    try:
        agency_df = drive_inventory_df[
            (drive_inventory_df['county'] == county) & 
            (drive_inventory_df['agency'] == agency)
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
            
        return jsonify({
            'success': True,
            'files': files
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    
@main.route('/drive/sample-documents', methods=['POST'])
def sample_extractable_documents():
    """Sample random PDFs, find extractable ones, and fully process them"""
    try:
        # Get parameters from request
        data = request.get_json() or {}
        max_documents = data.get('max_documents', 5)
        max_attempts = data.get('max_attempts', 20)
        
        if drive_inventory_df is None or google_drive_service is None:
            return jsonify({
                'success': False,
                'error': 'Google Drive services not properly initialized'
            }), 503
        
        logger.info(f"🎲 Sampling and processing up to {max_documents} extractable PDFs")
        
        # Sample random PDFs
        sample_size = min(max_attempts, len(drive_inventory_df))
        sampled_files = drive_inventory_df.sample(n=sample_size)
        
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
                
                # Create path hash and safe filename
                path_hash = generate_path_hash(gdrive_path, filename)
                safe_filename = create_safe_filename_with_hash(gdrive_path, filename)
                filepath = os.path.join(UPLOAD_DIR, safe_filename)
                
                # Skip if already processed
                if os.path.exists(filepath):
                    logger.info(f"⏭️ Skipping {filename} - already exists")
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
                
                # Check if PDF has extractable text
                if not is_pdf_text_extractable(filepath):
                    logger.info(f"❌ PDF not extractable: {filename}")
                    os.remove(filepath)  # Clean up
                    continue
                
                logger.info(f"✅ Found extractable PDF: {filename} - Processing...")
                
                # FULL PROCESSING PIPELINE
                try:
                    # 1. Extract text and sentences
                    pdf_text = extract_text(filepath)
                    sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
                    sentences_saved = save_document_sentences(safe_filename, sentences)
                    
                    # 2. Extract layout information (if you have this)
                    layout_data = None
                    try:
                        layout_data = extract_sentences_with_compatible_layout(filepath)
                        save_compatible_sentence_data(safe_filename, layout_data)
                        logger.info(f"✅ Layout data extracted for {safe_filename}")
                    except Exception as layout_error:
                        logger.warning(f"⚠️ Layout extraction failed for {filename}: {layout_error}")
                    
                    # 3. Create document metadata
                    document_metadata = {
                        'filename': safe_filename,
                        'original_name': filename,
                        'path_hash': path_hash,
                        'gdrive_path': gdrive_path,
                        'gdrive_url': file_row['gdrive_id'],
                        'file_id': file_id,
                        'source': 'google_drive_sampling',
                        'processed_at': time.time(),
                        
                        # Content metadata
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences),
                        'sentences_available': sentences_saved,
                        'layout_available': layout_data is not None,
                        
                        # Drive inventory metadata
                        'county': file_row.get('county', 'Unknown'),
                        'agency': file_row.get('agency', 'Unknown'),
                        'subject': file_row.get('ner_subject', 'Unknown'),
                        'incident_date': file_row.get('incident_date'),
                        'page_num': int(file_row.get('page_num', 0)),
                        'cluster': file_row.get('Clusters'),
                        
                        # Processing status
                        'ready_for_qa': True,
                        'processing_complete': True
                    }
                    
                    # 4. Save document metadata file
                    metadata_path = os.path.join(UPLOAD_DIR, f"{os.path.splitext(safe_filename)[0]}_metadata.json")
                    with open(metadata_path, 'w', encoding='utf-8') as f:
                        json.dump(document_metadata, f, indent=2, ensure_ascii=False, default=str)
                    
                    # 5. Save path mapping
                    save_path_mapping(path_hash, gdrive_path, filename, safe_filename)
                    
                    # 6. Add to successful documents list
                    successful_documents.append({
                        'document_id': path_hash,  # Use hash as document ID
                        'filename': safe_filename,
                        'title': filename,
                        'metadata': document_metadata,
                        'backend_ready': True
                    })
                    
                    logger.info(f"🎉 Successfully processed {filename} -> {safe_filename}")
                    
                except Exception as process_error:
                    logger.error(f"❌ Processing failed for {filename}: {process_error}")
                    # Clean up on processing failure
                    try:
                        os.remove(filepath)
                        # Also remove metadata if it was created
                        metadata_path = os.path.join(UPLOAD_DIR, f"{os.path.splitext(safe_filename)[0]}_metadata.json")
                        if os.path.exists(metadata_path):
                            os.remove(metadata_path)
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
        
        logger.info(f"🎉 Successfully processed {len(successful_documents)} documents after {attempts} attempts")
        
        return jsonify({
            'success': True,
            'message': f'Successfully sampled and processed {len(successful_documents)} documents',
            'documents': successful_documents,
            'stats': {
                'attempts': attempts,
                'success_rate': f"{len(successful_documents)}/{attempts}",
                'total_available': len(drive_inventory_df)
            },
            'ready_for_frontend': True  # Signal that these can be used immediately
        })
        
    except Exception as e:
        logger.error(f"❌ Error in sampling: {e}")
        return jsonify({
            'success': False,
            'error': f'Sampling failed: {str(e)}'
        }), 500
    
@main.route('/drive/sample-layout-documents', methods=['POST'])
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
        
        logger.info(f"🎯 Sampling until we get {target_documents} documents with successful layout extraction")
        
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
                    
                    logger.info(f"🔍 Attempt {total_attempts}: Testing {filename} for layout extraction")
                    
                    # Create path hash and safe filename
                    path_hash = generate_path_hash(gdrive_path, filename)
                    safe_filename = create_safe_filename_with_hash(gdrive_path, filename)
                    filepath = os.path.join(DOWNLOAD_DIR, filename)
                    
                    # Skip if already processed
                    if os.path.exists(filepath):
                        logger.info(f"⏭️ Skipping {filename} - already exists")
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
                        logger.info(f"❌ PDF not extractable: {filename}")
                        os.remove(filepath)
                        continue
                    
                    text_extractable_count += 1
                    logger.info(f"✅ Text extractable: {filename} - Testing layout extraction...")
                    
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
                                logger.info(f"🎯 SUCCESS: Layout extracted for {filename} ({len(layout_data['sentences'])} sentences)")
                            else:
                                logger.warning(f"⚠️ Layout extraction succeeded but save failed for {filename}")
                        else:
                            logger.info(f"❌ Layout extraction returned insufficient data for {filename}")
                            
                    except Exception as layout_error:
                        logger.info(f"❌ Layout extraction failed for {filename}: {layout_error}")
                    
                    # If layout extraction failed, clean up and continue
                    if not layout_success:
                        os.remove(filepath)
                        continue
                    
                    # STEP 3: Full processing for successful layout documents
                    try:
                        logger.info(f"🔄 Full processing for {filename}...")
                        
                        # Extract text and sentences
                        pdf_text = extract_text(filepath)
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
                        metadata_path = os.path.join(UPLOAD_DIR, f"{os.path.splitext(safe_filename)[0]}_metadata.json")
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
                        
                        logger.info(f"🎉 COMPLETE: {filename} -> {safe_filename} (#{len(successful_documents)}/{target_documents})")
                        
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
        
        logger.info(f"🎯 FINAL RESULTS: {len(successful_documents)}/{target_documents} target documents")
        logger.info(f"📊 Success rates: {text_extractable_count}/{total_attempts} text extractable, {layout_success_count}/{text_extractable_count} layout success")
        
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

@main.route('/drive/batch-sample-layout', methods=['POST'])
def batch_sample_layout_documents():
    """
    Enhanced batch sampling that can run for hours to find layout-compatible PDFs
    Designed for curl usage to build a library of preloaded documents
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
        
        logger.info(f"🎯 BATCH SAMPLING: Target {target_documents} documents, max {max_total_attempts} attempts")
        
        # Create a dedicated batch directory
        batch_id = f"batch_{int(time.time())}"
        batch_dir = os.path.join(DOWNLOAD_DIR, batch_id)
        os.makedirs(batch_dir, exist_ok=True)
        
        # Create log file for this batch
        batch_log_file = os.path.join(batch_dir, 'batch_log.txt')
        failure_log_file = os.path.join(batch_dir, 'failures.txt')
        
        def log_batch(message):
            timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
            log_msg = f"[{timestamp}] {message}\n"
            with open(batch_log_file, 'a', encoding='utf-8') as f:
                f.write(log_msg)
            logger.info(message)
        
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
        logger.info("Preparing candidate files...")
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


@main.route('/drive/list-batches', methods=['GET'])
def list_batch_results():
    """List all completed batch sampling results"""
    try:
        batch_dirs = []
        
        if os.path.exists(DOWNLOAD_DIR):
            for item in os.listdir(DOWNLOAD_DIR):
                item_path = os.path.join(DOWNLOAD_DIR, item)
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


@main.route('/drive/copy-batch-to-uploads/<batch_id>', methods=['POST'])
def copy_batch_to_uploads(batch_id):
    """Copy successful documents from a batch to the uploads directory for use in the app"""
    try:
        batch_dir = os.path.join(DOWNLOAD_DIR, batch_id)
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

@main.route('/drive/download', methods=['POST'])
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
            
        logger.info(f"📥 Processing file ID: {actual_file_id}")
        
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
        filepath = os.path.join(DOWNLOAD_DIR, safe_filename)

        path_hash = generate_path_hash(gdrive_path, filename)
        
        # Use the extracted file ID for download
        download_file_id = file_row['extracted_file_id']
        
        logger.info(f"📥 Downloading file: {filename} (ID: {download_file_id})")
        
        
        # Ensure unique filename
        counter = 1
        while os.path.exists(os.path.join(DOWNLOAD_DIR, path_hash)):
            name, ext = os.path.splitext(secure_filename(path_hash))
            safe_filename = f"{name}_{counter}{ext}"
            counter += 1
            
        output_path = os.path.join(DOWNLOAD_DIR, path_hash)
        
        logger.info(f"📥 Downloading file: {filename} to {filepath}")
        
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
        
        logger.info(f"✅ PDF has extractable text, processing...")
        
        # Process the PDF
        try:
            full_pdf_preprocess()
            pdf_text = extract_text(output_path)
            sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
            sentences_saved = save_document_sentences(output_path, sentences)
            
            logger.info(f"✅ Successfully processed {output_path}")
            
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

# =============================================================================
# Helper Functions (keeping existing ones)
# =============================================================================
def process_pdf_internal(pdf_path, force_reprocess=False):
    """Internal helper to process PDF without HTTP overhead"""
    try:
        output_dir = os.path.dirname(pdf_path)
        sentences_file_path, layout_file_path, stats = save_compatible_sentence_data(
            pdf_path, output_dir
        )
        
        return {
            "success": True,
            "files": {
                "sentences_file": sentences_file_path,
                "layout_file": layout_file_path
            },
            "statistics": stats
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    
def get_document_sentences_path(filename):
    """Get the standardized path for document sentences"""
    base_name = filename.replace('.pdf', '')
    return os.path.join(SENTENCES_DIR, f"{base_name}_sentences.json")

def save_document_sentences(filename, sentences):
    """Save sentences for a document to the dedicated sentences directory"""
    sentences_path = get_document_sentences_path(filename)
    try:
        with open(sentences_path, 'w', encoding='utf-8') as f:
            json.dump(sentences, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(sentences)} sentences for {filename}")
        return True
    except Exception as e:
        logger.error(f"Error saving sentences for {filename}: {e}")
        return False

def load_document_sentences(filename):
    """Load sentences for a document from the dedicated sentences directory"""
    sentences_path = get_document_sentences_path(filename)
    try:
        if os.path.exists(sentences_path):
            with open(sentences_path, 'r', encoding='utf-8') as f:
                sentences = json.load(f)
            logger.info(f"Loaded {len(sentences)} sentences for {filename}")
            return sentences
        else:
            logger.warning(f"Sentences file not found for {filename}")
            return None
    except Exception as e:
        logger.error(f"Error loading sentences for {filename}: {e}")
        return None

def get_question_library_path():
    """Get the path to the questions library file"""
    return os.path.join(QUESTIONS_DIR, 'questions.json')

def load_questions_library():
    """Load the questions library"""
    library_path = get_question_library_path()
    try:
        if os.path.exists(library_path):
            with open(library_path, 'r', encoding='utf-8') as f:
                library = json.load(f)
            return library
        else:
            # Initialize empty library
            return {
                'questions': [],
                'categories': ['General', 'Content Analysis', 'Methodology', 'Results', 'Custom'],
                'metadata': {
                    'created_at': time.time(),
                    'last_updated': time.time(),
                    'total_uses': 0
                }
            }
    except Exception as e:
        logger.error(f"Error loading questions library: {e}")
        return None

def save_questions_library(library):
    """Save the questions library"""
    library_path = get_question_library_path()
    try:
        library['metadata']['last_updated'] = time.time()
        with open(library_path, 'w', encoding='utf-8') as f:
            json.dump(library, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved questions library with {len(library['questions'])} questions")
        return True
    except Exception as e:
        logger.error(f"Error saving questions library: {e}")
        return False

def add_question_to_library(question_text, category='Custom', description='', is_favorite=False):
    """Add a question to the library"""
    library = load_questions_library()
    if not library:
        return False
    
    question_id = str(int(time.time() * 1000))  # Unique ID based on timestamp
    question_entry = {
        'id': question_id,
        'text': question_text,
        'category': category,
        'description': description,
        'is_favorite': is_favorite,
        'created_at': time.time(),
        'use_count': 0,
        'last_used': None,
        'avg_processing_time': None,
        'success_rate': 1.0,
        'tags': []
    }
    
    library['questions'].append(question_entry)
    return save_questions_library(library)

def update_question_usage(question_id, processing_time=None, success=True):
    """Update usage statistics for a question"""
    library = load_questions_library()
    if not library:
        return False
    
    for question in library['questions']:
        if question['id'] == question_id:
            question['use_count'] += 1
            question['last_used'] = time.time()
            library['metadata']['total_uses'] += 1
            
            if processing_time:
                if question['avg_processing_time']:
                    question['avg_processing_time'] = (question['avg_processing_time'] + processing_time) / 2
                else:
                    question['avg_processing_time'] = processing_time
            
            # Update success rate (simple moving average)
            current_success_rate = question.get('success_rate', 1.0)
            question['success_rate'] = (current_success_rate + (1.0 if success else 0.0)) / 2
            
            return save_questions_library(library)
    
    return False

# =============================================================================
# Enhanced Answer and Provenance Management
# =============================================================================

def get_question_answer_path(question_id):
    """Get the path to the answer file for a question"""
    return os.path.join(RESULT_DIR, question_id, 'answer.json')

def get_question_provenance_path(question_id):
    """Get the path to the provenance file for a question"""
    return os.path.join(RESULT_DIR, question_id, 'provenance.json')

def get_question_status_path(question_id):
    """Get the path to the status file for a question"""
    return os.path.join(RESULT_DIR, question_id, 'status.json')

def get_question_metadata_path(question_id):
    """Get the path to the metadata file for a question"""
    return os.path.join(RESULT_DIR, question_id, 'metadata.json')

def save_question_metadata(question_id, metadata):
    """Save metadata for a question processing session"""
    metadata_path = get_question_metadata_path(question_id)
    try:
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Error saving metadata for question {question_id}: {e}")
        return False

def load_question_metadata(question_id):
    """Load metadata for a question processing session"""
    metadata_path = get_question_metadata_path(question_id)
    try:
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return None
    except Exception as e:
        logger.error(f"Error loading metadata for question {question_id}: {e}")
        return None
    
def extract_answer_text(answer_data):
    answer = answer_data.get('answer')
    
    # Handle list format
    if isinstance(answer, list) and len(answer) > 0:
        answer_text = answer[0].strip()
    elif isinstance(answer, str):
        answer_text = answer.strip()
    else:
        return None
    
    # Check for valid answer (not null, empty, or "NULL")
    if answer_text and answer_text.upper() != 'NULL':
        return answer_text
    
    return None

def check_answer_ready(question_id):
    """Check if answer is ready for a question with better error handling"""
    answer_path = get_question_answer_path(question_id)
    
    try:
        # Check if the file exists and has content
        if not os.path.exists(answer_path):
            logger.info(f"Answer file not found for question {question_id}")
            return {'ready': False, 'reason': 'file_not_found'}
        
        # Check if file has content (avoid reading empty/corrupt files)
        file_size = os.path.getsize(answer_path)
        if file_size == 0:
            logger.info(f"Answer file is empty for question {question_id}")
            return {'ready': False, 'reason': 'file_empty'}
        
        # Try to read and parse the file
        try:
            with open(answer_path, 'r', encoding='utf-8') as f:
                answer_data = json.load(f)
        except json.JSONDecodeError as json_error:
            logger.warning(f"Invalid JSON in answer file for question {question_id}: {json_error}")
            return {'ready': False, 'reason': 'invalid_json'}
        except Exception as read_error:
            logger.error(f"Error reading answer file for question {question_id}: {read_error}")
            return {'ready': False, 'reason': 'read_error', 'error': str(read_error)}
        
        # Extract answer text with better validation
        answer_text = extract_answer_text(answer_data)
        question_text = answer_data.get('question', [''])[0] if isinstance(answer_data.get('question'), list) else answer_data.get('question', '')
        
        # Check if we have a valid answer
        if answer_text and answer_text.strip():
            logger.info(f"Valid answer found for question {question_id}")
            return {
                'ready': True,
                'answer': answer_text,
                'question': question_text,
                'timestamp': answer_data.get('timestamp', time.time())
            }
        else:
            logger.info(f"Answer not ready yet for question {question_id} (answer: {answer_text})")
            return {'ready': False, 'reason': 'answer_not_ready'}
        
    except Exception as e:
        logger.error(f"Unexpected error checking answer for question {question_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {'ready': False, 'error': str(e), 'reason': 'unexpected_error'}


def get_current_provenance_count(question_id):
    """Get the current number of provenances available for a question with debugging"""
    provenance_path = get_question_provenance_path(question_id)
    logger.info(f"Checking provenance count for question {question_id}")
    logger.info(f"Provenance path: {provenance_path}")
    logger.info(f"File exists: {os.path.exists(provenance_path)}")
    
    try:
        if os.path.exists(provenance_path):
            # Check file size
            file_size = os.path.getsize(provenance_path)
            logger.info(f"Provenance file size: {file_size} bytes")
            
            with open(provenance_path, 'r', encoding='utf-8') as f:
                file_content = f.read()
                logger.info(f"Raw file content: {file_content[:200]}...")  # First 200 chars
                
            # Reset file pointer and parse JSON
            with open(provenance_path, 'r', encoding='utf-8') as f:
                provenance_data = json.load(f)
                logger.info(f"Parsed JSON type: {type(provenance_data)}")
                logger.info(f"Parsed JSON content: {provenance_data}")
            
            if isinstance(provenance_data, list):
                count = len(provenance_data)
                logger.info(f"Provenance count: {count}")
                return count
            else:
                logger.warning(f"Provenance data is not a list: {type(provenance_data)}")
                return 0
        else:
            logger.info(f"Provenance file does not exist: {provenance_path}")
            return 0
        
    except json.JSONDecodeError as json_error:
        logger.error(f"JSON decode error in provenance file for question {question_id}: {json_error}")
        # Try to read raw content for debugging
        try:
            with open(provenance_path, 'r', encoding='utf-8') as f:
                raw_content = f.read()
            logger.error(f"Raw file content causing JSON error: {raw_content}")
        except:
            pass
        return 0
    except Exception as e:
        logger.error(f"Error checking provenance count for question {question_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return 0

def get_next_provenance(question_id, current_count=0):
    """Get the next available provenance for a question"""
    provenance_path = get_question_provenance_path(question_id)
    metadata = load_question_metadata(question_id)
    
    try:
        if os.path.exists(provenance_path):
            with open(provenance_path, 'r', encoding='utf-8') as f:
                provenance_data = json.load(f)
            
            if isinstance(provenance_data, list):
                # Check if we have more provenances than the user has seen
                if len(provenance_data) > current_count:
                    # Check if we've hit the user-facing limit
                    if current_count >= EXPERIMENT_TOP_K:
                        return {
                            'has_more': False,
                            'reason': 'limit_reached',
                            'message': f'Maximum of {EXPERIMENT_TOP_K} provenances shown'
                        }
                    
                    # Return the next provenance
                    next_provenance = provenance_data[current_count]
                    
                    return {
                        'has_more': True,
                        'provenance': next_provenance,
                        'provenance_index': current_count,
                        'total_available': len(provenance_data),
                        'remaining': min(len(provenance_data) - current_count - 1, EXPERIMENT_TOP_K - current_count - 1)
                    }
        
        # Check if processing is still ongoing
        processing_complete = metadata.get('processing_complete', False) if metadata else False
        
        if not processing_complete:
            # Processing is still ongoing, provenances might be generated later
            return {
                'has_more': False,
                'reason': 'processing_ongoing',
                'message': 'Evidence sources are still being generated. Please try again in a moment.',
                'retry_suggested': True
            }
        else:
            # Processing is complete but no provenances available
            return {
                'has_more': False,
                'reason': 'processing_complete_no_provenances',
                'message': 'No evidence sources were found for this answer'
            }
        
    except Exception as e:
        logger.error(f"Error getting next provenance for question {question_id}: {e}")
        return {
            'has_more': False,
            'reason': 'error',
            'message': f'Error retrieving provenance: {str(e)}'
        }
    
# =============================================================================
# DOCUMENT MANAGEMENT
# =============================================================================

def get_all_available_pdfs():
    """Scan both upload and preload folders and return all PDFs with unified metadata"""
    all_documents = []
    
    # Check uploads folder
    uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
    if os.path.exists(uploads_dir):
        all_documents.extend(scan_folder_for_pdfs(uploads_dir, is_preloaded=False))

    # check gdrive downloads folder
    #if os.path.exists(DOWNLOAD_DIR):
    #    for batch_dir in os.listdir(DOWNLOAD_DIR):
    #        batch_path = os.path.join(DOWNLOAD_DIR, batch_dir)
    #        logger.info(batch_path)
    #        for item in os.listdir(batch_path):
    #            logger.info(item)
    #            if item.endswith('.pdf'):
    #                base_name = os.path.splitext(item)[0]
    #                metadata_file = os.path.join(batch_path, f"{base_name}_metadata.json")
    #                if os.path.exists(metadata_file):
    #                    try:
    #                        with open(metadata_file, 'r', encoding='utf-8') as f:
    #                            metadata = json.load(f)
    #                        # Add filepath to metadata
    #                        metadata['source_folder'] = 'gdrive_downloads'
    #                        all_documents.append(metadata)
    #                    except Exception as e:
    #                        print(f"Failed to load metadata for {item}: {e}")
    #
    return all_documents

def scan_folder_for_pdfs(folder_path, is_preloaded=True):
    """Unified PDF scanning for any folder"""
    documents = []
    
    try:
        if not os.path.exists(folder_path):
            return []
        
        # Get all PDF files
        pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
        
        for pdf_file in pdf_files:
            try:
                filepath = os.path.join(folder_path, pdf_file)
                if not os.path.exists(filepath):
                    continue
                logger.info(f"Processing PDF: {pdf_file} (Preloaded: {is_preloaded})")
                base_name = pdf_file.replace('.pdf', '')
                metadata_file = os.path.join(folder_path, f"{base_name}_metadata.json")
                sentences_file = get_document_sentences_path(base_name)
                logger.info(f"Sentences file: {sentences_file}")
                # Generate consistent document ID
                file_stat = os.stat(filepath)
    
                # Check if we already have processed this file
                if os.path.exists(metadata_file) and os.path.exists(sentences_file):
                    try:
                        with open(metadata_file, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Update document ID and source info
                        metadata['filepath'] = filepath
                        metadata['is_preloaded'] = is_preloaded
                        metadata['source_folder'] = 'preloaded' if is_preloaded else 'uploads'
                        
                        if os.path.exists(filepath):
                            documents.append(metadata)
                        continue
                    except Exception as e:
                        print(f"Failed to load existing metadata for {pdf_file}: {e}")
                
                # Process new PDF
                try:
                    pdf_text = extract_text(filepath)
                    sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)

                    sentences_saved = save_document_sentences(pdf_file, sentences)

                    metadata = {
                        'filename': pdf_file,
                        'filepath': filepath,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences_saved),
                        'is_preloaded': is_preloaded,
                        'source_folder': 'preloaded' if is_preloaded else 'uploads',
                        'processed_at': time.time(),
                        'base_name': base_name
                    }
                    
                    # Save metadata
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
        
                    documents.append(metadata)
                    
                except Exception as text_error:
                    print(f"Failed to extract text from {pdf_file}: {text_error}")
                    continue
                
            except Exception as e:
                print(f"Error processing {pdf_file}: {e}")
                continue
    
    except Exception as e:
        print(f"Error scanning folder {folder_path}: {e}")
    
    return documents

@main.route('/documents', methods=['GET'])
def get_available_documents():
    """Get all available documents from upload folder"""
    try:
        all_documents = get_all_available_pdfs()
        
        # Separate for UI purposes but same underlying logic
        uploaded_docs = [doc for doc in all_documents]
        
        return jsonify({
            'success': True,
            'documents': uploaded_docs,
            'total_documents': len(all_documents)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/documents/<filename>', methods=['GET'])
def serve_document_pdf(filename):
    """Unified PDF serving - works for any document with direct file response"""
    try:
        logger.info(f"🔄 Serving PDF for document: {filename}")
        
        
        uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        uploads_path = os.path.join(uploads_dir, filename)

        # For Windows compatibility, try multiple path strategies
        working_path = None
        
        if os.path.exists(uploads_path):
            logger.info(f"📍 Found PDF in uploads: {uploads_path}")
            working_path = uploads_path
        

        # Convert to absolute path for safety
        working_path = os.path.abspath(os.path.normpath(working_path))
        logger.info(f"📍 Final absolute path: {working_path}")
        
        # Final verification
        if not os.path.exists(working_path):
            logger.error(f"❌ Final verification failed - file not found: {working_path}")
            return jsonify({'error': 'PDF file verification failed'}), 404
        
        # Serve the file directly using send_file instead of send_from_directory
        try:
            logger.info(f"✅ Attempting to serve PDF directly: {working_path}")
            
            # Use send_file with the full path - this bypasses send_from_directory issues
            response = send_file(
                working_path,
                mimetype='application/pdf',
                as_attachment=False,
                download_name=filename  # This sets the filename for the browser
            )
            
            logger.info(f"✅ Successfully served PDF: {filename}")
            return response
            
        except Exception as serve_error:
            logger.error(f"❌ Error in send_file: {serve_error}")
            import traceback
            logger.error(f"Send file traceback: {traceback.format_exc()}")
            return jsonify({'error': f'Failed to serve PDF: {str(serve_error)}'}), 500
        
    except Exception as e:
        logger.error(f"❌ PDF serving error for document {filename}: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({'error': f'PDF serving error: {str(e)}'}), 500


@main.route('/uploads/<filename>', methods=['GET'])
def serve_uploaded_file(filename):
    """Serve files from the uploads directory"""
    try:
        uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        print(f"Serving file {filename} from {uploads_dir}")
        return send_from_directory(uploads_dir, filename)
    except Exception as e:
        #logger.error(f"Error serving uploaded file {filename}: {e}")
        return jsonify({'error': 'File not found'}), 404
    
@main.route('/documents/<filename>/sentences', methods=['GET'])
def get_document_sentences(filename):
    """Get sentences for a specific document from the dedicated sentences directory"""
    try:
        # Load sentences from dedicated directory
        sentences = load_document_sentences(filename)
        
        if sentences is None:
            return jsonify({'error': 'Sentences file not found'}), 404
        
        return jsonify({
            'success': True,
            'sentences': sentences,
            'filename': filename,
            'count': len(sentences)
        })
    except Exception as e:
        logger.error(f"Error loading sentences for {filename}: {e}")
        return jsonify({'error': f'Failed to load sentences: {str(e)}'}), 500
    
# =============================================================================
# Question Library Routes
# =============================================================================

@main.route('/questions-library', methods=['GET'])
def get_questions_library():
    """Get the questions library"""
    try:
        library = load_questions_library()
        if library:
            return jsonify({
                'success': True,
                'library': library
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to load questions library'
            }), 500
    except Exception as e:
        logger.error(f"Error getting questions library: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/questions-library', methods=['POST'])
def add_question_to_library_route():
    """Add a question to the library"""
    try:
        data = request.json
        question_text = data.get('question_text', '').strip()
        category = data.get('category', 'Custom')
        description = data.get('description', '')
        is_favorite = data.get('is_favorite', False)
        
        if not question_text:
            return jsonify({
                'success': False,
                'error': 'Question text is required'
            }), 400
        
        success = add_question_to_library(question_text, category, description, is_favorite)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Question added to library successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to add question to library'
            }), 500
            
    except Exception as e:
        logger.error(f"Error adding question to library: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/questions-library/<question_id>', methods=['DELETE'])
def remove_question_from_library(question_id):
    """Remove a question from the library"""
    try:
        library = load_questions_library()
        if not library:
            return jsonify({
                'success': False,
                'error': 'Failed to load questions library'
            }), 500
        
        # Find and remove the question
        original_count = len(library['questions'])
        library['questions'] = [q for q in library['questions'] if q['id'] != question_id]
        
        if len(library['questions']) < original_count:
            success = save_questions_library(library)
            if success:
                return jsonify({
                    'success': True,
                    'message': 'Question removed from library'
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Failed to save updated library'
                }), 500
        else:
            return jsonify({
                'success': False,
                'error': 'Question not found in library'
            }), 404
            
    except Exception as e:
        logger.error(f"Error removing question from library: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/questions-library/<question_id>', methods=['PUT'])
def update_question_in_library(question_id):
    """Update a question in the library"""
    try:
        data = request.json
        library = load_questions_library()
        if not library:
            return jsonify({
                'success': False,
                'error': 'Failed to load questions library'
            }), 500
        
        # Find and update the question
        question_found = False
        for question in library['questions']:
            if question['id'] == question_id:
                question_found = True
                
                # Update allowed fields
                if 'question_text' in data:
                    question['text'] = data['question_text'].strip()
                if 'category' in data:
                    question['category'] = data['category']
                if 'description' in data:
                    question['description'] = data['description']
                if 'is_favorite' in data:
                    question['is_favorite'] = data['is_favorite']
                if 'tags' in data:
                    question['tags'] = data['tags']
                
                break
        
        if not question_found:
            return jsonify({
                'success': False,
                'error': 'Question not found in library'
            }), 404
        
        success = save_questions_library(library)
        if success:
            return jsonify({
                'success': True,
                'message': 'Question updated successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to save updated library'
            }), 500
            
    except Exception as e:
        logger.error(f"Error updating question in library: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

# =============================================================================
# File Upload Routes (keeping existing)
# =============================================================================

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract text from PDF
        pdf_text = extract_text(filepath)
        
        # Extract sentences for later use
        sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)

        sentences_saved = save_document_sentences(filename, sentences)
        
        # Store PDF metadata
        metadata = {
            'filename': filename,
            'filepath': filepath,
            'text_length': len(pdf_text),
            'sentence_count': len(sentences),
            'sentences_available': sentences_saved,
            'processed_at': time.time()
        }
        
        # Save metadata in uploads folder for compatibility
        base_name = filename.replace('.pdf', '')
        metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{base_name}_metadata.json")
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'message': 'File uploaded successfully',
            'metadata': {
                'sentence_count': len(sentences),
                'text_length': len(pdf_text),
                'sentences_available': sentences_saved
            }
        })
    
    return jsonify({'error': 'File type not allowed'}), 400

# =============================================================================
# Question Processing Routes
# =============================================================================

    
@main.route('/ask', methods=['POST'])
def ask_question():
    data = request.json
    question = data.get('question')
    filename = data.get('filename')
    question_id_from_library = data.get('question_id')  # Optional: if from library
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
    # Load sentences from dedicated directory
    sentences = load_document_sentences(filename)
    if sentences is None:
        return jsonify({'error': 'Document sentences not found. Please re-upload the document.'}), 404
    
    # Get PDF data
    filepath = os.path.join(UPLOAD_DIR, filename)
    print(f"Processing question for file: {filepath}")
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'PDF file not found'}), 404
    
    # Extract text from PDF
    pdf_text = extract_text(filepath)
    
    # Create result path for this question
    question_backend_id = str(int(time.time()))
    result_path = os.path.join(RESULT_DIR, question_backend_id)
    os.makedirs(result_path, exist_ok=True)
    result_path = result_path + os.sep
    
    # Save question metadata
    metadata = {
        'question_id': question_backend_id,
        'question_text': question,
        'filename': filename,
        'question_id_from_library': question_id_from_library,
        'created_at': time.time(),
        'max_provenances': EXPERIMENT_TOP_K,
        'user_provenance_count': 0,  # Track how many user has requested
        'answer_delivered': False,
        'processing_complete': False
    }
    save_question_metadata(question_backend_id, metadata)
    
    # Initialize answer file with null answer
    answer_path = get_question_answer_path(question_backend_id)
    initial_answer = {
        'question': question,
        'answer': None,
        'timestamp': None
    }
    with open(answer_path, 'w', encoding='utf-8') as f:
        json.dump(initial_answer, f, indent=2, ensure_ascii=False)
    
    # Initialize empty provenance file
    # provenance_path = get_question_provenance_path(question_backend_id)
    # with open(provenance_path, 'w', encoding='utf-8') as f:
    #     json.dump([], f)
    
    # Initialize process logs
    logs_path = os.path.join(os.path.join(RESULT_DIR, question_backend_id), 'process_logs.json')
    logs = {
        'status': 'started',
        'logs': [f"[{time.strftime('%H:%M:%S')}] Processing started: {question}"],
        'timestamp': time.time(),
        'question_id_from_library': question_id_from_library
    }
    with open(logs_path, 'w') as f:
        json.dump(logs, f)
    
    # Start processing in a separate thread
    def process_question():
        start_time = time.time()
        success = True
        error_message = None

        try:
            # Add log entry
            update_process_log(question_backend_id, f"Analyzing document with {len(pdf_text)} characters...")
            
            # Capture stdout to preserve the exact output format
            stdout_buffer = StringIO()
            stdout_backup = sys.stdout
            sys.stdout = stdout_buffer
            
            # Process the question using doc_provenance API
            # This will handle both answer writing and progressive provenance writing
            doc_provenance.divide_and_conquer_progressive_API(question, pdf_text, result_path)
            
            # Restore stdout
            sys.stdout = stdout_backup
            # Mark processing as complete
            update_process_log(question_backend_id, "Processing completed!", status="completed")
            
            # CRITICAL: Update metadata to show processing is complete
            metadata = load_question_metadata(question_backend_id)
            if metadata:
                metadata['processing_complete'] = True
                metadata['completed_at'] = time.time()
                metadata['processing_time'] = time.time() - start_time
                save_result = save_question_metadata(question_backend_id, metadata)
                logger.info(f"Updated metadata for question {question_backend_id}: {save_result}")
            else:
                logger.error(f"Could not load metadata for question {question_backend_id}")
        
            
            # Create a status file to indicate all processing is done
            status_path = get_question_status_path(question_backend_id)
            final_provenance_count = get_current_provenance_count(question_backend_id)
            status_data = {
                "completed": True,
                "timestamp": time.time(),
                "total_provenance": final_provenance_count
            }

            try:
                with open(status_path, 'w') as f:
                    json.dump(status_data, f)
                logger.info(f"Created status file for question {question_backend_id}: {status_data}")
            except Exception as status_error:
                logger.error(f"Error creating status file: {status_error}")
                
        except Exception as e:
            logger.exception("Error processing question")
            update_process_log(question_backend_id, f"Error: {str(e)}", status="error")
            success = False
            error_message = str(e)

            # Restore stdout in case of error
            try:
                sys.stdout = stdout_backup
            except:
                pass

        finally:
            
            # Update metadata
            metadata = load_question_metadata(question_backend_id)
            if metadata:
                metadata['processing_complete'] = True
                metadata['completed_at'] = time.time()
                metadata['processing_time'] = time.time() - start_time

                if error_message:
                    metadata['error'] = error_message
                    
                save_question_metadata(question_backend_id, metadata)

            # Update question library usage if this was from the library
            if question_id_from_library:
                processing_time = time.time() - start_time
                update_question_usage(question_id_from_library, processing_time, success)
    
    thread = Thread(target=process_question)
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'question_id': question_backend_id,
        'message': 'Processing started'
    })

# Also improve the route handler
@main.route('/check-answer/<question_id>', methods=['GET'])
def check_answer(question_id):
    """Check if answer is ready for a question with improved error handling"""
    try:
        # Validate question_id format
        if not question_id or not question_id.strip():
            return jsonify({
                'success': False,
                'error': 'Invalid question ID'
            }), 400
        
        # Check if the question directory exists
        question_dir = os.path.join(RESULT_DIR, question_id)
        if not os.path.exists(question_dir):
            logger.warning(f"Question directory not found: {question_dir}")
            return jsonify({
                'success': False,
                'error': 'Question not found',
                'ready': False
            }), 404
        
        result = check_answer_ready(question_id)
        
        if result.get('ready', False):
            # Mark answer as delivered in metadata
            try:
                metadata = load_question_metadata(question_id)
                if metadata:
                    metadata['answer_delivered'] = True
                    metadata['answer_delivered_at'] = time.time()
                    save_question_metadata(question_id, metadata)
            except Exception as metadata_error:
                logger.warning(f"Failed to update metadata for question {question_id}: {metadata_error}")
                # Don't fail the entire request for metadata issues
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        logger.error(f"Error in check_answer route for question {question_id}: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}',
            'ready': False
        }), 500

@main.route('/get-next-provenance/<question_id>', methods=['POST'])
def get_next_provenance_route(question_id):
    """Get the next available provenance for a question"""
    try:
        data = request.json or {}
        current_count = data.get('current_count', 0)
        
        # Get the next provenance
        result = get_next_provenance(question_id, current_count)
        
        if result.get('has_more', False):
            # Update metadata to track user's provenance requests
            metadata = load_question_metadata(question_id)
            if metadata:
                metadata['user_provenance_count'] = current_count + 1
                metadata['last_provenance_request'] = time.time()
                save_question_metadata(question_id, metadata)
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        logger.error(f"Error getting next provenance for question {question_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/question-status/<question_id>', methods=['GET'])
def get_question_status(question_id):
    """Get comprehensive status for a question"""
    try:
        metadata = load_question_metadata(question_id)
        logger.info(f"Metadata for question {question_id}: {metadata}")
        answer_status = check_answer_ready(question_id)
        logger.info(f"Answer status for question {question_id}: {answer_status}")
        provenance_count = get_current_provenance_count(question_id)
        logger.info(f"Provenance count for question {question_id}: {provenance_count}")
        
        # Check status.json file for actual completion status
        status_path = get_question_status_path(question_id)
        actual_processing_complete = False
        if os.path.exists(status_path):
            try:
                with open(status_path, 'r') as f:
                    status_file_data = json.load(f)
                actual_processing_complete = status_file_data.get('completed', False)
                logger.info(f"Status file shows completed: {actual_processing_complete}")
            except Exception as status_error:
                logger.warning(f"Error reading status file: {status_error}")
        
        # Use the most accurate processing status:
        # 1. If status.json says completed, trust that
        # 2. Otherwise, use metadata
        processing_complete = actual_processing_complete or (metadata.get('processing_complete', False) if metadata else False)
        
        # Enhanced logic for can_request_more
        user_provenance_count = metadata.get('user_provenance_count', 0) if metadata else 0
        
        # Can request more if:
        # 1. There are provenances available that user hasn't requested
        # 2. OR processing is still ongoing (provenances might be generated later)
        # 3. AND user hasn't hit the maximum limit
        can_request_more = (
            (provenance_count > user_provenance_count or not processing_complete) 
            and user_provenance_count < EXPERIMENT_TOP_K
        )

        logger.info(f"Enhanced status logic:")
        logger.info(f"  - provenance_count: {provenance_count}")
        logger.info(f"  - user_provenance_count: {user_provenance_count}")
        logger.info(f"  - metadata processing_complete: {metadata.get('processing_complete', False) if metadata else False}")
        logger.info(f"  - status file processing_complete: {actual_processing_complete}")
        logger.info(f"  - final processing_complete: {processing_complete}")
        logger.info(f"  - can_request_more: {can_request_more}")
        
        status = {
            'question_id': question_id,
            'metadata': metadata,
            'answer_ready': answer_status.get('ready', False),
            'answer_delivered': metadata.get('answer_delivered', False) if metadata else False,
            'provenance_count': provenance_count,
            'user_provenance_count': user_provenance_count,
            'processing_complete': processing_complete,  # Use the corrected value
            'max_provenances': EXPERIMENT_TOP_K,
            'can_request_more': can_request_more
        }
        
        logger.info(f"Final status for question {question_id}: {status}")
        
        return jsonify({
            'success': True,
            'status': status
        })
        
    except Exception as e:
        logger.error(f"Error getting status for question {question_id}: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def update_process_log(question_id, message, status=None):
    """Add a new message to the process logs"""
    logs_path = os.path.join(RESULT_DIR, question_id, 'process_logs.json')
    try:
        with open(logs_path, 'r') as f:
            logs = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
    
    # Don't add timestamp for messages from doc_provenance
    if message.startswith('Top-') or message.startswith('Labeler') or message.startswith('Provenance:') or 'tokens:' in message or 'Time:' in message:
        log_entry = message
    else:
        # Add timestamp to the message
        log_entry = f"[{time.strftime('%H:%M:%S')}] {message}"
        
    logs['logs'].append(log_entry)
    
    # Update status if provided
    if status:
        logs['status'] = status
    
    # Update timestamp
    logs['timestamp'] = time.time()
    
    # Write back to the file
    with open(logs_path, 'w') as f:
        json.dump(logs, f)
    
    logger.info(f"Question {question_id}: {message}")

@main.route('/results/<question_id>', methods=['GET'])
def get_results(question_id):
    # Check if the provenance file exists
    provenance_path = os.path.join(RESULT_DIR, question_id, 'provenance.json')
    if not os.path.exists(provenance_path):
        return jsonify({'error': 'Results not found'}), 404
    
    # Read the provenance file
    with open(provenance_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Check if there's an answer file
    answer_path = os.path.join(RESULT_DIR, question_id, 'answer.json')
    answer = None
    if os.path.exists(answer_path):
        with open(answer_path, 'r') as f:
            answer = f.read().strip()
    
    return jsonify({
        'success': True,
        'provenance': data,
        'answer': answer
    })

@main.route('/check-progress/<question_id>', methods=['GET'])
def check_progress(question_id):

    question_dir = os.path.join(RESULT_DIR, question_id)
    # Read the provenance file to check progress
    provenance_path = os.path.join(question_dir, 'provenance.json')
    logs_path = os.path.join(question_dir, 'process_logs.json')
    
    # Get process logs if available
    logs = []
    status = 'processing'
    if os.path.exists(logs_path):
        try:
            with open(logs_path, 'r') as f:
                log_data = json.load(f)
                logs = log_data.get('logs', [])
                status = log_data.get('status', 'processing')
        except json.JSONDecodeError:
            pass

    # Check if we have an answer file
    answer_file = os.path.join(question_dir, 'answer.json')
    has_answer = os.path.exists(answer_file) and os.path.getsize(answer_file) > 0

    
    if not os.path.exists(provenance_path):
        return jsonify({
            'progress': 0, 
            'done': False,
            'logs': logs,
            'status': status
        })
    
    try:
        with open(provenance_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Make sure data is an array
        provenance_data = data if isinstance(data, list) else []
        
        # Determine if processing is done
        done = status == 'completed' or len(provenance_data) > 0
        
        return jsonify({
            'progress': len(provenance_data),
            'done': done,
            'data': provenance_data,
            'logs': logs,
            'status': status
        })
    except json.JSONDecodeError:
        # File might be being written to
        return jsonify({
            'progress': 0, 
            'done': False,
            'logs': logs,
            'status': status
        })
        
@main.route('/sentences/<document>', methods=['GET'])
def get_sentences(question_id):
    # Get sentence IDs from query parameters
    sentence_ids = request.args.get('ids')
    if not sentence_ids:
        return jsonify({'error': 'No sentence IDs provided'}), 400
    
    # Parse sentence IDs
    try:
        sentence_ids = [int(id) for id in sentence_ids.split(',')]
    except ValueError:
        return jsonify({'error': 'Invalid sentence IDs format'}), 400
    
    # Get sentences file
    sentences_path = os.path.join(RESULT_DIR, question_id, 'sentences.json')
    if not os.path.exists(sentences_path):
        return jsonify({'error': 'Sentences not found'}), 404
    
    # Read sentences
    with open(sentences_path, 'r', encoding='utf-8') as f:
        sentences = json.load(f)
    
    # Get requested sentences
    result = {}
    for id in sentence_ids:
        if 0 <= id < len(sentences):
            result[id] = sentences[id]
        else:
            result[id] = f"Sentence ID {id} out of range"
    
    return jsonify({
        'success': True,
        'sentences': result
    })

@main.route('/status/<question_id>', methods=['GET'])
def check_status(question_id):
    """Check if processing is fully complete and all provenance entries are available"""
    status_path = os.path.join(RESULT_DIR, question_id, 'status.json')
    
    if os.path.exists(status_path):
        try:
            with open(status_path, 'r') as f:
                status_data = json.load(f)
            return jsonify(status_data)
        except:
            pass
    
    # If no status file exists or there was an error reading it
    return jsonify({
        "completed": False,
        "timestamp": time.time()
    }) 

def parse_provenance_output(output, question_dir):
    """Parse provenance output and save progressively"""
    provenance_entries = []
    current_entry = None
    processed_count = 0
    
    for line in output.strip().split('\n'):
        if line.strip():
            update_process_log(question_dir, line.strip())
            
            # Parse Top-X provenance lines
            if line.startswith('Top-'):
                if current_entry is not None:
                    provenance_entries.append(current_entry)
                    processed_count += 1

                 # Safety limit to prevent infinite processing
                if processed_count >= MAX_PROVENANCE_PROCESSING:
                    update_process_log(question_dir, f"Reached maximum processing limit of {MAX_PROVENANCE_PROCESSING} provenances.")
                    break
                
                try:
                    parts = line.split('provenance:')
                    if len(parts) >= 2:
                        id_part = parts[0].strip()
                        prov_id = int(id_part.split('-')[1].split()[0])
                        
                        ids_str = parts[1].strip().strip('[]')
                        prov_ids = [int(id_str.strip()) for id_str in ids_str.split(',') if id_str.strip()]
                        
                        current_entry = {
                            "provenance_id": prov_id,
                            "sentences_ids": prov_ids,
                            "time": 0,
                            "input_token_size": 0,
                            "output_token_size": 0,
                            "user_visible": processed_count < EXPERIMENT_TOP_K  # Only show if within top K
                        }

                        if len(provenance_entries) >= 4:
                            break

                except Exception as e:
                    pass
            
            # Parse time and token information
            elif line.startswith('Time:') and current_entry is not None:
                try:
                    current_entry["time"] = float(line.split(':')[1].strip())
                    
                    # PROGRESSIVE SAVING in session directory
                    provenance_file = os.path.join(question_dir, 'provenance.json')
                    temp_entries = provenance_entries.copy()
                    if current_entry is not None:
                        temp_entries.append(current_entry)
                    
                    with open(provenance_file, 'w', encoding='utf-8') as f:
                        json.dump(temp_entries, f, indent=2, ensure_ascii=False)
                except:
                    pass
            
            elif line.startswith('Input tokens:') and current_entry is not None:
                try:
                    current_entry["input_token_size"] = int(line.split(':')[1].strip())
                except:
                    pass
            
            elif line.startswith('Output tokens:') and current_entry is not None:
                try:
                    current_entry["output_token_size"] = int(line.split(':')[1].strip())
                except:
                    pass
    
    # Add final entry
    if current_entry is not None:
        provenance_entries.append(current_entry)
    
    return provenance_entries

# =============================================================================
# user study logging
# =============================================================================

# Configure logging for user study events
def setup_user_study_logging():
    """Setup dedicated logging for user study events"""
    
    # Create logs directory if it doesn't exist
    logs_dir = "logs/user_study"
    os.makedirs(logs_dir, exist_ok=True)
    
    # Create a dedicated logger for user study events
    user_study_logger = logging.getLogger('user_study')
    user_study_logger.setLevel(logging.INFO)
    
    # Create file handler with daily rotation
    log_filename = f"{logs_dir}/user_study_{datetime.now().strftime('%Y%m%d')}.jsonl"
    file_handler = logging.FileHandler(log_filename)
    file_handler.setLevel(logging.INFO)
    
    # Create formatter for JSON logs
    formatter = logging.Formatter('%(message)s')
    file_handler.setFormatter(formatter)
    
    # Add handler to logger (avoid duplicates)
    if not user_study_logger.handlers:
        user_study_logger.addHandler(file_handler)
    
    return user_study_logger

# Initialize the logger
user_study_logger = setup_user_study_logging()

@main.route('/user-study/log-event', methods=['POST', 'OPTIONS'])
def log_user_study_event():
    """
    Endpoint to receive and log user study events from the frontend
    Added OPTIONS method for CORS preflight requests
    """
    # Handle CORS preflight requests
    if request.method == 'OPTIONS':
        response = jsonify({'success': True})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        # Get the event data from request
        event_data = request.get_json()
        
        if not event_data:
            return jsonify({
                'success': False,
                'error': 'No event data provided'
            }), 400
        
        # Validate required fields
        required_fields = ['event_type', 'user_session_id', 'timestamp']
        missing_fields = [field for field in required_fields if field not in event_data]
        
        if missing_fields:
            return jsonify({
                'success': False,
                'error': f'Missing required fields: {", ".join(missing_fields)}'
            }), 400
        
        # Add server-side metadata
        enhanced_event = {
            **event_data,
            'server_timestamp': datetime.now().timestamp(),
            'server_iso_timestamp': datetime.now().isoformat(),
            'ip_address': request.environ.get('REMOTE_ADDR', 'unknown'),
            'forwarded_for': request.environ.get('HTTP_X_FORWARDED_FOR', None),
            'user_agent': request.environ.get('HTTP_USER_AGENT', event_data.get('user_agent', 'unknown'))
        }
        
        # Log the event as a JSON line
        user_study_logger.info(json.dumps(enhanced_event, ensure_ascii=False))
        
        # Also log to console for development
        print(f"📊 User Study Event: {enhanced_event['event_type']} - {enhanced_event['user_session_id']}")
        
        response = jsonify({
            'success': True,
            'message': 'Event logged successfully',
            'event_type': enhanced_event['event_type'],
            'server_timestamp': enhanced_event['server_timestamp']
        })
        
        # Add CORS headers to response
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except json.JSONDecodeError:
        return jsonify({
            'success': False,
            'error': 'Invalid JSON data'
        }), 400
        
    except Exception as e:
        print(f"❌ Error logging user study event: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Internal server error while logging event'
        }), 500
@main.route('/api/user-study/session-info', methods=['GET'])
def get_session_info():
    """
    Endpoint to get session information for the frontend
    This can be used to retrieve algorithm method assignments, etc.
    """
    try:
        # can implement session-based algorithm assignment here
        # For now, return basic session info
        
        session_info = {
            'server_time': datetime.now().isoformat(),
            'algorithm_method': 'default',  # can implement rotation logic here
            'processing_method': 'session-based',
            'max_provenances': 5,
            'session_id': f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        }
        
        return jsonify({
            'success': True,
            'session_info': session_info
        })
        
    except Exception as e:
        print(f"❌ Error getting session info: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to get session info'
        }), 500

@main.route('/api/user-study/export-logs', methods=['GET'])
def export_user_study_logs():
    """
    Endpoint to export user study logs for analysis
    Add authentication/authorization as needed for your study
    """
    try:
        # Get date parameter (optional)
        date_str = request.args.get('date', datetime.now().strftime('%Y%m%d'))
        
        # Build log file path
        log_file = f"logs/user_study/user_study_{date_str}.jsonl"
        
        if not os.path.exists(log_file):
            return jsonify({
                'success': False,
                'error': f'No log file found for date {date_str}'
            }), 404
        
        # Read and return log file contents
        with open(log_file, 'r', encoding='utf-8') as f:
            log_lines = [json.loads(line.strip()) for line in f if line.strip()]
        
        return jsonify({
            'success': True,
            'date': date_str,
            'event_count': len(log_lines),
            'events': log_lines
        })
        
    except Exception as e:
        print(f"❌ Error exporting logs: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to export logs'
        }), 500

@main.route('/api/user-study/stats', methods=['GET'])
def get_user_study_stats():
    """
    Endpoint to get basic statistics about user study events
    """
    try:
        date_str = request.args.get('date', datetime.now().strftime('%Y%m%d'))
        log_file = f"logs/user_study/user_study_{date_str}.jsonl"
        
        if not os.path.exists(log_file):
            return jsonify({
                'success': True,
                'stats': {
                    'total_events': 0,
                    'unique_sessions': 0,
                    'event_types': {}
                }
            })
        
        # Analyze log file
        event_types = {}
        sessions = set()
        total_events = 0
        
        with open(log_file, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        event = json.loads(line.strip())
                        total_events += 1
                        
                        # Count event types
                        event_type = event.get('event_type', 'unknown')
                        event_types[event_type] = event_types.get(event_type, 0) + 1
                        
                        # Track unique sessions
                        if 'user_session_id' in event:
                            sessions.add(event['user_session_id'])
                            
                    except json.JSONDecodeError:
                        continue
        
        return jsonify({
            'success': True,
            'date': date_str,
            'stats': {
                'total_events': total_events,
                'unique_sessions': len(sessions),
                'event_types': event_types,
                'most_common_events': sorted(event_types.items(), key=lambda x: x[1], reverse=True)[:10]
            }
        })
        
    except Exception as e:
        print(f"❌ Error getting stats: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to get statistics'
        }), 500

# Utility function to analyze user study data
def analyze_user_study_session(user_session_id, date_str=None):
    """
    Analyze events for a specific user session
    This can be used for detailed session analysis
    """
    if not date_str:
        date_str = datetime.now().strftime('%Y%m%d')
    
    log_file = f"logs/user_study/user_study_{date_str}.jsonl"
    
    if not os.path.exists(log_file):
        return None
    
    session_events = []
    
    with open(log_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                try:
                    event = json.loads(line.strip())
                    if event.get('user_session_id') == user_session_id:
                        session_events.append(event)
                except json.JSONDecodeError:
                    continue
    
    # Sort events by timestamp
    session_events.sort(key=lambda x: x.get('timestamp', 0))
    
    # Analyze session
    analysis = {
        'session_id': user_session_id,
        'total_events': len(session_events),
        'start_time': session_events[0].get('iso_timestamp') if session_events else None,
        'end_time': session_events[-1].get('iso_timestamp') if session_events else None,
        'event_types': {},
        'documents_used': set(),
        'questions_asked': [],
        'feedback_submitted': False
    }
    
    for event in session_events:
        # Count event types
        event_type = event.get('event_type', 'unknown')
        analysis['event_types'][event_type] = analysis['event_types'].get(event_type, 0) + 1
        
        # Track documents
        if 'document_id' in event:
            analysis['documents_used'].add(event['document_id'])
        
        # Track questions
        if event_type == 'question_submitted':
            analysis['questions_asked'].append({
                'question_text': event.get('question_text'),
                'timestamp': event.get('iso_timestamp')
            })
        
        # Track feedback
        if event_type == 'feedback_submitted':
            analysis['feedback_submitted'] = True
    
    analysis['documents_used'] = list(analysis['documents_used'])
    
    return analysis

# Example usage in another endpoint
@main.route('/api/user-study/analyze-session/<session_id>', methods=['GET'])
def analyze_session_endpoint(session_id):
    """Get detailed analysis of a specific user session"""
    try:
        date_str = request.args.get('date', datetime.now().strftime('%Y%m%d'))
        analysis = analyze_user_study_session(session_id, date_str)
        
        if analysis is None:
            return jsonify({
                'success': False,
                'error': 'Session not found or no log file for date'
            }), 404
        
        return jsonify({
            'success': True,
            'analysis': analysis
        })
        
    except Exception as e:
        print(f"❌ Error analyzing session: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to analyze session'
        }), 

# ==============================================================================
# PDF PROCESSING ENDPOINTS
# ==============================================================================
@main.route('/process-pdf', methods=['POST'])
def process_pdf():
    """
    Process a PDF for sentence extraction and layout mapping
    
    Expected JSON payload:
    {
        "pdf_path": "/path/to/document.pdf",
        "force_reprocess": false,  # Optional: reprocess even if files exist
        "include_provenance_mapping": true  # Optional: create provenance mapper
    }
    
    Returns:
    {
        "success": true,
        "message": "PDF processed successfully",
        "files": {
            "sentences_file": "/path/to/document_sentences.json",
            "layout_file": "/path/to/document_layout.json"
        },
        "statistics": {
            "total_sentences": 150,
            "total_boxes": 342,
            "avg_confidence": 0.78
        },
        "processing_time": 12.5
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'pdf_path' not in data:
            return jsonify({
                "success": False,
                "error": "pdf_path is required"
            }), 400
        
        pdf_path = data['pdf_path']
        force_reprocess = data.get('force_reprocess', False)
        include_provenance_mapping = data.get('include_provenance_mapping', True)
        
        # Validate PDF path
        if not os.path.exists(pdf_path):
            return jsonify({
                "success": False,
                "error": f"PDF file not found: {pdf_path}"
            }), 404
        
        if not pdf_path.lower().endswith('.pdf'):
            return jsonify({
                "success": False,
                "error": "File must be a PDF"
            }), 400
        
        logger.info(f"Processing PDF: {pdf_path}")
        start_time = time.time()
        
        # Determine output directory (same as PDF)
        output_dir = os.path.dirname(pdf_path)
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        
        sentences_file = os.path.join(output_dir, f"{base_name}_sentences.json")
        layout_file = os.path.join(output_dir, f"{base_name}_layout.json")
        
        # Check if files already exist
        if not force_reprocess and os.path.exists(sentences_file) and os.path.exists(layout_file):
            logger.info(f"Files already exist for {base_name}, skipping processing")
            
            # Load existing statistics
            with open(layout_file, 'r', encoding='utf-8') as f:
                layout_data = json.load(f)
            
            processing_time = time.time() - start_time
            
            return jsonify({
                "success": True,
                "message": "PDF already processed (files exist)",
                "files": {
                    "sentences_file": sentences_file,
                    "layout_file": layout_file
                },
                "statistics": layout_data.get('metadata', {}).get('statistics', {}),
                "processing_time": processing_time,
                "was_cached": True
            })
        
        # Process the PDF
        logger.info(f"Starting PDF processing for {base_name}")
        sentences_file_path, layout_file_path, stats = save_compatible_sentence_data(
            pdf_path, 
            output_dir
        )
        
        processing_time = time.time() - start_time
        logger.info(f"PDF processing completed in {processing_time:.2f}s")
        
        # Initialize provenance mapper if requested
        provenance_mapper_ready = False
        if include_provenance_mapping:
            try:
                mapper = ProvenanceLayoutMapper(layout_file_path, debug=False)
                provenance_mapper_ready = True
                logger.info("Provenance mapper initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize provenance mapper: {e}")
        
        return jsonify({
            "success": True,
            "message": "PDF processed successfully",
            "files": {
                "sentences_file": sentences_file_path,
                "layout_file": layout_file_path
            },
            "statistics": stats,
            "processing_time": processing_time,
            "provenance_mapper_ready": provenance_mapper_ready,
            "was_cached": False
        })
        
    except Exception as e:
        logger.error(f"Error processing PDF: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Processing failed: {str(e)}"
        }), 500
    
@main.route('/upload-and-process', methods=['POST'])
def upload_and_process_pdf():
    """
    Upload a PDF file and process it immediately
    
    Expects multipart/form-data with:
    - file: PDF file
    - force_reprocess: optional boolean
    
    Returns same format as /api/process-pdf
    """
    try:
        if 'file' not in request.files:
            return jsonify({
                "success": False,
                "error": "No file uploaded"
            }), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({
                "success": False,
                "error": "No file selected"
            }), 400
        
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({
                "success": False,
                "error": "File must be a PDF"
            }), 400
        
        # Save uploaded file
        filename = secure_filename(file.filename)
        upload_dir = current_app.config.get('UPLOAD_FOLDER', 'uploads')
        os.makedirs(upload_dir, exist_ok=True)
        
        pdf_path = os.path.join(upload_dir, filename)
        file.save(pdf_path)
        
        logger.info(f"File uploaded: {pdf_path}")
        
        # Process the uploaded PDF
        force_reprocess = request.form.get('force_reprocess', 'false').lower() == 'true'
        
        # Call the process_pdf function internally
        process_data = {
            'pdf_path': pdf_path,
            'force_reprocess': force_reprocess,
            'include_provenance_mapping': True
        }
        
        # Use the existing process logic
        start_time = time.time()
        output_dir = os.path.dirname(pdf_path)
        
        sentences_file_path, layout_file_path, stats = save_compatible_sentence_data(
            pdf_path, 
            output_dir
        )
        
        processing_time = time.time() - start_time
        
        # Initialize provenance mapper
        provenance_mapper_ready = False
        try:
            mapper = ProvenanceLayoutMapper(layout_file_path, debug=False)
            provenance_mapper_ready = True
        except Exception as e:
            logger.warning(f"Failed to initialize provenance mapper: {e}")
        
        return jsonify({
            "success": True,
            "message": "PDF uploaded and processed successfully",
            "filename": filename,
            "pdf_path": pdf_path,
            "files": {
                "sentences_file": sentences_file_path,
                "layout_file": layout_file_path
            },
            "statistics": stats,
            "processing_time": processing_time,
            "provenance_mapper_ready": provenance_mapper_ready
        })
        
    except Exception as e:
        logger.error(f"Error uploading and processing PDF: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Upload and processing failed: {str(e)}"
        }), 500

@main.route('/documents/<filename>/provenance-boxes', methods=['POST'])
def get_provenance_highlighting_boxes(filename):
    """
    Convert provenance sentence IDs to PDF highlighting boxes
    
    Expected payload:
    {
        "sentence_ids": [4, 5, 6],
        "provenance_id": 1
    }
    """
    try:
        data = request.get_json()
        sentence_ids = data.get('sentence_ids', [])
        
        if not sentence_ids:
            return jsonify({'success': False, 'error': 'No sentence IDs provided'}), 400
        
        # Find layout file for this document
        base_name = filename.replace('.pdf', '')
        layout_file_paths = [
            os.path.join(current_app.config.get('UPLOAD_FOLDER', 'app/uploads'), f"{base_name}_layout.json"),
            # Add other possible paths
        ]
        
        layout_file = None
        for path in layout_file_paths:
            if os.path.exists(path):
                layout_file = path
                break
        
        if not layout_file:
            return jsonify({'success': False, 'error': 'Layout data not available'}), 404
        
        # Use your existing provenance mapper
        mapper = ProvenanceLayoutMapper(layout_file, debug=False)
        bounding_boxes = mapper.get_provenance_bounding_boxes(sentence_ids)
        stats = mapper.get_provenance_statistics(sentence_ids)
        
        return jsonify({
            'success': True,
            'bounding_boxes': bounding_boxes,
            'statistics': stats,
            'sentence_ids': sentence_ids
        })
        
    except Exception as e:
        logger.error(f"Error getting provenance boxes for {filename}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    
@main.route('/documents/<filename>/provenance-boxes-precise', methods=['POST'])
def get_provenance_highlighting_boxes_precise(filename):
    """
    Get precise bounding boxes for provenance text (not just sentences)
    """
    try:
        data = request.get_json()
        sentence_ids = data.get('sentence_ids', [])
        provenance_id = data.get('provenance_id')
        provenance_text = data.get('provenance_text', '')  # New: actual text to highlight
        
        if not sentence_ids:
            return jsonify({'success': False, 'error': 'No sentence IDs provided'}), 400
        
        # Find layout file
        base_name = filename.replace('.pdf', '')
        layout_file_paths = [
            os.path.join(current_app.config.get('UPLOAD_FOLDER', 'app/uploads'), f"{base_name}_layout.json"),
            os.path.join(UPLOAD_DIR, f"{base_name}_layout.json"),
        ]
        
        layout_file = None
        for path in layout_file_paths:
            if os.path.exists(path):
                layout_file = path
                break
        
        if not layout_file:
            return jsonify({'success': False, 'error': 'Layout data not available'}), 404
        
        # If we have provenance text, do precise matching
        if provenance_text and len(provenance_text.strip()) > 10:
            logger.info(f"Doing precise text matching for: {provenance_text[:50]}...")
            precise_boxes = get_precise_text_boxes(layout_file, sentence_ids, provenance_text)
            
            if precise_boxes:
                return jsonify({
                    'success': True,
                    'bounding_boxes': precise_boxes,
                    'statistics': calculate_box_statistics(precise_boxes),
                    'sentence_ids': sentence_ids,
                    'match_type': 'precise_text',
                    'provenance_text': provenance_text
                })
        
        # Fallback to sentence-level matching
        logger.info(f"Falling back to sentence-level matching for {len(sentence_ids)} sentences")
        from .provenance_layout_mapper import ProvenanceLayoutMapper
        mapper = ProvenanceLayoutMapper(layout_file, debug=False)
        bounding_boxes = mapper.get_provenance_bounding_boxes(sentence_ids)
        stats = mapper.get_provenance_statistics(sentence_ids)
        
        return jsonify({
            'success': True,
            'bounding_boxes': bounding_boxes,
            'statistics': stats,
            'sentence_ids': sentence_ids,
            'match_type': 'sentence_level'
        })
        
    except Exception as e:
        logger.error(f"Error getting precise provenance boxes for {filename}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def get_precise_text_boxes(layout_file, sentence_ids, provenance_text):
    """
    Find bounding boxes for provenance text WITHIN the specified sentences only
    """
    import json
    import re
    from difflib import SequenceMatcher
    
    try:
        with open(layout_file, 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        # Clean the provenance text for matching
        clean_provenance = re.sub(r'\s+', ' ', provenance_text.lower().strip())
        clean_provenance = re.sub(r'[^\w\s]', '', clean_provenance)
        
        if len(clean_provenance) < 5:
            logger.warning("Provenance text too short for precise matching")
            return {}
        
        logger.info(f"Searching for '{clean_provenance[:50]}...' within {len(sentence_ids)} specific sentences")
        
        precise_boxes = {}
        
        # For each sentence ID, constrain search to that sentence's area
        for sentence_id in sentence_ids:
            sentence_data = None
            for sent in layout_data.get('sentences', []):
                if sent.get('sentence_id') == sentence_id:
                    sentence_data = sent
                    break
            
            if not sentence_data or not sentence_data.get('bounding_boxes'):
                logger.warning(f"No bounding boxes found for sentence {sentence_id}")
                continue
            
            # Get the sentence's bounding area to constrain our search
            sentence_bounds = sentence_data['bounding_boxes']
            sentence_page = sentence_data.get('primary_page', sentence_bounds[0].get('page', 1))
            
            # Get page layout
            page_layout = None
            for page in layout_data.get('pages_layout', []):
                if page.get('page_num') == sentence_page:
                    page_layout = page
                    break
            
            if not page_layout or not page_layout.get('elements'):
                logger.warning(f"No page layout found for sentence {sentence_id} on page {sentence_page}")
                continue
            
            logger.info(f"Searching within sentence {sentence_id} bounds on page {sentence_page}")
            
            # Create search areas based on sentence bounds (with padding)
            search_areas = []
            for bound in sentence_bounds:
                search_areas.append({
                    'x0': bound.get('x0', 0) - 10,
                    'y0': bound.get('y0', 0) - 5, 
                    'x1': bound.get('x1', 100) + 10,
                    'y1': bound.get('y1', 20) + 5
                })
            
            # Search through page elements, but only those within sentence bounds
            matching_boxes = []
            
            for element in page_layout['elements']:
                if not element.get('text') or len(element['text']) < 3:
                    continue
                
                # Check if element overlaps with any sentence search area
                element_in_sentence_area = False
                for area in search_areas:
                    if not (element.get('x1', 0) < area['x0'] or 
                           element.get('x0', 0) > area['x1'] or
                           element.get('y1', 0) < area['y0'] or 
                           element.get('y0', 0) > area['y1']):
                        element_in_sentence_area = True
                        break
                
                if not element_in_sentence_area:
                    continue  # Skip elements outside sentence bounds
                
                # Now check if this element contains our provenance text
                clean_element = re.sub(r'\s+', ' ', element['text'].lower().strip())
                clean_element = re.sub(r'[^\w\s]', '', clean_element)
                
                # Check for direct substring match
                if clean_provenance in clean_element:
                    confidence = 0.95
                    match_type = 'exact_substring_in_sentence'
                    logger.info(f"Found exact substring match in sentence {sentence_id}: '{clean_element[:50]}'")
                
                # Check for partial match
                elif clean_element in clean_provenance:
                    confidence = 0.8
                    match_type = 'partial_match_in_sentence'
                    logger.info(f"Found partial match in sentence {sentence_id}: '{clean_element[:50]}'")
                
                # Check for word overlap
                else:
                    provenance_words = set(clean_provenance.split())
                    element_words = set(clean_element.split())
                    common_words = provenance_words & element_words
                    
                    if len(common_words) >= min(2, len(provenance_words) * 0.5):
                        overlap_ratio = len(common_words) / len(provenance_words)
                        confidence = 0.6 + (overlap_ratio * 0.2)
                        match_type = 'word_overlap_in_sentence'
                        logger.info(f"Found word overlap in sentence {sentence_id}: {overlap_ratio:.2f} ratio")
                    else:
                        continue
                
                # Validate box dimensions
                width = element.get('x1', 0) - element.get('x0', 0)
                height = element.get('y1', 0) - element.get('y0', 0)
                
                if width > 3 and height > 3 and width < 300 and height < 50:
                    matching_boxes.append({
                        'page': element.get('page', sentence_page),
                        'x0': element['x0'],
                        'y0': element['y0'],
                        'x1': element['x1'],
                        'y1': element['y1'],
                        'confidence': confidence,
                        'match_type': match_type,
                        'source': 'sentence_constrained_search',
                        'sentence_id': sentence_id
                    })
            
            if matching_boxes:
                # Sort by confidence and take top matches
                matching_boxes.sort(key=lambda x: x['confidence'], reverse=True)
                precise_boxes[sentence_id] = matching_boxes[:3]  # Top 3 per sentence
                
                logger.info(f"Found {len(matching_boxes)} precise boxes within sentence {sentence_id}")
            else:
                logger.warning(f"No precise text matches found within sentence {sentence_id} bounds")
        
        return precise_boxes
        
    except Exception as e:
        logger.error(f"Error in sentence-constrained text matching: {e}")
        return {}

def calculate_box_statistics(bounding_boxes):
    """Calculate statistics for the bounding boxes"""
    total_boxes = sum(len(boxes) for boxes in bounding_boxes.values())
    
    if total_boxes == 0:
        return {
            'total_sentences': len(bounding_boxes),
            'mapped_sentences': 0,
            'total_boxes': 0,
            'avg_confidence': 0
        }
    
    all_boxes = [box for boxes in bounding_boxes.values() for box in boxes]
    avg_confidence = sum(box['confidence'] for box in all_boxes) / len(all_boxes)
    
    return {
        'total_sentences': len(bounding_boxes),
        'mapped_sentences': len([boxes for boxes in bounding_boxes.values() if boxes]),
        'total_boxes': total_boxes,
        'avg_confidence': avg_confidence,
        'mapping_success_rate': len([boxes for boxes in bounding_boxes.values() if boxes]) / len(bounding_boxes)
    }

@main.route('/pdf-processing-status/<pdf_name>', methods=['GET'])
def check_pdf_processing_status(pdf_name):
    """
    Check if a PDF has been processed (sentences and layout files exist)
    
    Returns:
    {
        "success": true,
        "processed": true,
        "files_exist": {
            "sentences": true,
            "layout": true
        },
        "file_paths": {
            "sentences": "/path/to/file_sentences.json",
            "layout": "/path/to/file_layout.json"
        },
        "last_modified": {
            "sentences": "2024-01-15T10:30:00Z",
            "layout": "2024-01-15T10:30:00Z"
        }
    }
    """
    try:
        # Determine file paths (assuming files are in uploads directory)
        upload_dir = current_app.config.get('UPLOAD_FOLDER', 'uploads')
        base_name = os.path.splitext(pdf_name)[0]
        
        sentences_file = os.path.join(upload_dir, f"{base_name}_sentences.json")
        layout_file = os.path.join(upload_dir, f"{base_name}_layout.json")
        
        sentences_exists = os.path.exists(sentences_file)
        layout_exists = os.path.exists(layout_file)
        
        processed = sentences_exists and layout_exists
        
        # Get last modified times if files exist
        last_modified = {}
        if sentences_exists:
            last_modified['sentences'] = time.ctime(os.path.getmtime(sentences_file))
        if layout_exists:
            last_modified['layout'] = time.ctime(os.path.getmtime(layout_file))
        
        return jsonify({
            "success": True,
            "processed": processed,
            "files_exist": {
                "sentences": sentences_exists,
                "layout": layout_exists
            },
            "file_paths": {
                "sentences": sentences_file if sentences_exists else None,
                "layout": layout_file if layout_exists else None
            },
            "last_modified": last_modified
        })
        
    except Exception as e:
        logger.error(f"Error checking PDF processing status: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Failed to check status: {str(e)}"
        }), 500
    
@main.route('/bulk-process-pdfs', methods=['POST'])
def bulk_process_pdfs():
    """
    Process multiple PDFs in a directory
    
    Expected JSON payload:
    {
        "pdf_directory": "/path/to/pdfs/",
        "force_reprocess": false,
        "max_files": 10  // Optional: limit number of files to process
    }
    
    Returns:
    {
        "success": true,
        "message": "Processed 5 PDFs",
        "results": [
            {
                "pdf_name": "document1.pdf",
                "success": true,
                "processing_time": 12.5,
                "statistics": {...}
            }
        ],
        "summary": {
            "total_found": 8,
            "total_processed": 5,
            "total_skipped": 2,
            "total_failed": 1,
            "total_time": 45.2
        }
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'pdf_directory' not in data:
            return jsonify({
                "success": False,
                "error": "pdf_directory is required"
            }), 400
        
        pdf_directory = data['pdf_directory']
        force_reprocess = data.get('force_reprocess', False)
        max_files = data.get('max_files', None)
        
        if not os.path.exists(pdf_directory):
            return jsonify({
                "success": False,
                "error": f"Directory not found: {pdf_directory}"
            }), 404
        
        # Find all PDF files
        pdf_files = [f for f in os.listdir(pdf_directory) if f.lower().endswith('.pdf')]
        
        if max_files:
            pdf_files = pdf_files[:max_files]
        
        logger.info(f"Found {len(pdf_files)} PDF files to process")
        
        results = []
        total_start_time = time.time()
        processed_count = 0
        skipped_count = 0
        failed_count = 0
        
        for pdf_file in pdf_files:
            pdf_path = os.path.join(pdf_directory, pdf_file)
            file_start_time = time.time()
            
            try:
                base_name = os.path.splitext(pdf_file)[0]
                sentences_file = os.path.join(pdf_directory, f"{base_name}_sentences.json")
                layout_file = os.path.join(pdf_directory, f"{base_name}_layout.json")
                
                # Check if already processed
                if not force_reprocess and os.path.exists(sentences_file) and os.path.exists(layout_file):
                    skipped_count += 1
                    results.append({
                        "pdf_name": pdf_file,
                        "success": True,
                        "skipped": True,
                        "message": "Already processed"
                    })
                    continue
                
                # Process the PDF
                sentences_file_path, layout_file_path, stats = save_compatible_sentence_data(
                    pdf_path, 
                    pdf_directory
                )
                
                processing_time = time.time() - file_start_time
                processed_count += 1
                
                results.append({
                    "pdf_name": pdf_file,
                    "success": True,
                    "processing_time": processing_time,
                    "statistics": stats,
                    "files": {
                        "sentences": sentences_file_path,
                        "layout": layout_file_path
                    }
                })
                
                logger.info(f"Processed {pdf_file} in {processing_time:.2f}s")
                
            except Exception as e:
                failed_count += 1
                results.append({
                    "pdf_name": pdf_file,
                    "success": False,
                    "error": str(e)
                })
                logger.error(f"Failed to process {pdf_file}: {e}")
        
        total_time = time.time() - total_start_time
        
        return jsonify({
            "success": True,
            "message": f"Processed {processed_count} PDFs",
            "results": results,
            "summary": {
                "total_found": len(pdf_files),
                "total_processed": processed_count,
                "total_skipped": skipped_count,
                "total_failed": failed_count,
                "total_time": total_time
            }
        })
        
    except Exception as e:
        logger.error(f"Error in bulk processing: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"Bulk processing failed: {str(e)}"
        }), 500
    
@main.route('/drive/test', methods=['GET'])
def test_drive_simple():
    """Simple test endpoint"""
    return jsonify({
        'success': True,
        'message': 'Drive test endpoint working',
        'timestamp': time.time(),
        'globals': {
            'drive_services_available': globals().get('drive_services_available', 'undefined'),
            'drive_inventory_df_exists': drive_inventory_df is not None,
            'drive_inventory_df_length': len(drive_inventory_df) if drive_inventory_df is not None else 0
        }
    })

# Add this near the end of routes.py, after all route definitions
@main.route('/debug/routes', methods=['GET'])
def debug_routes():
    """Debug endpoint to see all registered routes"""
    try:
        from flask import current_app
        routes = []
        for rule in current_app.url_map.iter_rules():
            if rule.endpoint.startswith('main.'):
                routes.append({
                    'endpoint': rule.endpoint,
                    'methods': list(rule.methods),
                    'rule': str(rule)
                })
        
        # Check if Drive routes are there
        drive_routes = [r for r in routes if 'drive' in r['rule']]
        
        return jsonify({
            'success': True,
            'total_routes': len(routes),
            'drive_routes': drive_routes,
            'drive_services_available': drive_services_available if 'drive_services_available' in globals() else 'undefined'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })
    
@main.route('/documents/<filename>/layout', methods=['GET'])
def get_document_layout(filename):
    """Get layout data for a specific document"""
    try:
        logging.info(f"🎨 Layout data requested for: {filename}")
        
        # Find the document by filename
        base_name = filename.replace('.pdf', '')
        
        # Check if layout file exists
        layout_file = os.path.join(current_app.config.get('LAYOUT_FOLDER', 'app/layout'), f"{base_name}_layout.json")
        
        if not os.path.exists(layout_file):
            # Check if we have basic sentences (for backward compatibility info)
            sentences_file = get_document_sentences_path(base_name)
            has_basic_sentences = os.path.exists(sentences_file)
            
            return jsonify({
                'success': False,
                'error': 'No layout data available for this document',
                'has_basic_sentences': has_basic_sentences,
                'filename': filename
            }), 404
        
        # Load layout data
        try:
            with open(layout_file, 'r', encoding='utf-8') as f:
                layout_data = json.load(f)
            
            logging.info(f"✅ Layout data loaded for {filename}")
            
            return jsonify({
                'success': True,
                'layout_data': layout_data,
                'filename': filename,
                'layout_available': True
            })
            
        except Exception as e:
            logging.error(f"Failed to load layout file {layout_file}: {e}")
            return jsonify({
                'success': False,
                'error': f'Failed to load layout data: {str(e)}',
                'filename': filename
            }), 500
            
    except Exception as e:
        logging.error(f"Error in get_document_layout for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/documents/<filename>/sentences', methods=['GET'])
def get_document_sentences_enhanced(filename):
    """Enhanced sentences endpoint with layout data info (backward compatibility)"""
    try:
        logging.info(f"📄 Sentences requested for: {filename}")
        
        base_name = filename.replace('.pdf', '')
        
        # Get sentences (existing functionality)
        sentence_ids = request.args.get('sentence_ids')
        if sentence_ids:
            try:
                sentence_ids = [int(id.strip()) for id in sentence_ids.split(',')]
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'Invalid sentence_ids format'
                }), 400
        
        # Load sentences using existing function
        sentences_data = load_document_sentences(base_name)
        
        if not sentences_data:
            return jsonify({
                'success': False,
                'error': 'Document sentences not found',
                'requested': filename
            }), 404
        
        # Check if layout data is available
        layout_file_paths = [
            os.path.join(current_app.config.get('UPLOAD_FOLDER', 'app/uploads'), f"{base_name}_layout.json"),
            os.path.join(current_app.config.get('PRELOADED_FOLDER', 'app/preloaded'), f"{base_name}_layout.json")
        ]
        
        has_layout_data = any(os.path.exists(path) for path in layout_file_paths)
        
        # Filter sentences if specific IDs requested
        if sentence_ids:
            if isinstance(sentences_data, list):
                # Handle list format
                filtered_sentences = {}
                for sid in sentence_ids:
                    if 0 <= sid < len(sentences_data):
                        filtered_sentences[sid] = sentences_data[sid]
                response_sentences = filtered_sentences
            else:
                # Handle dict format
                response_sentences = {
                    str(sid): sentences_data.get(str(sid), sentences_data.get(sid))
                    for sid in sentence_ids
                    if str(sid) in sentences_data or sid in sentences_data
                }
        else:
            # Return all sentences
            if isinstance(sentences_data, list):
                response_sentences = sentences_data
            else:
                response_sentences = sentences_data
        
        return jsonify({
            'success': True,
            'sentences': response_sentences,
            'has_layout_data': has_layout_data,
            'layout_available': has_layout_data,
            'filename': filename,
            'total_sentences': len(sentences_data) if isinstance(sentences_data, (list, dict)) else 0
        })
        
    except Exception as e:
        logging.error(f"Error in get_document_sentences_enhanced for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Optional: Helper function to generate layout data if it doesn't exist
@main.route('/documents/<filename>/generate-layout', methods=['POST'])
def generate_document_layout(filename):
    """Generate layout data for a document that doesn't have it"""
    try:
        logging.info(f"🔧 Generating layout data for: {filename}")
        
        base_name = filename.replace('.pdf', '')
        
        # Find the PDF file
        pdf_paths = [
            os.path.join(current_app.config.get('UPLOAD_FOLDER', 'app/uploads'), filename),
            os.path.join(current_app.config.get('PRELOADED_FOLDER', 'app/preloaded'), filename)
        ]
        
        pdf_path = None
        for path in pdf_paths:
            if os.path.exists(path):
                pdf_path = path
                break
        
        if not pdf_path:
            return jsonify({
                'success': False,
                'error': f'PDF file not found: {filename}'
            }), 404
        
        # Generate layout data using your preprocessing function
        try:
            output_dir = os.path.dirname(pdf_path)
            sentences_file, layout_file, stats = save_compatible_sentence_data(pdf_path, output_dir)
            
            logging.info(f"✅ Generated layout data for {filename}")
            
            return jsonify({
                'success': True,
                'message': f'Layout data generated for {filename}',
                'layout_file': layout_file,
                'sentences_file': sentences_file,
                'stats': stats
            })
            
        except Exception as e:
            logging.error(f"Failed to generate layout data for {filename}: {e}")
            return jsonify({
                'success': False,
                'error': f'Failed to generate layout data: {str(e)}'
            }), 500
            
    except Exception as e:
        logging.error(f"Error in generate_document_layout for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500