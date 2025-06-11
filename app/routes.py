import doc_provenance, hashlib, io, json, logging, os, random, re, sys, time, traceback
from datetime import datetime, timedelta
from io import StringIO
import pandas as pd
from typing import Any, Dict, List, Optional, Tuple
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, send_file
from threading import Thread
from werkzeug.utils import secure_filename
import doc_provenance.base_strategies
from  functools import wraps
from .utils.file_finder import DocumentFileFinder, find_document_file, get_file_finder, get_document_info
from .text_processing_manager import TextProcessingManager
main = Blueprint('main', __name__, url_prefix='/api')
# =============================================================================

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
RESULTS_DIR = os.path.join(os.getcwd(), 'app/results')
UPLOADS_DIR = os.path.join(os.getcwd(), 'app/uploads')
STUDY_LOGS_DIR = os.path.join(os.getcwd(), 'app/study_logs')
QUESTIONS_DIR = os.path.join(os.getcwd(), 'app/questions')
SENTENCES_DIR = os.path.join(os.getcwd(), 'app/sentences')
DOWNLOADS_DIR = os.path.join(os.getcwd(), 'app/gdrive_downloads')
MAPPINGS_DIR = os.path.join(os.getcwd(), 'app/stable_mappings')
TEST_SUITE_OUTPUT_DIR = os.path.join(os.getcwd(), 'app/test_outputs')

# =============================================================================

# Create directories
for directory in [RESULTS_DIR, UPLOADS_DIR, STUDY_LOGS_DIR, QUESTIONS_DIR, SENTENCES_DIR, TEST_SUITE_OUTPUT_DIR]:
    os.makedirs(directory, exist_ok=True)

text_processing_manager = TextProcessingManager(SENTENCES_DIR, RESULTS_DIR)

# In routes.py - Add this at the top to debug routing
@main.route('/test', methods=['GET', 'POST'])
def test_route():
    return jsonify({
        'success': True,
        'method': request.method,
        'message': 'Basic routing works'
    })


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

# ==============================================================================
# TEST SUITE HELPERS
# ==============================================================================
def get_test_suite_question_dir(question_id: str, filename: str) -> str:
    """Get the test suite output directory for a specific question"""
    document_id = filename.replace('.pdf', '') if filename.endswith('.pdf') else filename
    question_dir = os.path.join(TEST_SUITE_OUTPUT_DIR, 'documents', document_id, question_id)
    os.makedirs(question_dir, exist_ok=True)
    return question_dir

def get_question_paths_for_test_suite(question_id: str, filename: str) -> dict:
    """Get all file paths for a question in test suite format"""
    question_dir = get_test_suite_question_dir(question_id, filename)
    
    return {
        'question_dir': question_dir,
        'answer_path': os.path.join(question_dir, 'answer.json'),
        'provenance_path': os.path.join(question_dir, 'provenance.json'),
        'metadata_path': os.path.join(question_dir, 'metadata.json'),
        'status_path': os.path.join(question_dir, 'status.json'),
        'logs_path': os.path.join(question_dir, 'process_logs.json')
    }

def find_question_in_test_suite(question_id: str) -> Optional[Tuple[str, str]]:
    """
    Find a question in the test suite directory structure
    Returns: (document_name, filename) or None
    """
    docs_dir = os.path.join(TEST_SUITE_OUTPUT_DIR, 'documents')
    if not os.path.exists(docs_dir):
        return None
    
    for doc_name in os.listdir(docs_dir):
        doc_dir = os.path.join(docs_dir, doc_name)
        if os.path.isdir(doc_dir):
            question_dir = os.path.join(doc_dir, question_id)
            if os.path.exists(question_dir):
                filename = f"{doc_name}.pdf"
                return doc_name, filename
    
    return None

def is_test_suite_format() -> bool:
    """Check if we should use test suite format"""
    return TEST_SUITE_OUTPUT_DIR != './app/results'

