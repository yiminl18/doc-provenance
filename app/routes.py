import doc_provenance, hashlib, json, logging, os, random, sys, time, uuid
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
#logging.basicConfig(level=logging.INFO)
#logger = logging.getLogger(__name__)

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
        print(f"Error logging user study event: {e}")

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

# Updated scan_upload_folder_for_pdfs function
def scan_upload_folder_for_pdfs():
    """Scan the upload folder for PDF files and create uploaded document metadata"""
    uploads_dir = current_app.config['UPLOAD_FOLDER']
    uploaded_docs = []
    
    try:
        # Ensure upload directory exists
        if not os.path.exists(uploads_dir):
            #logger.warning(f"Upload directory does not exist: {uploads_dir}")
            return []
        
        # Get all PDF files in the upload directory
        pdf_files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
        
        #logger.info(f"Found {len(pdf_files)} PDF files in upload folder")
        
        for pdf_file in pdf_files:
            try:
                filepath = os.path.join(uploads_dir, pdf_file)

                # Verify file actually exists before processing
                if not os.path.exists(filepath):
                    #logger.warning(f"PDF file listed but not found: {filepath}")
                    continue
                
                # Get base name without extension
                base_name = pdf_file.replace('.pdf', '')
                metadata_file = os.path.join(uploads_dir, f"{base_name}_metadata.json")
                sentences_file = os.path.join(uploads_dir, f"{base_name}_sentences.json")
                
                # Generate consistent document ID
                file_stat = os.stat(filepath)
                doc_id = generate_content_hash(f"{pdf_file}_", "uploaded_")
                
                # Check if we already have processed this file
                if os.path.exists(metadata_file) and os.path.exists(sentences_file):
                    # Load existing metadata
                    try:
                        with open(metadata_file, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Update document ID and filepath in case it changed
                        metadata['document_id'] = doc_id
                        metadata['filepath'] = filepath
                        
                        # Verify the PDF file still exists
                        if os.path.exists(filepath):
                            uploaded_docs.append(metadata)
                            #logger.info(f"Loaded existing metadata for {pdf_file}")
                        else:
                            print(f"Metadata exists but PDF file missing: {filepath}")
                        continue
                    except Exception as e:
                        print(f"Failed to load existing metadata for {pdf_file}: {e}")
                
                # Extract text and create new metadata
                #logger.info(f"Processing new PDF: {pdf_file}")
                try:
                    pdf_text = extract_text(filepath)
                    sentences = extract_sentences_from_pdf(pdf_text)

                    # Create metadata (without sentences to keep it light)
                    metadata = {
                        'document_id': doc_id,
                        'filename': pdf_file,
                        'filepath': filepath,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences),
                        'processed_at': time.time(),
                        'file_size': file_stat.st_size,
                        'last_modified': file_stat.st_mtime,
                        'base_name': base_name
                    }
                    
                    # Save metadata to uploads folder
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
                    # Save sentences to uploads folder
                    with open(sentences_file, 'w', encoding='utf-8') as f:
                        json.dump(sentences, f, indent=2, ensure_ascii=False)

                    uploaded_docs.append(metadata)
                    #logger.info(f"Successfully processed {pdf_file} - saved metadata and sentences to uploads folder")
                    
                except Exception as text_error:
                    #logger.error(f"Failed to extract text from {pdf_file}: {text_error}")
                    continue
                
            except Exception as e:
                #logger.error(f"Error processing {pdf_file}: {e}")
                continue
    
    except Exception as e:
        print(f"Error scanning upload folder: {e}")
    
    return uploaded_docs

# Add this new route for static PDF serving
@main.route('/static/pdfs/<filename>')
def serve_static_pdf(filename):
    """Serve PDFs from static folder"""
    try:
        static_pdf_dir = os.path.join(current_app.root_path, 'static', 'pdfs')
        return send_from_directory(static_pdf_dir, filename)
    except Exception as e:
        #logger.error(f"Error serving static PDF {filename}: {e}")
        return jsonify({'error': 'PDF not found'}), 404

