"""
Text processing and document analysis functionality
Handles PDF processing, sentence extraction, layout mapping, and provenance highlighting
"""

import json
import logging
import os
import time
from typing import Dict, List, Optional, Tuple
from werkzeug.utils import secure_filename

import doc_provenance.base_strategies
from pdfminer.high_level import extract_text

from .preprocess_pdfs import save_compatible_sentence_data, extract_sentences_with_compatible_layout
from .provenance_layout_mapper import ProvenanceLayoutMapper
from .enhanced_text_matcher import get_enhanced_provenance_boxes
from .utils import get_file_finder

logger = logging.getLogger(__name__)

class TextProcessingManager:
    """
    Manages text processing operations for documents
    """
    
    def __init__(self, sentences_dir: str, results_dir: str):
        self.sentences_dir = sentences_dir
        self.results_dir = results_dir
        
        os.makedirs(sentences_dir, exist_ok=True)
        os.makedirs(results_dir, exist_ok=True)
    
    def get_document_sentences_path(self, filename: str) -> str:
        """Get the standardized path for document sentences"""
        base_name = filename.replace('.pdf', '')
        return os.path.join(self.sentences_dir, f"{base_name}_sentences.json")

    def save_document_sentences(self, filename: str, sentences: List[str]) -> bool:
        """Save sentences for a document to the dedicated sentences directory"""
        sentences_path = self.get_document_sentences_path(filename)
        try:
            with open(sentences_path, 'w', encoding='utf-8') as f:
                json.dump(sentences, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved {len(sentences)} sentences for {filename}")
            return True
        except Exception as e:
            logger.error(f"Error saving sentences for {filename}: {e}")
            return False
    
    def process_pdf_for_layout(self, pdf_path: str, force_reprocess: bool = False) -> Dict:
        """
        Process a PDF for sentence extraction and layout mapping
        """
        try:
            if not os.path.exists(pdf_path):
                return {
                    "success": False,
                    "error": f"PDF file not found: {pdf_path}"
                }
            
            if not pdf_path.lower().endswith('.pdf'):
                return {
                    "success": False,
                    "error": "File must be a PDF"
                }
            
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
                
                return {
                    "success": True,
                    "message": "PDF already processed (files exist)",
                    "files": {
                        "sentences_file": sentences_file,
                        "layout_file": layout_file
                    },
                    "statistics": layout_data.get('metadata', {}).get('statistics', {}),
                    "processing_time": processing_time,
                    "was_cached": True
                }
            
            # Process the PDF
            logger.info(f"Starting PDF processing for {base_name}")
            sentences_file_path, layout_file_path, stats = save_compatible_sentence_data(
                pdf_path, 
                output_dir
            )
            
            processing_time = time.time() - start_time
            logger.info(f"PDF processing completed in {processing_time:.2f}s")
            
            # Initialize provenance mapper
            provenance_mapper_ready = False
            try:
                mapper = ProvenanceLayoutMapper(layout_file_path, debug=False)
                provenance_mapper_ready = True
                logger.info("Provenance mapper initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize provenance mapper: {e}")
            
            return {
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
            }
            
        except Exception as e:
            logger.error(f"Error processing PDF: {str(e)}")
            return {
                "success": False,
                "error": f"Processing failed: {str(e)}"
            }
    
    def extract_pdf_text_and_sentences(self, pdf_path: str) -> Tuple[str, List[str]]:
        """Extract text and sentences from a PDF"""
        pdf_text = extract_text(pdf_path)
        sentences = doc_provenance.base_strategies.extract_sentences_from_pdf(pdf_text)
        return pdf_text, sentences
    
    def get_provenance_highlighting_boxes(self, filename: str, sentence_ids: List[int], 
                                        provenance_text: str, provenance_id: Optional[str] = None) -> Dict:
        """
        Get precise bounding boxes for provenance text using enhanced character-level matching
        """
        try:
            if not sentence_ids:
                return {'success': False, 'error': 'No sentence IDs provided'}
            
            if not provenance_text or len(provenance_text.strip()) < 5:
                return {'success': False, 'error': 'No meaningful provenance text provided'}
            
            # Find layout file
            layout_file = get_file_finder().find_file(filename, 'layout')
            
            if not layout_file:
                return {'success': False, 'error': 'Layout data not available'}
            
            logger.info(f"🎯 Enhanced provenance matching for: '{provenance_text[:50]}...'")
            logger.info(f"   Sentence IDs: {sentence_ids}")
            
            # Use the enhanced character-level matcher
            bounding_boxes = get_enhanced_provenance_boxes(
                layout_file['path'], 
                sentence_ids, 
                provenance_text
            )
            
            if bounding_boxes:
                # Calculate statistics
                total_boxes = sum(len(boxes) for boxes in bounding_boxes.values())
                all_boxes = [box for boxes in bounding_boxes.values() for box in boxes]
                avg_confidence = sum(box['confidence'] for box in all_boxes) / len(all_boxes) if all_boxes else 0
                
                logger.info(f"✅ Enhanced matching successful: {len(bounding_boxes)} sentences, {total_boxes} boxes")
                
                return {
                    'success': True,
                    'bounding_boxes': bounding_boxes,
                    'statistics': {
                        'total_sentences': len(bounding_boxes),
                        'mapped_sentences': len([boxes for boxes in bounding_boxes.values() if boxes]),
                        'total_boxes': total_boxes,
                        'avg_confidence': avg_confidence,
                        'mapping_success_rate': len([boxes for boxes in bounding_boxes.values() if boxes]) / len(bounding_boxes) if bounding_boxes else 0,
                        'match_types': list(set(box['match_type'] for box in all_boxes))
                    },
                    'sentence_ids': sentence_ids,
                    'match_type': 'enhanced_character_level',
                    'provenance_text': provenance_text[:100] + '...' if len(provenance_text) > 100 else provenance_text,
                    'data_source': 'enhanced_character_matcher'
                }
            else:
                # Fallback to existing sentence-level matching
                logger.warning("Enhanced matching failed, falling back to sentence-level")
                
                mapper = ProvenanceLayoutMapper(layout_file['path'], debug=False)
                fallback_boxes = mapper.get_provenance_bounding_boxes(sentence_ids)
                fallback_stats = mapper.get_provenance_statistics(sentence_ids)
                
                return {
                    'success': True,
                    'bounding_boxes': fallback_boxes,
                    'statistics': fallback_stats,
                    'sentence_ids': sentence_ids,
                    'match_type': 'sentence_level_fallback',
                    'data_source': 'fallback_mapper'
                }
            
        except Exception as e:
            logger.error(f"Error in enhanced provenance matching for {filename}: {e}")
            return {'success': False, 'error': str(e)}
    
    def generate_safe_question_id(self, pdf_filename: str, question_text: str = None) -> str:
        """
        Generate a safe question ID based on PDF filename and timestamp
        This ensures questions are organized by document
        """
        # Get base filename without extension
        base_filename = os.path.splitext(pdf_filename)[0]
        safe_filename = secure_filename(base_filename)
        
        # Create timestamp-based ID
        timestamp = str(int(time.time()))
        
        # Optionally include a hash of the question for uniqueness
        # this is for test_suite deterministic question IDs
        # If question_text is provided, use it to create a unique ID
        if question_text:
            import hashlib
            question_hash = hashlib.md5(question_text.encode()).hexdigest()[:8]
            return f"{safe_filename}_{question_hash}"
        else:
            return f"{safe_filename}_{timestamp}"
    
    def create_question_result_directory(self, pdf_filename: str, question_text: str = None) -> str:
        """
        Create a result directory organized by PDF filename
        Returns the path to the question-specific directory
        """
        # Generate question ID
        question_id = self.generate_safe_question_id(pdf_filename, question_text)
        
        # Create directory structure: results/{safe_pdf_name}/{question_id}/
        base_filename = os.path.splitext(pdf_filename)[0]
        safe_pdf_name = secure_filename(base_filename)
        
        pdf_results_dir = os.path.join(self.results_dir, safe_pdf_name)
        question_dir = os.path.join(pdf_results_dir, question_id)
        
        os.makedirs(question_dir, exist_ok=True)
        
        return question_dir, question_id
    
    def get_question_file_paths(self, question_dir: str) -> Dict[str, str]:
        """Get standardized file paths for a question"""
        return {
            'answer': os.path.join(question_dir, 'answer.json'),
            'provenance': os.path.join(question_dir, 'provenance.json'),
            'status': os.path.join(question_dir, 'status.json'),
            'metadata': os.path.join(question_dir, 'metadata.json'),
            'logs': os.path.join(question_dir, 'process_logs.json')
        }
    
    def save_question_metadata(self, question_dir: str, metadata: Dict) -> bool:
        """Save metadata for a question processing session"""
        file_paths = self.get_question_file_paths(question_dir)
        try:
            with open(file_paths['metadata'], 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error(f"Error saving metadata for question in {question_dir}: {e}")
            return False

    def load_question_metadata(self, question_dir: str) -> Optional[Dict]:
        """Load metadata for a question processing session"""
        file_paths = self.get_question_file_paths(question_dir)
        try:
            if os.path.exists(file_paths['metadata']):
                with open(file_paths['metadata'], 'r', encoding='utf-8') as f:
                    return json.load(f)
            return None
        except Exception as e:
            logger.error(f"Error loading metadata for question in {question_dir}: {e}")
            return None
    
    def extract_answer_text(self, answer_data: Dict) -> Optional[str]:
        """Extract answer text from answer data structure"""
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
    
    def check_answer_ready(self, question_dir: str) -> Dict:
        """Check if answer is ready for a question with better error handling"""
        file_paths = self.get_question_file_paths(question_dir)
        answer_path = file_paths['answer']
        
        try:
            # Check if the file exists and has content
            if not os.path.exists(answer_path):
                logger.info(f"Answer file not found in {question_dir}")
                return {'ready': False, 'reason': 'file_not_found'}
            
            # Check if file has content (avoid reading empty/corrupt files)
            file_size = os.path.getsize(answer_path)
            if file_size == 0:
                logger.info(f"Answer file is empty in {question_dir}")
                return {'ready': False, 'reason': 'file_empty'}
            
            # Try to read and parse the file
            try:
                with open(answer_path, 'r', encoding='utf-8') as f:
                    answer_data = json.load(f)
            except json.JSONDecodeError as json_error:
                logger.warning(f"Invalid JSON in answer file in {question_dir}: {json_error}")
                return {'ready': False, 'reason': 'invalid_json'}
            except Exception as read_error:
                logger.error(f"Error reading answer file in {question_dir}: {read_error}")
                return {'ready': False, 'reason': 'read_error', 'error': str(read_error)}
            
            # Extract answer text with better validation
            answer_text = self.extract_answer_text(answer_data)
            question_text = answer_data.get('question', [''])[0] if isinstance(answer_data.get('question'), list) else answer_data.get('question', '')
            
            # Check if we have a valid answer
            if answer_text and answer_text.strip():
                logger.info(f"Valid answer found in {question_dir}")
                return {
                    'ready': True,
                    'answer': answer_text,
                    'question': question_text,
                    'timestamp': answer_data.get('timestamp', time.time())
                }
            else:
                logger.info(f"Answer not ready yet in {question_dir} (answer: {answer_text})")
                return {'ready': False, 'reason': 'answer_not_ready'}
            
        except Exception as e:
            logger.error(f"Unexpected error checking answer in {question_dir}: {e}")
            return {'ready': False, 'error': str(e), 'reason': 'unexpected_error'}
    
    def get_current_provenance_count(self, question_dir: str) -> int:
        """Get the current number of provenances available for a question"""
        file_paths = self.get_question_file_paths(question_dir)
        provenance_path = file_paths['provenance']
        
        try:
            if os.path.exists(provenance_path):
                file_size = os.path.getsize(provenance_path)
                
                with open(provenance_path, 'r', encoding='utf-8') as f:
                    provenance_data = json.load(f)
                
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
            logger.error(f"JSON decode error in provenance file in {question_dir}: {json_error}")
            return 0
        except Exception as e:
            logger.error(f"Error checking provenance count in {question_dir}: {e}")
            return 0
    
    def update_process_log(self, question_dir: str, message: str, status: str = None):
        """Add a new message to the process logs"""
        file_paths = self.get_question_file_paths(question_dir)
        logs_path = file_paths['logs']
        
        try:
            with open(logs_path, 'r') as f:
                logs = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            logs = {'status': 'started', 'logs': [], 'timestamp': time.time()}
        
        # Add timestamp for non-algorithm messages
        if message.startswith('Top-') or message.startswith('Labeler') or message.startswith('Provenance:') or 'tokens:' in message or 'Time:' in message:
            log_entry = message
        else:
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
        
        logger.info(f"Question in {question_dir}: {message}")