# Metadata helpers
def load_question_metadata_test_suite(question_id: str, filename: str) -> Optional[Dict]:
    """Load metadata for a question in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    try:
        if os.path.exists(paths['metadata_path']):
            with open(paths['metadata_path'], 'r', encoding='utf-8') as f:
                return json.load(f)
        return None
    except Exception as e:
        logger.error(f"Error loading test suite metadata for question {question_id}: {e}")
        return None

def save_question_metadata_test_suite(question_id: str, filename: str, metadata: Dict) -> bool:
    """Save metadata for a question in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    try:
        with open(paths['metadata_path'], 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Error saving test suite metadata for question {question_id}: {e}")
        return False

def update_process_log_test_suite(question_id: str, filename: str, message: str, status: str = None):
    """Add a new message to the process logs in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    
    try:
        with open(paths['logs_path'], 'r') as f:
            logs = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        logs = {'status': 'started', 'logs': [], 'timestamp': time.time(), 'output_format': 'test_suite'}
    
    # Format message
    if message.startswith('Top-') or message.startswith('Labeler') or message.startswith('Provenance:') or 'tokens:' in message or 'Time:' in message:
        log_entry = message
    else:
        log_entry = f"[{time.strftime('%H:%M:%S')}] {message}"
        
    logs['logs'].append(log_entry)
    
    if status:
        logs['status'] = status
    
    logs['timestamp'] = time.time()
    
    with open(paths['logs_path'], 'w') as f:
        json.dump(logs, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Question {question_id}: {message}")

def check_answer_ready_test_suite(question_id: str, filename: str) -> Dict:
    """Check if answer is ready for a question in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    answer_path = paths['answer_path']
    
    try:
        if not os.path.exists(answer_path):
            return {'ready': False, 'reason': 'file_not_found'}
        
        file_size = os.path.getsize(answer_path)
        if file_size == 0:
            return {'ready': False, 'reason': 'file_empty'}
        
        try:
            with open(answer_path, 'r', encoding='utf-8') as f:
                answer_data = json.load(f)
        except json.JSONDecodeError as json_error:
            logger.warning(f"Invalid JSON in answer file for question {question_id}: {json_error}")
            return {'ready': False, 'reason': 'invalid_json'}
        
        # Extract answer text (test suite format expects lists)
        answer_list = answer_data.get('answer', [])
        if isinstance(answer_list, list) and len(answer_list) > 0:
            answer_text = answer_list[0]
            if answer_text and answer_text != "Answer is not found":
                question_list = answer_data.get('question', [''])
                question_text = question_list[0] if isinstance(question_list, list) else str(question_list)
                
                return {
                    'ready': True,
                    'answer': answer_text,
                    'question': question_text,
                    'timestamp': answer_data.get('timestamp', time.time())
                }
            elif answer_text and answer_text == "Answer is not found":
                logger.info(f"Question {question_id} answer is not found or null")
                return {'ready': True, 'reason': 'answer_empty'}
        


        return {'ready': False, 'reason': 'answer_not_ready'}
        
    except Exception as e:
        logger.error(f"Unexpected error checking answer for question {question_id}: {e}")
        return {'ready': False, 'error': str(e), 'reason': 'unexpected_error'}

def get_current_provenance_count_test_suite(question_id: str, filename: str) -> int:
    """Get the current number of provenances available for a question in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    provenance_path = paths['provenance_path']
    
    try:
        if os.path.exists(provenance_path):
            file_size = os.path.getsize(provenance_path)
            
            with open(provenance_path, 'r', encoding='utf-8') as f:
                provenance_data = json.load(f)
            
            if isinstance(provenance_data, list):
                count = len(provenance_data)
                return count
            else:
                logger.warning(f"Provenance data is not a list: {type(provenance_data)}")
                return 0
        else:
            return 0
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error in provenance file for question {question_id}: {e}")
        return 0
    except Exception as e:
        logger.error(f"Error checking provenance count for question {question_id}: {e}")
        return 0

def get_next_provenance_test_suite(question_id: str, filename: str, current_count: int = 0) -> Dict:
    """Get the next available provenance for a question in test suite format"""
    paths = get_question_paths_for_test_suite(question_id, filename)
    provenance_path = paths['provenance_path']
    metadata = load_question_metadata_test_suite(question_id, filename)
    
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
            return {
                'has_more': False,
                'reason': 'processing_ongoing',
                'message': 'Evidence sources are still being generated. Please try again in a moment.',
                'retry_suggested': True
            }
        else:
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

# =============================================================================
# Enhanced Answer and Provenance Management
# =============================================================================

def get_question_answer_path(question_id):
    """Get the path to the answer file for a question"""
    return os.path.join(RESULTS_DIR, question_id, 'answer.json')

def get_question_provenance_path(question_id):
    """Get the path to the provenance file for a question"""
    return os.path.join(RESULTS_DIR, question_id, 'provenance.json')

def get_question_status_path(question_id):
    """Get the path to the status file for a question"""
    return os.path.join(RESULTS_DIR, question_id, 'status.json')

def get_question_metadata_path(question_id):
    """Get the path to the metadata file for a question"""
    return os.path.join(RESULTS_DIR, question_id, 'metadata.json')

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
            #logger.info(f"Answer file not found for question {question_id}")
            return {'ready': False, 'reason': 'file_not_found'}
        
        # Check if file has content (avoid reading empty/corrupt files)
        file_size = os.path.getsize(answer_path)
        if file_size == 0:
            #logger.info(f"Answer file is empty for question {question_id}")
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
            #logger.info(f"Valid answer found for question {question_id}")
            return {
                'ready': True,
                'answer': answer_text,
                'question': question_text,
                'timestamp': answer_data.get('timestamp', time.time())
            }
        else:
            #logger.info(f"Answer not ready yet for question {question_id} (answer: {answer_text})")
            return {'ready': False, 'reason': 'answer_not_ready'}
        
    except Exception as e:
        logger.error(f"Unexpected error checking answer for question {question_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {'ready': False, 'error': str(e), 'reason': 'unexpected_error'}


def get_current_provenance_count(question_id):
    """Get the current number of provenances available for a question with debugging"""
    provenance_path = get_question_provenance_path(question_id)
    #logger.info(f"Checking provenance count for question {question_id}")
    #logger.info(f"Provenance path: {provenance_path}")
    #logger.info(f"File exists: {os.path.exists(provenance_path)}")
    
    try:
        if os.path.exists(provenance_path):
            # Check file size
            file_size = os.path.getsize(provenance_path)
            #logger.info(f"Provenance file size: {file_size} bytes")
            
            with open(provenance_path, 'r', encoding='utf-8') as f:
                file_content = f.read()
                #logger.info(f"Raw file content: {file_content[:200]}...")  # First 200 chars
                
            # Reset file pointer and parse JSON
            with open(provenance_path, 'r', encoding='utf-8') as f:
                provenance_data = json.load(f)
                #logger.info(f"Parsed JSON type: {type(provenance_data)}")
                #logger.info(f"Parsed JSON content: {provenance_data}")
            
            if isinstance(provenance_data, list):
                count = len(provenance_data)
                #logger.info(f"Provenance count: {count}")
                return count
            else:
                logger.warning(f"Provenance data is not a list: {type(provenance_data)}")
                return 0
        else:
            #logger.info(f"Provenance file does not exist: {provenance_path}")
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
    """Scan upload and downloads folders and return all PDFs with unified metadata"""
    all_documents = []
    
    # Check uploads folder
    uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
    if os.path.exists(uploads_dir):
        all_documents.extend(scan_folder_for_pdfs(uploads_dir))

    # Check downloads folder for batch processed documents
    if os.path.exists(DOWNLOADS_DIR):
        all_documents.extend(scan_batch_documents(DOWNLOADS_DIR))

    return all_documents

def scan_batch_documents(downloads_dir):
    """Scan batch_XXXX folders for pre-processed documents"""
    documents = []
    
    try:
        if not os.path.exists(downloads_dir):
            return []
        
        # Find all batch_XXXX directories
        batch_dirs = [d for d in os.listdir(downloads_dir) 
                     if os.path.isdir(os.path.join(downloads_dir, d)) and d.startswith('batch_')]
        
        #logger.info(f"Found {len(batch_dirs)} batch directories in {downloads_dir}")
        
        for batch_dir in batch_dirs:
            batch_path = os.path.join(downloads_dir, batch_dir)
            #logger.info(f"Scanning batch directory: {batch_dir}")
            
            try:
                # Get all metadata files in this batch
                metadata_files = [f for f in os.listdir(batch_path) 
                                if f.endswith('_metadata.json')]
                
                for metadata_file in metadata_files:
                    try:
                        metadata_path = os.path.join(batch_path, metadata_file)
                        
                        # Load the metadata
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            batch_metadata = json.load(f)
                        
                        # Extract base information
                        base_name = os.path.splitext(metadata_file)[0].replace('_metadata', '')
                        pdf_filename = batch_metadata.get('filename', f"{base_name}.pdf")
                        pdf_path = os.path.join(batch_path, pdf_filename)
                        
                        # Verify PDF exists
                        if not os.path.exists(pdf_path):
                            logger.warning(f"PDF file not found: {pdf_path}")
                            continue
                        
                        # Check for sentences and layout files
                        sentences_file = os.path.join(batch_path, f"{base_name}_sentences.json")
                        layout_file = os.path.join(batch_path, f"{base_name}_layout.json")
                        
                        sentences_available = os.path.exists(sentences_file)
                        layout_available = os.path.exists(layout_file)
                        
                        # Get sentence count from sentences file if available
                        sentence_count = 0
                        if sentences_available:
                            try:
                                with open(sentences_file, 'r', encoding='utf-8') as f:
                                    sentences_data = json.load(f)
                                    sentence_count = len(sentences_data) if isinstance(sentences_data, list) else 0
                            except Exception as e:
                                logger.warning(f"Could not read sentences from {sentences_file}: {e}")
                                # Fallback to metadata
                                sentence_count = batch_metadata.get('processing_info', {}).get('sentence_count', 0)
                        
                        # Create unified metadata structure
                        unified_metadata = {
                            # Basic file info
                            'filename': pdf_filename,
                            'filepath': pdf_path,
                            'base_name': base_name,
                            
                            # Document identification
                            'document_id': batch_metadata.get('document_id', base_name),
                            'original_name': batch_metadata.get('original_name', pdf_filename),
                            'title': batch_metadata.get('title', batch_metadata.get('original_name', pdf_filename)),
                            
                            # Content metadata
                            'text_length': batch_metadata.get('processing_info', {}).get('text_length', 0),
                            'sentence_count': sentence_count,
                            'page_count': batch_metadata.get('gdrive_info', {}).get('page_count', 0),
                            
                            # Source and processing info
                            'source': 'batch_processed',
                            'source_folder': 'downloads',
                            'batch_id': batch_metadata.get('batch_id', batch_dir),
                            'processed_at': batch_metadata.get('processing_info', {}).get('processed_at', time.time()),
                            
                            # File availability
                            'sentences_available': sentences_available,
                            'layout_available': layout_available,
                            
                            # Google Drive metadata (if available)
                            'gdrive_info': batch_metadata.get('gdrive_info', {}),
                            
                            # Additional metadata for UI display
                            'county': batch_metadata.get('gdrive_info', {}).get('county', 'Unknown'),
                            'agency': batch_metadata.get('gdrive_info', {}).get('agency', 'Unknown'),
                            'estimated_size_kb': estimate_pdf_size_from_pages(
                                batch_metadata.get('gdrive_info', {}).get('page_count', 1)
                            ) // 1024 if 'estimate_pdf_size_from_pages' in globals() else 0,
                            
                            # Processing capabilities
                            'ready_for_qa': sentences_available,
                            'ready_for_layout_qa': layout_available,
                        }
                        
                        documents.append(unified_metadata)
                        #logger.info(f"Added batch document: {pdf_filename} ({sentence_count} sentences)")
                        
                    except Exception as e:
                        logger.error(f"Error processing metadata file {metadata_file}: {e}")
                        continue
                        
            except Exception as e:
                logger.error(f"Error scanning batch directory {batch_dir}: {e}")
                continue
    
    except Exception as e:
        logger.error(f"Error scanning downloads directory {downloads_dir}: {e}")
    
    #logger.info(f"Found {len(documents)} pre-processed documents in batch folders")
    return documents

def scan_folder_for_pdfs(folder_path):
    """Simplified PDF scanning using file finder for verification"""
    documents = []
    
    try:
        if not os.path.exists(folder_path):
            return []
        
        pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
        
        for pdf_file in pdf_files:
            try:
                filepath = os.path.join(folder_path, pdf_file)
                if not os.path.exists(filepath):
                    continue
                    
                #logger.info(f"Processing PDF: {pdf_file}")
                base_name = pdf_file.replace('.pdf', '')
                
                # Use file finder to check for existing files
                all_files = get_file_finder().find_all_files(pdf_file)
                
                metadata_info = all_files.get('metadata')
                sentences_info = all_files.get('sentences')
                
                # Check if we already have processed this file
                if metadata_info and sentences_info:
                    try:
                        with open(metadata_info['path'], 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Update source info
                        metadata['filepath'] = filepath                        
                        # Add file availability info
                        metadata['sentences_available'] = sentences_info is not None
                        metadata['layout_available'] = all_files.get('layout') is not None
                        metadata['ready_for_qa'] = sentences_info is not None
                        metadata['ready_for_layout_qa'] = all_files.get('layout') is not None
                        
                        documents.append(metadata)
                        continue
                    except Exception as e:
                        logger.warning(f"Failed to load existing metadata for {pdf_file}: {e}")
                
                # Process new PDF (existing logic)
                try:
                    #logger.info(f"Processing new PDF: {pdf_file}")
                    pdf_text = doc_provenance.base_strategies.extract_text_from_pdf(filepath)
                    sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
                    sentences_saved = save_document_sentences(pdf_file, sentences)

                    metadata = {
                        'filename': pdf_file,
                        'filepath': filepath,
                        'base_name': base_name,
                        'document_id': base_name,
                        'title': pdf_file,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences) if isinstance(sentences, list) else 0,
                        'source_folder': 'uploads',
                        'processed_at': time.time(),
                        'sentences_available': sentences_saved,
                        'ready_for_qa': sentences_saved,
                        'layout_available': False,
                        'ready_for_layout_qa': False
                    }
                    
                    # Save metadata in the same folder
                    metadata_file = os.path.join(folder_path, f"{base_name}_metadata.json")
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
                    documents.append(metadata)
                    #logger.info(f"Successfully processed new PDF: {pdf_file}")
                    
                except Exception as text_error:
                    logger.error(f"Failed to extract text from {pdf_file}: {text_error}")
                    continue
                
            except Exception as e:
                logger.error(f"Error processing {pdf_file}: {e}")
                continue
    
    except Exception as e:
        logger.error(f"Error scanning folder {folder_path}: {e}")
    
    return documents

@main.route('/documents', methods=['GET'])
def get_available_documents():
    """Get all available documents from upload, and batch folders"""
    try:
        all_documents = get_all_available_pdfs()
        
        # Separate by source for UI organization (optional)
        uploaded_docs = [doc for doc in all_documents if doc.get('source_folder') == 'uploads']
        batch_docs = [doc for doc in all_documents if doc.get('source_folder') == 'downloads']
        
        return jsonify({
            'success': True,
            'documents': all_documents,
            'total_documents': len(all_documents),
            'breakdown': {
                'uploaded': len(uploaded_docs),
                'batch_processed': len(batch_docs)
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting available documents: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/documents/<filename>', methods=['GET'])
def serve_document_pdf(filename):
    """Unified PDF serving using file finder helper"""
    try:
        #logger.info(f"🔄 Serving PDF for document: {filename}")
        
        # Use the helper to find the PDF
        pdf_info = get_file_finder().find_file(filename, 'pdf')
        
        if not pdf_info:
            logger.error(f"❌ PDF not found: {filename}")
            return jsonify({
                'error': 'PDF file not found',
                'filename': filename
            }), 404
        
        working_path = pdf_info['path']
        document_source = pdf_info['location']
        
        #logger.info(f"📍 Found PDF in {document_source}: {working_path}")
        
        # Serve the file
        response = send_file(
            working_path,
            mimetype='application/pdf',
            as_attachment=False,
            download_name=filename
        )
        
        # Add source headers
        response.headers['X-Document-Source'] = document_source
        if pdf_info.get('batch_info'):
            response.headers['X-Batch-Dir'] = pdf_info['batch_info']['batch_dir']
        
        logger.info(f"✅ Successfully served PDF: {filename} from {document_source}")
        return response
        
    except Exception as e:
        logger.error(f"❌ PDF serving error for {filename}: {e}")
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
    
@main.route('/documents/<filename>/batch-info', methods=['GET'])
def get_document_batch_info(filename):
    """Get batch information for a document"""
    try:
        if not os.path.exists(DOWNLOADS_DIR):
            return jsonify({
                'success': True,
                'has_batch_info': False,
                'message': 'No download directory found'
            })
        
        # Search for the document in batch directories
        batch_dirs = [d for d in os.listdir(DOWNLOADS_DIR) 
                     if os.path.isdir(os.path.join(DOWNLOADS_DIR, d)) and d.startswith('batch_')]
        
        for batch_dir in batch_dirs:
            batch_path = os.path.join(DOWNLOADS_DIR, batch_dir)
            
            # Look for metadata files
            try:
                metadata_files = [f for f in os.listdir(batch_path) if f.endswith('_metadata.json')]
                
                for metadata_file in metadata_files:
                    metadata_path = os.path.join(batch_path, metadata_file)
                    
                    try:
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Check if this metadata matches our filename
                        if (metadata.get('filename') == filename or 
                            metadata.get('original_name') == filename):
                            
                            return jsonify({
                                'success': True,
                                'has_batch_info': True,
                                'batch_info': {
                                    'batch_id': metadata.get('batch_id', batch_dir),
                                    'batch_dir': batch_dir,
                                    'document_id': metadata.get('document_id'),
                                    'original_name': metadata.get('original_name'),
                                    'gdrive_info': metadata.get('gdrive_info', {}),
                                    'processing_info': metadata.get('processing_info', {}),
                                    'source': metadata.get('source')
                                }
                            })
                            
                    except Exception as metadata_error:
                        continue
                        
            except Exception as batch_error:
                continue
        
        return jsonify({
            'success': True,
            'has_batch_info': False,
            'message': 'Document not found in batch directories'
        })
        
    except Exception as e:
        logger.error(f"Error getting batch info for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/documents/<filename>/generated-questions', methods=['GET'])
def get_generated_questions(filename):
    """Get pre-generated questions using file finder helper"""
    try:
        # Use helper to find questions
        questions_info = get_file_finder().find_file(filename, 'questions')
        
        if not questions_info:
            return jsonify({
                'success': True,
                'questions': [],
                'has_generated_questions': False,
                'message': 'No pre-generated questions found for this document'
            })
        
        # Load questions
        with open(questions_info['path'], 'r', encoding='utf-8') as f:
            questions_data = json.load(f)
        
        return jsonify({
            'success': True,
            'questions': questions_data.get('questions', []),
            'has_generated_questions': True,
            'metadata': questions_data.get('metadata', {}),
            'filename': filename
        })
        
    except Exception as e:
        logger.error(f"Error getting generated questions for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

    
@main.route('/documents/<filename>/sentences', methods=['GET'])
def get_document_sentences(filename):
    """Get sentences for a specific document from the dedicated sentences directory"""
    try:
        # Load sentences from dedicated directory
        sentences = get_file_finder().find_file(filename, 'sentences')
        
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
        pdf_text = doc_provenance.base_strategies.extract_text_from_pdf(filepath)
        
        # Extract sentences for later use
        sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)

        sentences_saved = text_processing_manager.save_document_sentences(filename, sentences)
        
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
    question_id_from_ts = data.get('question_id_from_ts')  # Optional: if from test suite to keep track of question IDs
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
     # Load sentences
    sentences_info = get_file_finder().find_file(filename, 'sentences')
    if not sentences_info:
        return jsonify({'error': 'Document sentences not found. Please re-upload the document.'}), 404
    
    with open(sentences_info['path'], 'r', encoding='utf-8') as f:
        sentences = json.load(f)
    
    # Get PDF data
    pdf_info = get_file_finder().find_file(filename, 'pdf')
    if not pdf_info or not os.path.exists(pdf_info['path']):
        return jsonify({'error': 'PDF file not found'}), 404
    
    filepath = pdf_info['path']
    
    # Extract text from PDF
    pdf_text = doc_provenance.base_strategies.extract_text_from_pdf(filepath)
    
    # Create result directory with new structure: results/{safe_pdf_name}/{question_id}/
    question_dir, question_id = text_processing_manager.create_question_result_directory(filename, question)
    file_paths = text_processing_manager.get_question_file_paths(question_dir)
    
    logger.info(f"📁 Created question directory: {question_dir}")
    logger.info(f"🆔 Question ID: {question_id}")
    
    # Save question metadata
    metadata = {
        'question_id': question_id,
        'question_text': question,
        'filename': filename,
        'pdf_filepath': filepath,
        'created_at': time.time(),
        'max_provenances': EXPERIMENT_TOP_K,
        'user_provenance_count': 0,
        'answer_delivered': False,
        'processing_complete': False,
        'question_dir': question_dir
    }
    text_processing_manager.save_question_metadata(question_dir, metadata)
    
    # Initialize answer file with null answer
    initial_answer = {
        'question': question,
        'answer': None,
        'timestamp': None
    }
    with open(file_paths['answer'], 'w', encoding='utf-8') as f:
        json.dump(initial_answer, f, indent=2, ensure_ascii=False)
    
    # Initialize process logs
    logs = {
        'status': 'started',
        'logs': [f"[{time.strftime('%H:%M:%S')}] Processing started: {question}"],
        'timestamp': time.time(),
        'question_id_from_ts': question_id_from_ts
    }
    with open(file_paths['logs'], 'w') as f:
        json.dump(logs, f)
    
    # Start processing in a separate thread
    def process_question():
        start_time = time.time()
        success = True
        error_message = None

        try:
            # Add log entry
            text_processing_manager.update_process_log(question_dir, f"Analyzing document with {len(pdf_text)} characters...")
            
            # Capture stdout to preserve the exact output format
            stdout_buffer = StringIO()
            stdout_backup = sys.stdout
            sys.stdout = stdout_buffer


            
            # Process the question using doc_provenance API
            # This will handle both answer writing and progressive provenance writing
            result_path = question_dir + os.sep
            doc_provenance.divide_and_conquer_progressive_API(question, pdf_text, result_path)
            
            # Restore stdout
            sys.stdout = stdout_backup
            # Mark processing as complete
            text_processing_manager.update_process_log(question_dir, "Processing completed!", status="completed")
            
            # CRITICAL: Update metadata to show processing is complete
            metadata =  text_processing_manager.load_question_metadata(question_dir)
            if metadata:
                metadata['processing_complete'] = True
                metadata['completed_at'] = time.time()
                metadata['processing_time'] = time.time() - start_time
                text_processing_manager.save_question_metadata(question_dir, metadata)
                logger.info(f"Updated metadata for question {question_dir}")
            else:
                logger.error(f"Could not load metadata for question {question_dir}")
        
            
            # Create a status file to indicate all processing is done
            final_provenance_count = get_current_provenance_count(question_dir)
            status_data = {
                "completed": True,
                "timestamp": time.time(),
                "total_provenance": final_provenance_count
            }

            try:
                with open(file_paths['status'], 'w') as f:
                    json.dump(status_data, f)
                logger.info(f"Created status file for question {question_dir}: {status_data}")
            except Exception as status_error:
                logger.error(f"Error creating status file: {status_error}")
                
        except Exception as e:
            logger.exception("Error processing question")
            text_processing_manager.update_process_log(question_dir, f"Error: {str(e)}", status="error")
            success = False
            error_message = str(e)

            # Restore stdout in case of error
            try:
                sys.stdout = stdout_backup
            except:
                pass

        finally:
            
            # Update metadata
            metadata =  text_processing_manager.load_question_metadata(question_dir)
            if metadata:
                metadata['processing_complete'] = True
                metadata['completed_at'] = time.time()
                metadata['processing_time'] = time.time() - start_time

                if error_message:
                    metadata['error'] = error_message
                    
                text_processing_manager.save_question_metadata(question_dir, metadata)

    thread = Thread(target=process_question)
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'question_id': question_id,
        'message': 'Processing started'
    })

@main.route('/check-answer/<question_id>', methods=['GET'])
def check_answer(question_id):
    """Check if answer is ready for a question with improved error handling"""
    try:
        if not question_id or not question_id.strip():
            return jsonify({
                'success': False,
                'error': 'Invalid question ID'
            }), 400
        
        # Find the question directory using the new structure
        question_dir = find_question_directory(question_id)
        if not question_dir:
            logger.warning(f"Question directory not found for ID: {question_id}")
            return jsonify({
                'success': False,
                'error': 'Question not found',
                'ready': False
            }), 404
        
        result = text_processing_manager.check_answer_ready(question_dir)
        
        if result.get('ready', False):
            # Mark answer as delivered in metadata
            try:
                metadata = text_processing_manager.load_question_metadata(question_dir)
                if metadata:
                    metadata['answer_delivered'] = True
                    metadata['answer_delivered_at'] = time.time()
                    text_processing_manager.save_question_metadata(question_dir, metadata)
            except Exception as metadata_error:
                logger.warning(f"Failed to update metadata for question {question_id}: {metadata_error}")
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        logger.error(f"Error in check_answer route for question {question_id}: {e}")
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
        
        # Find the question directory
        question_dir = find_question_directory(question_id)
        if not question_dir:
            return jsonify({
                'success': False,
                'error': 'Question not found'
            }), 404
        
        # Get the next provenance
        result = get_next_provenance(question_dir, current_count)
        
        if result.get('has_more', False):
            # Update metadata to track user's provenance requests
            metadata = text_processing_manager.load_question_metadata(question_dir)
            if metadata:
                metadata['user_provenance_count'] = current_count + 1
                metadata['last_provenance_request'] = time.time()
                text_processing_manager.save_question_metadata(question_dir, metadata)
        
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
        question_dir = find_question_directory(question_id)
        if not question_dir:
            return jsonify({
                'success': False,
                'error': 'Question not found'
            }), 404
        
        metadata = text_processing_manager.load_question_metadata(question_dir)
        answer_status = text_processing_manager.check_answer_ready(question_dir)
        provenance_count = text_processing_manager.get_current_provenance_count(question_dir)
        
        # Check status file for actual completion status
        file_paths = text_processing_manager.get_question_file_paths(question_dir)
        actual_processing_complete = False
        if os.path.exists(file_paths['status']):
            try:
                with open(file_paths['status'], 'r') as f:
                    status_file_data = json.load(f)
                actual_processing_complete = status_file_data.get('completed', False)
            except Exception as status_error:
                logger.warning(f"Error reading status file: {status_error}")
        
        processing_complete = actual_processing_complete or (metadata.get('processing_complete', False) if metadata else False)
        
        user_provenance_count = metadata.get('user_provenance_count', 0) if metadata else 0
        
        can_request_more = (
            (provenance_count > user_provenance_count or not processing_complete) 
            and user_provenance_count < EXPERIMENT_TOP_K
        )
        
        status = {
            'question_id': question_id,
            'metadata': metadata,
            'answer_ready': answer_status.get('ready', False),
            'answer_delivered': metadata.get('answer_delivered', False) if metadata else False,
            'provenance_count': provenance_count,
            'user_provenance_count': user_provenance_count,
            'processing_complete': processing_complete,
            'max_provenances': EXPERIMENT_TOP_K,
            'can_request_more': can_request_more
        }
        
        return jsonify({
            'success': True,
            'status': status
        })
        
    except Exception as e:
        logger.error(f"Error getting status for question {question_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/results/<question_id>', methods=['GET'])
def get_results(question_id):
    # Check if the provenance file exists
    try:
        question_dir = find_question_directory(question_id)
        if not question_dir:
            return jsonify({
                'success': False,
                'error': 'Question not found'
            }), 404
        filepaths = text_processing_manager.get_question_file_paths(question_dir)
        provenance_path = filepaths['provenance']
        if not os.path.exists(provenance_path):
            return jsonify({'error': 'Results not found'}), 404

        # Read the provenance file
        with open(provenance_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Check if there's an answer file
        answer_path = filepaths['answer']
        answer = None
        if os.path.exists(answer_path):
            with open(answer_path, 'r') as f:
                answer = f.read().strip()

        return jsonify({
            'success': True,
            'provenance': data,
            'answer': answer
        })
    except Exception as e:
        logger.error(f"Error getting results for question {question_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/check-progress/<question_id>', methods=['GET'])
def check_progress(question_id):

    try:
        question_dir = find_question_directory(question_id)
        if not question_dir:
            return jsonify({
                'success': False,
                'error': 'Question not found'
            }), 404
        filepaths = text_processing_manager.get_question_file_paths(question_dir)
        # Read the provenance file to check progress
        provenance_path = filepaths['provenance']
        logs_path = filepaths['logs']

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
        answer_file = filepaths['answer']
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
    except Exception as e:
        logger.error(f"Error reading question dir for question {question_id}: {e}")
        return jsonify({
            'success': False,
            'error': f'Error reading question dir: {str(e)}'
        }), 500
        
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
    sentences_path = os.path.join(RESULTS_DIR, question_id, 'sentences.json')
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
    status_path = os.path.join(RESULTS_DIR, question_id, 'status.json')
    
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
        }), 500
    
# =============================================================================
# HELPER FUNCTIONS FOR NEW DIRECTORY STRUCTURE
# =============================================================================

def find_question_directory(question_id):
    """
    Find the question directory for a given question ID
    Searches through the results directory structure
    """
    try:
        # Search through all PDF directories in results
        for pdf_dir in os.listdir(RESULTS_DIR):
            pdf_path = os.path.join(RESULTS_DIR, pdf_dir)
            if not os.path.isdir(pdf_path):
                continue
            
            # Look for the question ID in this PDF's directory
            for question_dir_name in os.listdir(pdf_path):
                if question_dir_name == question_id or question_dir_name.endswith(f"_{question_id}"):
                    question_dir = os.path.join(pdf_path, question_dir_name)
                    if os.path.isdir(question_dir):
                        return question_dir
        
        # Fallback: check if it's an old-style question ID (direct in results)
        old_style_dir = os.path.join(RESULTS_DIR, question_id)
        if os.path.isdir(old_style_dir):
            return old_style_dir
        
        return None
        
    except Exception as e:
        logger.error(f"Error finding question directory for {question_id}: {e}")
        return None

def get_next_provenance(question_dir, current_count=0):
    """Get the next available provenance for a question"""
    file_paths = text_processing_manager.get_question_file_paths(question_dir)
    provenance_path = file_paths['provenance']
    metadata = text_processing_manager.load_question_metadata(question_dir)
    
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
            return {
                'has_more': False,
                'reason': 'processing_ongoing',
                'message': 'Evidence sources are still being generated. Please try again in a moment.',
                'retry_suggested': True
            }
        else:
            return {
                'has_more': False,
                'reason': 'processing_complete_no_provenances',
                'message': 'No evidence sources were found for this answer'
            }
        
    except Exception as e:
        logger.error(f"Error getting next provenance for question in {question_dir}: {e}")
        return {
            'has_more': False,
            'reason': 'error',
            'message': f'Error retrieving provenance: {str(e)}'
        }

def get_all_available_pdfs():
    """Scan upload and downloads folders and return all PDFs with unified metadata"""
    # This function would be moved to a separate module, but keeping it here for now
    # Implementation would be similar to the original but using the helper functions
    all_documents = []
    
    # Check uploads folder
    uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
    if os.path.exists(uploads_dir):
        all_documents.extend(scan_folder_for_pdfs(uploads_dir))

    # Check downloads folder for batch processed documents
    if os.path.exists(DOWNLOADS_DIR):
        all_documents.extend(scan_batch_documents(DOWNLOADS_DIR))

    return all_documents

def scan_folder_for_pdfs(folder_path):
    """Simplified PDF scanning using file finder for verification"""
    documents = []
    
    try:
        if not os.path.exists(folder_path):
            return []
        
        pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
        
        for pdf_file in pdf_files:
            try:
                filepath = os.path.join(folder_path, pdf_file)
                if not os.path.exists(filepath):
                    continue
                    
                logger.info(f"Processing PDF: {pdf_file}")
                base_name = pdf_file.replace('.pdf', '')
                
                # Use file finder to check for existing files
                all_files = get_file_finder().find_all_files(pdf_file)
                
                metadata_info = all_files.get('metadata')
                sentences_info = all_files.get('sentences')
                
                # Check if we already have processed this file
                if metadata_info and sentences_info:
                    try:
                        with open(metadata_info['path'], 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        metadata['filepath'] = filepath                        
                        metadata['sentences_available'] = sentences_info is not None
                        metadata['layout_available'] = all_files.get('layout') is not None
                        metadata['ready_for_qa'] = sentences_info is not None
                        metadata['ready_for_layout_qa'] = all_files.get('layout') is not None
                        
                        documents.append(metadata)
                        continue
                    except Exception as e:
                        logger.warning(f"Failed to load existing metadata for {pdf_file}: {e}")
                
                # Process new PDF
                try:
                    logger.info(f"Processing new PDF: {pdf_file}")
                    pdf_text, sentences = text_processing_manager.extract_pdf_text_and_sentences(filepath)
                    sentences_saved = text_processing_manager.save_document_sentences(pdf_file, sentences)

                    metadata = {
                        'filename': pdf_file,
                        'filepath': filepath,
                        'base_name': base_name,
                        'document_id': base_name,
                        'title': pdf_file,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences) if isinstance(sentences, list) else 0,
                        'source_folder': 'uploads',
                        'processed_at': time.time(),
                        'sentences_available': sentences_saved,
                        'ready_for_qa': sentences_saved,
                        'layout_available': False,
                        'ready_for_layout_qa': False
                    }
                    
                    # Save metadata in the same folder
                    metadata_file = os.path.join(folder_path, f"{base_name}_metadata.json")
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
                    documents.append(metadata)
                    logger.info(f"Successfully processed new PDF: {pdf_file}")
                    
                except Exception as text_error:
                    logger.error(f"Failed to extract text from {pdf_file}: {text_error}")
                    continue
                
            except Exception as e:
                logger.error(f"Error processing {pdf_file}: {e}")
                continue
    
    except Exception as e:
        logger.error(f"Error scanning folder {folder_path}: {e}")
    
    return documents

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

        
        return jsonify({
            'success': False,
            'error': 'Either provenance_text or sentence_ids must be provided'
        }), 400
        
    except Exception as e:
        logger.error(f"Error in simple provenance boxes: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/api/documents/<basename>/mappings', methods=['GET'])
def get_document_mappings_overview(basename):
    """Get mapping statistics and document info overview"""
    try:
        logger.info(f"📝 Mappings overview requested for {basename}")
        
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(basename, 'mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No mapping data for {basename}'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        # Check if we have the expected structure
        if not mapping_data.get('document_info') or not mapping_data.get('statistics'):
            return jsonify({
                'success': False,
                'error': f'Invalid mapping data structure for {basename}'
            }), 404
        
        # Get questions count if available
        questions_info = get_file_finder().find_file(basename, 'questions')
        total_questions = 0
        if questions_info:
            try:
                with open(questions_info['path'], 'r', encoding='utf-8') as f:
                    questions_data = json.load(f)
                    total_questions = len(questions_data.get('questions', []))
            except Exception as e:
                logger.warning(f"Could not load questions for {basename}: {e}")
        
        return jsonify({
            'success': True,
            'statistics': mapping_data.get('statistics', {}),
            'document_info': mapping_data.get('document_info', {}),
            'total_questions': total_questions
        })
        
    except Exception as e:
        logger.error(f"Error getting mapping overview for {basename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/api/documents/<basename>/mappings/sentences', methods=['GET'])
def get_document_sentence_mappings(basename):
    """Get paginated sentence mapping data"""
    try:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))
        filter_type = request.args.get('filter', 'all')  # all, mapped, unmapped
        
        logger.info(f"📝 Sentence mappings requested for {basename} (page {page}, filter: {filter_type})")
        
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(basename, 'mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No mapping data for {basename}'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        sentence_to_items = mapping_data.get('sentence_to_items', {})
        
        if not sentence_to_items:
            return jsonify({
                'success': False,
                'error': f'No sentence mapping data for {basename}'
            }), 404
        
        # Convert mappings to simple array
        all_sentences = []
        for sentence_id, mapping in sentence_to_items.items():
            stable_matches = mapping.get('stable_matches', [])
            has_matches = len(stable_matches) > 0
            
            # Apply filter
            if filter_type == 'mapped' and not has_matches:
                continue
            if filter_type == 'unmapped' and has_matches:
                continue
            
            sentence_text = mapping.get('text', '')
            truncated_text = sentence_text[:200] if len(sentence_text) > 200 else sentence_text
            
            all_sentences.append({
                'id': sentence_id,
                'text': truncated_text,
                'confidence': mapping.get('confidence', 0),
                'strategy': mapping.get('match_strategy', 'none'),
                'page': mapping.get('primary_page'),
                'stable_item_count': len(stable_matches),
                'has_matches': has_matches
            })
        
        # Sort by confidence
        all_sentences.sort(key=lambda x: x.get('confidence', 0), reverse=True)
        
        # Paginate
        total = len(all_sentences)
        start = (page - 1) * limit
        paginated_sentences = all_sentences[start:start + limit]
        
        return jsonify({
            'success': True,
            'sentences': paginated_sentences,
            'pagination': {
                'page': page,
                'limit': limit,
                'total': total,
                'total_pages': (total + limit - 1) // limit  # Ceiling division
            },
            'filter': filter_type
        })
        
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Invalid page or limit parameter'
        }), 400
    except Exception as e:
        logger.error(f"Error getting sentence mappings for {basename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/api/documents/<basename>/sentence-items', methods=['GET'])
def get_sentence_stable_items(basename):
    """Get stable item mappings for specific sentences"""
    try:
        sentence_ids_param = request.args.get('ids')
        
        if not sentence_ids_param:
            return jsonify({
                'success': False,
                'error': 'sentence_ids parameter required'
            }), 400
        
        sentence_ids = sentence_ids_param.split(',')
        logger.info(f"🎯 Sentence stable item mappings requested for {basename}, sentences: {', '.join(sentence_ids)}")
        
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(basename, 'mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No mappings for {basename}'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        sentence_to_items = mapping_data.get('sentence_to_items', {})
        
        # Filter to only the requested sentences
        filtered_mappings = {}
        for sentence_id in sentence_ids:
            sentence_key = str(sentence_id).strip()
            if sentence_key in sentence_to_items:
                filtered_mappings[sentence_key] = sentence_to_items[sentence_key]
        
        logger.info(f"✅ Returning mappings for {len(filtered_mappings)} sentences")
        
        return jsonify({
            'success': True,
            'sentence_mappings': filtered_mappings,
            'requested_sentences': sentence_ids,
            'found_sentences': list(filtered_mappings.keys())
        })
        
    except Exception as e:
        logger.error(f"Error getting sentence items for {basename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/api/mappings/list', methods=['GET'])
def list_all_mappings():
    """List all available mappings with basic stats"""
    try:
        logger.info('📋 Mappings list requested')
        
        mappings = []
        
        # Check both uploads and downloads directories for mapping files
        search_dirs = [
            current_app.config.get('UPLOAD_FOLDER', 'app/uploads'),
            DOWNLOADS_DIR
        ]
        
        processed_basenames = set()
        
        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                continue
                
            # Look for mapping files directly in the directory
            for filename in os.listdir(search_dir):
                if filename.endswith('_mappings.json'):
                    basename = filename.replace('_mappings.json', '')
                    
                    if basename in processed_basenames:
                        continue
                    processed_basenames.add(basename)
                    
                    mapping_path = os.path.join(search_dir, filename)
                    
                    try:
                        with open(mapping_path, 'r', encoding='utf-8') as f:
                            mapping_data = json.load(f)
                        
                        stats = mapping_data.get('statistics', {})
                        doc_info = mapping_data.get('document_info', {})
                        
                        mappings.append({
                            'basename': basename,
                            'filename': f"{basename}.pdf",
                            'total_sentences': stats.get('total_sentences', 0),
                            'mapped_sentences': stats.get('mapped_sentences', 0),
                            'mapping_rate': stats.get('mapping_rate', 0),
                            'total_stable_items': stats.get('total_stable_items', 0),
                            'total_pages': doc_info.get('total_pages', 0),
                            'has_mappings': True
                        })
                        
                    except Exception as e:
                        logger.warning(f"Error reading mapping file {mapping_path}: {e}")
                        continue
            
            # Also check batch directories in downloads
            if search_dir == DOWNLOADS_DIR:
                for item in os.listdir(search_dir):
                    item_path = os.path.join(search_dir, item)
                    if os.path.isdir(item_path) and item.startswith('batch_'):
                        for batch_file in os.listdir(item_path):
                            if batch_file.endswith('_mappings.json'):
                                basename = batch_file.replace('_mappings.json', '')
                                
                                if basename in processed_basenames:
                                    continue
                                processed_basenames.add(basename)
                                
                                mapping_path = os.path.join(item_path, batch_file)
                                
                                try:
                                    with open(mapping_path, 'r', encoding='utf-8') as f:
                                        mapping_data = json.load(f)
                                    
                                    stats = mapping_data.get('statistics', {})
                                    doc_info = mapping_data.get('document_info', {})
                                    
                                    mappings.append({
                                        'basename': basename,
                                        'filename': f"{basename}.pdf",
                                        'total_sentences': stats.get('total_sentences', 0),
                                        'mapped_sentences': stats.get('mapped_sentences', 0),
                                        'mapping_rate': stats.get('mapping_rate', 0),
                                        'total_stable_items': stats.get('total_stable_items', 0),
                                        'total_pages': doc_info.get('total_pages', 0),
                                        'has_mappings': True
                                    })
                                    
                                except Exception as e:
                                    logger.warning(f"Error reading batch mapping file {mapping_path}: {e}")
                                    continue
        
        # Sort by mapping rate (best first)
        mappings.sort(key=lambda x: x.get('mapping_rate', 0), reverse=True)
        
        return jsonify({
            'success': True,
            'mappings': mappings
        })
        
    except Exception as e:
        logger.error(f"Error listing mappings: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


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
    """Get layout data with enhanced precision features"""
    try:
        logger.info(f"🎨 Enhanced layout data requested for: {filename}")
        
        # Use helper to find layout
        layout_info = get_file_finder().find_file(filename, 'layout')
        
        if not layout_info:
            # Check if we have basic sentences for backward compatibility
            sentences_info = get_file_finder().find_file(filename, 'sentences')
            
            return jsonify({
                'success': False,
                'error': 'No layout data available for this document',
                'has_basic_sentences': sentences_info is not None,
                'filename': filename,
                'suggestion': 'Try processing the PDF with enhanced layout extraction'
            }), 404
        
        # Load layout data
        with open(layout_info['path'], 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        # Extract enhancement statistics if available
        enhancement_stats = layout_data.get('enhancement_stats', {})
        metadata = layout_data.get('metadata', {})
        
        # Calculate some quick stats for the frontend
        sentences = layout_data.get('sentences', [])
        total_boxes = sum(len(sent.get('bounding_boxes', [])) for sent in sentences)
        
        # Count precision types
        sub_element_boxes = 0
        character_level_boxes = 0
        for sent in sentences:
            for box in sent.get('bounding_boxes', []):
                match_type = box.get('match_type', '')
                if 'precise' in match_type or 'sub_element' in match_type:
                    sub_element_boxes += 1
                if 'character' in match_type:
                    character_level_boxes += 1
        
        # Sample some sentences for preview
        sample_sentences = []
        for i, sent in enumerate(sentences[:5]):  # First 5 sentences as preview
            boxes = sent.get('bounding_boxes', [])
            enhanced_features = sent.get('enhanced_features', {})
            
            sample_sentences.append({
                'sentence_id': sent.get('sentence_id', i),
                'text': sent.get('text', '')[:100] + ('...' if len(sent.get('text', '')) > 100 else ''),
                'box_count': len(boxes),
                'precision_level': enhanced_features.get('precision_level', 'element'),
                'has_sub_element_precision': enhanced_features.get('has_sub_element_precision', False),
                'highest_confidence': max([box.get('confidence', 0) for box in boxes], default=0),
                'primary_page': sent.get('primary_page', 1)
            })
        
        logger.info(f"✅ Enhanced layout data loaded for {filename} from {layout_info['location']}")
        
        return jsonify({
            'success': True,
            'layout_data': layout_data,
            'filename': filename,
            'layout_available': True,
            'source_location': layout_info['location'],
            'enhancement_info': {
                'is_enhanced': metadata.get('layout_mapping_version', '').startswith('2.0'),
                'precision_level': metadata.get('precision_level', 'element'),
                'method': metadata.get('method', 'standard'),
                'total_sentences': len(sentences),
                'total_boxes': total_boxes,
                'sub_element_boxes': sub_element_boxes,
                'character_level_boxes': character_level_boxes,
                'enhancement_rate': enhancement_stats.get('enhancement_rate', 0)
            },
            'sample_sentences': sample_sentences,
            'metadata': metadata
        })
        
    except Exception as e:
        logger.error(f"Error getting enhanced layout for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<filename>/layout/test-precision', methods=['GET'])
def test_layout_precision(filename):
    """
    Test endpoint to see how precise the layout mapping is
    Returns sample sentences with their bounding boxes for visual inspection
    """
    try:
        logger.info(f"🧪 Testing layout precision for: {filename}")
        
        # Find layout file
        layout_info = get_file_finder().find_file(filename, 'layout')
        
        if not layout_info:
            return jsonify({
                'success': False,
                'error': 'No layout data available for testing'
            }), 404
        
        # Load layout data
        with open(layout_info['path'], 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        sentences = layout_data.get('sentences', [])
        
        # Find sentences with high-quality matches for testing
        test_sentences = []
        
        for sent in sentences:
            boxes = sent.get('bounding_boxes', [])
            enhanced_features = sent.get('enhanced_features', {})
            
            # Look for sentences with good precision
            high_conf_boxes = [box for box in boxes if box.get('confidence', 0) > 0.8]
            precise_boxes = [box for box in boxes if 'precise' in box.get('match_type', '')]
            
            if len(high_conf_boxes) > 0 or len(precise_boxes) > 0:
                test_sentences.append({
                    'sentence_id': sent.get('sentence_id'),
                    'text': sent.get('text', ''),
                    'primary_page': sent.get('primary_page', 1),
                    'bounding_boxes': boxes,
                    'enhanced_features': enhanced_features,
                    'quality_metrics': {
                        'total_boxes': len(boxes),
                        'high_confidence_boxes': len(high_conf_boxes),
                        'precise_boxes': len(precise_boxes),
                        'avg_confidence': sum(box.get('confidence', 0) for box in boxes) / len(boxes) if boxes else 0,
                        'has_sub_element': any('sub_element' in box.get('match_type', '') for box in boxes)
                    }
                })
            
            # Limit to 10 test cases
            if len(test_sentences) >= 10:
                break
        
        return jsonify({
            'success': True,
            'filename': filename,
            'test_sentences': test_sentences,
            'total_test_cases': len(test_sentences),
            'layout_info': {
                'total_sentences': len(sentences),
                'method': layout_data.get('metadata', {}).get('method', 'unknown'),
                'precision_level': layout_data.get('metadata', {}).get('precision_level', 'unknown')
            }
        })
        
    except Exception as e:
        logger.error(f"Error testing layout precision for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<filename>/layout/sentence/<int:sentence_id>', methods=['GET'])
def get_sentence_layout_detail(filename, sentence_id):
    """
    Get detailed layout information for a specific sentence
    Useful for debugging and testing individual sentence mappings
    """
    try:
        logger.info(f"🔍 Getting detailed layout for sentence {sentence_id} in {filename}")
        
        # Find layout file
        layout_info = get_file_finder().find_file(filename, 'layout')
        
        if not layout_info:
            return jsonify({
                'success': False,
                'error': 'No layout data available'
            }), 404
        
        # Load layout data
        with open(layout_info['path'], 'r', encoding='utf-8') as f:
            layout_data = json.load(f)
        
        sentences = layout_data.get('sentences', [])
        
        # Find the specific sentence
        target_sentence = None
        for sent in sentences:
            if sent.get('sentence_id') == sentence_id:
                target_sentence = sent
                break
        
        if not target_sentence:
            return jsonify({
                'success': False,
                'error': f'Sentence {sentence_id} not found'
            }), 404
        
        # Get pages layout for context
        pages_layout = layout_data.get('pages_layout', [])
        primary_page = target_sentence.get('primary_page', 1)
        
        # Find the page layout
        page_elements = []
        for page in pages_layout:
            if page.get('page_num') == primary_page:
                page_elements = page.get('elements', [])
                break
        
        return jsonify({
            'success': True,
            'sentence': target_sentence,
            'sentence_id': sentence_id,
            'filename': filename,
            'page_context': {
                'primary_page': primary_page,
                'total_page_elements': len(page_elements),
                'sample_page_elements': page_elements[:5]  # First 5 for context
            },
            'analysis': {
                'text_length': len(target_sentence.get('text', '')),
                'total_boxes': len(target_sentence.get('bounding_boxes', [])),
                'page_spans': target_sentence.get('page_spans', []),
                'enhanced_features': target_sentence.get('enhanced_features', {}),
                'match_types': list(set(box.get('match_type', 'unknown') 
                                      for box in target_sentence.get('bounding_boxes', [])))
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting sentence layout detail: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/documents/<filename>/sentences', methods=['GET'])
def get_document_sentences_enhanced(filename):
    """Get sentences using file finder helper"""
    try:
        logger.info(f"📄 Sentences requested for: {filename}")
        
        # Use helper to find sentences
        sentences_info = get_file_finder().find_file(filename, 'sentences')
        
        if not sentences_info:
            return jsonify({
                'success': False,
                'error': 'Document sentences not found',
                'filename': filename
            }), 404
        
        # Load sentences
        with open(sentences_info['path'], 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        # Check if layout is available
        layout_info = get_file_finder().find_file(filename, 'layout')
        
        return jsonify({
            'success': True,
            'sentences': sentences_data,
            'has_layout_data': layout_info is not None,
            'layout_available': layout_info is not None,
            'filename': filename,
            'source_location': sentences_info['location'],
            'total_sentences': len(sentences_data) if isinstance(sentences_data, (list, dict)) else 0
        })
        
    except Exception as e:
        logger.error(f"Error getting sentences for {filename}: {e}")
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