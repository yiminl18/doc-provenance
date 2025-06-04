import doc_provenance, json, logging, os, random, sys, time, traceback
from datetime import datetime, timedelta
from io import StringIO
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, send_file
from threading import Thread
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text
import doc_provenance.base_strategies

main = Blueprint('main', __name__)

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
LAYOUT_DIR = os.path.join(os.getcwd(), 'app/layout')

# =============================================================================

# Create directories
for directory in [RESULT_DIR, UPLOAD_DIR, STUDY_LOGS_DIR, QUESTIONS_DIR, SENTENCES_DIR]:
    os.makedirs(directory, exist_ok=True)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# Helper Functions (keeping existing ones)
# =============================================================================

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
    
    return all_documents

def get_all_available_layouts():
    """Scan the layout folder and return all layouts with unified metadata"""
    all_documents = []
    
    # Check layout folder
    if os.path.exists(LAYOUT_DIR):
        all_documents.extend(scan_layout_folder(is_preloaded=False))
    
    return all_documents

def scan_layout_folder(is_preloaded = False):
    """Unified PDF scanning for any folder"""
    documents = []
    
    try:
        
        # Get all PDF files
        layout_files = [f for f in os.listdir(LAYOUT_DIR) if f.lower().endswith('_layout.json')]
        
        for layout_file in layout_files:
            layout_file = os.path.join(LAYOUT_DIR, layout_file)
            try:
                with open(layout_file, 'r', encoding='utf-8') as f:
                            layout_dat = json.load(f)
                logger.info(f"Processing PDF: {layout_file} (Preloaded: {is_preloaded})")
                metadata = layout_dat.get('metadata', {})
                sentences = layout_dat.get('sentences', [])
                base_name = os.path.basename(layout_file)  # Get just the file name without path

                pdf_file = base_name.replace('_layout.json', '.pdf')
                metadata = {
                    'filename': pdf_file,

                    'text_length': len(sentences),
                    'sentence_count': len(sentences),
                    'is_preloaded': False,
                    'source_folder': 'preloaded' if is_preloaded else 'uploads',
                    'processed_at': time.time(),
                    'base_name': base_name
                }
                
                # Save metadata
                #with open(metadata_file, 'w', encoding='utf-8') as f:
                #    json.dump(metadata, f, indent=2, ensure_ascii=False)
                
    
                documents.append(metadata)
                
                
            except Exception as e:
                print(f"Error processing {layout_file}: {e}")
                continue
    
    except Exception as e:
        print(f"Error scanning folder {LAYOUT_DIR}: {e}")
    
    return documents

def scan_folder_for_pdfs(folder_path, is_preloaded=False):
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

                     # Check if text extraction succeeded
                    if not pdf_text or not isinstance(pdf_text, str):
                        logger.error(f"Text extraction failed for {pdf_file}: extract_text returned {type(pdf_text)}")
                        continue
                    
                    if len(pdf_text.strip()) == 0:
                        logger.error(f"No text content extracted from {pdf_file}")
                        continue

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
        all_documents = get_all_available_layouts()
        
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
        }), 500