import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import '../styles/provenance.css';
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
  faQuestionCircle,
  faSearch,
  faPlay
} from '@fortawesome/free-solid-svg-icons';

const ProvenanceNavigator = ({ 
  pdfDocument,
  onProvenanceSelect,
  onFeedbackRequest,
  onHighlightInPDF,
  currentSession 
}) => {
  const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);
  const [showProvenance, setShowProvenance] = useState(false); // New state to control provenance visibility
  
  // Add refs to prevent infinite loops
  const lastActiveQuestionId = useRef(null);
  const lastProvenanceCount = useRef(0);
  const lastSelectedProvenance = useRef(null);

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
  const hasAnswer = activeQuestion?.answer && activeQuestion.answer.trim().length > 0;

  // Reset provenance index and visibility when active question changes
  useEffect(() => {
    const currentQuestionId = pdfDocument?.activeQuestionId;
    
    // Only reset if the question actually changed
    if (currentQuestionId !== lastActiveQuestionId.current) {
      console.log('🔄 Active question changed, resetting provenance navigator');
      lastActiveQuestionId.current = currentQuestionId;
      setCurrentProvenanceIndex(0);
      setShowProvenance(false); // Reset provenance visibility
      lastProvenanceCount.current = 0;
      lastSelectedProvenance.current = null;
      
      // Clear any existing provenance selection
      onProvenanceSelect?.(null);
    }
  }, [pdfDocument?.activeQuestionId]);

  // Handle provenance updates but only when we're showing provenance
  useEffect(() => {
    if (!showProvenance) return; // Don't auto-select provenance until user requests it
    
    const currentCount = availableProvenances.length;
    
    // Only update if the count actually changed or we have a new provenance to select
    if (currentCount !== lastProvenanceCount.current || 
        (currentProvenance && currentProvenance !== lastSelectedProvenance.current)) {
      
      console.log(`📊 Provenance count changed: ${lastProvenanceCount.current} -> ${currentCount}`);
      lastProvenanceCount.current = currentCount;
      
      if (currentProvenance && currentProvenance !== lastSelectedProvenance.current) {
        console.log('✅ Selecting updated provenance:', currentProvenance);
        onProvenanceSelect?.(currentProvenance);
        onHighlightInPDF?.(currentProvenance);
        lastSelectedProvenance.current = currentProvenance;
      } else if (!currentProvenance && lastSelectedProvenance.current) {
        console.log('❌ No current provenance, clearing selection');
        onProvenanceSelect?.(null);
        lastSelectedProvenance.current = null;
      }
    }
  }, [availableProvenances.length, currentProvenanceIndex, showProvenance]);

  const handleGetProvenance = () => {
    console.log('🔍 User requested provenance, showing navigator');
    setShowProvenance(true);
    
    // Immediately select the first provenance if available
    if (availableProvenances.length > 0) {
      console.log('✅ Selecting first provenance:', availableProvenances[0]);
      onProvenanceSelect?.(availableProvenances[0]);
      onHighlightInPDF?.(availableProvenances[0]);
      lastSelectedProvenance.current = availableProvenances[0];
    }
  };

  const handlePreviousProvenance = () => {
    if (currentProvenanceIndex > 0) {
      const newIndex = currentProvenanceIndex - 1;
      console.log('⬅️ Moving to previous provenance:', newIndex);
      setCurrentProvenanceIndex(newIndex);
    }
  };

  const handleNextProvenance = () => {
    if (currentProvenanceIndex < availableProvenances.length - 1) {
      const newIndex = currentProvenanceIndex + 1;
      console.log('➡️ Moving to next provenance:', newIndex);
      setCurrentProvenanceIndex(newIndex);
    }
  };

  const handleProvenanceDotClick = (index) => {
    console.log('🎯 Clicked provenance dot:', index);
    setCurrentProvenanceIndex(index);
  };

  const handleHighlightInPDF = () => {
    if (currentProvenance) {
      console.log('🔍 Manual highlight request for provenance:', currentProvenance.provenance_id);
      onHighlightInPDF?.(currentProvenance);
    }
  };

  const handleFeedback = () => {
    if (activeQuestion) {
      console.log('💬 Opening feedback for question:', activeQuestion.id);
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
  if (processingStatus === 'no_provenance_found' || processingStatus === 'completed_no_provenance' || 
      (userMessage && userMessage.includes('No atomic evidence'))) {
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
            className="action-btn secondary feedback-btn"
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
            className="action-btn secondary feedback-btn"
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
  if (isProcessing && availableProvenances.length === 0 && !hasAnswer) {
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

  // NEW: Show "Get Provenance" button when we have an answer but haven't started showing provenance
  if (hasAnswer && !showProvenance && (availableProvenances.length > 0 || !isProcessing)) {
    return (
      <div className="provenance-navigator get-provenance">
        <div className="get-provenance-state">
          <FontAwesomeIcon icon={faSearch} size="2x" />
          <h4>Answer Ready</h4>
          <p>Your question has been answered. Would you like to see the supporting evidence?</p>
          
          <div className="answer-preview">
            <div className="answer-label">Answer:</div>
            <div className="answer-text">
              {activeQuestion.answer.length > 200 
                ? `${activeQuestion.answer.substring(0, 200)}...` 
                : activeQuestion.answer}
            </div>
          </div>
          
          <div className="provenance-info">
            {availableProvenances.length > 0 ? (
              <p>✅ {availableProvenances.length} evidence source{availableProvenances.length !== 1 ? 's' : ''} found and ready to explore</p>
            ) : isProcessing ? (
              <p>🔄 Still searching for evidence sources...</p>
            ) : (
              <p>⚠️ No evidence sources found for this answer</p>
            )}
          </div>
          
          <div className="get-provenance-actions">
            <button 
              className="action-btn primary get-provenance-btn"
              onClick={handleGetProvenance}
              disabled={availableProvenances.length === 0 && !isProcessing}
            >
              <FontAwesomeIcon icon={faPlay} />
              <span>Get Evidence Sources</span>
            </button>
            
            <button 
              className="action-btn secondary feedback-btn"
              onClick={handleFeedback}
            >
              <FontAwesomeIcon icon={faComment} />
              <span>Provide Feedback</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state - question completed but no results and no answer
  if (!isProcessing && availableProvenances.length === 0 && !hasAnswer && !explanation) {
    return (
      <div className="provenance-navigator error">
        <div className="error-state">
          <FontAwesomeIcon icon={faExclamationTriangle} size="2x" />
          <h4>No Evidence Found</h4>
          <p>Unable to find supporting evidence for this question</p>
          
          <button 
            className="action-btn secondary feedback-btn"
            onClick={handleFeedback}
          >
            <FontAwesomeIcon icon={faComment} />
            Provide Feedback
          </button>
        </div>
      </div>
    );
  }

  // Still waiting for provenance but we might have an answer
  if (availableProvenances.length === 0 && !showProvenance) {
    return (
      <div className="provenance-navigator waiting">
        <div className="waiting-state">
          <FontAwesomeIcon icon={faSpinner} spin />
          <p>Waiting for evidence sources...</p>
          {hasAnswer && (
            <div className="answer-available">
              <p>✅ Answer is ready! Evidence analysis in progress...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main provenance navigator - only show if user has requested provenance and we have some
  if (!showProvenance || availableProvenances.length === 0) {
    return (
      <div className="provenance-navigator waiting">
        <div className="waiting-state">
          <FontAwesomeIcon icon={faSpinner} spin />
          <p>Loading evidence sources...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="provenance-navigator active">
      {/* Provenance Header */}
      <div className="provenance-header">
        <div className="section-header">
          <h4>
            <FontAwesomeIcon icon={faHighlighter} />
            Evidence Sources
          </h4>
          {currentSession && (
            <span className="session-badge">
              Session: {currentSession.session_id?.split('_')[1] || 'Active'}
            </span>
          )}
        </div>
        
        <div className="provenance-counter">
          <div>
            Evidence {currentProvenanceIndex + 1} of {Math.min(availableProvenances.length, 5)}
            {isProcessing && availableProvenances.length < 5 && (
              <span className="loading-indicator">
                <FontAwesomeIcon icon={faSpinner} spin />
                Loading more...
              </span>
            )}
          </div>
          
          {/* Show completion indicator when done */}
          {!isProcessing && availableProvenances.length > 0 && (
            <div className="completion-indicator">
              ✅ Analysis Complete ({availableProvenances.length} evidence sources found)
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
              onClick={() => handleProvenanceDotClick(index)}
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
              {currentProvenance.content && currentProvenance.content.length > 0 ? (
                <div className="evidence-sentences">
                  {Array.isArray(currentProvenance.content) ? (
                    currentProvenance.content.map((sentence, idx) => (
                      <div key={idx} className="evidence-sentence" data-sentence-id={currentProvenance.sentences_ids?.[idx]}>
                        <span className="sentence-number">{idx + 1}</span>
                        <span className="sentence-text">{sentence}</span>
                      </div>
                    ))
                  ) : (
                    <div className="evidence-sentence" data-sentence-id={currentProvenance.sentences_ids?.[0]}>
                      <span className="sentence-number">1</span>
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
    </div>
  );
};

export default ProvenanceNavigator;