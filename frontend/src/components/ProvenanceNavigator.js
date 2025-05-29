import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faChevronLeft, 
  faChevronRight, 
  faHighlighter, 
  faComment,
  faSpinner,
  faFileAlt,
  faExclamationTriangle,
  faEye
} from '@fortawesome/free-solid-svg-icons';

const ProvenanceNavigator = ({ 
  pdfDocument,
  onProvenanceSelect,
  onFeedbackRequest,
  onHighlightInPDF,
  currentSession 
}) => {
  const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);

  // Get the active question and its provenance data
  const activeQuestion = pdfDocument?.activeQuestionId 
    ? pdfDocument.questions.get(pdfDocument.activeQuestionId)
    : null;

  // Get the top 5 provenance sources from the active question
  const availableProvenances = activeQuestion?.provenanceSources?.slice(0, 5) || [];
  const currentProvenance = availableProvenances[currentProvenanceIndex];

  // Reset provenance index when active question changes
  useEffect(() => {
    setCurrentProvenanceIndex(0);
    if (availableProvenances.length > 0) {
      onProvenanceSelect?.(availableProvenances[0]);
    }
  }, [pdfDocument?.activeQuestionId, availableProvenances.length]);

  // Auto-select provenance when index changes
  useEffect(() => {
    if (currentProvenance) {
      onProvenanceSelect?.(currentProvenance);
    }
  }, [currentProvenanceIndex, currentProvenance]);

  const handlePreviousProvenance = () => {
    if (currentProvenanceIndex > 0) {
      setCurrentProvenanceIndex(prev => prev - 1);
    }
  };

  const handleNextProvenance = () => {
    if (currentProvenanceIndex < availableProvenances.length - 1) {
      setCurrentProvenanceIndex(prev => prev + 1);
    }
  };

  const handleHighlightInPDF = () => {
    if (currentProvenance) {
      onHighlightInPDF?.(currentProvenance);
    }
  };

  const handleFeedback = () => {
    if (activeQuestion) {
      onFeedbackRequest?.(activeQuestion);
    }
  };

  const isProcessing = activeQuestion?.isProcessing || false;

  // No document loaded
  if (!pdfDocument) {
    return (
      <div className="provenance-navigator empty">
        <div className="empty-state">
          <FontAwesomeIcon icon={faFileAlt} size="2x" />
          <h4>No Document Loaded</h4>
          <p>Upload or select a document to see evidence sources</p>
        </div>
      </div>
    );
  }

  // No active question
  if (!activeQuestion) {
    return (
      <div className="provenance-navigator empty">
        <div className="empty-state">
          <FontAwesomeIcon icon={faEye} size="2x" />
          <h4>No Question Selected</h4>
          <p>Ask a question to see evidence-based provenance</p>
        </div>
      </div>
    );
  }

  // Question is processing but no provenance yet
  if (isProcessing && availableProvenances.length === 0) {
    return (
      <div className="provenance-navigator processing">
        <div className="processing-state">
          <FontAwesomeIcon icon={faSpinner} spin size="2x" />
          <h4>Searching for Evidence</h4>
          <p>Analyzing document to find supporting evidence...</p>
          
          {activeQuestion.logs && activeQuestion.logs.length > 0 && (
            <div className="processing-logs">
              <h5>Processing Status:</h5>
              <div className="logs-container">
                {activeQuestion.logs.slice(-3).map((log, idx) => (
                  <div key={idx} className="log-entry">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Error state - question completed but no results
  if (!isProcessing && availableProvenances.length === 0 && !activeQuestion.answer) {
    return (
      <div className="provenance-navigator error">
        <div className="error-state">
          <FontAwesomeIcon icon={faExclamationTriangle} size="2x" />
          <h4>No Evidence Found</h4>
          <p>Unable to find supporting evidence for this question</p>
        </div>
      </div>
    );
  }

  // Main provenance navigator - only show if we have provenance
  if (availableProvenances.length === 0) {
    return (
      <div className="provenance-navigator waiting">
        <div className="waiting-state">
          <FontAwesomeIcon icon={faSpinner} spin />
          <p>Waiting for evidence sources...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="provenance-navigator active">
      {/* Provenance Header */}
      <div className="provenance-header">
        <div className="section-header">
          <FontAwesomeIcon icon={faHighlighter} />
          <h4>Evidence Sources</h4>
          {currentSession && (
            <span className="session-badge">
              Session: {currentSession.session_id?.split('_')[1] || 'Active'}
            </span>
          )}
        </div>
        
        <div className="provenance-counter">
          Evidence {currentProvenanceIndex + 1} of {Math.min(availableProvenances.length, 5)}
          {isProcessing && availableProvenances.length < 5 && (
            <span className="loading-indicator">
              <FontAwesomeIcon icon={faSpinner} spin />
              Loading more...
            </span>
          )}
        </div>
      </div>

      {/* Provenance Navigation */}
      <div className="provenance-navigation">
        <button 
          className="nav-btn prev"
          onClick={handlePreviousProvenance}
          disabled={currentProvenanceIndex === 0}
          title="Previous evidence"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
          <span>Previous</span>
        </button>
        
        <div className="provenance-dots">
          {availableProvenances.slice(0, 5).map((_, index) => (
            <button
              key={index}
              className={`dot ${index === currentProvenanceIndex ? 'active' : ''}`}
              onClick={() => setCurrentProvenanceIndex(index)}
              title={`Evidence ${index + 1}`}
            />
          ))}
        </div>
        
        <button 
          className="nav-btn next"
          onClick={handleNextProvenance}
          disabled={currentProvenanceIndex === availableProvenances.length - 1}
          title="Next evidence"
        >
          <span>Next</span>
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>

      {/* Current Provenance Display */}
      {currentProvenance && (
        <div className="current-provenance">
          {/* Provenance Metadata */}
          <div className="provenance-meta">
            <div className="meta-row">
              <span className="meta-label">Provenance ID:</span>
              <span className="meta-value">{currentProvenance.provenance_id || currentProvenanceIndex + 1}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Sentences:</span>
              <span className="meta-value">{currentProvenance.sentences_ids?.length || 0} sentences</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Processing Time:</span>
              <span className="meta-value">{currentProvenance.time?.toFixed(2) || 'N/A'}s</span>
            </div>
            {(currentProvenance.input_token_size || currentProvenance.output_token_size) && (
              <div className="meta-row">
                <span className="meta-label">Tokens:</span>
                <span className="meta-value">
                  In: {currentProvenance.input_token_size || 0}, Out: {currentProvenance.output_token_size || 0}
                </span>
              </div>
            )}
          </div>

          {/* Evidence Text */}
          <div className="evidence-content">
            <div className="evidence-header">
              <FontAwesomeIcon icon={faFileAlt} />
              <span>Evidence Text</span>
            </div>
            
            <div className="evidence-text">
              {currentProvenance.content ? (
                Array.isArray(currentProvenance.content) 
                  ? currentProvenance.content.map((sentence, idx) => (
                      <div key={idx} className="evidence-sentence">
                        <span className="sentence-number">{idx + 1}.</span>
                        <span className="sentence-text">{sentence}</span>
                      </div>
                    ))
                  : (
                    <div className="evidence-sentence">
                      <span className="sentence-text">{currentProvenance.content}</span>
                    </div>
                  )
              ) : (
                <div className="loading-evidence">
                  <FontAwesomeIcon icon={faSpinner} spin />
                  <span>Loading evidence content...</span>
                </div>
              )}
            </div>
          </div>

          {/* Provenance Actions */}
          <div className="provenance-actions">
            <button 
              className="action-btn primary highlight-btn"
              onClick={handleHighlightInPDF}
              title="Highlight this evidence in the PDF viewer"
            >
              <FontAwesomeIcon icon={faHighlighter} />
              <span>Highlight in PDF</span>
            </button>
            
            <button 
              className="action-btn secondary feedback-btn"
              onClick={handleFeedback}
              title="Provide feedback on this analysis"
            >
              <FontAwesomeIcon icon={faComment} />
              <span>Provide Feedback</span>
            </button>
          </div>
        </div>
      )}

      {/* Progressive Loading Indicator */}
      {isProcessing && availableProvenances.length > 0 && (
        <div className="progressive-loading">
          <div className="loading-bar">
            <div className="loading-progress" />
          </div>
          <span className="loading-text">
            <FontAwesomeIcon icon={faSpinner} spin />
            Loading additional evidence sources...
          </span>
        </div>
      )}
    </div>
  );
};

export default ProvenanceNavigator;