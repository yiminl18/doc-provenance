import doc_provenance, json, logging, os, random, sys, time, traceback, subprocess, tempfile
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

# =============================================================================

# Create directories
for directory in [RESULT_DIR, UPLOAD_DIR, STUDY_LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_algorithm_in_separate_process(question, pdf_text, result_path, question_id):
    """
    Run the doc_provenance algorithm in a completely separate Python process
    to avoid global variable contamination between requests.
    """
    try:
        # Create a temporary Python script that will run the algorithm
        script_content = f'''
import sys
import os
import json
import time
from io import StringIO

# Add the current working directory to Python path to ensure imports work
sys.path.insert(0, "{os.getcwd()}")

try:
    import doc_provenance
    
    # The question and result path
    question = """{question}"""
    pdf_text = """{pdf_text.replace('"""', '\\"""')}"""
    result_path = """{result_path}"""
    
    print("ALGORITHM_PROCESS: Starting algorithm execution")
    print(f"ALGORITHM_PROCESS: Question length: {{len(question)}} chars")
    print(f"ALGORITHM_PROCESS: PDF text length: {{len(pdf_text)}} chars")
    print(f"ALGORITHM_PROCESS: Result path: {{result_path}}")
    
    # Capture stdout to get the provenance output
    stdout_buffer = StringIO()
    stdout_backup = sys.stdout
    sys.stdout = stdout_buffer
    
    try:
        # Run the algorithm - this will have fresh global variables
        doc_provenance.divide_and_conquer_progressive_API(question, pdf_text, result_path)
        
        # Get the captured output
        output = stdout_buffer.getvalue()
        
        print("ALGORITHM_PROCESS: Algorithm execution completed")
        print(f"ALGORITHM_PROCESS: Output length: {{len(output)}} chars")
        
        # Write the raw output to a file for the main process to parse
        output_file = os.path.join(result_path, 'algorithm_output.txt')
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(output)
        
        # Write a success marker
        success_file = os.path.join(result_path, 'algorithm_success.json')
        with open(success_file, 'w') as f:
            json.dump({{"success": True, "timestamp": time.time()}}, f)
        
        print("ALGORITHM_PROCESS: Output saved successfully")
        
    finally:
        # Restore stdout
        sys.stdout = stdout_backup
    
except Exception as e:
    import traceback
    
    # Write error information
    error_file = os.path.join("{result_path}", 'algorithm_error.json')
    with open(error_file, 'w') as f:
        json.dump({{
            "error": str(e),
            "traceback": traceback.format_exc(),
            "timestamp": time.time()
        }}, f)
    
    print(f"ALGORITHM_PROCESS: Error occurred: {{str(e)}}")
    sys.exit(1)

print("ALGORITHM_PROCESS: Process completed successfully")
'''
        
        # Write the script to a temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as temp_script:
            temp_script.write(script_content)
            temp_script_path = temp_script.name
        
        update_process_log(question_id, "Starting algorithm in isolated process...")
        
        # Run the script in a separate Python process
        try:
            result = subprocess.run(
                [sys.executable, temp_script_path],
                capture_output=True,
                text=True,
                timeout=PROCESSING_TIMEOUT,
                cwd=os.getcwd()
            )
            
            update_process_log(question_id, f"Algorithm process completed with return code: {result.returncode}")
            
            if result.stdout:
                for line in result.stdout.strip().split('\\n'):
                    if line.strip():
                        update_process_log(question_id, f"STDOUT: {line.strip()}")
            
            if result.stderr:
                for line in result.stderr.strip().split('\\n'):
                    if line.strip():
                        update_process_log(question_id, f"STDERR: {line.strip()}")
            
            # Check if the algorithm succeeded
            success_file = os.path.join(result_path, 'algorithm_success.json')
            error_file = os.path.join(result_path, 'algorithm_error.json')
            
            if os.path.exists(error_file):
                with open(error_file, 'r') as f:
                    error_data = json.load(f)
                raise Exception(f"Algorithm process failed: {error_data['error']}")
            
            if not os.path.exists(success_file):
                raise Exception("Algorithm process did not complete successfully")
            
            # Read and parse the algorithm output
            output_file = os.path.join(result_path, 'algorithm_output.txt')
            if os.path.exists(output_file):
                with open(output_file, 'r', encoding='utf-8') as f:
                    algorithm_output = f.read()
                
                update_process_log(question_id, f"Processing algorithm output ({len(algorithm_output)} chars)...")
                
                # Parse the output using the existing function
                provenance_entries = parse_provenance_output(algorithm_output, question_id)
                
                return provenance_entries
            else:
                raise Exception("Algorithm output file not found")
                
        except subprocess.TimeoutExpired:
            update_process_log(question_id, f"Algorithm process timed out after {PROCESSING_TIMEOUT} seconds", status="error")
            raise ProcessingTimeoutError(f"Processing timed out after {PROCESSING_TIMEOUT} seconds")
        
        except subprocess.CalledProcessError as e:
            update_process_log(question_id, f"Algorithm process failed with code {e.returncode}", status="error")
            raise Exception(f"Algorithm process failed: {e}")
        
    finally:
        # Clean up the temporary script file
        try:
            if 'temp_script_path' in locals():
                os.unlink(temp_script_path)
        except:
            pass

def get_all_available_pdfs():
    """Scan both upload and preload folders and return all PDFs with unified metadata"""
    all_documents = []
    
    # Check uploads folder
    uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
    if os.path.exists(uploads_dir):
        all_documents.extend(scan_folder_for_pdfs(uploads_dir, is_preloaded=False))
    
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

                    metadata = {
                        'filename': pdf_file,
                        'filepath': filepath,
                        'text_length': len(pdf_text),
                        'sentence_count': len(sentences),
                        'is_preloaded': is_preloaded,
                        'source_folder': 'preloaded' if is_preloaded else 'uploads',
                        'processed_at': time.time(),
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

@main.route('/documents', methods=['GET'])
def get_available_documents():
    """Get all available documents from both upload and preload folders"""
    try:
        all_documents = get_all_available_pdfs()
        
        # Separate for UI purposes but same underlying logic
        uploaded_docs = [doc for doc in all_documents if not doc.get('is_preloaded', False)]
        
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
    
# Add this to your routes.py file

@main.route('/documents/<filename>/sentences', methods=['GET'])
def get_document_sentences(filename):
    """Get sentences for a specific document"""
    try:
        # Remove .pdf extension if present and add _sentences.json
        base_filename = filename.replace('.pdf', '')
        sentences_filename = f"{base_filename}_sentences.json"
        sentences_path = os.path.join(current_app.config['UPLOAD_FOLDER'], sentences_filename)
        
        if not os.path.exists(sentences_path):
            return jsonify({'error': 'Sentences file not found'}), 404
        
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        return jsonify({
            'success': True,
            'sentences': sentences_data,
            'filename': sentences_filename
        })
        
    except Exception as e:
        logger.error(f"Error loading sentences for {filename}: {e}")
        return jsonify({'error': f'Failed to load sentences: {str(e)}'}), 500

# Alternative endpoint that matches your PDF viewer's expected format
@main.route('/documents/<filename>/sentences', methods=['GET']) 
def get_sentences_by_doc_id(filename):
    """Get sentences by document ID (for PDF viewer compatibility)"""
    try:
        # Try to find the sentences file by matching the doc_id to a filename
        uploads_dir = current_app.config['UPLOAD_FOLDER']

        # Extract the base name to see if it matches our doc_id pattern
        base_name = filename.replace('.pdf', '_sentences.json')
        


        sentences_path = os.path.join(uploads_dir, base_name)
         
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
         
        return jsonify({
            'success': True,
            'sentences': sentences_data,
            'source_file': filename
        })
        
        
    except Exception as e:
        logger.error(f"Error loading sentences for doc_id {filename}: {e}")
        return jsonify({'error': f'Failed to load sentences: {str(e)}'}), 500

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']

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
        from doc_provenance.base_strategies import extract_sentences_from_pdf
        sentences = extract_sentences_from_pdf(filepath)
        
        # Store PDF text and sentences in session or temporary file
        pdf_data_path = os.path.join(RESULT_DIR, f"{filename.split('.')[0]}_data.json")
        with open(pdf_data_path, 'w') as f:
            json.dump({
                'filename': filename,
                'filepath': filepath,
                'text_length': len(pdf_text),
                'sentences': sentences
            }, f)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'message': 'File uploaded successfully'
        })
    
    return jsonify({'error': 'File type not allowed'}), 400



