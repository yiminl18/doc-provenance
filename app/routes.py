import doc_provenance, json, logging, os, random, sys, time, traceback, subprocess, tempfile, signal, threading
from datetime import datetime, timedelta
from io import StringIO
from flask import Blueprint, render_template, request, jsonify, current_app, send_from_directory, send_file
from threading import Thread, Timer
from werkzeug.utils import secure_filename
from pdfminer.high_level import extract_text
from typing import Dict, Optional
from dataclasses import dataclass
from enum import Enum
import doc_provenance.base_strategies

main = Blueprint('main', __name__)

# Configuration
PROCESSING_TIMEOUT = 90  # 1.5 minutes timeout for processing
EXPERIMENT_TOP_K = 5  # User-facing limit for this experiment
MAX_PROVENANCE_PROCESSING = 20  # Internal limit to prevent infinite processing

class ProcessingTimeoutError(Exception):
    """Custom timeout exception for processing"""
    pass

class ProcessStatus(Enum):
    STARTING = "starting"
    RUNNING = "running" 
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    KILLED = "killed"

@dataclass
class AlgorithmProcess:
    question_id: str
    process: subprocess.Popen
    start_time: float
    timeout_timer: Timer
    status: ProcessStatus = ProcessStatus.STARTING
    result_path: str = ""

class AlgorithmProcessManager:
    """Enhanced process manager with better timeout and cleanup handling"""
    
    def __init__(self, max_concurrent=3, default_timeout=PROCESSING_TIMEOUT):
        self.active_processes: Dict[str, AlgorithmProcess] = {}
        self.max_concurrent = max_concurrent
        self.default_timeout = default_timeout
        self._lock = threading.Lock()
    
    def can_start_process(self) -> bool:
        """Check if we can start a new process"""
        with self._lock:
            return len(self.active_processes) < self.max_concurrent
    
    def start_algorithm(self, question_id: str, question: str, 
                       pdf_text: str, result_path: str, 
                       timeout: Optional[int] = None) -> bool:
        """Start algorithm in isolated subprocess"""
        if not self.can_start_process():
            raise RuntimeError(f"Maximum concurrent processes reached ({self.max_concurrent})")
        
        timeout = timeout or self.default_timeout
        
        try:
            # Create the isolated algorithm runner script
            script_content = self._create_algorithm_script()
            
            # Prepare input data
            input_data = {
                'question': question,
                'pdf_text': pdf_text,
                'result_path': result_path,
                'question_id': question_id,
                'cwd': os.getcwd()
            }
            
            # Create temporary files
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', 
                                           delete=False, encoding='utf-8') as script_file:
                script_file.write(script_content)
                script_path = script_file.name
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', 
                                           delete=False, encoding='utf-8') as input_file:
                json.dump(input_data, input_file, ensure_ascii=False)
                input_path = input_file.name
            
            update_process_log(question_id, f"Starting algorithm process with timeout: {timeout}s")
            
            # Start subprocess with proper isolation
            process = subprocess.Popen(
                [sys.executable, script_path, input_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=os.getcwd(),
                # Create new process group for better cleanup
                preexec_fn=os.setsid if hasattr(os, 'setsid') else None
            )
            
            # Set up timeout handling
            def timeout_handler():
                self._handle_timeout(question_id)
            
            timeout_timer = Timer(timeout, timeout_handler)
            timeout_timer.start()
            
            # Track the process
            algo_process = AlgorithmProcess(
                question_id=question_id,
                process=process,
                start_time=time.time(),
                timeout_timer=timeout_timer,
                status=ProcessStatus.RUNNING,
                result_path=result_path
            )
            
            with self._lock:
                self.active_processes[question_id] = algo_process
            
            # Start monitoring thread
            threading.Thread(
                target=self._monitor_process, 
                args=[question_id], 
                daemon=True
            ).start()
            
            # Clean up temp files
            self._cleanup_temp_files(script_path, input_path)
            
            update_process_log(question_id, "Algorithm process started successfully")
            return True
            
        except Exception as e:
            self._cleanup_temp_files(script_path, input_path)
            update_process_log(question_id, f"Failed to start process: {e}", status="error")
            raise e
    
    def _create_algorithm_script(self) -> str:
        """Create the isolated algorithm runner script"""
        return '''
import sys
import os
import json
import time
import signal
import threading
import traceback
from io import StringIO

# Signal handlers for graceful shutdown
def signal_handler(signum, frame):
    print(f"ALGORITHM_PROCESS: Received signal {signum}, shutting down gracefully")
    sys.exit(1)

signal.signal(signal.SIGTERM, signal_handler)
if hasattr(signal, 'SIGINT'):
    signal.signal(signal.SIGINT, signal_handler)

# Clear any cached imports to ensure completely fresh state
modules_to_remove = []
for key in sys.modules.keys():
    if 'doc_provenance' in key:
        modules_to_remove.append(key)
for module in modules_to_remove:
    del sys.modules[module]

try:
    # Read input data from JSON file
    input_file = sys.argv[1]
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    question = data['question']
    pdf_text = data['pdf_text']
    result_path = data['result_path']
    question_id = data['question_id']
    cwd = data['cwd']
    
    # Add the current working directory to Python path
    sys.path.insert(0, cwd)
    
    # Enhanced progress monitor with heartbeat
    stop_monitoring = threading.Event()
    
    def progress_monitor():
        counter = 0
        while not stop_monitoring.is_set():
            counter += 1
            progress_file = os.path.join(result_path, 'algorithm_progress.json')
            try:
                with open(progress_file, 'w') as f:
                    json.dump({
                        'alive': True, 
                        'timestamp': time.time(),
                        'heartbeat': counter,
                        'question_id': question_id
                    }, f)
            except Exception as e:
                print(f'ALGORITHM_PROCESS: Progress monitor error: {e}')
            
            # Wait for 5 seconds or until stop event
            stop_monitoring.wait(5)
    
    # Import fresh doc_provenance
    import doc_provenance
    
    # Start progress monitor in background
    monitor_thread = threading.Thread(target=progress_monitor, daemon=True)
    monitor_thread.start()
    
    print(f'ALGORITHM_PROCESS: Starting algorithm execution for question: {question_id}')
    print(f'ALGORITHM_PROCESS: Question length: {len(question)} chars')
    print(f'ALGORITHM_PROCESS: PDF text length: {len(pdf_text)} chars')
    print(f'ALGORITHM_PROCESS: Result path: {result_path}')
    
    # Create intermediate results directory
    os.makedirs(result_path, exist_ok=True)
    
    # Capture stdout to get the provenance output
    stdout_buffer = StringIO()
    stdout_backup = sys.stdout
    
    try:
        sys.stdout = stdout_buffer
        
        print(f'ALGORITHM_PROCESS: Calling doc_provenance.divide_and_conquer_progressive_API...')
        
        # Run the algorithm - this will have fresh global variables
        doc_provenance.divide_and_conquer_progressive_API(question, pdf_text, result_path)
        
        # Get the captured output
        output = stdout_buffer.getvalue()
        
    finally:
        # Always restore stdout
        sys.stdout = stdout_backup
        # Stop the progress monitor
        stop_monitoring.set()
    
    print(f'ALGORITHM_PROCESS: Algorithm execution completed successfully')
    print(f'ALGORITHM_PROCESS: Output length: {len(output)} chars')
    
    # Write the raw output to a file for the main process to parse
    output_file = os.path.join(result_path, 'algorithm_output.txt')
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(output)
    
    # Write completion status
    success_file = os.path.join(result_path, 'algorithm_success.json')
    with open(success_file, 'w') as f:
        json.dump({
            'success': True, 
            'timestamp': time.time(),
            'question_id': question_id,
            'output_length': len(output)
        }, f)
    
    print(f'ALGORITHM_PROCESS: Output and status files saved successfully')
    
except Exception as e:
    import traceback
    
    # Stop monitoring on error
    stop_monitoring.set()
    
    error_details = {
        'error': str(e),
        'traceback': traceback.format_exc(),
        'timestamp': time.time(),
        'question_id': question_id
    }
    
    # Write error information
    error_file = os.path.join(result_path, 'algorithm_error.json')
    with open(error_file, 'w') as f:
        json.dump(error_details, f, indent=2)
    
    print(f'ALGORITHM_PROCESS: Error occurred: {str(e)}')
    print(f'ALGORITHM_PROCESS: Full traceback:')
    print(traceback.format_exc())
    sys.exit(1)

print(f'ALGORITHM_PROCESS: Process completed successfully')
sys.exit(0)
'''
    
    def _monitor_process(self, question_id: str):
        """Monitor process completion"""
        try:
            with self._lock:
                if question_id not in self.active_processes:
                    return
                algo_process = self.active_processes[question_id]
            
            # Wait for process completion
            stdout, stderr = algo_process.process.communicate()
            return_code = algo_process.process.returncode
            
            # Cancel timeout timer
            algo_process.timeout_timer.cancel()
            
            # Log output for debugging
            if stdout:
                update_process_log(question_id, "=== SUBPROCESS STDOUT ===")
                for line in stdout.strip().split('\n'):
                    if line.strip():
                        update_process_log(question_id, f"STDOUT: {line.strip()}")
                update_process_log(question_id, "=== END STDOUT ===")
            
            if stderr:
                update_process_log(question_id, "=== SUBPROCESS STDERR ===")
                for line in stderr.strip().split('\n'):
                    if line.strip():
                        update_process_log(question_id, f"STDERR: {line.strip()}")
                update_process_log(question_id, "=== END STDERR ===")
            
            # Update status based on return code
            if return_code == 0:
                self._update_process_status(question_id, ProcessStatus.COMPLETED)
                update_process_log(question_id, "Algorithm process completed successfully")
                self._process_algorithm_results(question_id)
            else:
                self._update_process_status(question_id, ProcessStatus.FAILED)
                update_process_log(question_id, f"Algorithm process failed with code {return_code}", status="error")
                
        except Exception as e:
            update_process_log(question_id, f"Error monitoring process: {e}", status="error")
            self._update_process_status(question_id, ProcessStatus.FAILED)
        finally:
            # Clean up
            self._cleanup_process(question_id)
    
    def _process_algorithm_results(self, question_id: str):
        """Process the algorithm results and create final provenance file"""
        try:
            with self._lock:
                if question_id not in self.active_processes:
                    return
                algo_process = self.active_processes[question_id]
            
            result_path = algo_process.result_path
            
            # Check for success/error markers
            success_file = os.path.join(result_path, 'algorithm_success.json')
            error_file = os.path.join(result_path, 'algorithm_error.json')
            
            if os.path.exists(error_file):
                with open(error_file, 'r') as f:
                    error_data = json.load(f)
                update_process_log(question_id, f"Algorithm error: {error_data.get('error', 'Unknown error')}", status="error")
                return
            
            if not os.path.exists(success_file):
                update_process_log(question_id, "Algorithm did not complete successfully", status="error")
                return
            
            # Parse the algorithm output
            output_file = os.path.join(result_path, 'algorithm_output.txt')
            if os.path.exists(output_file):
                with open(output_file, 'r', encoding='utf-8') as f:
                    algorithm_output = f.read()
                
                update_process_log(question_id, f"Processing algorithm output ({len(algorithm_output)} chars)...")
                
                # Parse the output using the existing function
                provenance_entries = parse_provenance_output(algorithm_output, question_id)
                
                # Write final provenance file
                provenance_path = os.path.join(result_path, 'provenance.json')
                with open(provenance_path, 'w', encoding='utf-8') as f:
                    json.dump(provenance_entries, f, indent=2, ensure_ascii=False)
                
                # Create final status file
                status_path = os.path.join(result_path, 'status.json')
                with open(status_path, 'w') as f:
                    json.dump({
                        "completed": True,
                        "timestamp": time.time(),
                        "total_provenance": len(provenance_entries)
                    }, f)
                
                update_process_log(question_id, f"Processing completed! Found {len(provenance_entries)} provenance entries", status="completed")
            else:
                update_process_log(question_id, "Algorithm output file not found", status="error")
                
        except Exception as e:
            update_process_log(question_id, f"Error processing results: {e}", status="error")
    
    def _handle_timeout(self, question_id: str):
        """Handle process timeout"""
        try:
            with self._lock:
                if question_id not in self.active_processes:
                    return
                algo_process = self.active_processes[question_id]
            
            update_process_log(question_id, f"⚠️ TIMEOUT: Process exceeded {self.default_timeout}s, killing...", status="timeout")
            
            # Kill process and children
            try:
                # Kill process group
                if hasattr(os, 'killpg'):
                    os.killpg(os.getpgid(algo_process.process.pid), signal.SIGTERM)
                else:
                    algo_process.process.terminate()
                
                # Wait a bit, then force kill if needed
                time.sleep(2)
                if algo_process.process.poll() is None:
                    if hasattr(os, 'killpg'):
                        os.killpg(os.getpgid(algo_process.process.pid), signal.SIGKILL)
                    else:
                        algo_process.process.kill()
                        
            except (ProcessLookupError, OSError):
                pass  # Process already dead
            
            self._update_process_status(question_id, ProcessStatus.TIMEOUT)
            
            # Create error marker file
            error_file = os.path.join(algo_process.result_path, 'algorithm_error.json')
            with open(error_file, 'w') as f:
                json.dump({
                    "error": f"Process timed out after {self.default_timeout} seconds",
                    "timestamp": time.time(),
                    "timeout": True,
                    "question_id": question_id
                }, f)
            
        except Exception as e:
            update_process_log(question_id, f"Error handling timeout: {e}")
        finally:
            self._cleanup_process(question_id)
    
    def _update_process_status(self, question_id: str, status: ProcessStatus):
        """Update process status"""
        with self._lock:
            if question_id in self.active_processes:
                self.active_processes[question_id].status = status
    
    def _cleanup_process(self, question_id: str):
        """Remove process from tracking"""
        with self._lock:
            if question_id in self.active_processes:
                algo_process = self.active_processes[question_id]
                
                # Cancel timer if still active
                if algo_process.timeout_timer.is_alive():
                    algo_process.timeout_timer.cancel()
                
                # Remove from tracking
                del self.active_processes[question_id]
    
    def _cleanup_temp_files(self, *file_paths):
        """Clean up temporary files"""
        for path in file_paths:
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except:
                pass
    
    def get_process_status(self, question_id: str) -> Optional[ProcessStatus]:
        """Get current status of a process"""
        with self._lock:
            if question_id in self.active_processes:
                return self.active_processes[question_id].status
            return None
    
    def kill_process(self, question_id: str) -> bool:
        """Manually kill a process"""
        with self._lock:
            if question_id not in self.active_processes:
                return False
            
            algo_process = self.active_processes[question_id]
        
        try:
            # Kill the process
            if hasattr(os, 'killpg'):
                os.killpg(os.getpgid(algo_process.process.pid), signal.SIGTERM)
            else:
                algo_process.process.terminate()
            
            time.sleep(1)
            
            if algo_process.process.poll() is None:
                if hasattr(os, 'killpg'):
                    os.killpg(os.getpgid(algo_process.process.pid), signal.SIGKILL)
                else:
                    algo_process.process.kill()
            
            self._update_process_status(question_id, ProcessStatus.KILLED)
            update_process_log(question_id, "🛑 Process manually killed by user", status="killed")
            return True
            
        except Exception as e:
            update_process_log(question_id, f"Error killing process: {e}")
            return False
        finally:
            self._cleanup_process(question_id)
    
    def get_active_count(self) -> int:
        """Get number of active processes"""
        with self._lock:
            return len(self.active_processes)
    
    def cleanup_all(self):
        """Clean up all active processes"""
        with self._lock:
            question_ids = list(self.active_processes.keys())
        
        for question_id in question_ids:
            self.kill_process(question_id)

# Global process manager instance
process_manager = AlgorithmProcessManager(max_concurrent=3, default_timeout=PROCESSING_TIMEOUT)

# Directory configurations
RESULT_DIR = os.path.join(os.getcwd(), 'app/results')
UPLOAD_DIR = os.path.join(os.getcwd(), 'app/uploads')
STUDY_LOGS_DIR = os.path.join(os.getcwd(), 'app/study_logs')

# Create directories
for directory in [RESULT_DIR, UPLOAD_DIR, STUDY_LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def update_process_log(question_id, message, status=None):
    """Add a new message to the process logs"""
    logs_path = os.path.join(RESULT_DIR, question_id, 'process_logs.json')
    try:
        os.makedirs(os.path.dirname(logs_path), exist_ok=True)
        try:
            with open(logs_path, 'r') as f:
                logs = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
    except:
        logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
    
    # Add timestamp to the message
    log_entry = f"[{time.strftime('%H:%M:%S')}] {message}"
    logs['logs'].append(log_entry)
    
    # Update status if provided
    if status:
        logs['status'] = status
    
    # Update timestamp
    logs['timestamp'] = time.time()
    
    # Write back to the file
    try:
        with open(logs_path, 'w') as f:
            json.dump(logs, f)
    except:
        pass
    
    logger.info(f"Question {question_id}: {message}")

def parse_provenance_output(output, question_id):
    """Parse provenance output and return structured data"""
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
                    update_process_log(question_id, f"Error parsing provenance line: {e}")
            
            # Parse time and token information
            elif line.startswith('Time:') and current_entry is not None:
                try:
                    current_entry["time"] = float(line.split(':')[1].strip())
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

# ============================================================================
# Flask Routes
# ============================================================================

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
        
        # Extract text from PDF and create sentences file
        try:
            pdf_text = extract_text(filepath)
            sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
            
            # Save sentences file
            base_name = filename.replace('.pdf', '')
            sentences_file = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{base_name}_sentences.json")
            with open(sentences_file, 'w', encoding='utf-8') as f:
                json.dump(sentences, f, ensure_ascii=False, indent=2)
            
            # Save metadata
            metadata_file = os.path.join(current_app.config['UPLOAD_FOLDER'], f"{base_name}_metadata.json")
            metadata = {
                'filename': filename,
                'text_length': len(pdf_text),
                'sentence_count': len(sentences),
                'processed_at': time.time()
            }
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2)
            
        except Exception as e:
            logger.error(f"Error processing PDF {filename}: {e}")
            return jsonify({'error': f'Failed to process PDF: {str(e)}'}), 500
        
        return jsonify({
            'success': True,
            'filename': filename,
            'message': 'File uploaded successfully'
        })
    
    return jsonify({'error': 'File type not allowed'}), 400

@main.route('/documents', methods=['GET'])
def get_available_documents():
    """Get all available documents"""
    try:
        documents = []
        uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        
        if os.path.exists(uploads_dir):
            # Get all PDF files
            pdf_files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
            
            for pdf_file in pdf_files:
                try:
                    base_name = pdf_file.replace('.pdf', '')
                    metadata_file = os.path.join(uploads_dir, f"{base_name}_metadata.json")
                    
                    if os.path.exists(metadata_file):
                        with open(metadata_file, 'r') as f:
                            metadata = json.load(f)
                        metadata['document_id'] = base_name
                        documents.append(metadata)
                    else:
                        # Create basic metadata if missing
                        filepath = os.path.join(uploads_dir, pdf_file)
                        if os.path.exists(filepath):
                            stat = os.stat(filepath)
                            documents.append({
                                'filename': pdf_file,
                                'document_id': base_name,
                                'text_length': stat.st_size,
                                'sentence_count': 0,
                                'processed_at': stat.st_mtime
                            })
                except Exception as e:
                    logger.error(f"Error processing document {pdf_file}: {e}")
                    continue
        
        return jsonify({
            'success': True,
            'documents': documents,
            'total_documents': len(documents)
        })
        
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
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

# Temporary debug version - replace the ask_question route with this for testing

@main.route('/ask', methods=['POST'])
def ask_question_debug():
    """Debug version of ask_question route"""
    try:
        logger.info("🔍 Debug: Starting ask_question route")
        
        # Check if request has JSON data
        if not request.is_json:
            logger.error("❌ Request is not JSON")
            return jsonify({'error': 'Request must be JSON'}), 400
        
        data = request.json
        logger.info(f"📝 Request data: {data}")
        
        question = data.get('question')
        filename = data.get('filename')
        
        logger.info(f"📝 Question: {question}")
        logger.info(f"📄 Filename: {filename}")
        
        if not question or not filename:
            logger.error("❌ Missing question or filename")
            return jsonify({'error': 'Question or filename missing'}), 400
        
        # Check file exists
        filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        logger.info(f"🔍 Checking file at: {filepath}")
        
        if not os.path.exists(filepath):
            logger.error(f"❌ File not found: {filepath}")
            return jsonify({'error': 'PDF file not found'}), 404
        
        # Test PDF text extraction
        logger.info("📄 Testing PDF text extraction...")
        try:
            pdf_text = extract_text(filepath)
            logger.info(f"✅ PDF text extracted: {len(pdf_text)} characters")
        except Exception as e:
            logger.error(f"❌ PDF extraction failed: {e}")
            return jsonify({'error': f'PDF extraction failed: {str(e)}'}), 500
        
        # Test doc_provenance import
        logger.info("🔍 Testing doc_provenance import...")
        try:
            import doc_provenance
            logger.info("✅ doc_provenance imported successfully")
            logger.info(f"Available attributes: {dir(doc_provenance)}")
        except Exception as e:
            logger.error(f"❌ doc_provenance import failed: {e}")
            return jsonify({'error': f'Algorithm import failed: {str(e)}'}), 500
        
        # Create result directory
        question_id = str(int(time.time() * 1000))
        result_path = os.path.join(RESULT_DIR, question_id)
        os.makedirs(result_path, exist_ok=True)
        logger.info(f"📁 Created result directory: {result_path}")
        
        # Return success without actually running the algorithm
        logger.info("✅ Debug test passed - returning success")
        return jsonify({
            'success': True,
            'question_id': question_id,
            'message': 'Debug test passed - algorithm not run',
            'debug_info': {
                'pdf_text_length': len(pdf_text),
                'doc_provenance_available': True,
                'result_path': result_path
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Debug route error: {e}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': f'Debug route failed: {str(e)}',
            'traceback': traceback.format_exc()
        }), 500

@main.route('/ask', methods=['POST'])
def ask_question():
    """Submit a question for processing"""
    data = request.json
    question = data.get('question')
    filename = data.get('filename')
    
    if not question or not filename:
        return jsonify({'error': 'Question or filename missing'}), 400
    
    # Check if we can start a new process
    if not process_manager.can_start_process():
        return jsonify({
            'error': f'Server at capacity ({process_manager.get_active_count()}/{process_manager.max_concurrent} processes). Please try again later.',
            'active_processes': process_manager.get_active_count()
        }), 503
    
    # Get PDF file path
    filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'PDF file not found'}), 404
    
    try:
        # Extract text from PDF
        pdf_text = extract_text(filepath)
        
        # Create result directory
        question_id = str(int(time.time() * 1000))  # More unique IDs with milliseconds
        result_path = os.path.join(RESULT_DIR, question_id)
        os.makedirs(result_path, exist_ok=True)
        
        # Initialize process logs
        update_process_log(question_id, f"Processing started: {question}")
        
        # Start the algorithm process
        process_manager.start_algorithm(
            question_id=question_id,
            question=question,
            pdf_text=pdf_text,
            result_path=result_path,
            timeout=PROCESSING_TIMEOUT
        )
        
        return jsonify({
            'success': True,
            'question_id': question_id,
            'message': 'Processing started',
            'active_processes': process_manager.get_active_count(),
            'estimated_time': f'{PROCESSING_TIMEOUT}s max'
        })
        
    except Exception as e:
        logger.error(f"Error starting question processing: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/check-progress/<question_id>', methods=['GET'])
def check_progress(question_id):
    """Check processing progress for a question"""
    question_dir = os.path.join(RESULT_DIR, question_id)
    
    # Check process status first
    status = process_manager.get_process_status(question_id)
    
    # Check for error files
    error_file = os.path.join(question_dir, 'algorithm_error.json')
    if os.path.exists(error_file):
        try:
            with open(error_file, 'r') as f:
                error_data = json.load(f)
            return jsonify({
                'progress': 0,
                'done': True,
                'logs': [],
                'status': 'error',
                'error': error_data.get('error', 'Process failed'),
                'error_details': error_data
            })
        except:
            pass
    
    # Get process logs if available
    logs = []
    log_status = 'processing'
    logs_path = os.path.join(question_dir, 'process_logs.json')
    if os.path.exists(logs_path):
        try:
            with open(logs_path, 'r') as f:
                log_data = json.load(f)
                logs = log_data.get('logs', [])
                log_status = log_data.get('status', 'processing')
        except json.JSONDecodeError:
            pass
    
    # Ensure the question directory exists
    if not os.path.exists(question_dir):
        return jsonify({
            'progress': 0, 
            'done': False,
            'logs': logs,
            'status': 'starting',
            'message': 'Algorithm process starting...'
        })
    
    # Check for heartbeat from progress monitor (if process is still active)
    if status in [ProcessStatus.RUNNING, ProcessStatus.STARTING]:
        progress_file = os.path.join(question_dir, 'algorithm_progress.json')
        if os.path.exists(progress_file):
            try:
                with open(progress_file, 'r') as f:
                    progress_data = json.load(f)
                    
                # Check if heartbeat is recent (within last 30 seconds)
                last_heartbeat = progress_data.get('timestamp', 0)
                if time.time() - last_heartbeat > 30:
                    update_process_log(question_id, "⚠️ Process appears to be hung (no heartbeat)", status="timeout")
                    
                    # Try to clean up hung process
                    process_manager.kill_process(question_id)
                    
                    return jsonify({
                        'progress': 0,
                        'done': True,
                        'logs': logs,
                        'status': 'timeout',
                        'error': 'Process appears to be hung - no heartbeat for 30+ seconds'
                    })
            except:
                pass
    
    # Check for results
    provenance_path = os.path.join(question_dir, 'provenance.json')
    if not os.path.exists(provenance_path):
        return jsonify({
            'progress': 0, 
            'done': False,
            'logs': logs,
            'status': log_status,
            'message': 'Processing in progress...'
        })
    
    try:
        with open(provenance_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        provenance_data = data if isinstance(data, list) else []
        done = log_status in ['completed', 'error', 'timeout'] or len(provenance_data) > 0
        
        return jsonify({
            'progress': len(provenance_data),
            'done': done,
            'data': provenance_data,
            'logs': logs,
            'status': log_status
        })
    except json.JSONDecodeError:
        return jsonify({
            'progress': 0, 
            'done': False,
            'logs': logs,
            'status': log_status,
            'message': 'Processing results...'
        })

@main.route('/results/<question_id>', methods=['GET'])
def get_results(question_id):
    """Get final results for a question"""
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

@main.route('/status/<question_id>', methods=['GET'])
def check_status(question_id):
    """Check if processing is fully complete"""
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

@main.route('/kill-process/<question_id>', methods=['POST'])
def kill_process_route(question_id):
    """Kill a running process"""
    try:
        success = process_manager.kill_process(question_id)
        
        if success:
            # Create error marker file
            question_dir = os.path.join(RESULT_DIR, question_id)
            os.makedirs(question_dir, exist_ok=True)
            
            error_file = os.path.join(question_dir, 'algorithm_error.json')
            with open(error_file, 'w') as f:
                json.dump({
                    "error": "Process manually killed due to timeout or user request",
                    "timestamp": time.time(),
                    "killed_by_user": True,
                    "question_id": question_id
                }, f)
            
            # Create empty provenance file to prevent frontend hanging
            provenance_file = os.path.join(question_dir, 'provenance.json')
            with open(provenance_file, 'w') as f:
                json.dump([], f)
            
            return jsonify({
                'success': True,
                'message': 'Process killed and cleaned up successfully'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Process not found or already completed'
            })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main.route('/uploads/<filename>', methods=['GET'])
def serve_uploaded_file(filename):
    """Serve files from the uploads directory"""
    try:
        uploads_dir = current_app.config.get('UPLOAD_FOLDER', 'app/uploads')
        return send_from_directory(uploads_dir, filename)
    except Exception as e:
        logger.error(f"Error serving uploaded file {filename}: {e}")
        return jsonify({'error': 'File not found'}), 404

# Cleanup on app shutdown
import atexit

def cleanup_all_processes():
    """Clean up all active processes on shutdown"""
    try:
        process_manager.cleanup_all()
    except:
        pass

atexit.register(cleanup_all_processes)