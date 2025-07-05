import doc_provenance, hashlib, io, json, logging, os, random, re, sys, tiktoken, time, traceback
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
from .google_drive_manager import GoogleDriveManager
from .google_provisional_sampler import GoogleDriveProvisionalSampler
from .text_processing_manager import TextProcessingManager
from .pdfjs_coord_helpers import create_pdfjs_debugger, format_debug_result_for_api, PDFJSCoordinateDebugger

main = Blueprint('main', __name__, url_prefix='/api')
# =============================================================================

sufficient_provenance_strategy_pool = ['raw','LLM_vanilla', 'embedding_sufficient_top_down','embedding_sufficient_bottem_up','LLM_score_sufficient_bottem_up','LLM_score_sufficient_top_down', 'divide_and_conquer_sufficient'] 
minimal_provenance_strategy_pool = ['null', 'exponential_greedy','sequential_greedy'] 

provisional_sampler = None

# Algorithm configurations - combination of sufficient anmd minimal strategy pools; 
# sufficient == raw -> only minimal strategies are used
# minimal == null -> only sufficient strategies are used
# all other combinations are a process where the first step is sufficient and the second step is minimal

DEFAULT_THRESHOLDS = {
    'minTokensPerProvenance': 100,
    'minSentencesPerProvenance': 2,
    'minProvenancesPerQuestion': 1,
    'minGoodQuestionsPerDocument': 2,
    'minQuestionRatio': 0.3
}


ALGORITHM_CONFIGURATIONS = {
    'sufficient': sufficient_provenance_strategy_pool,
    'minimal':  minimal_provenance_strategy_pool
}

# =============================================================================

# Configuration for the experiment

PROCESSING_TIMEOUT = 60  # 1 minute timeout for processing
EXPERIMENT_TOP_K = 5  # User-facing limit for this experiment
MAX_PROVENANCE_PROCESSING = 20  # Internal limit to prevent infinite processing
USE_TEST_SUITE = True

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
CONOLIDATED_TEST_SUITE_DIR = os.path.join(os.getcwd(), 'app/consolidated_test_suite')

# =============================================================================

# Create directories
for directory in [RESULTS_DIR, UPLOADS_DIR, STUDY_LOGS_DIR, QUESTIONS_DIR, SENTENCES_DIR, TEST_SUITE_OUTPUT_DIR]:
    os.makedirs(directory, exist_ok=True)

#google_drive_manager = GoogleDriveManager(DOWNLOADS_DIR)
text_processing_manager = TextProcessingManager(SENTENCES_DIR, TEST_SUITE_OUTPUT_DIR)

def init_tiktoken():
    """Initialize tiktoken encoder"""
    try:
        return tiktoken.encoding_for_model("gpt-4")
    except:
        return tiktoken.get_encoding("cl100k_base")

enc = init_tiktoken()

def is_good_provenance(provenance, thresholds=None):
    """Check if a single provenance is good"""
    if not provenance or not provenance.get('provenance'):
        return False
    
    thresholds = thresholds or DEFAULT_THRESHOLDS
    
    token_count = len(enc.encode(provenance['provenance']))
    sentence_count = len(provenance.get('provenance_ids', []))
    
    return (token_count >= thresholds['minTokensPerProvenance'] and 
            sentence_count >= thresholds['minSentencesPerProvenance'])

def is_good_question(question, thresholds=None):
    """Check if a question is good"""
    if not question or not question.get('provenance_data'):
        return False
    
    thresholds = thresholds or DEFAULT_THRESHOLDS
    
    good_provenances = [p for p in question['provenance_data'] if is_good_provenance(p, thresholds)]
    return len(good_provenances) >= thresholds['minProvenancesPerQuestion']

def is_good_document(document, thresholds=None):
    """Check if a document is good"""
    if not document or not document.get('questions'):
        return False
    
    thresholds = thresholds or DEFAULT_THRESHOLDS
    
    good_questions = [q for q in document['questions'] if is_good_question(q, thresholds)]
    total_questions = len(document['questions'])
    
    if total_questions == 0:
        return False
    
    good_question_ratio = len(good_questions) / total_questions
    
    return (len(good_questions) >= thresholds['minGoodQuestionsPerDocument'] and
            good_question_ratio >= thresholds['minQuestionRatio'])

def get_filtering_stats(documents, thresholds=None):
    """Get filtering statistics"""
    total_docs = len(documents)
    good_docs = 0
    total_questions = 0
    good_questions = 0
    
    for doc in documents:
        if doc.get('questions'):
            total_questions += len(doc['questions'])
            doc_good_questions = [q for q in doc['questions'] if is_good_question(q, thresholds)]
            good_questions += len(doc_good_questions)
            
            if is_good_document(doc, thresholds):
                good_docs += 1
    
    return {
        'totalDocuments': total_docs,
        'goodDocuments': good_docs,
        'totalQuestions': total_questions,
        'goodQuestions': good_questions,
        'documentPassRate': (good_docs / total_docs * 100) if total_docs > 0 else 0,
        'questionPassRate': (good_questions / total_questions * 100) if total_questions > 0 else 0
    }

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
    

# Add these helper functions to routes.py after the existing helper functions

