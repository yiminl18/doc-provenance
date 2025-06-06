import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faCheckCircle,
  faClock,
  faComment,
  faExclamationTriangle,
  faBalanceScale,
  faSearch,
  faSpinner,
  faGraduationCap,
  faChartLine,
  faQuestionCircle
} from '@fortawesome/free-solid-svg-icons';
import { submitFeedback } from '../services/api';
import userStudyLogger from '../services/UserStudyLogger';

const FeedbackModal = ({ 
  pdfDocument, 
  question, 
  allProvenances, 
  onSubmit, 
  onClose   
}) => {
  const [feedback, setFeedback] = useState({
    // Provenance Quality Assessment (for each provenance viewed)
    provenanceQuality: {
      correctness: null,
      relevance: null,
      completeness: null,
      contextual_appropriateness: null
    },
    
    // Overall Experience Assessment
    overallExperience: {
      waitTime: null,
      waitTimePerception: null,
      satisfaction: null,
      taskCompletion: null,
      wouldUseAgain: null
    },
    
    // Specific Issues
    issues: [],
    
    // Open-ended feedback
    comments: '',
    improvements: '',
    contextualIssues: '',
    
    // Algorithm perception
    trustworthiness: null,
    confidenceInAnswer: null
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [viewedProvenances] = useState(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [modalOpenTime] = useState(Date.now());
  const [modalOpenLogged, setModalOpenLogged] = useState(false);

  // Log modal opening
  useEffect(() => {
    if (!modalOpenLogged && question) {
      userStudyLogger.logFeedbackModalOpened(
        question.id || question.questionId,
        allProvenances?.length || 0,
        question.processingTime || null
      );
      setModalOpenLogged(true);
    }
  }, [question, allProvenances, modalOpenLogged]);

  const steps = [
    {
      title: 'PROVENANCE QUALITY',
      question: 'How would you rate the quality of the evidence shown?',
      icon: faCheckCircle,
      category: 'quality'
    },
    {
      title: 'TIMING',
      question: 'How did the processing time feel to you?',
      icon: faClock,
      category: 'timing'
    },
    {
      title: 'EXPERIENCE',
      question: 'How was your overall experience?',
      icon: faGraduationCap,
      category: 'experience'
    },
    {
      title: 'ADDITIONAL FEEDBACK',
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
          label: 'CORRECT & APPROPRIATE', 
          color: 'green', 
          description: 'Evidence directly answers the question correctly' 
        },
        { 
          value: 'correct_but_wrong_context', 
          label: 'CORRECT BUT WRONG CONTEXT', 
          color: 'yellow', 
          description: 'Technically correct but answers a different question' 
        },
        { 
          value: 'partially_correct', 
          label: 'PARTIALLY CORRECT', 
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
        { value: 'highly_relevant', label: 'HIGHLY RELEVANT', color: 'green', description: 'Directly addresses your question' },
        { value: 'somewhat_relevant', label: 'SOMEWHAT RELEVANT', color: 'yellow', description: 'Related but not perfectly on-topic' },
        { value: 'barely_relevant', label: 'BARELY RELEVANT', color: 'yellow', description: 'Tangentially related' },
        { value: 'not_relevant', label: 'NOT RELEVANT', color: 'red', description: 'Does not address your question' }
      ]
    },
    {
      key: 'completeness',
      label: 'Evidence Completeness',
      question: 'How complete was the evidence provided?',
      options: [
        { value: 'complete', label: 'COMPLETE', color: 'green', description: 'All necessary information provided' },
        { value: 'mostly_complete', label: 'MOSTLY COMPLETE', color: 'green', description: 'Most information with minor gaps' },
        { value: 'incomplete', label: 'INCOMPLETE', color: 'yellow', description: 'Missing important information' },
        { value: 'missing_key_info', label: 'MISSING KEY INFO', color: 'red', description: 'Critical information absent' }
      ]
    },
    {
      key: 'contextual_appropriateness',
      label: 'Contextual Appropriateness',
      question: 'Was the evidence contextually appropriate for your question?',
      options: [
        { value: 'perfectly_appropriate', label: 'PERFECTLY APPROPRIATE', color: 'green', description: 'Evidence fits the question context perfectly' },
        { value: 'mostly_appropriate', label: 'MOSTLY APPROPRIATE', color: 'green', description: 'Generally appropriate with minor context issues' },
        { value: 'somewhat_off', label: 'SOMEWHAT OFF CONTEXT', color: 'yellow', description: 'Evidence is related but context is somewhat off' },
        { value: 'wrong_context', label: 'WRONG CONTEXT', color: 'red', description: 'Evidence from wrong context (e.g., citations vs. main paper)' }
      ]
    }
  ];

  // Timing Questions (Step 2)
  /*const timingQuestions = [
    {
      key: 'waitTime',
      label: 'Processing Time Expectation',
      question: 'How did the actual processing time compare to your expectations?',
      options: [
        { value: 'faster_than_expected', label: 'FASTER THAN EXPECTED', color: 'green', description: 'Pleasantly surprised by speed' },
        { value: 'as_expected', label: 'AS EXPECTED', color: 'green', description: 'Met my expectations' },
        { value: 'slower_than_desired', label: 'SLOWER THAN DESIRED', color: 'yellow', description: 'Took longer than I hoped' },
        { value: 'too_slow', label: 'TOO SLOW', color: 'red', description: 'Unacceptably slow' }
      ]
    },
    {
      key: 'waitTimePerception',
      label: 'Subjective Processing Speed',
      question: 'How did the processing time feel to you personally?',
      options: [
        { value: 'very_quick', label: 'VERY QUICK', color: 'green', description: 'Felt very fast' },
        { value: 'quick', label: 'QUICK', color: 'green', description: 'Felt reasonably fast' },
        { value: 'reasonable', label: 'REASONABLE', color: 'yellow', description: 'Acceptable waiting time' },
        { value: 'slow', label: 'SLOW', color: 'yellow', description: 'Felt slow' },
        { value: 'very_slow', label: 'VERY SLOW', color: 'red', description: 'Felt very slow' }
      ]
    }
  ];*/

  // Experience Questions (Step 3)
  const experienceQuestions = [
    {
      key: 'satisfaction',
      label: 'Overall Satisfaction',
      question: 'How satisfied are you with the system\'s performance?',
      options: [
        { value: 'very_satisfied', label: 'VERY SATISFIED', color: 'green', description: 'Exceeded expectations' },
        { value: 'satisfied', label: 'SATISFIED', color: 'green', description: 'Met expectations' },
        { value: 'neutral', label: 'NEUTRAL', color: 'yellow', description: 'Adequate performance' },
        { value: 'dissatisfied', label: 'DISSATISFIED', color: 'red', description: 'Below expectations' },
        { value: 'very_dissatisfied', label: 'VERY DISSATISFIED', color: 'red', description: 'Far below expectations' }
      ]
    },
    {
      key: 'taskCompletion',
      label: 'Task Completion',
      question: 'How well did the system help you answer your question?',
      options: [
        { value: 'fully_completed', label: 'FULLY COMPLETED', color: 'green', description: 'Completely answered my question' },
        { value: 'mostly_completed', label: 'MOSTLY COMPLETED', color: 'green', description: 'Answered most of my question' },
        { value: 'partially_completed', label: 'PARTIALLY COMPLETED', color: 'yellow', description: 'Provided some useful information' },
        { value: 'not_completed', label: 'NOT COMPLETED', color: 'red', description: 'Did not help answer my question' }
      ]
    },
    {
      key: 'trustworthiness',
      label: 'System Trustworthiness',
      question: 'How much do you trust this system\'s analysis?',
      options: [
        { value: 'completely_trust', label: 'COMPLETELY TRUST', color: 'green', description: 'Would rely on it completely' },
        { value: 'mostly_trust', label: 'MOSTLY TRUST', color: 'green', description: 'Generally trustworthy' },
        { value: 'somewhat_trust', label: 'SOMEWHAT TRUST', color: 'yellow', description: 'Would verify with other sources' },
        { value: 'dont_trust', label: 'DON\'T TRUST', color: 'red', description: 'Would not rely on this analysis' }
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
        { value: 'probably_not', label: 'PROBABLY NOT', color: 'red', description: 'Would prefer other options' },
        { value: 'definitely_not', label: 'DEFINITELY NOT', color: 'red', description: 'Would not use again' }
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

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const timeSpent = (Date.now() - modalOpenTime) / 1000;

      // Enhanced submission data with session information
      const submissionData = {
        // Core session info
        questionId: question?.id || question?.questionId,
        questionText: question?.text || question?.questionText,
        documentId: pdfDocument?.id || pdfDocument?.documentId,
        documentFilename: pdfDocument?.filename || pdfDocument?.documentName,
        
        // Processing info
        provenanceCount: allProvenances?.length || 0,
        provenancesViewed: Array.from(viewedProvenances),
        processingTime: question?.processingTime || null,
        
        // Feedback data
        feedback: {
          ...feedback,
          timestamp: new Date().toISOString(),
          submissionTime: Date.now(),
          timeSpentInModal: timeSpent
        }
      };

      console.log('🔄 Submitting feedback:', submissionData);

      // Log the comprehensive feedback submission
      await userStudyLogger.logFeedbackSubmitted(
        submissionData.questionId,
        submissionData.documentId,
        submissionData
      );

      // Try to submit via the API (if endpoint exists)
      try {
        const response = await submitFeedback(submissionData);
        if (response.success) {
          console.log('✅ Feedback submitted successfully via API');
        }
      } catch (apiError) {
        console.warn('⚠️ API feedback submission failed, but logged locally:', apiError);
        // Don't fail the entire process if API is unavailable
      }

      // Log modal closure with successful submission
      await userStudyLogger.logFeedbackModalClosed(
        submissionData.questionId,
        'submitted',
        timeSpent
      );

      // Always call the local callback as well
      onSubmit(submissionData);

    } catch (error) {
      console.error('❌ Error submitting feedback:', error);
      setSubmitError(error.message);
      
      // Log the error
      await userStudyLogger.logError(
        'feedback_submission_error',
        error.message,
        { question_id: question?.id || question?.questionId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = async () => {
    const timeSpent = (Date.now() - modalOpenTime) / 1000;
    
    // Log modal closure without submission
    await userStudyLogger.logFeedbackModalClosed(
      question?.id || question?.questionId,
      'cancelled',
      timeSpent
    );
    
    onClose();
  };

  const getCurrentQuestions = () => {
    switch (steps[currentStep]?.category) {
      case 'quality': return qualityQuestions;
      //case 'timing': return timingQuestions;
      //case 'experience': return experienceQuestions;
      default: return [];
    }
  };

  const isStepComplete = () => {
    const currentQuestions = getCurrentQuestions();
    if (currentQuestions.length === 0) return true;
    
    const category = steps[currentStep]?.category;
    if (category === 'quality') {
      return qualityQuestions.every(q => feedback.provenanceQuality[q.key] !== null);
    //} else if (category === 'timing') {
     // return timingQuestions.every(q => feedback.overallExperience[q.key] !== null);
    //} else if (category === 'experience') {
    //  return experienceQuestions.every(q => 
     //   feedback.overallExperience[q.key] !== null || feedback[q.key] !== null
     // );
    }
    return true;
  };

  const getCompletionPercentage = () => {
    const allQuestions = [...qualityQuestions, ...experienceQuestions];
    const completedQuestions = allQuestions.filter(q => {
      if (qualityQuestions.includes(q)) {
        return feedback.provenanceQuality[q.key] !== null;
      //} else if (timingQuestions.includes(q)) {
      //  return feedback.overallExperience[q.key] !== null;
      //} else if (experienceQuestions.includes(q)) {
      //  return feedback.overallExperience[q.key] !== null || feedback[q.key] !== null;
      }
      return false;
    }).length;
    return Math.round((completedQuestions / allQuestions.length) * 100);
  };

  const currentStepData = steps[currentStep];
  const isCommentsStep = currentStepData?.category === 'comments';

  // Enhanced context display
  const getSessionContext = () => {
    return {
      questionText: question?.text || question?.questionText || 'Unknown question',
      documentName: pdfDocument?.filename || pdfDocument?.documentName || 'Unknown document',
      provenanceCount: allProvenances?.length || 0,
      processingTime: question?.processingTime || null,
      processingMethod: question?.processingMethod || 'Unknown'
    };
  };

  const sessionContext = getSessionContext();

  return (
    <div className="feedback-modal-overlay">
      <div className="feedback-modal user-study-modal enhanced">
        <div className="modal-header">
          <div className="header-content">
            <h3>PROVENANCE EVALUATION</h3>
            <div className="evaluation-context">
              <div className="context-item">
                <span className="context-label">Question:</span>
                <span className="context-value">
                  "{sessionContext.questionText.length > 60 
                    ? sessionContext.questionText.substring(0, 60) + '...' 
                    : sessionContext.questionText}"
                </span>
              </div>
              <div className="context-item">
                <span className="context-label">Evidence Found:</span>
                <span className="context-value">{sessionContext.provenanceCount} provenances</span>
              </div>
              <div className="context-item">
                <span className="context-label">Processing Time:</span>
                <span className="context-value">
                  {sessionContext.processingTime ? `${sessionContext.processingTime.toFixed(1)}s` : 'N/A'}
                </span>
              </div>
              <div className="context-item">
                <span className="context-label">Method:</span>
                <span className="context-value processing-method">
                  {sessionContext.processingMethod === 'session-based' ? '🔄 Session' : 
                   sessionContext.processingMethod === 'legacy' ? '⚡ Legacy' : '🔧 ' + sessionContext.processingMethod}
                </span>
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={handleClose}>
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
                STEP {currentStep + 1} OF {steps.length}
              </span>
              <span className="completion-status">
                COMPLETION: {getCompletionPercentage()}%
              </span>
            </div>
          </div>

          {/* Error Display */}
          {submitError && (
            <div className="submit-error">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>Error submitting feedback: {submitError}</span>
            </div>
          )}

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
                    className="input-win95"
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
                    className="input-win95"
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
                    className="input-win95"
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
            onClick={currentStep === 0 ? handleClose : handlePrevious}
            disabled={isSubmitting}
          >
            {currentStep === 0 ? 'CANCEL' : 'PREVIOUS'}
          </button>
          
          {isCommentsStep ? (
            <button 
              className="win95-btn primary submit" 
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} spin />
                  SUBMITTING...
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faComment} />
                  SUBMIT_EVALUATION
                </>
              )}
            </button>
          ) : (
            <button 
              className="win95-btn primary" 
              onClick={handleNext}
              disabled={!isStepComplete() || isSubmitting}
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