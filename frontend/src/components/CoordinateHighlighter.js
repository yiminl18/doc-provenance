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

const CoordinateHighlighter = ({
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
    // Frontend similarity thresholds
    frontendSimilarityThresholds = {
        high: 0.7,
        medium: 0.5,
        low: 0.3,
        minimum: 0.2 // Below this, ignore the element
    },
    overlapConfidenceThresholds = {
        high: 0.8,
        medium: 0.5,
        low: 0.3
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

                const sentenceTexts = await getSentenceTexts(sentenceIds);

                 // Create enhanced highlights with frontend similarity
                await createEnhancedHighlightsWithSimilarity(stableMappings, sentenceTexts, sentenceIds, currentPage);

                // Debug overlays if verbose
                if (verbose) {
                    //await createSearchRegionOverlays(stableMappings, sentenceIds, currentPage);
                    //await createSimilarityDebugOverlays(stableMappings, sentenceTexts, sentenceIds, currentPage);
                }

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

    /**
     * Find best matching elements within a search region (highlighting-specific logic)
     */
    const findBestMatches = (sentenceText, elements, options = {}) => {
        const {
            minSimilarity = 0.3,
            maxElements = 10,
            similarityWeight = 0.7,
            positionWeight = 0.3
        } = options;

        const results = [];
        const sentenceWords = getWords(sentenceText);
        
        for (const element of elements) {
            const similarity = calculateSimilarity(sentenceText, element.text);
            
            if (similarity.combined >= minSimilarity) {
                results.push({
                    ...element,
                    frontendSimilarity: similarity,
                    frontendScore: similarity.combined,
                    // Combine with backend confidence if available
                    finalScore: element.combined_confidence 
                        ? (similarity.combined * similarityWeight) + (element.combined_confidence * (1 - similarityWeight))
                        : similarity.combined
                });
            }
        }
        
        // Sort by final score and return top matches
        return results
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, maxElements);
    };

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

     /**
     * Get sentence texts for frontend similarity calculation
     */
    const getSentenceTexts = async (sentenceIds) => {
        const cacheKey = `sentences_${documentFilename}`;
        
        if (sentenceTextsCache.current.has(cacheKey)) {
            const cached = sentenceTextsCache.current.get(cacheKey);
            return sentenceIds.reduce((result, id) => {
                result[id] = cached[id] || '';
                return result;
            }, {});
        }

        try {
            // You'll need to add this API endpoint or modify existing one
            // For now, we'll extract from provenance data or mappings
            log('📝 Getting sentence texts for similarity calculation');
            
            // If provenance data includes the text, use that
            if (provenanceData?.provenance) {
                return sentenceIds.reduce((result, id, index) => {
                    result[id] = provenanceData.provenance || '';
                    return result;
                }, {});
            }

            // Otherwise, try to get from mappings or fall back to empty strings
            return sentenceIds.reduce((result, id) => {
                result[id] = '';
                return result;
            }, {});

        } catch (error) {
            log('❌ Error getting sentence texts:', error);
            return {};
        }
    };

    /**
     * Create enhanced highlights using frontend text similarity (same filtering as debug version)
     */
    const createEnhancedHighlightsWithSimilarity = async (stableMappings, sentenceTexts, sentenceIds, pageNumber) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

        let highlightCount = 0;
        let totalElementsProcessed = 0;
        let totalElementsFiltered = 0;

        // Use the provenance text for similarity calculation (same as debug version)
        const provenanceText = provenanceData?.provenance || '';
        
        if (!provenanceText) {
            log('❌ No provenance text available for similarity calculation');
            return;
        }

        log(`🧠 Using provenance text for similarity filtering: "${provenanceText.substring(0, 100)}${provenanceText.length > 100 ? '...' : ''}"`);

        // Collect all elements from all sentences (same as debug version)
        const allElements = [];
        
        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            
            if (!mapping?.stable_elements?.length) {
                log(`⚠️ No stable elements for sentence ${sentenceId}`);
                continue;
            }

            // Filter elements for current page (same criteria as debug version)
            const elementsOnPage = mapping.stable_elements.filter(element => 
                element.page === pageNumber && 
                element.text && 
                element.text.trim().length > 0 &&
                element.text_similarity > 0
            );

            log(`📄 Found ${elementsOnPage.length} elements for sentence ${sentenceId} on page ${pageNumber}`);

            for (const element of elementsOnPage) {
                allElements.push({
                    ...element,
                    sourceSentenceId: sentenceId,
                    originalBackendConfidence: element.combined_confidence || 0
                });
            }
        }

        totalElementsProcessed = allElements.length;
        log(`🔍 Total elements to analyze: ${allElements.length}`);

        // Apply individual element similarity filtering (EXACT same as debug version)
        const filteredElements = [];
        
        for (const element of allElements) {
            try {
                // Calculate similarity against provenance text (same as debug)
                const similarity = calculateSimilarity(provenanceText, element.text);
                
                // Apply same minimum threshold as debug version
                if (similarity.combined >= frontendSimilarityThresholds.minimum) {
                    filteredElements.push({
                        ...element,
                        frontendSimilarity: similarity,
                        frontendScore: similarity.combined,
                        // Combine with backend confidence
                        finalScore: element.originalBackendConfidence 
                            ? (similarity.combined * 0.6) + (element.originalBackendConfidence * 0.4)
                            : similarity.combined
                    });
                }

            } catch (error) {
                log(`❌ Error analyzing element "${element.text}":`, error);
            }
        }

        totalElementsFiltered = filteredElements.length;
        
        log(`🎯 Similarity filtering results: ${totalElementsFiltered}/${totalElementsProcessed} elements passed`);
        log(`📊 Similarity scores:`, filteredElements.map(el => ({
            text: el.text.substring(0, 20),
            frontend: el.frontendScore.toFixed(3),
            backend: el.originalBackendConfidence?.toFixed(3),
            final: el.finalScore.toFixed(3)
        })));

        if (filteredElements.length === 0) {
            log(`❌ No elements passed similarity filtering`);
            return;
        }

        // Sort by final score (best matches first)
        filteredElements.sort((a, b) => b.finalScore - a.finalScore);

        // Limit to max elements for performance
        const elementsToHighlight = filteredElements.slice(0, groupingOptions.maxElementsPerSentence);
        
        if (elementsToHighlight.length < filteredElements.length) {
            log(`⚡ Limited to top ${elementsToHighlight.length}/${filteredElements.length} elements for highlighting`);
        }

        // Group nearby high-similarity elements
        const elementGroups = groupConsecutiveElements(
            elementsToHighlight, 
            groupingOptions
        );

        log(`🔗 Grouped ${elementsToHighlight.length} filtered elements into ${elementGroups.length} highlight groups`);

        // Create highlights for each group
        for (const group of elementGroups) {
            const highlight = await createSimilarityBasedHighlight(group, 'mixed', provenanceText, pageNumber);
            
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
                
                log(`✨ Created similarity-based highlight group:`, groupSimilarityInfo);
            }
        }

        log(`✅ Enhanced highlighting complete on page ${pageNumber}:`);
        log(`   📊 ${highlightCount} highlights created`);
        log(`   🔍 ${totalElementsProcessed} elements processed`);
        log(`   🎯 ${totalElementsFiltered} elements passed similarity filter`);
        log(`   📈 Filter efficiency: ${((totalElementsProcessed - totalElementsFiltered) / totalElementsProcessed * 100).toFixed(1)}% reduction`);
    };

    /**
     * Create highlight with enhanced similarity-based styling
     */
    const createSimilarityBasedHighlight = async (elementGroup, sentenceId, provenanceText, pageNumber) => {
        if (!containerRef?.current || elementGroup.length === 0) return null;

        try {
            // Find text elements in the DOM
            const textElements = elementGroup
                .map(element => findTextElement(element.stable_index, pageNumber))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                log(`❌ No DOM text elements found for similarity-based highlighting`);
                return null;
            }

            // Create the highlight element with enhanced styling
            const highlightElement = createSimilarityStyledHighlight(
                textElements, 
                sentenceId, 
                elementGroup, 
                provenanceText
            );
            
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
                
                // Store reference for cleanup
                const highlightKey = `similarity_${sentenceId}_${elementGroup[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    elementGroup: elementGroup,
                    textElements: textElements,
                    type: 'similarity_enhanced',
                    provenanceText: provenanceText
                });

                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating similarity-based highlight:', error);
        }

        return null;
    };

    /**
     * Create highlight element with similarity-based styling
     */
    const createSimilarityStyledHighlight = (textElements, sentenceId, elementGroup, provenanceText) => {
        if (!containerRef?.current) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            // Calculate bounding rectangle
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            const left = Math.min(...rects.map(r => r.left)) - pageRect.left;
            const top = Math.min(...rects.map(r => r.top)) - pageRect.top;
            const right = Math.max(...rects.map(r => r.right)) - pageRect.left;
            const bottom = Math.max(...rects.map(r => r.bottom)) - pageRect.top;

            const width = right - left;
            const height = bottom - top;

            if (width <= 0 || height <= 0) {
                log(`⚠️ Invalid highlight dimensions: ${width}x${height}`);
                return null;
            }

            // Calculate group similarity metrics using frontendScore (same as debug version)
            const avgFrontendScore = elementGroup.reduce((sum, el) => sum + el.frontendScore, 0) / elementGroup.length;
            const avgBackendScore = elementGroup.reduce((sum, el) => sum + (el.originalBackendConfidence || 0), 0) / elementGroup.length;
            const avgFinalScore = elementGroup.reduce((sum, el) => sum + el.finalScore, 0) / elementGroup.length;

            // Determine styling based on similarity scores
            const styling = getSimilarityBasedStyling(avgFrontendScore, avgBackendScore, avgFinalScore);

            // Create highlight element
            const highlightElement = document.createElement('div');
            highlightElement.className = `${className} similarity-highlight similarity-${styling.tier}`;
            
            // Set data attributes for debugging and interaction
            highlightElement.setAttribute('data-sentence-id', sentenceId);
            highlightElement.setAttribute('data-element-count', elementGroup.length);
            highlightElement.setAttribute('data-stable-indices', elementGroup.map(e => e.stable_index).join(','));
            highlightElement.setAttribute('data-frontend-score', avgFrontendScore.toFixed(3));
            highlightElement.setAttribute('data-backend-score', avgBackendScore.toFixed(3));
            highlightElement.setAttribute('data-final-score', avgFinalScore.toFixed(3));
            highlightElement.setAttribute('data-similarity-tier', styling.tier);

            // Apply styling
            Object.assign(highlightElement.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: styling.backgroundColor,
                border: styling.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: '1000',
                opacity: styling.opacity,
                boxShadow: styling.boxShadow,
                transition: 'all 0.2s ease'
            });

            // Create detailed tooltip
            const tooltipInfo = [
                `${styling.label} SIMILARITY`,
                `Frontend Score: ${avgFrontendScore.toFixed(3)}`,
                `Backend Score: ${avgBackendScore.toFixed(3)}`,
                `Final Score: ${avgFinalScore.toFixed(3)}`,
                `Elements: ${elementGroup.length}`,
                `Text: "${elementGroup.map(e => e.text).join(' ').substring(0, 100)}${elementGroup.map(e => e.text).join(' ').length > 100 ? '...' : ''}"`
            ];

            // Add detailed similarity breakdown if available
            if (elementGroup[0]?.frontendSimilarity) {
                const similarity = elementGroup[0].frontendSimilarity;
                tooltipInfo.push(
                    ``,
                    `SIMILARITY BREAKDOWN:`,
                    `Token: ${similarity.token.toFixed(3)}`,
                    `Overlap: ${similarity.overlap.toFixed(3)}`,
                    `Jaccard: ${similarity.jaccard.toFixed(3)}`
                );
            }

            highlightElement.title = tooltipInfo.join('\n');

            log(`✨ Created ${styling.label} similarity highlight: ${width.toFixed(1)}x${height.toFixed(1)} at (${left.toFixed(1)}, ${top.toFixed(1)})`);
            log(`📊 Scores - Frontend: ${avgFrontendScore.toFixed(3)}, Backend: ${avgBackendScore.toFixed(3)}, Final: ${avgFinalScore.toFixed(3)}`);
            
            return highlightElement;

        } catch (error) {
            log('❌ Error creating similarity-styled highlight:', error);
            return null;
        }
    };

    /**
     * Get styling based on similarity scores
     */
    const getSimilarityBasedStyling = (frontendScore, backendScore, finalScore) => {
        // Use final score as primary, but consider frontend score for color intensity
        let tier, baseColor, label, opacity;
        
        if (finalScore >= frontendSimilarityThresholds.high) {
            tier = 'high';
            baseColor = [76, 175, 80]; // Green
            label = '🟢 HIGH';
            opacity = 0.8;
        } else if (finalScore >= frontendSimilarityThresholds.medium) {
            tier = 'medium';
            baseColor = [255, 193, 7]; // Yellow/Orange
            label = '🟡 MED';
            opacity = 0.7;
        } else if (finalScore >= frontendSimilarityThresholds.low) {
            tier = 'low';
            baseColor = [220, 53, 69]; // Red
            label = '🔴 LOW';
            opacity = 0.6;
        } else {
            tier = 'minimal';
            baseColor = [108, 117, 125]; // Gray
            label = '⚪ MIN';
            opacity = 0.5;
        }

        // Adjust intensity based on frontend similarity score
        const intensityMultiplier = Math.max(0.4, Math.min(1.0, frontendScore * 1.5));
        const adjustedColor = baseColor.map(c => Math.round(c * intensityMultiplier));

        return {
            tier,
            backgroundColor: `rgba(${adjustedColor[0]}, ${adjustedColor[1]}, ${adjustedColor[2]}, 0.4)`,
            border: `2px solid rgba(${adjustedColor[0]}, ${adjustedColor[1]}, ${adjustedColor[2]}, 0.8)`,
            boxShadow: `0 0 3px rgba(${adjustedColor[0]}, ${adjustedColor[1]}, ${adjustedColor[2]}, 0.6)`,
            opacity: opacity,
            label: label
        };
    };

    /**
     * Create debug overlays showing similarity calculations
     */
    const createSimilarityDebugOverlays = async (stableMappings, sentenceTexts, sentenceIds, pageNumber) => {
        if (!highlightLayerRef?.current || !verbose) return;

        log(`🔬 Creating similarity debug overlays for page ${pageNumber}`);

        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            const sentenceText = sentenceTexts[sentenceId] || '';
            
            if (!mapping?.stable_elements?.length || !sentenceText) continue;

            const elementsOnPage = mapping.stable_elements.filter(element => element.page === pageNumber);
            
            for (const element of elementsOnPage) {
                if (!element.coordinates) continue;

                // Calculate similarity for this specific element
                const similarity = calculateSimilarity(sentenceText, element.text);
                
                if (similarity.combined >= frontendSimilarityThresholds.minimum) {
                    const debugOverlay = createSimilarityDebugBox(element, similarity, sentenceId, pageNumber);
                    
                    if (debugOverlay) {
                        highlightLayerRef.current.appendChild(debugOverlay);
                    }
                }
            }
        }
    };

    /**
     * Create debug box showing similarity calculations
     */
    const createSimilarityDebugBox = (element, similarity, sentenceId, pageNumber) => {
        if (!containerRef?.current) return null;

        try {
            const coords = element.coordinates;
            const screenRect = convertBboxToScreenWithZoomHandling(coords);
            
            if (!screenRect) return null;

            const debugBox = document.createElement('div');
            debugBox.className = `${className} similarity-debug-box`;
            debugBox.setAttribute('data-sentence-id', sentenceId);
            debugBox.setAttribute('data-stable-index', element.stable_index);

            Object.assign(debugBox.style, {
                position: 'absolute',
                left: `${screenRect.x}px`,
                top: `${screenRect.y}px`,
                width: `${screenRect.width}px`,
                height: `${screenRect.height}px`,
                backgroundColor: 'rgba(0, 255, 255, 0.1)',
                border: '1px dotted rgba(0, 255, 255, 0.8)',
                pointerEvents: 'none',
                zIndex: '1002',
                fontSize: '8px',
                fontFamily: 'monospace',
                overflow: 'visible'
            });

            // Create similarity score label
            const scoreLabel = document.createElement('div');
            scoreLabel.style.cssText = `
                position: absolute;
                top: -16px;
                left: 0px;
                background: rgba(0, 255, 255, 0.9);
                color: black;
                padding: 1px 4px;
                font-size: 8px;
                font-weight: bold;
                border-radius: 2px;
                white-space: nowrap;
            `;
            
            scoreLabel.textContent = `S:${similarity.combined.toFixed(2)} T:${similarity.token.toFixed(2)} O:${similarity.overlap.toFixed(2)}`;
            debugBox.appendChild(scoreLabel);

            // Detailed tooltip
            const tooltipInfo = [
                `SIMILARITY DEBUG`,
                `Element: "${element.text}"`,
                `Combined: ${similarity.combined.toFixed(3)}`,
                `Token: ${similarity.token.toFixed(3)}`,
                `Overlap: ${similarity.overlap.toFixed(3)}`,
                `Jaccard: ${similarity.jaccard.toFixed(3)}`,
                `Words - Sentence: ${similarity.sentenceWordCount}, Element: ${similarity.elementWordCount}`
            ].join('\n');
            
            debugBox.title = tooltipInfo;

            return debugBox;

        } catch (error) {
            log('❌ Error creating similarity debug box:', error);
            return null;
        }
    };

     /**
     * Create search region overlays for debugging
     * Shows the PDFMiner→PDFjs search regions where the algorithm looked for text
     */
    const createSearchRegionOverlays = async (stableMappings, sentenceIds, pageNumber) => {
        if (!highlightLayerRef?.current) return;

        log(`🔍 Creating search region overlays for page ${pageNumber}`);

        let regionCount = 0;

        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            
            if (!mapping?.search_regions?.length) {
                log(`⚠️ No search regions for sentence ${sentenceId}`);
                continue;
            }

            // Filter search regions for current page
            const regionsOnPage = mapping.search_regions.filter(region => region.page === pageNumber);
            
            if (regionsOnPage.length === 0) {
                log(`📄 No search regions for sentence ${sentenceId} on page ${pageNumber}`);
                continue;
            }

            log(`🔍 Found ${regionsOnPage.length} search regions for sentence ${sentenceId} on page ${pageNumber}`);

            // Create overlay for each search region
            for (let i = 0; i < regionsOnPage.length; i++) {
                const region = regionsOnPage[i];
                
                const regionOverlay = createSearchRegionBox(region, sentenceId, pageNumber, i);
                
                if (regionOverlay) {
                    highlightLayerRef.current.appendChild(regionOverlay);
                    
                    // Store reference for cleanup
                    const regionKey = `search_${sentenceId}_${i}`;
                    searchRegions.current.set(regionKey, {
                        element: regionOverlay,
                        sentenceId: sentenceId,
                        regionIndex: i,
                        region: region,
                        type: 'search_region'
                    });
                    
                    regionCount++;
                }
            }
        }

        log(`✅ Created ${regionCount} search region overlays on page ${pageNumber}`);
    };

    /**
     * Create a single search region box overlay
     */
    const createSearchRegionBox = (region, sentenceId, pageNumber, regionIndex) => {
        if (!containerRef?.current || !region.pdfjs_bbox) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            // Use the PDFjs bbox which should match our coordinate system
            const bbox = region.pdfjs_bbox;

             // Create a virtual text element with the PDFjs bbox coordinates
            // This ensures the same zoom handling as the actual highlights
            const screenRect = convertBboxToScreenWithZoomHandling(bbox);
            

            // Create search region box element
            const searchBox = document.createElement('div');
            searchBox.className = `${className} search-region-box`;
            searchBox.setAttribute('data-sentence-id', sentenceId);
            searchBox.setAttribute('data-region-index', regionIndex);
            searchBox.setAttribute('data-region-type', 'search');

            // Style the search region box - distinctive from coordinate regions
            Object.assign(searchBox.style, {
                position: 'absolute',
                left: `${screenRect.x}px`,
                top: `${screenRect.y}px`,
                width: `${screenRect.width}px`,
                height: `${screenRect.height}px`,
                backgroundColor: 'rgba(0, 191, 255, 0.1)', // Light blue background
                border: '2px solid rgba(0, 191, 255, 0.8)', // Blue solid border  
                borderRadius: '4px',
                pointerEvents: 'none',
                zIndex: '999', // Below coordinate regions but above highlights
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#fff',
                textShadow: '1px 1px 1px rgba(0,0,0,0.8)',
                overflow: 'visible'
            });

            // Create label for the search region
            const label = document.createElement('div');
            label.style.cssText = `
                position: absolute;
                top: -18px;
                left: 0px;
                background: rgba(0, 191, 255, 0.9);
                color: white;
                padding: 2px 6px;
                font-size: 10px;
                font-weight: bold;
                line-height: 1.2;
                border-radius: 3px;
                white-space: nowrap;
                border: 1px solid rgba(0, 191, 255, 1);
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            `;
            
            // Label content: Search region info
            const confidence = (region.confidence || 0).toFixed(2);
            const elementCount = region.element_count || 0;
            label.textContent = `🔍 S${sentenceId}-R${regionIndex} (${elementCount} els, conf:${confidence})`;

            searchBox.appendChild(label);

            // Add detailed tooltip
            const tooltipText = [
                `SEARCH REGION ${regionIndex} for Sentence ${sentenceId}`,
                `Source: ${region.source || 'unknown'}`,
                `Elements Found: ${region.element_count || 0}`,
                `Confidence: ${(region.confidence || 0).toFixed(3)}`,
                ``,
                `PDFMiner BBox: (${region.pdfminer_bbox?.x0}, ${region.pdfminer_bbox?.y0}) → (${region.pdfminer_bbox?.x1}, ${region.pdfminer_bbox?.y1})`,
                `PDFjs BBox: (${bbox.x}, ${bbox.y}) ${bbox.width}×${bbox.height}`,
                `Converted Coords: (${region.x0}, ${region.y0}) → (${region.x1}, ${region.y1})`
            ].join('\n');
            
            searchBox.title = tooltipText;

            log(`🔍 Created search region box for sentence ${sentenceId}, region ${regionIndex} at (${screenRect.x.toFixed(1)}, ${screenRect.y.toFixed(1)}) ${screenRect.width.toFixed(1)}×${screenRect.height.toFixed(1)}`);
            
            return searchBox;

        } catch (error) {
            log('❌ Error creating search region box:', error);
            return null;
        }
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

    /**
     * Create coordinate region overlays for debugging
     * Shows the raw coordinate regions as labeled boxes
     */
    const createCoordinateRegionOverlays = async (stableMappings, sentenceIds, pageNumber) => {
        if (!highlightLayerRef?.current) return;

        log(`🗺️ Creating coordinate region overlays for page ${pageNumber}`);

        let regionCount = 0;

        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            
            if (!mapping?.stable_elements?.length) continue;

            // Filter elements for current page
            const elementsOnPage = mapping.stable_elements.filter(element => element.page === pageNumber);
            
            if (elementsOnPage.length === 0) continue;

            // Create a region overlay for each stable element
            for (const element of elementsOnPage) {
                if (!element.coordinates) continue;

                const regionOverlay = createCoordinateRegionBox(element, sentenceId, pageNumber);
                
                if (regionOverlay) {
                    highlightLayerRef.current.appendChild(regionOverlay);
                    
                    // Store reference for cleanup
                    const regionKey = `region_${sentenceId}_${element.stable_index}`;
                    coordinateRegions.current.set(regionKey, {
                        element: regionOverlay,
                        sentenceId: sentenceId,
                        stableIndex: element.stable_index,
                        coordinates: element.coordinates,
                        type: 'coordinate_region'
                    });
                    
                    regionCount++;
                }
            }
        }

        log(`✅ Created ${regionCount} coordinate region overlays on page ${pageNumber}`);
    };

    /**
     * Create a single coordinate region box overlay
     */
    const createCoordinateRegionBox = (element, sentenceId, pageNumber) => {
        if (!containerRef?.current || !element.coordinates) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            // Convert PDF coordinates to screen coordinates using the text layer approach
            const coords = element.coordinates;
            
            const screenRect = convertBboxToScreenWithZoomHandling(coords);
            
            if (!screenRect) return null;

            // Create region box element
            const regionBox = document.createElement('div');
            regionBox.className = `${className} coordinate-region-box`;
            regionBox.setAttribute('data-sentence-id', sentenceId);
            regionBox.setAttribute('data-stable-index', element.stable_index);
            regionBox.setAttribute('data-region-type', 'coordinate');

            // Style the region box
            Object.assign(regionBox.style, {
                position: 'absolute',
                left: `${screenRect.x}px`,
                top: `${screenRect.y}px`,
                width: `${screenRect.width}px`,
                height: `${screenRect.height}px`,
                backgroundColor: 'rgba(255, 0, 255, 0.15)', // Magenta background
                border: '1px dashed rgba(255, 0, 255, 0.8)', // Magenta dashed border
                borderRadius: '2px',
                pointerEvents: 'none',
                zIndex: '1001', // Above highlights
                fontSize: '10px',
                fontFamily: 'monospace',
                color: '#fff',
                textShadow: '1px 1px 1px rgba(0,0,0,0.8)',
                overflow: 'hidden'
            });

            // Create label for the region
            const label = document.createElement('div');
            label.style.cssText = `
                position: absolute;
                top: -1px;
                left: -1px;
                background: rgba(255, 0, 255, 0.9);
                color: white;
                padding: 1px 3px;
                font-size: 9px;
                font-weight: bold;
                line-height: 1;
                border-radius: 2px 0 2px 0;
                white-space: nowrap;
                max-width: ${screenRect.width + 20}px;
            `;
            
            // Label content: sentence ID + confidence + text preview
            const confidence = (element.combined_confidence || 0).toFixed(2);
            const textPreview = element.text.length > 8 ? element.text.substring(0, 8) + '…' : element.text;
            label.textContent = `S${sentenceId}:${confidence} "${textPreview}"`;

            regionBox.appendChild(label);

            // Add detailed tooltip
            const tooltipText = [
                `Sentence ID: ${sentenceId}`,
                `Stable Index: ${element.stable_index}`,
                `Text: "${element.text}"`,
                `Combined Confidence: ${(element.combined_confidence || 0).toFixed(3)}`,
                `Overlap Confidence: ${(element.overlap_confidence || 0).toFixed(3)}`,
                `Text Similarity: ${(element.text_similarity || 0).toFixed(3)}`,
                `Match Source: ${element.match_source || 'unknown'}`,
                `Coordinates: (${coords.x.toFixed(1)}, ${coords.y.toFixed(1)}) ${coords.width.toFixed(1)}×${coords.height.toFixed(1)}`
            ].join('\n');
            
            regionBox.title = tooltipText;

            log(`🗺️ Created region box for sentence ${sentenceId}, element "${element.text}" at (${screenRect.x.toFixed(1)}, ${screenRect.y.toFixed(1)})`);
            
            return regionBox;

        } catch (error) {
            log('❌ Error creating coordinate region box:', error);
            return null;
        }
    };


   
    // COORDINATE-BASED HIGHLIGHTING
    const handleCoordinateBasedHighlighting = async (highlightData, sentenceIds) => {
        log(`🎯 Coordinate highlighting data:`, {
            sentenceCount: highlightData.sentence_count,
            totalElements: highlightData.stable_elements?.length,
            pagesWithHighlights: Object.keys(highlightData.highlights_by_page || {}),
            currentPage: currentPage
        });

        const highlightsOnCurrentPage = highlightData.highlights_by_page?.[currentPage];
        
        if (!highlightsOnCurrentPage || highlightsOnCurrentPage.length === 0) {
            log(`📄 No coordinate highlights for page ${currentPage}`);
            log(`📄 Available pages:`, Object.keys(highlightData.highlights_by_page || {}));
            return;
        }

        log(`🎯 Found ${highlightsOnCurrentPage.length} coordinate highlights for page ${currentPage}`);

        let successfulHighlights = 0;
        let missingElements = 0;

        for (const highlight of highlightsOnCurrentPage) {
            const stableIndex = highlight.stable_index;
            
            // ENHANCED: More flexible element finding
            const textElement = findTextElement(stableIndex, currentPage);

            if (textElement) {
                const highlightElement = createCoordinateHighlightElement(textElement, highlight);
                if (highlightElement) {
                    highlightLayerRef.current.appendChild(highlightElement);
                    
                    // Store reference
                    const highlightKey = `coord_${stableIndex}_${highlight.sentence_id || 'unknown'}`;
                    activeHighlights.current.set(highlightKey, {
                        element: highlightElement,
                        stableIndex: stableIndex,
                        sentenceId: highlight.sentence_id,
                        type: 'coordinate'
                    });

                    successfulHighlights++;
                }
            } else {
                missingElements++;
                log(`⚠️ Text element not found for stable index ${stableIndex}`);
            }
        }

        log(`✅ Created ${successfulHighlights} coordinate highlights, ${missingElements} missing elements on page ${currentPage}`);

        // DEBUG: If no highlights were created, investigate
        if (successfulHighlights === 0) {
            log('🔍 DEBUGGING: No highlights created, investigating...');
            debugTextLayerElements();
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
                log(`✅ Found element with selector: ${selector}`);
                return element;
            }
        }

        log(`❌ Element not found with stable index ${stableIndex} on page ${pageNumber}`);
        return null;
    };

    // DEBUG: Investigate text layer structure
    const debugTextLayerElements = () => {
        if (!textLayerRef?.current) return;

        const allElements = textLayerRef.current.querySelectorAll('[data-stable-index]');
        log(`🔍 Text layer debug:`, {
            totalElements: allElements.length,
            currentPage: currentPage,
            sampleElements: Array.from(allElements).slice(0, 5).map(el => ({
                stableIndex: el.getAttribute('data-stable-index'),
                pageNumber: el.getAttribute('data-page-number'),
                text: el.textContent?.substring(0, 30),
                classList: el.className
            }))
        });

        // Check if elements have the expected page number
        const elementsOnCurrentPage = textLayerRef.current.querySelectorAll(`[data-page-number="${currentPage}"]`);
        log(`🔍 Elements on page ${currentPage}:`, elementsOnCurrentPage.length);
    };

    // Create highlight element from coordinate data
    const createCoordinateHighlightElement = (textElement, highlightInfo) => {
        if (!containerRef?.current) {
            log('❌ containerRef not available');
            return null;
        }

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) {
            log('❌ page container not found');
            return null;
        }

        try {
            // Get bounding rects for positioning
            const elementRect = textElement.getBoundingClientRect();
            const pageContainerRect = pageContainer.getBoundingClientRect();

            // Calculate position relative to the page container
            const left = elementRect.left - pageContainerRect.left;
            const top = elementRect.top - pageContainerRect.top;
            const width = elementRect.width;
            const height = elementRect.height;

            // Validate dimensions
            if (width <= 0 || height <= 0) {
                log(`⚠️ Invalid element dimensions: ${width}x${height}`);
                return null;
            }

            // Create highlight element
            const highlightElement = document.createElement('div');
            highlightElement.className = `${className} coordinate-highlight`;
            highlightElement.setAttribute('data-sentence-id', highlightInfo.sentence_id || 'unknown');
            highlightElement.setAttribute('data-stable-index', highlightInfo.stable_index);

            // Apply styles
            Object.assign(highlightElement.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: highlightStyle.backgroundColor,
                border: highlightStyle.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: '1000',
                opacity: '0.8',
                boxShadow: '0 0 3px rgba(76, 175, 80, 0.5)', // Coordinate highlight glow
                transition: 'opacity 0.2s ease' // Smooth appearance
            });

            log(`✨ Created coordinate highlight for stable index ${highlightInfo.stable_index}: ${width.toFixed(1)}x${height.toFixed(1)} at (${left.toFixed(1)}, ${top.toFixed(1)})`);
            return highlightElement;

        } catch (error) {
            log('❌ Error creating coordinate highlight element:', error);
            return null;
        }
    };


     /**
     * Get stable mappings for sentence IDs from your existing API
     */
    const getStableMappings = async (sentenceIds) => {
        if (!sentenceIds?.length || !documentFilename) return null;

        const cacheKey = `${documentFilename}_${sentenceIds.join(',')}_${currentPage}`;
        
        if (mappingsCache.current.has(cacheKey)) {
            log('📋 Using cached stable mappings');
            return mappingsCache.current.get(cacheKey);
        }

        try {
            log(`🔍 Fetching stable mappings for sentences:`, sentenceIds);
            
            const response = await getSentenceItemMappings(documentFilename, sentenceIds);
            
            if (!response?.success || !response?.sentence_mappings) {
                log('❌ No sentence mappings in response');
                return null;
            }

            log(`✅ Received mappings for ${Object.keys(response.sentence_mappings).length} sentences`);
            


            // Cache the result
            mappingsCache.current.set(cacheKey, response.sentence_mappings);
            
            return response.sentence_mappings;

        } catch (error) {
            log('❌ Error fetching stable mappings:', error);
            return null;
        }
    };

    /**
     * Create highlights from your stable mappings structure
     */
    const createHighlightsFromStableMappings = async (stableMappings, sentenceIds, pageNumber) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

        let highlightCount = 0;
        let elementsOnOtherPages = 0;

        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            
            if (!mapping?.stable_elements?.length) {
                log(`⚠️ No stable elements for sentence ${sentenceId}`);
                continue;
            }

            log(`🔍 Processing sentence ${sentenceId}: "${mapping.sentence_text?.substring(0, 50)}..."`);
            log(`📊 Found ${mapping.stable_elements.length} stable elements`);

            // Filter elements for current page
            const elementsOnPage = mapping.stable_elements.filter(element => (element.page === pageNumber) && (element.text_similarity > 0));
            const elementsElsewhere = mapping.stable_elements.filter(element => element.page !== pageNumber && (element.text_similarity > 0));

            if (elementsElsewhere.length > 0) {
                elementsOnOtherPages += elementsElsewhere.length;
                log(`📄 ${elementsElsewhere.length} elements for sentence ${sentenceId} are on other pages: ${[...new Set(elementsElsewhere.map(e => e.page))].join(', ')}`);
            }

            if (elementsOnPage.length === 0) {
                log(`📄 No elements for sentence ${sentenceId} on page ${pageNumber}`);
                continue;
            }

            log(`🎯 Found ${elementsOnPage.length} elements for sentence ${sentenceId} on page ${pageNumber}`);

            // Group nearby elements and create highlights
            const highlightGroups = groupNearbyElements(elementsOnPage);
            
            for (const group of highlightGroups) {
                const highlight = await createHighlightFromElementGroup(group, sentenceId, pageNumber);
                
                if (highlight) {
                    highlightCount++;

                     // Log confidence details for analysis
                    const confidenceInfo = group.map(el => ({
                        text: el.text,
                        combined: el.combined_confidence?.toFixed(3),
                        overlap: el.overlap_confidence?.toFixed(3),
                        text_sim: el.text_similarity?.toFixed(3),
                        source: el.match_source
                    }));
                    log(`✨ Created highlight for sentence ${sentenceId}:`, confidenceInfo);
                } else {
                    log(`❌ Failed to create highlight for sentence ${sentenceId}`);
                }
            }
        }

        log(`✅ Created ${highlightCount} highlights on page ${pageNumber}`);
        if (elementsOnOtherPages > 0) {
            log(`📊 ${elementsOnOtherPages} total elements found on other pages`);
        }
        
        if (highlightCount === 0 && sentenceIds.length > 0) {
            log('🔍 No highlights created - debugging');
            debugHighlightCreation(stableMappings, sentenceIds, pageNumber);
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
            if (Math.abs(yDiff) > 5) return yDiff; // Different lines
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

        log(`🔗 Grouped ${elements.length} elements into ${groups.length} highlight groups`);
        return groups;
    };

    const getConfidenceBasedStyle = (elementGroup) => {
        // Calculate group confidence metrics
        const confidences = elementGroup.map(el => ({
            combined: el.combined_confidence || 0,
            overlap: el.overlap_confidence || 0,
            text_sim: el.text_similarity || 0
        }));

        // Use the average combined confidence as the primary metric
        const avgCombined = confidences.reduce((sum, c) => sum + c.combined, 0) / confidences.length;
        const avgOverlap = confidences.reduce((sum, c) => sum + c.overlap, 0) / confidences.length;
        const avgTextSim = confidences.reduce((sum, c) => sum + c.text_sim, 0) / confidences.length;

        // Determine confidence tier and color
        let tier, bgColor, borderColor, label;
        
        if (avgCombined >= overlapConfidenceThresholds.high) {
            tier = 'high';
            bgColor = 'rgba(76, 175, 80, 0.4)';   // Green
            borderColor = 'rgba(76, 175, 80, 0.8)';
            label = '🟢 HIGH';
        } else if (avgCombined >= overlapConfidenceThresholds.medium) {
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
                combined: avgCombined,
                overlap: avgOverlap,
                text_similarity: avgTextSim,
                label: label
            }
        };
    };

    /**
     * Create a highlight element from a group of stable elements
     */
   const createHighlightFromElementGroup = async (elementGroup, sentenceId, pageNumber) => {
        if (!containerRef?.current || elementGroup.length === 0) return null;

        try {
            // Find the actual text elements in the text layer for these stable indices
            const textElements = elementGroup
                .map(element => findTextElement(element.stable_index, pageNumber))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                log(`❌ No text elements found for stable indices: ${elementGroup.map(e => e.stable_index).join(', ')}`);
                return null;
            }

            log(`✅ Found ${textElements.length}/${elementGroup.length} text elements for highlighting`);

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

                log(`✨ Created highlight for sentence ${sentenceId}, group of ${elementGroup.length} elements`);
                log(`📝 Group text: "${elementGroup.map(e => e.text).join(' ')}"`);
                
                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight from element group:', error);
        }

        return null;
    };

    /**
     * Create highlight element from text elements with confidence-based styling
     */
    const createHighlightFromTextElements = (textElements, sentenceId, elementGroup) => {
        if (!containerRef?.current) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            // Get bounding rectangles for all text elements (already at correct zoom)
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            // Calculate the encompassing rectangle relative to page container
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

            // Get confidence-based styling
            const confidenceStyle = getConfidenceBasedStyle(elementGroup);

            // Create highlight element
            const highlightElement = document.createElement('div');
            highlightElement.className = `${className} coordinate-highlight confidence-${confidenceStyle.tier}`;
            highlightElement.setAttribute('data-sentence-id', sentenceId);
            highlightElement.setAttribute('data-element-count', elementGroup.length);
            highlightElement.setAttribute('data-stable-indices', elementGroup.map(e => e.stable_index).join(','));
            highlightElement.setAttribute('data-confidence-tier', confidenceStyle.tier);
            highlightElement.setAttribute('data-combined-confidence', confidenceStyle.confidence.combined.toFixed(3));
            highlightElement.setAttribute('data-overlap-confidence', confidenceStyle.confidence.overlap.toFixed(3));
            highlightElement.setAttribute('data-text-similarity', confidenceStyle.confidence.text_similarity.toFixed(3));

            // Apply confidence-based styles
            Object.assign(highlightElement.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: confidenceStyle.backgroundColor,
                border: confidenceStyle.border,
                borderRadius: confidenceStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: '1000',
                opacity: '0.8',
                boxShadow: `0 0 3px ${confidenceStyle.border.match(/rgba?\([^)]+\)/)[0]}`,
                transition: 'opacity 0.2s ease'
            });

            // Add confidence tooltip/title
            const tooltipText = [
                `${confidenceStyle.confidence.label}`,
                `Combined: ${confidenceStyle.confidence.combined.toFixed(3)}`,
                `Overlap: ${confidenceStyle.confidence.overlap.toFixed(3)}`,
                `Text Sim: ${confidenceStyle.confidence.text_similarity.toFixed(3)}`,
                `Text: "${elementGroup.map(e => e.text).join(' ')}"`
            ].join('\n');
            
            highlightElement.title = tooltipText;

            log(`✨ Created ${confidenceStyle.confidence.label} highlight: ${width.toFixed(1)}x${height.toFixed(1)} at (${left.toFixed(1)}, ${top.toFixed(1)})`);
            log(`📊 Confidence metrics:`, confidenceStyle.confidence);
            
            return highlightElement;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };


    /**
     * Debug why highlights weren't created
     */
    const debugHighlightCreation = (stableMappings, sentenceIds, pageNumber) => {
        log('🔍 DEBUGGING: Why no highlights were created');
        
        for (const sentenceId of sentenceIds) {
            const mapping = stableMappings[sentenceId];
            log(`🔍 Sentence ${sentenceId}:`, {
                hasMapping: !!mapping,
                hasStableElements: !!mapping?.stable_elements,
                elementCount: mapping?.stable_elements?.length || 0,
                found: mapping?.found,
                sentenceText: mapping?.sentence_text?.substring(0, 50)
            });

            if (mapping?.stable_elements) {
                const pageBreakdown = {};
                mapping.stable_elements.forEach(element => {
                    const page = element.page;
                    if (!pageBreakdown[page]) pageBreakdown[page] = [];
                    pageBreakdown[page].push({
                        stableIndex: element.stable_index,
                        text: element.text,
                        confidence: element.combined_confidence
                    });
                });

                log(`📊 Elements by page for sentence ${sentenceId}:`, pageBreakdown);
                log(`📄 Current page ${pageNumber} has ${pageBreakdown[pageNumber]?.length || 0} elements`);
            }
        }

        // Check page container and viewport
        const pageContainer = containerRef.current?.querySelector('.pdf-page-container');
        log(`🔍 Page container:`, {
            exists: !!pageContainer,
            zoomRatio: window.currentZoomRatio,
            hasTextLayerViewport: !!window.currentTextLayerViewport
        });
    };

    /**
     * Clear all active highlights
     */
    const clearAllHighlights = () => {
        if (!highlightLayerRef?.current) return;

         // Clear regular highlights
        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        // Clear coordinate region boxes
        const existingRegions = highlightLayerRef.current.querySelectorAll('.coordinate-region-box');
        existingRegions.forEach(el => el.remove());

        // Clear search region boxes  
        const existingSearchRegions = highlightLayerRef.current.querySelectorAll('.search-region-box');
        existingSearchRegions.forEach(el => el.remove());


        activeHighlights.current.clear();
        coordinateRegions.current.clear();
        searchRegions.current.clear();
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

export default CoordinateHighlighter;