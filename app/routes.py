import doc_provenance, hashlib, json, logging, os, random, shutil, sys, time, uuid
from datetime import datetime
from io import StringIO
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, session, send_file
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text
from doc_provenance.base_strategies import extract_sentences_from_pdf

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
# SESSION-BASED DATA ORGANIZATION
# =============================================================================

def get_session_data_dir(session_id):
    """Get the base directory for a session's data"""
    return os.path.join(RESULT_DIR, 'sessions', session_id)

def get_session_documents_dir(session_id):
    """Get the documents directory for a session"""
    return os.path.join(get_session_data_dir(session_id), 'documents')

def get_session_questions_dir(session_id):
    """Get the questions directory for a session"""
    return os.path.join(get_session_data_dir(session_id), 'questions')

def ensure_session_dirs(session_id):
    """Ensure session directories exist"""
    session_dir = get_session_data_dir(session_id)
    docs_dir = get_session_documents_dir(session_id)
    questions_dir = get_session_questions_dir(session_id)
    
    for directory in [session_dir, docs_dir, questions_dir]:
        os.makedirs(directory, exist_ok=True)
    
    return session_dir, docs_dir, questions_dir

def get_current_session_id():
    """Get or create current session ID"""
    from flask import session
    if 'current_session_id' not in session:
        session['current_session_id'] = f"session_{int(time.time())}"
    return session['current_session_id']

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

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

def get_all_available_pdfs():
    """Scan both upload and preload folders and return all PDFs with unified metadata"""
    all_documents = []
    
    # Check uploads folder
    uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
    if os.path.exists(uploads_dir):
        all_documents.extend(scan_folder_for_pdfs(uploads_dir, is_preloaded=False))
    
    # Check preloaded folder  
    preload_dir = current_app.config.get('PRELOAD_FOLDER', 'app/preloaded')
    if os.path.exists(preload_dir):
        all_documents.extend(scan_folder_for_pdfs(preload_dir, is_preloaded=True))
    
    return all_documents

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
                
                base_name = pdf_file.replace('.pdf', '')
                metadata_file = os.path.join(folder_path, f"{base_name}_metadata.json")
                sentences_file = os.path.join(folder_path, f"{base_name}_sentences.json")
                
                # Generate consistent document ID
                file_stat = os.stat(filepath)
                doc_id = generate_content_hash(f"{pdf_file}_{file_stat.st_size}_{file_stat.st_mtime}", 
                                             "preloaded_" if is_preloaded else "uploaded_")
                
                # Check if we already have processed this file
                if os.path.exists(metadata_file) and os.path.exists(sentences_file):
                    try:
                        with open(metadata_file, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Update document ID and source info
                        metadata['document_id'] = doc_id
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
                    sentences = extract_sentences_from_pdf(pdf_text)

                    metadata = {
                        'document_id': doc_id,
                        'filename': pdf_file,
                        'filepath': filepath,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences),
                        'is_preloaded': is_preloaded,
                        'source_folder': 'preloaded' if is_preloaded else 'uploads',
                        'processed_at': time.time(),
                        'file_size': file_stat.st_size,
                        'last_modified': file_stat.st_mtime,
                        'base_name': base_name
                    }
                    
                    # Save metadata
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
                    # Save sentences
                    with open(sentences_file, 'w', encoding='utf-8') as f:
                        json.dump(sentences, f, indent=2, ensure_ascii=False)

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

