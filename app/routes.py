import os
import json
import time
import logging
import sys
from io import StringIO
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text
import doc_provenance

main = Blueprint('main', __name__)

RESULT_DIR = os.path.join(os.getcwd(), 'app/results')
os.makedirs(RESULT_DIR, exist_ok=True)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        sentences = extract_sentences_from_pdf(pdf_text)
        
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
                                    
                                    logger.info(f"Found provenance {prov_id} with IDs: {prov_ids}")
                                    
                                    current_entry = {
                                        "provenance_id": prov_id,
                                        "sentences_ids": prov_ids,
                                        "time": 0,
                                        "input_token_size": 0,
                                        "output_token_size": 0
                                    }
                            except Exception as e:
                                logger.error(f"Error parsing provenance line '{line}': {str(e)}")
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