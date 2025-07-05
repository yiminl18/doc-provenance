"""
User study logging functionality
Handles logging of user interaction events for research analysis
"""

import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class UserStudyLogger:
    """
    Manages user study event logging with proper file handling and validation
    """
    
    def __init__(self, logs_dir: str):
        self.logs_dir = logs_dir
        os.makedirs(logs_dir, exist_ok=True)
        
        # Set up dedicated user study logger
        self.user_study_logger = self._setup_user_study_logging()
    
    def _setup_user_study_logging(self) -> logging.Logger:
        """Setup dedicated logging for user study events"""
        
        # Create a dedicated logger for user study events
        study_logger = logging.getLogger('user_study')
        study_logger.setLevel(logging.INFO)
        
        # Create file handler with daily rotation
        log_filename = f"{self.logs_dir}/user_study_{datetime.now().strftime('%Y%m%d')}.jsonl"
        file_handler = logging.FileHandler(log_filename)
        file_handler.setLevel(logging.INFO)
        
        # Create formatter for JSON logs
        formatter = logging.Formatter('%(message)s')
        file_handler.setFormatter(formatter)
        
        # Add handler to logger (avoid duplicates)
        if not study_logger.handlers:
            study_logger.addHandler(file_handler)
        
        return study_logger
    
    def log_event(self, event_data: Dict[str, Any], request_obj: Any) -> Dict[str, Any]:
        """
        Log a user study event with validation and enhancement
        """
        try:
            # Validate required fields
            required_fields = ['event_type', 'user_session_id', 'timestamp']
            missing_fields = [field for field in required_fields if field not in event_data]
            
            if missing_fields:
                return {
                    'success': False,
                    'error': f'Missing required fields: {", ".join(missing_fields)}'
                }
            
            # Add server-side metadata
            enhanced_event = {
                **event_data,
                'server_timestamp': datetime.now().timestamp(),
                'server_iso_timestamp': datetime.now().isoformat(),
                'ip_address': request_obj.environ.get('REMOTE_ADDR', 'unknown'),
                'forwarded_for': request_obj.environ.get('HTTP_X_FORWARDED_FOR', None),
                'user_agent': request_obj.environ.get('HTTP_USER_AGENT', event_data.get('user_agent', 'unknown'))
            }
            
            # Log the event as a JSON line
            self.user_study_logger.info(json.dumps(enhanced_event, ensure_ascii=False))
            
            # Also log to console for development
            print(f"📊 User Study Event: {enhanced_event['event_type']} - {enhanced_event['user_session_id']}")
            
            return {
                'success': True,
                'message': 'Event logged successfully',
                'event_type': enhanced_event['event_type'],
                'server_timestamp': enhanced_event['server_timestamp']
            }
            
        except json.JSONDecodeError:
            return {
                'success': False,
                'error': 'Invalid JSON data'
            }
        except Exception as e:
            logger.error(f"❌ Error logging user study event: {str(e)}")
            return {
                'success': False,
                'error': 'Internal server error while logging event'
            }
    
    def get_session_info(self) -> Dict[str, Any]:
        """
        Get session information for the frontend
        Can be used to retrieve algorithm method assignments, etc.
        """
        try:
            session_info = {
                'server_time': datetime.now().isoformat(),
                'algorithm_method': 'default',  # Can implement rotation logic here
                'processing_method': 'session-based',
                'max_provenances': 5,
                'session_id': f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            }
            
            return {
                'success': True,
                'session_info': session_info
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting session info: {str(e)}")
            return {
                'success': False,
                'error': 'Failed to get session info'
            }
    
    def export_logs(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Export user study logs for analysis
        """
        try:
            if not date_str:
                date_str = datetime.now().strftime('%Y%m%d')
            
            log_file = f"{self.logs_dir}/user_study_{date_str}.jsonl"
            
            if not os.path.exists(log_file):
                return {
                    'success': False,
                    'error': f'No log file found for date {date_str}'
                }
            
            # Read and return log file contents
            with open(log_file, 'r', encoding='utf-8') as f:
                log_lines = [json.loads(line.strip()) for line in f if line.strip()]
            
            return {
                'success': True,
                'date': date_str,
                'event_count': len(log_lines),
                'events': log_lines
            }
            
        except Exception as e:
            logger.error(f"❌ Error exporting logs: {str(e)}")
            return {
                'success': False,
                'error': 'Failed to export logs'
            }
    
    def get_stats(self, date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Get basic statistics about user study events
        """
        try:
            if not date_str:
                date_str = datetime.now().strftime('%Y%m%d')
                
            log_file = f"{self.logs_dir}/user_study_{date_str}.jsonl"
            
            if not os.path.exists(log_file):
                return {
                    'success': True,
                    'stats': {
                        'total_events': 0,
                        'unique_sessions': 0,
                        'event_types': {}
                    }
                }
            
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
            
            return {
                'success': True,
                'date': date_str,
                'stats': {
                    'total_events': total_events,
                    'unique_sessions': len(sessions),
                    'event_types': event_types,
                    'most_common_events': sorted(event_types.items(), key=lambda x: x[1], reverse=True)[:10]
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Error getting stats: {str(e)}")
            return {
                'success': False,
                'error': 'Failed to get statistics'
            }
    
    def analyze_session(self, user_session_id: str, date_str: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Analyze events for a specific user session
        """
        if not date_str:
            date_str = datetime.now().strftime('%Y%m%d')
        
        log_file = f"{self.logs_dir}/user_study_{date_str}.jsonl"
        
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