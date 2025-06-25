

/**
 * Simple highlighter that uses the Python sentence matcher
 */
import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings, findSentenceMatches } from '../services/api';
import { useAppState } from '../contexts/AppStateContext';

const Pylighter = ({
    provenanceData,
    pdfDocument,
    textLayerRef,
    highlightLayerRef,
    containerRef,
    currentPage,
    documentFilename,
    highlightStyle = {
        backgroundColor: 'rgba(76, 175, 80, 0.4)',
        border: '2px solid rgba(76, 175, 80, 0.8)',
        borderRadius: '3px'
    },
    className = 'python-backed-highlight',
    verbose = true
}) => {
    const { state } = useAppState();
    const { activeQuestionId, selectedProvenance } = state;
    const activeHighlights = useRef(new Map());
    const mappingsCache = useRef(new Map());

    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[PythonBacked] ${message}`, ...args);
        }
    };

    // Main highlighting effect
    useEffect(() => {
        if (!selectedProvenance?.provenance_ids || !documentFilename || !pdfDocument) {
            clearAllHighlights();
            return;
        }

        const sentenceIds = selectedProvenance.provenance_ids || [];
        log(`🎯 Python-backed highlighting for sentences:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                await createPythonBackedHighlights(stableMappings);

            } catch (error) {
                console.error('[PythonBacked] Error during highlighting:', error);
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

    const createPythonBackedHighlights = async (stableMappings) => {
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
            log(`\n🔍 Processing sentence ${sentenceId}: "${mapping.sentence_text}"`);
            
            try {
                // Call Python endpoint
                const matchResult = await findSentenceMatches(
                    mapping.sentence_text,
                    mapping.stable_elements
                );

                if (!matchResult.matches || matchResult.matches.length === 0) {
                    log(`⚠️ No matches found by Python backend for sentence ${sentenceId}`);
                    if (matchResult.debug_info) {
                        log(`🔍 Debug info:`, matchResult.debug_info);
                    }
                    continue;
                }

                const bestMatch = matchResult.matches[0];
                log(`✅ Python backend found match:`);
                log(`   Stable indices: [${bestMatch.stable_indices.join(', ')}]`);
                log(`   Coverage: ${(bestMatch.coverage_ratio * 100).toFixed(1)}%`);
                log(`   Score: ${bestMatch.sequence_score.toFixed(3)}`);
                log(`   Matched tokens: [${bestMatch.matched_tokens.join(', ')}]`);

                // Create highlights for the matched stable indices
                const elementsToHighlight = mapping.stable_elements.filter(
                    el => bestMatch.stable_indices.includes(el.stable_index)
                );

                if (elementsToHighlight.length === 0) {
                    log(`⚠️ No elements found for stable indices`);
                    continue;
                }

                // Group spatially close elements
                const spatialGroups = groupElementsSpatially(elementsToHighlight);

                for (const group of spatialGroups) {
                    const highlight = await createHighlight(group, sentenceId, mapping.sentence_text, bestMatch);
                    if (highlight) {
                        highlightCount++;
                    }
                }

            } catch (error) {
                log(`❌ Error processing sentence ${sentenceId}:`, error);
            }
        }

        log(`✅ Created ${highlightCount} Python-backed highlights on page ${currentPage}`);
    };

    const groupElementsSpatially = (elements) => {
        if (elements.length === 0) return [];

        // Sort by stable_index (reading order)
        const sortedElements = [...elements].sort((a, b) => 
            (a.stable_index || 0) - (b.stable_index || 0)
        );

        const groups = [];
        let currentGroup = [sortedElements[0]];

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const last = currentGroup[currentGroup.length - 1];

            // Group if stable indices are close (reading order proximity)
            const indexGap = (current.stable_index || 0) - (last.stable_index || 0);

            if (indexGap <= 3) { // Allow small gaps for punctuation, etc.
                currentGroup.push(current);
            } else {
                groups.push(currentGroup);
                currentGroup = [current];
            }
        }

        groups.push(currentGroup);
        return groups;
    };

    const createHighlight = async (elementGroup, sentenceId, sentenceText, matchResult) => {
        if (!containerRef?.current || elementGroup.length === 0) return null;

        try {
            const textElements = elementGroup
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                log(`❌ No DOM elements found for stable indices: ${elementGroup.map(e => e.stable_index).join(', ')}`);
                return null;
            }

            const highlightElement = createHighlightFromTextElements(
                textElements, 
                sentenceId, 
                sentenceText,
                matchResult
            );

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                const highlightKey = `python_${sentenceId}_${elementGroup[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    elementGroup: elementGroup,
                    textElements: textElements,
                    matchResult: matchResult,
                    type: 'python_backed'
                });

                log(`✨ Created highlight for sentence ${sentenceId}, group of ${elementGroup.length} elements`);
                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight:', error);
        }

        return null;
    };

    const createHighlightFromTextElements = (textElements, sentenceId, sentenceText, matchResult) => {
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

            // Quality-based styling
            const quality = matchResult.sequence_score;
            let backgroundColor = highlightStyle.backgroundColor;
            let border = highlightStyle.border;

            if (quality >= 0.8) {
                backgroundColor = 'rgba(76, 175, 80, 0.4)';   // Green
                border = '2px solid rgba(76, 175, 80, 0.8)';
            } else if (quality >= 0.6) {
                backgroundColor = 'rgba(255, 193, 7, 0.4)';    // Yellow
                border = '2px solid rgba(255, 193, 7, 0.8)';
            } else {
                backgroundColor = 'rgba(255, 152, 0, 0.4)';    // Orange
                border = '2px solid rgba(255, 152, 0, 0.8)';
            }

            const highlightDiv = document.createElement('div');
            highlightDiv.className = className;

            Object.assign(highlightDiv.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: backgroundColor,
                border: border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
            });

            highlightDiv.title = `
Python Sentence Match
Sentence: ${sentenceId}
Coverage: ${(matchResult.coverage_ratio * 100).toFixed(1)}%
Score: ${matchResult.sequence_score.toFixed(3)}
Tokens: [${matchResult.matched_tokens.join(', ')}]
Text: "${sentenceText.substring(0, 80)}..."
            `.trim();

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };

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

    const clearAllHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        activeHighlights.current.clear();
        log('🧹 Cleared all Python-backed highlights');
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

export default Pylighter;