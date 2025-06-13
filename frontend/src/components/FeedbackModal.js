import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faExclamationTriangle,
  faSpinner,
  faPaperPlane
} from '@fortawesome/free-solid-svg-icons';
import { submitFeedback } from '../services/api';

const FeedbackModal = ({ 
  pdfDocument, 
  question, 
  provenance, // Single provenance being evaluated
  onSubmit, 
  onClose   
}) => {
  const [feedback, setFeedback] = useState({
    accuracy: null,
    context: null,
    sufficiency: null,
    comments: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Accuracy Assessment
  const accuracyOptions = [
    { 
      value: 'correct', 
      label: 'CORRECT', 
      description: 'This evidence directly answers the question'
    },
    { 
      value: 'partially_correct', 
      label: 'PARTIALLY CORRECT', 
      description: 'Some parts are accurate but incomplete'
    },
    { 
      value: 'incorrect', 
      label: 'INCORRECT', 
      description: 'This evidence is factually wrong'
    }
  ];

  // Context Assessment
  const contextOptions = [
    { 
      value: 'appropriate', 
      label: 'APPROPRIATE CONTEXT', 
      description: 'Evidence comes from the right section of document'
    },
    { 
      value: 'wrong_section', 
      label: 'WRONG SECTION', 
      description: 'Correct info but from wrong part (e.g., citations vs main text)'
    },
    { 
      value: 'off_topic', 
      label: 'OFF TOPIC', 
      description: 'Evidence addresses a different question entirely'
    }
  ];

  // Sufficiency Assessment
  const sufficiencyOptions = [
    { 
      value: 'complete', 
      label: 'COMPLETE ANSWER', 
      description: 'This evidence fully addresses the question'
    },
    { 
      value: 'needs_more', 
      label: 'NEEDS ADDITIONAL EVIDENCE', 
      description: 'Helpful but requires more context to be complete'
    },
    { 
      value: 'insufficient', 
      label: 'INSUFFICIENT', 
      description: 'Does not provide enough information'
    }
  ];

  const handleOptionSelect = (category, value) => {
    setFeedback(prev => ({
      ...prev,
      [category]: value
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const submissionData = {
        questionId: question?.id || question?.questionId,
        provenanceId: provenance?.provenance_id || provenance?.id,
        documentId: pdfDocument?.id || pdfDocument?.documentId,
        feedback: {
          ...feedback,
          timestamp: new Date().toISOString(),
          provenance_text: provenance?.provenance || provenance?.content?.[0] || 'Unknown'
        }
      };

      console.log('Submitting feedback:', submissionData);

      // Submit via API
      try {
        const response = await submitFeedback(submissionData);
        if (response.success) {
          console.log('Feedback submitted successfully');
        }
      } catch (apiError) {
        console.warn('API feedback submission failed:', apiError);
      }

      // Always call the callback
      onSubmit(submissionData);

    } catch (error) {
      console.error('Error submitting feedback:', error);
      setSubmitError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isComplete = feedback.accuracy !== null && feedback.context !== null && feedback.sufficiency !== null;
  const getColorClass = (selected, value) => selected === value ? 'selected' : '';

  return (
    <div className="modal-overlay">
      <div className="modal-container provenance-feedback">
        
        {/* Header */}
        <div className="modal-header">
          <div className="header-title">
            <div className="title-bar">PROVENANCE EVALUATION</div>
            <div className="subtitle">Rate the quality of this evidence</div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          
          {/* Context Display */}
          <div className="evaluation-context">
            <div className="context-section">
              <div className="context-label">QUESTION:</div>
              <div className="context-content question-text">
                {question?.text?.substring(0, 120)}
                {question?.text?.length > 120 && '...'}
              </div>
            </div>
            <div className="context-section">
              <div className="context-label">EVIDENCE:</div>
              <div className="context-content evidence-text">
                {provenance?.provenance?.substring(0, 150) || 'Evidence text not available'}
                {provenance?.provenance?.length > 150 && '...'}
              </div>
            </div>
          </div>

          {/* Error Display */}
          {submitError && (
            <div className="error-panel">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>SUBMISSION ERROR: {submitError}</span>
            </div>
          )}

          {/* Evaluation Sections */}
          <div className="evaluation-sections">
            
            {/* Accuracy Section */}
            <div className="evaluation-section">
              <div className="section-header">
                <div className="section-title">ACCURACY</div>
                <div className="section-subtitle">Is this evidence factually correct?</div>
              </div>
              <div className="options-container">
                {accuracyOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`option-btn ${getColorClass(feedback.accuracy, option.value)}`}
                    onClick={() => handleOptionSelect('accuracy', option.value)}
                  >
                    <div className="option-label">{option.label}</div>
                    <div className="option-description">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Context Section */}
            <div className="evaluation-section">
              <div className="section-header">
                <div className="section-title">CONTEXT</div>
                <div className="section-subtitle">Is this evidence contextually appropriate?</div>
              </div>
              <div className="options-container">
                {contextOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`option-btn ${getColorClass(feedback.context, option.value)}`}
                    onClick={() => handleOptionSelect('context', option.value)}
                  >
                    <div className="option-label">{option.label}</div>
                    <div className="option-description">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sufficiency Section */}
            <div className="evaluation-section">
              <div className="section-header">
                <div className="section-title">SUFFICIENCY</div>
                <div className="section-subtitle">Does this evidence adequately answer the question?</div>
              </div>
              <div className="options-container">
                {sufficiencyOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`option-btn ${getColorClass(feedback.sufficiency, option.value)}`}
                    onClick={() => handleOptionSelect('sufficiency', option.value)}
                  >
                    <div className="option-label">{option.label}</div>
                    <div className="option-description">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Comments Section */}
            <div className="evaluation-section">
              <div className="section-header">
                <div className="section-title">ADDITIONAL NOTES</div>
                <div className="section-subtitle">Optional: Explain any specific issues</div>
              </div>
              <div className="comments-container">
                <textarea
                  className="comments-input"
                  placeholder="Describe any specific problems with this evidence..."
                  value={feedback.comments}
                  onChange={(e) => setFeedback(prev => ({ ...prev, comments: e.target.value }))}
                  rows={4}
                />
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button 
            className="win95-btn secondary" 
            onClick={onClose} 
            disabled={isSubmitting}
          >
            CANCEL
          </button>
          <button 
            className="win95-btn primary" 
            onClick={handleSubmit}
            disabled={!isComplete || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <FontAwesomeIcon icon={faSpinner} spin />
                SUBMITTING
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPaperPlane} />
                SUBMIT EVALUATION
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default FeedbackModal;