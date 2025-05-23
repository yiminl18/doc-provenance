import React, { useState } from 'react';
import '../styles/FeedbackModal.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faThumbsUp, 
  faThumbsDown, 
  faClock,
  faComment,
  faCheckCircle
} from '@fortawesome/free-solid-svg-icons';

const FeedbackModal = ({ question, onSubmit, onClose }) => {
  const [feedback, setFeedback] = useState({
    correctness: null, // 'correct', 'incorrect', 'partial'
    consistency: null, // 'consistent', 'inconsistent', 'mixed'
    length: null, // 'appropriate', 'too_short', 'too_long'
    waitTime: null, // 'quick', 'expected', 'too_long'
    comments: ''
  });

  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: 'Correctness',
      question: 'Did the provenance correctly support the answer?',
      key: 'correctness',
      options: [
        { value: 'correct', label: 'Fully Correct', icon: faThumbsUp, color: 'green' },
        { value: 'partial', label: 'Partially Correct', icon: faThumbsUp, color: 'yellow' },
        { value: 'incorrect', label: 'Incorrect', icon: faThumbsDown, color: 'red' }
      ]
    },
    {
      title: 'Consistency',
      question: 'Was the provenance consistent with your question?',
      key: 'consistency',
      options: [
        { value: 'consistent', label: 'Fully Consistent', icon: faCheckCircle, color: 'green' },
        { value: 'mixed', label: 'Mostly Consistent', icon: faCheckCircle, color: 'yellow' },
        { value: 'inconsistent', label: 'Not Consistent', icon: faTimes, color: 'red' }
      ]
    },
    {
      title: 'Length',
      question: 'Was the amount of provenance appropriate?',
      key: 'length',
      options: [
        { value: 'appropriate', label: 'Just Right', icon: faCheckCircle, color: 'green' },
        { value: 'too_short', label: 'Too Brief', icon: faThumbsDown, color: 'yellow' },
        { value: 'too_long', label: 'Too Lengthy', icon: faThumbsDown, color: 'red' }
      ]
    },
    {
      title: 'Wait Time',
      question: 'How did the processing time feel?',
      key: 'waitTime',
      options: [
        { value: 'quick', label: 'Quick', icon: faClock, color: 'green' },
        { value: 'expected', label: 'As Expected', icon: faClock, color: 'yellow' },
        { value: 'too_long', label: 'Too Long', icon: faClock, color: 'red' }
      ]
    }
  ];

  const handleOptionSelect = (key, value) => {
    setFeedback(prev => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setCurrentStep(steps.length); // Comments step
    }
  };

  const handlePrevious = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const handleSubmit = () => {
    onSubmit({
      ...feedback,
      timestamp: new Date().toISOString(),
      questionId: question.id
    });
  };

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length;
  const canProceed = isLastStep || feedback[currentStepData?.key] !== null;

  return (
    <div className="feedback-modal-overlay">
      <div className="feedback-modal">
        <div className="modal-header">
          <h3>Feedback for: "{question.text}"</h3>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          {/* Progress Bar */}
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${((currentStep + 1) / (steps.length + 1)) * 100}%` }}
            />
          </div>

          {/* Step Indicator */}
          <div className="step-indicator">
            Step {currentStep + 1} of {steps.length + 1}
          </div>

          {/* Current Step Content */}
          {!isLastStep ? (
            <div className="feedback-step">
              <h4>{currentStepData.title}</h4>
              <p className="step-question">{currentStepData.question}</p>
              
              <div className="options-grid">
                {currentStepData.options.map((option) => (
                  <button
                    key={option.value}
                    className={`option-btn ${feedback[currentStepData.key] === option.value ? 'selected' : ''}`}
                    onClick={() => handleOptionSelect(currentStepData.key, option.value)}
                    data-color={option.color}
                  >
                    <FontAwesomeIcon icon={option.icon} />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="feedback-step">
              <h4>Additional Comments</h4>
              <p className="step-question">Any additional thoughts or suggestions?</p>
              
              <textarea
                className="comments-textarea"
                placeholder="Optional: Share any specific issues or suggestions..."
                value={feedback.comments}
                onChange={(e) => setFeedback(prev => ({ ...prev, comments: e.target.value }))}
                rows={4}
              />

              <div className="feedback-summary">
                <h5>Your Feedback:</h5>
                <ul>
                  <li><strong>Correctness:</strong> {feedback.correctness || 'Not rated'}</li>
                  <li><strong>Consistency:</strong> {feedback.consistency || 'Not rated'}</li>
                  <li><strong>Length:</strong> {feedback.length || 'Not rated'}</li>
                  <li><strong>Wait Time:</strong> {feedback.waitTime || 'Not rated'}</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            className="secondary-btn" 
            onClick={currentStep === 0 ? onClose : handlePrevious}
          >
            {currentStep === 0 ? 'Cancel' : 'Previous'}
          </button>
          
          {isLastStep ? (
            <button 
              className="primary-btn" 
              onClick={handleSubmit}
            >
              <FontAwesomeIcon icon={faComment} />
              Submit Feedback
            </button>
          ) : (
            <button 
              className="primary-btn" 
              onClick={handleNext}
              disabled={!canProceed}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;