# Updated upload_document function
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
        sentences = extract_sentences_from_pdf(pdf_text)
        
        # Generate document ID
        file_stat = os.stat(filepath)
        doc_id = generate_content_hash(f"{filename}_{file_stat.st_size}_{file_stat.st_mtime}", "doc_")
        
        # Get base name without extension
        base_name = filename.rsplit('.', 1)[0] if '.' in filename else filename
        
        # Create metadata
        metadata = {
            'document_id': doc_id,
            'filename': filename,
            'filepath': filepath,
            'text_length': len(pdf_text),
            'sentence_count': len(sentences),
            'is_preloaded': False,
            'processed_at': time.time(),
            'file_size': file_stat.st_size,
            'last_modified': file_stat.st_mtime,
            'base_name': base_name
        }
        
        # Save metadata to uploads folder (alongside the PDF)
        metadata_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{base_name}_metadata.json")
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        # Save sentences to uploads folder (alongside the PDF)
        sentences_path = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{base_name}_sentences.json")
        with open(sentences_path, 'w', encoding='utf-8') as f:
            json.dump(sentences, f, indent=2, ensure_ascii=False)
        
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
        
        #logger.info(f"Successfully uploaded {filename} - saved metadata and sentences to uploads folder")
        
        return jsonify({
            'success': True,
            'document_id': doc_id,
            'filename': filename,
            'text_length': len(pdf_text),
            'sentence_count': len(sentences),
            'message': 'Document uploaded and processed successfully'
        })
        
    except Exception as e:
        #logger.error(f"Error uploading document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Updated load_preloaded_document function
@main.route('/documents/preloaded/<document_id>', methods=['POST'])
def load_preloaded_document(document_id):
    """Load a preloaded document for use with enhanced error handling"""
    try:
        user_session_id = get_or_create_user_session()
        
        # Find the document in our scanned results
        preloaded_docs = scan_preload_folder_for_pdfs()
        target_doc = None
        
        for doc in preloaded_docs:
            if doc['document_id'] == document_id:
                target_doc = doc
                break
        
        if not target_doc:
            #logger.error(f"Preloaded document {document_id} not found in scan results")
            return jsonify({
                'success': False,
                'error': f'Preloaded document {document_id} not found',
                'available_documents': [doc['document_id'] for doc in preloaded_docs]
            }), 404
        
        # Verify the file actually exists
        if not os.path.exists(target_doc['filepath']):
            #logger.error(f"PDF file does not exist: {target_doc['filepath']}")
            return jsonify({
                'success': False,
                'error': f'PDF file not found: {target_doc["filename"]}'
            }), 404
        
        # Verify metadata and sentences files exist
        base_name = target_doc.get('base_name', target_doc['filename'].replace('.pdf', ''))
        uploads_dir = current_app.config['UPLOAD_FOLDER']
        
        metadata_path = os.path.join(uploads_dir, f"{base_name}_metadata.json")
        sentences_path = os.path.join(uploads_dir, f"{base_name}_sentences.json")
        
        if not os.path.exists(sentences_path):
            #logger.warning(f"Sentences file missing for {document_id}, will regenerate")
            # Regenerate if missing
            try:
                pdf_text = extract_text(target_doc['filepath'])
                sentences = extract_sentences_from_pdf(pdf_text)
                
                # Save sentences
                with open(sentences_path, 'w', encoding='utf-8') as f:
                    json.dump(sentences, f, indent=2, ensure_ascii=False)
                
                # Update metadata
                target_doc['sentence_count'] = len(sentences)
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(target_doc, f, indent=2, ensure_ascii=False)
                    
                #logger.info(f"Regenerated sentences for {document_id}")
                
            except Exception as e:
                #logger.error(f"Failed to regenerate sentences for {document_id}: {e}")
                return jsonify({
                    'success': False,
                    'error': f'Failed to process preloaded document: {str(e)}'
                }), 500
        
        # Log the preloaded document access
        log_user_study_event({
            'event_type': 'preloaded_document_loaded',
            'user_session_id': user_session_id,
            'document_id': document_id,
            'filename': target_doc['filename'],
            'text_length': target_doc.get('text_length', 0),
            'sentence_count': target_doc.get('sentence_count', 0),
            'timestamp': time.time()
        })
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'filename': target_doc['filename'],
            'text_length': target_doc.get('text_length', 0),
            'sentence_count': target_doc.get('sentence_count', 0),
            'message': f'Preloaded document {target_doc["filename"]} loaded successfully'
        })
        
    except Exception as e:
        #logger.error(f"Error loading preloaded document {document_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Helper function to clean up old data files (optional cleanup)
