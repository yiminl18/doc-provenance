import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import QuestionInput from './QuestionInput';
import AnswerDisplay from './AnswerDisplay';
import ProvenanceDisplay from './ProvenanceDisplay';
import {
    askQuestion,
    checkAnswer,
    getNextProvenance,
    getQuestionStatus,
    fetchSentences
} from '../services/api';
import '../styles/modular-qa.css'
const ProvenanceQAX = forwardRef(({
    pdfDocument,
    questionsHistory,
    activeQuestionId,
    onQuestionUpdate,
    onQuestionAdd,
    onActiveQuestionChange,
    onProvenanceSelect,
    onFeedbackRequest,
    onHighlightInPDF,
    onNavigationTrigger
}, ref) => {
    // State for submission
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [cancelTokens, setCancelTokens] = useState(new Map());

    const questionInputRef = useRef(null);

    // Get active question and processing state
    const activeQuestion = activeQuestionId ? questionsHistory.get(activeQuestionId) : null;
    const isProcessing = Array.from(questionsHistory.values()).some(q => q.isProcessing);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        submitQuestion: (questionText) => {
            handleQuestionSubmit(questionText);
        },
        focusInput: () => {
            questionInputRef.current?.focus();
        }
    }));

    // Utility functions
    const createCancelToken = (questionId) => {
        const abortController = new AbortController();
        setCancelTokens(prev => new Map(prev).set(questionId, abortController));
        return abortController;
    };

    const cancelQuestionProcessing = async (questionId, reason = 'user_cancelled') => {
        console.log(`🛑 Cancelling question processing: ${questionId}`);

        const cancelToken = cancelTokens.get(questionId);
        if (cancelToken) {
            cancelToken.abort();
            setCancelTokens(prev => {
                const newTokens = new Map(prev);
                newTokens.delete(questionId);
                return newTokens;
            });
        }

        onQuestionUpdate(questionId, {
            isProcessing: false,
            processingStatus: 'cancelled',
            userMessage: getCancellationMessage(reason),
            cancellable: false
        });
    };

    const getCancellationMessage = (reason) => {
        switch (reason) {
            case 'user_cancelled':
                return 'Processing cancelled by user. You can submit a new question.';
            case 'new_question_submitted':
                return 'Processing cancelled due to new question submission.';
            default:
                return 'Processing was cancelled.';
        }
    };

    const cancelAllProcessing = async (reason = 'user_cancelled') => {
        const processingQuestions = Array.from(questionsHistory.values())
            .filter(q => q.isProcessing)
            .map(q => q.id);

        for (const questionId of processingQuestions) {
            await cancelQuestionProcessing(questionId, reason);
        }
    };

    // Question submission handler
    const handleQuestionSubmit = async (questionInput) => {
        // Handle both string and object inputs
        const questionText = typeof questionInput === 'string' 
            ? questionInput 
            : questionInput?.question_text || questionInput?.text || String(questionInput);
            
        if (!questionText || isSubmitting || !pdfDocument) return;

        if (isProcessing) {
            await cancelAllProcessing('new_question_submitted');
        }

        setIsSubmitting(true);
        setSubmitError(null);

        const questionId = `q_${Date.now()}`;
        const cancelToken = createCancelToken(questionId);

        try {
            const response = await askQuestion(questionText, pdfDocument.filename, { 
                signal: cancelToken.signal 
            });

            if (response.success && response.question_id) {
                // Enhanced: Use the returned question object if available
                const serverQuestion = response.question || {};
                
                const questionData = {
                    id: questionId,
                    backendQuestionId: response.question_id,
                    text: questionText,
                    answer: null,
                    answerReady: false,
                    provenanceSources: [],
                    provenanceCount: serverQuestion.provenance_count || 0,
                    userProvenanceCount: 0,
                    maxProvenances: 5,
                    canRequestMore: false,
                    isProcessing: true,
                    createdAt: new Date(),
                    processingStatus: 'processing',
                    submitTime: Date.now(),
                    cancellable: true,
                    
                    // Enhanced: Include server metadata
                    serverQuestion: serverQuestion,
                    matchedVia: response.matched_via || 'unknown',
                    hasServerAnswer: serverQuestion.has_answer || false,
                    expectedProcessingTime: serverQuestion.processing_time || null
                };

                onQuestionAdd(questionData);
                
                // Enhanced: Log more details
                console.log('✅ Question submitted successfully:', {
                    frontendId: questionId,
                    backendId: response.question_id,
                    matchedVia: response.matched_via,
                    hasAnswer: serverQuestion.has_answer,
                    provenanceCount: serverQuestion.provenance_count
                });
                
                setTimeout(() => startAnswerWatcher(questionId, response.question_id, cancelToken), 1000);
            } else {
                throw new Error(response.error || 'Failed to submit question');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }

            setSubmitError(error.message);
            setTimeout(() => setSubmitError(null), 10000);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Answer watching
    const startAnswerWatcher = (questionId, backendQuestionId, cancelToken) => {
        let answerCheckCount = 0;
        const maxChecks = 120;

        const answerInterval = setInterval(async () => {
            if (cancelToken.signal.aborted) {
                clearInterval(answerInterval);
                return;
            }

            answerCheckCount++;

            try {
                const answerStatus = await checkAnswer(backendQuestionId, {
                    signal: cancelToken.signal
                });

                if (answerStatus.success && answerStatus.ready) {
                    onQuestionUpdate(questionId, {
                        answer: answerStatus.answer,
                        answerReady: true
                    });

                    clearInterval(answerInterval);
                    setTimeout(() => startStatusMonitoring(questionId, backendQuestionId, cancelToken), 500);
                } else if (answerCheckCount >= maxChecks) {
                    clearInterval(answerInterval);
                    onQuestionUpdate(questionId, {
                        isProcessing: false,
                        processingStatus: 'timeout',
                        userMessage: 'Answer retrieval timed out.'
                    });
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    clearInterval(answerInterval);
                    return;
                }
                console.warn('Error checking answer:', error);
            }
        }, 1500);
    };

    // Status monitoring
    const startStatusMonitoring = (questionId, backendQuestionId, cancelToken) => {
        let statusCheckCount = 0;
        const maxChecks = 150;

        const statusInterval = setInterval(async () => {
            if (cancelToken.signal.aborted) {
                clearInterval(statusInterval);
                return;
            }

            statusCheckCount++;

            try {
                const statusResponse = await getQuestionStatus(backendQuestionId, {
                    signal: cancelToken.signal
                });

                if (statusResponse.success) {
                    const status = statusResponse.status;

                    onQuestionUpdate(questionId, {
                        provenanceCount: status.provenance_count || 0,
                        userProvenanceCount: status.user_provenance_count || 0,
                        canRequestMore: status.can_request_more || false,
                        isProcessing: !status.processing_complete,
                        processingStatus: status.processing_complete ? 'completed' : 'processing',
                        processingComplete: status.processing_complete
                    });

                    if (status.processing_complete) {
                        clearInterval(statusInterval);
                        onQuestionUpdate(questionId, {
                            processingTime: status.processing_time,
                            cancellable: false
                        });

                        setCancelTokens(prev => {
                            const newTokens = new Map(prev);
                            newTokens.delete(questionId);
                            return newTokens;
                        });
                    }
                }

                if (statusCheckCount >= maxChecks) {
                    clearInterval(statusInterval);
                    onQuestionUpdate(questionId, {
                        isProcessing: false,
                        processingStatus: 'timeout'
                    });
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    clearInterval(statusInterval);
                    return;
                }
                console.error('Error in status check:', error);
            }
        }, 2000);
    };

    // Provenance handlers
    const handleGetFirstProvenance = async () => {
        if (!activeQuestion) return;
        await handleGetNextProvenance();
    };

    const handleGetNextProvenance = async () => {
        if (!activeQuestion) return;

        const questionId = activeQuestion.id;
        const backendQuestionId = activeQuestion.backendQuestionId;
        const currentCount = activeQuestion.userProvenanceCount;

        try {
            onQuestionUpdate(questionId, { requestingProvenance: true });

            const provenanceResponse = await getNextProvenance(backendQuestionId, currentCount);

            if (provenanceResponse.success && provenanceResponse.has_more) {
                const newProvenance = provenanceResponse.provenance;
                let enhancedProvenance = { ...newProvenance };

                if (newProvenance.provenance_ids && newProvenance.provenance) {
                    enhancedProvenance.sentences_ids = newProvenance.provenance_ids;
                    enhancedProvenance.content = [newProvenance.provenance];
                }

                const updatedProvenances = [...activeQuestion.provenanceSources, enhancedProvenance];

                onQuestionUpdate(questionId, {
                    provenanceSources: updatedProvenances,
                    userProvenanceCount: currentCount + 1,
                    requestingProvenance: false,
                    canRequestMore: provenanceResponse.remaining > 0
                });

                if (enhancedProvenance.sentences_ids?.length > 0) {
                    onNavigationTrigger({
                        sentenceId: enhancedProvenance.sentences_ids[0],
                        timestamp: Date.now(),
                        provenanceId: enhancedProvenance.provenance_id
                    });
                }

                if (onProvenanceSelect) onProvenanceSelect(enhancedProvenance);
                if (onHighlightInPDF) onHighlightInPDF(enhancedProvenance);
            } else {
                onQuestionUpdate(questionId, {
                    requestingProvenance: false,
                    userMessage: provenanceResponse.message || 'No more provenances available'
                });
            }
        } catch (error) {
            console.error('Error getting next provenance:', error);
            onQuestionUpdate(questionId, {
                requestingProvenance: false,
                userMessage: `Error getting provenance: ${error.message}`
            });
        }
    };

    // Retry handler
    const handleRetryQuestion = (questionText) => {
        if (questionInputRef.current) {
            questionInputRef.current.setQuestion(questionText);
            questionInputRef.current.focus();
        }
    };

    return (
        <div className="provenance-qa-container">
            {/* Provenance Display Component */}
            <ProvenanceDisplay
                question={activeQuestion}
                onGetProvenance={handleGetFirstProvenance}
                onGetNextProvenance={handleGetNextProvenance}
                onProvenanceSelect={onProvenanceSelect}
                onNavigationTrigger={onNavigationTrigger}
                onFeedbackRequest={onFeedbackRequest}
            />

            {/* Answer Display Component */}
            <AnswerDisplay
                question={activeQuestion}
                onCancel={cancelQuestionProcessing}
                onRetry={handleRetryQuestion}
            />

            {/* Question Input Component */}
            <QuestionInput
                ref={questionInputRef}
                pdfDocument={pdfDocument}
                isSubmitting={isSubmitting}
                isProcessing={isProcessing}
                submitError={submitError}
                onSubmit={handleQuestionSubmit}
                onCancelAll={() => cancelAllProcessing('user_cancelled')}
            />




        </div>
    );
});

export default ProvenanceQAX;