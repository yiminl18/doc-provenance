// components/QuestionSuggestionsModal.js
import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faQuestionCircle,
  faTimes,
  faRobot,
  faSpinner,
  faClock,
  faExclamationTriangle,
  faPaperPlane,
  faFileText,
  faHashtag,
  faAlignLeft,
  faChartBar,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons';
import { getGeneratedQuestions } from '../services/api';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

const QuestionSuggestionsModal = ({
  isOpen,
  onClose,
  filename,
  onQuestionSelect
}) => {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Initialize Tiktoken for token counting
  const enc = new Tiktoken(cl100k_base);

  useEffect(() => {
    if (isOpen && filename) {
      loadQuestions();
    }
  }, [isOpen, filename]);

  const loadQuestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getGeneratedQuestions(filename);

      if (response.success) {
        setQuestions(response.questions || []);
      } else {
        setError('Failed to load questions');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionClick = (question) => {
    onQuestionSelect(question);
    onClose();
  };

  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  // Calculate per-provenance totals
  const calculateProvenanceStats = (provenance) => {
    if (!provenance || !provenance.provenance) {
      return { totalTokens: 0, totalSentences: 0 };
    }

    const totalTokens = enc.encode(provenance.provenance).length;
    const totalSentences = provenance.provenance_ids ? provenance.provenance_ids.length : 0;

    return { totalTokens, totalSentences };
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-container question-suggestions">
        <div className="modal-header">
          <div className="header-content">
            <FontAwesomeIcon icon={faQuestionCircle} />
            <h3>Suggested Questions</h3>
          </div>
          <button className="win95-btn close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <FontAwesomeIcon icon={faSpinner} spin />
              <p>Loading suggested questions...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <p>Error loading questions: {error}</p>
              <button className="retry-btn" onClick={loadQuestions}>
                Try Again
              </button>
            </div>
          ) : questions.length > 0 ? (
            <>
              <div className="modal-grid">
                {questions.map((question, index) => (
                  <div key={question.question_id} className="question-card">
                    <button
                      className="question-item"
                      onClick={() => handleQuestionClick(question)}
                    >
                      <div className="question-content">
                        <div className="question-text">{question.question_text}</div>

                        <div className="provenance-summary-bar">
                          {question.provenance_data && question.provenance_data.length > 0 ? (
                            <div className="provenance-stats">
                              {question.provenance_data.map((prov, idx) => {
                                const stats = calculateProvenanceStats(prov);
                                return (
                                  <div key={`${question.question_id}_${prov.provenance_id}`}
                                    className="stat-item"
                                  >
                                    {/* Provenance ID indicator */}
                                    <div className="provenance-header">
                                      <span className="provenance-label">Provenance {prov.provenance_id || idx + 1}</span>
                                    </div>

                                    {/* Sentences metric */}
                                    <div className="metric-row">
                                      <FontAwesomeIcon icon={faHashtag} className="metric-icon" />
                                      <span className="metric-value">{stats.totalSentences}</span>
                                      <div className="metric-label">sentences</div>
                                    </div>

                                    {/* Tokens metric */}
                                    <div className="metric-row">
                                      <FontAwesomeIcon icon={faAlignLeft} className="metric-icon" />
                                      <span className="metric-value">{formatNumber(stats.totalTokens)}</span>
                                      <div className="metric-label">tokens</div>
                                    </div>

                                    {/* Processing time metric (optional) */}
                                    {prov.time && (
                                      <div className="metric-row">
                                        <FontAwesomeIcon icon={faClock} className="metric-icon" />
                                        <span className="metric-value">{prov.time.toFixed(1)}</span>
                                        <div className="metric-label">seconds</div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="no-provenance">
                              <FontAwesomeIcon icon={faFileText} />
                              <span>No Provenance Data</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <FontAwesomeIcon icon={faQuestionCircle} />
              <p>No suggested questions are available for this document.</p>
              <p className="empty-subtitle">
                You can generate questions by running the question generation script.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuestionSuggestionsModal;