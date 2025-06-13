import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faHistory,
  faQuestionCircle,
  faCheck,
  faClock,
  faSpinner,
  faExclamationTriangle,
  faExclamationCircle,
  faChevronDown,
  faChevronRight,
  faEye,
  faTrash,
  faHighlighter,
  faComment,
  faArrowRight,
  faTimes
} from '@fortawesome/free-solid-svg-icons';
import '../styles/question-history.css'

const QuestionHistory = ({ 
  questionsHistory,
  activeQuestionId,
  onQuestionSelect,
  onQuestionDelete,
  onProvenanceSelect,
  onFeedbackRequest
}) => {
  const [questionsExpanded, setQuestionsExpanded] = useState(true);
  const [collapsedQuestions, setCollapsedQuestions] = useState(new Set());
  const [selectedQuestionModal, setSelectedQuestionModal] = useState(null);

  const questionsArray = Array.from(questionsHistory.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  // Auto-collapse completed questions by default
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
        text: 'Error',
        className: 'error'
      };
    } else if (question.processingStatus === 'cancelled') {
      return {
        icon: faExclamationCircle,
        text: 'Cancelled',
        className: 'cancelled'
      };
    } else if (question.isProcessing) {
      return {
        icon: faSpinner,
        text: 'Processing...',
        className: 'processing',
        spin: true
      };
    } else if (question.answer || question.provenanceSources?.length > 0) {
      return {
        icon: faCheck,
        text: 'Completed',
        className: 'completed'
      };
    } else {
      return {
        icon: faClock,
        text: 'Pending',
        className: 'pending'
      };
    }
  };

  return (
    <div className="history-sidebar">
      {/* Questions Section */}
      <div className="history-header" onClick={() => setQuestionsExpanded(!questionsExpanded)}>
        <h4>
          <FontAwesomeIcon 
            icon={questionsExpanded ? faChevronDown : faChevronRight} 
            className="expand-icon"
          />
          <FontAwesomeIcon icon={faHistory} />
          Questions
        </h4>
        <span className="item-count">({questionsArray.length})</span>
      </div>

      {questionsExpanded && (
        <div className="questions-list">
          {questionsArray.length === 0 ? (
            <div className="empty-section">
              <FontAwesomeIcon icon={faQuestionCircle} className="empty-icon" />
              <span className="empty-text">No Questions Asked</span>
              <span className="empty-hint">Ask questions to see history</span>
            </div>
          ) : (
            questionsArray.map((question) => {
              const status = getQuestionStatus(question);
              const isActive = question.id === activeQuestionId;
              const isCollapsed = collapsedQuestions.has(question.id);
              const hasDetails = question.answer || question.provenanceSources?.length > 0;

              return (
                <div
                  key={question.id}
                  className={`question-item ${status.className} ${isActive ? 'active' : ''}`}
                >
              <div className="question-header" onClick={() => onQuestionSelect(question.id)}>
                    <div className="question-icon">
                      <FontAwesomeIcon
                        icon={status.icon}
                        spin={status.spin}
                      />
                    </div>
                    
                    <div className="question-content">
                      <div className="question-text">
                        {question.text}
                      </div>
                      <div className="question-meta">
                        <span className="status-text">{status.text}</span>
                        {question.provenanceSources?.length > 0 && (
                          <span className="provenance-count">
                            {question.provenanceSources.length} sources
                          </span>
                        )}
                        <span className="timestamp">
                          {formatTimestamp(new Date(question.createdAt))}
                        </span>
                      </div>
                    </div>

                    <div className="question-actions">
                      {/* Detail modal button */}
                      {hasDetails && (
                        <button
                          className="win95-btn detail"
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
                          className="win95-btn collapse-toggle"
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
                        className="win95-btn delete"
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
                        <div className="provenance-previews">
                          {question.provenanceSources.slice(0, 2).map((prov, idx) => (
                            <button
                              key={prov.provenance_id || idx}
                              className="provenance-btn"
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
                              className="more-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedQuestionModal(question);
                              }}
                            >
                              +{question.provenanceSources.length - 2} more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Question Detail Modal */}
      {selectedQuestionModal && (
        <div className="modal-overlay" onClick={() => setSelectedQuestionModal(null)}>
          <div className="modal-container question-detail" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h4>Question Details</h4>
              <button 
                className="win95-btn close" 
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
                <div className="question-meta-full">
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
                        <div className="provenance-header-modal">
                          <span className="provenance-label">Source {idx + 1}</span>
                          <div className="provenance-meta-modal">
                            {prov.time && <span>Time: {prov.time.toFixed(2)}s</span>}
                            {prov.sentences_ids && (
                              <span>Sentences: {prov.sentences_ids.length}</span>
                            )}
                          </div>
                          <button
                            className="win95-btn highlight"
                            onClick={() => {
                              onProvenanceSelect(prov);
                              setSelectedQuestionModal(null);
                            }}
                          >
                            <FontAwesomeIcon icon={faHighlighter} />
                            Highlight
                          </button>
                        </div>
                        <div className="provenance-content-modal">
                          {prov.content?.map((sentence, sentenceIdx) => (
                            <p key={sentenceIdx} className="evidence-sentence-modal">
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
                className="win95-btn secondary"
                onClick={() => setSelectedQuestionModal(null)}
              >
                Close
              </button>
              
              <button 
                className="win95-btn primary"
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
                  className="win95-btn accent"
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

export default QuestionHistory;