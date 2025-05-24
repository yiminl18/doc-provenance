import React, { useState } from 'react';
import '../styles/brutalist-design.css';
import '../styles/feedback-modal.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faCheckCircle,
  faClock,
  faComment,
  faExclamationTriangle,
  faBalanceScale,
  faSearch,
  faGraduationCap,
  faChartLine,
  faQuestionCircle
} from '@fortawesome/free-solid-svg-icons';

const FeedbackModal = ({ session, question, allProvenances, onSubmit, onClose }) => {
  const [feedback, setFeedback] = useState({
    // Provenance Quality Assessment (for each provenance viewed)
    provenanceQuality: {
      correctness: null, // 'correct_answer', 'correct_but_wrong_context', 'partially_correct', 'incorrect'
      relevance: null,   // 'highly_relevant', 'somewhat_relevant', 'barely_relevant', 'not_relevant'
      completeness: null, // 'complete', 'mostly_complete', 'incomplete', 'missing_key_info'
      contextual_appropriateness: null // 'perfectly_appropriate', 'mostly_appropriate', 'somewhat_off', 'wrong_context'
    },
    
    // Overall Experience Assessment
    overallExperience: {
      waitTime: null, // 'faster_than_expected', 'as_expected', 'slower_than_desired', 'too_slow'
      waitTimePerception: null, // 'very_quick', 'quick', 'reasonable', 'slow', 'very_slow'
      satisfaction: null, // 'very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied'
      taskCompletion: null, // 'fully_completed', 'mostly_completed', 'partially_completed', 'not_completed'
      wouldUseAgain: null // 'definitely', 'probably', 'maybe', 'probably_not', 'definitely_not'
    },
    
    // Specific Issues
    issues: [],
    
    // Open-ended feedback
    comments: '',
    improvements: '',
    contextualIssues: '', // New: for cases where answer is technically correct but contextually wrong
    
    // Algorithm perception
    trustworthiness: null,
    confidenceInAnswer: null
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [viewedProvenances] = useState(new Set()); // Track which provenances user has seen

  const steps = [
    {
      title: 'PROVENANCE_QUALITY',
      question: 'How would you rate the quality of the evidence shown?',
      icon: faCheckCircle,
      category: 'quality'
    },
    {
      title: 'TIMING_PERCEPTION',
      question: 'How did the processing time feel to you?',
      icon: faClock,
      category: 'timing'
    },
    {
      title: 'OVERALL_EXPERIENCE',
      question: 'How was your overall experience?',
      icon: faGraduationCap,
      category: 'experience'
    },
    {
      title: 'ADDITIONAL_FEEDBACK',
      question: 'Please provide additional feedback',
      icon: faComment,
      category: 'comments'
    }
  ];

  // Provenance Quality Questions (Step 1)
  const qualityQuestions = [
    {
      key: 'correctness',
      label: 'Answer Correctness',
      question: 'How correct was the evidence in answering your specific question?',
      options: [
        { 
          value: 'correct_answer', 
          label: 'CORRECT_&_APPROPRIATE', 
          color: 'green', 
          description: 'Evidence directly answers the question correctly' 
        },
        { 
          value: 'correct_but_wrong_context', 
          label: 'CORRECT_BUT_WRONG_CONTEXT', 
          color: 'yellow', 
          description: 'Technically correct but answers a different question' 
        },
        { 
          value: 'partially_correct', 
          label: 'PARTIALLY_CORRECT', 
          color: 'yellow', 
          description: 'Some parts correct but incomplete or mixed' 
        },
        { 
          value: 'incorrect', 
          label: 'INCORRECT', 
          color: 'red', 
          description: 'Evidence does not support the correct answer' 
        }
      ]
    },
    {
      key: 'relevance',
      label: 'Question Relevance',
      question: 'How relevant was the evidence to your specific question?',
      options: [
        { value: 'highly_relevant', label: 'HIGHLY_RELEVANT', color: 'green', description: 'Directly addresses your question' },
        { value: 'somewhat_relevant', label: 'SOMEWHAT_RELEVANT', color: 'yellow', description: 'Related but not perfectly on-topic' },
        { value: 'barely_relevant', label: 'BARELY_RELEVANT', color: 'yellow', description: 'Tangentially related' },
        { value: 'not_relevant', label: 'NOT_RELEVANT', color: 'red', description: 'Does not address your question' }
      ]
    },
    {
      key: 'completeness',
      label: 'Evidence Completeness',
      question: 'How complete was the evidence provided?',
      options: [
        { value: 'complete', label: 'COMPLETE', color: 'green', description: 'All necessary information provided' },
        { value: 'mostly_complete', label: 'MOSTLY_COMPLETE', color: 'green', description: 'Most information with minor gaps' },
        { value: 'incomplete', label: 'INCOMPLETE', color: 'yellow', description: 'Missing important information' },
        { value: 'missing_key_info', label: 'MISSING_KEY_INFO', color: 'red', description: 'Critical information absent' }
      ]
    },
    {
      key: 'contextual_appropriateness',
      label: 'Contextual Appropriateness',
      question: 'Was the evidence contextually appropriate for your question?',
      options: [
        { value: 'perfectly_appropriate', label: 'PERFECTLY_APPROPRIATE', color: 'green', description: 'Evidence fits the question context perfectly' },
        { value: 'mostly_appropriate', label: 'MOSTLY_APPROPRIATE', color: 'green', description: 'Generally appropriate with minor context issues' },
        { value: 'somewhat_off', label: 'SOMEWHAT_OFF_CONTEXT', color: 'yellow', description: 'Evidence is related but context is somewhat off' },
        { value: 'wrong_context', label: 'WRONG_CONTEXT', color: 'red', description: 'Evidence from wrong context (e.g., citations vs. main paper)' }
      ]
    }
  ];

  // Timing Questions (Step 2)
  const timingQuestions = [
    {
      key: 'waitTime',
      label: 'Processing Time Expectation',
      question: 'How did the actual processing time compare to your expectations?',
      options: [
        { value: 'faster_than_expected', label: 'FASTER_THAN_EXPECTED', color: 'green', description: 'Pleasantly surprised by speed' },
        { value: 'as_expected', label: 'AS_EXPECTED', color: 'green', description: 'Met my expectations' },
        { value: 'slower_than_desired', label: 'SLOWER_THAN_DESIRED', color: 'yellow', description: 'Took longer than I hoped' },
        { value: 'too_slow', label: 'TOO_SLOW', color: 'red', description: 'Unacceptably slow' }
      ]
    },
    {
      key: 'waitTimePerception',
      label: 'Subjective Processing Speed',
      question: 'How did the processing time feel to you personally?',
      options: [
        { value: 'very_quick', label: 'VERY_QUICK', color: 'green', description: 'Felt very fast' },
        { value: 'quick', label: 'QUICK', color: 'green', description: 'Felt reasonably fast' },
        { value: 'reasonable', label: 'REASONABLE', color: 'yellow', description: 'Acceptable waiting time' },
        { value: 'slow', label: 'SLOW', color: 'yellow', description: 'Felt slow' },
        { value: 'very_slow', label: 'VERY_SLOW', color: 'red', description: 'Felt very slow' }
      ]
    }
  ];

  // Experience Questions (Step 3)
  const experienceQuestions = [
    {
      key: 'satisfaction',
      label: 'Overall Satisfaction',
      question: 'How satisfied are you with the system\'s performance?',
      options: [
        { value: 'very_satisfied', label: 'VERY_SATISFIED', color: 'green', description: 'Exceeded expectations' },
        { value: 'satisfied', label: 'SATISFIED', color: 'green', description: 'Met expectations' },
        { value: 'neutral', label: 'NEUTRAL', color: 'yellow', description: 'Adequate performance' },
        { value: 'dissatisfied', label: 'DISSATISFIED', color: 'red', description: 'Below expectations' },
        { value: 'very_dissatisfied', label: 'VERY_DISSATISFIED', color: 'red', description: 'Far below expectations' }
      ]
    },
    {
      key: 'taskCompletion',
      label: 'Task Completion',
      question: 'How well did the system help you answer your question?',
      options: [
        { value: 'fully_completed', label: 'FULLY_COMPLETED', color: 'green', description: 'Completely answered my question' },
        { value: 'mostly_completed', label: 'MOSTLY_COMPLETED', color: 'green', description: 'Answered most of my question' },
        { value: 'partially_completed', label: 'PARTIALLY_COMPLETED', color: 'yellow', description: 'Provided some useful information' },
        { value: 'not_completed', label: 'NOT_COMPLETED', color: 'red', description: 'Did not help answer my question' }
      ]
    },
    {
      key: 'trustworthiness',
      label: 'System Trustworthiness',
      question: 'How much do you trust this system\'s analysis?',
      options: [
        { value: 'completely_trust', label: 'COMPLETELY_TRUST', color: 'green', description: 'Would rely on it completely' },
        { value: 'mostly_trust', label: 'MOSTLY_TRUST', color: 'green', description: 'Generally trustworthy' },
        { value: 'somewhat_trust', label: 'SOMEWHAT_TRUST', color: 'yellow', description: 'Would verify with other sources' },
        { value: 'dont_trust', label: 'DON\'T_TRUST', color: 'red', description: 'Would not rely on this analysis' }
      ]
    },
    {
      key: 'wouldUseAgain',
      label: 'Future Usage Intent',
      question: 'Would you use this system again for similar tasks?',
      options: [
        { value: 'definitely', label: 'DEFINITELY', color: 'green', description: 'Would actively seek to use it' },
        { value: 'probably', label: 'PROBABLY', color: 'green', description: 'Likely to use if available' },
        { value: 'maybe', label: 'MAYBE', color: 'yellow', description: 'Depends on alternatives' },
        { value: 'probably_not', label: 'PROBABLY_NOT', color: 'red', description: 'Would prefer other options' },
        { value: 'definitely_not', label: 'DEFINITELY_NOT', color: 'red', description: 'Would not use again' }
      ]
    }
  ];

  const issueOptions = [
    { id: 'wrong_context_evidence', label: 'Evidence was from wrong part of document (e.g., citations instead of main text)' },
    { id: 'technically_correct_wrong_question', label: 'Evidence was technically correct but for a different question' },
    { id: 'irrelevant_evidence', label: 'Evidence was irrelevant to my question' },
    { id: 'incomplete_evidence', label: 'Important evidence was missing' },
    { id: 'too_much_evidence', label: 'Too much evidence (overwhelming)' },
    { id: 'confusing_presentation', label: 'Evidence was confusingly presented' },
    { id: 'slow_processing', label: 'System was too slow' },
    { id: 'interface_problems', label: 'Interface was difficult to use' },
    { id: 'unclear_results', label: 'Results were unclear or ambiguous' },
    { id: 'technical_errors', label: 'Technical errors or glitches' }
  ];

  const handleOptionSelect = (category, key, value) => {
    setFeedback(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value
      }
    }));
  };

  const handleIssueToggle = (issueId) => {
    setFeedback(prev => ({
      ...prev,
      issues: prev.issues.includes(issueId)
        ? prev.issues.filter(id => id !== issueId)
        : [...prev.issues, issueId]
    }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
  };

  const handleSubmit = () => {
    const submissionData = {
      sessionId: session?.sessionId,
      questionId: question?.id,
      questionText: question?.text,
      documentFilename: session?.documentName,
      provenanceCount: allProvenances?.length || 0,
      provenancesViewed: Array.from(viewedProvenances),
      processingTime: session?.completedAt && session?.createdAt 
        ? (new Date(session.completedAt) - new Date(session.createdAt)) / 1000
        : null,
      feedback: {
        ...feedback,
        timestamp: new Date().toISOString(),
        submissionTime: Date.now(),
        algorithmMethod: session?.algorithmMethod, // Track which of the 10 combinations was used
        userSessionId: session?.userSessionId
      }
    };

    onSubmit(submissionData);
  };

  const getCurrentQuestions = () => {
    switch (steps[currentStep]?.category) {
      case 'quality': return qualityQuestions;
      case 'timing': return timingQuestions;
      case 'experience': return experienceQuestions;
      default: return [];
    }
  };

  const isStepComplete = () => {
    const currentQuestions = getCurrentQuestions();
    if (currentQuestions.length === 0) return true;
    
    const category = steps[currentStep]?.category;
    if (category === 'quality') {
      return qualityQuestions.every(q => feedback.provenanceQuality[q.key] !== null);
    } else if (category === 'timing') {
      return timingQuestions.every(q => feedback.overallExperience[q.key] !== null);
    } else if (category === 'experience') {
      return experienceQuestions.every(q => 
        feedback.overallExperience[q.key] !== null || feedback[q.key] !== null
      );
    }
    return true;
  };

  const getCompletionPercentage = () => {
    const allQuestions = [...qualityQuestions, ...timingQuestions, ...experienceQuestions];
    const completedQuestions = allQuestions.filter(q => {
      // Check the correct category for each question type
      if (qualityQuestions.includes(q)) {
        return feedback.provenanceQuality[q.key] !== null;
      } else if (timingQuestions.includes(q)) {
        return feedback.overallExperience[q.key] !== null;
      } else if (experienceQuestions.includes(q)) {
        return feedback.overallExperience[q.key] !== null || feedback[q.key] !== null;
      }
      return false;
    }).length;
        return Math.round((completedQuestions / allQuestions.length) * 100);
  };

  const currentStepData = steps[currentStep];
  const isCommentsStep = currentStepData?.category === 'comments';

  return (
    <div className="feedback-modal-overlay">
      <div className="feedback-modal user-study-modal enhanced">
        <div className="modal-header">
          <div className="header-content">
            <h3>USER_STUDY_EVALUATION</h3>
            <div className="evaluation-context">
              <div className="context-item">
                <span className="context-label">Question:</span>
                <span className="context-value">
                  "{question?.text?.length > 60 ? question.text.substring(0, 60) + '...' : question?.text}"
                </span>
              </div>
              <div className="context-item">
                <span className="context-label">Evidence Found:</span>
                <span className="context-value">{allProvenances?.length || 0} provenances</span>
              </div>
              <div className="context-item">
                <span className="context-label">Processing Time:</span>
                <span className="context-value">
                  {session?.processingTime ? `${session.processingTime.toFixed(1)}s` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          {/* Progress System */}
          <div className="progress-system">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              />
            </div>
            <div className="step-info">
              <span className="step-indicator">
                STEP_{currentStep + 1}_OF_{steps.length}
              </span>
              <span className="completion-status">
                COMPLETION: {getCompletionPercentage()}%
              </span>
            </div>
          </div>

          {/* Current Step Content */}
          {!isCommentsStep ? (
            <div className="feedback-step">
              <div className="step-header">
                <FontAwesomeIcon icon={currentStepData.icon} />
                <h4>{currentStepData.title}</h4>
              </div>
              <p className="step-question">{currentStepData.question}</p>
              
              <div className="questions-container">
                {getCurrentQuestions().map((question) => (
                  <div key={question.key} className="question-block">
                    <h5 className="question-label">{question.question}</h5>
                    <div className="options-grid">
                      {question.options.map((option) => {
                        const category = steps[currentStep]?.category === 'quality' ? 'provenanceQuality' : 
                                        (steps[currentStep]?.category === 'timing' || steps[currentStep]?.category === 'experience') ? 'overallExperience' : 'general';
                        const isSelected = category === 'general' ? 
                          feedback[question.key] === option.value :
                          feedback[category][question.key] === option.value;

                        return (
                          <button
                            key={option.value}
                            className={`option-btn ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleOptionSelect(category, question.key, option.value)}
                            data-color={option.color}
                          >
                            <div className="option-header">
                              <span className="option-label">{option.label}</span>
                            </div>
                            <div className="option-description">
                              {option.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="feedback-step">
              <div className="step-header">
                <FontAwesomeIcon icon={faComment} />
                <h4>ADDITIONAL_FEEDBACK</h4>
              </div>
              
              {/* Issues Checklist */}
              <div className="issues-section">
                <h5>Did you experience any of these specific issues? (Select all that apply)</h5>
                <div className="issues-grid">
                  {issueOptions.map((issue) => (
                    <label key={issue.id} className="issue-checkbox">
                      <input
                        type="checkbox"
                        checked={feedback.issues.includes(issue.id)}
                        onChange={() => handleIssueToggle(issue.id)}
                      />
                      <span className="checkmark"></span>
                      <span className="issue-label">{issue.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Open-ended feedback */}
              <div className="text-feedback-section">
                <div className="textarea-group">
                  <label htmlFor="contextualIssues">If evidence was technically correct but contextually wrong, please explain:</label>
                  <textarea
                    id="contextualIssues"
                    className="comments-textarea"
                    placeholder="E.g., 'I asked about when the paper was published, but the system returned publication years from cited papers instead of the main paper.'"
                    value={feedback.contextualIssues}
                    onChange={(e) => setFeedback(prev => ({ ...prev, contextualIssues: e.target.value }))}
                    rows={3}
                  />
                </div>

                <div className="textarea-group">
                  <label htmlFor="comments">Additional comments about your experience:</label>
                  <textarea
                    id="comments"
                    className="comments-textarea"
                    placeholder="Please share any additional thoughts about the system's performance, evidence quality, or your overall experience..."
                    value={feedback.comments}
                    onChange={(e) => setFeedback(prev => ({ ...prev, comments: e.target.value }))}
                    rows={4}
                  />
                </div>
                
                <div className="textarea-group">
                  <label htmlFor="improvements">What could be improved?</label>
                  <textarea
                    id="improvements"
                    className="comments-textarea"
                    placeholder="What changes would make this system more useful for your research or analysis tasks?"
                    value={feedback.improvements}
                    onChange={(e) => setFeedback(prev => ({ ...prev, improvements: e.target.value }))}
                    rows={3}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            className="secondary-btn" 
            onClick={currentStep === 0 ? onClose : handlePrevious}
          >
            {currentStep === 0 ? 'CANCEL' : 'PREVIOUS'}
          </button>
          
          {isCommentsStep ? (
            <button 
              className="primary-btn submit-btn" 
              onClick={handleSubmit}
            >
              <FontAwesomeIcon icon={faComment} />
              SUBMIT_EVALUATION
            </button>
          ) : (
            <button 
              className="primary-btn" 
              onClick={handleNext}
              disabled={!isStepComplete()}
            >
              NEXT_STEP
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;