@main.route('/ask', methods=['POST'])
def ask_question():
    data = request.json
    question = data.get('question')
    filename = data.get('filename')
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
    sentence_name = filename.replace('.pdf', '_sentences.json')
    sentences_path = os.path.join(UPLOAD_DIR, sentence_name)
    
    # Read sentences
    with open(sentences_path, 'r', encoding='utf-8') as f:
        sentences = json.load(f)
    
    # Get PDF data
    filepath = os.path.join(UPLOAD_DIR, f"{filename}")
    print(f"Processing question for file: {filepath}")
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'PDF file not found'}), 404
    
    # Extract text from PDF
    pdf_text = extract_text(filepath)

    # Create result path for this question
    question_id = str(int(time.time()))
    result_path = os.path.join(RESULT_DIR, question_id)
    os.makedirs(result_path, exist_ok=True)
    
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
    def process_question():
        try:
            # Add log entry
            update_process_log(question_id, f"Analyzing document with {len(pdf_text)} characters...")
            
            # Use the new process isolation function instead of direct algorithm call
            provenance_entries = run_algorithm_in_separate_process(question, pdf_text, result_path, question_id)
            
            # Write the processed provenance entries to a new file
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
                
        except Exception as e:
            logger.exception("Error processing question")
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
    answer_file = os.path.join(question_dir, 'answers.txt')
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

def parse_provenance_output(output, question_id):
    """Parse provenance output and save progressively"""
    provenance_entries = []
    current_entry = None
    processed_count = 0
    
    for line in output.strip().split('\n'):
        if line.strip():
            update_process_log(question_id, line.strip())
            
            # Parse Top-X provenance lines
            if line.startswith('Top-'):
                if current_entry is not None:
                    provenance_entries.append(current_entry)
                    processed_count += 1

                 # Safety limit to prevent infinite processing
                if processed_count >= MAX_PROVENANCE_PROCESSING:
                    update_process_log(question_id, f"Reached maximum processing limit of {MAX_PROVENANCE_PROCESSING} provenances.")
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
                    provenance_file = os.path.join(RESULT_DIR, question_id, 'provenance.json')
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