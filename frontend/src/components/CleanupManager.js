import React, { useState, useEffect } from 'react';
import '../styles/cleanup-manager.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTrash,
  faExclamationTriangle,
  faFolder,
  faQuestionCircle,
  faDatabase,
  faChartLine,
  faBroom,
  faSpinner,
  faCheck,
  faTimes
} from '@fortawesome/free-solid-svg-icons';

const CleanupManager = ({ currentSessionId, onSessionCleared, onClose }) => {
  const [stats, setStats] = useState(null);
  const [currentSessionStats, setCurrentSessionStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [operationInProgress, setOperationInProgress] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState(null);

  useEffect(() => {
    loadStats();
    if (currentSessionId) {
      loadCurrentSessionStats();
    }
  }, [currentSessionId]);

  const loadStats = async () => {
    try {
      const response = await fetch('/api/sessions/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadCurrentSessionStats = async () => {
    try {
      const response = await fetch(`/api/sessions/${currentSessionId}/summary`);
      const data = await response.json();
      if (data.success) {
        setCurrentSessionStats(data.summary);
      }
    } catch (error) {
      console.error('Error loading current session stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleCleanupRequest = (type, sessionId = null, itemId = null) => {
    let confirmationData = {
      type,
      sessionId,
      itemId,
      title: '',
      message: '',
      confirmPhrase: null,
      dangerous: false
    };

    switch (type) {
      case 'current_documents':
        confirmationData = {
          ...confirmationData,
          title: 'Clear Current Session Documents',
          message: `This will remove all processed document data from the current session (${currentSessionId}). Source PDFs will remain untouched.`,
          dangerous: false
        };
        break;
      
      case 'current_questions':
        confirmationData = {
          ...confirmationData,
          title: 'Clear Current Session Questions',
          message: `This will remove all questions and their analysis results from the current session (${currentSessionId}).`,
          dangerous: false
        };
        break;
      
      case 'current_all':
        confirmationData = {
          ...confirmationData,
          title: 'Clear Current Session',
          message: `This will remove ALL processed data from the current session (${currentSessionId}). This includes document processing data and all questions with their provenance analysis.`,
          dangerous: true
        };
        break;
      
      case 'all_sessions':
        confirmationData = {
          ...confirmationData,
          title: 'DELETE ALL SESSIONS',
          message: `This will permanently delete ALL session data from the system. This cannot be undone.`,
          confirmPhrase: 'DELETE_ALL_SESSIONS',
          dangerous: true
        };
        break;
      
      case 'remove_document':
        confirmationData = {
          ...confirmationData,
          title: 'Remove Document',
          message: `Remove this document's processed data from the current session?`,
          dangerous: false
        };
        break;
      
      case 'remove_question':
        confirmationData = {
          ...confirmationData,
          title: 'Remove Question',
          message: `Remove this question and all its analysis results?`,
          dangerous: false
        };
        break;
    }

    setConfirmationModal(confirmationData);
  };

  const executeCleanup = async () => {
    if (!confirmationModal) return;

    // Check confirmation phrase if required
    if (confirmationModal.confirmPhrase) {
      const input = document.getElementById('confirmPhrase');
      if (!input || input.value !== confirmationModal.confirmPhrase) {
        alert('Please type the exact confirmation phrase');
        return;
      }
    }

    setOperationInProgress(true);

    try {
      let url = '';
      let method = 'DELETE';
      let body = { confirm: true };

      const { type, sessionId, itemId } = confirmationModal;

      switch (type) {
        case 'current_documents':
          url = `/api/sessions/${currentSessionId}/cleanup`;
          body.type = 'documents';
          break;
        
        case 'current_questions':
          url = `/api/sessions/${currentSessionId}/cleanup`;
          body.type = 'questions';
          break;
        
        case 'current_all':
          url = `/api/sessions/${currentSessionId}/cleanup`;
          body.type = 'all';
          break;
        
        case 'all_sessions':
          url = '/api/sessions';
          body.confirm_phrase = 'DELETE_ALL_SESSIONS';
          break;
        
        case 'remove_document':
          url = `/api/sessions/${sessionId}/documents/${itemId}`;
          break;
        
        case 'remove_question':
          url = `/api/sessions/${sessionId}/questions/${itemId}`;
          break;
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (result.success) {
        // Refresh stats
        await loadStats();
        if (currentSessionId && type !== 'all_sessions') {
          await loadCurrentSessionStats();
        }

        // Notify parent if session was cleared
        if (type === 'current_all' || type === 'all_sessions') {
          onSessionCleared?.();
        }

        setConfirmationModal(null);
      } else {
        alert(`Cleanup failed: ${result.error}`);
      }

    } catch (error) {
      console.error('Cleanup error:', error);
      alert(`Cleanup failed: ${error.message}`);
    } finally {
      setOperationInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="cleanup-manager loading">
        <FontAwesomeIcon icon={faSpinner} spin />
        <p>Loading cleanup manager...</p>
      </div>
    );
  }

  return (
    <div className="cleanup-manager">
      <div className="cleanup-content">
        <div className="cleanup-header">
          <h3>
            <FontAwesomeIcon icon={faBroom} />
            Data Management
          </h3>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="cleanup-body">
          {/* Current Session Section */}
          {currentSessionStats && (
            <div className="cleanup-section current-session">
              <h4>
                <FontAwesomeIcon icon={faDatabase} />
                Current Session: {currentSessionId}
              </h4>
              
              <div className="session-stats">
                <div className="stat-card">
                  <div className="stat-value">{currentSessionStats.stats.total_documents}</div>
                  <div className="stat-label">Documents Processed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{currentSessionStats.stats.total_questions}</div>
                  <div className="stat-label">Questions Asked</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(currentSessionStats.stats.total_size_bytes)}</div>
                  <div className="stat-label">Storage Used</div>
                </div>
              </div>

              <div className="cleanup-actions">
                <button 
                  className="cleanup-btn documents"
                  onClick={() => handleCleanupRequest('current_documents')}
                  disabled={operationInProgress || currentSessionStats.stats.total_documents === 0}
                >
                  <FontAwesomeIcon icon={faFolder} />
                  Clear Documents ({currentSessionStats.stats.total_documents})
                </button>
                
                <button 
                  className="cleanup-btn questions"
                  onClick={() => handleCleanupRequest('current_questions')}
                  disabled={operationInProgress || currentSessionStats.stats.total_questions === 0}
                >
                  <FontAwesomeIcon icon={faQuestionCircle} />
                  Clear Questions ({currentSessionStats.stats.total_questions})
                </button>
                
                <button 
                  className="cleanup-btn session-all"
                  onClick={() => handleCleanupRequest('current_all')}
                  disabled={operationInProgress || (currentSessionStats.stats.total_documents === 0 && currentSessionStats.stats.total_questions === 0)}
                >
                  <FontAwesomeIcon icon={faBroom} />
                  Clear Entire Session
                </button>
              </div>
            </div>
          )}

          {/* Individual Items Section */}
          {currentSessionStats && (
            <div className="cleanup-section individual-items">
              {/* Documents List */}
              {currentSessionStats.documents.length > 0 && (
                <div className="items-group">
                  <h5>Documents in Current Session</h5>
                  <div className="items-list">
                    {currentSessionStats.documents.map((doc) => (
                      <div key={doc.document_id} className="item-card">
                        <div className="item-info">
                          <div className="item-name">{doc.filename}</div>
                          <div className="item-details">
                            {doc.sentence_count} sentences • {formatBytes(doc.text_length)} text
                          </div>
                          <div className="item-date">
                            Processed: {formatDate(doc.processed_at)}
                          </div>
                        </div>
                        <button 
                          className="remove-item-btn"
                          onClick={() => handleCleanupRequest('remove_document', currentSessionId, doc.document_id)}
                          disabled={operationInProgress}
                          title="Remove this document from session"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Questions List */}
              {currentSessionStats.questions.length > 0 && (
                <div className="items-group">
                  <h5>Questions in Current Session</h5>
                  <div className="items-list">
                    {currentSessionStats.questions.map((question) => (
                      <div key={question.question_id} className="item-card">
                        <div className="item-info">
                          <div className="item-name">
                            {question.question_text.length > 60 
                              ? question.question_text.substring(0, 60) + '...'
                              : question.question_text
                            }
                          </div>
                          <div className="item-details">
                            Status: {question.status} • {question.provenance_count || 0} provenance entries
                          </div>
                          <div className="item-date">
                            Asked: {formatDate(question.created_at)}
                          </div>
                        </div>
                        <button 
                          className="remove-item-btn"
                          onClick={() => handleCleanupRequest('remove_question', currentSessionId, question.question_id)}
                          disabled={operationInProgress}
                          title="Remove this question"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Global Stats Section */}
          {stats && (
            <div className="cleanup-section global-stats">
              <h4>
                <FontAwesomeIcon icon={faChartLine} />
                System Overview
              </h4>
              
              <div className="global-stats-grid">
                <div className="stat-card">
                  <div className="stat-value">{stats.total_sessions}</div>
                  <div className="stat-label">Total Sessions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.total_documents}</div>
                  <div className="stat-label">Documents Processed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.total_questions}</div>
                  <div className="stat-label">Questions Asked</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{formatBytes(stats.total_size_bytes)}</div>
                  <div className="stat-label">Total Storage</div>
                </div>
              </div>

              {stats.total_sessions > 0 && (
                <div className="nuclear-option">
                  <button 
                    className="cleanup-btn nuclear"
                    onClick={() => handleCleanupRequest('all_sessions')}
                    disabled={operationInProgress}
                  >
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    DELETE ALL SESSIONS
                  </button>
                  <p className="nuclear-warning">
                    ⚠️ This will permanently delete all session data and cannot be undone
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmationModal && (
        <div className="confirmation-modal-overlay">
          <div className={`confirmation-modal ${confirmationModal.dangerous ? 'dangerous' : ''}`}>
            <div className="modal-header">
              <FontAwesomeIcon icon={confirmationModal.dangerous ? faExclamationTriangle : faTrash} />
              <h4>{confirmationModal.title}</h4>
            </div>
            
            <div className="modal-body">
              <p>{confirmationModal.message}</p>
              
              {confirmationModal.confirmPhrase && (
                <div className="confirmation-phrase">
                  <p>Type <strong>{confirmationModal.confirmPhrase}</strong> to confirm:</p>
                  <input 
                    type="text" 
                    placeholder={confirmationModal.confirmPhrase}
                    id="confirmPhrase"
                  />
                </div>
              )}
            </div>
            
            <div className="modal-actions">
              <button 
                className="cancel-btn"
                onClick={() => setConfirmationModal(null)}
                disabled={operationInProgress}
              >
                Cancel
              </button>
              <button 
                className={`confirm-btn ${confirmationModal.dangerous ? 'dangerous' : ''}`}
                onClick={executeCleanup}
                disabled={operationInProgress}
              >
                {operationInProgress ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    Processing...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faCheck} />
                    Confirm
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CleanupManager;