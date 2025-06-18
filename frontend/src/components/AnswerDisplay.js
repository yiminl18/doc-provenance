import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faFileAlt,
    faCheck,
    faSpinner,
    faExclamationTriangle,
    faExclamationCircle,
    faStopCircle
} from '@fortawesome/free-solid-svg-icons';

const AnswerDisplay = ({ 
    question,
    onCancel,
    onRetry
}) => {
    if (!question) {
        return (
            <div className="answer-display-component">
                <div className="qa-header">
                    <h4>
                        <FontAwesomeIcon icon={faFileAlt} />
                        Current Question
                    </h4>
                </div>
                <div className="empty-state">
                    <p>No active question</p>
                </div>
            </div>
        );
    }

    const getQuestionStatusUI = (question) => {
        if (question.processingStatus === 'error') {
            return { 
                icon: faExclamationTriangle, 
                className: 'error', 
                text: 'Error',
                spin: false
            };
        } else if (question.processingStatus === 'cancelled') {
            return { 
                icon: faExclamationCircle, 
                className: 'cancelled', 
                text: 'Cancelled',
                spin: false
            };
        } else if (question.isProcessing) {
            return { 
                icon: faSpinner, 
                className: 'processing', 
                text: 'Processing...',
                spin: true
            };
        } else if (question.answer || question.provenanceSources?.length > 0) {
            return { 
                icon: faCheck, 
                className: 'completed', 
                text: 'Completed',
                spin: false
            };
        } else {
            return { 
                icon: faCheck, 
                className: 'pending', 
                text: 'Pending',
                spin: false
            };
        }
    };

    const status = getQuestionStatusUI(question);

    return (
        <div className="answer-display-component">
            <div className="qa-header">
                <h4>
                    <FontAwesomeIcon icon={faFileAlt} />
                    Current Question
                </h4>
                <div className={`status-indicator-pqa ${status.className}`}>
                    <FontAwesomeIcon 
                        icon={status.icon} 
                        spin={status.spin}
                    />
                    {status.text}
                </div>
                {question.isProcessing && question.cancellable && onCancel && (
                    <button
                        className="win95-btn cancel"
                        onClick={() => onCancel(question.id)}
                        title="Cancel this question"
                    >
                        <FontAwesomeIcon icon={faStopCircle} />
                    </button>
                )}
            </div>

            <div className="question-display">
                <div className="question-text">{question.text}</div>

                {question.processingStatus === 'cancelled' && (
                    <div className="cancellation-notice">
                        <FontAwesomeIcon icon={faExclamationCircle} />
                        <span>{question.userMessage}</span>
                        {onRetry && (
                            <button 
                                className="win95-btn retry"
                                onClick={() => onRetry(question.text)}
                                title="Ask this question again"
                            >
                                Ask Again
                            </button>
                        )}
                    </div>
                )}

                {question.processingStatus === 'error' && question.userMessage && (
                    <div className="error-notice">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span>{question.userMessage}</span>
                        {onRetry && (
                            <button 
                                className="win95-btn retry"
                                onClick={() => onRetry(question.text)}
                                title="Try this question again"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                )}

                {/* Answer Section */}
                {question.answerReady && question.answer ? (
                    <div className="answer-section">
                        <div className="answer-header">
                            <FontAwesomeIcon icon={faCheck} />
                            <span>Answer</span>
                        </div>
                        <div className="answer-content">{question.answer}</div>
                    </div>
                ) : question.isProcessing ? (
                    <div className="answer-pending">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        <span>Generating answer...</span>
                    </div>
                ) : null}

                {/* Processing info */}
                {question.processingTime && (
                    <div className="processing-info">
                        <span>Processing time: {question.processingTime.toFixed(1)}s</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AnswerDisplay;