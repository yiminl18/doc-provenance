// EnhancedDirectTextHighlighter.js - Uses coordinate-based highlighting when available
import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';
import {
    getWords,
    calculateSimilarity,
    textNormalization,    // All normalization functions
    similarityMetrics,    // All similarity calculations  
    textMatching,         // All matching algorithms
    textUtils            // General utilities
} from '../utils/textSimilarity';

import { findExactTextSpans, findProvenanceHighlights } from '../utils/ExactTextMatcher';

const HybridCoordinateHighlighter = ({
    provenanceData,
    activeQuestionId,
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
    cratioThresholds = {
        high: 0.8,
        medium: 0.5,
        low: 0.1
    },
    groupingOptions = {
        maxGap: 30,
        minGroupSimilarity: .4,
        maxElementsPerSentence: 15
    },

    className = 'coordinate-provenance-highlight',
    verbose = true
}) => {
    const activeHighlights = useRef(new Map());
    const coordinateRegions = useRef(new Map()); // Store coordinate regions
    const searchRegions = useRef(new Map()); // NEW: Store search regions
    const mappingsCache = useRef(new Map());
    const sentenceTextsCache = useRef(new Map());

    // Debug logging
    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[CoordinateHighlighter] ${message}`, ...args);
        }
    };

    // Clear highlights when question or provenance changes
    useEffect(() => {
        if (activeQuestionId || provenanceData?.provenance_ids) {
            log(`🆔 Question or provenance changed - clearing highlights`);
            clearAllHighlights();
        }
    }, [activeQuestionId, provenanceData?.provenance_ids]);

    // Main highlighting effect
    useEffect(() => {

        if (!provenanceData?.provenance_ids || !documentFilename || !pdfDocument) {
            log('⏸️ Missing required data for highlighting');
            clearAllHighlights();
            return;
        }

        const sentenceIds = provenanceData.provenance_ids || [];

        log(`🎯 Found sentence IDs:`, sentenceIds);


        const performHighlighting = async () => {
            try {
                clearAllHighlights();

                // Get stable mappings for these sentences
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                // Create enhanced highlights with frontend similarity
                await createHighlightsFromStableMappings(stableMappings);



            } catch (error) {
                console.error('[CoordinateHighlighter] Error during highlighting:', error);
                clearAllHighlights();
            }
        };

        const timeoutId = setTimeout(performHighlighting, 100);
        return () => clearTimeout(timeoutId);

    }, [
        provenanceData?.provenance_id,
        JSON.stringify(provenanceData?.provenance_ids),
        currentPage,
        documentFilename,
        activeQuestionId
    ]);

    function selectHighlightElements(elements, sentenceText, options = {}) {
        const {
            highThreshold = 0.8,
            mediumThreshold = 0.3,
            lowThreshold = 0.1,
            minConsecutiveRun = 2
        } = options;

        const selectedElements = [];
        const consecutiveRuns = [];
        let currentRun = [];

        elements.forEach((element, i) => {
            const consumption = element.consumption_ratio || 0;

            if (consumption >= highThreshold) {
                currentRun.push({ index: i, element });
            } else {
                if (currentRun.length >= minConsecutiveRun) {
                    consecutiveRuns.push([...currentRun]);
                }
                currentRun = [];
            }
        });

        if (currentRun.length >= minConsecutiveRun) {
            consecutiveRuns.push(currentRun);
        }

        // Add elements from consecutive runs
        consecutiveRuns.forEach(run => {
            run.forEach(({ element }) => {
                selectedElements.push(element);
            });
        });

        // Find missing words for sentence completion
        const consumedWords = new Set();
        selectedElements.forEach(element => {
            const words = element.words_consumed || [];
            const wordArray = Array.isArray(words) ? words : words.split ? words.split() : [];
            wordArray.forEach(word => {
                consumedWords.add(word.toLowerCase().replace(/[.,!?;:]/g, ''));
            });
        });

        const sentenceWords = new Set(
            sentenceText.split(/\s+/)
                .map(word => word.toLowerCase().replace(/[.,!?;:]/g, ''))
                .filter(word => word.length > 0)
        );

        const missingWords = new Set([...sentenceWords].filter(word => !consumedWords.has(word)));
        // Add boundary elements that complete the sentence
        elements.forEach(element => {
            if (selectedElements.includes(element)) return;

            const consumption = element.consumption_ratio || 0;
            if (consumption > 0) {
                const elementWords = element.words_consumed || [];
                const wordArray = Array.isArray(elementWords) ? elementWords :
                    elementWords.split ? elementWords.split() : [];
                const elementWordSet = new Set(
                    wordArray.map(word => word.toLowerCase().replace(/[.,!?;:]/g, ''))
                );
                const contributesWords = [...elementWordSet].some(word => missingWords.has(word));
                if (contributesWords) {
                    selectedElements.push(element);
                    elementWordSet.forEach(word => missingWords.delete(word));
                }
            }
        });

        selectedElements.sort((a, b) => (a.stable_index || 0) - (b.stable_index || 0));
        return selectedElements;
    }



    /**
    * Group consecutive high-similarity elements (highlighting-specific logic)
    */
    const groupConsecutiveElements = (elements, options = {}) => {
        const {
            maxGap = 50, // Maximum pixel gap between elements to group
            minGroupSimilarity = 0.4
        } = options;

        if (elements.length <= 1) return [elements];

        // Sort by position (y first, then x)
        const sortedElements = [...elements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff;
            return a.coordinates.x - b.coordinates.x;
        });

        const groups = [];
        let currentGroup = [sortedElements[0]];

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const previous = sortedElements[i - 1];

            // Calculate gaps
            const horizontalGap = current.coordinates.x - (previous.coordinates.x + previous.coordinates.width);
            const verticalGap = Math.abs(current.coordinates.y - previous.coordinates.y);

            // Check if current element should be grouped with previous
            const shouldGroup = (
                verticalGap <= 5 && // Same line
                horizontalGap <= maxGap && // Close horizontally
                current.frontendScore >= minGroupSimilarity // Good similarity
            );

            if (shouldGroup) {
                currentGroup.push(current);
            } else {
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                }
                currentGroup = [current];
            }
        }

        // Add the last group
        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        return groups;
    };

    const getHighlightStyle = (elementGroup) => {
        // Calculate group confidence metrics
        const cratios = elementGroup.map(el => ({
           consumption_ratio: el.consumption_ratio || 0
        }));

        // Use the average consumption ratio as the primary metric
        const avgCratio = cratios.reduce((sum, c) => sum + c.consumption_ratio, 0) / cratios.length;

        // Determine confidence tier and color
        let tier, bgColor, borderColor, label;

        if (avgCratio >= cratioThresholds.high) {
            tier = 'high';
            bgColor = 'rgba(76, 175, 80, 0.4)';   // Green
            borderColor = 'rgba(76, 175, 80, 0.8)';
            label = '🟢 HIGH';
        } else if (avgCratio >= cratioThresholds.medium) {
            tier = 'medium';
            bgColor = 'rgba(255, 193, 7, 0.4)';    // Yellow/Orange
            borderColor = 'rgba(255, 193, 7, 0.8)';
            label = '🟡 MED';
        } else {
            tier = 'low';
            bgColor = 'rgba(220, 53, 69, 0.4)';    // Red
            borderColor = 'rgba(220, 53, 69, 0.8)';
            label = '🔴 LOW';
        }

        return {
            tier,
            backgroundColor: bgColor,
            border: `2px solid ${borderColor}`,
            borderRadius: highlightStyle.borderRadius,
            confidence: {
                cratio: avgCratio,
                label: label
            }
        };
    };

    /**
     * Create highlight element from text elements with confidence-based styling
     */
    const createHighlightFromTextElements = (textElements, sentenceId, elementGroup) => {
        if (!containerRef?.current) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        log('textElements: ', textElements);
        log('elementGroup: ', elementGroup);

        try {

            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();



        // // Calculate the encompassing rectangle relative to page container
            const left = Math.min(...rects.map(r => r.left)) - pageRect.left;
            const top = Math.min(...rects.map(r => r.top)) - pageRect.top;
            const right = Math.max(...rects.map(r => r.right)) - pageRect.left;
            const bottom = Math.max(...rects.map(r => r.bottom)) - pageRect.top;

            const width = right - left;
            const height = bottom - top;

            // Validate dimensions
            if (width <= 0 || height <= 0) {
                log(`⚠️ Invalid highlight dimensions: ${width}x${height}`);
                return null;
            }

        const cratioStyle = getHighlightStyle(elementGroup);

        // Create highlight element
        const highlightDiv = document.createElement('div');
        highlightDiv.className = `${className}`;

       Object.assign(highlightDiv.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      backgroundColor: `${cratioStyle.backgroundColor}`,
      border: `1px solid ${cratioStyle.border}`,
      pointerEvents: 'none',
      zIndex: 10,
      boxShadow: '0 0 2px rgba(0,0,0,0.2)'
       });

        // Enhanced tooltip with smart selection metadata
        const wordsConsumed = textElements.map(el => el.words_consumed || []).flat();
        const wordsText = Array.isArray(wordsConsumed) ?
            wordsConsumed.slice(0, 5).join(', ') + (wordsConsumed.length > 5 ? '...' : '') :
            wordsConsumed;
        
        const stableIndices = elementGroup.map(el => el.stable_index || 'unknown').join(', ');
        const text = textElements.map(el => el.text || '').join(' ').substring(0, 60);

        highlightDiv.title = `
Elements ${stableIndices}
Text: "${text}..."
Consumption: ${(cratioStyle.confidence.cratio * 100).toFixed(1)}%
Words: ${wordsText}
Sentence: ${sentenceId || 'unknown'}
    `.trim();

      

      /*
        // Add trimming indicator
        if (highlight.trimmed_highlight) {
            const trimIndicator = document.createElement('div');
            trimIndicator.style.cssText = `
        position: absolute;
        top: -2px;
        left: -2px;
        width: 12px;
        height: 12px;
        background-color: #dc2626;
        border-radius: 50%;
        font-size: 8px;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
            trimIndicator.textContent = '✂';
            trimIndicator.title = 'Trimmed to consumed words only';
            highlightDiv.appendChild(trimIndicator);
        }*/
        return highlightDiv
    } catch (error) {
            log('❌ Error creating highlight from text elements:', error);
            return null;
        }
    };
   

    const createCharacterLevelHighlights = (highlight, parentDiv) => {
        // This would implement character-level highlighting
        // Requires more detailed coordinate data from your PDF processing
        // For now, just add a visual indicator
        const trimIndicator = document.createElement('div');
        trimIndicator.style.cssText = `
      position: absolute;
      top: -2px;
      right: -2px;
      width: 8px;
      height: 8px;
      background-color: red;
      border-radius: 50%;
      font-size: 10px;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
        trimIndicator.textContent = '✂';
        trimIndicator.title = 'Trimmed to consumed words only';
        parentDiv.appendChild(trimIndicator);
    };


    /**
     * Create enhanced highlights using frontend text similarity (same filtering as debug version)
     */
    const createHighlightsFromStableMappings = async (stableMappings) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

        // need to iterate over the entries in stableMappings
        const pages = new Set();

        Object.entries(stableMappings).forEach(([sentenceId, mapping]) => {
            if (mapping.found) {
                if (!mapping.spans_multiple_pages) {
                    pages.add(mapping.page_number);
                } else {
                    log(`⚠️ Sentence ${sentenceId} spans multiple pages`);
                    return
                }
            } else {
                log(`⚠️ No stable mappings found for sentence ${sentenceId}`);
                return
            }
        });

        const primaryPageNumber = Array.from(pages);

        console.log(`📄 Primary page number for exact text highlights: ${primaryPageNumber}`);


        let highlightCount = 0;
        let totalElementsProcessed = 0;
        let totalElementsFiltered = 0;

        // Collect all elements from all sentences (same as debug version)
        const allElements = [];
        let provenanceText = '';


        Object.entries(stableMappings).forEach(([sentenceId, mapping]) => {

            // Use the provenance text for similarity calculation (same as debug version)
            provenanceText = mapping.sentence_text || '';

            if (!provenanceText) {
                log('❌ No provenance text available for similarity calculation');
                return;
            }

            log(`🧠 Using provenance text for similarity filtering: "${provenanceText.substring(0, 100)}${provenanceText.length > 100 ? '...' : ''}"`);

            log('mapping: ', mapping);



            // Filter elements for current page (same criteria as debug version)
            const elementsOnPage = mapping.stable_elements.filter(element =>
                element.page === parseInt(primaryPageNumber) &&
                element.text
            );

            log(`📄 Found ${elementsOnPage.length} elements for sentence ${sentenceId} on page ${primaryPageNumber}`);

            for (const element of elementsOnPage) {
                allElements.push({
                    ...element,
                    sourceSentenceId: sentenceId
                });
            }
        });

        totalElementsProcessed = allElements.length;
        log(`🔍 Total elements to analyze: ${allElements.length}`);

        // Limit to max elements for performance
        const elementsToHighlight = selectHighlightElements(allElements, provenanceText);
        totalElementsFiltered = elementsToHighlight.length;

        if (elementsToHighlight.length < allElements.length) {
            log(`⚡ Limited to top ${elementsToHighlight.length}/${allElements.length} elements for highlighting`);
        }

        log('elementsToHighlight: ', elementsToHighlight);

        // Group nearby high-similarity elements
        const elementGroups = groupNearbyElements(elementsToHighlight);

        //log(`🔗 Grouped ${elementsToHighlight.length} filtered elements into ${elementGroups.length} highlight groups`);

        // Create highlights for each group
        for (const group of elementGroups) {
            const highlight = await createHighlightFromElementGroup(group, group.sourceSentenceId);

            if (highlight) {
                highlightCount++;

                // Log detailed similarity info
                const groupSimilarityInfo = group.map(el => ({
                    text: el.text,
                    frontend: el.frontendScore?.toFixed(3),
                    backend: el.originalBackendConfidence?.toFixed(3),
                    final: el.finalScore?.toFixed(3),
                    similarity_breakdown: el.frontendSimilarity
                }));

                //log(`✨ Created similarity-based highlight group:`, groupSimilarityInfo);
            }
        }

        log(`✅ highlighting complete on page ${primaryPageNumber}:`);
        log(`   📊 ${highlightCount} highlights created from ${totalElementsFiltered} elements`);
        log(`   🔍 ${totalElementsProcessed} elements processed`);
        log(`   📈 Filter efficiency: ${((totalElementsProcessed - totalElementsFiltered) / totalElementsProcessed * 100).toFixed(1)}% reduction`);
    };



    

    /**
    * Convert bbox to screen coordinates with consistent zoom handling
    * This matches the approach used by the highlights
    */
    const convertBboxToScreenWithZoomHandling = (bbox) => {
        const pageContainer = containerRef.current?.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            // Get page container bounds for relative positioning (same as highlights)
            const containerRect = containerRef.current.getBoundingClientRect();
            const pageRect = pageContainer.getBoundingClientRect();

            // Use the same coordinate approach as the highlights
            // The text layer and page container already handle zoom correctly
            const screenRect = {
                x: bbox.x + (pageRect.left - containerRect.left),
                y: bbox.y + (pageRect.top - containerRect.top),
                width: bbox.width,
                height: bbox.height
            };

            return screenRect;

        } catch (error) {
            log('❌ Error converting bbox coordinates:', error);
            return null;
        }
    };

    // ENHANCED: More flexible text element finding
    const findTextElement = (stableIndex, pageNumber) => {
        if (!textLayerRef?.current) {
            log('❌ textLayerRef not available');
            return null;
        }

        // Try multiple selector strategies
        const selectors = [
            `[data-stable-index="${stableIndex}"][data-page-number="${pageNumber}"]`,
            `[data-stable-index="${stableIndex}"]`,
            `.pdf-text-item[data-stable-index="${stableIndex}"]`
        ];

        for (const selector of selectors) {
            const element = textLayerRef.current.querySelector(selector);
            if (element) {
                //log(`✅ Found element with selector: ${selector}`);
                return element;
            }
        }

        log(`❌ Element not found with stable index ${stableIndex} on page ${pageNumber}`);
        return null;
    };



    /**
    * Get stable mappings for sentence IDs from your existing API
    */
    const getStableMappings = async (sentenceIds) => {
        if (!sentenceIds?.length || !documentFilename) return null;

        const cacheKey = `${documentFilename}_${sentenceIds.join(',')}_${currentPage}`;

        if (mappingsCache.current.has(cacheKey)) {
            //log('📋 Using cached stable mappings');
            return mappingsCache.current.get(cacheKey);
        }

        try {
            //log(`🔍 Fetching stable mappings for sentences:`, sentenceIds);

            const response = await getSentenceItemMappings(documentFilename, sentenceIds);

            if (!response?.success || !response?.sentence_mappings) {
                log('❌ No sentence mappings in response');
                return null;
            }

            //log(`✅ Received mappings for ${Object.keys(response.sentence_mappings).length} sentences`);



            // Cache the result
            mappingsCache.current.set(cacheKey, response.sentence_mappings);

            return response.sentence_mappings;

        } catch (error) {
            log('❌ Error fetching stable mappings:', error);
            return null;
        }
    };


    /**
     * Group nearby stable elements for better highlighting
     * Elements that are close to each other get grouped into single highlights
     */
    const groupNearbyElements = (elements) => {
        if (elements.length === 0) return [];
        if (elements.length === 1) return [elements];

        // Sort elements by y-coordinate first, then x-coordinate
        const sortedElements = [...elements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff; // allow +/- one line
            return a.coordinates.x - b.coordinates.x; // Same line, sort by x
        });

        const groups = [];
        let currentGroup = [sortedElements[0]];

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const previous = sortedElements[i - 1];
            // Check if elements are close enough to group together
            const horizontalGap = current.coordinates.x - (previous.coordinates.x + previous.coordinates.width);
            const verticalGap = Math.abs(current.coordinates.y - previous.coordinates.y);

            // Group if elements are on same line and close horizontally
            if (verticalGap <= 3 && horizontalGap <= 20) {
                currentGroup.push(current);
            } else {
                // Start new group
                groups.push(currentGroup);
                currentGroup = [current];
            }
        }

        // Don't forget the last group
        groups.push(currentGroup);

        //log(`🔗 Grouped ${elements.length} elements into ${groups.length} highlight groups`);
        return groups;
    };

    /**
     * Create a highlight element from a group of stable elements
     */
    const createHighlightFromElementGroup = async (elementGroup, sentenceId) => {
        if (!containerRef?.current || elementGroup.length === 0) return null;

        try {
            // Find the actual text elements in the text layer for these stable indices
            const textElements = elementGroup
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                log(`❌ No text elements found for stable indices: ${elementGroup.map(e => e.stable_index).join(', ')}`);
                return null;
            }

            //log(`✅ Found ${textElements.length}/${elementGroup.length} text elements for highlighting`);

            // Use the existing text elements' positions (which already handle zoom correctly)
            const highlightElement = createHighlightFromTextElements(textElements, sentenceId, elementGroup);

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                // Store reference for cleanup
                const highlightKey = `coord_${sentenceId}_${elementGroup[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    elementGroup: elementGroup,
                    textElements: textElements,
                    type: 'coordinate'
                });

                //log(`✨ Created highlight for sentence ${sentenceId}, group of ${elementGroup.length} elements`);
                //log(`📝 Group text: "${elementGroup.map(e => e.text).join(' ')}"`);

                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight from element group:', error);
        }

        return null;
    };



    /**
     * Clear all active highlights
     */
    const clearAllHighlights = () => {
        if (!highlightLayerRef?.current) return;

        // Clear regular highlights
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
            coordinateRegions.current.clear();
        };
    }, []);


    return null;
};

export default HybridCoordinateHighlighter;