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
    faQuestionCircle,
    faExclamationTriangle,
    faRefresh,
    faBookOpen,
    faBookmark,
    faArrowRight,
    faSearchPlus,
    faHighlighter,
    faChevronLeft,
    faChevronRight,
    faTrash,
    faTimes,
    faStopCircle,
    faExclamationCircle
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
import QuestionSuggestionsModal from './QuestionSuggestionsModal';

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
    const [showQuestionSuggestions, setShowQuestionSuggestions] = useState(false);


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

    // Add cancel-related state
    const [cancelTokens, setCancelTokens] = useState(new Map()); // Track cancel tokens by question ID
    const [cancellationReasons, setCancellationReasons] = useState(new Map()); // Track why questions were cancelled

    // Create AbortController for cancelling requests
    const createCancelToken = (questionId) => {
        const abortController = new AbortController();
        setCancelTokens(prev => new Map(prev).set(questionId, abortController));
        return abortController;
    };

    // Cancel a specific question's processing
    const cancelQuestionProcessing = async (questionId, reason = 'user_cancelled') => {
        console.log(`🛑 Cancelling question processing: ${questionId}, reason: ${reason}`);

        const activeQuestionData = questionsHistory.get(questionId);
        if (!activeQuestionData) {
            console.warn(`Question ${questionId} not found for cancellation`);
            return;
        }

        // Cancel any ongoing HTTP requests
        const cancelToken = cancelTokens.get(questionId);
        if (cancelToken) {
            cancelToken.abort();
            setCancelTokens(prev => {
                const newTokens = new Map(prev);
                newTokens.delete(questionId);
                return newTokens;
            });
        }

        // Clear any intervals
        if (activeQuestionData.answerInterval) {
            clearInterval(activeQuestionData.answerInterval);
        }
        if (activeQuestionData.statusInterval) {
            clearInterval(activeQuestionData.statusInterval);
        }

        // Update question state
        updateQuestion(questionId, {
            isProcessing: false,
            processingStatus: 'cancelled',
            userMessage: getCancellationMessage(reason),
            answerInterval: null,
            statusInterval: null,
            requestingProvenance: false,
            canRequestMore: false,
            cancelledAt: Date.now(),
            cancellationReason: reason
        });

        // Store cancellation reason
        setCancellationReasons(prev => new Map(prev).set(questionId, reason));

        // Log the cancellation
        if (window.userStudyLogger) {
            await window.userStudyLogger.logUserInteraction(
                'question_cancelled',
                'provenance_qa',
                {
                    question_id: questionId,
                    reason: reason,
                    processing_time: Date.now() - (activeQuestionData.submitTime || Date.now())
                }
            );
        }

        console.log(`✅ Question ${questionId} processing cancelled`);
    };

    const getCancellationMessage = (reason) => {
        switch (reason) {
            case 'user_cancelled':
                return 'Processing cancelled by user. You can submit a new question.';
            case 'new_question_submitted':
                return 'Processing cancelled due to new question submission.';
            case 'timeout':
                return 'Processing cancelled due to timeout.';
            case 'error':
                return 'Processing cancelled due to an error.';
            default:
                return 'Processing was cancelled.';
        }
    };

    // Cancel all processing questions
    const cancelAllProcessing = async (reason = 'user_cancelled') => {
        const processingQuestions = Array.from(questionsHistory.values())
            .filter(q => q.isProcessing)
            .map(q => q.id);

        console.log(`🛑 Cancelling ${processingQuestions.length} processing questions`);

        for (const questionId of processingQuestions) {
            await cancelQuestionProcessing(questionId, reason);
        }
    };



    useEffect(() => {
        // Reset provenance display when active question changes
        if (activeQuestionId || pdfDocument) {
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

    const handleSuggestedQuestionSelect = (questionText) => {
        setCurrentQuestion(questionText);
        handleSubmit(null, questionText);
    };



     // Enhanced question submission with cancellation support
    const handleSubmit = async (e, questionTextOverride = null) => {
        if (e) e.preventDefault();

        const questionText = (questionTextOverride || currentQuestion).trim();
        if (!questionText || isSubmitting || !pdfDocument) return;

        // Cancel any currently processing questions before submitting new one
        if (isProcessing) {
            console.log('🛑 Cancelling existing processing before new submission');
            await cancelAllProcessing('new_question_submitted');
        }

        setCurrentQuestion('');
        setIsSubmitting(true);
        setSubmitError(null);

        // Create question ID and cancel token
        const questionId = `q_${Date.now()}`;
        const cancelToken = createCancelToken(questionId);

        try {
            console.log('🔄 Submitting question:', questionText);

            // Submit question to backend with abort signal
            const response = await askQuestion(
                questionText, 
                pdfDocument.filename, 
                { signal: cancelToken.signal } // Pass abort signal
            );

            if (response.success && response.question_id) {
                const backendQuestionId = response.question_id;

                console.log('✅ Question submitted successfully:', {
                    frontendId: questionId,
                    backendId: backendQuestionId
                });

                // Create question object
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
                    submitTime: Date.now(),
                    cancellable: true // Mark as cancellable
                };

                // Add to questions history
                onQuestionAdd(questionData);

                // Start watching for answer
                setTimeout(() => {
                    startAnswerWatcher(questionId, backendQuestionId, cancelToken);
                }, 1000);

                console.log('✅ Question processing initialized');

            } else {
                throw new Error(response.error || response.message || 'Failed to submit question to backend');
            }

        } catch (error) {
            // Check if error was due to cancellation
            if (error.name === 'AbortError') {
                console.log('🛑 Question submission was cancelled');
                setCurrentQuestion(questionText); // Restore question text
                return;
            }

            console.error('❌ Error submitting question:', error);

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
            setCurrentQuestion(questionText);

            // Clean up cancel token
            setCancelTokens(prev => {
                const newTokens = new Map(prev);
                newTokens.delete(questionId);
                return newTokens;
            });

            setTimeout(() => {
                setSubmitError(null);
            }, 10000);

        } finally {
            setIsSubmitting(false);
        }
    };

    // Enhanced answer watcher with cancellation support
    const startAnswerWatcher = (questionId, backendQuestionId, cancelToken) => {
        let answerCheckCount = 0;
        const maxAnswerChecks = 120;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;

        setTimeout(() => {
            const answerInterval = setInterval(async () => {
                // Check if cancelled
                if (cancelToken.signal.aborted) {
                    console.log(`🛑 Answer watcher cancelled for question ${questionId}`);
                    clearInterval(answerInterval);
                    return;
                }

                answerCheckCount++;

                try {
                    const answerStatus = await checkAnswer(backendQuestionId, {
                        signal: cancelToken.signal
                    });

                    consecutiveErrors = 0;

                    if (answerStatus.success && answerStatus.ready) {
                        console.log('✅ Answer ready for question:', questionId);

                        updateQuestion(questionId, {
                            answer: answerStatus.answer,
                            answerReady: true,
                            answerTimestamp: answerStatus.timestamp
                        });

                        clearInterval(answerInterval);

                        setTimeout(() => {
                            startStatusMonitoring(questionId, backendQuestionId, cancelToken);
                        }, 500);

                    } else if (answerCheckCount >= maxAnswerChecks) {
                        console.log('⏰ Answer check timeout for question:', questionId);
                        clearInterval(answerInterval);
                        updateQuestion(questionId, {
                            isProcessing: false,
                            processingStatus: 'timeout',
                            userMessage: 'Answer retrieval timed out. Processing may still be ongoing.'
                        });
                    }

                } catch (error) {
                    if (error.name === 'AbortError') {
                        console.log(`🛑 Answer check cancelled for question ${questionId}`);
                        clearInterval(answerInterval);
                        return;
                    }

                    consecutiveErrors++;
                    console.warn(`⚠️ Error checking answer (attempt ${consecutiveErrors}/${maxConsecutiveErrors}):`, error);

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

                    if (consecutiveErrors > 2) {
                        answerCheckCount += 2;
                    }
                }
            }, 1500);

            updateQuestion(questionId, { answerInterval });

        }, 2000);
    };

    // Enhanced status monitoring with cancellation support
    const startStatusMonitoring = (questionId, backendQuestionId, cancelToken) => {
        let statusCheckCount = 0;
        const maxStatusChecks = 150;
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;

        console.log(`🎬 Starting status monitoring for question ${questionId}`);

        const statusInterval = setInterval(async () => {
            // Check if cancelled
            if (cancelToken.signal.aborted) {
                console.log(`🛑 Status monitoring cancelled for question ${questionId}`);
                clearInterval(statusInterval);
                return;
            }

            statusCheckCount++;

            try {
                const statusResponse = await getQuestionStatus(backendQuestionId, {
                    signal: cancelToken.signal
                });

                consecutiveErrors = 0;

                if (statusResponse.success) {
                    const status = statusResponse.status;

                    updateQuestion(questionId, {
                        provenanceCount: status.provenance_count || 0,
                        userProvenanceCount: status.user_provenance_count || 0,
                        canRequestMore: status.can_request_more || false,
                        isProcessing: !status.processing_complete,
                        processingStatus: status.processing_complete ? 'completed' : 'processing',
                        processingComplete: status.processing_complete
                    });

                    if (status.processing_complete) {
                        console.log(`✅ Processing completed for question ${questionId}`);
                        clearInterval(statusInterval);

                        updateQuestion(questionId, {
                            processingTime: status.processing_time,
                            finalProvenanceCount: status.provenance_count,
                            cancellable: false // No longer cancellable when complete
                        });

                        // Clean up cancel token
                        setCancelTokens(prev => {
                            const newTokens = new Map(prev);
                            newTokens.delete(questionId);
                            return newTokens;
                        });
                        return;
                    }
                }

                if (statusCheckCount >= maxStatusChecks) {
                    console.log(`⏰ Status monitoring timeout for question ${questionId}`);
                    clearInterval(statusInterval);
                    updateQuestion(questionId, {
                        isProcessing: false,
                        processingStatus: 'timeout',
                        userMessage: 'Status monitoring timed out, but processing may have completed.'
                    });
                    return;
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log(`🛑 Status monitoring cancelled for question ${questionId}`);
                    clearInterval(statusInterval);
                    return;
                }

                consecutiveErrors++;
                console.error(`❌ Error in status check (consecutive errors: ${consecutiveErrors}):`, error);

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.error(`💥 Too many consecutive errors, stopping status monitoring for ${questionId}`);
                    clearInterval(statusInterval);
                    updateQuestion(questionId, {
                        isProcessing: false,
                        processingStatus: 'error',
                        userMessage: 'Unable to monitor processing status. Provenance may still be available.'
                    });
                    return;
                }
            }
        }, 2000);

        updateQuestion(questionId, { statusInterval });
    };

    const CancelButton = ({ questionId, className = "" }) => (
        <button
            className={`win95-btn cancel ${className}`}
            onClick={() => cancelQuestionProcessing(questionId, 'user_cancelled')}
            title="Cancel processing"
        >
            <FontAwesomeIcon icon={faStopCircle} />
            Cancel
        </button>
    );

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

    const getQuestionStatusUI = (question) => {
        if (question.processingStatus === 'error') {
            return {
                icon: faExclamationTriangle,
                color: '#dc3545',
                spin: false,
                text: 'Error',
                className: 'error'
            };
        }
        else if (question.processingStatus === 'cancelled') {
            return {
                icon: faExclamationCircle,
                color: '#ffa500',
                spin: false,
                text: 'Cancelled',
                className: 'cancelled'
            };
        }
        else if (question.isProcessing) {
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
                    <h4>Ask</h4>
                    <button
                        className="win95-btn"
                        onClick={() => setShowQuestionSuggestions(true)}
                        disabled={!pdfDocument}
                        title="View suggested questions for this document"
                    >
                        <FontAwesomeIcon icon={faQuestionCircle} />
                        Question Suggestions
                    </button>
                </div>

                {/* Add global cancel button if any questions are processing */}
                {isProcessing && (
                    <div className="processing-controls">
                        <div className="processing-indicator">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Processing questions...</span>
                        </div>
                        <button
                            className="win95-btn cancel"
                            onClick={() => cancelAllProcessing('user_cancelled')}
                            title="Cancel all processing questions"
                        >
                            <FontAwesomeIcon icon={faStopCircle} />
                            Cancel All
                        </button>
                    </div>
                )}

                {/* Error Display */}
                {submitError && (
                    <div className="submit-error">
                        <FontAwesomeIcon icon={faExclamationTriangle} />
                        <span className="error-message">{submitError}</span>
                        <button className="win95-btn retry" onClick={handleRetry}>
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
                        className={`win95-btn submit ${submitError ? 'error' : ''}`}
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
                                const status = getQuestionStatusUI(activeQuestion);
                                return (
                                    <span className={`status-indicator ${status.className}`}>
                                        <FontAwesomeIcon icon={status.icon} spin={status.spin} />
                                        {status.text}
                                    </span>
                                );
                            })()}
                        </div>
                        {/* Individual question cancel button */}
                        {activeQuestion.isProcessing && activeQuestion.cancellable && (
                            <CancelButton 
                                questionId={activeQuestion.id} 
                                className="win95-btn cancel"
                            />
                        )}
                    </div>

                    <div className="question-display">
                        <div className="question-text">{activeQuestion.text}</div>

                        {/* Show cancellation message if cancelled */}
                        {activeQuestion.processingStatus === 'cancelled' && (
                            <div className="cancellation-notice">
                                <FontAwesomeIcon icon={faExclamationCircle} />
                                <span>{activeQuestion.userMessage}</span>
                                <button 
                                    className="win95-btn retry"
                                    onClick={() => {
                                        setCurrentQuestion(activeQuestion.text);
                                        if (inputRef.current) {
                                            inputRef.current.focus();
                                        }
                                    }}
                                >
                                    Ask Again
                                </button>
                            </div>
                        )}

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
                                            className="win95-btn nav prev"
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
                                            className="win95-btn nav next"
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
                                                    className="win95-btn feedback"
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
                                                    className="win95-btn get-provenance"
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
                                                        className="win95-btn get-provenance"
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
                                        className="win95-btn get-more"
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

            <QuestionSuggestionsModal
                isOpen={showQuestionSuggestions}
                onClose={() => setShowQuestionSuggestions(false)}
                filename={pdfDocument?.filename}
                onQuestionSelect={handleSuggestedQuestionSelect}
            />
        </div>
    );
});

export default ProvenanceQA;