import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faTerminal,
    faPaperPlane,
    faSpinner,
    faExclamationTriangle,
    faRefresh,
    faStopCircle
} from '@fortawesome/free-solid-svg-icons';

const QuestionInput = forwardRef(({ 
    pdfDocument,
    isSubmitting,
    isProcessing,
    submitError,
    onSubmit,
    onCancelAll,
    placeholder = "What would you like to know about this document?"
}, ref) => {
    const [currentQuestion, setCurrentQuestion] = useState('');
    const inputRef = useRef(null);

    const handleSubmit = (e) => {
        e.preventDefault();
        const questionText = currentQuestion;
        if (!questionText || isSubmitting || !pdfDocument) return;
        
        onSubmit(questionText);
        setCurrentQuestion('');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    // Clear submit error when user starts typing
    useEffect(() => {
        if (submitError && currentQuestion) {
            // Could call onClearError if you want to handle this in parent
        }
    }, [currentQuestion, submitError]);

    // Expose focus method
    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        setQuestion: (text) => setCurrentQuestion(text)
    }));

    if (!pdfDocument) {
        return (
            <div className="question-input-component">
                <div className="qa-header">
                    <h4>
                        <FontAwesomeIcon icon={faTerminal} />
                        Ask Questions
                    </h4>
                </div>
                <div className="empty-state">
                    <p>Upload a PDF to start asking questions</p>
                </div>
            </div>
        );
    }

    return (
        <div className="question-input-component">
            <div className="qa-header">
                <h4>
                    <FontAwesomeIcon icon={faTerminal} />
                    Ask Questions
                </h4>
                {isProcessing && onCancelAll && (
                    <button
                        className="win95-btn cancel"
                        onClick={onCancelAll}
                        title="Cancel all processing questions"
                    >
                        <FontAwesomeIcon icon={faStopCircle} />
                        Cancel All
                    </button>
                )}
            </div>

            {submitError && (
                <div className="submit-error">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <span>{submitError}</span>
                    <button 
                        className="win95-btn retry" 
                        onClick={() => inputRef.current?.focus()}
                        title="Try again"
                    >
                        <FontAwesomeIcon icon={faRefresh} />
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="question-form">
                <textarea
                    ref={inputRef}
                    className="question-textarea"
                    value={currentQuestion}
                    onChange={(e) => setCurrentQuestion(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={
                        isProcessing
                            ? "Please wait for current question to complete..."
                            : placeholder
                    }
                    disabled={isSubmitting || isProcessing}
                    rows={2}
                />
                <button
                    type="submit"
                    className="win95-btn submit submit-btn"
                    disabled={!currentQuestion.trim() || isSubmitting || isProcessing}
                >
                    {isSubmitting ? (
                        <FontAwesomeIcon icon={faSpinner} spin />
                    ) : (
                        <FontAwesomeIcon icon={faPaperPlane} />
                    )}
                    <span>{isSubmitting ? 'Submitting...' : 'Ask'}</span>
                </button>
            </form>
        </div>
    );
});

export default QuestionInput;