def cleanup_old_result_data_files():
    """Clean up old document data files from results directory"""
    try:
        if not os.path.exists(RESULT_DIR):
            return
            
        # Remove old *_data.json files from results directory
        for file in os.listdir(RESULT_DIR):
            if file.endswith('_data.json'):
                old_file_path = os.path.join(RESULT_DIR, file)
                try:
                    os.remove(old_file_path)
                    #logger.info(f"Cleaned up old data file: {file}")
                except Exception as e:
                    print(f"Failed to remove old data file {file}: {e}")
                    
    except Exception as e:
        print(f"Error during cleanup: {e}")


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
    
@main.route('/debug/document/<document_id>', methods=['GET'])
def debug_document(document_id):
    """Debug endpoint to check document status"""
    try:
        doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
        
        debug_info = {
            'document_id': document_id,
            'result_dir': RESULT_DIR,
            'doc_data_path': doc_data_path,
            'doc_data_exists': os.path.exists(doc_data_path),
            'result_dir_exists': os.path.exists(RESULT_DIR),
            'result_dir_contents': []
        }
        
        if os.path.exists(RESULT_DIR):
            try:
                debug_info['result_dir_contents'] = [
                    f for f in os.listdir(RESULT_DIR) 
                    if f.startswith(document_id)
                ]
            except Exception as e:
                debug_info['result_dir_error'] = str(e)
        
        # Check preloaded documents
        try:
            preloaded_docs = scan_upload_folder_for_pdfs()
            matching_preloaded = [
                doc for doc in preloaded_docs 
                if doc['document_id'] == document_id
            ]
            debug_info['matching_preloaded'] = matching_preloaded
            debug_info['total_preloaded'] = len(preloaded_docs)
        except Exception as e:
            debug_info['preloaded_error'] = str(e)
        
        if os.path.exists(doc_data_path):
            try:
                with open(doc_data_path, 'r', encoding='utf-8') as f:
                    doc_data = json.load(f)
                debug_info['doc_data_sample'] = {
                    k: v for k, v in doc_data.items() 
                    if k != 'sentences'  # Don't include full sentences in debug
                }
                debug_info['sentences_count'] = len(doc_data.get('sentences', []))
            except Exception as e:
                debug_info['doc_data_read_error'] = str(e)
        
        return jsonify(debug_info)
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'document_id': document_id
        }), 500
    
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


@main.route('/documents/<document_id>/pdf', methods=['GET'])
def serve_document_pdf(document_id):
    """Serve PDF - copy to static folder if needed"""
    try:
        #logger.info(f"🔍 PDF request for document: {document_id}")
        
        # Find document data
        doc_data = find_document_data(document_id)
        if not doc_data:
            #logger.error(f"❌ Document {document_id} not found")
            return jsonify({'error': 'Document not found'}), 404
        
        filepath = doc_data.get('filepath')
        filename = doc_data.get('filename')
        
        if not filepath or not filename:
            return jsonify({'error': 'PDF file path not found'}), 404
        
        # Create static PDFs directory
        static_pdf_dir = os.path.join(current_app.root_path, 'static', 'pdfs')
        os.makedirs(static_pdf_dir, exist_ok=True)
        
        # Copy PDF to static folder if it doesn't exist
        static_pdf_path = os.path.join(static_pdf_dir, filename)
        
        if not os.path.exists(static_pdf_path):
            #logger.info(f"📄 Copying PDF to static folder: {filename}")
            
            # Ensure source file exists and is absolute
            if not os.path.isabs(filepath):
                source_path = os.path.abspath(filepath)
            else:
                source_path = filepath
                
            if not os.path.exists(source_path):
                return jsonify({'error': f'Source PDF not found: {source_path}'}), 404
                
            # Copy file
            import shutil
            shutil.copy2(source_path, static_pdf_path)
            #logger.info(f"✅ PDF copied to static folder")
        
        # Serve from static folder
        return send_from_directory(static_pdf_dir, filename, 
                                 mimetype='application/pdf',
                                 as_attachment=False)
        
    except Exception as e:
        #logger.error(f"💥 Error serving PDF: {e}")
        return jsonify({'error': f'PDF serving error: {str(e)}'}), 500

