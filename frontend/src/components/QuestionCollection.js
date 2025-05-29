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
  faSpinner
} from '@fortawesome/free-solid-svg-icons';

const QuestionCollection = ({ pdfDocument, onQuestionSubmit, onReaskQuestion }) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  const historyRef = useRef(null);

  // Get questions history from document
  const questionsHistory = pdfDocument ?
    Array.from(pdfDocument.questions.values()).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    ) : [];

  // Get the active question and its data
  const activeQuestion = pdfDocument?.activeQuestionId
    ? pdfDocument.questions.get(pdfDocument.activeQuestionId)
    : null;

  // Check if currently processing any questions
  const isProcessing = questionsHistory.some(q => q.isProcessing);

  // Handle question submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isSubmitting || isProcessing || !pdfDocument) return;

    setIsSubmitting(true);
    try {
      await onQuestionSubmit(currentQuestion.trim());
      setCurrentQuestion('');
    } catch (error) {
      console.error('Error submitting question:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle re-asking a question
  const handleReask = (questionText) => {
    if (isProcessing || isSubmitting) return;
    onReaskQuestion(questionText);
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
      return { icon: faSpinner, color: 'var(--warning-orange)', spin: true, text: 'Processing...' };
    } else if (question.answer) {
      return { icon: faCheck, color: 'var(--success-green)', spin: false, text: 'Completed' };
    } else {
      return { icon: faClock, color: 'var(--win95-text-muted)', spin: false, text: 'Pending' };
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

          <form onSubmit={handleSubmit} className="question-form">

            <textarea
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
                      <div className="question-timestamp">
                        {formatTimestamp(question.createdAt)}
                      </div>
                    </div>

                    <div className="question-text">
                      {question.text}
                    </div>

                          {/* Processing Indicator */}
                          {isProcessing && (
                            <div className="processing-indicator">
                              <div className="processing-text">
                                <div className="terminal-cursor"></div>
                                <span>ANALYZING_DOCUMENT...</span>
                              </div>
                            </div>
                          )}
                    
                          {/* Answer Section */}
                          {activeQuestion?.answer && (
                            <div className="answer-container">
                              <div className="answer-header">
                                <FontAwesomeIcon icon={faFileAlt} />
                                <span>Response</span>
                              </div>
                              <div className="answer-content">
                                {activeQuestion.answer}
                              </div>
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