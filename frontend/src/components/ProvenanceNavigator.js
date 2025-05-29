import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faChevronLeft, 
  faChevronRight, 
  faHighlighter, 
  faComment,
  faPaperPlane,
  faSpinner,
  faTerminal,
  faFileAlt
} from '@fortawesome/free-solid-svg-icons';

const ProvenanceNavigator = ({ 
  pdfDocument,
  onQuestionSubmit,
  onProvenanceSelect,
  onFeedbackRequest,
  onHighlightInPDF 
}) => {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);

  // Get the active question and its data
  const activeQuestion = pdfDocument?.activeQuestionId 
    ? pdfDocument.questions.get(pdfDocument.activeQuestionId)
    : null;

  const availableProvenances = activeQuestion?.provenanceSources?.slice(0, 5) || [];
  const currentProvenance = availableProvenances[currentProvenanceIndex];

  // Reset provenance index when active question changes
  useEffect(() => {
    setCurrentProvenanceIndex(0);
    if (availableProvenances.length > 0) {
      onProvenanceSelect?.(availableProvenances[0]);
    }
  }, [pdfDocument?.activeQuestionId, availableProvenances.length]);

  // Auto-select provenance when index changes
  useEffect(() => {
    if (currentProvenance) {
      onProvenanceSelect?.(currentProvenance);
    }
  }, [currentProvenanceIndex, currentProvenance]);

  const handleQuestionSubmit = async (e) => {
    e.preventDefault();
    if (!currentQuestion.trim() || isSubmitting || !pdfDocument) return;

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

  const handlePreviousProvenance = () => {
    if (currentProvenanceIndex > 0) {
      setCurrentProvenanceIndex(prev => prev - 1);
    }
  };

  const handleNextProvenance = () => {
    if (currentProvenanceIndex < availableProvenances.length - 1) {
      setCurrentProvenanceIndex(prev => prev + 1);
    }
  };

  const handleHighlightInPDF = () => {
    if (currentProvenance) {
      onHighlightInPDF?.(currentProvenance);
    }
  };

  const handleFeedback = () => {
    if (activeQuestion) {
      onFeedbackRequest?.(activeQuestion);
    }
  };

  const isProcessing = activeQuestion?.isProcessing || false;


  return (
    <div className="qa-flow-content">

      {/* Provenance Navigator - The Star of the Show */}
      {availableProvenances.length > 0 && !isProcessing && (
        <div className="provenance-navigator">
          <div className="provenance-header">
            <div className="provenance-counter">
              Provenance {currentProvenanceIndex + 1} of {availableProvenances.length}
            </div>
            <div className="provenance-navigation">
              <button 
                className="nav-btn"
                onClick={handlePreviousProvenance}
                disabled={currentProvenanceIndex === 0}
              >
             
                <span>Previous</span>
              </button>
              <button 
                className="nav-btn"
                onClick={handleNextProvenance}
                disabled={currentProvenanceIndex === availableProvenances.length - 1}
              >
                <span>Next</span>
       
              </button>
            </div>
          </div>

          {currentProvenance && (
            <>
              <div className="provenance-content">
                <div className="evidence-text">
                  {currentProvenance.content ? (
                    Array.isArray(currentProvenance.content) 
                      ? currentProvenance.content.join('\n\n')
                      : currentProvenance.content
                  ) : (
                    'Loading evidence content...'
                  )}
                </div>
              </div>

              <div className="provenance-actions">
                <button 
                  className="highlight-pdf-btn"
                  onClick={handleHighlightInPDF}
                >
                  <FontAwesomeIcon icon={faHighlighter} />
                  <span>Highlight in PDF</span>
                </button>
                
                <div className="provenance-metrics">
                  <span>Processing Time: {currentProvenance.time?.toFixed(2) || 'N/A'}s</span>
                  <span>Sentences: {currentProvenance.sentences_ids?.length || 0}</span>
                </div>
                
                <button 
                  className="feedback-btn"
                  onClick={handleFeedback}
                >
                  <FontAwesomeIcon icon={faComment} />
                  <span>Provide Feedback</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Question History - Compact List 
      {document.questions.size > 0 && (
        <div className="question-history-compact">
          <h5>Recent Questions ({document.questions.size})</h5>
          <div className="history-list">
            {Array.from(document.questions.values())
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .slice(0, 3)
              .map((question) => (
                <div key={question.id} className="history-item">
                  <div className="history-question">
                    {question.text.length > 60 
                      ? question.text.substring(0, 60) + '...' 
                      : question.text
                    }
                  </div>
                  <div className="history-status">
                    {question.isProcessing ? 'Processing...' : 
                     question.answer ? 'Completed' : 'Pending'}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}*/}
    </div>
  );
};

export default ProvenanceNavigator;