import React, { useState, useRef, useEffect } from 'react';
import '../styles/brutalist-design.css';
import '../styles/question-collection.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTerminal, 
  faPaperPlane, 
  faHistory, 
  faRedo,
  faClock,
  faCheck,
  faSpinner
} from '@fortawesome/free-solid-svg-icons';

const QuestionCollection = ({ document, onQuestionSubmit, onReaskQuestion }) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  const historyRef = useRef(null);

  // Get questions history from document
  const questionsHistory = document ? 
    Array.from(document.questions.values()).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    ) : [];

  // Check if currently processing any questions
  const isProcessing = questionsHistory.some(q => q.isProcessing);

  // Handle question submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isSubmitting || isProcessing) return;

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
        <div className="question-input-section">
          <div className="input-header">
            <span className="terminal-prompt">$</span>
            <span className="prompt-label">Ask a question about this document:</span>
          </div>
          
          <form onSubmit={handleSubmit} className="question-form">
            <div className="input-container">
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
                rows={3}
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
            </div>
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
                    
                    {question.answer && (
                      <div className="question-answer">
                        <strong>Answer:</strong> {question.answer}
                      </div>
                    )}
                    
                    {question.provenanceSources && question.provenanceSources.length > 0 && (
                      <div className="provenance-summary">
                        <span className="provenance-count">
                          {question.provenanceSources.length} evidence source{question.provenanceSources.length !== 1 ? 's' : ''} found
                        </span>
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