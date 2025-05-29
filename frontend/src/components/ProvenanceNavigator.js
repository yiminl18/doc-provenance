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
  faEye,
  faInfoCircle,
  faClock,
  faQuestionCircle
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

  // Get processing status and special messages
  const isProcessing = activeQuestion?.isProcessing || false;
  const processingStatus = activeQuestion?.processingStatus || 'processing';
  const userMessage = activeQuestion?.userMessage;
  const explanation = activeQuestion?.explanation;

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

  // Handle special processing states
  if (processingStatus === 'no_provenance_found' || (userMessage && userMessage.includes('No atomic evidence'))) {
    return (
      <div className="provenance-navigator no-provenance">
        <div className="no-provenance-state">
          <FontAwesomeIcon icon={faQuestionCircle} size="2x" />
          <h4>No Atomic Evidence Found</h4>
          <p>The document cannot be broken into smaller atomic units to answer this question.</p>
          
          <div className="explanation-box">
            <FontAwesomeIcon icon={faInfoCircle} />
            <div>
              <strong>This may happen when:</strong>
              <ul>
                <li>The answer requires synthesis across the entire document</li>
                <li>The question is too abstract or general</li>
                <li>The required information is not present in the document</li>
                <li>The document structure doesn't align with the question's granularity</li>
              </ul>
            </div>
          </div>
          
          <div className="suggestion-box">
            <strong>Try:</strong> Ask more specific questions, or break your question into smaller parts.
          </div>
          
          <button 
            className="action-btn feedback-btn"
            onClick={handleFeedback}
          >
            <FontAwesomeIcon icon={faComment} />
            Provide Feedback
          </button>
        </div>
      </div>
    );
  }

  if (processingStatus === 'timeout' || (userMessage && userMessage.includes('timed out'))) {
    return (
      <div className="provenance-navigator timeout">
        <div className="timeout-state">
          <FontAwesomeIcon icon={faClock} size="2x" />
          <h4>Processing Timed Out</h4>
          <p>The document analysis took too long to complete.</p>
          
          <div className="explanation-box">
            <FontAwesomeIcon icon={faInfoCircle} />
            <div>
              The document may be too large or complex for atomic provenance analysis.
              Consider asking more specific questions or using shorter documents.
            </div>
          </div>
          
          <button 
            className="action-btn feedback-btn"
            onClick={handleFeedback}
          >
            <FontAwesomeIcon icon={faComment} />
            Provide Feedback
          </button>
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
  if (!isProcessing && availableProvenances.length === 0 && !activeQuestion.answer && !explanation) {
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
          {/* Show hidden results indicator */}
          {activeQuestion?.hiddenResultsMessage && (
            <div className="hidden-results-indicator">
              <FontAwesomeIcon icon={faInfoCircle} />
              <span className="hidden-results-text">
                {activeQuestion.hiddenResultsMessage}
              </span>
            </div>
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

          {/* Evidence Text - This is the key fix */}
          <div className="evidence-content">
            <div className="evidence-header">
              <FontAwesomeIcon icon={faFileAlt} />
              <span>Evidence Text</span>
            </div>
            
            <div className="evidence-text">
              {currentProvenance.content && currentProvenance.content.length > 0 ? (
                <div className="evidence-sentences">
                  {Array.isArray(currentProvenance.content) ? (
                    currentProvenance.content.map((sentence, idx) => (
                      <div key={idx} className="evidence-sentence">
                        <span className="sentence-number">{idx + 1}.</span>
                        <span className="sentence-text">{sentence}</span>
                      </div>
                    ))
                  ) : (
                    <div className="evidence-sentence">
                      <span className="sentence-text">{currentProvenance.content}</span>
                    </div>
                  )}
                </div>
              ) : currentProvenance.sentences_ids && currentProvenance.sentences_ids.length > 0 ? (
                <div className="loading-evidence">
                  <FontAwesomeIcon icon={faSpinner} spin />
                  <span>Loading evidence content...</span>
                  <div className="evidence-ids">
                    Sentence IDs: {currentProvenance.sentences_ids.join(', ')}
                  </div>
                </div>
              ) : (
                <div className="no-evidence">
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  <span>No evidence content available</span>
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
              disabled={!currentProvenance.content || currentProvenance.content.length === 0}
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
            Loading additional evidence sources... ({availableProvenances.length}/5)
          </span>
        </div>
      )}

      {/* Enhanced Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .provenance-navigator {
            height: 100%;
            display: flex;
            flex-direction: column;
            background: white;
            font-family: var(--font-display, -apple-system, BlinkMacSystemFont, sans-serif);
          }
          
          .provenance-navigator.no-provenance,
          .provenance-navigator.timeout {
            justify-content: center;
            align-items: center;
            padding: 20px;
            text-align: center;
          }
          
          .no-provenance-state,
          .timeout-state {
            max-width: 400px;
            color: #666;
          }
          
          .no-provenance-state h4,
          .timeout-state h4 {
            color: #333;
            margin: 16px 0;
          }
          
          .explanation-box {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            text-align: left;
            display: flex;
            gap: 12px;
            align-items: flex-start;
          }
          
          .explanation-box svg {
            color: #007bff;
            margin-top: 2px;
            flex-shrink: 0;
          }
          
          .explanation-box ul {
            margin: 8px 0 0 0;
            padding-left: 16px;
          }
          
          .explanation-box li {
            margin-bottom: 4px;
          }
          
          .suggestion-box {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            border-radius: 8px;
            padding: 12px;
            margin: 16px 0;
            color: #155724;
          }
          
          .evidence-content {
            flex: 1;
            margin: 16px 0;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            overflow: hidden;
          }
          
          .evidence-header {
            background: #f8f9fa;
            padding: 12px 16px;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: bold;
            color: #495057;
          }
          
          .evidence-text {
            padding: 16px;
            max-height: 300px;
            overflow-y: auto;
          }
          
          .evidence-sentences {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          
          .evidence-sentence {
            display: flex;
            gap: 12px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 6px;
            border-left: 4px solid #007bff;
          }
          
          .sentence-number {
            font-weight: bold;
            color: #007bff;
            min-width: 24px;
            font-family: monospace;
          }
          
          .sentence-text {
            flex: 1;
            line-height: 1.5;
            font-family: 'Times New Roman', serif;
          }
          
          .loading-evidence,
          .no-evidence {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 20px;
            color: #666;
          }
          
          .evidence-ids {
            font-family: monospace;
            font-size: 12px;
            color: #999;
            background: #f8f9fa;
            padding: 4px 8px;
            border-radius: 4px;
            margin-top: 8px;
          }
          
          .provenance-actions {
            display: flex;
            gap: 12px;
            margin-top: 16px;
          }
          
          .action-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            border-radius: 6px;
            border: none;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            flex: 1;
            justify-content: center;
          }
          
          .action-btn.primary {
            background: #007bff;
            color: white;
          }
          
          .action-btn.primary:hover:not(:disabled) {
            background: #0056b3;
          }
          
          .action-btn.secondary {
            background: #6c757d;
            color: white;
          }
          
          .action-btn.secondary:hover:not(:disabled) {
            background: #545b62;
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .progressive-loading {
            margin-top: 16px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 6px;
            text-align: center;
          }
          
          .loading-bar {
            height: 4px;
            background: #e9ecef;
            border-radius: 2px;
            margin-bottom: 8px;
            overflow: hidden;
          }
          
          .loading-progress {
            height: 100%;
            background: linear-gradient(90deg, #007bff, #28a745, #007bff);
            background-size: 200% 100%;
            animation: loading-wave 2s infinite;
          }
          
          @keyframes loading-wave {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          
          .hidden-results-indicator {
            background: #e3f2fd;
            border: 1px solid #2196F3;
            border-radius: 6px;
            padding: 8px 12px;
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: #1976d2;
          }
          
          .hidden-results-text {
            font-weight: 500;
          }
          
          .loading-text {
            font-size: 12px;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }
        `
      }} />
    </div>
  );
};

export default ProvenanceNavigator;