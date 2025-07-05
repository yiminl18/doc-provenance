# Add this to routes.py or create a new utils/file_finder.py

import json, logging, os
from pathlib import Path
from typing import Dict, List, Optional, Union, Tuple

logger = logging.getLogger('file_finder')

class DocumentFileFinder:
    """Helper class to find various document-related files across different storage locations"""
    
    def __init__(self, app_config=None):

        current_file_dir = Path(__file__).parent

        project_root = current_file_dir.parent.parent

        # Debug print to see the paths
        logger.info(f"DEBUG - current file dir: {current_file_dir}")
        logger.info(f"DEBUG - project root: {project_root}")

        """Initialize with Flask app config or use defaults"""
        if app_config:
            self.downloads_dir = app_config.get('DOWNLOADS_DIR', str(project_root / 'app' / 'gdrive_downloads'))
            self.layouts_dir = app_config.get('LAYOUTS_DIR', str(project_root / 'app' / 'layouts'))
            self.questions_dir = app_config.get('QUESTIONS_DIR', str(project_root / 'app' / 'questions'))
            self.sentences_dir = app_config.get('SENTENCES_DIR', str(project_root / 'app' / 'sentences'))
            self.uploads_dir = app_config.get('UPLOADS_DIR', str(project_root / 'app' / 'uploads'))
            self.mappings_dir = app_config.get('MAPPINGS_DIR', str(project_root / 'app' / 'stable_mappings'))
        else:
            self.downloads_dir = str(project_root / 'app' / 'gdrive_downloads')
            self.layouts_dir = str(project_root / 'app' / 'layouts')
            self.questions_dir = str(project_root / 'app' / 'questions')
            self.sentences_dir = str(project_root / 'app' / 'sentences')
            self.uploads_dir = str(project_root / 'app' / 'uploads')
            self.mappings_dir = str(project_root / 'app' / 'stable_mappings')
           

        current_dir = os.getcwd()

        if current_dir.endswith('app'):
            base_path = os.path.dirname(current_dir)
        else:
            base_path = current_dir

        #if not os.path.isabs(self.downloads_dir):
        #    self.downloads_dir = os.path.join(base_path, "gdrive_downloads")
        #if not os.path.isabs(self.layouts_dir):
        #    self.layouts_dir = os.path.join(base_path, "layouts")
        #if not os.path.isabs(self.questions_dir):   
        #    self.questions_dir = os.path.join(base_path, "questions")        
        #if not os.path.isabs(self.sentences_dir):
        #    self.sentences_dir = os.path.join(base_path, "sentences")
        #if not os.path.isabs(self.uploads_dir):
        #    self.uploads_dir = os.path.join(base_path, "uploads")
        
        if not os.path.isabs(self.downloads_dir):
            self.downloads_dir = os.path.join(base_path, self.downloads_dir)
        if not os.path.isabs(self.layouts_dir):
            self.layouts_dir = os.path.join(base_path, self.layouts_dir)
        if not os.path.isabs(self.questions_dir):   
            self.questions_dir = os.path.join(base_path, self.questions_dir)        
        if not os.path.isabs(self.sentences_dir):
            self.sentences_dir = os.path.join(base_path, self.sentences_dir)
        if not os.path.isabs(self.uploads_dir):
            self.uploads_dir = os.path.join(base_path, self.uploads_dir)
        if not os.path.isabs(self.mappings_dir):
            self.mappings_dir = os.path.join(base_path, self.mappings_dir)
        
        # Debug print to see the paths
        print(f"DEBUG - Current working directory: {os.getcwd()}")
        print(f"DEBUG - uploads_dir: {self.uploads_dir}")
        print(f"DEBUG - downloads_dir: {self.downloads_dir}")
        print(f"DEBUG - File location: {__file__}")
            
    def find_uploads_files(self, filename: str) -> Optional[Dict]:
        """
        Find all files for a document in uploads directory

        Returns:
            Dict with all upload file paths or None if not found
        """
        base_name = self._get_base_name(filename)

        if not os.path.exists(self.uploads_dir):
            return None

        # Check for files in uploads directory
        pdf_filename = filename if filename.endswith('.pdf') else f"{filename}.pdf"

        result = {
            'uploads_dir': self.uploads_dir,
            'base_name': base_name,
            'pdf': None,
            'sentences': None,
            'layout': None,
            'stable_mappings': None,
            'metadata': None
        }

        # Check for PDF
        pdf_path = os.path.join(self.uploads_dir, pdf_filename)
        if os.path.exists(pdf_path):
            result['pdf'] = pdf_path

        # Check for metadata
        metadata_path = os.path.join(self.uploads_dir, f"{base_name}_metadata.json")
        if os.path.exists(metadata_path):
            result['metadata'] = metadata_path

        # Note: uploads typically don't have sentences, layout, or stable_mappings files
        # Those are usually in dedicated directories or batch folders

        # Return result if we found at least one file
        if any(result[key] for key in ['pdf', 'metadata']):
            return result

        return None

    def find_batch_files(self, filename: str) -> Optional[Dict]:
        """
        Find all files for a document in batch directories

        Returns:
            Dict with all batch file paths or None if not found
        """
        base_name = self._get_base_name(filename)

        if not os.path.exists(self.downloads_dir):
            return None

        # Search batch directories
        batch_dirs = [d for d in os.listdir(self.downloads_dir) 
                     if os.path.isdir(os.path.join(self.downloads_dir, d)) and d.startswith('batch_')]

        for batch_dir in batch_dirs:
            batch_path = os.path.join(self.downloads_dir, batch_dir)

            # Check for direct filename matches
            pdf_path = os.path.join(batch_path, f"{base_name}.pdf")
            metadata_path = os.path.join(batch_path, f"{base_name}_metadata.json")

            if os.path.exists(pdf_path) or os.path.exists(metadata_path):
                return {
                    'batch_dir': batch_dir,
                    'batch_path': batch_path,
                    'base_name': base_name,
                    'pdf': pdf_path if os.path.exists(pdf_path) else None,
                    'sentences': os.path.join(batch_path, f"{base_name}_sentences.json") if os.path.exists(os.path.join(batch_path, f"{base_name}_sentences.json")) else None,
                    'layout': os.path.join(batch_path, f"{base_name}_layout.json") if os.path.exists(os.path.join(batch_path, f"{base_name}_layout.json")) else None,
                    'stable_mappings': os.path.join(batch_path, f"{base_name}_stable_mappings.json") if os.path.exists(os.path.join(batch_path, f"{base_name}_stable_mappings.json")) else None,
                    'metadata': metadata_path if os.path.exists(metadata_path) else None
                }

            # Check metadata files for filename references
            try:
                metadata_files = [f for f in os.listdir(batch_path) if f.endswith('_metadata.json')]

                for metadata_file in metadata_files:
                    metadata_full_path = os.path.join(batch_path, metadata_file)

                    try:
                        with open(metadata_full_path, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)

                        if (metadata.get('filename') == filename or 
                            metadata.get('original_name') == filename or
                            metadata.get('filename', '').startswith(base_name)):

                            actual_base = metadata_file.replace('_metadata.json', '')
                            return {
                                'batch_dir': batch_dir,
                                'batch_path': batch_path,
                                'base_name': actual_base,
                                'pdf': os.path.join(batch_path, f"{actual_base}.pdf") if os.path.exists(os.path.join(batch_path, f"{actual_base}.pdf")) else None,
                                'sentences': os.path.join(batch_path, f"{actual_base}_sentences.json") if os.path.exists(os.path.join(batch_path, f"{actual_base}_sentences.json")) else None,
                                'layout': os.path.join(batch_path, f"{actual_base}_layout.json") if os.path.exists(os.path.join(batch_path, f"{actual_base}_layout.json")) else None,
                                'stable_mappings': os.path.join(batch_path, f"{actual_base}_stable_mappings.json") if os.path.exists(os.path.join(batch_path, f"{actual_base}_stable_mappings.json")) else None,
                                'metadata': metadata_full_path,
                                'metadata_content': metadata
                            }

                    except Exception:
                        continue

            except Exception:
                continue
            
        return None

    def find_pvc_sample_files(self, filename: str) -> Optional[Dict]:
        """
        Find all files for a document in PVC sample directories
        Now handles both original filenames and path hash filenames

        Returns:
            Dict with all PVC sample file paths or None if not found
        """
        base_name = self._get_base_name(filename)

        if not os.path.exists(self.downloads_dir):
            return None

        # Check for pvc-sample directory in downloads_dir
        pvc_sample_dirs = []

        # Check both possible locations
        possible_pvc_dirs = [
            os.path.join(self.downloads_dir, 'pvc-sample'),
            self.downloads_dir  # In case downloads_dir already points to pvc-sample
        ]

        for check_dir in possible_pvc_dirs:
            if os.path.exists(check_dir):
                try:
                    contents = os.listdir(check_dir)
                    # Look for provisional case directories (format: timestamp-code)
                    case_dirs = [d for d in contents if os.path.isdir(os.path.join(check_dir, d)) 
                               and not d.startswith('.') and '-' in d]
                    if case_dirs:
                        pvc_sample_dirs.append((check_dir, case_dirs))
                except Exception:
                    continue
                
        if not pvc_sample_dirs:
            return None

        # Search through all PVC sample case directories
        for pvc_dir, case_dirs in pvc_sample_dirs:
            for case_name in case_dirs:
                case_path = os.path.join(pvc_dir, case_name)

                try:
                    case_files = os.listdir(case_path)

                    # Look for PDF files
                    for case_file in case_files:
                        if case_file.endswith('.pdf'):
                            # Check for exact match
                            if case_file == filename:
                                return self._build_pvc_sample_result(case_path, case_name, case_file, filename)

                            # Check for base name match (without extension)
                            case_base = case_file.replace('.pdf', '')
                            if case_base == base_name:
                                return self._build_pvc_sample_result(case_path, case_name, case_file, filename)

                            # Check if this might be a path hash filename
                            # Look for corresponding metadata file to check original filename
                            metadata_file = os.path.join(case_path, f"{case_base}_metadata.json")
                            if os.path.exists(metadata_file):
                                try:
                                    with open(metadata_file, 'r', encoding='utf-8') as f:
                                        metadata = json.load(f)

                                    original_filename = metadata.get('original_filename', '')
                                    if (original_filename == filename or 
                                        original_filename.replace('.pdf', '') == base_name or
                                        base_name in original_filename):
                                        return self._build_pvc_sample_result(case_path, case_name, case_file, filename, metadata)

                                except Exception:
                                    continue
                                
                            # Fallback: check for partial matches
                            if base_name in case_file or filename.replace('.pdf', '') in case_file:
                                return self._build_pvc_sample_result(case_path, case_name, case_file, filename)

                except Exception:
                    continue
                
        return None

    def _build_pvc_sample_result(self, case_path: str, case_name: str, found_filename: str, requested_filename: str, metadata: Dict = None) -> Dict:
        """Build result dictionary for PVC sample files"""
        base_name = found_filename.replace('.pdf', '')

        result = {
            'provisional_case': case_name,
            'case_path': case_path,
            'found_filename': found_filename,
            'requested_filename': requested_filename,
            'base_name': base_name,
            'pdf': os.path.join(case_path, found_filename),
            'sentences': None,
            'layout': None,
            'stable_mappings': None,
            'metadata': None,
            'file_metadata': metadata  # Additional metadata about the file
        }

        # Check for related files using the base name (which is the path hash for new files)
        try:
            case_files = os.listdir(case_path)

            for file in case_files:
                file_path = os.path.join(case_path, file)

                # Check for sentences file
                if file.endswith('_sentences.json') and file.startswith(base_name):
                    result['sentences'] = file_path

                # Check for layout file
                elif file.endswith('_layout.json') and file.startswith(base_name):
                    result['layout'] = file_path

                # Check for stable_mappings file
                elif file.endswith('_stable_mappings.json') and file.startswith(base_name):
                    result['stable_mappings'] = file_path

                # Check for metadata file
                elif file.endswith('_metadata.json') and file.startswith(base_name):
                    result['metadata'] = file_path

        except Exception:
            pass
        
        return result

    # Now refactor the type-specific methods to use the three search methods above:

    def find_file(self, filename: str, file_type: str) -> Optional[Dict]:
        """
        Find a specific file type for a document across all locations

        Args:
            filename: Document filename (e.g., 'document.pdf')
            file_type: Type to find ('pdf', 'sentences', 'layout', 'stable_mappings', 'metadata', 'questions')

        Returns:
            Dict with file info or None if not found
        """
        # Special case for questions - only in dedicated questions directory
        if file_type == 'questions':
            return self._find_questions_dedicated(filename)

        # For stable_mappings, also check dedicated stable_mappings directory
        if file_type == 'stable_mappings':
            dedicated_result = self._find_mappings_dedicated(filename)
            if dedicated_result:
                return dedicated_result

        # For sentences, also check dedicated sentences directory
        if file_type == 'sentences':
            dedicated_result = self._find_sentences_dedicated(filename)
            if dedicated_result:
                return dedicated_result

        # For layout, also check dedicated layout directory
        if file_type == 'layout':
            dedicated_result = self._find_layout_dedicated(filename)
            if dedicated_result:
                return dedicated_result

        # Try uploads first (fastest)
        uploads_result = self.find_uploads_files(filename)
        if uploads_result and uploads_result.get(file_type):
            return {
                'path': uploads_result[file_type],
                'location': 'uploads',
                'exists': os.path.exists(uploads_result[file_type]),
                'base_name': uploads_result['base_name']
            }

        # Try batch directories
        batch_result = self.find_batch_files(filename)
        if batch_result and batch_result.get(file_type):
            return {
                'path': batch_result[file_type],
                'location': 'batch',
                'batch_info': {
                    'batch_dir': batch_result['batch_dir'],
                    'batch_path': batch_result['batch_path']
                },
                'exists': os.path.exists(batch_result[file_type]),
                'base_name': batch_result['base_name']
            }

        # Try PVC sample directories
        pvc_result = self.find_pvc_sample_files(filename)
        if pvc_result and pvc_result.get(file_type):
            return {
                'path': pvc_result[file_type],
                'location': 'pvc-sample',
                'pvc_info': {
                    'provisional_case': pvc_result['provisional_case'],
                    'case_path': pvc_result['case_path'],
                    'found_filename': pvc_result['found_filename']
                },
                'exists': os.path.exists(pvc_result[file_type]),
                'base_name': pvc_result['base_name']
            }

        return None

    def find_all_files(self, filename: str) -> Dict[str, Optional[Dict]]:
        """
        Find all file types for a document across all locations

        Returns:
            Dict mapping file types to their info dicts
        """
        result = {
            'pdf': None,
            'sentences': None,
            'layout': None,
            'stable_mappings': None,
            'metadata': None,
            'questions': None
        }

        # Check dedicated directories first for specific file types
        result['questions'] = self._find_questions_dedicated(filename)

        # Check dedicated sentences directory
        dedicated_sentences = self._find_sentences_dedicated(filename)
        if dedicated_sentences:
            result['sentences'] = dedicated_sentences

        # Check dedicated layout directory
        dedicated_layout = self._find_layout_dedicated(filename)
        if dedicated_layout:
            result['layout'] = dedicated_layout

        # Check dedicated stable_mappings directory
        dedicated_mappings = self._find_mappings_dedicated(filename)
        if dedicated_mappings:
            result['stable_mappings'] = dedicated_mappings

        # Check uploads
        uploads_result = self.find_uploads_files(filename)
        if uploads_result:
            for file_type in result.keys():
                if not result[file_type] and uploads_result.get(file_type):
                    result[file_type] = {
                        'path': uploads_result[file_type],
                        'location': 'uploads',
                        'exists': os.path.exists(uploads_result[file_type]),
                        'base_name': uploads_result['base_name']
                    }

        # Check batch directories (only for types not found elsewhere)
        batch_result = self.find_batch_files(filename)
        if batch_result:
            for file_type in result.keys():
                if not result[file_type] and batch_result.get(file_type):
                    result[file_type] = {
                        'path': batch_result[file_type],
                        'location': 'batch',
                        'batch_info': {
                            'batch_dir': batch_result['batch_dir'],
                            'batch_path': batch_result['batch_path']
                        },
                        'exists': os.path.exists(batch_result[file_type]),
                        'base_name': batch_result['base_name']
                    }

        # Check PVC sample directories (only for types not found elsewhere)
        pvc_result = self.find_pvc_sample_files(filename)
        if pvc_result:
            for file_type in result.keys():
                if not result[file_type] and pvc_result.get(file_type):
                    result[file_type] = {
                        'path': pvc_result[file_type],
                        'location': 'pvc-sample',
                        'pvc_info': {
                            'provisional_case': pvc_result['provisional_case'],
                            'case_path': pvc_result['case_path'],
                            'found_filename': pvc_result['found_filename']
                        },
                        'exists': os.path.exists(pvc_result[file_type]),
                        'base_name': pvc_result['base_name']
                    }

        return result

    # Helper methods for dedicated directories:

    def _find_sentences_dedicated(self, filename: str) -> Optional[Dict]:
        """Find sentences file in dedicated sentences directory"""
        base_name = self._get_base_name(filename)
        sentences_path = os.path.join(self.sentences_dir, f"{base_name}_sentences.json")
        if os.path.exists(sentences_path):
            return {
                'path': sentences_path,
                'exists': True,
                'location': 'sentences',
                'base_name': base_name
            }
        return None

    def _find_layout_dedicated(self, filename: str) -> Optional[Dict]:
        """Find layout file in dedicated layout directory"""
        base_name = self._get_base_name(filename)
        layout_path = os.path.join(self.layouts_dir, f"{base_name}_layout.json")
        if os.path.exists(layout_path):
            return {
                'path': layout_path,
                'exists': True,
                'location': 'layout',
                'base_name': base_name
            }
        return None

    def _find_mappings_dedicated(self, filename: str) -> Optional[Dict]:
        """Find stable_mappings file in dedicated stable_mappings directory"""
        base_name = self._get_base_name(filename)
        mappings_path = os.path.join(self.mappings_dir, f"{base_name}_stable_mappings.json")
        if os.path.exists(mappings_path):
            return {
                'path': mappings_path,
                'exists': True,
                'location': 'stable_mappings',
                'base_name': base_name
            }
        return None

    def _find_questions_dedicated(self, filename: str) -> Optional[Dict]:
        """Find questions file in dedicated questions directory"""
        base_name = self._get_base_name(filename)
        questions_path = os.path.join(self.questions_dir, f"{base_name}_questions.json")
        if os.path.exists(questions_path):
            return {
                'path': questions_path,
                'exists': True,
                'location': 'questions',
                'base_name': base_name
            }
        return None

    def _get_base_name(self, filename: str) -> str:
        """Extract base name from filename"""
        return os.path.splitext(filename)[0] if filename.endswith('.pdf') else filename
    
    def _find_pdf(self, filename: str, base_name: str) -> Optional[Dict]:
        """Find PDF file"""
        # Ensure filename has .pdf extension
        pdf_filename = filename if filename.endswith('.pdf') else f"{filename}.pdf"
        
        # Check uploads
        uploads_path = os.path.join(self.uploads_dir, pdf_filename)
        if os.path.exists(uploads_path):
            return {
                'path': uploads_path,
                'exists': True,
                'location': 'uploads',
                'base_name': base_name
            }
        

        
        # Check batch directories
        batch_info = self.find_batch_files(filename)
        if batch_info and batch_info.get('pdf'):
            return {
                'path': batch_info['pdf'],
                'exists': True,
                'location': 'batch',
                'base_name': base_name,
                'batch_info': batch_info
            }
        
        return None
    
# Create a global instance that will be initialized later
file_finder = None

def get_file_finder():
    """Get the file finder instance, initializing it if needed"""
    global file_finder
    if file_finder is None:
        #from flask import current_app
        file_finder = DocumentFileFinder()
    return file_finder

# Convenience functions that use the lazy-loaded instance
def find_document_file(filename: str, file_type: str) -> Optional[str]:
    """Quick function to get just the file path"""
    result = get_file_finder().find_file(filename, file_type)
    return result['path'] if result else None

def find_all_document_files(filename: str) -> Dict[str, Optional[str]]:
    """Quick function to get all file paths for a document"""
    all_files = get_file_finder().find_all_files(filename)
    return {file_type: (info['path'] if info else None) 
            for file_type, info in all_files.items()}

def document_exists(filename: str) -> bool:
    """Check if a document PDF exists anywhere"""
    return find_document_file(filename, 'pdf') is not None

def get_document_info(filename: str) -> Dict:
    """Get comprehensive document information"""
    return get_file_finder().get_document_info(filename)