def load_test_suite_data(filename):
    """Load test suite data for a document"""
    try:
        base_name = secure_filename(filename.replace('.pdf', ''))
        
        # Check for test suite file in multiple locations
        test_suite_path = os.path.join(CONOLIDATED_TEST_SUITE_DIR, f"{base_name}_test_suite.json")

        if os.path.exists(test_suite_path):
            logger.info(f"Loading test suite from: {test_suite_path}")
            with open(test_suite_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        logger.warning(f"No test suite found for {filename}")
        return None

    except Exception as e:
        logger.error(f"Error loading test suite for {filename}: {e}")
        return None
        
    except Exception as e:
        logger.error(f"Error loading test suite for {filename}: {e}")
        return None

def find_test_suite_question(question_id, test_suite_data, question_text = None):
    """
    Find the best matching question from consolidated test suite data
    Uses simple text similarity matching
    test_suite_data is a list of dicts
    """

    best_match = None

    if not test_suite_data or not isinstance(test_suite_data, list):
        return None
    else:
        # Each entry has one question ID as key
        for question_data in test_suite_data:
            if not isinstance(question_data, dict):
                continue
            if question_id == question_data.get('question_id'):
                return {
                    'question_id': question_data.get('question_id'),
                    'question_data': question_data,
                    'similarity_score': 1.0,  # Exact match
                    'original_question': question_data.get('question', ''),
                    'source_info': question_data.get('source_info', {})
                }
        
    if question_text:
        question_lower = question_text.lower().strip()
        best_score = 0
    for entry in test_suite_data:
        if not isinstance(entry, dict):
            continue
            
        # Each entry has one question ID as key
        for question_id, question_data in entry.items():
            if not isinstance(question_data, dict):
                continue
                
            test_question = question_data.get('question', '').lower().strip()
            
            # Simple similarity scoring - count common words
            question_words = set(question_lower.split())
            test_words = set(test_question.split())
            
            if len(question_words) == 0 or len(test_words) == 0:
                continue
                
            # Jaccard similarity
            intersection = len(question_words.intersection(test_words))
            union = len(question_words.union(test_words))
            similarity = intersection / union if union > 0 else 0
            
            # Boost score for exact matches or very close matches
            if question_lower == test_question:
                similarity = 1.0
            elif question_lower in test_question or test_question in question_lower:
                similarity = max(similarity, 0.8)
            
            # Additional boost for partial phrase matches
            if len(question_lower) > 10 and question_lower in test_question:
                similarity = max(similarity, 0.9)
            if len(test_question) > 10 and test_question in question_lower:
                similarity = max(similarity, 0.9)
            
            if similarity > best_score:
                best_score = similarity
                best_match = {
                    'question_id': question_id,
                    'question_data': question_data,
                    'similarity_score': similarity,
                    'original_question': question_data.get('question', ''),
                    'source_info': question_data.get('source_info', {})
                }
    
    # Only return matches with reasonable similarity
    if best_match and best_match['similarity_score'] > 0.2:  # Lowered threshold for better matching
        return best_match
    
    return None


def create_mock_provenance_entries(provenance_data, max_entries=EXPERIMENT_TOP_K):
    """
    Convert test suite provenance data to the format expected by the frontend
    """
    mock_entries = []
    
    if not provenance_data or not isinstance(provenance_data, list):
        return []
    
    for i, prov in enumerate(provenance_data[:max_entries]):
        if not isinstance(prov, dict):
            continue
            
        # Convert to expected format
        mock_entry = {
            "provenance_id": prov.get('provenance_id', i),
            "sentences_ids": prov.get('input_sentence_ids', prov.get('provenance_ids', [])),
            "provenance_ids": prov.get('provenance_ids', prov.get('input_sentence_ids', [])),
            "provenance": prov.get('provenance', ''),
            "content": [prov.get('provenance', '')],  # Split by sentences if needed
            "time": prov.get('time', 5.0),
            "input_sentence_ids": prov.get('input_sentence_ids', []),
            "input_token_size": prov.get('input_token_size', 1000),
            "output_token_size": prov.get('output_token_size', 50),
            "original_provenance_id": prov.get('original_provenance_id', i)
        }
        
        # Split provenance text into content array if it's long
        if mock_entry["provenance"]:
            # Simple sentence splitting
            sentences = [s.strip() for s in mock_entry["provenance"].split('.') if s.strip()]
            if len(sentences) > 1:
                mock_entry["content"] = sentences
        
        mock_entries.append(mock_entry)
    
    return mock_entries

    
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
    question_id_from_ts = data.get('question_id_from_ts') 
    use_test_suite = data.get('use_test_suite', USE_TEST_SUITE)

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

    if use_test_suite:

        test_suite_data = load_test_suite_data(filename)
        if not test_suite_data:
            use_real_processing = True
        else:
            use_real_processing = False
    else:
        # Create result directory with new structure: results/{safe_pdf_name}/{question_id}/
        use_real_processing = True
    
    # Start processing in a separate thread
    def process_question():
        start_time = time.time()
        success = True
        error_message = None

        try:
            if use_real_processing:
                # Add log entry
                text_processing_manager.update_process_log(question_dir, f"Processing with OpenAI.... Analyzing document with {len(pdf_text)} characters...")
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

            else:
                # using test suite
                text_processing_manager.update_process_log(question_dir, f"Processing with test suite.... Analyzing document with {len(pdf_text)} characters...")
   
                match_result = find_test_suite_question(question_id, test_suite_data, question)
                provenance_data = match_result['question_data'].get('provenance', [])
                with open(file_paths['provenance'], 'w', encoding='utf-8') as f:
                    json.dump(provenance_data, f, indent=2, ensure_ascii=False)
                # Save answer data
                answer_data = {
                    'question': question,
                    'answer': match_result['question_data'].get('answer', None),
                    'timestamp': time.time()
                }
                with open(file_paths['answer'], 'w', encoding='utf-8') as f:
                    json.dump(answer_data, f, indent=2, ensure_ascii=False)

                time.sleep(2)  # Simulate processing time

            # Mark processing as complete
            text_processing_manager.update_process_log(question_dir, "Processing completed!", status="completed")
           
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
            # CRITICAL: Update metadata to show processing is complete (for both real and test)
            metadata = text_processing_manager.load_question_metadata(question_dir)
            if metadata:
                metadata['processing_complete'] = True
                metadata['completed_at'] = time.time()
                metadata['processing_time'] = time.time() - start_time

                if error_message:
                    metadata['error'] = error_message
                
                # Save metadata for both real and test processing
                text_processing_manager.save_question_metadata(question_dir, metadata)
                logger.info(f"✅ Updated metadata for question {question_dir} - processing_complete: True")
            else:
                logger.error(f"❌ Could not load metadata for question {question_dir}")

            # Create a status file to indicate all processing is done
            if use_real_processing:
                final_provenance_count = get_current_provenance_count(question_dir)
            else:
                # For test suite, count the provenance items we just saved
                try:
                    with open(file_paths['provenance'], 'r', encoding='utf-8') as f:
                        provenance_data = json.load(f)
                        final_provenance_count = len(provenance_data) if isinstance(provenance_data, list) else 0
                except:
                    final_provenance_count = 0
            
            status_data = {
                "completed": True,
                "timestamp": time.time(),
                "total_provenance": final_provenance_count,
                "used_test_suite": not use_real_processing
            }
            
            try:
                with open(file_paths['status'], 'w') as f:
                    json.dump(status_data, f)
                logger.info(f"📄 Created status file for question {question_dir}: {status_data}")
            except Exception as status_error:
                logger.error(f"❌ Error creating status file: {status_error}")

    thread = Thread(target=process_question)
    thread.daemon = True
    thread.start()
        
    return jsonify({
        'success': True,
        'question_id': question_id,
        'message': 'Processing started',
        'using_test_suite': use_test_suite
    })

@main.route('/check-answer/<question_id>', methods=['GET'])
def check_answer(question_id, filename = None):
    """Check if answer is ready for a question with improved error handling"""
    try:
        if not question_id or not question_id.strip():
            return jsonify({
                'success': False,
                'error': 'Invalid question ID'
            }), 400
        
        if USE_TEST_SUITE and filename:
            # If using test suite, we simulate finding the answer (wait 5 seconds, then return answer)
            test_suite_data = load_test_suite_data(filename)
            if not test_suite_data:
                return jsonify({
                    'success': False,
                    'error': 'Test suite data not found for this question ID'
                }), 404
            
            # Find the question in the test suite
            match_result = find_test_suite_question(question_id, test_suite_data)
            if not match_result:
                return jsonify({
                    'success': False,
                    'error': 'Question not found in test suite'
                }), 404
            # Simulate answer ready after 5 seconds
            time.sleep(5)
            return jsonify({
                'success': True,
                'ready': True,
                'answer': match_result['question_data'].get('answer', 'No answer available'),
                'question_id': question_id,
                'question': match_result['question_data'].get('question', ''),
                'source_info': match_result['question_data'].get('source_info', {})
            })
        
        # Find the question directory using the new structure
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
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

@main.route('/v1/get-next-provenance/<question_id>', methods=['POST'])
def get_next_provenance_route(question_id):
    """Get the next available provenance for a question"""
    try:
        data = request.json or {}
        current_count = data.get('current_count', 0)
        
        # Find the question directory
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
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
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
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
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
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
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
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

def find_question_directory(question_id, BASE_DIR):
    """
    Find the question directory for a given question ID
    Searches through the results directory structure
    """
    try:
        # Search through all PDF directories in results
        for pdf_dir in os.listdir(BASE_DIR):
            pdf_path = os.path.join(BASE_DIR, pdf_dir)
            if not os.path.isdir(pdf_path):
                continue
            
            # Look for the question ID in this PDF's directory
            for question_dir_name in os.listdir(pdf_path):
                if question_dir_name == question_id or question_dir_name.endswith(f"_{question_id}"):
                    question_dir = os.path.join(pdf_path, question_dir_name)
                    if os.path.isdir(question_dir):
                        return question_dir
        
        # Fallback: check if it's an old-style question ID (direct in results)
        old_style_dir = os.path.join(BASE_DIR, question_id)
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
    # if os.path.exists(DOWNLOADS_DIR):
    #     all_documents.extend(scan_batch_documents(DOWNLOADS_DIR))

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
    
# Add these endpoints to your routes.py file

# =============================================================================
# ENHANCED PROVENANCE AND HIGHLIGHTING ENDPOINTS
# =============================================================================

@main.route('/get-next-provenance/<question_id>', methods=['POST'])
def get_next_provenance_route_enhanced(question_id):
    """Enhanced get next provenance with coordinate highlighting support"""
    try:
        data = request.json or {}
        current_count = data.get('current_count', 0)
        
        # Find the question directory
        question_dir = find_question_directory(question_id, TEST_SUITE_OUTPUT_DIR)
        if not question_dir:
            return jsonify({
                'success': False,
                'error': 'Question not found'
            }), 404
        
        # Get the next provenance
        result = get_next_provenance(question_dir, current_count)
        
        if result.get('has_more', False) and 'provenance' in result:
            # Get the document filename from metadata
            metadata = text_processing_manager.load_question_metadata(question_dir)
            filename = metadata.get('filename') if metadata else None
            
            if filename:
                # Try to add coordinate highlighting data
                provenance = result['provenance']
                sentence_ids = provenance.get('provenance_ids', provenance.get('sentences_ids', []))
                
                if sentence_ids:
                    try:
                        # Try to get coordinate highlights using file finder
                        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
                        
                        if mapping_info:
                            # Load mapping data and add coordinate highlights
                            with open(mapping_info['path'], 'r', encoding='utf-8') as f:
                                mapping_data = json.load(f)
                            
                            coordinate_highlights = get_coordinate_highlights_from_mappings(
                                sentence_ids, mapping_data
                            )
                            
                            if coordinate_highlights:
                                provenance['coordinate_highlights'] = coordinate_highlights
                                provenance['hasCoordinateData'] = True
                                logger.info(f"✅ Added coordinate highlights for {len(coordinate_highlights)} pages")
                            else:
                                provenance['hasCoordinateData'] = False
                        else:
                            provenance['hasCoordinateData'] = False
                            
                    except Exception as highlight_error:
                        logger.warning(f"Could not add coordinate highlights: {highlight_error}")
                        provenance['hasCoordinateData'] = False
            
            # Update metadata to track user's provenance requests
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

def get_coordinate_highlights_from_mappings(sentence_ids, mapping_data):
    """Extract coordinate highlights from mapping data for given sentence IDs"""
    try:
        sentence_mappings = mapping_data.get('sentence_mappings', mapping_data.get('sentence_to_items', {}))
        
        if not sentence_mappings:
            return None
        
        highlights_by_page = {}
        
        for sentence_id in sentence_ids:
            sentence_key = str(sentence_id)
            mapping = sentence_mappings.get(sentence_key, {})
            
            if mapping.get('found', False):
                stable_elements = mapping.get('stable_elements', [])
                
                for element in stable_elements:
                    page_key = f"page_{element.get('page', 1)}"
                    
                    if page_key not in highlights_by_page:
                        highlights_by_page[page_key] = []
                    
                    highlights_by_page[page_key].append({
                        'sentence_id': sentence_id,
                        'stable_index': element.get('stable_index'),
                        'text': element.get('text', ''),
                        'coordinates': element.get('coordinates', {}),
                        'confidence': element.get('combined_confidence', element.get('overlap_confidence', 0.8)),
                        'match_source': element.get('match_source', 'mapping'),
                        'identifiers': element.get('identifiers', {})
                    })
        
        return highlights_by_page if highlights_by_page else None
        
    except Exception as e:
        logger.error(f"Error extracting coordinate highlights: {e}")
        return None

@main.route('/documents/<filename>/sentence-items', methods=['GET'])
def get_sentence_stable_items_enhanced(filename):
    """Get stable item mappings for specific sentences - enhanced version"""
    try:
        sentence_ids_param = request.args.get('ids')
        
        if not sentence_ids_param:
            return jsonify({
                'success': False,
                'error': 'sentence_ids parameter required'
            }), 400
        
        sentence_ids = sentence_ids_param.split(',')
        logger.info(f"🎯 Sentence stable item mappings requested for {filename}, sentences: {', '.join(sentence_ids)}")
        
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No mappings for {filename}',
                'suggestion': 'Document may need to be processed with coordinate extraction'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        # Handle both old and new mapping formats
        sentence_mappings = mapping_data.get('sentence_mappings', mapping_data.get('sentence_to_items', {}))
        
        if not sentence_mappings:
            return jsonify({
                'success': False,
                'error': 'No sentence mappings found in mapping data'
            }), 404
        
        # Filter to only the requested sentences
        filtered_mappings = {}
        found_count = 0
        
        for sentence_id in sentence_ids:
            sentence_key = str(sentence_id).strip()
            if sentence_key in sentence_mappings:
                mapping = sentence_mappings[sentence_key]
                
                # Ensure mapping has the 'found' status
                if mapping.get('found', True):  # Default to True for backward compatibility
                    filtered_mappings[sentence_key] = mapping
                    found_count += 1
        
        logger.info(f"✅ Returning mappings for {found_count}/{len(sentence_ids)} sentences")
        
        return jsonify({
            'success': True,
            'sentence_mappings': filtered_mappings,
            'requested_sentences': sentence_ids,
            'found_sentences': list(filtered_mappings.keys()),
            'debug': {
                'total_available_mappings': len(sentence_mappings),
                'mapping_source': mapping_info['location']
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting sentence items for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
# Enhanced route in routes.py for better consumption-aware mappings

@main.route('/documents/<filename>/sentence-items-enhanced', methods=['GET'])
def get_sentence_stable_items_consumption_aware(filename):
    """
    Get stable item mappings with enhanced consumption analysis for precise highlighting
    """
    try:
        sentence_ids_param = request.args.get('ids')
        include_consumption_analysis = request.args.get('include_consumption_analysis', 'true').lower() == 'true'
        
        if not sentence_ids_param:
            return jsonify({
                'success': False,
                'error': 'sentence_ids parameter required'
            }), 400
        
        sentence_ids = sentence_ids_param.split(',')
        logger.info(f"🎯 Enhanced sentence mappings requested for {filename}, sentences: {', '.join(sentence_ids)}")
        
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No stable mappings for {filename}',
                'suggestion': 'Document may need to be processed with coordinate extraction'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        sentence_mappings = mapping_data.get('sentence_mappings', {})
        
        if not sentence_mappings:
            return jsonify({
                'success': False,
                'error': 'No sentence mappings found in mapping data'
            }), 404
        
        # Process and enhance mappings
        enhanced_mappings = {}
        
        for sentence_id in sentence_ids:
            sentence_key = str(sentence_id).strip()
            
            if sentence_key not in sentence_mappings:
                enhanced_mappings[sentence_key] = {
                    'sentence_id': sentence_id,
                    'found': False,
                    'reason': 'sentence_not_in_mappings'
                }
                continue
            
            mapping = sentence_mappings[sentence_key]
            
            if not mapping.get('found', False):
                enhanced_mappings[sentence_key] = {
                    **mapping,
                    'sentence_id': sentence_id,
                    'found': False
                }
                continue
            
            # Enhance the mapping with consumption analysis
            enhanced_mapping = enhance_mapping_with_consumption_analysis(mapping, sentence_id, include_consumption_analysis)
            enhanced_mappings[sentence_key] = enhanced_mapping
        
        # Calculate overall quality metrics
        quality_metrics = calculate_mapping_quality_metrics(enhanced_mappings)
        
        return jsonify({
            'success': True,
            'sentence_mappings': enhanced_mappings,
            'quality_metrics': quality_metrics,
            'metadata': {
                'requested_sentences': sentence_ids,
                'found_sentences': [k for k, v in enhanced_mappings.items() if v.get('found', False)],
                'mapping_source': mapping_info['location'],
                'total_available_mappings': len(sentence_mappings),
                'consumption_analysis_included': include_consumption_analysis
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting enhanced sentence items for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def enhance_mapping_with_consumption_analysis(mapping, sentence_id, include_analysis=True):
    """
    Enhance a sentence mapping with consumption-aware analysis
    """
    enhanced = dict(mapping)
    enhanced['sentence_id'] = sentence_id
    
    if not include_analysis or not mapping.get('stable_elements'):
        return enhanced
    
    # Analyze stable elements for consumption quality
    stable_elements = mapping['stable_elements']
    sentence_text = mapping.get('sentence_text', '')
    
    # Extract sentence words for validation
    sentence_words = set()
    if sentence_text:
        sentence_words = set(
            sentence_text.lower()
            .replace(',', ' ')
            .replace('.', ' ')
            .replace('!', ' ')
            .replace('?', ' ')
            .replace(';', ' ')
            .replace(':', ' ')
            .split()
        )
        sentence_words = {word for word in sentence_words if len(word) > 2}
    
    # Analyze each element
    analyzed_elements = []
    high_quality_count = 0
    total_consumption = 0
    total_relevance = 0
    
    for element in stable_elements:
        analyzed_element = dict(element)
        
        consumption_ratio = element.get('consumption_ratio', 0)
        words_consumed = element.get('words_consumed', [])
        
        # Calculate word relevance
        if sentence_words and words_consumed:
            relevant_words = [w for w in words_consumed if w.lower() in sentence_words]
            word_relevance = len(relevant_words) / len(words_consumed) if words_consumed else 0
        else:
            word_relevance = 0.5  # Default if no data
        
        # Calculate quality score
        quality_score = (consumption_ratio * 0.7) + (word_relevance * 0.3)
        
        # Determine quality tier
        if quality_score >= 0.7:
            quality_tier = 'high'
            high_quality_count += 1
        elif quality_score >= 0.4:
            quality_tier = 'medium'
        else:
            quality_tier = 'low'
        
        # Add analysis to element
        analyzed_element.update({
            'word_relevance': word_relevance,
            'quality_score': quality_score,
            'quality_tier': quality_tier,
            'relevant_words': relevant_words if sentence_words and words_consumed else [],
            'consumption_analysis': {
                'consumption_ratio': consumption_ratio,
                'words_consumed_count': len(words_consumed),
                'relevant_words_count': len(relevant_words) if sentence_words and words_consumed else 0,
                'precision': word_relevance,
                'is_high_quality': quality_score >= 0.7
            }
        })
        
        analyzed_elements.append(analyzed_element)
        total_consumption += consumption_ratio
        total_relevance += word_relevance
    
    # Update the mapping with analyzed elements
    enhanced['stable_elements'] = analyzed_elements
    
    # Add overall analysis
    enhanced['consumption_analysis'] = {
        'total_elements': len(stable_elements),
        'high_quality_elements': high_quality_count,
        'avg_consumption_ratio': total_consumption / len(stable_elements) if stable_elements else 0,
        'avg_word_relevance': total_relevance / len(stable_elements) if stable_elements else 0,
        'overall_quality': calculate_overall_quality(high_quality_count, len(stable_elements), total_consumption, total_relevance),
        'sentence_words_count': len(sentence_words),
        'recommended_for_highlighting': high_quality_count > 0 and (total_consumption / len(stable_elements)) > 0.3
    }
    
    return enhanced


def calculate_overall_quality(high_quality_count, total_elements, total_consumption, total_relevance):
    """Calculate overall quality score for a sentence mapping"""
    if total_elements == 0:
        return 0
    
    high_quality_ratio = high_quality_count / total_elements
    avg_consumption = total_consumption / total_elements
    avg_relevance = total_relevance / total_elements
    
    # Weighted combination
    overall_score = (high_quality_ratio * 0.4) + (avg_consumption * 0.3) + (avg_relevance * 0.3)
    
    return min(1.0, max(0.0, overall_score))


def calculate_mapping_quality_metrics(enhanced_mappings):
    """Calculate quality metrics across all mappings"""
    found_mappings = [m for m in enhanced_mappings.values() if m.get('found', False)]
    
    if not found_mappings:
        return {
            'total_sentences': len(enhanced_mappings),
            'found_sentences': 0,
            'avg_quality': 0,
            'high_quality_sentences': 0,
            'recommended_for_highlighting': 0
        }
    
    total_quality = 0
    high_quality_count = 0
    recommended_count = 0
    
    for mapping in found_mappings:
        analysis = mapping.get('consumption_analysis', {})
        overall_quality = analysis.get('overall_quality', 0)
        
        total_quality += overall_quality
        
        if overall_quality >= 0.7:
            high_quality_count += 1
        
        if analysis.get('recommended_for_highlighting', False):
            recommended_count += 1
    
    return {
        'total_sentences': len(enhanced_mappings),
        'found_sentences': len(found_mappings),
        'avg_quality': total_quality / len(found_mappings),
        'high_quality_sentences': high_quality_count,
        'recommended_for_highlighting': recommended_count,
        'quality_distribution': {
            'high': high_quality_count,
            'medium': len([m for m in found_mappings 
                          if 0.4 <= m.get('consumption_analysis', {}).get('overall_quality', 0) < 0.7]),
            'low': len([m for m in found_mappings 
                       if m.get('consumption_analysis', {}).get('overall_quality', 0) < 0.4])
        }
    }

@main.route('/documents/<filename>/highlight-data', methods=['POST'])
def get_highlight_data_for_sentences(filename):
    """Get highlight data for specific sentence IDs - matches mock server functionality"""
    try:
        data = request.json or {}
        sentence_ids = data.get('sentence_ids', [])
        provenance_id = data.get('provenance_id')
        
        logger.info(f"🎯 Highlight data requested for {filename}, sentences: {sentence_ids}")
        
        if not sentence_ids or not isinstance(sentence_ids, list):
            return jsonify({
                'success': False,
                'error': 'sentence_ids array is required'
            }), 400
        
        # Use file finder to get mapping data
        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No stable mappings found for {filename}',
                'suggestion': 'Document may need to be processed with coordinate extraction'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        # Generate highlight data
        highlight_data = get_highlight_data_for_sentence_ids(sentence_ids, mapping_data)
        
        if not highlight_data:
            return jsonify({
                'success': False,
                'error': 'No highlight data could be generated',
                'debug': {
                    'sentence_ids': sentence_ids,
                    'mapping_available': True,
                    'mapping_source': mapping_info['location']
                }
            }), 404
        
        return jsonify({
            'success': True,
            'highlight_data': highlight_data,
            'metadata': {
                'filename': filename,
                'sentence_ids': sentence_ids,
                'provenance_id': provenance_id,
                'total_elements': highlight_data.get('stable_elements', []),
                'pages_covered': len(highlight_data.get('highlights_by_page', {}))
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting highlight data for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def get_highlight_data_for_sentence_ids(sentence_ids, mapping_data):
    """Generate highlight data structure from mapping data"""
    try:
        sentence_mappings = mapping_data.get('sentence_mappings', mapping_data.get('sentence_to_items', {}))
        
        highlight_data = {
            'sentence_count': len(sentence_ids),
            'highlights_by_page': {},
            'stable_elements': [],
            'bounding_boxes': []
        }
        
        for sentence_id in sentence_ids:
            sentence_key = str(sentence_id)
            mapping = sentence_mappings.get(sentence_key, {})
            
            if not mapping.get('found', False):
                logger.warning(f"⚠️ No mapping found for sentence {sentence_id}")
                continue
            
            stable_elements = mapping.get('stable_elements', [])
            
            for element in stable_elements:
                page = element.get('page', 1)
                coordinates = element.get('coordinates', {})
                
                # Group by page
                page_key = f"page_{page}"
                if page_key not in highlight_data['highlights_by_page']:
                    highlight_data['highlights_by_page'][page_key] = []
                
                highlight_data['highlights_by_page'][page_key].append({
                    'stable_index': element.get('stable_index'),
                    'coordinates': coordinates,
                    'overlap_confidence': element.get('overlap_confidence', 0.8),
                    'text_similarity': element.get('text_similarity', 0.8),
                    'confidence': element.get('combined_confidence', element.get('overlap_confidence', 0.8)),
                    'sentence_id': sentence_id,
                    'text_preview': element.get('text', '')[:50] if element.get('text') else ''
                })
                
                # Add to flat arrays
                highlight_data['stable_elements'].append(element.get('stable_index'))
                highlight_data['bounding_boxes'].append({
                    'page': page,
                    'x': coordinates.get('x', 0),
                    'y': coordinates.get('y', 0),
                    'width': coordinates.get('width', 0),
                    'height': coordinates.get('height', 0),
                    'sentence_id': sentence_id,
                    'stable_index': element.get('stable_index')
                })
        
        return highlight_data
        
    except Exception as e:
        logger.error(f"Error generating highlight data: {e}")
        return None

@main.route('/documents/<filename>/processing-status', methods=['GET'])
def get_document_processing_status(filename):
    """Get processing status for coordinate extraction - matches mock server"""
    try:
        base_name = filename.replace('.pdf', '')
        logger.info(f"📊 Processing status requested for {filename}")
        
        # Check for various processed files using file finder
        all_files = get_file_finder().find_all_files(filename)
        
        files_available = {
            'sentences': all_files.get('sentences') is not None,
            'layout': all_files.get('layout') is not None,
            'mappings': all_files.get('stable_mappings') is not None
        }
        
        # Check if we have a processing summary (if you implement this)
        processing_summary_path = os.path.join(
            current_app.config.get('UPLOAD_FOLDER', 'app/uploads'), 
            f"{base_name}_processing_summary.json"
        )
        
        has_processing_summary = os.path.exists(processing_summary_path)
        processing_info = {}
        
        if has_processing_summary:
            try:
                with open(processing_summary_path, 'r', encoding='utf-8') as f:
                    processing_info = json.load(f)
            except Exception as e:
                logger.warning(f"Could not read processing summary: {e}")
        
        # Determine if fully processed
        processed = all(files_available.values())
        
        return jsonify({
            'success': True,
            'processed': processed,
            'processing_date': processing_info.get('processing_date', 'unknown'),
            'steps_completed': processing_info.get('steps_completed', list(files_available.keys())),
            'files_created': {k: v for k, v in files_available.items() if v},
            'errors': processing_info.get('errors', []),
            'has_processing_summary': has_processing_summary,
            'files_available': files_available
        })
        
    except Exception as e:
        logger.error(f"Error checking processing status for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/test-questions/<filename>', methods=['GET'])
def get_test_questions_for_document(filename):
    """Get test questions for a document - matches mock server format"""
    try:
        logger.info(f"🎯 Test questions requested for: {filename}")
        
        # Load test suite data
        test_suite_data = load_test_suite_data(filename)
        
        if not test_suite_data:
            return jsonify({
                'success': True,
                'questions': [],
                'message': f'No test questions found for {filename}',
                'document_name': filename,
                'total_questions': 0
            })
        
        # Convert test suite format to frontend-friendly format
        quick_questions = []
        
        for entry in test_suite_data:
            if not isinstance(entry, dict):
                continue
                
            for question_id, question_data in entry.items():
                if not isinstance(question_data, dict):
                    continue
                
                # Extract question info
                question_text = question_data.get('question', '')
                answer = question_data.get('answer', '')
                provenance_data = question_data.get('provenance', [])
                metadata = question_data.get('metadata', {})
                
                # Check if has valid answer
                has_answer = bool(answer and answer.strip() and answer.upper() != 'NULL')
                
                quick_questions.append({
                    'question_id': question_id,
                    'question_text': question_text,
                    'has_answer': has_answer,
                    'answer_preview': answer[:100] + '...' if len(answer) > 100 else answer,
                    'provenance_count': len(provenance_data),
                    'provenance_data': provenance_data,  # Include full provenance data
                    'processing_time': metadata.get('processing_time', 0),
                    'created_at': metadata.get('created_at', time.time()),
                    'document_name': filename
                })
        
        return jsonify({
            'success': True,
            'questions': quick_questions,
            'document_name': filename,
            'total_questions': len(quick_questions)
        })
        
    except Exception as e:
        logger.error(f"Error getting test questions for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 
        
# Add this import at the top of your routes file
from .sentence_matcher_simple import SentenceMatcher

@main.route('/find_sentence_matches', methods=['POST'])
def find_sentence_matches():
    """Flask endpoint to find sentence matches in elements"""
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        target_sentence = data.get('target_sentence', '')
        elements = data.get('elements', [])
        
        if not target_sentence:
            return jsonify({
                'success': False,
                'error': 'Missing target_sentence'
            }), 400
            
        if not elements:
            return jsonify({
                'success': False,
                'error': 'Missing elements'
            }), 400
        
        logger.info(f"🔍 Sentence matching request: '{target_sentence}' with {len(elements)} elements")
        
        matcher = SentenceMatcher()
        result = matcher.find_best_sentence_match(target_sentence, elements)
        
        logger.info(f"✅ Sentence matching result: {result.get('success', False)}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in find_sentence_matches endpoint: {e}", exc_info=True)  # Added exc_info for full traceback
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/highlight-test/<filename>', methods=['POST'])
def debug_highlight_test(filename):
    """Debug highlight test endpoint - matches mock server"""
    try:
        data = request.json or {}
        test_sentence_ids = data.get('test_sentence_ids', [0, 1, 2])
        include_debug_info = data.get('include_debug_info', True)
        
        logger.info(f"🐛 Debug highlight test for {filename}, sentences: {test_sentence_ids}")
        
        # Use file finder to get mapping data
        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
        
        if not mapping_info:
            return jsonify({
                'success': False,
                'error': f'No stable mappings found for {filename}'
            }), 404
        
        # Load mapping data
        with open(mapping_info['path'], 'r', encoding='utf-8') as f:
            mapping_data = json.load(f)
        
        # Generate highlight data
        highlight_data = get_highlight_data_for_sentence_ids(test_sentence_ids, mapping_data)
        
        debug_info = {}
        
        if include_debug_info:
            try:
                # Add debug information
                debug_info.update({
                    'mapping_metadata': mapping_data.get('metadata', {}),
                    'mapping_statistics': mapping_data.get('statistics', {}),
                    'total_sentence_mappings': len(mapping_data.get('sentence_mappings', {})),
                    'mapping_source': mapping_info['location']
                })
                
                # Load layout info if available for additional debug
                layout_info = get_file_finder().find_file(filename, 'layout')
                if layout_info:
                    with open(layout_info['path'], 'r', encoding='utf-8') as f:
                        layout_data = json.load(f)
                    debug_info['layout_metadata'] = layout_data.get('metadata', {})
                
            except Exception as debug_error:
                debug_info['debug_error'] = str(debug_error)
        
        return jsonify({
            'success': True,
            'highlight_data': highlight_data,
            'debug_info': debug_info,
            'test_parameters': {
                'filename': filename,
                'test_sentence_ids': test_sentence_ids,
                'include_debug_info': include_debug_info
            }
        })
        
    except Exception as e:
        logger.error(f"Error in debug highlight test for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@main.route('/documents/<filename>/mappings', methods=['GET'])
def get_document_mappings_overview(filename):
    """Get mapping statistics and document info overview"""
    try:
        logger.info(f"📝 Mappings overview requested for {filename}")
        basename = filename.replace('.pdf', '')
        # Use file finder to locate mapping data
        mapping_info = get_file_finder().find_file(filename, 'stable_mappings')
        
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
        questions_info = get_file_finder().find_file(filename, 'questions')
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


@main.route('/drive/init', methods=['POST'])
def init_drive_services():
    """Manually initialize drive services"""
    try:
        success = google_drive_manager.initialize_drive_services()
        if success:
            inventory_size = len(google_drive_manager.drive_inventory_df) if google_drive_manager.drive_inventory_df is not None else 0
        else:
            inventory_size = 0
            
        return jsonify({
            'success': success,
            'message': 'Drive services initialized successfully' if success else 'Failed to initialize drive services',
            'inventory_size': inventory_size
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/drive/status', methods=['GET'])
def drive_status():
    """Check drive services status"""
    status = google_drive_manager.get_status()
    return jsonify(status)

@main.route('/drive/counties', methods=['GET'])
def get_drive_counties():
    """Get counties with PDF statistics"""
    try:
        if not google_drive_manager.drive_services_available:
            if not google_drive_manager.initialize_drive_services():
                return jsonify({
                    'success': False,
                    'error': 'Google Drive services not available. Please check configuration.',
                    'need_init': True
                }), 503
        
        counties = google_drive_manager.get_counties()
        return jsonify({
            'success': True,
            'counties': counties
        })
        
    except Exception as e:
        logger.error(f"❌ Error in get_drive_counties: {e}")
        return jsonify({
            'success': False, 
            'error': str(e)
        }), 500

@main.route('/drive/agencies/<county>', methods=['GET'])
def get_drive_agencies_by_county(county):
    """Get agencies within a county"""
    try:
        agencies = google_drive_manager.get_agencies_by_county(county)
        return jsonify({
            'success': True,
            'agencies': agencies
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/drive/files/<county>/<agency>', methods=['GET'])
def get_drive_files_by_agency(county, agency):
    """Get PDF files for a specific agency"""
    try:
        files = google_drive_manager.get_files_by_agency(county, agency)
        return jsonify({
            'success': True,
            'files': files
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@main.route('/drive/download', methods=['POST'])
def download_and_process_drive_file():
    """Download PDF from Drive and process it"""
    try:
        data = request.get_json()
        if not data or 'file_id' not in data:
            return jsonify({
                'success': False,
                'error': 'file_id is required in request body'
            }), 400
            
        file_id = data['file_id']
        
        # Download and validate the file
        download_result = google_drive_manager.download_and_process_file(file_id)
        
        if not download_result['success']:
            return jsonify(download_result), 400 if 'not extractable' in download_result.get('error', '') else 500
        
        # Process the downloaded PDF
        try:
            filepath = download_result['filepath']
            pdf_text, sentences = text_processing_manager.extract_pdf_text_and_sentences(filepath)
            sentences_saved = text_processing_manager.save_document_sentences(download_result['safe_filename'], sentences)
            
            logger.info(f"✅ Successfully processed {download_result['safe_filename']}")
            
            return jsonify({
                'success': True,
                'filename': download_result['safe_filename'],
                'path_hash': download_result['path_hash'],
                'original_path': download_result['original_path'],
                'message': f'Successfully downloaded and processed {download_result["original_filename"]}',
                'metadata': {
                    'sentence_count': len(sentences),
                    'text_length': len(pdf_text),
                    'sentences_available': sentences_saved,
                    'source': 'google_drive',
                    **download_result['metadata']
                }
            })
            
        except Exception as process_error:
            # Clean up the file if processing failed
            try:
                os.remove(download_result['filepath'])
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

@main.route('/drive/sample-documents', methods=['POST'])
def sample_extractable_documents():
    """Sample random PDFs, find extractable ones, and fully process them"""
    try:
        data = request.get_json() or {}
        max_documents = data.get('max_documents', 5)
        max_attempts = data.get('max_attempts', 20)
        
        result = google_drive_manager.sample_extractable_documents(max_documents, max_attempts)
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"❌ Error in sampling: {e}")
        return jsonify({
            'success': False,
            'error': f'Sampling failed: {str(e)}'
        }), 500
    
def get_sampler():
    """Get the global provisional case sampler instance"""
    global provisional_sampler
    if provisional_sampler is None:
        provisional_sampler = GoogleDriveProvisionalSampler(DOWNLOADS_DIR)
    return provisional_sampler

@main.route('/drive/pvc-sample/init', methods=['POST'])
def init_provisional_sampler():
        """Initialize the provisional case sampler"""
        try:
            sampler = get_sampler()
            success = sampler.initialize_drive_services()
            
            if success:
                return jsonify({
                    'success': True,
                    'message': 'Provisional case sampler initialized',
                    'status': sampler.get_status()
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Failed to initialize sampler'
                }), 503
                
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
@main.route('/drive/pvc-sample/cases', methods=['GET'])
def get_provisional_cases():
    """Get available provisional cases"""
    try:
        sampler = get_sampler()
        return jsonify(sampler.get_available_provisional_cases())
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/drive/pvc-sample/get-documents', methods=['POST'])
def sample_provisional_documents():
    """Sample documents from provisional cases"""
    try:
        data = request.get_json() or {}
        target_count = data.get('target_count', 30)
        max_attempts = data.get('max_attempts', 100)
        prefer_diverse_cases = data.get('prefer_diverse_cases', True)
        min_pages = data.get('min_pages', 2)
        
        sampler = get_sampler()
        result = sampler.sample_documents(
            target_count=target_count,
            max_attempts=max_attempts,
            prefer_diverse_cases=prefer_diverse_cases,
            min_pages=min_pages
        )
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/drive/pvc-sample/downloaded-summary', methods=['GET'])
def get_downloaded_summary():
    """Get summary of downloaded files organized by provisional case"""
    try:
        logger.info("📊 Getting downloaded files summary...")
        sampler = get_sampler()
        
        # Get the raw file summary
        summary = sampler.get_downloaded_files_summary()
        logger.info(f"📋 Raw summary result: success={summary.get('success')}, total_files={summary.get('total_files', 0)}")
        
        if not summary['success']:
            logger.warning(f"⚠️ Failed to get file summary: {summary}")
            return jsonify(summary)
        
        # Log the raw summary structure
        logger.info(f"📁 Summary structure: {list(summary.keys())}")
        if 'cases' in summary:
            logger.info(f"📂 Found {len(summary['cases'])} cases: {list(summary['cases'].keys())}")
        
        # Enhance the summary with metadata from the original inventory
        enhanced_summary = enhance_file_summary_with_metadata(sampler, summary)
        
        # Log the enhanced summary
        logger.info(f"✅ Enhanced summary ready: {enhanced_summary.get('total_files', 0)} files in {enhanced_summary.get('total_cases', 0)} cases")
        if 'cases' in enhanced_summary:
            for case_name, case_data in enhanced_summary['cases'].items():
                logger.info(f"  📁 Case {case_name}: {len(case_data.get('files', []))} files")
        
        return jsonify(enhanced_summary)
        
    except Exception as e:
        logger.error(f"❌ Error getting downloaded summary: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
    
@main.route('/documents/filter-analysis', methods=['POST'])
def filter_analysis():
    """
    Analyze documents for filtering without actually filtering them
    Just returns which documents/questions are good
    """
    try:
        data = request.json
        documents = data.get('documents', [])
        thresholds = data.get('thresholds', DEFAULT_THRESHOLDS)
        
        # Analyze each document
        analysis = {}
        for doc in documents:
            filename = doc.get('filename')
            if not filename:
                continue
                
            analysis[filename] = {
                'isGoodDocument': is_good_document(doc, thresholds),
                'goodQuestions': [q.get('question_id') for q in doc.get('questions', []) if is_good_question(q, thresholds)],
                'totalQuestions': len(doc.get('questions', [])),
                'goodQuestionCount': len([q for q in doc.get('questions', []) if is_good_question(q, thresholds)])
            }
        
        # Get overall stats
        stats = get_filtering_stats(documents, thresholds)
        
        return jsonify({
            'success': True,
            'analysis': analysis,
            'stats': stats
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/filtered', methods=['POST'])
def get_filtered_documents():
    """
    Filter documents on the backend
    """
    try:
        data = request.json
        documents = data.get('documents', [])
        thresholds = data.get('thresholds', DEFAULT_THRESHOLDS)
        only_good_documents = data.get('onlyGoodDocuments', False)
        
        filtered_documents = []
        
        for doc in documents:
            # Filter questions within each document
            filtered_questions = [q for q in doc.get('questions', []) if is_good_question(q, thresholds)]
            
            # Create filtered document
            filtered_doc = {
                **doc,
                'questions': filtered_questions,
                'filteringAnalysis': {
                    'totalQuestions': len(doc.get('questions', [])),
                    'goodQuestions': len(filtered_questions),
                    'goodQuestionRatio': len(filtered_questions) / len(doc.get('questions', [])) if doc.get('questions') else 0,
                    'isGoodDocument': is_good_document(doc, thresholds)
                }
            }
            
            # Only include if it passes document filter (if requested)
            if only_good_documents:
                if filtered_doc['filteringAnalysis']['isGoodDocument']:
                    filtered_documents.append(filtered_doc)
            else:
                filtered_documents.append(filtered_doc)
        
        # Get overall stats
        stats = get_filtering_stats(documents, thresholds)
        
        return jsonify({
            'success': True,
            'documents': filtered_documents,
            'stats': stats
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Replace your enhance_file_summary_with_metadata function with this debug version:

def enhance_file_summary_with_metadata(sampler, summary):
    """Enhance file summary with metadata from the drive inventory"""
    try:
        logger.info(f"🔍 Enhancing summary with metadata...")
        
        if not sampler.drive_services_available or sampler.drive_inventory_df is None:
            logger.warning("⚠️ Drive services not available or inventory is None")
            # Return basic summary without enhancement
            return summary
        
        logger.info(f"📊 Drive inventory has {len(sampler.drive_inventory_df)} entries")
        
        # Create a lookup dictionary from the inventory
        inventory_lookup = {}
        for _, row in sampler.drive_inventory_df.iterrows():
            file_id = row.get('extracted_file_id')
            if file_id:
                inventory_lookup[file_id] = {
                    'county': row.get('county', 'Unknown'),
                    'agency': row.get('agency', 'Unknown'), 
                    'subject': row.get('subject', 'Unknown'),
                    'incident_date': row.get('incident_date'),
                    'case_numbers': row.get('case_numbers'),
                    'page_count': int(row.get('page_num', 0))
                }
        
        logger.info(f"📋 Created inventory lookup with {len(inventory_lookup)} entries")
        
        # Enhance each file with metadata
        enhanced_cases = {}
        for case_name, case_data in summary.get('cases', {}).items():
            enhanced_files = []
            
            logger.info(f"📁 Processing case {case_name} with {len(case_data['files'])} files")
            
            for file_info in case_data['files']:
                gdrive_id = file_info['gdrive_id']
                logger.info(f"  🔍 Looking up gdrive_id: {gdrive_id}")
                
                # Look up metadata from inventory
                metadata = inventory_lookup.get(gdrive_id)
                if metadata:
                    logger.info(f"    ✅ Found metadata: county={metadata['county']}, agency={metadata['agency']}")
                else:
                    logger.warning(f"    ❌ No metadata found for gdrive_id: {gdrive_id}")
                    metadata = {
                        'county': 'Unknown',
                        'agency': 'Unknown',
                        'subject': 'Unknown',
                        'incident_date': None,
                        'case_numbers': None,
                        'page_count': 0
                    }
                
                enhanced_file = {
                    **file_info,
                    'metadata': metadata
                }
                enhanced_files.append(enhanced_file)
            
            enhanced_cases[case_name] = {
                **case_data,
                'files': enhanced_files
            }
        
        enhanced_summary = {
            **summary,
            'cases': enhanced_cases
        }
        
        logger.info(f"✅ Enhancement complete")
        return enhanced_summary
        
    except Exception as e:
        # If enhancement fails, return the original summary
        logger.error(f"❌ Failed to enhance summary with metadata: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return summary
    
@main.route('/debug/pvc-summary-structure', methods=['GET'])
def debug_summary_structure():
    """Debug route to examine the structure of the enhanced summary"""
    try:
        sampler = get_sampler()
        
        # Get raw summary
        raw_summary = sampler.get_downloaded_files_summary()
        logger.info(f"📋 Raw summary success: {raw_summary.get('success')}")
        
        # Get enhanced summary
        enhanced_summary = enhance_file_summary_with_metadata(sampler, raw_summary)
        
        # Create debug info
        debug_info = {
            'raw_summary_structure': {
                'success': raw_summary.get('success'),
                'total_cases': raw_summary.get('total_cases'),
                'total_files': raw_summary.get('total_files'),
                'cases_keys': list(raw_summary.get('cases', {}).keys())
            },
            'enhanced_summary_structure': {
                'success': enhanced_summary.get('success'),
                'total_cases': enhanced_summary.get('total_cases'),
                'total_files': enhanced_summary.get('total_files'),
                'cases_keys': list(enhanced_summary.get('cases', {}).keys())
            },
            'sample_file_structure': {},
            'inventory_info': {
                'drive_services_available': sampler.drive_services_available,
                'inventory_loaded': sampler.drive_inventory_df is not None,
                'inventory_size': len(sampler.drive_inventory_df) if sampler.drive_inventory_df is not None else 0
            }
        }
        
        # Get a sample file structure
        if enhanced_summary.get('cases'):
            first_case_name = list(enhanced_summary['cases'].keys())[0]
            first_case = enhanced_summary['cases'][first_case_name]
            if first_case.get('files'):
                sample_file = first_case['files'][0]
                debug_info['sample_file_structure'] = {
                    'keys': list(sample_file.keys()),
                    'has_metadata': 'metadata' in sample_file,
                    'metadata_keys': list(sample_file.get('metadata', {}).keys()) if 'metadata' in sample_file else [],
                    'gdrive_id': sample_file.get('gdrive_id'),
                    'filename': sample_file.get('filename'),
                    'county_from_metadata': sample_file.get('metadata', {}).get('county') if 'metadata' in sample_file else 'NO_METADATA'
                }
        
        # Check a few gdrive_ids in the inventory
        if sampler.drive_inventory_df is not None and enhanced_summary.get('cases'):
            gdrive_ids_to_check = []
            for case_data in enhanced_summary['cases'].values():
                for file_info in case_data.get('files', []):
                    gdrive_ids_to_check.append(file_info.get('gdrive_id'))
                if len(gdrive_ids_to_check) >= 3:
                    break
            
            debug_info['inventory_lookup_test'] = {}
            for gdrive_id in gdrive_ids_to_check[:3]:
                # Check if this gdrive_id exists in the inventory
                matching_rows = sampler.drive_inventory_df[sampler.drive_inventory_df['extracted_file_id'] == gdrive_id]
                if len(matching_rows) > 0:
                    row = matching_rows.iloc[0]
                    debug_info['inventory_lookup_test'][gdrive_id] = {
                        'found': True,
                        'county': row.get('county'),
                        'agency': row.get('agency'),
                        'provisional_case_name': row.get('provisional_case_name')
                    }
                else:
                    debug_info['inventory_lookup_test'][gdrive_id] = {
                        'found': False,
                        'note': 'gdrive_id not found in inventory'
                    }
        
        return jsonify({
            'success': True,
            'debug_info': debug_info
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
    
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
  
# Create global debugger instance (or inject via config)
debugger = create_pdfjs_debugger({
    'pdfjs_cache_dir': 'pdfjs_cache',
    'sentence_mappings_dir': 'sentence_page_mappings', 
    'sentences_dir': 'sentences'
})

@main.route('/debug/documents', methods=['GET'])
def get_debug_documents():
    """Get list of documents available for debugging"""
    try:
        documents = debugger.get_available_documents()
        return jsonify({
            'success': True,
            'documents': documents,
            'count': len(documents)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/documents/<document_basename>/sentences', methods=['GET'])
def get_debug_document_sentences(document_basename):
    """Get sentences from a document for testing"""
    try:
        limit = request.args.get('limit', type=int)
        sentences = debugger.get_document_sentences(document_basename, limit=limit)
        
        return jsonify({
            'success': True,
            'document': document_basename,
            'sentences': sentences,
            'count': len(sentences)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/documents/<document_basename>/test-sentence', methods=['POST'])
def debug_test_sentence(document_basename):
    """
    Test mapping a specific sentence to PDF.js elements
    
    POST body:
    {
        "sentence": "Note: This form must be received by IRS within 120 days of the signature date.",
        "sentence_id": 38,  // optional
        "reset_consumption": false  // optional
    }
    """
    try:
        data = request.get_json()
        sentence_text = data.get('sentence')
        sentence_id = data.get('sentence_id')
        reset_consumption = data.get('reset_consumption', False)
        
        if not sentence_text:
            return jsonify({
                'success': False,
                'error': 'sentence parameter required'
            }), 400
        
        # Test the sentence mapping
        result = debugger.test_sentence_mapping(
            document_basename, 
            sentence_text, 
            sentence_id=sentence_id,
            reset_consumption=reset_consumption
        )
        
        return jsonify({
            'success': True,
            'result': format_debug_result_for_api(result)
        })
        
    except Exception as e:
        logger.error(f"Error testing sentence for {document_basename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/documents/<document_basename>/test-multiple', methods=['POST'])
def debug_test_multiple_sentences(document_basename):
    """
    Test mapping multiple sentences
    
    POST body:
    {
        "sentences": ["First sentence", "Second sentence"],
        "reset_consumption_between": false  // optional
    }
    """
    try:
        data = request.get_json()
        sentences = data.get('sentences', [])
        reset_consumption_between = data.get('reset_consumption_between', False)
        
        if not sentences:
            return jsonify({
                'success': False,
                'error': 'sentences parameter required'
            }), 400
        
        # Test multiple sentences
        results = debugger.test_multiple_sentences(
            document_basename, 
            sentences,
            reset_consumption_between=reset_consumption_between
        )
        
        formatted_results = [format_debug_result_for_api(result) for result in results]
        
        # Calculate summary stats
        successful_results = [r for r in results if r.success]
        summary = {
            'total_sentences': len(results),
            'successful_mappings': len(successful_results),
            'success_rate': len(successful_results) / len(results) if results else 0,
            'avg_confidence': sum(r.confidence for r in successful_results) / len(successful_results) if successful_results else 0,
            'avg_word_coverage': sum(r.word_coverage for r in successful_results) / len(successful_results) if successful_results else 0,
            'methods_used': {}
        }
        
        # Count methods used
        for result in successful_results:
            method = result.method_used
            summary['methods_used'][method] = summary['methods_used'].get(method, 0) + 1
        
        return jsonify({
            'success': True,
            'results': formatted_results,
            'summary': summary
        })
        
    except Exception as e:
        logger.error(f"Error testing multiple sentences for {document_basename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/documents/<document_basename>/consumption-stats', methods=['GET'])
def get_debug_consumption_stats(document_basename):
    """Get current element consumption statistics"""
    try:
        stats = debugger.get_element_consumption_stats(document_basename)
        
        return jsonify({
            'success': True,
            'document': document_basename,
            'consumption_stats': stats
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/debug/documents/<document_basename>/reset-consumption', methods=['POST'])
def debug_reset_consumption(document_basename):
    """Reset element consumption for a document"""
    try:
        success = debugger.reset_document_consumption(document_basename)
        
        return jsonify({
            'success': success,
            'message': f'Consumption reset for {document_basename}' if success else 'Failed to reset consumption'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Enhanced version of your existing endpoint
@main.route('/documents/<filename>/sentence-items-debug', methods=['GET'])
def get_sentence_stable_items_debug(filename):
    """
    Enhanced version of your existing endpoint with real-time debugging
    """
    try:
        sentence_ids_param = request.args.get('ids')
        include_debug = request.args.get('include_debug', 'false').lower() == 'true'
        reset_consumption = request.args.get('reset_consumption', 'false').lower() == 'true'
        
        if not sentence_ids_param:
            return jsonify({
                'success': False,
                'error': 'sentence_ids parameter required'
            }), 400
        
        sentence_ids = sentence_ids_param.split(',')
        document_basename = filename.replace('.pdf', '')
        
        # Load document data  
        doc_data = debugger.load_document_data(document_basename)
        sentences = doc_data['sentences']
        
        if reset_consumption:
            debugger.reset_document_consumption(document_basename)
        
        # Test each requested sentence
        debug_results = {}
        enhanced_mappings = {}
        
        for sentence_id_str in sentence_ids:
            try:
                sentence_id = int(sentence_id_str.strip())
                
                if sentence_id >= len(sentences):
                    enhanced_mappings[sentence_id_str] = {
                        'sentence_id': sentence_id,
                        'found': False,
                        'reason': 'sentence_id_out_of_range'
                    }
                    continue
                
                sentence_text = sentences[sentence_id]
                
                # Test with debugger
                if include_debug:
                    debug_result = debugger.test_sentence_mapping(
                        document_basename, 
                        sentence_text, 
                        sentence_id=sentence_id
                    )
                    debug_results[sentence_id_str] = format_debug_result_for_api(debug_result)
                
                # Use your existing enhance_mapping_with_consumption_analysis if available
                # Or create a basic mapping from debug result
                if include_debug and debug_result.success:
                    enhanced_mappings[sentence_id_str] = {
                        'sentence_id': sentence_id,
                        'sentence_text': sentence_text,
                        'found': True,
                        'method': debug_result.method_used,
                        'confidence': debug_result.confidence,
                        'word_coverage': debug_result.word_coverage,
                        'stable_elements': debug_result.matched_elements,
                        'bounding_box': debug_result.bounding_box,
                        'debug_info': debug_result.debug_info
                    }
                else:
                    enhanced_mappings[sentence_id_str] = {
                        'sentence_id': sentence_id,
                        'sentence_text': sentence_text,
                        'found': False,
                        'reason': 'debug_mapping_failed'
                    }
                    
            except ValueError:
                enhanced_mappings[sentence_id_str] = {
                    'sentence_id': sentence_id_str,
                    'found': False,
                    'reason': 'invalid_sentence_id'
                }
        
        response_data = {
            'success': True,
            'sentence_mappings': enhanced_mappings,
            'metadata': {
                'requested_sentences': sentence_ids,
                'found_sentences': [k for k, v in enhanced_mappings.items() if v.get('found', False)],
                'document_basename': document_basename,
                'total_document_sentences': len(sentences),
                'debug_mode': include_debug,
                'consumption_reset': reset_consumption
            }
        }
        
        if include_debug:
            response_data['debug_results'] = debug_results
            response_data['consumption_stats'] = debugger.get_element_consumption_stats(document_basename)
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error in debug sentence items for {filename}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
