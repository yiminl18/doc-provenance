import React, { useState, useRef, useEffect } from 'react';
import '../styles/brutalist-design.css';
import '../styles/question-collection.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal,
  faPaperPlane,
  faHistory,
  faRedo,
  faFileAlt,
  faClock,
  faCheck,
  faSpinner,
  faExclamationTriangle,
  faRefresh
} from '@fortawesome/free-solid-svg-icons';

const QuestionCollection = ({ 
  pdfDocument, 
  onQuestionSubmit, // This should be the function from App.js
  currentSession
}) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const inputRef = useRef(null);
  const historyRef = useRef(null);

  // Get questions history from document
  const questionsHistory = pdfDocument ?
    Array.from(pdfDocument.questions.values()).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    ) : [];

  // Check if currently processing any questions
  const isProcessing = questionsHistory.some(q => q.isProcessing);

  // Enhanced question submission with better error handling
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isSubmitting || isProcessing || !pdfDocument) return;

    const questionText = currentQuestion.trim();
    setCurrentQuestion('');
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      console.log('🔄 Submitting question via QuestionCollection:', questionText);
      
      // Just call the parent's question submit function
      // App.js will handle session vs legacy logic
      if (onQuestionSubmit) {
        await onQuestionSubmit(questionText);
        console.log('✅ Question submitted successfully');
      } else {
        console.error('❌ No onQuestionSubmit function provided');
        throw new Error('Question submission not configured');
      }
      
    } catch (error) {
      console.error('❌ Error submitting question:', error);
      
      // Show user-friendly error message
      let errorMessage = 'Failed to submit question';
      if (error.message.includes('500')) {
        errorMessage = 'Server error - please check your session and try again';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error - please check your connection';
      } else if (error.message.includes('session')) {
        errorMessage = 'Session error - please refresh the page';
      } else {
        errorMessage = error.message;
      }
      
      setSubmitError(errorMessage);
      setCurrentQuestion(questionText); // Restore question text
      
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle re-asking a question
  const handleReask = (questionText) => {
    if (isProcessing || isSubmitting) return;
    setCurrentQuestion(questionText);
    setSubmitError(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Handle retry after error
  const handleRetry = () => {
    setSubmitError(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Handle keyboard shortcuts
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-scroll history to bottom when new questions are added
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [questionsHistory.length]);

  // Focus input when component mounts
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Clear submit error when user starts typing
  useEffect(() => {
    if (submitError && currentQuestion) {
      setSubmitError(null);
    }
  }, [currentQuestion]);

  const formatTimestamp = (date) => {
    return new Date(date).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getQuestionStatus = (question) => {
    if (question.hasError || question.processingStatus === 'error') {
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

  if (!pdfDocument) {
    return (
      <div className="qa-flow-empty">
        <div className="empty-icon">🤔</div>
        <h4>Ready for Questions</h4>
        <p>Upload a document to start asking questions and analyzing provenance.</p>
      </div>
    );
  }

  return (
    <div className="question-collection">
      <div className="question-collection-header">
        <div className="header-left">
          <FontAwesomeIcon icon={faTerminal} />
          <h4>Question Terminal</h4>
        </div>
        <div className="header-right">
          <span className="question-count">
            {questionsHistory.length} questions
          </span>
          {currentSession && (
            <span className="session-indicator">
              Session: {currentSession.session_id?.split('_')[1] || 'Active'}
            </span>
          )}
        </div>
      </div>

      <div className="question-collection-content">
        {/* Question Input Section */}
        <div className="question-input-container">
          <div className="question-input-header">
            <span className="terminal-prompt">$</span>
            <span className="prompt-label">Ask a question about this document:</span>
          </div>

          {/* Error Display */}
          {submitError && (
            <div className="submit-error">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span className="error-message">{submitError}</span>
              <button 
                className="retry-btn" 
                onClick={handleRetry}
                title="Clear error and try again"
              >
                <FontAwesomeIcon icon={faRefresh} />
                Retry
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="question-form">
            <textarea
              ref={inputRef}
              className={`question-textarea ${submitError ? 'error' : ''}`}
              value={currentQuestion}
              onChange={(e) => setCurrentQuestion(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isProcessing
                  ? "Please wait for current question to complete..."
                  : submitError
                  ? "Fix the issue above and try again..."
                  : "What would you like to know about this document?"
              }
              disabled={isSubmitting || isProcessing}
              rows={2}
            />
            <button
              type="submit"
              className={`submit-btn ${submitError ? 'error' : ''}`}
              disabled={!currentQuestion.trim() || isSubmitting || isProcessing}
            >
              {isSubmitting ? (
                <FontAwesomeIcon icon={faSpinner} spin />
              ) : (
                <FontAwesomeIcon icon={faPaperPlane} />
              )}
              <span>
                {isSubmitting ? 'Submitting...' : 'Ask Question'}
              </span>
            </button>
          </form>
        </div>

        {/* Question History Section */}
        <div className="question-history-section">
          <div className="history-header">
            <FontAwesomeIcon icon={faHistory} />
            <span>Question History</span>
            {isProcessing && (
              <div className="processing-indicator">
                <FontAwesomeIcon icon={faSpinner} spin />
                <span>Processing...</span>
              </div>
            )}
          </div>

          <div className="questions-history" ref={historyRef}>
            {questionsHistory.length === 0 ? (
              <div className="empty-history">
                <div className="empty-icon">❓</div>
                <p>No questions asked yet</p>
                <span>Start by asking a question above</span>
              </div>
            ) : (
              questionsHistory.map((question) => {
                const status = getQuestionStatus(question);
                return (
                  <div
                    key={question.id}
                    className={`question-history-item ${status.className}`}
                  >
                    <div className="question-header">
                      <div className="question-status">
                        <FontAwesomeIcon
                          icon={status.icon}
                          spin={status.spin}
                          style={{ color: status.color }}
                        />
                        <span className="status-text">{status.text}</span>
                      </div>
                      <div className="question-meta">
                        <div className="question-timestamp">
                          {formatTimestamp(question.createdAt)}
                        </div>
                        {question.processingMethod && (
                          <span className={`processing-method ${question.processingMethod}`}>
                            {question.processingMethod === 'session-based' ? '🔄' : '⚡'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="question-text">
                      {question.text}
                    </div>

                    {/* Error Display */}
                    {question.hasError && (
                      <div className="question-error">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span className="error-message">
                          {question.userMessage || 'Processing failed'}
                        </span>
                        {question.errorDetails && (
                          <details className="error-details">
                            <summary>Error Details</summary>
                            <pre>{JSON.stringify(question.errorDetails, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}

                    {/* Processing Indicator */}
                    {question.isProcessing && (
                      <div className="processing-indicator">
                        <div className="processing-text">
                          <div className="terminal-cursor"></div>
                          <span>ANALYZING_DOCUMENT...</span>
                        </div>
                        {question.logs && question.logs.length > 0 && (
                          <div className="processing-logs">
                            {question.logs.slice(-2).map((log, idx) => (
                              <div key={idx} className="log-entry">
                                {log}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Answer Section */}
                    {question.answer && (
                      <div className="answer-container">
                        <div className="answer-header">
                          <FontAwesomeIcon icon={faFileAlt} />
                          <span>Response</span>
                        </div>
                        <div className="answer-content">
                          {question.answer}
                        </div>
                      </div>
                    )}

                    {/* Provenance Progress */}
                    {question.provenanceSources && question.provenanceSources.length > 0 && (
                      <div className="provenance-progress">
                        <span className="provenance-count">
                          📄 {question.provenanceSources.length} provenance sources found
                        </span>
                        {question.isProcessing && (
                          <span className="loading-more">Loading more...</span>
                        )}
                        {question.hiddenResultsMessage && (
                          <span className="hidden-results">
                            💡 {question.hiddenResultsMessage}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="question-actions">
                      <button
                        className="reask-btn"
                        onClick={() => handleReask(question.text)}
                        disabled={isProcessing || isSubmitting}
                        title="Ask this question again"
                      >
                        <FontAwesomeIcon icon={faRedo} />
                        <span>Ask Again</span>
                      </button>

                      {question.feedback && (
                        <span className="feedback-indicator">
                          ✓ Feedback provided
                        </span>
                      )}

                      {question.processingTime && (
                        <span className="processing-time">
                          ⏱️ {question.processingTime.toFixed(2)}s
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Enhanced Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .submit-error {
            background: #f8d7da;
            border: 1px solid #dc3545;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #721c24;
            font-size: 14px;
          }
          
          .submit-error .error-message {
            flex: 1;
          }
          
          .submit-error .retry-btn {
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
          }
          
          .submit-error .retry-btn:hover {
            background: #c82333;
          }
          
          .question-textarea.error {
            border-color: #dc3545;
            box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25);
          }
          
          .submit-btn.error {
            border-color: #dc3545;
            color: #dc3545;
          }
          
          .question-history-item.error {
            border-left: 4px solid #dc3545;
            background: #fff5f5;
          }
          
          .question-error {
            background: #f8d7da;
            border: 1px solid #dc3545;
            border-radius: 4px;
            padding: 10px;
            margin: 8px 0;
            color: #721c24;
            font-size: 13px;
            display: flex;
            align-items: flex-start;
            gap: 8px;
          }
          
          .error-details {
            margin-top: 8px;
            font-size: 11px;
          }
          
          .error-details summary {
            cursor: pointer;
            color: #495057;
            font-weight: bold;
          }
          
          .error-details pre {
            background: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            margin-top: 4px;
            overflow-x: auto;
            font-size: 10px;
          }
          
          .processing-logs {
            margin-top: 8px;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 4px;
            font-family: monospace;
            font-size: 11px;
          }
          
          .log-entry {
            margin-bottom: 2px;
            color: #495057;
          }
          
          .hidden-results {
            color: #007bff;
            font-size: 12px;
            font-style: italic;
            display: block;
            margin-top: 4px;
          }
        `
      }} />
    </div>
  );
};

export default QuestionCollection;