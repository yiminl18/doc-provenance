import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faExclamationTriangle,
  faSpinner,
  faPaperPlane,
  faArrowLeft,
  faCheckCircle
} from '@fortawesome/free-solid-svg-icons';
import { submitFeedback } from '../services/api';

const FeedbackModal = ({ 
  pdfDocument, 
  question, 
  provenances, // Array of provenances
  selectedProvenanceId, // Currently selected provenance ID
  onSubmit, 
  onClose   
}) => {
  const [currentNode, setCurrentNode] = useState('root');
  const [feedbackPath, setFeedbackPath] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [activeProvenanceId, setActiveProvenanceId] = useState(selectedProvenanceId || (provenances && provenances[0]?.provenance_id));

  console.log('provenances in FeedbackModal:', provenances);
  console.log('selected provenance ID:', selectedProvenanceId);

  // Get the currently active provenance object
  const activeProvenance = provenances?.find(p => p.provenance_id === activeProvenanceId) || provenances?.[0];

  // Reset feedback path when switching provenances
  const handleProvenanceSwitch = (provenanceId) => {
    setActiveProvenanceId(provenanceId);
    setCurrentNode('root');
    setFeedbackPath([]);
    setSubmitError(null);
  };

  // Define the feedback tree structure
  const feedbackTree = {
    root: {
      type: 'question',
      title: 'answer trust',
      question: 'Does the provided provenance make you trust the answer is correct?',
      options: [
        { value: 'yes', label: 'yes', description: 'The provenance supports the answer' },
        { value: 'no', label: 'no', description: 'The provenance does not support the answer' }
      ]
    },
    yes: {
      type: 'question',
      title: 'provenance quality',
      question: 'The provenance supports the answer, but is there an issue with its scope?',
      options: [
        { value: 'too_long', label: 'too long', description: 'Contains unnecessary information' },
        { value: 'too_short', label: 'too short', description: 'Missing important context' },
        { value: 'just_right', label: 'just right', description: 'Appropriate amount of context' }
      ]
    },
    no: {
      type: 'question',
      title: 'issue identification',
      question: 'Why doesn\'t the provenance support the answer?',
      options: [
        { value: 'inconsistent', label: 'inconsistent', description: 'Answer seems correct but provenance doesn\'t support it' },
        { value: 'invalid', label: 'invalid source', description: 'Provenance is from wrong part of document' },
        { value: 'incorrect_answer', label: 'incorrect answer', description: 'The answer itself appears to be wrong' }
      ]
    },
    too_long: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'Provenance is trustworthy but contains excess information',
      category: 'scope_issue'
    },
    too_short: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'Provenance is trustworthy but lacks sufficient context',
      category: 'scope_issue'
    },
    just_right: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'Provenance is appropriate and trustworthy',
      category: 'positive'
    },
    inconsistent: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'Answer may be correct but provenance doesn\'t adequately support it',
      category: 'consistency_issue'
    },
    invalid: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'Provenance comes from wrong section of document',
      category: 'source_issue'
    },
    incorrect_answer: {
      type: 'terminal',
      title: 'feedback complete',
      summary: 'The provided answer appears to be factually incorrect',
      category: 'accuracy_issue'
    }
  };

  const handleOptionSelect = (value) => {
    const newPath = [...feedbackPath, { node: currentNode, choice: value }];
    setFeedbackPath(newPath);
    setCurrentNode(value);
  };

  const handleGoBack = () => {
    if (feedbackPath.length > 0) {
      const previousPath = feedbackPath.slice(0, -1);
      setFeedbackPath(previousPath);
      setCurrentNode(previousPath.length > 0 ? previousPath[previousPath.length - 1].choice : 'root');
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const currentNodeData = feedbackTree[currentNode];
      const submissionData = {
        questionId: question?.id || question?.questionId,
        provenanceId: activeProvenance?.provenance_id || activeProvenance?.id,
        documentId: pdfDocument?.id || pdfDocument?.documentId,
        feedback: {
          feedback_path: feedbackPath,
          final_node: currentNode,
          category: currentNodeData.category,
          summary: currentNodeData.summary,
          timestamp: new Date().toISOString(),
          provenance_text: activeProvenance?.content?.join(' ') || 'Unknown'
        }
      };

      console.log('Submitting tree feedback:', submissionData);

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

  const currentNodeData = feedbackTree[currentNode];
  const isTerminal = currentNodeData?.type === 'terminal';
  const canGoBack = feedbackPath.length > 0;

  return (
    <div className="modal-overlay">
      <div className="modal-container provenance-feedback">
        
        {/* Header */}
        <div className="modal-header">
          <div className="header-title">
            <div className="title-bar">{currentNodeData?.title || 'provenance evaluation'}</div>
            <div className="subtitle">
              {isTerminal ? 'review your assessment' : 'navigate through the evaluation'}
            </div>
          </div>
          <button className="win95-btn close" onClick={onClose} aria-label="Close">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          
          {/* Provenance Tabs */}
          {provenances.length > 1 && (
            <div className="provenance-tabs">
              <div className="tabs-label">select provenance:</div>
              <div className="tabs-container">
                {provenances.map((prov, index) => (
                  <button
                    key={prov.provenance_id}
                    className={`win95-btn tab ${activeProvenanceId === prov.provenance_id ? 'active' : ''}`}
                    onClick={() => handleProvenanceSwitch(prov.provenance_id)}
                  >
                    provenance {index + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Context Display */}
          <div className="evaluation-context">
            <div className="context-section">
              <div className="context-label">question:</div>
              <div className="context-content question-text">
                {question?.text?.substring(0, 120)}
                {question?.text?.length > 120 && '...'}
              </div>
            </div>
            <div className="context-section">
              <div className="context-label">provenance:</div>
              <div className="context-content provenance-text">
                {activeProvenance?.content?.map((sentence, index) => (
                  <span key={`sentence_${index}`} className="provenance-sentence">
                    {sentence}
                    {index < activeProvenance.content.length - 1 && ' '}
                  </span>
                )) || 'provenance content not available'}
              </div>
            </div>
          </div>

          {/* Progress Indicator */}
          {feedbackPath.length > 0 && (
            <div className="feedback-progress">
              <div className="progress-label">evaluation path:</div>
              <div className="progress-breadcrumbs">
                {feedbackPath.map((step, index) => (
                  <span key={index} className="breadcrumb-item">
                    {step.choice.replace('_', ' ')}
                    {index < feedbackPath.length - 1 && ' → '}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error Display */}
          {submitError && (
            <div className="error-panel">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>submission error: {submitError}</span>
            </div>
          )}

          {/* Current Node Content */}
          <div className="evaluation-sections">
            {isTerminal ? (
              // Terminal node - show summary
              <div className="evaluation-section terminal-summary">
                <div className="section-header">
                  <div className="section-title">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    assessment complete
                  </div>
                </div>
                <div className="terminal-content">
                  <div className="summary-text">{currentNodeData.summary}</div>
                  <div className="category-badge">{currentNodeData.category.replace('_', ' ')}</div>
                </div>
              </div>
            ) : (
              // Question node - show options
              <div className="evaluation-section">
                <div className="section-header">
                  <div className="section-title">{currentNodeData?.title}</div>
                  <div className="section-subtitle">{currentNodeData?.question}</div>
                </div>
                <div className="options-container">
                  {currentNodeData?.options?.map((option) => (
                    <button
                      key={option.value}
                      className="win95-btn option"
                      onClick={() => handleOptionSelect(option.value)}
                    >
                      <div className="option-label">{option.label}</div>
                      <div className="option-description">{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="footer-left">
            {canGoBack && (
              <button 
                className="win95-btn secondary" 
                onClick={handleGoBack}
                disabled={isSubmitting}
              >
                <FontAwesomeIcon icon={faArrowLeft} />
                back
              </button>
            )}
          </div>
          <div className="footer-right">
            <button 
              className="win95-btn secondary" 
              onClick={onClose} 
              disabled={isSubmitting}
            >
              cancel
            </button>
            {isTerminal && (
              <button 
                className="win95-btn primary" 
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    submitting
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faPaperPlane} />
                    submit feedback
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default FeedbackModal;