# Also add this helper function to find document data more reliably
def find_document_data(document_id):
    """Find document data by ID with enhanced fallback strategies"""
    # Strategy 1: Check result directory for document data
    doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
    if os.path.exists(doc_data_path):
        try:
            with open(doc_data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                #logger.info(f"✅ Found document data in results: {doc_data_path}")
                return data
        except Exception as e:
            print(f"❌ Error reading document data from results: {e}")
            
    
    # Strategy 2: Check if it's a preloaded document
    try:
        preloaded_docs = scan_upload_folder_for_pdfs()
        for doc in preloaded_docs:
            if doc.get('document_id') == document_id:
                #logger.info(f"✅ Found document in preloaded scan")
                return doc
    except Exception as e:
        print(f"❌ Error scanning preloaded documents: {e}")
    
    #logger.error(f"❌ Document {document_id} not found anywhere")
    return None
    
@main.route('/debug/document-data/<document_id>', methods=['GET'])
def debug_document_data(document_id):
    """Debug endpoint to check document data structure"""
    try:
        doc_data = find_document_data(document_id)
        
        if not doc_data:
            return jsonify({
                'error': 'Document not found',
                'document_id': document_id,
                'result_dir': RESULT_DIR,
                'files_in_result_dir': os.listdir(RESULT_DIR) if os.path.exists(RESULT_DIR) else []
            })
        
        # Safe document data (without full sentences)
        safe_doc_data = {k: v for k, v in doc_data.items() if k != 'sentences'}
        
        return jsonify({
            'document_id': document_id,
            'doc_data': safe_doc_data,
            'filepath_exists': os.path.exists(doc_data.get('filepath', '')) if doc_data.get('filepath') else False,
            'filepath': doc_data.get('filepath', 'NO_FILEPATH'),
            'upload_folder': current_app.config.get('UPLOAD_FOLDER'),
            'upload_folder_contents': os.listdir(current_app.config['UPLOAD_FOLDER']) if os.path.exists(current_app.config['UPLOAD_FOLDER']) else []
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'document_id': document_id
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

@main.route('/documents/<document_id>/text', methods=['GET'])
def get_document_text(document_id):
    """Get the full text of a document with enhanced preloaded support"""
    try:
        doc_data_path = os.path.join(RESULT_DIR, f"{document_id}_data.json")
        
        if not os.path.exists(doc_data_path):
            # Try to find it in preloaded documents
            preloaded_docs = scan_preload_folder_for_pdfs()
            target_doc = None
            
            for doc in preloaded_docs:
                if doc['document_id'] == document_id:
                    target_doc = doc
                    break
            

            if not target_doc:
                return jsonify({'error': 'Document not found'}), 404
            
            # Load the preloaded document
            try:
                pdf_text = extract_text(target_doc['filepath'])
                
                return jsonify({
                    'success': True,
                    'document_id': document_id,
                    'text': pdf_text,
                    'source': 'preloaded_direct'
                })
            except Exception as e:
                return jsonify({
                    'success': False,
                    'error': f'Failed to extract text from preloaded document: {str(e)}'
                }), 500
        
        # Load from existing document data
        with open(doc_data_path, 'r', encoding='utf-8') as f:
            doc_data = json.load(f)
        
        # Extract text from the PDF file
        filepath = doc_data['filepath']
        if not os.path.exists(filepath):
            return jsonify({'error': 'PDF file not found'}), 404
        
        pdf_text = extract_text(filepath)
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'text': pdf_text,
            'source': 'document_data'
        })
        
    except Exception as e:
        #logger.error(f"Error getting document text for {document_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
def scan_preload_folder_for_pdfs():
    """Scan the preload folder for PDF files and create/load document metadata"""
    uploads_dir = current_app.config['PRELOAD_FOLDER']
    preloaded_docs = []
    
    try:
        # Ensure preload directory exists
        if not os.path.exists(uploads_dir):
            #logger.warning(f"Preload directory does not exist: {uploads_dir}")
            return []
        
        # Get all PDF files in the preload directory
        pdf_files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
        
        #logger.info(f"Found {len(pdf_files)} PDF files in preload folder")
        
        for pdf_file in pdf_files:
            try:
                filepath = os.path.join(uploads_dir, pdf_file)

                # Verify file actually exists before processing
                if not os.path.exists(filepath):
                    #logger.warning(f"PDF file listed but not found: {filepath}")
                    continue
                
                # Get base name without extension
                base_name = pdf_file.replace('.pdf', '')
                metadata_file = os.path.join(uploads_dir, f"{base_name}_metadata.json")
                sentences_file = os.path.join(uploads_dir, f"{base_name}_sentences.json")
                
                # Generate consistent document ID
                file_stat = os.stat(filepath)
                doc_id = generate_content_hash(f"{pdf_file}_{file_stat.st_size}_{file_stat.st_mtime}", "preloaded_")
                
                # Check if we already have processed this file
                if os.path.exists(metadata_file) and os.path.exists(sentences_file):
                    # Load existing metadata
                    try:
                        with open(metadata_file, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # Update document ID and filepath in case it changed
                        metadata['document_id'] = doc_id
                        metadata['filepath'] = filepath
                        
                        # Verify the PDF file still exists
                        if os.path.exists(filepath):
                            preloaded_docs.append(metadata)
                            #logger.info(f"Loaded existing metadata for {pdf_file}")
                        else:
                            print(f"Metadata exists but PDF file missing: {filepath}")
                        continue
                    except Exception as e:
                        print(f"Failed to load existing metadata for {pdf_file}: {e}")
                
                # Extract text and create new metadata
                #logger.info(f"Processing new PDF: {pdf_file}")
                try:
                    pdf_text = extract_text(filepath)
                    sentences = extract_sentences_from_pdf(pdf_text)

                    # Create metadata (without sentences to keep it light)
                    metadata = {
                        'document_id': doc_id,
                        'filename': pdf_file,
                        'filepath': filepath,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences),
                        'is_preloaded': True,
                        'processed_at': time.time(),
                        'file_size': file_stat.st_size,
                        'last_modified': file_stat.st_mtime,
                        'base_name': base_name
                    }
                    
                    # Save metadata to preload folder
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, indent=2, ensure_ascii=False)
                    
                    # Save sentences to preload folder
                    with open(sentences_file, 'w', encoding='utf-8') as f:
                        json.dump(sentences, f, indent=2, ensure_ascii=False)

                    preloaded_docs.append(metadata)
                    #logger.info(f"Successfully processed {pdf_file} - saved metadata and sentences to preload folder")
                    
                except Exception as text_error:
                    #logger.error(f"Failed to extract text from {pdf_file}: {text_error}")
                    continue
                
            except Exception as e:
                #logger.error(f"Error processing {pdf_file}: {e}")
                continue
    
    except Exception as e:
        print(f"Error scanning preload folder: {e}")
    
    return preloaded_docs


@main.route('/documents/preloaded', methods=['GET'])
def get_preloaded_documents():
    """Get list of available preloaded documents by scanning preload folder"""
    try:
        preloaded_docs = scan_preload_folder_for_pdfs()
        return jsonify({'success': True,
                       'documents': preloaded_docs}), 200
    except Exception as e:
        #logger.error(f"Error getting preloaded documents: {e}")
        return jsonify({'error': 'Failed to load preloaded documents'}), 500



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
        #logger.error(f"Error creating session: {e}")
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
        #logger.error(f"Error getting session: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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
        #logger.error(f"Error getting processing results: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
@main.route('/documents/<document_id>/sentences', methods=['GET'])
def get_document_sentences(document_id):
    """Get sentences for a document - optimized for frontend sentence-based rendering"""
    try:
        doc_data = find_document_data(document_id)
        if not doc_data:
            return jsonify({'error': 'Document not found'}), 404
        
        sentences = doc_data.get('sentences', [])
        
        # Get optional sentence range parameters
        start_idx = request.args.get('start', type=int)
        end_idx = request.args.get('end', type=int)
        
        if start_idx is not None or end_idx is not None:
            # Return a slice of sentences
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
                'filename': doc_data.get('filename', 'Unknown')
            })
        else:
            # Return all sentences
            return jsonify({
                'success': True,
                'document_id': document_id,
                'sentences': sentences,
                'total_sentences': len(sentences),
                'filename': doc_data.get('filename', 'Unknown')
            })
        
    except Exception as e:
        #logger.error(f"Error getting document sentences for {document_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/documents/<document_id>/sentences/<int:sentence_id>', methods=['GET'])
def get_specific_sentence(document_id, sentence_id):
    """Get a specific sentence by ID"""
    try:
        doc_data = find_document_data(document_id)
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
        doc_data = find_document_data(document_id)
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

