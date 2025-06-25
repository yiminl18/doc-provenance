/**
 * Simple Document Highlighter with wink-nlp
 * 
 * Takes sentences extracted via pdfminer and highlights them in PDF.js
 * Uses wink-nlp for intelligent word importance scoring
 * 
 * INSTALLATION:
 * npm install wink-nlp wink-eng-lite-web-model
 */

import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';
import { useAppState } from '../contexts/AppStateContext';

// Import wink-nlp
let winkNLP, winkModel, nlpInstance, its;

const initializeWinkNLP = async () => {
    if (!winkNLP) {
        winkNLP = (await import('wink-nlp')).default;
        winkModel = (await import('wink-eng-lite-web-model')).default;
        nlpInstance = winkNLP(winkModel);
        its = nlpInstance.its;
        console.log('✅ wink-nlp initialized');
    }
    return nlpInstance;
};

const NLPHighlighter = ({
    provenanceData,
    pdfDocument,
    textLayerRef,
    highlightLayerRef,
    containerRef,
    currentPage,
    currentZoom,
    documentFilename,
    highlightStyle = {
        backgroundColor: 'rgba(76, 175, 80, 0.4)',
        border: '2px solid rgba(76, 175, 80, 0.8)',
        borderRadius: '3px'
    },
    className,
    verbose = true
}) => {
    const { state } = useAppState();
    const { activeQuestionId, selectedProvenance } = state;
    const lastProcessedQuestionRef = useRef(null);
    const lastProcessedProvenanceRef = useRef(null);
    const activeHighlights = useRef(new Map());
    const mappingsCache = useRef(new Map());

    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[DocumentHighlighter] ${message}`, ...args);
        }
    };

    // Initialize wink-nlp
    useEffect(() => {
        initializeWinkNLP();
    }, []);

    useEffect(() => {
        if (lastProcessedQuestionRef.current && lastProcessedQuestionRef.current !== activeQuestionId) {
            log('🧹 Question changed, clearing highlights');
            clearAllHighlights();
            lastProcessedProvenanceRef.current = null;
        }
        lastProcessedQuestionRef.current = activeQuestionId;
    }, [activeQuestionId]);

    useEffect(() => {
        const currentProvenanceId = selectedProvenance?.provenance_id;
        
        if (lastProcessedProvenanceRef.current === currentProvenanceId) {
            return;
        }

        if (activeQuestionId || selectedProvenance?.provenance_ids) {
            log(`🎯 Processing provenance for question ${activeQuestionId}`);
            lastProcessedProvenanceRef.current = currentProvenanceId;
        } else {
            clearAllHighlights();
            lastProcessedProvenanceRef.current = null;
        }
    }, [activeQuestionId, selectedProvenance?.provenance_id]);

    // Main highlighting effect
    useEffect(() => {
        if (!selectedProvenance?.provenance_ids || !documentFilename || !pdfDocument) {
            clearAllHighlights();
            return;
        }

        const sentenceIds = selectedProvenance.provenance_ids || [];
        log(`🎯 Highlighting sentences:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                await createIntelligentHighlights(stableMappings);

            } catch (error) {
                console.error('[DocumentHighlighter] Error during highlighting:', error);
                clearAllHighlights();
            }
        };

        const timeoutId = setTimeout(performHighlighting, 100);
        return () => clearTimeout(timeoutId);

    }, [
        selectedProvenance?.provenance_id,
        JSON.stringify(selectedProvenance?.provenance_ids),
        currentPage,
        documentFilename,
        activeQuestionId
    ]);

    /**
     * Get stable mappings for sentence IDs
     */
    const getStableMappings = async (sentenceIds) => {
        if (!sentenceIds?.length || !documentFilename) return null;

        const cacheKey = `${documentFilename}_${sentenceIds.join(',')}_${currentPage}`;

        if (mappingsCache.current.has(cacheKey)) {
            return mappingsCache.current.get(cacheKey);
        }

        try {
            const response = await getSentenceItemMappings(documentFilename, sentenceIds);

            if (!response?.success || !response?.sentence_mappings) {
                log('❌ No sentence mappings in response');
                return null;
            }

            mappingsCache.current.set(cacheKey, response.sentence_mappings);
            return response.sentence_mappings;

        } catch (error) {
            log('❌ Error fetching stable mappings:', error);
            return null;
        }
    };

    /**
     * Create intelligent highlights using wink-nlp + reading order filtering
     */
    const createIntelligentHighlights = async (stableMappings) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

        // Filter for current page
        const currentPageSentences = Object.entries(stableMappings).filter(([sentenceId, mapping]) => {
            return mapping.found && 
                   mapping.page_number === parseInt(currentPage) &&
                   mapping.stable_elements?.length > 0;
        });

        if (currentPageSentences.length === 0) {
            log(`📄 No sentences found for page ${currentPage}`);
            return;
        }

        log(`📄 Processing ${currentPageSentences.length} sentences on page ${currentPage}`);

        let highlightCount = 0;

        for (const [sentenceId, mapping] of currentPageSentences) {
            log(`🔍 Analyzing sentence ${sentenceId}: "${mapping.sentence_text.substring(0, 60)}..."`);
            
            // Basic filtering
            const filteredElements = applyBasicFiltering(mapping.stable_elements, mapping.sentence_text);

            if (filteredElements.length === 0) {
                log(`⚠️ No elements passed basic filtering`);
                continue;
            }

            // NLP analysis
            const analyzedElements = await analyzeElementsWithNLP(filteredElements, mapping.sentence_text);

            // Smart selection using reading order + coverage
            const selectedElements = selectElementsWithReadingOrder(analyzedElements, mapping.sentence_text);

            if (selectedElements.length === 0) {
                log(`⚠️ No elements selected`);
                continue;
            }

            // Create highlights
            const spatialGroups = createSpatialGroups(selectedElements);
            for (const group of spatialGroups) {
                const highlight = await createHighlight(group, sentenceId, mapping.sentence_text);
                if (highlight) {
                    highlightCount++;
                }
            }
        }

        log(`✅ Created ${highlightCount} highlights on page ${currentPage}`);
    };

    /**
     * Basic filtering: consumption ratio + word relevance
     */
    const applyBasicFiltering = (stableElements, sentenceText) => {
        if (!stableElements || !sentenceText) return [];

        const sentenceWords = new Set(
            sentenceText.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 1)
        );

        return stableElements.filter(element => {
            if (!element.words_consumed || !element.consumption_ratio) return false;
            if (element.consumption_ratio < 0.05) return false;

            const consumedWords = Array.isArray(element.words_consumed) ? element.words_consumed : [];
            const relevantWords = consumedWords.filter(word => sentenceWords.has(word.toLowerCase()));

            if (relevantWords.length === 0) return false;

            element.relevantWords = relevantWords;
            element.wordRelevanceRatio = relevantWords.length / Math.max(consumedWords.length, 1);

            return true;
        });
    };

    /**
     * Analyze elements using wink-nlp for word importance
     */
    const analyzeElementsWithNLP = async (elements, sentenceText) => {
        if (!nlpInstance) {
            log('⚠️ wink-nlp not available, using basic scoring');
            return elements.map(element => ({
                ...element,
                nlpScore: 0.5,
                isHighContent: element.relevantWords?.length >= 3
            }));
        }

        try {
            // Process sentence with wink-nlp
            const doc = nlpInstance.readDoc(sentenceText);
            const tokens = doc.tokens();

            return elements.map(element => {
                const relevantWords = element.relevantWords || [];
                let nlpScore = 0.3;

                if (relevantWords.length > 0) {
                    const wordScores = relevantWords.map(word => {
                        let wordScore = 0.3;

                        tokens.each((token) => {
                            if (token.out(its.normal) === word.toLowerCase()) {
                                // Stop words get low scores
                                if (token.out(its.stopWordFlag)) {
                                    wordScore = 0.1;
                                    return;
                                }

                                // Entities get high scores
                                const entityType = token.out(its.type);
                                if (entityType && entityType !== 'word') {
                                    wordScore = 0.8;
                                    return;
                                }

                                // Sentiment words get medium scores
                                const sentiment = token.out(its.sentiment);
                                if (Math.abs(sentiment) > 0.3) {
                                    wordScore = 0.6;
                                    return;
                                }

                                // Content words vs function words
                                const pos = token.out(its.pos);
                                const contentPOS = ['NOUN', 'PROPN', 'VERB', 'ADJ', 'NUM'];
                                if (contentPOS.includes(pos)) {
                                    wordScore = 0.6;
                                } else {
                                    wordScore = 0.4;
                                }
                            }
                        });

                        return wordScore;
                    });

                    nlpScore = wordScores.reduce((sum, score) => sum + score, 0) / wordScores.length;
                }

                // Calculate overall score
                const contentCoverage = relevantWords.length / Math.max(1, sentenceText.split(/\s+/).length);
                const consumptionQuality = element.consumption_ratio || 0;
                
                const overallScore = (nlpScore * 0.4) + (consumptionQuality * 0.3) + (contentCoverage * 0.3);

                return {
                    ...element,
                    nlpScore,
                    overallScore,
                    isHighContent: relevantWords.length >= 3 && (nlpScore >= 0.5 || contentCoverage >= 0.15)
                };
            });

        } catch (error) {
            log('❌ Error in NLP analysis:', error);
            return elements.map(element => ({
                ...element,
                nlpScore: 0.5,
                overallScore: 0.5,
                isHighContent: element.relevantWords?.length >= 3
            }));
        }
    };

    /**
     * Select best elements using reading order + sentence coverage
     */
    const selectElementsWithReadingOrder = (analyzedElements, sentenceText) => {
        // Sort by reading order
        const sortedByReadingOrder = [...analyzedElements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff;
            return a.coordinates.x - b.coordinates.x;
        });

        // Track sentence coverage
        const sentenceWords = sentenceText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const coveredWords = new Set();
        const selectedElements = [];

        for (const element of sortedByReadingOrder) {
            const relevantWords = element.relevantWords || [];
            const newWords = relevantWords.filter(word => !coveredWords.has(word.toLowerCase()));
            const newCoverage = newWords.length / sentenceWords.length;
            const currentCoverage = coveredWords.size / sentenceWords.length;

            // Selection criteria
            const shouldInclude = 
                (element.isHighContent && currentCoverage < 0.8) ||
                (element.overallScore >= 0.6 && currentCoverage < 0.8) ||
                (newCoverage >= 0.1 && currentCoverage < 0.6) ||
                (newCoverage >= 0.05 && currentCoverage < 0.4);

            if (shouldInclude) {
                selectedElements.push(element);
                newWords.forEach(word => coveredWords.add(word.toLowerCase()));
                
                log(`✅ Selected: "${element.text?.substring(0, 30)}..." (score: ${element.overallScore?.toFixed(3)})`);
                
                // Stop if we have good coverage
                if (coveredWords.size / sentenceWords.length >= 0.8 && selectedElements.length >= 2) {
                    break;
                }
            } else {
                log(`❌ Skipped: "${element.text?.substring(0, 30)}..." (coverage: ${(currentCoverage * 100).toFixed(1)}%)`);
            }
        }

        return selectedElements;
    };

    /**
     * Create spatial groups from selected elements
     */
    const createSpatialGroups = (elements) => {
        if (elements.length === 0) return [];

        const sortedElements = [...elements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff;
            return a.coordinates.x - b.coordinates.x;
        });

        const groups = [];
        let currentGroup = { elements: [sortedElements[0]] };

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const lastInGroup = currentGroup.elements[currentGroup.elements.length - 1];

            const distance = calculateDistance(lastInGroup, current);

            if (distance <= 60) {
                currentGroup.elements.push(current);
            } else {
                groups.push(currentGroup);
                currentGroup = { elements: [current] };
            }
        }

        groups.push(currentGroup);
        return groups;
    };

    /**
     * Calculate distance between elements
     */
    const calculateDistance = (element1, element2) => {
        const center1 = {
            x: element1.coordinates.x + element1.coordinates.width / 2,
            y: element1.coordinates.y + element1.coordinates.height / 2
        };
        const center2 = {
            x: element2.coordinates.x + element2.coordinates.width / 2,
            y: element2.coordinates.y + element2.coordinates.height / 2
        };

        const dx = center1.x - center2.x;
        const dy = center1.y - center2.y;
        
        return Math.sqrt(dx * dx + dy * dy);
    };

    /**
     * Create highlight from spatial group
     */
    const createHighlight = async (spatialGroup, sentenceId, sentenceText) => {
        if (!containerRef?.current || spatialGroup.elements.length === 0) return null;

        try {
            const textElements = spatialGroup.elements
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) return null;

            const highlightElement = createHighlightFromTextElements(textElements, sentenceId, sentenceText);

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                const highlightKey = `highlight_${sentenceId}_${spatialGroup.elements[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    spatialGroup: spatialGroup,
                    textElements: textElements
                });

                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight:', error);
        }

        return null;
    };

    /**
     * Create highlight element from text elements
     */
    const createHighlightFromTextElements = (textElements, sentenceId, sentenceText) => {
        if (!containerRef?.current) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            const left = Math.min(...rects.map(r => r.left)) - pageRect.left;
            const top = Math.min(...rects.map(r => r.top)) - pageRect.top;
            const right = Math.max(...rects.map(r => r.right)) - pageRect.left;
            const bottom = Math.max(...rects.map(r => r.bottom)) - pageRect.top;

            const width = right - left;
            const height = bottom - top;

            if (width <= 0 || height <= 0) return null;

            const highlightDiv = document.createElement('div');
            highlightDiv.className = className;

            Object.assign(highlightDiv.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: highlightStyle.backgroundColor,
                border: highlightStyle.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
            });

            highlightDiv.title = `Sentence: ${sentenceId}\nText: "${sentenceText.substring(0, 60)}..."`;

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };

    /**
     * Find text element by stable index
     */
    const findTextElement = (stableIndex, pageNumber) => {
        if (!textLayerRef?.current) return null;

        const selectors = [
            `[data-stable-index="${stableIndex}"][data-page-number="${pageNumber}"]`,
            `[data-stable-index="${stableIndex}"]`,
            `.pdf-text-item[data-stable-index="${stableIndex}"]`
        ];

        for (const selector of selectors) {
            const element = textLayerRef.current.querySelector(selector);
            if (element) return element;
        }

        return null;
    };

    /**
     * Clear all highlights
     */
    const clearAllHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        activeHighlights.current.clear();
        log('🧹 Cleared all highlights');
    };

    // Clear cache when document changes
    useEffect(() => {
        mappingsCache.current.clear();
    }, [documentFilename]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearAllHighlights();
            mappingsCache.current.clear();
        };
    }, []);

    return null;
};

export default NLPHighlighter;