def find_document_by_id(document_id):
    """Unified document lookup - works for both uploaded and preloaded"""
    all_docs = get_all_available_pdfs()
    
    for doc in all_docs:
        if doc.get('document_id') == document_id:
            # Load sentences if needed
            base_name = doc.get('base_name', doc['filename'].replace('.pdf', ''))
            folder_path = os.path.dirname(doc['filepath'])
            sentences_file = os.path.join(folder_path, f"{base_name}_sentences.json")
            
            if os.path.exists(sentences_file):
                try:
                    with open(sentences_file, 'r', encoding='utf-8') as f:
                        sentences = json.load(f)
                    doc['sentences'] = sentences
                except Exception as e:
                    print(f"Error loading sentences for {document_id}: {e}")
                    doc['sentences'] = []
            
            return doc
    
    return None

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/upload', methods=['POST'])
def upload_file():
    """Unified file upload - handles both new uploads and makes them available immediately"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not (file and allowed_file(file.filename)):
        return jsonify({'error': 'File type not allowed'}), 400
    
    try:
        filename = secure_filename(file.filename)
        uploads_dir = current_app.config['UPLOAD_FOLDER']
        filepath = os.path.join(uploads_dir, filename)
        
        # Save file
        file.save(filepath)
        
        # Process immediately using unified logic
        documents = scan_folder_for_pdfs(uploads_dir, is_preloaded=False)
        
        # Find the document we just uploaded
        uploaded_doc = None
        for doc in documents:
            if doc['filename'] == filename:
                uploaded_doc = doc
                break
        
        if not uploaded_doc:
            return jsonify({'error': 'Failed to process uploaded file'}), 500
        
        # Also save in the old format for compatibility with /ask endpoint
        pdf_data_path = os.path.join(RESULT_DIR, f"{filename.split('.')[0]}_data.json")
        with open(pdf_data_path, 'w') as f:
            json.dump({
                'document_id': uploaded_doc['document_id'],
                'filename': filename,
                'filepath': filepath,
                'text_length': uploaded_doc['text_length'],
                'sentences': uploaded_doc.get('sentences', [])
            }, f)
        
        return jsonify({
            'success': True,
            'document_id': uploaded_doc['document_id'],
            'filename': uploaded_doc['filename'],
            'text_length': uploaded_doc['text_length'],
            'sentence_count': uploaded_doc['sentence_count'],
            'message': 'File uploaded and processed successfully'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
        

@main.route('/documents/available', methods=['GET'])
def get_available_documents():
    """Get all available documents from both upload and preload folders"""
    try:
        all_documents = get_all_available_pdfs()
        
        # Separate for UI purposes but same underlying logic
        uploaded_docs = [doc for doc in all_documents if not doc.get('is_preloaded', False)]
        preloaded_docs = [doc for doc in all_documents if doc.get('is_preloaded', False)]
        
        return jsonify({
            'success': True,
            'uploaded_documents': uploaded_docs,
            'preloaded_documents': preloaded_docs,
            'total_documents': len(all_documents)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/preloaded', methods=['GET'])
def get_preloaded_documents():
    """Get preloaded documents - for UI compatibility"""
    try:
        all_documents = get_all_available_pdfs()
        preloaded_docs = [doc for doc in all_documents if doc.get('is_preloaded', False)]
        
        return jsonify({
            'success': True,
            'documents': preloaded_docs
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/load', methods=['POST'])
def load_document(document_id):
    """Unified document loading - works for both uploaded and preloaded"""
    try:
        doc = find_document_by_id(document_id)
        
        if not doc:
            return jsonify({
                'success': False,
                'error': f'Document {document_id} not found'
            }), 404
        
        # Verify file exists
        if not os.path.exists(doc['filepath']):
            return jsonify({
                'success': False,
                'error': f'PDF file not found: {doc["filename"]}'
            }), 404
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'filename': doc['filename'],
            'text_length': doc.get('text_length', 0),
            'sentence_count': doc.get('sentence_count', 0),
            'is_preloaded': doc.get('is_preloaded', False),
            'source_folder': doc.get('source_folder', 'unknown'),
            'message': f'Document {doc["filename"]} loaded successfully'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/text', methods=['GET'])
def get_document_text(document_id):
    """Unified document text retrieval"""
    try:
        doc = find_document_by_id(document_id)
        
        if not doc:
            return jsonify({'error': 'Document not found'}), 404
        
        # Extract text from PDF
        filepath = doc['filepath']
        if not os.path.exists(filepath):
            return jsonify({'error': 'PDF file not found'}), 404
        
        pdf_text = extract_text(filepath)
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'text': pdf_text,
            'filename': doc['filename'],
            'source': doc.get('source_folder', 'unknown')
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/sentences', methods=['GET'])
def get_document_sentences(document_id):
    """Unified sentence retrieval"""
    try:
        doc = find_document_by_id(document_id)
        
        if not doc:
            return jsonify({'error': 'Document not found'}), 404
        
        sentences = doc.get('sentences', [])
        
        # Handle range parameters
        start_idx = request.args.get('start', type=int)
        end_idx = request.args.get('end', type=int)
        
        if start_idx is not None or end_idx is not None:
            start_idx = start_idx or 0
            end_idx = end_idx or len(sentences)
            sentences_slice = sentences[start_idx:end_idx]
            
            return jsonify({
                'success': True,
                'document_id': document_id,
                'sentences': sentences_slice,
                'total_sentences': len(sentences),
                'start_index': start_idx,
                'end_index': min(end_idx, len(sentences)),
                'filename': doc.get('filename', 'Unknown')
            })
        else:
            return jsonify({
                'success': True,
                'document_id': document_id,
                'sentences': sentences,
                'total_sentences': len(sentences),
                'filename': doc.get('filename', 'Unknown')
            })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/documents/<document_id>/pdf', methods=['GET'])
def serve_document_pdf(document_id):
    """Unified PDF serving - works for any document with direct file response"""
    try:
        logger.info(f"🔄 Serving PDF for document: {document_id}")
        
        # Find document using the unified lookup
        doc = find_document_by_id(document_id)
        
        if not doc:
            logger.error(f"❌ Document {document_id} not found")
            return jsonify({'error': 'Document not found'}), 404
        
        filepath = doc.get('filepath')
        filename = doc.get('filename')
        
        logger.info(f"📄 Document info - filepath: {filepath}, filename: {filename}")
        
        if not filename:
            logger.error(f"❌ No filename found for document {document_id}")
            return jsonify({'error': 'PDF filename not found'}), 404
        
        # For Windows compatibility, try multiple path strategies
        working_path = None
        
        # Strategy 1: Use the stored filepath if it exists
        if filepath:
            # Normalize the filepath for Windows
            normalized_filepath = os.path.normpath(filepath)
            logger.info(f"📍 Trying stored filepath: {normalized_filepath}")
            
            if os.path.exists(normalized_filepath):
                working_path = normalized_filepath
                logger.info(f"✅ Using stored filepath: {working_path}")
            else:
                # Try making it absolute from current working directory
                if not os.path.isabs(normalized_filepath):
                    abs_path = os.path.join(os.getcwd(), normalized_filepath)
                    logger.info(f"📍 Trying absolute path: {abs_path}")
                    if os.path.exists(abs_path):
                        working_path = abs_path
                        logger.info(f"✅ Using absolute path: {working_path}")
        
        # Strategy 2: Build path from known directories
        if not working_path:
            if doc.get('is_preloaded'):
                # Try preloaded directory
                preload_path = os.path.join(PRELOAD_DIR, filename)
                logger.info(f"📍 Trying preload path: {preload_path}")
                if os.path.exists(preload_path):
                    working_path = preload_path
                    logger.info(f"✅ Using preload path: {working_path}")
            else:
                # Try uploads directory
                uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
                uploads_path = os.path.join(uploads_dir, filename)
                logger.info(f"📍 Trying uploads path: {uploads_path}")
                if os.path.exists(uploads_path):
                    working_path = uploads_path
                    logger.info(f"✅ Using uploads path: {working_path}")
        
        if not working_path:
            error_msg = f"PDF file not found for document {document_id} (filename: {filename})"
            logger.error(f"❌ {error_msg}")
            return jsonify({'error': error_msg}), 404
        
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
        logger.error(f"❌ PDF serving error for document {document_id}: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({'error': f'PDF serving error: {str(e)}'}), 500

# Updated find_document_data function (already provided earlier)
def find_document_data(document_id):
    """Find document data by ID from uploads folder"""
    uploads_dir = current_app.config['UPLOAD_FOLDER']
    
    # Look for metadata files in uploads directory
    if os.path.exists(uploads_dir):
        for item in os.listdir(uploads_dir):
            if item.endswith('_metadata.json'):
                try:
                    metadata_path = os.path.join(uploads_dir, item)
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                    
                    if metadata.get('document_id') == document_id:
                        # Load sentences
                        base_name = item.replace('_metadata.json', '')
                        sentences_path = os.path.join(uploads_dir, f"{base_name}_sentences.json")
                        
                        if os.path.exists(sentences_path):
                            with open(sentences_path, 'r', encoding='utf-8') as f:
                                sentences = json.load(f)
                            metadata['sentences'] = sentences
                        else:
                            #logger.warning(f"Sentences file missing for {base_name}")
                            metadata['sentences'] = []
                        
                        #logger.info(f"✅ Found document: {base_name}")
                        return metadata
                except Exception as e:
                    print(f"Error reading metadata {item}: {e}")
    
    # Fallback to old results storage for backward compatibility
    old_doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
    if os.path.exists(old_doc_data_path):
        try:
            with open(old_doc_data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                #logger.info(f"✅ Found document data in legacy results storage")
                return data
        except Exception as e:
            print(f"❌ Error reading legacy document data: {e}")
    
    print(f"❌ Document {document_id} not found anywhere")
    return None


# =============================================================================
# DOCUMENT MANAGEMENT ENDPOINTS
# =============================================================================



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

@main.route('/debug/pdf/<document_id>', methods=['GET'])
def debug_pdf_serving(document_id):
    """Debug PDF serving for a specific document"""
    try:
        logger.info(f"🔍 DEBUG: PDF serving for document: {document_id}")
        
        # Step 1: Find the document
        doc = find_document_by_id(document_id)
        
        debug_info = {
            'document_id': document_id,
            'document_found': doc is not None,
            'current_working_dir': os.getcwd(),
            'preload_dir': PRELOAD_DIR,
            'preload_dir_exists': os.path.exists(PRELOAD_DIR)
        }
        
        if doc:
            debug_info['document_info'] = {
                'filename': doc.get('filename'),
                'filepath': doc.get('filepath'),
                'is_preloaded': doc.get('is_preloaded'),
                'source_folder': doc.get('source_folder'),
                'base_name': doc.get('base_name')
            }
            
            filepath = doc.get('filepath')
            filename = doc.get('filename')
            
            # Test all possible paths
            possible_paths = []
            
            if filepath:
                # Original path
                possible_paths.append({
                    'description': 'Original filepath',
                    'path': filepath,
                    'exists': os.path.exists(filepath)
                })
                
                # Normalized path
                normalized = os.path.normpath(filepath)
                possible_paths.append({
                    'description': 'Normalized filepath',
                    'path': normalized,
                    'exists': os.path.exists(normalized)
                })
                
                # Absolute path from cwd
                if not os.path.isabs(filepath):
                    abs_path = os.path.join(os.getcwd(), filepath)
                    possible_paths.append({
                        'description': 'Absolute from CWD',
                        'path': abs_path,
                        'exists': os.path.exists(abs_path)
                    })
            
            if filename:
                # Preloaded folder + filename
                preload_path = os.path.join(PRELOAD_DIR, filename)
                possible_paths.append({
                    'description': 'Preloaded folder + filename',
                    'path': preload_path,
                    'exists': os.path.exists(preload_path)
                })
                
                # Uploads folder + filename
                uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
                uploads_path = os.path.join(uploads_dir, filename)
                possible_paths.append({
                    'description': 'Uploads folder + filename',
                    'path': uploads_path,
                    'exists': os.path.exists(uploads_path)
                })
            
            debug_info['possible_paths'] = possible_paths
            debug_info['working_paths'] = [p for p in possible_paths if p['exists']]
            
            # Check preloaded directory contents
            if os.path.exists(PRELOAD_DIR):
                debug_info['preload_dir_contents'] = {
                    'all_files': os.listdir(PRELOAD_DIR),
                    'pdf_files': [f for f in os.listdir(PRELOAD_DIR) if f.lower().endswith('.pdf')]
                }
        
        return jsonify(debug_info)
        
    except Exception as e:
        logger.error(f"Debug PDF error: {e}")
        return jsonify({
            'error': str(e),
            'document_id': document_id
        }), 500
    
@main.route('/test/pdf/<document_id>', methods=['GET'])
def test_pdf_serving(document_id):
    """Test endpoint to verify PDF serving without actually serving the file"""
    try:
        logger.info(f"🧪 TESTING PDF serving for document: {document_id}")
        
        # Find document
        doc = find_document_by_id(document_id)
        
        if not doc:
            return jsonify({'success': False, 'error': 'Document not found'}), 404
        
        filepath = doc.get('filepath')
        filename = doc.get('filename')
        
        # Try the same logic as the real endpoint
        working_path = None
        attempted_paths = []
        
        # Strategy 1: Use stored filepath
        if filepath:
            normalized_filepath = os.path.normpath(filepath)
            attempted_paths.append({
                'strategy': 'stored_filepath_normalized',
                'path': normalized_filepath,
                'exists': os.path.exists(normalized_filepath)
            })
            
            if os.path.exists(normalized_filepath):
                working_path = normalized_filepath
            else:
                # Try absolute path
                if not os.path.isabs(normalized_filepath):
                    abs_path = os.path.join(os.getcwd(), normalized_filepath)
                    attempted_paths.append({
                        'strategy': 'stored_filepath_absolute',
                        'path': abs_path,
                        'exists': os.path.exists(abs_path)
                    })
                    if os.path.exists(abs_path):
                        working_path = abs_path
        
        # Strategy 2: Build from known directories
        if not working_path:
            if doc.get('is_preloaded'):
                preload_path = os.path.join(PRELOAD_DIR, filename)
                attempted_paths.append({
                    'strategy': 'preload_directory',
                    'path': preload_path,
                    'exists': os.path.exists(preload_path)
                })
                if os.path.exists(preload_path):
                    working_path = preload_path
            else:
                uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
                uploads_path = os.path.join(uploads_dir, filename)
                attempted_paths.append({
                    'strategy': 'uploads_directory',
                    'path': uploads_path,
                    'exists': os.path.exists(uploads_path)
                })
                if os.path.exists(uploads_path):
                    working_path = uploads_path
        
        if working_path:
            # Test send_from_directory setup
            directory = os.path.dirname(working_path)
            file_basename = os.path.basename(working_path)
            full_path = os.path.join(directory, file_basename)
            
            return jsonify({
                'success': True,
                'document_id': document_id,
                'filename': filename,
                'working_path': working_path,
                'directory': directory,
                'file_basename': file_basename,
                'full_path': full_path,
                'file_exists': os.path.exists(full_path),
                'attempted_paths': attempted_paths,
                'ready_to_serve': os.path.exists(full_path)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No working path found',
                'document_id': document_id,
                'filename': filename,
                'attempted_paths': attempted_paths
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'document_id': document_id
        }), 500

# Add a utility route for debugging
@main.route('/debug/upload-folder', methods=['GET'])
def debug_upload_folder():
    """Debug endpoint to see what's in the upload folder"""
    try:
        uploads_dir = current_app.config['UPLOAD_FOLDER']
        
        files = []
        for item in os.listdir(uploads_dir):
            item_path = os.path.join(uploads_dir, item)
            if os.path.isfile(item_path):
                stat = os.stat(item_path)
                files.append({
                    'name': item,
                    'size': stat.st_size,
                    'modified': stat.st_mtime,
                    'is_pdf': item.lower().endswith('.pdf')
                })
        
        return jsonify({
            'upload_folder': uploads_dir,
            'exists': os.path.exists(uploads_dir),
            'files': files,
            'total_files': len(files),
            'pdf_files': len([f for f in files if f['is_pdf']])
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'upload_folder': current_app.config.get('UPLOAD_FOLDER', 'Not configured')
        }), 500
    