def find_document_data(document_id):
    """Find document data by ID from uploads or preloaded folders"""
    
    # Strategy 1: Check preloaded documents
    if os.path.exists(PRELOAD_DIR):
        for item in os.listdir(PRELOAD_DIR):
            if item.endswith('_metadata.json'):
                try:
                    metadata_path = os.path.join(PRELOAD_DIR, item)
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                    
                    if metadata.get('document_id') == document_id:
                        # Load sentences
                        base_name = item.replace('_metadata.json', '')
                        sentences_path = os.path.join(PRELOAD_DIR, f"{base_name}_sentences.json")
                        
                        if os.path.exists(sentences_path):
                            with open(sentences_path, 'r', encoding='utf-8') as f:
                                sentences = json.load(f)
                            metadata['sentences'] = sentences
                        
                        #logger.info(f"✅ Found preloaded document: {base_name}")
                        return metadata
                except Exception as e:
                    print(f"Error reading preloaded metadata {item}: {e}")
    
    # Strategy 2: Check uploaded documents
    uploads_dir = current_app.config['UPLOAD_FOLDER']
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
                        
                        #logger.info(f"✅ Found uploaded document: {base_name}")
                        return metadata
                except Exception as e:
                    print(f"Error reading uploaded metadata {item}: {e}")
    print(f"❌ Document {document_id} not found in uploads or preloaded directories")
    return None

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


# yash_code below:

@main.route('/ask', methods=['POST'])
def ask_question():
    data = request.json
    question = data.get('question')
    filename = data.get('filename')
    
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
    # Get PDF data
    pdf_data_path = os.path.join(RESULT_DIR, f"{filename.split('.')[0]}_data.json")
    try:
        with open(pdf_data_path, 'r') as f:
            pdf_data = json.load(f)
    except FileNotFoundError:
        return jsonify({'error': 'PDF data not found'}), 404
    
    filepath = pdf_data.get('filepath')
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'PDF file not found'}), 404
    
    # Extract text from PDF
    pdf_text = extract_text(filepath)
    
    # Create result path for this question
    question_id = str(int(time.time()))
    result_path = os.path.join(RESULT_DIR, question_id)
    os.makedirs(result_path, exist_ok=True)
    
    # Save sentences for later
    sentences_path = os.path.join(result_path, 'sentences.json')
    with open(sentences_path, 'w') as f:
        json.dump(pdf_data.get('sentences', []), f)
    
    # DO NOT initialize the provenance file with an empty array
    # The doc_provenance function will create and write to this file
    
    # Initialize process logs
    logs_path = os.path.join(result_path, 'process_logs.json')
    logs = {
        'status': 'started',
        'logs': [f"[{time.strftime('%H:%M:%S')}] Processing started: {question}"],
        'timestamp': time.time()
    }
    with open(logs_path, 'w') as f:
        json.dump(logs, f)
    
    # Start processing in a separate thread
    from threading import Thread
    def process_question():
        try:
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
                
                # Extract provenance information from the output
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
                                    
                                    #logger.info(f"Found provenance {prov_id} with IDs: {prov_ids}")
                                    
                                    current_entry = {
                                        "provenance_id": prov_id,
                                        "sentences_ids": prov_ids,
                                        "time": 0,
                                        "input_token_size": 0,
                                        "output_token_size": 0
                                    }
                            except Exception as e:
                                #logger.error(f"Error parsing provenance line '{line}': {str(e)}")
                                # If we can't parse the line properly, just skip it
                                pass
                        
                        # Parse time information
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
                
                # Write the processed provenance entries to a new file
                provenance_path = os.path.join(result_path, 'provenance.json')
                with open(provenance_path, 'w') as f:
                    json.dump(provenance_entries, f, indent=2)
                    
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
            finally:
                # Restore stdout
                sys.stdout = stdout_backup
                
        except Exception as e:
            #logger.exception("Error processing question")
            update_process_log(question_id, f"Error: {str(e)}", status="error")
    
    thread = Thread(target=process_question)
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'question_id': question_id,
        'message': 'Processing started'
    })

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
    
    #logger.info(f"Question {question_id}: {message}")

@main.route('/results/<question_id>', methods=['GET'])
def get_results(question_id):
    # Check if the provenance file exists
    provenance_path = os.path.join(RESULT_DIR, question_id, 'provenance.json')
    if not os.path.exists(provenance_path):
        return jsonify({'error': 'Results not found'}), 404
    
    # Read the provenance file
    with open(provenance_path, 'r') as f:
        data = json.load(f)
    
    # Check if there's an answer file
    answer_path = os.path.join(RESULT_DIR, question_id, 'answers.txt')
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
        with open(provenance_path, 'r') as f:
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
    with open(sentences_path, 'r') as f:
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
