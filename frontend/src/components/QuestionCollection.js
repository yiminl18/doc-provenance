import React, { useState, useRef, useEffect } from 'react';
import '../styles/question-collection.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal,
  faPaperPlane,
  faHistory,
  faRedo,
  faEye,
  faComment,
  faFileAlt,
  faClock,
  faCheck,
  faSpinner,
  faExclamationTriangle,
  faRefresh
} from '@fortawesome/free-solid-svg-icons';

const QuestionCollection = ({ 
  pdfDocument, 
  onQuestionSubmit,
  onReaskQuestion
}) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [selectedHistoryQuestion, setSelectedHistoryQuestion] = useState(null);
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
        errorMessage = 'Server error';
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
  const handleReask = (question) => {
    if (isProcessing || isSubmitting) return;
    
    console.log('🔄 QuestionCollection: Re-asking question:', question.text);
    onReaskQuestion(question);
  };

  // Handle quick-fill from history
  const handleQuickFill = (questionText) => {
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
    if (historyRef.current && questionsHistory.length > 0) {
      // Scroll to top to show most recent question
      historyRef.current.scrollTop = 0;
    }
  }, [questionsHistory.length]);

  // Focus input when component mounts or document changes
  useEffect(() => {
    if (inputRef.current && pdfDocument) {
      inputRef.current.focus();
    }
  }, [pdfDocument]);

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
                const isSelected = selectedHistoryQuestion?.id === question.id;
                
                return (
                  <div
                    key={question.id}
                    className={`question-history-item ${status.className} ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedHistoryQuestion(isSelected ? null : question)}
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
                      </div>
                    </div>

                    <div className="question-text">
                      {question.text}
                    </div>

                    {/* Error Display */}
                    {question.processingStatus === 'error' && (
                      <div className="question-error">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span className="error-message">
                          {question.userMessage || 'Processing failed'}
                        </span>
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
                      </div>
                    )}

                    {/* Question Actions */}
                    <div className="question-actions">
                      <button
                        className="action-btn quick-fill"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickFill(question.text);
                        }}
                        disabled={isProcessing || isSubmitting}
                        title="Fill this question into the input box"
                      >
                        <FontAwesomeIcon icon={faEye} />
                        <span>Use Question</span>
                      </button>

                      <button
                        className="action-btn reask"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReask(question);
                        }}
                        disabled={isProcessing || isSubmitting}
                        title="Ask this question again"
                      >
                        <FontAwesomeIcon icon={faRedo} />
                        <span>Ask Again</span>
                      </button>

                      {question.feedback && (
                        <span className="feedback-indicator">
                          <FontAwesomeIcon icon={faComment} />
                          <span>Feedback provided</span>
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
    </div>
  );
};

export default QuestionCollection;