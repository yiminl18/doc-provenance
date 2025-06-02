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
  faTimes,
  faTrash,
  faHighlighter,
  faComment,
  faUpload,
  faDatabase
} from '@fortawesome/free-solid-svg-icons';

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

  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const questionsArray = Array.from(questionsHistory.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const filteredQuestions = questionsArray.filter(q =>
    q.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
            {/* Document Actions */}
            <div className="document-actions">
              <button 
                className="action-btn upload-btn"
                onClick={onUploadNewDocument}
                title="Upload new PDF document"
              >
                <FontAwesomeIcon icon={faUpload} />
                <span>Upload PDF</span>
              </button>
              
              <button 
                className="action-btn browse-btn"
                onClick={onShowPreloaded}
                title="Browse session documents"
              >
                <FontAwesomeIcon icon={faDatabase} />
                <span>Browse Documents</span>
              </button>
            </div>

            <div className="history-list">
              {documentList.length === 0 ? (
                <div className="empty-section">
                  <FontAwesomeIcon icon={faFileAlt} className="empty-icon" />
                  <span className="empty-text">No documents loaded</span>
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
          <FontAwesomeIcon icon={faHistory} />
          <span className="section-title">QUESTIONS</span>
          <span className="item-count">({questionsArray.length})</span>
        </div>

        {questionsExpanded && (
          <div className="section-content">
            {/* Search */}
            {questionsArray.length > 3 && (
              <div className="search-box">
                <FontAwesomeIcon icon={faSearch} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search questions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                {searchTerm && (
                  <button 
                    className="clear-search"
                    onClick={() => setSearchTerm('')}
                  >
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                )}
              </div>
            )}

            {/* Questions List */}
            <div className="history-list">
              {filteredQuestions.length === 0 ? (
                <div className="empty-section">
                  <FontAwesomeIcon icon={faQuestionCircle} className="empty-icon" />
                  <span className="empty-text">
                    {searchTerm ? 'No matching questions' : 'No questions yet'}
                  </span>
                  {!searchTerm && (
                    <span className="empty-hint">Ask questions to see history</span>
                  )}
                </div>
              ) : (
                filteredQuestions.map((question) => {
                  const status = getQuestionStatus(question);
                  const isActive = question.id === activeQuestionId;

                  return (
                    <div
                      key={question.id}
                      className={`history-item question-item ${status.className} ${isActive ? 'active' : ''}`}
                      onClick={() => onQuestionSelect(question.id)}
                    >
                      <div className="item-header">
                        <div className="item-icon">
                          <FontAwesomeIcon
                            icon={status.icon}
                            spin={status.spin}
                            style={{ color: status.color }}
                          />
                        </div>
                        <div className="item-content">
                          <div className="item-name question-text">
                            {question.text.length > 60 
                              ? `${question.text.substring(0, 57)}...`
                              : question.text
                            }
                          </div>
                          <div className="item-meta">
                            <span className="timestamp">
                              {formatTimestamp(new Date(question.createdAt))}
                            </span>
                            <span className="status-text">{status.text}</span>
                          </div>
                        </div>
                      </div>

                      {/* Question Details - Only show for completed questions */}
                      {(question.answer || question.provenanceSources?.length > 0) && (
                        <div className="question-details">
                          {question.answer && (
                            <div className="answer-preview">
                              {question.answer.length > 80
                                ? `${question.answer.substring(0, 77)}...`
                                : question.answer}
                            </div>
                          )}

                          {/* Provenance Previews */}
                          {question.provenanceSources?.length > 0 && (
                            <div className="provenance-previews">
                              <div className="provenance-header">
                                <span className="provenance-count">
                                  {question.provenanceSources.length} evidence sources
                                </span>
                              </div>
                              <div className="provenance-list">
                                {question.provenanceSources.slice(0, 3).map((prov, idx) => (
                                  <button
                                    key={prov.provenance_id || idx}
                                    className="provenance-preview-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onProvenanceSelect(prov);
                                    }}
                                    title={`View evidence ${idx + 1}`}
                                  >
                                    <FontAwesomeIcon icon={faHighlighter} />
                                    <span>Evidence {idx + 1}</span>
                                    {prov.sentences_ids && (
                                      <span className="sentence-count">
                                        ({prov.sentences_ids.length})
                                      </span>
                                    )}
                                  </button>
                                ))}
                                {question.provenanceSources.length > 3 && (
                                  <span className="more-indicator">
                                    +{question.provenanceSources.length - 3} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Question Actions */}
                          <div className="question-actions">
                            {question.provenanceSources?.length > 0 && (
                              <button
                                className="action-btn feedback-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFeedbackRequest(question);
                                }}
                                title="Provide feedback"
                              >
                                <FontAwesomeIcon icon={faComment} />
                              </button>
                            )}
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
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistorySidebar;