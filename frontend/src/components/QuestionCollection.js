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
  faExclamationTriangle
} from '@fortawesome/free-solid-svg-icons';

const QuestionCollection = ({ 
  pdfDocument, 
  onQuestionSubmit, // This should be the function from App.js
  currentSession
}) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  const historyRef = useRef(null);

  // Get questions history from document
  const questionsHistory = pdfDocument ?
    Array.from(pdfDocument.questions.values()).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    ) : [];

  // Check if currently processing any questions
  const isProcessing = questionsHistory.some(q => q.isProcessing);

  // Simplified question submission - let App.js handle the complexity
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isSubmitting || isProcessing || !pdfDocument) return;

    const questionText = currentQuestion.trim();
    setCurrentQuestion('');
    setIsSubmitting(true);
    
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
      // You could show a toast or error message here
      alert(`Error submitting question: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle re-asking a question
  const handleReask = (questionText) => {
    if (isProcessing || isSubmitting) return;
    setCurrentQuestion(questionText);
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

  const formatTimestamp = (date) => {
    return new Date(date).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getQuestionStatus = (question) => {
    if (question.isProcessing) {
      return { 
        icon: faSpinner, 
        color: '#ff9500', 
        spin: true, 
        text: 'Processing...' 
      };
    } else if (question.answer) {
      return { 
        icon: faCheck, 
        color: '#00ff00', 
        spin: false, 
        text: 'Completed' 
      };
    } else {
      return { 
        icon: faClock, 
        color: '#888', 
        spin: false, 
        text: 'Pending' 
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

          <form onSubmit={handleSubmit} className="question-form">
            <textarea
              ref={inputRef}
              className="question-textarea"
              value={currentQuestion}
              onChange={(e) => setCurrentQuestion(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isProcessing
                  ? "Please wait for current question to complete..."
                  : "What would you like to know about this document?"
              }
              disabled={isSubmitting || isProcessing}
              rows={2}
            />
            <button
              type="submit"
              className="submit-btn"
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
                    className={`question-history-item ${question.isProcessing ? 'processing' : 'completed'}`}
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

                    {/* Processing Indicator */}
                    {question.isProcessing && (
                      <div className="processing-indicator">
                        <div className="processing-text">
                          <div className="terminal-cursor"></div>
                          <span>ANALYZING_DOCUMENT...</span>
                        </div>
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
    </div>
  );
};

export default QuestionCollection;