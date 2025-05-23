import React, { useState } from 'react';
import '../styles/ChatContainer.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUser, 
  faRobot, 
  faFileAlt, 
  faThumbsUp, 
  faThumbsDown,
  faClock,
  faExpand,
  faComment
} from '@fortawesome/free-solid-svg-icons';
import FeedbackModal from './FeedbackModal';

const ChatContainer = ({ document, onProvenanceSelect, onFeedbackSubmit }) => {
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);

  if (!document) {
    return (
      <div className="chat-container empty">
        <div className="empty-state">
          <FontAwesomeIcon icon={faFileAlt} size="3x" />
          <h3>No document selected</h3>
          <p>Upload a PDF to get started</p>
        </div>
      </div>
    );
  }

  const questions = Array.from(document.questions.values()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  const handleProvenanceClick = (provenance) => {
    onProvenanceSelect(provenance);
  };

  const openFeedbackModal = (question) => {
    setSelectedQuestionForFeedback(question);
    setFeedbackModalOpen(true);
  };

  const handleFeedbackClose = () => {
    setFeedbackModalOpen(false);
    setSelectedQuestionForFeedback(null);
  };

  const handleFeedbackSubmit = (feedback) => {
    if (selectedQuestionForFeedback) {
      onFeedbackSubmit(selectedQuestionForFeedback.id, feedback);
    }
    handleFeedbackClose();
  };

  return (
    <div className="chat-container">
      <div className="chat-history">
        {questions.map((question) => (
          <div key={question.id} className="question-thread">
            {/* User Question */}
            <div className="message user-message">
              <div className="message-avatar">
                <FontAwesomeIcon icon={faUser} />
              </div>
              <div className="message-content">
                <div className="message-text">{question.text}</div>
                <div className="message-time">
                  {new Date(question.createdAt).toLocaleTimeString()}
                </div>
              </div>
            </div>

            {/* Processing Indicator */}
            {question.isProcessing && (
              <div className="message bot-message processing">
                <div className="message-avatar">
                  <FontAwesomeIcon icon={faRobot} />
                </div>
                <div className="message-content">
                  <div className="processing-indicator">
                    <div className="processing-text">Analyzing document...</div>
                    <div className="dots">
                      <span className="dot"></span>
                      <span className="dot"></span>
                      <span className="dot"></span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Answer */}
            {question.answer && (
              <div className="message bot-message">
                <div className="message-avatar">
                  <FontAwesomeIcon icon={faRobot} />
                </div>
                <div className="message-content">
                  <div className="message-text">{question.answer}</div>
                </div>
              </div>
            )}

            {/* Provenances */}
            {question.provenanceSources && question.provenanceSources.length > 0 && (
              <div className="provenance-section">
                <div className="provenance-header">
                  <FontAwesomeIcon icon={faFileAlt} />
                  <span>Supporting Evidence ({question.provenanceSources.length})</span>
                </div>
                
                <div className="provenance-list">
                  {question.provenanceSources.map((provenance, index) => (
                    <div 
                      key={index} 
                      className="provenance-card"
                      onClick={() => handleProvenanceClick(provenance)}
                    >
                      <div className="provenance-header-line">
                        <span className="provenance-number">#{index + 1}</span>
                        <span className="provenance-id">Top-{provenance.provenance_id} Provenance</span>
                        <button className="expand-btn">
                          <FontAwesomeIcon icon={faExpand} />
                        </button>
                      </div>
                      
                      <div className="provenance-content">
                        {provenance.content ? (
                          <div className="provenance-text">
                            {provenance.content.slice(0, 2).map((sentence, idx) => (
                              <p key={idx} className="sentence-preview">
                                {sentence.length > 150 
                                  ? `${sentence.substring(0, 150)}...` 
                                  : sentence
                                }
                              </p>
                            ))}
                            {provenance.content.length > 2 && (
                              <p className="more-sentences">
                                +{provenance.content.length - 2} more sentences
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="loading-content">Loading content...</div>
                        )}
                      </div>
                      
                      <div className="provenance-meta">
                        <span className="meta-item">
                          <FontAwesomeIcon icon={faClock} />
                          {provenance.time ? `${provenance.time.toFixed(2)}s` : 'N/A'}
                        </span>
                        <span className="meta-item">
                          Tokens: {provenance.input_token_size || 0} → {provenance.output_token_size || 0}
                        </span>
                        <span className="meta-item">
                          Sentences: {provenance.sentences_ids ? provenance.sentences_ids.length : 0}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Feedback Section */}
                {!question.isProcessing && (
                  <div className="feedback-section">
                    {question.feedback ? (
                      <div className="feedback-submitted">
                        <FontAwesomeIcon icon={faThumbsUp} />
                        <span>Feedback submitted</span>
                      </div>
                    ) : (
                      <div className="feedback-actions">
                        <button 
                          className="feedback-btn"
                          onClick={() => openFeedbackModal(question)}
                        >
                          <FontAwesomeIcon icon={faComment} />
                          Provide Feedback
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Feedback Modal */}
      {feedbackModalOpen && (
        <FeedbackModal
          question={selectedQuestionForFeedback}
          onSubmit={handleFeedbackSubmit}
          onClose={handleFeedbackClose}
        />
      )}
    </div>
  );
};

export default ChatContainer;