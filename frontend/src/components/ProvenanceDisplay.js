import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faHighlighter,
    faSpinner,
    faSearchPlus,
    faArrowRight,
    faChevronLeft,
    faChevronRight,
    faUserSecret,
    faComment
} from '@fortawesome/free-solid-svg-icons';

const ProvenanceDisplay = ({ 
    question,
    onGetProvenance,
    onGetNextProvenance,
    onProvenanceSelect,
    onNavigationTrigger,
    onFeedbackRequest
}) => {
    const [currentProvenanceIndex, setCurrentProvenanceIndex] = useState(0);
    const [selectedProvenance, setSelectedProvenance] = useState(null);

    const availableProvenances = question?.provenanceSources || [];

    useEffect(() => {
        if (availableProvenances.length > 0) {
            // When new provenance is added, automatically jump to the latest one
            const latestIndex = availableProvenances.length - 1;
            
            // Only update if we're not already showing the latest provenance
            if (currentProvenanceIndex !== latestIndex) {
                console.log(`🎯 ProvenanceDisplay: Jumping to latest provenance (index ${latestIndex})`);
                setCurrentProvenanceIndex(latestIndex);
            }
            
            const provenance = availableProvenances[latestIndex];
            setSelectedProvenance(provenance);
            
            // Trigger navigation and selection for the new provenance
            if (provenance?.sentences_ids?.length > 0 && onNavigationTrigger) {
                onNavigationTrigger({
                    sentenceId: provenance.sentences_ids[0],
                    timestamp: Date.now(),
                    provenanceId: provenance.provenance_id
                });
            }

            if (onProvenanceSelect) {
                onProvenanceSelect(provenance);
            }
        } else {
            setSelectedProvenance(null);
        }
    }, [availableProvenances.length]); // Only depend on length change, not currentProvenanceIndex

    useEffect(() => {
        if (availableProvenances.length > 0 && currentProvenanceIndex < availableProvenances.length) {
            const provenance = availableProvenances[currentProvenanceIndex];
            setSelectedProvenance(provenance);
        }
    }, [currentProvenanceIndex, availableProvenances]);

    const handleDotNavigation = (index) => {
        setCurrentProvenanceIndex(index);
        const provenance = availableProvenances[index];
        setSelectedProvenance(provenance);

        if (provenance.sentences_ids?.length > 0 && onNavigationTrigger) {
            onNavigationTrigger({
                sentenceId: provenance.sentences_ids[0],
                timestamp: Date.now(),
                provenanceId: provenance.provenance_id
            });
        }

        if (onProvenanceSelect) onProvenanceSelect(provenance);
    };

    const handlePreviousProvenance = () => {
        if (currentProvenanceIndex > 0) {
            handleDotNavigation(currentProvenanceIndex - 1);
        }
    };

    const handleNextProvenance = () => {
        if (currentProvenanceIndex < availableProvenances.length - 1) {
            handleDotNavigation(currentProvenanceIndex + 1);
        }
    };

    const handleGetFirstProvenance = () => {
        if (onGetProvenance) {
            onGetProvenance();
        }
    };

    if (!question) {
        return (
            <div className="provenance-display-component">
                <div className="qa-header">
                    <h4>
                        <FontAwesomeIcon icon={faUserSecret} />
                        Provenance
                    </h4>
                </div>
                <div className="empty-state">
                    <p>No active question</p>
                </div>
            </div>
        );
    }

    return (
        <div className="provenance-display-component">
            <div className="qa-header">
                <h4>
                    <FontAwesomeIcon icon={faUserSecret} />
                    <span>Provenance</span>
                </h4>
                {availableProvenances.length > 0 && (
                    <span className="provenance-counter">
                        {currentProvenanceIndex + 1} of {availableProvenances.length}
                    </span>
                )}
            </div>

            <div className="provenance-content-area">
                {availableProvenances.length > 0 ? (
                    selectedProvenance && (
                        <div className="current-provenance">
                            <div className="provenance-meta">
                                <span>ID: {selectedProvenance.provenance_id}</span>
                                {selectedProvenance.time && (
                                    <span>Time: {selectedProvenance.time.toFixed(2)}s</span>
                                )}
                                {selectedProvenance.sentences_ids && (
                                    <span>Sentences: {selectedProvenance.sentences_ids.length}</span>
                                )}
                            </div>
                            <div className="provenance-text">
                                {selectedProvenance.content?.map((sentence, idx) => (
                                    <div key={idx} className="provenance-sentence">
                                        <span className="sentence-text">{sentence}</span>
                                    </div>
                                )) || (
                                    <div className="provenance-sentence">
                                        <span className="sentence-text">Content not available</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ) : (
                    <div className="provenance-empty">
                        {/* Case 1: Answer ready, but provenances are still being generated */}
                        {question.answerReady && question.answer && 
                         !question.processing_complete && question.provenanceCount === 0 ? (
                            <div className="provenance-processing">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                <span>Searching for provenance...</span>
                                <div className="processing-info">
                                    <small>This may take a moment while we analyze the document</small>
                                </div>
                            </div>
                        ) : 
                        /* Case 2: Answer ready, provenances available, haven't requested any yet */
                        question.answerReady && question.answer && 
                        question.provenanceCount > 0 && 
                        availableProvenances.length === 0 ? (
                            <div className="get-provenance-section">
                                <p>Provenance found! ({question.provenanceCount} available)</p>
                                <button
                                    className="win95-btn get-provenance"
                                    onClick={handleGetFirstProvenance}
                                    disabled={question.requestingProvenance}
                                >
                                    {question.requestingProvenance ? (
                                        <>
                                            <FontAwesomeIcon icon={faSpinner} spin />
                                            <span>Loading...</span>
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
                        /* Case 3: Still processing answer */
                        question.isProcessing && !question.answerReady ? (
                            <div className="provenance-processing">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                <span>Processing question...</span>
                            </div>
                        ) : 
                        /* Case 4: Processing complete but no provenances found */
                        question.processing_complete && question.provenanceCount === 0 ? (
                            <div className="no-provenance">
                                <span>No provenance found for this answer</span>
                                <div className="user-message">
                                    <small>The answer exists but no provenance was found in the document.</small>
                                </div>
                            </div>
                        ) : (
                            /* Case 5: Default - no provenance available */
                            <div className="no-provenance">
                                <span>No provenance available</span>
                                {question.userMessage && (
                                    <div className="user-message">{question.userMessage}</div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation - Fixed at bottom */}
            {availableProvenances.length > 1 && (
                <div className="provenance-navigation">
                    <button
                        className="win95-btn nav"
                        onClick={handlePreviousProvenance}
                        disabled={currentProvenanceIndex === 0}
                    >
                        <FontAwesomeIcon icon={faChevronLeft} />
                        Previous
                    </button>

                    <div className="provenance-dots">
                        {availableProvenances.map((_, index) => (
                            <button
                                key={index}
                                className={`dot ${index === currentProvenanceIndex ? 'active' : ''}`}
                                onClick={() => handleDotNavigation(index)}
                            />
                        ))}
                    </div>

                    <button
                        className="win95-btn nav"
                        onClick={handleNextProvenance}
                        disabled={currentProvenanceIndex === availableProvenances.length - 1}
                    >
                        Next
                        <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                </div>
            )}

            {/* Actions - Fixed at bottom */}
            {selectedProvenance && (
                <div className="provenance-actions">
                    <button
                        className="win95-btn feedback"
                        onClick={() => onFeedbackRequest && onFeedbackRequest(question)}
                    >
                        <FontAwesomeIcon icon={faComment} />
                        Provide Feedback
                    </button>

                     {/* Get More - Fixed at bottom */}
            {question.canRequestMore && availableProvenances.length > 0 && (
              
                    <button
                        className="win95-btn get-more"
                        onClick={onGetNextProvenance}
                        disabled={question.requestingProvenance}
                    >
                        {question.requestingProvenance ? (
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
      
               
            )}
                </div>
            )}

           
        </div>
    );
};

export default ProvenanceDisplay;