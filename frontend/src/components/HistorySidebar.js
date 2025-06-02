import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faHistory,
  faFileAlt, 
  faQuestionCircle,
  faCheck,
  faClock,
  faSpinner,
  faExclamationTriangle,
  faChevronDown,
  faChevronRight,
  faSearch,
  faEye,
  faArrowRight,
  faTimes,
  faTrash,
  faHighlighter,
  faComment,
  faUpload,
  faDatabase
} from '@fortawesome/free-solid-svg-icons';
import '../styles/history-sidebar.css';

const HistorySidebar = ({ 
  documents, 
  activeDocumentId, 
  onDocumentSelect,
  onUploadNewDocument,
  onShowPreloaded,
  questionsHistory,
  activeQuestionId,
  onQuestionSelect,
  onQuestionDelete,
  onProvenanceSelect,
  onFeedbackRequest
}) => {
  const [documentsExpanded, setDocumentsExpanded] = useState(true);
  const [questionsExpanded, setQuestionsExpanded] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedQuestions, setCollapsedQuestions] = useState(new Set());
  const [selectedQuestionModal, setSelectedQuestionModal] = useState(null);

  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const questionsArray = Array.from(questionsHistory.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const filteredQuestions = questionsArray.filter(q =>
    q.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

   // Auto-collapse completed questions by default to keep sidebar clean
  useEffect(() => {
    const newCollapsed = new Set();
    questionsArray.forEach(question => {
      if ((question.answer || question.provenanceSources?.length > 0) && 
          question.id !== activeQuestionId) {
        newCollapsed.add(question.id);
      }
    });
    setCollapsedQuestions(newCollapsed);
  }, [questionsArray.length, activeQuestionId]);

  const toggleQuestionCollapse = (questionId) => {
    setCollapsedQuestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const formatFileName = (filename) => {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    if (nameWithoutExt.length > 15) {
      return nameWithoutExt.substring(0, 12) + '...';
    }
    return nameWithoutExt;
  };

  const formatTimestamp = (date) => {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'NOW';
    if (diffMins < 60) return `${diffMins}M`;
    if (diffHours < 24) return `${diffHours}H`;
    if (diffDays < 7) return `${diffDays}D`;
    return date.toLocaleDateString().replace(/\//g, '.');
  };

  const getQuestionStatus = (question) => {
    if (question.processingStatus === 'error') {
      return {
        icon: faExclamationTriangle,
        color: '#dc3545',
        spin: false,
        text: 'Error',
        className: 'error'
      };
    } else if (question.isProcessing) {
      return {
        icon: faSpinner,
        color: '#ff9500',
        spin: true,
        text: 'Processing...',
        className: 'processing'
      };
    } else if (question.answer || question.provenanceSources?.length > 0) {
      return {
        icon: faCheck,
        color: '#28a745',
        spin: false,
        text: 'Completed',
        className: 'completed'
      };
    } else {
      return {
        icon: faClock,
        color: '#6c757d',
        spin: false,
        text: 'Pending',
        className: 'pending'
      };
    }
  };

  return (
    <div className="history-sidebar">
      {/* Documents History Section */}
      <div className="history-section">
        <div 
          className="section-header clickable"
          onClick={() => setDocumentsExpanded(!documentsExpanded)}
        >
          <FontAwesomeIcon 
            icon={documentsExpanded ? faChevronDown : faChevronRight} 
            className="expand-icon"
          />
          <FontAwesomeIcon icon={faFileAlt} />
          <span className="section-title">DOCUMENTS</span>
          <span className="item-count">({documentList.length})</span>
        </div>

        {documentsExpanded && (
          <div className="section-content">
            <div className="history-list">
              {documentList.length === 0 ? (
                <div className="empty-section">
                  <FontAwesomeIcon icon={faFileAlt} className="empty-icon" />
                  <span className="empty-text">No active documents</span>
                  <span className="empty-hint">Upload or browse to get started</span>
                </div>
              ) : (
                documentList.map((doc) => {
                  const isActive = doc.id === activeDocumentId;
                  
                  return (
                    <div
                      key={doc.id}
                      className={`history-item document-item ${isActive ? 'active' : ''}`}
                      onClick={() => onDocumentSelect(doc.id)}
                    >
                      <div className="item-header">
                        <div className="item-icon">
                          <FontAwesomeIcon icon={faFileAlt} />
                        </div>
                        <div className="item-content">
                          <div className="item-name" title={doc.filename}>
                            {formatFileName(doc.filename)}
                          </div>
                          <div className="item-meta">
                            <span className="timestamp">
                              {formatTimestamp(new Date(doc.createdAt))}
                            </span>
                            {doc.isSessionDocument && (
                              <span className="session-badge">📚</span>
                            )}
                            {doc.sentenceCount && (
                              <span className="stat">{doc.sentenceCount} sentences</span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {doc.uploadStatus && !doc.uploadStatus.success && (
                        <div className="status-indicator error">⚠️</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Questions History Section */}
      <div className="history-section">
        <div 
          className="section-header clickable"
          onClick={() => setQuestionsExpanded(!questionsExpanded)}
        >
          <FontAwesomeIcon 
            icon={questionsExpanded ? faChevronDown : faChevronRight} 
            className="expand-icon"
          />
          <FontAwesomeIcon icon={faQuestionCircle} />
          <span className="section-title">QUESTIONS</span>
          <span className="item-count">({questionsArray.length})</span>
        </div>

        {questionsExpanded && (
          <div className="section-content">
 

           {/* Questions List with Scrolling */}
            <div className="history-list questions-scrollable">
              {filteredQuestions.length === 0 ? (
                <div className="empty-section">
                  <FontAwesomeIcon icon={faQuestionCircle} className="empty-icon" />
                  <span className="empty-text">
                    {searchTerm ? 'No matching questions' : 'No active questions'}
                  </span>
                  {!searchTerm && (
                    <span className="empty-hint">Ask questions to see history</span>
                  )}
                </div>
              ) : (
                filteredQuestions.map((question) => {
                  const status = getQuestionStatus(question);
                  const isActive = question.id === activeQuestionId;
                  const isCollapsed = collapsedQuestions.has(question.id);
                  const hasDetails = question.answer || question.provenanceSources?.length > 0;

                  return (
                    <div
                      key={question.id}
                      className={`history-item question-item ${status.className} ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
                    >
                      <div className="item-header" onClick={() => onQuestionSelect(question.id)}>
                        <div className="item-icon">
                          <FontAwesomeIcon
                            icon={status.icon}
                            spin={status.spin}
                            style={{ color: status.color }}
                          />
                        </div>
                        <div className="item-content">
                          <div className="item-name question-text">
                            {question.text.length > 45 
                              ? `${question.text.substring(0, 42)}...`
                              : question.text
                            }
                          </div>
                          <div className="item-meta compact">
                            <span className="timestamp">
                              {formatTimestamp(new Date(question.createdAt))}
                            </span>
                            <span className="status-text">{status.text}</span>
                            {question.provenanceSources?.length > 0 && (
                              <span className="provenance-count">
                                {question.provenanceSources.length} sources
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Action buttons */}
                        <div className="question-actions-header">
                          {/* Detail modal button */}
                          {hasDetails && (
                            <button
                              className="action-btn detail-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedQuestionModal(question);
                              }}
                              title="View full details"
                            >
                              <FontAwesomeIcon icon={faEye} />
                            </button>
                          )}
                          
                          {/* Collapse toggle button */}
                          {hasDetails && (
                            <button
                              className="action-btn collapse-toggle"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleQuestionCollapse(question.id);
                              }}
                              title={isCollapsed ? "Expand details" : "Collapse details"}
                            >
                              <FontAwesomeIcon 
                                icon={isCollapsed ? faChevronRight : faChevronDown} 
                              />
                            </button>
                          )}
                          
                          {/* Delete button */}
                          <button
                            className="action-btn delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuestionDelete(question.id);
                            }}
                            title="Delete question"
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Question Details */}
                      {!isCollapsed && hasDetails && (
                        <div className="question-details">
                          {question.answer && (
                            <div className="answer-preview">
                              {question.answer.length > 80
                                ? `${question.answer.substring(0, 77)}...`
                                : question.answer}
                            </div>
                          )}

                          {/* Compact Provenance Previews */}
                          {question.provenanceSources?.length > 0 && (
                            <div className="provenance-previews compact">
                              <div className="provenance-list">
                                {question.provenanceSources.slice(0, 2).map((prov, idx) => (
                                  <button
                                    key={prov.provenance_id || idx}
                                    className="provenance-preview-btn compact"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onProvenanceSelect(prov);
                                    }}
                                    title={`View provenance ${idx + 1}`}
                                  >
                                    <FontAwesomeIcon icon={faHighlighter} />
                                    <span>Source {idx + 1}</span>
                                    {prov.sentences_ids && (
                                      <span className="sentence-count">
                                        ({prov.sentences_ids.length})
                                      </span>
                                    )}
                                  </button>
                                ))}
                                {question.provenanceSources.length > 2 && (
                                  <button
                                    className="more-indicator-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedQuestionModal(question);
                                    }}
                                  >
                                    +{question.provenanceSources.length - 2} more
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Question Detail Modal */}
      {selectedQuestionModal && (
        <div className="modal-overlay" onClick={() => setSelectedQuestionModal(null)}>
          <div className="question-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h4>Question Details</h4>
              <button 
                className="close-btn" 
                onClick={() => setSelectedQuestionModal(null)}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            
            <div className="modal-body">
              {/* Question */}
              <div className="question-full-section">
                <h5><FontAwesomeIcon icon={faQuestionCircle} /> Question:</h5>
                <div className="question-full-text">{selectedQuestionModal.text}</div>
                <div className="question-meta">
                  <span>Asked: {formatTimestamp(new Date(selectedQuestionModal.createdAt))}</span>
                  {selectedQuestionModal.processingTime && (
                    <span>Processing time: {selectedQuestionModal.processingTime.toFixed(1)}s</span>
                  )}
                </div>
              </div>
              
              {/* Answer */}
              {selectedQuestionModal.answer && (
                <div className="answer-full-section">
                  <h5><FontAwesomeIcon icon={faCheck} /> Answer:</h5>
                  <div className="answer-full-text">{selectedQuestionModal.answer}</div>
                </div>
              )}
              
              {/* Evidence Sources */}
              {selectedQuestionModal.provenanceSources?.length > 0 && (
                <div className="provenances-full-section">
                  <h5>
                    <FontAwesomeIcon icon={faHighlighter} /> 
                    Evidence Sources ({selectedQuestionModal.provenanceSources.length})
                  </h5>
                  <div className="provenances-full-list">
                    {selectedQuestionModal.provenanceSources.map((prov, idx) => (
                      <div key={prov.provenance_id || idx} className="provenance-item">
                        <div className="provenance-header">
                          <span className="provenance-label">Source {idx + 1}</span>
                          <div className="provenance-meta">
                            {prov.time && <span>Time: {prov.time.toFixed(2)}s</span>}
                            {prov.sentences_ids && (
                              <span>Sentences: {prov.sentences_ids.length}</span>
                            )}
                          </div>
                          <button
                            className="highlight-btn"
                            onClick={() => {
                              onProvenanceSelect(prov);
                              setSelectedQuestionModal(null);
                            }}
                          >
                            <FontAwesomeIcon icon={faHighlighter} />
                            Highlight
                          </button>
                        </div>
                        <div className="provenance-content">
                          {prov.content?.map((sentence, sentenceIdx) => (
                            <p key={sentenceIdx} className="evidence-sentence">
                              <span className="sentence-number">{sentenceIdx + 1}.</span>
                              <span className="sentence-text">{sentence}</span>
                            </p>
                          )) || <p className="no-content">Content not available</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn-secondary"
                onClick={() => setSelectedQuestionModal(null)}
              >
                Close
              </button>
              
              <button 
                className="btn-primary"
                onClick={() => {
                  onQuestionSelect(selectedQuestionModal.id);
                  setSelectedQuestionModal(null);
                }}
              >
                <FontAwesomeIcon icon={faArrowRight} />
                Select Question
              </button>
              
              {selectedQuestionModal.provenanceSources?.length > 0 && (
                <button 
                  className="btn-accent"
                  onClick={() => {
                    onFeedbackRequest(selectedQuestionModal);
                    setSelectedQuestionModal(null);
                  }}
                >
                  <FontAwesomeIcon icon={faComment} />
                  Provide Feedback
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistorySidebar;