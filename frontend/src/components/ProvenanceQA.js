import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faTerminal,
    faPaperPlane,
    faHistory,
    faEye,
    faComment,
    faFileAlt,
    faClock,
    faCheck,
    faSpinner,
    faExclamationTriangle,
    faRefresh,
    faBookOpen,
    faBookmark,
    faArrowRight,
    faSearchPlus,
    faHighlighter,
    faChevronLeft,
    faChevronRight,
    faTrash
} from '@fortawesome/free-solid-svg-icons';
import '../styles/provenance-qa.css';
// Import the enhanced API functions
import {
    askQuestion,
    checkAnswer,
    getNextProvenance,
    getQuestionStatus,
    fetchSentences
} from '../services/api';

const ProvenanceQA = forwardRef(({
     pdfDocument,
    questionsHistory,           // Receive from App
    activeQuestionId,          // Receive from App  
    onQuestionUpdate,          // Receive from App
    onQuestionAdd,             // Receive from App
    onActiveQuestionChange,    // Receive from App
    onProvenanceSelect,
    onFeedbackRequest,
    onHighlightInPDF,
    onNavigationTrigger
}, ref) => {
    // Question input state
    const [currentQuestion, setCurrentQuestion] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    // Questions history
    //const [questionsHistory, setQuestionsHistory] = useState(new Map());
    //const [activeQuestionId, setActiveQuestionId] = useState(null);

    // Provenance state
    const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);
    const [selectedProvenance, setSelectedProvenance] = useState(null);
    const [showProvenance, setShowProvenance] = useState(false);
    const inputRef = useRef(null);
    const historyRef = useRef(null);


    // Get active question
    const activeQuestion = activeQuestionId ? questionsHistory.get(activeQuestionId) : null;
    const availableProvenances = activeQuestion?.provenanceSources || [];

    // Check if currently processing any questions
    const isProcessing = Array.from(questionsHistory.values()).some(q => q.isProcessing);


    useEffect(() => {
        // Reset provenance display when active question changes
        if (activeQuestionId) {
            setShowProvenance(false);
            setCurrentProvenanceIndex(0);
            setSelectedProvenance(null);
        }
    }, [activeQuestionId]);

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
        submitQuestion: (questionText, activeQuestionId) => {
            setCurrentQuestion(questionText);
            if (inputRef.current) {
                inputRef.current.focus();
            }
   
        }
    }));



    // Enhanced question submission with better error handling and timing
    const handleSubmit = async (e, questionTextOverride = null) => {
        if (e) e.preventDefault();

        const questionText = (questionTextOverride || currentQuestion).trim();
        if (!questionText || isSubmitting || !pdfDocument) return;

        // Don't allow new submissions while processing
        if (isProcessing) {
            console.log('⏸️ Cannot submit - another question is still processing');
            setSubmitError('Please wait for the current question to complete processing.');
            return;
        }

        setCurrentQuestion('');
        setIsSubmitting(true);
        setSubmitError(null);

        try {
            console.log('🔄 Submitting question:', questionText);

            // Submit question to backend
            const response = await askQuestion(questionText, pdfDocument.filename, null);

            if (response.success && response.question_id) {
                const questionId = `q_${Date.now()}`;
                const backendQuestionId = response.question_id;

                console.log('✅ Question submitted successfully:', {
                    frontendId: questionId,
                    backendId: backendQuestionId
                });

                // Create question object with better initial state
                const questionData = {
                    id: questionId,
                    backendQuestionId: backendQuestionId,
                    text: questionText,
                    answer: null,
                    answerReady: false,
                    provenanceSources: [],
                    provenanceCount: 0,
                    userProvenanceCount: 0,
                    maxProvenances: 5,
                    canRequestMore: false,
                    isProcessing: true,
                    logs: [`Processing started: ${questionText}`],
                    createdAt: new Date(),
                    processingStatus: 'processing',
                    userMessage: null,
                    processingTime: null,
                    submitTime: Date.now()
                };

                // Add to questions history
                onQuestionAdd(questionData);

                // Start watching for answer with a proper delay
                setTimeout(() => {
                    startAnswerWatcher(questionId, backendQuestionId);
                }, 1000); // Give backend time to set up files

                console.log('✅ Question processing initialized');

            } else {
                throw new Error(response.error || response.message || 'Failed to submit question to backend');
            }

        } catch (error) {
            console.error('❌ Error submitting question:', error);

            // Provide more specific error messages
            let errorMessage = 'Failed to submit question';
            if (error.message.includes('Network Error') || error.message.includes('ERR_NETWORK')) {
                errorMessage = 'Network error - please check your connection and try again';
            } else if (error.message.includes('500')) {
                errorMessage = 'Server error - please try again in a moment';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Request timed out - please try again';
            } else if (error.message) {
                errorMessage = error.message;
            }

            setSubmitError(errorMessage);
            setCurrentQuestion(questionText); // Restore question text

            // Auto-clear error after 10 seconds
            setTimeout(() => {
                setSubmitError(null);
            }, 10000);

        } finally {
            setIsSubmitting(false);
        }
    };

    // Watch for answer readiness with improved error handling and delays
    const startAnswerWatcher = (questionId, backendQuestionId) => {
        let answerCheckCount = 0;
        const maxAnswerChecks = 120; // 2 minutes max
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;

        // Add initial delay to let backend initialize
        setTimeout(() => {
            const answerInterval = setInterval(async () => {
                answerCheckCount++;

                try {
                    // Check if answer is ready
                    const answerStatus = await checkAnswer(backendQuestionId);

                    // Reset error counter on successful call
                    consecutiveErrors = 0;

                    if (answerStatus.success && answerStatus.ready) {
                        console.log('✅ Answer ready for question:', questionId);

                        // Update question with answer
                        updateQuestion(questionId, {
                            answer: answerStatus.answer,
                            answerReady: true,
                            answerTimestamp: answerStatus.timestamp
                        });

                        // Stop watching for answer
                        clearInterval(answerInterval);

                        // Start status monitoring for provenance with a small delay
                        setTimeout(() => {
                            startStatusMonitoring(questionId, backendQuestionId);
                        }, 500);

                    } else if (answerCheckCount >= maxAnswerChecks) {
                        // Timeout
                        console.log('⏰ Answer check timeout for question:', questionId);
                        clearInterval(answerInterval);
                        updateQuestion(questionId, {
                            isProcessing: false,
                            processingStatus: 'timeout',
                            userMessage: 'Answer retrieval timed out. Processing may still be ongoing.'
                        });
                    }

                } catch (error) {
                    consecutiveErrors++;
                    console.warn(`⚠️ Error checking answer (attempt ${consecutiveErrors}/${maxConsecutiveErrors}):`, error);

                    // If we hit too many consecutive errors, stop trying
                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        console.error('❌ Too many consecutive errors, stopping answer watcher');
                        clearInterval(answerInterval);
                        updateQuestion(questionId, {
                            isProcessing: false,
                            processingStatus: 'error',
                            userMessage: 'Unable to check answer status. Please refresh and try again.'
                        });
                        return;
                    }

                    // Increase check interval on errors to reduce load
                    if (consecutiveErrors > 2) {
                        answerCheckCount += 2; // Skip some checks to slow down
                    }
                }
            }, 1500); // Slightly slower interval - 1.5 seconds

            // Store interval for cleanup
            updateQuestion(questionId, { answerInterval });

        }, 2000); // Initial 2-second delay before starting checks
    };

    // Enhanced status monitoring with interval tracking
    const startStatusMonitoring = (questionId, backendQuestionId) => {
        let statusCheckCount = 0;
        const maxStatusChecks = 150; // 5 minutes max
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;

        console.log(`🎬 Starting status monitoring for question ${questionId} (backend: ${backendQuestionId})`);

        const statusInterval = setInterval(async () => {
            statusCheckCount++;
            console.log(`🔄 Status check #${statusCheckCount} for question ${questionId} - interval still running`);

            try {
                const statusResponse = await getQuestionStatus(backendQuestionId);
                console.log(`📊 Status response #${statusCheckCount}:`, statusResponse);

                consecutiveErrors = 0;

                if (statusResponse.success) {
                    const status = statusResponse.status;

                    // Log detailed status
                    console.log(`📈 Status details for check #${statusCheckCount}:`, {
                        provenance_count: status.provenance_count,
                        user_provenance_count: status.user_provenance_count,
                        processing_complete: status.processing_complete,
                        can_request_more: status.can_request_more,
                        answer_ready: status.answer_ready
                    });

                    updateQuestion(questionId, {
                        provenanceCount: status.provenance_count || 0,
                        userProvenanceCount: status.user_provenance_count || 0,
                        canRequestMore: status.can_request_more || false,
                        isProcessing: !status.processing_complete,
                        processingStatus: status.processing_complete ? 'completed' : 'processing',
                        processingComplete: status.processing_complete // Add this field
                    });

                    console.log(`📝 Updated question state for ${questionId}`);

                    // Check if we should stop monitoring
                    if (status.processing_complete) {
                        console.log(`✅ Processing completed for question ${questionId} - stopping monitoring`);
                        clearInterval(statusInterval);

                        updateQuestion(questionId, {
                            processingTime: status.processing_time,
                            finalProvenanceCount: status.provenance_count
                        });

                        console.log(`🏁 Status monitoring stopped for ${questionId} after ${statusCheckCount} checks`);
                        return;
                    } else {
                        console.log(`⏳ Processing still ongoing for ${questionId} - continuing monitoring`);
                    }
                } else {
                    console.warn(`⚠️ Status check #${statusCheckCount} returned unsuccessful response:`, statusResponse);
                }

                if (statusCheckCount >= maxStatusChecks) {
                    console.log(`⏰ Status monitoring timeout for question ${questionId} after ${statusCheckCount} checks`);
                    clearInterval(statusInterval);
                    updateQuestion(questionId, {
                        isProcessing: false,
                        processingStatus: 'timeout',
                        userMessage: 'Status monitoring timed out, but processing may have completed.'
                    });
                    return;
                }

            } catch (error) {
                consecutiveErrors++;
                console.error(`❌ Error in status check #${statusCheckCount} (consecutive errors: ${consecutiveErrors}):`, error);

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.error(`💥 Too many consecutive errors (${consecutiveErrors}), stopping status monitoring for ${questionId}`);
                    clearInterval(statusInterval);
                    updateQuestion(questionId, {
                        isProcessing: false,
                        processingStatus: 'error',
                        userMessage: 'Unable to monitor processing status. Provenance may still be available.'
                    });
                    return;
                }
            }
        }, 2000); // Check every 2 seconds

        // Store interval for cleanup and debugging
        updateQuestion(questionId, { statusInterval });
        console.log(`⏰ Status monitoring interval created for question ${questionId} - interval ID:`, statusInterval);

        // Debug: Log that the interval was created successfully
        setTimeout(() => {
            console.log(`🔍 Debug: Checking if interval is still active for ${questionId} after 3 seconds`);
        }, 3000);
    };

    // Also check the updateQuestion function to make sure it's not accidentally clearing intervals
    const updateQuestion = (questionId, updates) => {
        console.log(`🔄 ProvenanceQA: updateQuestion called for ${questionId}:`, updates);
        
        // Check if we're accidentally clearing intervals
        if (updates.statusInterval === null || updates.answerInterval === null) {
            console.warn(`⚠️ WARNING: Clearing interval in updates for ${questionId}:`, updates);
        }
        
        // Call the parent's update function
        onQuestionUpdate(questionId, updates);
    };

    // Updated handleGetNextProvenance to handle your backend format
    const handleGetNextProvenance = async () => {
        if (!activeQuestion) {
            console.log('❌ No active question');
            return;
        }

        const questionId = activeQuestion.id;
        const backendQuestionId = activeQuestion.backendQuestionId;
        const currentCount = activeQuestion.userProvenanceCount;

        console.log('🔍 handleGetNextProvenance called:', {
            questionId,
            backendQuestionId,
            currentCount,
            canRequestMore: activeQuestion.canRequestMore,
            isProcessing: activeQuestion.isProcessing,
            provenanceCount: activeQuestion.provenanceCount,
            processingComplete: activeQuestion.processingComplete
        });

        try {
            console.log(`🔍 Requesting provenance ${currentCount + 1} for question:`, questionId);

            updateQuestion(questionId, { requestingProvenance: true });

            const provenanceResponse = await getNextProvenance(backendQuestionId, currentCount);

            console.log('📦 Provenance response:', provenanceResponse);

            if (provenanceResponse.success && provenanceResponse.has_more) {
                const newProvenance = provenanceResponse.provenance;
                console.log('✨ Raw provenance received:', newProvenance);

                let enhancedProvenance = { ...newProvenance };

                if (newProvenance.provenance_ids && newProvenance.provenance) {
                    enhancedProvenance.sentences_ids = newProvenance.provenance_ids;
                    enhancedProvenance.content = [newProvenance.provenance];

                    console.log('✅ Enhanced provenance with your format:', {
                        sentences_ids: enhancedProvenance.sentences_ids,
                        content: enhancedProvenance.content,
                        provenance_id: enhancedProvenance.provenance_id,
                        time: enhancedProvenance.time
                    });
                } else {
                    console.warn('⚠️ Provenance missing expected fields:', newProvenance);
                    // Fallback: try to fetch sentences using the old method
                    if (newProvenance.sentences_ids && newProvenance.sentences_ids.length > 0) {
                        try {
                            console.log('📖 Fallback: Fetching sentences for IDs:', newProvenance.sentences_ids);
                            const sentencesResponse = await fetchSentences(
                                pdfDocument.filename,
                                newProvenance.sentences_ids
                            );

                            if (sentencesResponse.success) {
                                const content = newProvenance.sentences_ids.map(id =>
                                    sentencesResponse.sentences[id] || `[SENTENCE_${id}_NOT_FOUND]`
                                );
                                enhancedProvenance.content = content;
                                console.log('✅ Enhanced provenance with fetched content:', enhancedProvenance);
                            }
                        } catch (error) {
                            console.warn('⚠️ Failed to enhance provenance with content:', error);
                            // Set a fallback message
                            enhancedProvenance.content = ['Content not available'];
                        }
                    }
                }

                // Add to provenance sources
                const updatedProvenances = [...activeQuestion.provenanceSources, enhancedProvenance];

                updateQuestion(questionId, {
                    provenanceSources: updatedProvenances,
                    userProvenanceCount: currentCount + 1,
                    requestingProvenance: false,
                    canRequestMore: provenanceResponse.remaining > 0
                });

                // Auto-select the new provenance
                const newIndex = updatedProvenances.length - 1;
                setCurrentProvenanceIndex(newIndex);
                setSelectedProvenance(enhancedProvenance);
                setShowProvenance(true);

                if (enhancedProvenance.sentences_ids && enhancedProvenance.sentences_ids.length > 0) {
                    const firstSentenceId = enhancedProvenance.sentences_ids[0];
                    console.log('🎯 ProvenanceQA: Triggering navigation for sentence:', firstSentenceId);

                    // Set navigation trigger that will be passed to PDF viewer
                    onNavigationTrigger({
                        sentenceId: firstSentenceId,
                        timestamp: Date.now(),
                        provenanceId: enhancedProvenance.provenance_id
                    });
                }

                // Notify parent components
                if (onProvenanceSelect) {
                    onProvenanceSelect(enhancedProvenance);
                }
                if (onHighlightInPDF) {
                    onHighlightInPDF(enhancedProvenance);
                }

                console.log('✅ Provenance added successfully');

            } else {
                console.log('ℹ️ No provenances available:', provenanceResponse);

                // Handle different reasons
                if (provenanceResponse.reason === 'processing_ongoing') {
                    // Still processing - keep the button available but show message
                    updateQuestion(questionId, {
                        requestingProvenance: false,
                        userMessage: provenanceResponse.message,
                        canRequestMore: true // Keep button available for retry
                    });

                    // Auto-retry after a delay if suggested
                    if (provenanceResponse.retry_suggested) {
                        setTimeout(() => {
                            console.log('🔄 Auto-retrying provenance request...');
                            handleGetNextProvenance();
                        }, 3000); // Retry after 3 seconds
                    }
                } else {
                    // No more provenances available
                    updateQuestion(questionId, {
                        requestingProvenance: false,
                        canRequestMore: false,
                        userMessage: provenanceResponse.message || 'No more provenances available'
                    });
                }
            }

        } catch (error) {
            console.error('❌ Error getting next provenance:', error);
            updateQuestion(questionId, {
                requestingProvenance: false,
                userMessage: `Error getting provenance: ${error.message}`
            });
        }
    };

  
 const handleDotNavigation = (index) => {
    setCurrentProvenanceIndex(index);
    const provenance = activeQuestion.provenanceSources[index];
    setSelectedProvenance(provenance);
    
    // Send navigation trigger directly (no state)
    if (provenance.sentences_ids && provenance.sentences_ids.length > 0 && onNavigationTrigger) {
        const firstSentenceId = provenance.sentences_ids[0];
        console.log('🎯 ProvenanceQA: Dot nav - Sending navigation trigger for sentence:', firstSentenceId);
        
        onNavigationTrigger({
            sentenceId: firstSentenceId,
            timestamp: Date.now(),
            provenanceId: provenance.provenance_id
        });
    }
    
    if (onProvenanceSelect) onProvenanceSelect(provenance);
    if (onHighlightInPDF) onHighlightInPDF(provenance);
};

const handlePreviousProvenance = () => {
    if (currentProvenanceIndex > 0) {
        const newIndex = currentProvenanceIndex - 1;
        setCurrentProvenanceIndex(newIndex);
        const provenance = availableProvenances[newIndex];
        setSelectedProvenance(provenance);
        
        // Send navigation trigger directly
        if (provenance.sentences_ids && provenance.sentences_ids.length > 0 && onNavigationTrigger) {
            const firstSentenceId = provenance.sentences_ids[0];
            console.log('🎯 ProvenanceQA: Previous - Sending navigation trigger for sentence:', firstSentenceId);
            
            onNavigationTrigger({
                sentenceId: firstSentenceId,
                timestamp: Date.now(),
                provenanceId: provenance.provenance_id
            });
        }
        
        if (onProvenanceSelect) onProvenanceSelect(provenance);
        if (onHighlightInPDF) onHighlightInPDF(provenance);
    }
};

const handleNextProvenance = () => {
    if (currentProvenanceIndex < availableProvenances.length - 1) {
        const newIndex = currentProvenanceIndex + 1;
        setCurrentProvenanceIndex(newIndex);
        const provenance = availableProvenances[newIndex];
        setSelectedProvenance(provenance);
        
        // Send navigation trigger directly
        if (provenance.sentences_ids && provenance.sentences_ids.length > 0 && onNavigationTrigger) {
            const firstSentenceId = provenance.sentences_ids[0];
            console.log('🎯 ProvenanceQA: Next - Sending navigation trigger for sentence:', firstSentenceId);
            
            onNavigationTrigger({
                sentenceId: firstSentenceId,
                timestamp: Date.now(),
                provenanceId: provenance.provenance_id
            });
        }
        
        if (onProvenanceSelect) onProvenanceSelect(provenance);
        if (onHighlightInPDF) onHighlightInPDF(provenance);
    }
};





    // Handle retry after error
    const handleRetry = () => {
        setSubmitError(null);
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    // Handle keyboard shortcuts
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    // Clear submit error when user starts typing
    useEffect(() => {
        if (submitError && currentQuestion) {
            setSubmitError(null);
        }
    }, [currentQuestion]);

    // FIXED: Cleanup intervals only on component unmount
    useEffect(() => {
        // This cleanup function will only run when the component unmounts
        return () => {
            console.log('🧹 Component unmounting - clearing all intervals');
            questionsHistory.forEach((question) => {
                if (question.answerInterval) {
                    console.log('🧹 Clearing answer interval');
                    clearInterval(question.answerInterval);
                }
                if (question.statusInterval) {
                    console.log('🧹 Clearing status interval');
                    clearInterval(question.statusInterval);
                }
            });
        };
    }, []); // ✅ Empty dependency array - only runs on unmount

    // Auto-select first provenance when available
    useEffect(() => {
        if (availableProvenances.length > 0 && currentProvenanceIndex >= availableProvenances.length) {
            setCurrentProvenanceIndex(0);
        }

        if (availableProvenances.length > 0) {
            const provenance = availableProvenances[currentProvenanceIndex];
            setSelectedProvenance(provenance);
        } else {
            setSelectedProvenance(null);
        }
    }, [availableProvenances.length, currentProvenanceIndex]);

    const formatTimestamp = (date) => {
        return new Date(date).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getQuestionUIStatus = (question) => {
        if (question.processingStatus === 'error') {
            return {
                icon: faExclamationTriangle,
                color: '#dc3545',
                spin: false,
                text: 'Error',
                className: 'error'
            };
        } else if (question.isProcessing) {
            return {
                icon: faSpinner,
                color: '#ff9500',
                spin: true,
                text: 'Processing...',
                className: 'processing'
            };
        } else if (question.answer || question.provenanceSources?.length > 0) {
            return {
                icon: faCheck,
                color: '#28a745',
                spin: false,
                text: 'Completed',
                className: 'completed'
            };
        } else {
            return {
                icon: faClock,
                color: '#6c757d',
                spin: false,
                text: 'Pending',
                className: 'pending'
            };
        }
    };

    if (!pdfDocument) {
        return (
            <div className="provenance-qa-empty">
                <div className="empty-icon"></div>
    
     
            </div>
        );
    }

    const questionsArray = Array.from(questionsHistory.values()).sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );

    return (
        <div className="provenance-qa-component">
            {/* Question Input Section */}
            <div className="qa-input-section">
                <div className="section-header">
                    <FontAwesomeIcon icon={faTerminal} />
                    <h4>Ask Questions</h4>
 
                </div>

                {/* Error Display */}
                {submitError && (
                    <div className="submit-error">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span className="error-message">{submitError}</span>
                        <button className="retry-btn" onClick={handleRetry}>
                            <FontAwesomeIcon icon={faRefresh} />
                            Retry
                        </button>
                    </div>
                )}

                {/* Question Input */}
                <form onSubmit={handleSubmit} className="question-form">
                    <textarea
                        ref={inputRef}
                        className={`question-textarea ${submitError ? 'error' : ''}`}
                        value={currentQuestion}
                        onChange={(e) => setCurrentQuestion(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={
                            isProcessing
                                ? "Please wait for current question to complete..."
                                : submitError
                                    ? "Fix the issue above and try again..."
                                    : "What would you like to know about this document?"
                        }
                        disabled={isSubmitting || isProcessing}
                        rows={2}
                    />

                    <button
                        type="submit"
                        className={`submit-btn ${submitError ? 'error' : ''}`}
                        disabled={!currentQuestion.trim() || isSubmitting || isProcessing}
                    >
                        {isSubmitting ? (
                            <FontAwesomeIcon icon={faSpinner} spin />
                        ) : (
                            <FontAwesomeIcon icon={faPaperPlane} />
                        )}
                        <span>
                            {isSubmitting ? 'Submitting...' : 'Ask Question'}
                        </span>
                    </button>
                </form>
            </div>

            {/* Current Question Display */}
            {activeQuestion && (
                <div className="current-question-section">
                    <div className="section-header">
                        <FontAwesomeIcon icon={faFileAlt} />
                        <h4>Current Question</h4>
                        <div className="question-status">
                            {(() => {
                                const status = getQuestionUIStatus(activeQuestion);
                                return (
                                    <span className={`status-indicator ${status.className}`}>
                                        <FontAwesomeIcon icon={status.icon} spin={status.spin} />
                                        {status.text}
                                    </span>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="question-display">
                        <div className="question-text">{activeQuestion.text}</div>

                        {/* Answer Section */}
                        {activeQuestion.answerReady && activeQuestion.answer ? (
                            <div className="answer-section">
                                <div className="answer-header">
                                    <FontAwesomeIcon icon={faCheck} />
                                    <span>Answer</span>
                                </div>
                                <div className="answer-content">{activeQuestion.answer}</div>
                            </div>
                        ) : activeQuestion.isProcessing ? (
                            <div className="answer-pending">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                <span>Generating answer...</span>
                            </div>
                        ) : null}

                        {/* Provenance Section */}
                        <div className="provenance-section">
                            <div className="provenance-header">
                                <FontAwesomeIcon icon={faHighlighter} />
                                <span>Provenances</span>
                                {activeQuestion.provenanceSources.length > 0 && (
                                    <span className="provenance-counter">
                                        {currentProvenanceIndex + 1} of {activeQuestion.provenanceSources.length}
                                    </span>
                                )}
                            </div>

                            {activeQuestion.provenanceSources.length > 0 ? (
                                <div className="provenance-display">
                                    {/* Provenance Navigation */}
                                    <div className="provenance-navigation">
                                        <button
                                            className="nav-btn prev"
                                            onClick={handlePreviousProvenance}
                                            disabled={currentProvenanceIndex === 0}
                                        >
                                            <FontAwesomeIcon icon={faChevronLeft} />
                                            Previous
                                        </button>

                                        <div className="provenance-dots">
                                            {activeQuestion.provenanceSources.map((_, index) => (
                                                <button
                                                    key={index}
                                                    className={`dot ${index === currentProvenanceIndex ? 'active' : ''}`}
                                                    onClick={() => handleDotNavigation(index)}
                                                />
                                            ))}
                                        </div>

                                        <button
                                            className="nav-btn next"
                                            onClick={handleNextProvenance}
                                            disabled={currentProvenanceIndex === activeQuestion.provenanceSources.length - 1}
                                        >
                                            Next
                                            <FontAwesomeIcon icon={faChevronRight} />
                                        </button>
                                    </div>

                                    {/* Current Provenance Content */}
                                    {selectedProvenance && (
                                        <div className="current-provenance">
                                 

                                            <div className="provenance-content">
                                                {selectedProvenance.content && selectedProvenance.content.length > 0 ? (
                                                    <div className="evidence-text">
                                                        {Array.isArray(selectedProvenance.content) ? (
                                                            selectedProvenance.content.map((sentence, idx) => (
                                                                <div key={idx} className="evidence-sentence" data-sentence-id={selectedProvenance.sentences_ids?.[idx]}>
                                                                    <span className="sentence-number">{idx + 1}</span>
                                                                    <span className="sentence-text">{sentence}</span>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="evidence-sentence">
                                                                <span className="sentence-text">{selectedProvenance.content}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="loading-evidence">
                                                        <FontAwesomeIcon icon={faSpinner} spin />
                                                        <span>Searching for provenance...</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="provenance-actions">
                                         

                                                <button
                                                    className="action-btn feedback-btn"
                                                    onClick={() => onFeedbackRequest && onFeedbackRequest(activeQuestion)}
                                                >
                                                    <FontAwesomeIcon icon={faComment} />
                                                    Provide Feedback
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="provenance-empty">
                                    {/* Case 1: Answer ready, but provenances are still being generated */}
                                    {activeQuestion.answerReady &&
                                        activeQuestion.answer &&
                                        !activeQuestion.processing_complete &&
                                        activeQuestion.provenanceCount === 0 ? (
                                        <div className="provenance-processing">
                                            <FontAwesomeIcon icon={faSpinner} spin />
                                            <span>Searching for provenance...</span>
                                            <div className="processing-info">
                                                <small>This may take a moment while we analyze the document</small>
                                            </div>
                                        </div>
                                    ) :
                                        /* Case 2: Answer ready, provenances available, haven't requested any yet */
                                        activeQuestion.answerReady &&
                                            activeQuestion.answer &&
                                            activeQuestion.provenanceCount > 0 &&
                                            activeQuestion.provenanceSources.length === 0 ? (
                                            <div className="get-provenance-section">
                                                <p>Provenance found! ({activeQuestion.provenanceCount} available)</p>
                                                <button
                                                    className="get-provenance-btn"
                                                    onClick={() => {
                                                        console.log('🎬 Initial provenance button clicked');
                                                        setShowProvenance(true);
                                                        handleGetNextProvenance();
                                                    }}
                                                    disabled={activeQuestion.requestingProvenance}
                                                >
                                                    {activeQuestion.requestingProvenance ? (
                                                        <>
                                                            <FontAwesomeIcon icon={faSpinner} spin />
                                                            <span>Searching for provenance...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <FontAwesomeIcon icon={faSearchPlus} />
                                                            <span>Get Provenance</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ) :
                                            /* Case 3: Provenances shown, but can get more */
                                            activeQuestion.canRequestMore && activeQuestion.provenanceSources.length > 0 ? (
                                                <div className="get-provenance-section">
                                                    <p>More provenance available.</p>
                                                    <button
                                                        className="get-provenance-btn"
                                                        onClick={() => {
                                                            console.log('🔄 Requesting additional provenance');
                                                            handleGetNextProvenance();
                                                        }}
                                                        disabled={activeQuestion.requestingProvenance}
                                                    >
                                                        {activeQuestion.requestingProvenance ? (
                                                            <>
                                                                <FontAwesomeIcon icon={faSpinner} spin />
                                                                <span>Loading Provenance...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <FontAwesomeIcon icon={faSearchPlus} />
                                                                <span>Get Next Provenance</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            ) :
                                                /* Case 4: Still processing answer */
                                                activeQuestion.isProcessing && !activeQuestion.answerReady ? (
                                                    <div className="provenance-processing">
                                                        <FontAwesomeIcon icon={faSpinner} spin />
                                                        <span>Processing question...</span>
                                                    </div>
                                                ) :
                                                    /* Case 5: Processing complete but no provenances found */
                                                    activeQuestion.processing_complete && activeQuestion.provenanceCount === 0 ? (
                                                        <div className="no-provenance">
                                                            <span>No provenance found for this answer</span>
                                                            <div className="user-message">
                                                                <small>The answer exists but no provenance was found in the document.</small>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* Case 6: Default - no evidence available */
                                                        <div className="no-provenance">
                                                            <span>No provenance available</span>
                                                            {activeQuestion.userMessage && (
                                                                <div className="user-message">{activeQuestion.userMessage}</div>
                                                            )}
                                                        </div>
                                                    )}
                                </div>
                            )}

                            {/* Get More Provenance Button */}
                            {activeQuestion.canRequestMore && activeQuestion.provenanceSources.length > 0 && (
                                <div className="get-more-section">
                                    <button
                                        className="get-more-btn"
                                        onClick={handleGetNextProvenance}
                                        disabled={activeQuestion.requestingProvenance}
                                    >
                                        {activeQuestion.requestingProvenance ? (
                                            <>
                                                <FontAwesomeIcon icon={faSpinner} spin />
                                                <span>Loading...</span>
                                            </>
                                        ) : (
                                            <>
                                                <FontAwesomeIcon icon={faArrowRight} />
                                                <span>Get Next Provenance</span>
                                            </>
                                        )}
                                    </button>
                                    <div className="provenance-info">
                                        Showing {activeQuestion.userProvenanceCount} of {activeQuestion.maxProvenances} 
                                        {activeQuestion.provenanceCount > activeQuestion.userProvenanceCount &&
                                            ` (${activeQuestion.provenanceCount - activeQuestion.userProvenanceCount} more available)`}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

           
        </div>
    );
});

export default ProvenanceQA;