import doc_provenance, hashlib, json, logging, os, random, sys, time, uuid
from datetime import datetime
from io import StringIO
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, session
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text

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

# Directory configurations
RESULT_DIR = os.path.join(os.getcwd(), 'app/results')
PRELOAD_DIR = os.path.join(os.getcwd(), 'app/preloaded')
COLLECTIONS_DIR = os.path.join(os.getcwd(), 'app/collections')
STUDY_LOGS_DIR = os.path.join(os.getcwd(), 'app/study_logs')

# Create directories
for directory in [RESULT_DIR, PRELOAD_DIR, COLLECTIONS_DIR, STUDY_LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def generate_content_hash(content, prefix=""):
    """Generate a consistent hash from content"""
    if isinstance(content, str):
        content = content.encode('utf-8')
    elif isinstance(content, dict):
        content = json.dumps(content, sort_keys=True).encode('utf-8')
    
    hash_obj = hashlib.sha256(content)
    return f"{prefix}{hash_obj.hexdigest()[:12]}"

def generate_session_id():
    """Generate a unique session ID for user study tracking"""
    return f"study_{uuid.uuid4().hex[:12]}"

def get_or_create_user_session():
    """Get or create a user session for the study"""
    if 'user_session_id' not in session:
        session['user_session_id'] = generate_session_id()
        session['session_start_time'] = time.time()
        
        log_user_study_event({
            'event_type': 'session_start',
            'user_session_id': session['user_session_id'],
            'timestamp': time.time(),
            'user_agent': request.headers.get('User-Agent', ''),
            'ip_address': request.remote_addr
        })
    
    return session['user_session_id']

def log_user_study_event(event_data):
    """Log events for user study analysis"""
    try:
        log_file = os.path.join(STUDY_LOGS_DIR, 'user_study_events.jsonl')
        
        event_data.update({
            'logged_at': time.time(),
            'iso_timestamp': datetime.utcnow().isoformat(),
        })
        
        with open(log_file, 'a') as f:
            f.write(json.dumps(event_data) + '\n')
            
    except Exception as e:
        logger.error(f"Error logging user study event: {e}")

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

# =============================================================================
# DOCUMENT MANAGEMENT ENDPOINTS
# =============================================================================

@main.route('/')
def index():
    return render_template('index.html')

# Add this somewhere in your Flask app startup to debug routes
@main.route('/debug/routes')
def show_routes():
    routes = []
    for rule in current_app.url_map.iter_rules():
        routes.append({
            'endpoint': rule.endpoint,
            'methods': list(rule.methods),
            'rule': str(rule)
        })
    return jsonify(routes)

@main.route('/documents', methods=['POST'])
def upload_document():
    """Upload a PDF document and extract its text"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not (file and allowed_file(file.filename)):
        return jsonify({'error': 'File type not allowed'}), 400
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract text from PDF
        pdf_text = extract_text(filepath)
        
        # Extract sentences for later use
        from doc_provenance.base_strategies import extract_sentences_from_pdf
        sentences = extract_sentences_from_pdf(pdf_text)
        
        # Generate document ID
        doc_id = generate_content_hash(f"{filename}_{len(pdf_text)}", "doc_")
        
        # Store document metadata
        doc_data_path = os.path.join(RESULT_DIR, f"{doc_id}_data.json")
        with open(doc_data_path, 'w') as f:
            json.dump({
                'document_id': doc_id,
                'filename': filename,
                'filepath': filepath,
                'text_length': len(pdf_text),
                'sentences': sentences,
                'is_preloaded': False,
                'processed_at': time.time()
            }, f)
        
        # Log document upload
        user_session_id = get_or_create_user_session()
        log_user_study_event({
            'event_type': 'document_uploaded',
            'user_session_id': user_session_id,
            'document_id': doc_id,
            'filename': filename,
            'text_length': len(pdf_text),
            'sentence_count': len(sentences),
            'timestamp': time.time()
        })
        
        return jsonify({
            'success': True,
            'document_id': doc_id,
            'filename': filename,
            'text_length': len(pdf_text),
            'sentence_count': len(sentences),
            'message': 'Document uploaded and processed successfully'
        })
        
    except Exception as e:
        logger.error(f"Error uploading document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>', methods=['GET'])
def get_document(document_id):
    """Get document metadata"""
    try:
        doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
        
        if not os.path.exists(doc_data_path):
            return jsonify({'error': 'Document not found'}), 404
        
        with open(doc_data_path, 'r') as f:
            doc_data = json.load(f)
        
        return jsonify({
            'success': True,
            'document': {
                'document_id': doc_data['document_id'],
                'filename': doc_data['filename'],
                'text_length': doc_data['text_length'],
                'sentence_count': len(doc_data.get('sentences', [])),
                'is_preloaded': doc_data.get('is_preloaded', False),
                'processed_at': doc_data.get('processed_at')
            }
        })
        
    except Exception as e:
        logger.error(f"Error getting document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/text', methods=['GET'])
def get_document_text(document_id):
    """Get the full text of a document"""
    try:
        doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
        
        if not os.path.exists(doc_data_path):
            return jsonify({'error': 'Document not found'}), 404
        
        with open(doc_data_path, 'r') as f:
            doc_data = json.load(f)
        
        # Extract text from the PDF file
        filepath = doc_data['filepath']
        if not os.path.exists(filepath):
            return jsonify({'error': 'PDF file not found'}), 404
        
        pdf_text = extract_text(filepath)
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'text': pdf_text
        })
        
    except Exception as e:
        logger.error(f"Error getting document text: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/preloaded', methods=['GET'])
def get_preloaded_documents():
    """Get list of available preloaded documents"""
    try:
        preloaded_docs = []
        uploads_dir = current_app.config['UPLOAD_FOLDER']
        
        for filename in os.listdir(uploads_dir):
            if filename.endswith('_data.json'):
                data_path = os.path.join(uploads_dir, filename)
                try:
                    with open(data_path, 'r') as f:
                        doc_data = json.load(f)
                    
                    if doc_data.get('is_preloaded', False):
                        base_name = filename.replace('_data.json', '')
                        doc_id = generate_content_hash(f"{doc_data.get('filename', f'{base_name}.pdf')}_{doc_data.get('text_length', 0)}", "doc_")
                        
                        preloaded_docs.append({
                            'document_id': doc_id,
                            'filename': doc_data.get('filename', f"{base_name}.pdf"),
                            'text_length': doc_data.get('text_length', 0),
                            'sentence_count': len(doc_data.get('sentences', [])),
                            'description': get_document_description(base_name),
                            'is_preloaded': True,
                            'base_name': base_name
                        })
                except Exception as e:
                    logger.error(f"Error processing {filename}: {e}")
                    continue
        
        return jsonify({
            'success': True,
            'documents': preloaded_docs
        })
        
    except Exception as e:
        logger.error(f"Error getting preloaded documents: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/preloaded/<document_id>', methods=['POST'])
def load_preloaded_document(document_id):
    """Load a preloaded document for use"""
    try:
        # Implementation for loading preloaded document
        # This would copy from preloaded directory to active directory
        # Similar to your existing uploadPreloadedDocument logic
        
        user_session_id = get_or_create_user_session()
        log_user_study_event({
            'event_type': 'preloaded_document_loaded',
            'user_session_id': user_session_id,
            'document_id': document_id,
            'timestamp': time.time()
        })
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'message': 'Preloaded document loaded successfully'
        })
        
    except Exception as e:
        logger.error(f"Error loading preloaded document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# SESSION MANAGEMENT ENDPOINTS
# =============================================================================

@main.route('/sessions', methods=['POST'])
def create_session():
    """Create a new analysis session"""
    try:
        user_session_id = get_or_create_user_session()
        session_id = generate_content_hash(f"{user_session_id}_{time.time()}", "session_")
        
        # Create session directory
        session_dir = os.path.join(RESULT_DIR, session_id)
        os.makedirs(session_dir, exist_ok=True)
        
        # Initialize session metadata
        session_data = {
            'session_id': session_id,
            'user_session_id': user_session_id,
            'created_at': time.time(),
            'status': 'active',
            'documents': [],
            'questions': []
        }
        
        session_path = os.path.join(session_dir, 'session.json')
        with open(session_path, 'w') as f:
            json.dump(session_data, f)
        
        log_user_study_event({
            'event_type': 'session_created',
            'user_session_id': user_session_id,
            'session_id': session_id,
            'timestamp': time.time()
        })
        
        return jsonify({
            'success': True,
            'session_id': session_id
        })
        
    except Exception as e:
        logger.error(f"Error creating session: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>', methods=['GET'])
def get_session(session_id):
    """Get session information"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        if not os.path.exists(session_path):
            return jsonify({'error': 'Session not found'}), 404
        
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        return jsonify({
            'success': True,
            'session': session_data
        })
        
    except Exception as e:
        logger.error(f"Error getting session: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# TEXT PROCESSING ENDPOINTS
# =============================================================================

@main.route('/sessions/<session_id>/process-text', methods=['POST'])
def process_text_question(session_id):
    """Process a question against document text using provenance algorithm"""
    data = request.json
    question_text = data.get('question')
    document_id = data.get('document_id')
    
    if not question_text:
        return jsonify({'error': 'Question text required'}), 400
    
    if not document_id:
        return jsonify({'error': 'Document ID required'}), 400
    
    try:
        user_session_id = get_or_create_user_session()
        question_id = generate_content_hash(question_text, "q_")
        processing_session_id = generate_content_hash(f"{session_id}_{question_id}_{document_id}_{time.time()}", "proc_")
        
        # Get document data
        doc_data = find_document_data(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        # Create processing session directory
        processing_dir = os.path.join(RESULT_DIR, processing_session_id)
        os.makedirs(processing_dir, exist_ok=True)
        
        # Save sentences for later
        sentences_path = os.path.join(processing_dir, 'sentences.json')
        with open(sentences_path, 'w') as f:
            json.dump(doc_data.get('sentences', []), f)
        
        # Initialize processing logs
        logs_path = os.path.join(processing_dir, 'process_logs.json')
        logs = {
            'status': 'started',
            'logs': [f"[{time.strftime('%H:%M:%S')}] Processing started: {question_text}"],
            'timestamp': time.time(),
            'session_id': session_id,
            'question_id': question_id,
            'document_id': document_id,
            'processing_session_id': processing_session_id,
            'user_session_id': user_session_id,
            'submission_time': time.time()
        }
        with open(logs_path, 'w') as f:
            json.dump(logs, f)
        
        # Log question submission
        log_user_study_event({
            'event_type': 'text_processing_started',
            'user_session_id': user_session_id,
            'session_id': session_id,
            'question_id': question_id,
            'document_id': document_id,
            'processing_session_id': processing_session_id,
            'question_text': question_text,
            'timestamp': time.time()
        })
        
        # Start processing in background thread
        from threading import Thread
        thread = Thread(target=process_question_session, args=(processing_session_id, question_text, doc_data, question_id))
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'question_id': question_id,
            'document_id': document_id,
            'processing_session_id': processing_session_id,
            'status': 'processing'
        })
        
    except Exception as e:
        logger.error(f"Error processing text question: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/processing/<processing_session_id>/progress', methods=['GET'])
def get_text_processing_progress(session_id, processing_session_id):
    """Get progress of text processing"""
    try:
        provenance_path = os.path.join(RESULT_DIR, processing_session_id, 'provenance.json')
        logs_path = os.path.join(RESULT_DIR, processing_session_id, 'process_logs.json')
        
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
        
        if not os.path.exists(provenance_path):
            return jsonify({
                'session_id': session_id,
                'processing_session_id': processing_session_id,
                'progress': 0,
                'done': False,
                'logs': logs,
                'status': status
            })
        
        try:
            with open(provenance_path, 'r') as f:
                data = json.load(f)
            
            provenance_data = data if isinstance(data, list) else []
            done = status == 'completed' or len(provenance_data) > 0
            
            return jsonify({
                'session_id': session_id,
                'processing_session_id': processing_session_id,
                'progress': len(provenance_data),
                'done': done,
                'data': provenance_data,
                'logs': logs,
                'status': status
            })
        except json.JSONDecodeError:
            return jsonify({
                'session_id': session_id,
                'processing_session_id': processing_session_id,
                'progress': 0,
                'done': False,
                'logs': logs,
                'status': status
            })
            
    except Exception as e:
        logger.error(f"Error getting processing progress: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/processing/<processing_session_id>/results', methods=['GET'])
def get_text_processing_results(session_id, processing_session_id):
    """Get results of text processing"""
    try:
        provenance_path = os.path.join(RESULT_DIR, processing_session_id, 'provenance.json')
        if not os.path.exists(provenance_path):
            return jsonify({'error': 'Processing results not found'}), 404
        
        with open(provenance_path, 'r') as f:
            data = json.load(f)
        
        # Check if there's an answer file
        answer_path = os.path.join(RESULT_DIR, processing_session_id, 'answers.txt')
        answer = None
        if os.path.exists(answer_path):
            with open(answer_path, 'r') as f:
                answer = f.read().strip()
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'processing_session_id': processing_session_id,
            'provenance': data,
            'answer': answer
        })
        
    except Exception as e:
        logger.error(f"Error getting processing results: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/processing/<processing_session_id>/sentences', methods=['GET'])
def get_processing_sentences(session_id, processing_session_id):
    """Get sentences for a specific processing session"""
    sentence_ids = request.args.get('ids')
    if not sentence_ids:
        return jsonify({'error': 'No sentence IDs provided'}), 400
    
    try:
        sentence_ids = [int(id) for id in sentence_ids.split(',')]
    except ValueError:
        return jsonify({'error': 'Invalid sentence IDs format'}), 400
    
    try:
        sentences_path = os.path.join(RESULT_DIR, processing_session_id, 'sentences.json')
        if not os.path.exists(sentences_path):
            return jsonify({'error': 'Sentences not found'}), 404
        
        with open(sentences_path, 'r') as f:
            sentences = json.load(f)
        
        result = {}
        for id in sentence_ids:
            if 0 <= id < len(sentences):
                result[id] = sentences[id]
            else:
                result[id] = f"Sentence ID {id} out of range"
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'processing_session_id': processing_session_id,
            'sentences': result
        })
        
    except Exception as e:
        logger.error(f"Error getting processing sentences: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# QUESTION MANAGEMENT ENDPOINTS  
# =============================================================================

@main.route('/sessions/<session_id>/questions', methods=['GET'])
def get_session_questions(session_id):
    """Get all questions asked in this session"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        if not os.path.exists(session_path):
            return jsonify({'error': 'Session not found'}), 404
        
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'questions': session_data.get('questions', [])
        })
        
    except Exception as e:
        logger.error(f"Error getting session questions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/documents/<document_id>/questions', methods=['GET'])
def get_document_questions(session_id, document_id):
    """Get all questions asked about a specific document in this session"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        if not os.path.exists(session_path):
            return jsonify({'error': 'Session not found'}), 404
        
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        # Filter questions for this document
        document_questions = [
            q for q in session_data.get('questions', [])
            if q.get('document_id') == document_id
        ]
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'document_id': document_id,
            'questions': document_questions
        })
        
    except Exception as e:
        logger.error(f"Error getting document questions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/documents/<document_id>/questions/<question_id>', methods=['GET'])
def get_specific_question(session_id, document_id, question_id):
    """Get a specific question and its results"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        if not os.path.exists(session_path):
            return jsonify({'error': 'Session not found'}), 404
        
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        # Find the specific question
        question = None
        for q in session_data.get('questions', []):
            if q.get('question_id') == question_id and q.get('document_id') == document_id:
                question = q
                break
        
        if not question:
            return jsonify({'error': 'Question not found'}), 404
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'document_id': document_id,
            'question': question
        })
        
    except Exception as e:
        logger.error(f"Error getting specific question: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# FEEDBACK ENDPOINTS
# =============================================================================

@main.route('/feedback', methods=['POST'])
def submit_feedback():
    """Submit user feedback for study analysis"""
    try:
        data = request.json
        user_session_id = get_or_create_user_session()
        
        feedback_data = {
            'event_type': 'user_feedback',
            'user_session_id': user_session_id,
            'session_id': data.get('session_id'),
            'question_id': data.get('question_id'),
            'document_id': data.get('document_id'),
            'processing_session_id': data.get('processing_session_id'),
            'feedback': data.get('feedback'),
            'timestamp': time.time(),
            
            # Additional context
            'question_text': data.get('question_text'),
            'document_filename': data.get('document_filename'),
            'provenance_count': data.get('provenance_count', 0),
            'processing_time': data.get('processing_time', 0)
        }
        
        # Log feedback
        log_user_study_event(feedback_data)
        
        # Save detailed feedback for this specific processing session
        if data.get('processing_session_id'):
            feedback_file = os.path.join(STUDY_LOGS_DIR, f'feedback_{data.get("processing_session_id")}.json')
            with open(feedback_file, 'w') as f:
                json.dump(feedback_data, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Feedback submitted successfully'
        })
        
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# UTILITY FUNCTIONS (CONTINUED)
# =============================================================================

def find_document_data(document_id):
    """Find document data by ID"""
    doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
    if os.path.exists(doc_data_path):
        try:
            with open(doc_data_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error reading document data: {e}")
    return None

def process_question_session(processing_session_id, question_text, doc_data, question_id):
    """Process a single question-document session with comprehensive logging"""
    start_time = time.time()
    
    try:
        update_process_log(processing_session_id, f"Analyzing document with {doc_data.get('text_length', 0)} characters...")
        
        # Extract text from PDF
        filepath = doc_data.get('filepath')
        if not filepath or not os.path.exists(filepath):
            update_process_log(processing_session_id, "Error: PDF file not found", status="error")
            return
        
        pdf_text = extract_text(filepath)
        result_path = os.path.join(RESULT_DIR, processing_session_id)
        
        # Capture stdout to preserve the exact output format
        stdout_buffer = StringIO()
        stdout_backup = sys.stdout
        sys.stdout = stdout_buffer
        
        algorithm_start_time = time.time()
        
        try:
            # Process the question using doc_provenance API
            doc_provenance.divide_and_conquer_progressive_API(question_text, pdf_text, result_path)
            
            algorithm_end_time = time.time()
            algorithm_processing_time = algorithm_end_time - algorithm_start_time
            
            # Get the captured output
            output = stdout_buffer.getvalue()
            
            # Extract provenance information from the output
            provenance_entries = []
            current_entry = None
            total_input_tokens = 0
            total_output_tokens = 0
            
            for line in output.strip().split('\n'):
                if line.strip():
                    update_process_log(processing_session_id, line.strip())
                    
                    # Parse Top-X provenance lines
                    if line.startswith('Top-'):
                        if current_entry is not None:
                            provenance_entries.append(current_entry)
                        
                        # Extract provenance ID and sentence IDs
                        try:
                            parts = line.split('provenance:')
                            if len(parts) >= 2:
                                id_part = parts[0].strip()
                                prov_id = int(id_part.split('-')[1].split()[0])
                                
                                # Extract sentence IDs from square brackets
                                ids_str = parts[1].strip()
                                ids_str = ids_str.strip('[]')
                                prov_ids = [int(id_str.strip()) for id_str in ids_str.split(',') if id_str.strip()]
                                
                                current_entry = {
                                    "provenance_id": prov_id,
                                    "sentences_ids": prov_ids,
                                    "time": 0,
                                    "input_token_size": 0,
                                    "output_token_size": 0
                                }
                        except Exception as e:
                            logger.error(f"Error parsing provenance line '{line}': {str(e)}")
                            pass
                    
                    # Parse time and token information
                    elif line.startswith('Time:') and current_entry is not None:
                        try:
                            current_entry["time"] = float(line.split(':')[1].strip())
                        except:
                            pass
                    
                    elif line.startswith('Input tokens:') and current_entry is not None:
                        try:
                            tokens = int(line.split(':')[1].strip())
                            current_entry["input_token_size"] = tokens
                            total_input_tokens += tokens
                        except:
                            pass
                    
                    elif line.startswith('Output tokens:') and current_entry is not None:
                        try:
                            tokens = int(line.split(':')[1].strip())
                            current_entry["output_token_size"] = tokens
                            total_output_tokens += tokens
                        except:
                            pass
            
            # Add the last entry if it exists
            if current_entry is not None:
                provenance_entries.append(current_entry)
            
            # Write the processed provenance entries
            provenance_path = os.path.join(result_path, 'provenance.json')
            with open(provenance_path, 'w') as f:
                json.dump(provenance_entries, f, indent=2)
                
            # Create a status file to indicate completion
            status_path = os.path.join(result_path, 'status.json')
            with open(status_path, 'w') as f:
                json.dump({
                    "completed": True,
                    "timestamp": time.time(),
                    "total_provenance": len(provenance_entries),
                    "processing_session_id": processing_session_id,
                    "total_processing_time": time.time() - start_time,
                    "algorithm_processing_time": algorithm_processing_time
                }, f)
            
            update_process_log(processing_session_id, "Text processing completed!", status="completed")
            
        finally:
            sys.stdout = stdout_backup
            
    except Exception as e:
        logger.exception("Error in text processing session")
        update_process_log(processing_session_id, f"Error: {str(e)}", status="error")

def update_process_log(processing_session_id, message, status=None):
    """Add a new message to the process logs"""
    logs_path = os.path.join(RESULT_DIR, processing_session_id, 'process_logs.json')
    try:
        with open(logs_path, 'r') as f:
            logs = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
    
    # Format log entry
    if message.startswith('Top-') or message.startswith('Labeler') or message.startswith('Provenance:') or 'tokens:' in message or 'Time:' in message:
        log_entry = message
    else:
        log_entry = f"[{time.strftime('%H:%M:%S')}] {message}"
        
    logs['logs'].append(log_entry)
    
    if status:
        logs['status'] = status
    
    logs['timestamp'] = time.time()
    
    with open(logs_path, 'w') as f:
        json.dump(logs, f)
    
    logger.info(f"Processing session {processing_session_id}: {message}")

def get_document_description(base_name):
    """Get a description for the document based on its name"""
    descriptions = {
        'whatgoesaround-sigmodrec2024': 'Database evolution research paper examining 20 years of data model developments',
        # Add more descriptions as needed
    }
    return descriptions.get(base_name, 'Academic research document for analysis')


# =============================================================================
# LEGACY HANDLERS
# =============================================================================
# Add this compatibility route to routes.py to handle the old frontend calls:

@main.route('/upload', methods=['POST'])
def upload_file_legacy():
    """Legacy upload endpoint for backward compatibility"""
    return upload_document()

@main.route('/ask', methods=['POST'])
def ask_question_legacy():
    """Legacy question endpoint for backward compatibility"""
    data = request.json
    question_text = data.get('question')
    document_ids = data.get('documentIds', [])
    
    if not question_text:
        return jsonify({'error': 'Question text required'}), 400
    
    if not document_ids:
        return jsonify({'error': 'Document IDs required'}), 400
    
    try:
        # Create a session
        user_session_id = get_or_create_user_session()
        session_id = generate_content_hash(f"{user_session_id}_{time.time()}", "session_")
        
        # Use first document ID
        document_id = document_ids[0] if isinstance(document_ids, list) else document_ids
        
        # Process the question
        question_id = generate_content_hash(question_text, "q_")
        processing_session_id = generate_content_hash(f"{session_id}_{question_id}_{document_id}_{time.time()}", "proc_")
        
        # Get document data
        doc_data = find_document_data(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        # Create processing session directory
        processing_dir = os.path.join(RESULT_DIR, processing_session_id)
        os.makedirs(processing_dir, exist_ok=True)
        
        # Save sentences for later
        sentences_path = os.path.join(processing_dir, 'sentences.json')
        with open(sentences_path, 'w') as f:
            json.dump(doc_data.get('sentences', []), f)
        
        # Start processing in background
        from threading import Thread
        thread = Thread(target=process_question_session, args=(processing_session_id, question_text, doc_data, question_id))
        thread.daemon = True
        thread.start()
        
        # Return legacy format
        return jsonify({
            'success': True,
            'questionId': question_id,
            'sessions': [{'sessionId': processing_session_id}]
        })
        
    except Exception as e:
        logger.error(f"Error in legacy ask endpoint: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500