@main.route('/debug/preloaded-docs', methods=['GET'])
def debug_preloaded_docs():
    """Debug endpoint to check preloaded document processing"""
    try:
        preload_dir = current_app.config.get('PRELOAD_FOLDER', 'app/preloaded')
        
        debug_info = {
            'preload_dir': preload_dir,
            'preload_dir_exists': os.path.exists(preload_dir),
            'current_working_dir': os.getcwd(),
            'files_in_preload': [],
            'processed_documents': []
        }
        
        if os.path.exists(preload_dir):
            try:
                all_files = os.listdir(preload_dir)
                debug_info['files_in_preload'] = all_files
                pdf_files = [f for f in all_files if f.lower().endswith('.pdf')]
                debug_info['pdf_count'] = len(pdf_files)
                
                # Try processing
                processed_docs = scan_folder_for_pdfs(preload_dir, is_preloaded=True)
                debug_info['processed_documents'] = [
                    {k: v for k, v in doc.items() if k != 'sentences'}
                    for doc in processed_docs
                ]
                debug_info['processed_count'] = len(processed_docs)
                
            except Exception as e:
                debug_info['error'] = str(e)
        
        return jsonify(debug_info)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@main.route('/debug/document/<document_id>', methods=['GET'])
def debug_document_by_id(document_id):
    """Debug a specific document by ID"""
    try:
        doc = find_document_by_id(document_id)
        
        if not doc:
            return jsonify({
                'error': 'Document not found',
                'document_id': document_id,
                'available_docs': [d.get('document_id') for d in get_all_available_pdfs()]
            }), 404
        
        # Remove sentences for debugging (too much data)
        debug_doc = {k: v for k, v in doc.items() if k != 'sentences'}
        debug_doc['sentences_count'] = len(doc.get('sentences', []))
        debug_doc['file_exists'] = os.path.exists(doc.get('filepath', ''))
        
        return jsonify({
            'success': True,
            'document': debug_doc
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
# Add this debug route to routes.py to test PDF serving

@main.route('/debug/pdf-test/<document_id>', methods=['GET'])
def debug_pdf_test(document_id):
    """Debug route to test PDF file resolution without actually serving the file"""
    try:
        #logger.info(f"🔍 PDF Debug Test for document: {document_id}")
        
        # Find document data
        doc_data = find_document_data(document_id)
        
        if not doc_data:
            return jsonify({
                'error': 'Document not found',
                'document_id': document_id
            }), 404
        
        filepath = doc_data.get('filepath')
        filename = doc_data.get('filename')
        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        
        # Test all possible paths
        possible_paths = []
        
        # Strategy 1: Use the filepath as-is but normalize it
        if filepath:
            normalized_path = os.path.normpath(filepath)
            possible_paths.append({
                'strategy': 'Original path normalized',
                'path': normalized_path,
                'exists': os.path.exists(normalized_path),
                'readable': False
            })
        
        # Strategy 2: Combine upload folder with filename
        direct_path = os.path.join(upload_folder, filename)
        possible_paths.append({
            'strategy': 'Upload folder + filename',
            'path': direct_path,
            'exists': os.path.exists(direct_path),
            'readable': False
        })
        
        # Strategy 3: Handle relative paths
        if filepath and not os.path.isabs(filepath):
            absolute_path = os.path.join(os.getcwd(), filepath)
            possible_paths.append({
                'strategy': 'Absolute from cwd',
                'path': absolute_path,
                'exists': os.path.exists(absolute_path),
                'readable': False
            })
        
        # Strategy 4: Try just the filename in current directory
        current_dir_path = os.path.join(os.getcwd(), filename)
        possible_paths.append({
            'strategy': 'Current directory + filename',
            'path': current_dir_path,
            'exists': os.path.exists(current_dir_path),
            'readable': False
        })
        
        # Strategy 5: Handle app/uploads prefix specifically
        if filepath and 'app/uploads' in str(filepath):
            clean_path = str(filepath).replace('app/', '')
            clean_absolute = os.path.join(os.getcwd(), clean_path)
            possible_paths.append({
                'strategy': 'Cleaned app/ prefix',
                'path': clean_absolute,
                'exists': os.path.exists(clean_absolute),
                'readable': False
            })
        
        # Test readability for existing files
        for path_info in possible_paths:
            if path_info['exists']:
                try:
                    with open(path_info['path'], 'rb') as f:
                        f.read(1024)  # Try to read first 1KB
                    path_info['readable'] = True
                except:
                    path_info['readable'] = False
        
        # Find working path
        working_paths = [p for p in possible_paths if p['exists'] and p['readable']]
        
        # Get directory contents
        directory_contents = {}
        try:
            if os.path.exists(upload_folder):
                directory_contents['upload_folder'] = {
                    'path': upload_folder,
                    'exists': True,
                    'contents': os.listdir(upload_folder)
                }
            else:
                directory_contents['upload_folder'] = {
                    'path': upload_folder,
                    'exists': False,
                    'contents': []
                }
        except Exception as e:
            directory_contents['upload_folder'] = {
                'path': upload_folder,
                'error': str(e)
            }
        
        # Check current working directory
        cwd = os.getcwd()
        try:
            directory_contents['current_working_dir'] = {
                'path': cwd,
                'exists': True,
                'contents': [f for f in os.listdir(cwd) if f.endswith('.pdf')][:10]  # Limit to 10 PDFs
            }
        except Exception as e:
            directory_contents['current_working_dir'] = {
                'path': cwd,
                'error': str(e)
            }
        
        return jsonify({
            'document_id': document_id,
            'document_data': {
                'filename': filename,
                'filepath': filepath,
                'upload_folder': upload_folder
            },
            'path_resolution_strategies': possible_paths,
            'working_paths': working_paths,
            'directory_contents': directory_contents,
            'recommendation': 'Use the first working path' if working_paths else 'No working paths found - check file location',
            'current_working_directory': cwd
        })
        
    except Exception as e:
        #logger.error(f"Error in PDF debug test: {e}")
        return jsonify({
            'error': str(e),
            'document_id': document_id
        }), 500

@main.route('/debug/preloaded-scan', methods=['GET'])
def debug_preloaded_scan():
    """Debug endpoint to check preloaded document scanning"""
    try:
        debug_info = {
            'upload_folder': current_app.config.get('UPLOAD_FOLDER'),
            'upload_folder_exists': False,
            'pdf_files': [],
            'scan_results': []
        }
        
        upload_folder = current_app.config.get('UPLOAD_FOLDER')
        if upload_folder and os.path.exists(upload_folder):
            debug_info['upload_folder_exists'] = True
            
            # List PDF files
            try:
                all_files = os.listdir(upload_folder)
                pdf_files = [f for f in all_files if f.lower().endswith('.pdf')]
                debug_info['pdf_files'] = pdf_files
                debug_info['all_files'] = all_files
            except Exception as e:
                debug_info['list_files_error'] = str(e)
            
            # Try scanning
            try:
                scan_results = scan_upload_folder_for_pdfs()
                debug_info['scan_results'] = [
                    {k: v for k, v in doc.items() if k != 'sentences'}
                    for doc in scan_results
                ]
                debug_info['scan_count'] = len(scan_results)
            except Exception as e:
                debug_info['scan_error'] = str(e)
        
        return jsonify(debug_info)
        
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500




# Also add a route to serve files from uploads directory
@main.route('/uploads/<filename>')
def serve_uploaded_file(filename):
    """Serve files from the uploads directory"""
    try:
        uploads_dir = current_app.config['UPLOAD_FOLDER']
        return send_from_directory(uploads_dir, filename)
    except Exception as e:
        #logger.error(f"Error serving uploaded file {filename}: {e}")
        return jsonify({'error': 'File not found'}), 404
    

@main.route('/documents/<document_id>', methods=['GET'])
def get_document(document_id):
    """Get document metadata"""
    try:
        doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
        
        if not os.path.exists(doc_data_path):
            return jsonify({'error': 'Document not found'}), 404
        
        with open(doc_data_path, 'r', encoding='utf-8') as f:
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
        #logger.error(f"Error getting document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# UPDATED DOCUMENT PROCESSING WITH SESSION ORGANIZATION
# =============================================================================

@main.route('/sessions/current', methods=['GET', 'POST'])
def manage_current_session():
    """Get current session or create new one"""
    if request.method == 'POST':
        # Create new session
        new_session_id = f"session_{int(time.time())}"
        from flask import session
        session['current_session_id'] = new_session_id
        
        # Create session directories
        ensure_session_dirs(new_session_id)
        
        # Log session creation
        session_metadata = {
            'session_id': new_session_id,
            'created_at': time.time(),
            'created_at_iso': datetime.utcnow().isoformat(),
            'documents_processed': 0,
            'questions_asked': 0,
            'status': 'active'
        }
        
        metadata_path = os.path.join(get_session_data_dir(new_session_id), 'session_metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(session_metadata, f, indent=2)
        
        return jsonify({
            'success': True,
            'session_id': new_session_id,
            'message': 'New session created'
        })
    else:
        # Get current session
        current_session = get_current_session_id()
        ensure_session_dirs(current_session)
        
        return jsonify({
            'success': True,
            'session_id': current_session
        })

@main.route('/documents/<document_id>/process', methods=['POST'])
def process_document_for_session(document_id):
    """Process a document for the current session (extract text, sentences, etc.)"""
    try:
        current_session = get_current_session_id()
        session_dir, docs_dir, questions_dir = ensure_session_dirs(current_session)
        
        # Find the source document
        doc = find_document_by_id(document_id)
        if not doc:
            return jsonify({'error': 'Document not found'}), 404
        
        # Check if already processed for this session
        doc_session_dir = os.path.join(docs_dir, document_id)
        processed_file = os.path.join(doc_session_dir, 'processed_data.json')
        
        if os.path.exists(processed_file):
            # Return existing processed data
            with open(processed_file, 'r', encoding='utf-8') as f:
                processed_data = json.load(f)
            return jsonify({
                'success': True,
                'already_processed': True,
                **processed_data
            })
        
        # Process document for this session
        os.makedirs(doc_session_dir, exist_ok=True)
        
        # Extract text and sentences (use existing if available)
        sentences = doc.get('sentences', [])
        if not sentences:
            # Extract if not available
            filepath = doc['filepath']
            pdf_text = extract_text(filepath)
            sentences = extract_sentences_from_pdf(pdf_text)
        
        # Save processed data in session directory
        processed_data = {
            'document_id': document_id,
            'session_id': current_session,
            'filename': doc['filename'],
            'source_filepath': doc['filepath'],
            'text_length': doc.get('text_length', len(sentences) * 50),  # Estimate if not available
            'sentence_count': len(sentences),
            'processed_at': time.time(),
            'processed_at_iso': datetime.utcnow().isoformat()
        }
        
        # Save metadata
        with open(processed_file, 'w') as f:
            json.dump(processed_data, f, indent=2)
        
        # Save sentences
        sentences_file = os.path.join(doc_session_dir, 'sentences.json')
        with open(sentences_file, 'w') as f:
            json.dump(sentences, f, indent=2, ensure_ascii=False)
        
        # Update session metadata
        update_session_metadata(current_session, documents_processed=1)
        
        return jsonify({
            'success': True,
            'processed_for_session': current_session,
            **processed_data
        })
        
    except Exception as e:
        #logger.error(f"Error processing document for session: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def update_session_metadata(session_id, documents_processed=0, questions_asked=0):
    """Update session metadata counters"""
    try:
        metadata_file = os.path.join(get_session_data_dir(session_id), 'session_metadata.json')
        
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
        else:
            metadata = {
                'session_id': session_id,
                'created_at': time.time(),
                'documents_processed': 0,
                'questions_asked': 0,
                'status': 'active'
            }
        
        metadata['documents_processed'] += documents_processed
        metadata['questions_asked'] += questions_asked
        metadata['last_updated'] = time.time()
        metadata['last_updated_iso'] = datetime.utcnow().isoformat()
        
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
    
    except Exception as e:
        print(f"Error updating session metadata: {e}")


@main.route('/sessions/<session_id>/ask', methods=['POST'])
def ask_question_in_session(session_id):
    """Ask a question within a specific session - with robust document handling"""
    data = request.json
    question_text = data.get('question')
    document_id = data.get('document_id')
    
    if not question_text or not document_id:
        return jsonify({'error': 'Question and document_id required'}), 400
    
    try:
        logger.info(f"🔄 Session-based question: {question_text} for document: {document_id}")
        
        # Ensure session directories exist
        session_dir, docs_dir, questions_dir = ensure_session_dirs(session_id)
        
        # Check if document is processed for this session
        doc_session_dir = os.path.join(docs_dir, document_id)
        processed_file = os.path.join(doc_session_dir, 'processed_data.json')
        sentences_file = os.path.join(doc_session_dir, 'sentences.json')
        text_file = os.path.join(doc_session_dir, 'full_text.txt')
        
        # Strategy 1: Check if document is already processed for this session
        if os.path.exists(processed_file) and os.path.exists(sentences_file) and os.path.exists(text_file):
            logger.info("✅ Document already processed for session")
            
            # Load existing data
            with open(processed_file, 'r', encoding='utf-8') as f:
                doc_data = json.load(f)
            
            with open(sentences_file, 'r', encoding='utf-8') as f:
                sentences = json.load(f)
            
            with open(text_file, 'r', encoding='utf-8') as f:
                pdf_text = f.read()

            # Verify the text was loaded correctly
            if not pdf_text or len(pdf_text.strip()) < 100:
                logger.warning("⚠️ Existing text file appears corrupted, re-extracting...")
                # Fall through to re-extraction
                pdf_text = None
            else:
                logger.info(f"✅ Loaded existing text: {len(pdf_text)} characters")
                
        else:
            pdf_text = None
                
        if not pdf_text:
            # Strategy 2: Find and process the document now
            logger.info("🔄 Document not processed for session, processing now...")
            
            # Find the document using unified lookup
            doc = find_document_by_id(document_id)
            if not doc:
                logger.error(f"❌ Document {document_id} not found")
                return jsonify({'error': 'Document not found'}), 404
            
            # Get filepath and verify it exists
            filepath = doc.get('filepath')
            if not filepath or not os.path.exists(filepath):
                logger.error(f"❌ PDF file not found: {filepath}")
                return jsonify({'error': 'PDF file not found'}), 404
            
            # Extract text and sentences
            logger.info("🔄 Extracting text and sentences from PDF...")

            try:
                pdf_text = extract_text(filepath)
                logger.info(f"✅ Extracted text from PDF: {len(pdf_text)} characters")
                
                # Verify extraction worked
                if not pdf_text or len(pdf_text.strip()) < 10:
                    logger.error("❌ PDF text extraction failed or returned empty content")
                    return jsonify({'error': 'Failed to extract meaningful text from PDF'}), 500
                    
            except Exception as e:
                logger.error(f"❌ Error extracting PDF text: {e}")
                return jsonify({'error': f'Failed to extract text from PDF: {str(e)}'}), 500
            
            # Get or extract sentences
            sentences = doc.get('sentences', [])
            if not sentences:
                try:
                    sentences = extract_sentences_from_pdf(pdf_text)
                    logger.info(f"✅ Extracted {len(sentences)} sentences")
                except Exception as e:
                    logger.error(f"❌ Error extracting sentences: {e}")
                    return jsonify({'error': f'Failed to extract sentences: {str(e)}'}), 500
            else:
                logger.info(f"✅ Using cached {len(sentences)} sentences")
            
            # Create session directory and save processed data
            os.makedirs(doc_session_dir, exist_ok=True)
            
            # Save processed metadata
            doc_data = {
                'document_id': document_id,
                'session_id': session_id,
                'filename': doc['filename'],
                'source_filepath': filepath,
                'text_length': len(pdf_text),
                'sentence_count': len(sentences),
                'processed_at': time.time(),
                'processed_at_iso': datetime.utcnow().isoformat()
            }
            
            try:
                with open(processed_file, 'w', encoding='utf-8') as f:
                    json.dump(doc_data, f, indent=2, ensure_ascii=False)
                
                # Save full text with proper encoding
                with open(text_file, 'w', encoding='utf-8') as f:
                    f.write(pdf_text)
                
                # Verify the text was saved correctly
                with open(text_file, 'r', encoding='utf-8') as f:
                    saved_text = f.read()
                    if len(saved_text) != len(pdf_text):
                        logger.error("❌ Text file save verification failed")
                        return jsonify({'error': 'Failed to save PDF text properly'}), 500
                
                # Save sentences
                with open(sentences_file, 'w', encoding='utf-8') as f:
                    json.dump(sentences, f, indent=2, ensure_ascii=False)
                
                logger.info("✅ Document processed and saved for session")
                
            except Exception as e:
                logger.error(f"❌ Error saving processed data: {e}")
                return jsonify({'error': f'Failed to save processed data: {str(e)}'}), 500
        
        # At this point, we should have valid pdf_text, sentences, and doc_data
        if not pdf_text:
            logger.error("❌ No valid PDF text available after processing")
            return jsonify({'error': 'No valid PDF text available'}), 500
        
        # Create question directory
        question_id = f"q_{int(time.time())}"
        question_dir = os.path.join(questions_dir, question_id)
        os.makedirs(question_dir, exist_ok=True)
        
        logger.info(f"📁 Created question directory: {question_dir}")
        
        # Save question metadata
        question_metadata = {
            'question_id': question_id,
            'session_id': session_id,
            'document_id': document_id,
            'question_text': question_text,
            'created_at': time.time(),
            'created_at_iso': datetime.utcnow().isoformat(),
            'status': 'processing'
        }
        
        metadata_file = os.path.join(question_dir, 'question_metadata.json')
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(question_metadata, f, indent=2, ensure_ascii=False)
        
        # Copy sentences to question directory for processing
        question_sentences_file = os.path.join(question_dir, 'sentences.json')
        with open(question_sentences_file, 'w', encoding='utf-8') as f:
            json.dump(sentences, f, indent=2, ensure_ascii=False)
        
        # Initialize process logs
        logs_file = os.path.join(question_dir, 'process_logs.json')
        logs = {
            'status': 'started',
            'logs': [f"[{datetime.now().strftime('%H:%M:%S')}] Processing started: {question_text}"],
            'timestamp': time.time()
        }
        with open(logs_file, 'w', encoding='utf-8') as f:
            json.dump(logs, f, indent=2, ensure_ascii=False)
        
        # Start processing in background thread
        from threading import Thread
        thread = Thread(target=process_question_in_session, 
                       args=(session_id, question_id, question_text, pdf_text, question_dir))
        thread.daemon = True
        thread.start()
        
        # Update session metadata
        update_session_metadata(session_id, questions_asked=1)
        
        logger.info(f"✅ Session question submitted successfully: {question_id}")
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'question_id': question_id,
            'message': 'Processing started',
            'debug_info': {
                'text_length': len(pdf_text),
                'sentence_count': len(sentences),
                'document_filename': doc_data.get('filename', 'unknown')
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Error in session-based question: {e}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def process_question_in_session(session_id, question_id, question_text, pdf_text, question_dir):
    """Background processing for a question within a session"""
    try:
        update_question_log(question_dir, f"Analyzing document with {len(pdf_text)} characters...")
        
        # Process using doc_provenance
        import sys
        from io import StringIO
        
        stdout_buffer = StringIO()
        stdout_backup = sys.stdout
        sys.stdout = stdout_buffer
        
        try:
            # Process the question
            doc_provenance.divide_and_conquer_progressive_API(question_text, pdf_text, question_dir)
            
            # Get captured output
            output = stdout_buffer.getvalue()
            
            # Parse provenance entries (same logic as before)
            provenance_entries = parse_provenance_output(output, question_dir)
            
            # Save final provenance
            provenance_file = os.path.join(question_dir, 'provenance.json')
            with open(provenance_file, 'w', encoding='utf-8') as f:
                json.dump(provenance_entries, f, indent=2, ensure_ascii=False)
            
            # Create completion status
            status_file = os.path.join(question_dir, 'completion_status.json')
            with open(status_file, 'w') as f:
                json.dump({
                    "completed": True,
                    "timestamp": time.time(),
                    "total_provenance": len(provenance_entries),
                    "session_id": session_id,
                    "question_id": question_id
                }, f, indent=2)
            
            # Update question metadata
            metadata_file = os.path.join(question_dir, 'question_metadata.json')
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            metadata.update({
                'status': 'completed',
                'completed_at': time.time(),
                'completed_at_iso': datetime.utcnow().isoformat(),
                'provenance_count': len(provenance_entries)
            })
            
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            update_question_log(question_dir, "Processing completed!", status="completed")
            
        finally:
            sys.stdout = stdout_backup
            
    except Exception as e:
        update_question_log(question_dir, f"Error: {str(e)}", status="error")

def update_question_log(question_dir, message, status=None):
    """Update logs for a question"""
    logs_file = os.path.join(question_dir, 'process_logs.json')
    
    try:
        with open(logs_file, 'r') as f:
            logs = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
    
    # Format log entry
    if message.startswith('Top-') or 'tokens:' in message or 'Time:' in message:
        log_entry = message
    else:
        log_entry = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
    
    logs['logs'].append(log_entry)
    
    if status:
        logs['status'] = status
    
    logs['timestamp'] = time.time()
    
    with open(logs_file, 'w') as f:
        json.dump(logs, f, indent=2)

def update_session_metadata(session_id, documents_processed=0, questions_asked=0):
    """Update session metadata counters"""
    try:
        metadata_file = os.path.join(get_session_data_dir(session_id), 'session_metadata.json')
        
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
        else:
            metadata = {
                'session_id': session_id,
                'created_at': time.time(),
                'documents_processed': 0,
                'questions_asked': 0,
                'status': 'active'
            }
        
        metadata['documents_processed'] += documents_processed
        metadata['questions_asked'] += questions_asked
        metadata['last_updated'] = time.time()
        metadata['last_updated_iso'] = datetime.utcnow().isoformat()
        
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
    
    except Exception as e:
        print(f"Error updating session metadata: {e}")

def parse_provenance_output(output, question_dir):
    """Parse provenance output and save progressively"""
    provenance_entries = []
    current_entry = None
    
    for line in output.strip().split('\n'):
        if line.strip():
            update_question_log(question_dir, line.strip())
            
            # Parse Top-X provenance lines
            if line.startswith('Top-'):
                if current_entry is not None:
                    provenance_entries.append(current_entry)
                
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
                            "output_token_size": 0
                        }
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
# SESSION DATA ACCESS ENDPOINTS
# =============================================================================

@main.route('/sessions/<session_id>/questions/<question_id>/progress', methods=['GET'])
def get_question_progress(session_id, question_id):
    """Get progress for a specific question in a session"""
    try:
        question_dir = os.path.join(get_session_questions_dir(session_id), question_id)
        
        if not os.path.exists(question_dir):
            return jsonify({'error': 'Question not found'}), 404
        
        # Get logs
        logs_file = os.path.join(question_dir, 'process_logs.json')
        logs = []
        status = 'processing'
        
        if os.path.exists(logs_file):
            try:
                with open(logs_file, 'r') as f:
                    log_data = json.load(f)
                    logs = log_data.get('logs', [])
                    status = log_data.get('status', 'processing')
            except:
                pass
        
        # Get current provenance
        provenance_file = os.path.join(question_dir, 'provenance.json')
        provenance_data = []
        
        if os.path.exists(provenance_file):
            try:
                with open(provenance_file, 'r', encoding='utf-8') as f:
                    provenance_data = json.load(f)
            except:
                pass
        
        done = status == 'completed' or len(provenance_data) > 0
        
        return jsonify({
            'session_id': session_id,
            'question_id': question_id,
            'progress': len(provenance_data),
            'done': done,
            'data': provenance_data,
            'logs': logs,
            'status': status
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/questions/<question_id>/results', methods=['GET'])
def get_question_results(session_id, question_id):
    """Get final results for a question"""
    try:
        question_dir = os.path.join(get_session_questions_dir(session_id), question_id)
        
        if not os.path.exists(question_dir):
            return jsonify({'error': 'Question not found'}), 404
        
        # Get provenance
        provenance_file = os.path.join(question_dir, 'provenance.json')
        provenance_data = []
        
        if os.path.exists(provenance_file):
            with open(provenance_file, 'r', encoding='utf-8') as f:
                provenance_data = json.load(f)
        
        # Check for answer file
        answer_file = os.path.join(question_dir, 'answers.txt')
        answer = None
        if os.path.exists(answer_file):
            with open(answer_file, 'r', encoding='utf-8') as f:
                answer = f.read().strip()
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'question_id': question_id,
            'provenance': provenance_data,
            'answer': answer
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/questions/<question_id>/sentences', methods=['GET'])
def get_question_sentences(session_id, question_id):
    """Get sentences for a question"""
    sentence_ids = request.args.get('ids')
    if not sentence_ids:
        return jsonify({'error': 'No sentence IDs provided'}), 400
    
    try:
        sentence_ids = [int(id) for id in sentence_ids.split(',')]
    except ValueError:
        return jsonify({'error': 'Invalid sentence IDs format'}), 400
    
    try:
        question_dir = os.path.join(get_session_questions_dir(session_id), question_id)
        sentences_file = os.path.join(question_dir, 'sentences.json')
        
        if not os.path.exists(sentences_file):
            return jsonify({'error': 'Sentences not found'}), 404
        
        with open(sentences_file, 'r', encoding='utf-8') as f:
            sentences = json.load(f)
        
        result = {}
        for sid in sentence_ids:
            if 0 <= sid < len(sentences):
                result[sid] = sentences[sid]
            else:
                result[sid] = f"Sentence ID {sid} out of range"
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'question_id': question_id,
            'sentences': result
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/questions/<question_id>/status', methods=['GET'])
def get_question_status(session_id, question_id):
    """Check if question processing is complete"""
    try:
        question_dir = os.path.join(get_session_questions_dir(session_id), question_id)
        status_file = os.path.join(question_dir, 'completion_status.json')
        
        if os.path.exists(status_file):
            with open(status_file, 'r') as f:
                return jsonify(json.load(f))
        else:
            return jsonify({
                "completed": False,
                "timestamp": time.time(),
                "session_id": session_id,
                "question_id": question_id
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Enhanced session updating functions:

def add_document_to_session(session_id, document_id):
    """Add a document to the session tracking"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        # Load existing session data
        if os.path.exists(session_path):
            with open(session_path, 'r') as f:
                session_data = json.load(f)
        else:
            session_data = {
                'session_id': session_id,
                'created_at': time.time(),
                'status': 'active',
                'documents': [],
                'questions': []
            }
        
        # Add document if not already present
        if document_id not in session_data.get('documents', []):
            session_data.setdefault('documents', []).append(document_id)
            session_data['last_updated'] = time.time()
            
            # Save updated session
            with open(session_path, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            #logger.info(f"Added document {document_id} to session {session_id}")
        
    except Exception as e:
        print(f"Error adding document to session: {e}")

def add_question_to_session(session_id, question_data):
    """Add a question to the session tracking"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        # Load existing session data
        if os.path.exists(session_path):
            with open(session_path, 'r') as f:
                session_data = json.load(f)
        else:
            session_data = {
                'session_id': session_id,
                'created_at': time.time(),
                'status': 'active',
                'documents': [],
                'questions': []
            }
        
        # Add question
        session_data.setdefault('questions', []).append(question_data)
        session_data['last_updated'] = time.time()
        
        # Ensure document is also tracked
        document_id = question_data.get('document_id')
        if document_id and document_id not in session_data.get('documents', []):
            session_data.setdefault('documents', []).append(document_id)
        
        # Save updated session
        with open(session_path, 'w') as f:
            json.dump(session_data, f, indent=2)
        
        #logger.info(f"Added question {question_data.get('question_id')} to session {session_id}")
        
    except Exception as e:
        print(f"Error adding question to session: {e}")

def update_question_in_session(session_id, question_id, updates):
    """Update a question's status in the session"""
    try:
        session_path = os.path.join(RESULT_DIR, session_id, 'session.json')
        
        if not os.path.exists(session_path):
            return
            
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        # Find and update the question
        questions = session_data.get('questions', [])
        for i, question in enumerate(questions):
            if question.get('question_id') == question_id:
                questions[i].update(updates)
                session_data['last_updated'] = time.time()
                break
        
        # Save updated session
        with open(session_path, 'w') as f:
            json.dump(session_data, f, indent=2)
            
    except Exception as e:
        print(f"Error updating question in session: {e}")

# =============================================================================
# TEXT PROCESSING ENDPOINTS
# =============================================================================

@main.route('/sessions/<session_id>/process-text', methods=['POST'])
def process_text_question(session_id):
    """Process a question against document text using provenance algorithm
        AKA - ask a question about a document"""
    data = request.json
    question_text = data.get('question')
    document_id = data.get('document_id')
    document_text = data.get('document_text', None)
    
    if not question_text:
        return jsonify({'error': 'Question text required'}), 400
    
    if not document_id:
        return jsonify({'error': 'Document ID required'}), 400
    
    try:
        question_id = generate_content_hash(f"{question_text}_{time.time()}", "q_")
        processing_session_id = generate_content_hash(f"{question_id}_{document_id}", "proc_")
        
        # Get document data
        doc_data = find_document_by_id(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        # Create processing session directory
        processing_dir = os.path.join(RESULT_DIR, processing_session_id)
        os.makedirs(processing_dir, exist_ok=True)
        
        # Save sentences for later
        sentences_path = os.path.join(processing_dir, 'sentences.json')
        with open(sentences_path, 'w', encoding='utf-8') as f:
            json.dump(doc_data.get('sentences', []), f, ensure_ascii=False, indent=2)
        
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
        thread = Thread(target=process_question_session, args=(processing_session_id, question_text, document_text, question_id))
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
        #logger.error(f"Error processing text question: {e}")
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
                with open(logs_path, 'r', encoding='utf-8') as f:
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
            with open(provenance_path, 'r', encoding='utf-8') as f:
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
        #logger.error(f"Error getting processing progress: {e}")
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
        
        with open(provenance_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Check if there's an answer file
        answer_path = os.path.join(RESULT_DIR, processing_session_id, 'answers.txt')
        answer = None
        if os.path.exists(answer_path):
            with open(answer_path, 'r', encoding='utf-8') as f:
                answer = f.read().strip()
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'processing_session_id': processing_session_id,
            'provenance': data,
            'answer': answer
        })
        
    except Exception as e:
        #logger.error(f"Error getting processing results: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/sentences/<int:sentence_id>', methods=['GET'])
def get_specific_sentence(document_id, sentence_id):
    """Get a specific sentence by ID"""
    try:
        doc_data = find_document_by_id(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        sentences = doc_data.get('sentences', [])
        
        if sentence_id < 0 or sentence_id >= len(sentences):
            return jsonify({'error': f'Sentence ID {sentence_id} out of range'}), 400
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'sentence_id': sentence_id,
            'sentence': sentences[sentence_id],
            'total_sentences': len(sentences)
        })
        
    except Exception as e:
        #logger.error(f"Error getting sentence {sentence_id} for document {document_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/processing/<processing_session_id>/sentences', methods=['GET'])
def get_processing_sentences(session_id, processing_session_id):
    """Get sentences for a specific processing session from document storage"""
    sentence_ids = request.args.get('ids')
    if not sentence_ids:
        return jsonify({'error': 'No sentence IDs provided'}), 400
    
    try:
        sentence_ids = [int(id) for id in sentence_ids.split(',')]
    except ValueError:
        return jsonify({'error': 'Invalid sentence IDs format'}), 400
    
    try:
        # Get the document_id from processing session logs
        logs_path = os.path.join(RESULT_DIR, processing_session_id, 'process_logs.json')
        if not os.path.exists(logs_path):
            return jsonify({'error': 'Processing session not found'}), 404
            
        with open(logs_path, 'r', encoding='utf-8') as f:
            logs = json.load(f)
        
        document_id = logs.get('document_id')
        if not document_id:
            return jsonify({'error': 'Document ID not found in processing session'}), 404
        
        # Get document data (which includes sentences)
        doc_data = find_document_by_id(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        sentences = doc_data.get('sentences', [])
        
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
            'document_id': document_id,
            'sentences': result
        })
        
    except Exception as e:
        #logger.error(f"Error getting processing sentences: {e}")
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
        #logger.error(f"Error getting session questions: {e}")
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
        #logger.error(f"Error getting document questions: {e}")
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
        #logger.error(f"Error getting specific question: {e}")
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
        #logger.error(f"Error submitting feedback: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# =============================================================================
# UTILITY FUNCTIONS (CONTINUED)
# =============================================================================

def save_document_data(document_id, doc_data, sentences):
    """Save document data and sentences to appropriate folder"""
    is_preloaded = doc_data.get('is_preloaded', False)
    base_dir = PRELOAD_DIR if is_preloaded else current_app.config['UPLOAD_FOLDER']
    
    # Use the original filename without extension for the base name
    filename = doc_data.get('filename', '')
    base_name = filename.rsplit('.', 1)[0] if '.' in filename else filename
    
    # Save sentences alongside the PDF
    sentences_path = os.path.join(base_dir, f"{base_name}_sentences.json")
    with open(sentences_path, 'w', encoding='utf-8') as f:
        json.dump(sentences, f, indent=2, ensure_ascii=False)
    
    # Save metadata (without sentences to keep it light)
    metadata_path = os.path.join(base_dir, f"{base_name}_metadata.json")
    metadata = {k: v for k, v in doc_data.items() if k != 'sentences'}
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    #logger.info(f"Saved document data for {base_name} in {'preloaded' if is_preloaded else 'uploads'}")

def process_question_session(processing_session_id, question_text, pdf_text, question_id):
    """Process a single question-document session using pre-extracted sentences"""
    start_time = time.time()
    sentences = extract_sentences_from_pdf(pdf_text)
    try:

        update_process_log(processing_session_id, f"Analyzing document with {len(pdf_text)} characters...")
        
        result_path = os.path.join(RESULT_DIR, processing_session_id)
        
        # Ensure result directory exists
        os.makedirs(result_path, exist_ok=True)
        
        # Capture stdout to preserve the exact output format
        stdout_buffer = StringIO()
        stdout_backup = sys.stdout
        sys.stdout = stdout_buffer
        
        algorithm_start_time = time.time()
        
        try:
            # Process the question using doc_provenance API with sentence-aware text
            doc_provenance.divide_and_conquer_progressive_API(question_text, pdf_text, result_path)
            
            algorithm_end_time = time.time()
            algorithm_processing_time = algorithm_end_time - algorithm_start_time
            
            # Get the captured output
            output = stdout_buffer.getvalue()
            
            # Parse provenance information from the output
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
                                # Remove square brackets
                                ids_str = ids_str.strip('[]')
                                # Split by comma and convert to integers
                                prov_ids = [int(id_str.strip()) for id_str in ids_str.split(',') if id_str.strip()]
                                    
                                current_entry = {
                                    "provenance_id": prov_id,
                                    "sentences_ids": prov_ids,
                                    "time": 0,
                                    "input_token_size": 0,
                                    "output_token_size": 0
                                }
                        except Exception as e:
                            #logger.error(f"Error parsing provenance line '{line}': {str(e)}")
                            pass
                    
                    # Parse time and token information
                    elif line.startswith('Time:') and current_entry is not None:
                        try:
                            current_entry["time"] = float(line.split(':')[1].strip())

                            # Write current provenance entries after each time entry is processed
                            # This ensures we save intermediate results
                            provenance_path = os.path.join(result_path, 'provenance.json')
                            with open(provenance_path, 'w') as f:
                                temp_entries = provenance_entries.copy()
                                if current_entry is not None:
                                    temp_entries.append(current_entry)
                                json.dump(temp_entries, f, indent=2)
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
            
            # Add the last entry if it exists
            if current_entry is not None:
                provenance_entries.append(current_entry)
            
            # Validate and enhance provenance entries with actual sentence content
            enhanced_provenance = []
            for entry in provenance_entries:
                if entry.get('sentences_ids'):
                    # Add the actual sentence content for verification
                    sentence_content = []
                    for sid in entry['sentences_ids']:
                        if 0 <= sid < len(sentences):
                            sentence_content.append(sentences[sid])
                        else:
                            sentence_content.append(f"[INVALID_SENTENCE_ID_{sid}]")
                    
                    entry['sentence_content'] = sentence_content
                    enhanced_provenance.append(entry)
            
            # Write the processed provenance entries
            provenance_path = os.path.join(result_path, 'provenance.json')
            with open(provenance_path, 'w', encoding='utf-8') as f:
                json.dump(enhanced_provenance, f, indent=2, ensure_ascii=False)
                
            # Create a status file to indicate completion
            status_path = os.path.join(result_path, 'status.json')
            with open(status_path, 'w') as f:
                json.dump({
                    "completed": True,
                    "timestamp": time.time(),
                    "total_provenance": len(enhanced_provenance),
                    "total_processing_time": time.time() - start_time,
                    "algorithm_processing_time": algorithm_processing_time
                }, f)
            
            update_process_log(processing_session_id, f"Text processing completed! Found {len(enhanced_provenance)} provenance entries.", status="completed")
            
        finally:
            sys.stdout = stdout_backup
            
    except Exception as e:
        #logger.exception("Error in text processing session")
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
    
    #logger.info(f"Processing session {processing_session_id}: {message}")


@main.route('/ask', methods=['POST'])
def ask_question():
    """Legacy question processing - now works with unified document system"""
    data = request.json
    question = data.get('question')
    filename = data.get('filename')
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
    try:
        logger.info(f"🔄 Legacy ask endpoint - Question: {question}, Filename: {filename}")
        
        # Strategy 1: Try to find document by filename in the new unified system
        all_docs = get_all_available_pdfs()
        target_doc = None
        
        for doc in all_docs:
            if doc.get('filename') == filename:
                target_doc = doc
                logger.info(f"✅ Found document by filename: {filename}")
                break
        
        if not target_doc:
            logger.error(f"❌ Document not found by filename: {filename}")
            
            # Strategy 2: Try old PDF data format as fallback
            pdf_data_path = os.path.join(RESULT_DIR, f"{filename.split('.')[0]}_data.json")
            logger.info(f"🔍 Trying legacy data path: {pdf_data_path}")
            
            if os.path.exists(pdf_data_path):
                try:
                    with open(pdf_data_path, 'r', encoding='utf-8') as f:
                        pdf_data = json.load(f)
                    logger.info("✅ Found legacy PDF data")
                    
                    # Convert legacy format to new format
                    target_doc = {
                        'document_id': pdf_data.get('document_id', f'legacy_{filename.split(".")[0]}'),
                        'filename': pdf_data.get('filename', filename),
                        'filepath': pdf_data.get('filepath'),
                        'text_length': pdf_data.get('text_length', 0),
                        'sentences': pdf_data.get('sentences', []),
                        'is_preloaded': False,
                        'source_folder': 'legacy'
                    }
                except Exception as e:
                    logger.error(f"❌ Error reading legacy PDF data: {e}")
                    return jsonify({'error': 'PDF data format error'}), 500
            else:
                logger.error(f"❌ No document found for filename: {filename}")
                return jsonify({'error': 'PDF data not found'}), 404
        
        # Get or create the document data we need
        document_id = target_doc.get('document_id')
        filepath = target_doc.get('filepath')
        sentences = target_doc.get('sentences', [])
        
        # If no sentences, load them
        if not sentences and filepath and os.path.exists(filepath):
            try:
                logger.info("🔄 Extracting sentences from PDF...")
                pdf_text = extract_text(filepath)
                sentences = extract_sentences_from_pdf(pdf_text)
                logger.info(f"✅ Extracted {len(sentences)} sentences")
            except Exception as e:
                logger.error(f"❌ Error extracting sentences: {e}")
                return jsonify({'error': 'Failed to extract sentences from PDF'}), 500
        
        if not filepath or not os.path.exists(filepath):
            logger.error(f"❌ PDF file not found: {filepath}")
            return jsonify({'error': 'PDF file not found'}), 404
        
        # Extract text from PDF for processing
        try:
            pdf_text = extract_text(filepath)
            logger.info(f"✅ Extracted text from PDF: {len(pdf_text)} characters")
        except Exception as e:
            logger.error(f"❌ Error extracting PDF text: {e}")
            return jsonify({'error': 'Failed to extract text from PDF'}), 500
        
        # Create result path for this question
        question_id = str(int(time.time()))
        result_path = os.path.join(RESULT_DIR, question_id)
        os.makedirs(result_path, exist_ok=True)
        
        logger.info(f"📁 Created result directory: {result_path}")
        
        # Save sentences for later use
        sentences_path = os.path.join(result_path, 'sentences.json')
        with open(sentences_path, 'w') as f:
            json.dump(sentences, f, ensure_ascii=False, indent=2)
        
        # Initialize process logs
        logs_path = os.path.join(result_path, 'process_logs.json')
        logs = {
            'status': 'started',
            'logs': [f"[{time.strftime('%H:%M:%S')}] Processing started: {question}"],
            'timestamp': time.time(),
            'document_id': document_id,
            'filename': filename,
            'question_id': question_id
        }
        with open(logs_path, 'w') as f:
            json.dump(logs, f, indent=2)
        
        logger.info(f"✅ Initialized processing for question: {question_id}")
        
        # Start processing in a separate thread (same as before)
        from threading import Thread
        def process_question():
            try:
                logger.info(f"🔄 Starting background processing for question: {question_id}")
                
                # Add log entry
                update_process_log(question_id, f"Analyzing document with {len(pdf_text)} characters...")
                
                # Capture stdout to preserve the exact output format
                stdout_buffer = StringIO()
                stdout_backup = sys.stdout
                sys.stdout = stdout_buffer
                
                try:
                    # Process the question using doc_provenance API
                    doc_provenance.divide_and_conquer_progressive_API(question, pdf_text, result_path)
                    
                    # Get the captured output
                    output = stdout_buffer.getvalue()
                    
                    # Extract provenance information from the output (same logic as before)
                    provenance_entries = []
                    current_entry = None
                    
                    for line in output.strip().split('\n'):
                        if line.strip():
                            update_process_log(question_id, line.strip())
                            
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
                                        # Remove square brackets
                                        ids_str = ids_str.strip('[]')
                                        # Split by comma and convert to integers
                                        prov_ids = [int(id_str.strip()) for id_str in ids_str.split(',') if id_str.strip()]
                                        
                                        current_entry = {
                                            "provenance_id": prov_id,
                                            "sentences_ids": prov_ids,
                                            "time": 0,
                                            "input_token_size": 0,
                                            "output_token_size": 0
                                        }
                                except Exception as e:
                                    logger.warning(f"Error parsing provenance line '{line}': {str(e)}")
                                    pass
                            
                            # Parse time information
                            elif line.startswith('Time:') and current_entry is not None:
                                try:
                                    current_entry["time"] = float(line.split(':')[1].strip())
                                    
                                    # PROGRESSIVE SAVING - Write current provenance entries after each time entry
                                    provenance_path = os.path.join(result_path, 'provenance.json')
                                    with open(provenance_path, 'w', encoding='utf-8') as f:
                                        temp_entries = provenance_entries.copy()
                                        if current_entry is not None:
                                            temp_entries.append(current_entry)
                                        json.dump(temp_entries, f, indent=2, ensure_ascii=False)
                                        
                                except:
                                    pass
                            
                            # Parse token information
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
                    
                    # Add the last entry if it exists
                    if current_entry is not None:
                        provenance_entries.append(current_entry)
                    
                    # Write the final processed provenance entries
                    provenance_path = os.path.join(result_path, 'provenance.json')
                    with open(provenance_path, 'w', encoding='utf-8') as f:
                        json.dump(provenance_entries, f, indent=2, ensure_ascii=False)
                        
                    # Create a status file to indicate all processing is done
                    status_path = os.path.join(result_path, 'status.json')
                    with open(status_path, 'w') as f:
                        json.dump({
                            "completed": True,
                            "timestamp": time.time(),
                            "total_provenance": len(provenance_entries)
                        }, f)
                    
                    # Mark process as complete
                    update_process_log(question_id, "Processing completed!", status="completed")
                    logger.info(f"✅ Completed processing for question: {question_id}")
                    
                finally:
                    # Restore stdout
                    sys.stdout = stdout_backup
                    
            except Exception as e:
                logger.error(f"❌ Error processing question {question_id}: {e}")
                update_process_log(question_id, f"Error: {str(e)}", status="error")
        
        thread = Thread(target=process_question)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'question_id': question_id,
            'message': 'Processing started'
        })
        
    except Exception as e:
        logger.error(f"❌ Legacy ask endpoint error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# yash_code below:

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
    answer_path = os.path.join(RESULT_DIR, question_id, 'answers.txt')
    answer = None
    if os.path.exists(answer_path):
        with open(answer_path, 'r', encoding='utf-8') as f:
            answer = f.read().strip()
    
    return jsonify({
        'success': True,
        'provenance': data,
        'answer': answer
    })

@main.route('/check-progress/<question_id>', methods=['GET'])
def check_progress(question_id):
    # Read the provenance file to check progress
    provenance_path = os.path.join(RESULT_DIR, question_id, 'provenance.json')
    logs_path = os.path.join(RESULT_DIR, question_id, 'process_logs.json')
    
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
        
@main.route('/sentences/<question_id>', methods=['GET'])
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

# =============================================================================
# CLEANUP MANAGEMENT ENDPOINTS
# =============================================================================

@main.route('/sessions/<session_id>/cleanup', methods=['DELETE'])
def cleanup_session_data(session_id):
    """Clean up session data with granular options"""
    data = request.json or {}
    cleanup_type = data.get('type', 'all')  # 'documents', 'questions', 'all'
    confirm = data.get('confirm', False)
    
    if not confirm:
        return jsonify({'error': 'Confirmation required for cleanup operations'}), 400
    
    try:
        session_dir = get_session_data_dir(session_id)
        docs_dir = get_session_documents_dir(session_id)
        questions_dir = get_session_questions_dir(session_id)
        
        if not os.path.exists(session_dir):
            return jsonify({
                'success': True,
                'message': 'Session directory does not exist'
            })
        
        cleanup_stats = {
            'documents_removed': 0,
            'questions_removed': 0,
            'total_size_freed': 0
        }
        
        if cleanup_type in ['documents', 'all']:
            if os.path.exists(docs_dir):
                # Calculate size before deletion
                for root, dirs, files in os.walk(docs_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        cleanup_stats['total_size_freed'] += os.path.getsize(file_path)
                
                # Count documents
                cleanup_stats['documents_removed'] = len([d for d in os.listdir(docs_dir) 
                                                         if os.path.isdir(os.path.join(docs_dir, d))])
                
                # Remove documents directory
                shutil.rmtree(docs_dir)
                os.makedirs(docs_dir, exist_ok=True)
        
        if cleanup_type in ['questions', 'all']:
            if os.path.exists(questions_dir):
                # Calculate size before deletion
                for root, dirs, files in os.walk(questions_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        cleanup_stats['total_size_freed'] += os.path.getsize(file_path)
                
                # Count questions
                cleanup_stats['questions_removed'] = len([q for q in os.listdir(questions_dir) 
                                                         if os.path.isdir(os.path.join(questions_dir, q))])
                
                # Remove questions directory
                shutil.rmtree(questions_dir)
                os.makedirs(questions_dir, exist_ok=True)
        
        # Update session metadata
        metadata_file = os.path.join(session_dir, 'session_metadata.json')
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            if cleanup_type in ['documents', 'all']:
                metadata['documents_processed'] = 0
            if cleanup_type in ['questions', 'all']:
                metadata['questions_asked'] = 0
            
            metadata['last_cleanup'] = time.time()
            metadata['last_cleanup_iso'] = datetime.utcnow().isoformat()
            metadata['last_cleanup_type'] = cleanup_type
            
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
        
        return jsonify({
            'success': True,
            'cleanup_type': cleanup_type,
            'session_id': session_id,
            'stats': cleanup_stats,
            'message': f'Successfully cleaned up {cleanup_type} for session {session_id}'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/documents/<document_id>', methods=['DELETE'])
def remove_session_document(session_id, document_id):
    """Remove a specific document from session"""
    try:
        doc_dir = os.path.join(get_session_documents_dir(session_id), document_id)
        
        if not os.path.exists(doc_dir):
            return jsonify({'error': 'Document not found in session'}), 404
        
        # Calculate size
        total_size = 0
        for root, dirs, files in os.walk(doc_dir):
            for file in files:
                total_size += os.path.getsize(os.path.join(root, file))
        
        # Remove directory
        shutil.rmtree(doc_dir)
        
        # Update session metadata
        update_session_metadata(session_id, documents_processed=-1)
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'document_id': document_id,
            'size_freed': total_size,
            'message': f'Document {document_id} removed from session'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/questions/<question_id>', methods=['DELETE'])
def remove_session_question(session_id, question_id):
    """Remove a specific question from session"""
    try:
        question_dir = os.path.join(get_session_questions_dir(session_id), question_id)
        
        if not os.path.exists(question_dir):
            return jsonify({'error': 'Question not found in session'}), 404
        
        # Calculate size
        total_size = 0
        for root, dirs, files in os.walk(question_dir):
            for file in files:
                total_size += os.path.getsize(os.path.join(root, file))
        
        # Remove directory
        shutil.rmtree(question_dir)
        
        # Update session metadata
        update_session_metadata(session_id, questions_asked=-1)
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'question_id': question_id,
            'size_freed': total_size,
            'message': f'Question {question_id} removed from session'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions', methods=['DELETE'])
def cleanup_all_sessions():
    """Nuclear option - clean up all sessions"""
    data = request.json or {}
    confirm = data.get('confirm', False)
    confirm_phrase = data.get('confirm_phrase', '')
    
    if not confirm or confirm_phrase != 'DELETE_ALL_SESSIONS':
        return jsonify({
            'error': 'Must confirm with confirm=true and confirm_phrase="DELETE_ALL_SESSIONS"'
        }), 400
    
    try:
        sessions_root = os.path.join(RESULT_DIR, 'sessions')
        
        if not os.path.exists(sessions_root):
            return jsonify({
                'success': True,
                'message': 'No sessions directory exists'
            })
        
        # Calculate total size
        total_size = 0
        session_count = 0
        for root, dirs, files in os.walk(sessions_root):
            for file in files:
                total_size += os.path.getsize(os.path.join(root, file))
        
        session_count = len([d for d in os.listdir(sessions_root) 
                            if os.path.isdir(os.path.join(sessions_root, d))])
        
        # Remove all sessions
        shutil.rmtree(sessions_root)
        os.makedirs(sessions_root, exist_ok=True)
        
        # Clear current session from Flask session
        from flask import session
        if 'current_session_id' in session:
            del session['current_session_id']
        
        return jsonify({
            'success': True,
            'sessions_removed': session_count,
            'total_size_freed': total_size,
            'message': f'All {session_count} sessions cleaned up successfully'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/stats', methods=['GET'])
def get_sessions_stats():
    """Get statistics about all sessions"""
    try:
        sessions_root = os.path.join(RESULT_DIR, 'sessions')
        
        if not os.path.exists(sessions_root):
            return jsonify({
                'total_sessions': 0,
                'total_documents': 0,
                'total_questions': 0,
                'total_size_bytes': 0,
                'sessions': []
            })
        
        stats = {
            'total_sessions': 0,
            'total_documents': 0,
            'total_questions': 0,
            'total_size_bytes': 0,
            'sessions': []
        }
        
        for session_name in os.listdir(sessions_root):
            session_path = os.path.join(sessions_root, session_name)
            if not os.path.isdir(session_path):
                continue
            
            session_info = {
                'session_id': session_name,
                'documents_count': 0,
                'questions_count': 0,
                'size_bytes': 0,
                'created_at': None
            }
            
            # Count documents
            docs_dir = os.path.join(session_path, 'documents')
            if os.path.exists(docs_dir):
                session_info['documents_count'] = len([d for d in os.listdir(docs_dir) 
                                                      if os.path.isdir(os.path.join(docs_dir, d))])
            
            # Count questions
            questions_dir = os.path.join(session_path, 'questions')
            if os.path.exists(questions_dir):
                session_info['questions_count'] = len([q for q in os.listdir(questions_dir) 
                                                      if os.path.isdir(os.path.join(questions_dir, q))])
            
            # Calculate size
            for root, dirs, files in os.walk(session_path):
                for file in files:
                    file_size = os.path.getsize(os.path.join(root, file))
                    session_info['size_bytes'] += file_size
            
            # Get metadata
            metadata_file = os.path.join(session_path, 'session_metadata.json')
            if os.path.exists(metadata_file):
                try:
                    with open(metadata_file, 'r') as f:
                        metadata = json.load(f)
                        session_info['created_at'] = metadata.get('created_at')
                        session_info['created_at_iso'] = metadata.get('created_at_iso')
                except:
                    pass
            
            stats['sessions'].append(session_info)
            stats['total_documents'] += session_info['documents_count']
            stats['total_questions'] += session_info['questions_count']
            stats['total_size_bytes'] += session_info['size_bytes']
        
        stats['total_sessions'] = len(stats['sessions'])
        
        # Sort sessions by creation time (newest first)
        stats['sessions'].sort(key=lambda x: x.get('created_at', 0), reverse=True)
        
        return jsonify(stats)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/sessions/<session_id>/summary', methods=['GET'])
def get_session_summary(session_id):
    """Get detailed summary of a specific session"""
    try:
        session_dir = get_session_data_dir(session_id)
        
        if not os.path.exists(session_dir):
            return jsonify({'error': 'Session not found'}), 404
        
        docs_dir = get_session_documents_dir(session_id)
        questions_dir = get_session_questions_dir(session_id)
        
        summary = {
            'session_id': session_id,
            'documents': [],
            'questions': [],
            'stats': {
                'total_documents': 0,
                'total_questions': 0,
                'total_size_bytes': 0,
                'completed_questions': 0,
                'processing_questions': 0
            }
        }
        
        # Load session metadata
        metadata_file = os.path.join(session_dir, 'session_metadata.json')
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                summary['metadata'] = json.load(f)
        
        # Scan documents
        if os.path.exists(docs_dir):
            for doc_name in os.listdir(docs_dir):
                doc_path = os.path.join(docs_dir, doc_name)
                if os.path.isdir(doc_path):
                    processed_file = os.path.join(doc_path, 'processed_data.json')
                    if os.path.exists(processed_file):
                        with open(processed_file, 'r', encoding='utf-8') as f:
                            doc_info = json.load(f)
                            summary['documents'].append(doc_info)
        
        # Scan questions
        if os.path.exists(questions_dir):
            for q_name in os.listdir(questions_dir):
                q_path = os.path.join(questions_dir, q_name)
                if os.path.isdir(q_path):
                    metadata_file = os.path.join(q_path, 'question_metadata.json')
                    if os.path.exists(metadata_file):
                        with open(metadata_file, 'r') as f:
                            q_info = json.load(f)
                            summary['questions'].append(q_info)
                            
                            if q_info.get('status') == 'completed':
                                summary['stats']['completed_questions'] += 1
                            elif q_info.get('status') == 'processing':
                                summary['stats']['processing_questions'] += 1
        
        # Calculate totals
        summary['stats']['total_documents'] = len(summary['documents'])
        summary['stats']['total_questions'] = len(summary['questions'])
        
        # Calculate total size
        for root, dirs, files in os.walk(session_dir):
            for file in files:
                summary['stats']['total_size_bytes'] += os.path.getsize(os.path.join(root, file))
        
        return jsonify({
            'success': True,
            'summary': summary
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500