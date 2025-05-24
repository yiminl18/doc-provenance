// Enhanced ProvenanceOutput.js - Key changes for single provenance navigation

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import '../styles/analysis-panel.css'
import { 
  faTerminal, 
  faFileAlt, 
  faClock,
  faComment,
  faChevronLeft,
  faChevronRight,
  faDatabase,
  faEye,
  faThumbsUp,
  faThumbsDown
} from '@fortawesome/free-solid-svg-icons';

const ProvenanceOutput = ({ 
  document, 
  onProvenanceSelect, 
  onFeedbackRequest, 
  onProvenanceFeedback,
  compactMode = false
}) => {
  const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);
  
  // Move all hook calls before any early returns
  const questions = document ? Array.from(document.questions.values()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  ) : [];

  const activeQuestion = document?.activeQuestionId 
    ? document.questions.get(document.activeQuestionId)
    : null;

  // Get available provenances (limit to top 5)
  const availableProvenances = activeQuestion?.provenanceSources?.slice(0, 5) || [];
  const currentProvenance = availableProvenances[currentProvenanceIndex];


  // Reset provenance index when active question changes - MOVED BEFORE EARLY RETURN
  useEffect(() => {
    console.log('useEffect: Active question changed, resetting provenance index');
    setCurrentProvenanceIndex(0);
    // Auto-select first provenance when question completes
    if (availableProvenances.length > 0) {
      console.log('Auto-selecting first provenance:', availableProvenances[0]);
      onProvenanceSelect(availableProvenances[0]);
    }
  }, [document?.activeQuestionId, availableProvenances.length]);

  // Early return AFTER all hooks
  if (!document) {
    return (
      <div className={`provenance-output empty ${compactMode ? 'compact' : ''}`}>
        <div className="empty-state">
          <div className="terminal-prompt">
            <span className="prompt-symbol">$</span>
            <span className="prompt-text">
              {compactMode ? 'SELECT_DOCUMENT' : 'UPLOAD_DOCUMENT_TO_BEGIN'}
            </span>
          </div>
          <div className="empty-message">
            {compactMode ? (
              <>
                No active document.
                <br />
                <span style={{ fontSize: '10px', color: 'var(--terminal-amber)' }}>
                  Upload PDF to start analysis
                </span>
              </>
            ) : (
              <>
                No active document session.
                <br />
                Initialize with PDF upload.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  
 const handleNextProvenance = () => {
    if (currentProvenanceIndex < availableProvenances.length - 1) {
      setCurrentProvenanceIndex(prev => prev + 1);
      // Auto-select the new provenance for PDF highlighting
      if (availableProvenances[currentProvenanceIndex + 1]) {
        console.log('🔍 Selecting next provenance:', availableProvenances[currentProvenanceIndex + 1]);
        onProvenanceSelect && onProvenanceSelect(availableProvenances[currentProvenanceIndex + 1]);
      }
    }
  };

  const handlePreviousProvenance = () => {
    if (currentProvenanceIndex > 0) {
      setCurrentProvenanceIndex(prev => prev - 1);
      // Auto-select the new provenance for PDF highlighting
      if (availableProvenances[currentProvenanceIndex - 1]) {
        console.log('🔍 Selecting previous provenance:', availableProvenances[currentProvenanceIndex - 1]);
        onProvenanceSelect && onProvenanceSelect(availableProvenances[currentProvenanceIndex - 1]);
      }
    }
  };

  const handleProvenanceClick = (provenance) => {
    console.log('🔍 Provenance clicked:', provenance);
    onProvenanceSelect && onProvenanceSelect(provenance);
  };

  // Helper function to parse content into sentences
  const parseProvenanceContent = (content) => {
    if (!content) return [];
    
    if (Array.isArray(content)) {
      // If already an array, process each item
      return content.map(item => {
        if (typeof item === 'string') {
          // Split long strings into sentences
          return item.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        }
        return [String(item)];
      }).flat();
    } else if (typeof content === 'string') {
      // Split string content into sentences
      return content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    }
    
    return [String(content)];
  };


  // Early return AFTER all hooks

  return (
    <div className={`provenance-output ${compactMode ? 'compact' : ''}`}>
      {!compactMode && (
        <div className="output-header">
          <div className="session-info">
            <FontAwesomeIcon icon={faDatabase} />
            <span className="session-text">
              Active Session: {document.filename} | {questions.length} Questions
            </span>
          </div>
        </div>
      )}

      <div className="chat-history">
        {questions.map((question) => {
          // 🔍 ADD MORE DEBUG LOGGING
          const isActiveQuestion = question.id === document.activeQuestionId;
          const hasProvenances = availableProvenances.length > 0;


          return (

          <div key={question.id} className="question-thread">
            
            {/* USER QUERY */}
            <div className="query-block">
              <div className="query-header">
                <FontAwesomeIcon icon={faTerminal} />
                <span className="query-label">QUERY</span>
                {!compactMode && (
                  <span className="query-timestamp">
                    {new Date(question.createdAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div className="query-content">
                {question.text}
              </div>
            </div>

            {/* PROCESSING INDICATOR */}
            {question.isProcessing && (
              <div className="processing-block">
                <div className="processing-header">
                  <div className="processing-indicator">
                    <div className="terminal-cursor"></div>
                    <span>ANALYZING_DOCUMENT...</span>
                  </div>
                </div>
                {!compactMode && (
                  <div className="processing-logs">
                    {question.logs && question.logs.map((log, idx) => (
                      <div key={idx} className="log-entry">
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SYSTEM RESPONSE */}
            {question.answer && (
              <div className="response-block">
                <div className="response-header">
                  <FontAwesomeIcon icon={faFileAlt} />
                  <span className="response-label">RESPONSE</span>
                </div>
                <div className="response-content">
                  {question.answer}
                </div>
              </div>
            )}

            {/* SINGLE PROVENANCE DISPLAY - Only for active question */}
              {isActiveQuestion && hasProvenances && (
                <div className="provenance-section debug-highlight">
                  <div className="provenance-header">
                    <span className="evidence-label">Supporting Evidence</span>
                    <div className="provenance-counter">
                      <span className="current-provenance">
                        {currentProvenanceIndex + 1} of {availableProvenances.length}
                      </span>
                    </div>
                  </div>
                  
                  {/* SINGLE PROVENANCE CARD */}
                  {currentProvenance && (
                    <div className="single-provenance-container">
                      <div 
                        className="provenance-card active"
                        onClick={() => handleProvenanceClick(currentProvenance)}
                      >
                        <div className="provenance-id-bar">
                          <span className="provenance-number">
                            Evidence {String(currentProvenance.provenance_id || currentProvenanceIndex + 1).padStart(2, '0')}
                          </span>
                        </div>
                        
                        <div className="provenance-content">
                          {currentProvenance.content ? (
                            <div className="evidence-text">
                              {(() => {
                                const sentences = parseProvenanceContent(currentProvenance.content);
                                const displayCount = compactMode ? 2 : 3;
                                
                                console.log('🔍 Parsed sentences:', sentences);
                                
                                return (
                                  <>
                                    {sentences.slice(0, displayCount).map((sentence, idx) => (
                                      <p key={idx} className="evidence-sentence">
                                        {compactMode && sentence.length > 150 
                                          ? `${sentence.substring(0, 150)}...`
                                          : sentence
                                        }
                                      </p>
                                    ))}
                                    {sentences.length > displayCount && (
                                      <p className="more-sentences">
                                        +{sentences.length - displayCount} additional sentences
                                      </p>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <div className="loading-evidence">
                              Loading content...
                            </div>
                          )}
                        </div>
                        
                        <div className="provenance-metrics">
                          <div className="metric-item">
                            <FontAwesomeIcon icon={faClock} />
                            <span>{currentProvenance.time ? `${currentProvenance.time.toFixed(2)}s` : 'N/A'}</span>
                          </div>
                          <div className="metric-item">
                            <span>SENTENCES:</span>
                            <span>{currentProvenance.sentences_ids ? currentProvenance.sentences_ids.length : 0}</span>
                          </div>
                          {!compactMode && (
                            <div className="metric-item">
                              <span>TOKENS:</span>
                              <span>{currentProvenance.input_token_size || 0}→{currentProvenance.output_token_size || 0}</span>
                            </div>
                          )}
                        </div>
                    

                      {/* QUICK FEEDBACK BUTTONS */}
                      <div className="quick-feedback">
                        <button 
                          className="quick-feedback-btn positive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onProvenanceFeedback && onProvenanceFeedback(currentProvenance, 'helpful');
                          }}
                          title="Mark as helpful"
                        >
                          <FontAwesomeIcon icon={faThumbsUp} />
                        </button>
                        <button 
                          className="quick-feedback-btn negative"
                          onClick={(e) => {
                            e.stopPropagation();
                            onProvenanceFeedback && onProvenanceFeedback(currentProvenance, 'unhelpful');
                          }}
                          title="Mark as unhelpful"
                        >
                          <FontAwesomeIcon icon={faThumbsDown} />
                        </button>
                      </div>
                    </div>

                    {/* NAVIGATION CONTROLS */}
                    <div className={`provenance-navigation ${compactMode ? 'compact' : ''}`}>
                      <button 
                        className={`nav-btn prev ${compactMode ? 'compact' : ''}`}
                        onClick={handlePreviousProvenance}
                        disabled={currentProvenanceIndex === 0}
                      >
                        <FontAwesomeIcon icon={faChevronLeft} />
                        {!compactMode && <span>Previous</span>}
                      </button>

                      <div className="nav-dots">
                        {availableProvenances.map((_, index) => (
                          <button
                            key={index}
                            className={`nav-dot ${index === currentProvenanceIndex ? 'active' : ''} ${compactMode ? 'compact' : ''}`}
                            onClick={() => {
                              setCurrentProvenanceIndex(index);
                              onProvenanceSelect(availableProvenances[index]);
                            }}
                          />
                        ))}
                      </div>

                      <button 
                        className={`nav-btn next ${compactMode ? 'compact' : ''}`}
                        onClick={handleNextProvenance}
                        disabled={currentProvenanceIndex === availableProvenances.length - 1}
                      >
                        {!compactMode && <span>Next</span>}
                        <FontAwesomeIcon icon={faChevronRight} />
                      </button>
                    </div>
                  </div>
                )}

                {/* DETAILED FEEDBACK SECTION */}
                {!question.isProcessing && availableProvenances.length > 0 && (
                  <div className="feedback-section">
                    {question.feedback ? (
                      <div className="feedback-submitted">
                        <span className="feedback-status">Feedback Submitted</span>
                        <span className="feedback-checkmark">✓</span>
                      </div>
                    ) : (
                      <button 
                        className="feedback-btn detailed"
                        onClick={() => onFeedbackRequest(question)}
                      >
                        <FontAwesomeIcon icon={faComment} />
                        <span>{compactMode ? 'FEEDBACK' : 'PROVIDE_DETAILED_FEEDBACK'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          );
          })}
      </div>
    </div>
  );
};

export default ProvenanceOutput;