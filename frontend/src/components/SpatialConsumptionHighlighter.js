// SpatialConsumptionHighlighter.js - Combines consumption data with spatial reasoning
import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';

const SpatialConsumptionHighlighter = ({
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
    className = 'spatial-consumption-highlight',
    verbose = true
}) => {
    const activeHighlights = useRef(new Map());
    const mappingsCache = useRef(new Map());

    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[SpatialConsumption] ${message}`, ...args);
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
        log(`🎯 Highlighting sentences with spatial + consumption awareness:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();

                // Get stable mappings for these sentences
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                // Create spatially-aware highlights
                await createSpatiallyAwareHighlights(stableMappings);

            } catch (error) {
                console.error('[SpatialConsumption] Error during highlighting:', error);
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
     * Get stable mappings for sentence IDs
     */
    const getStableMappings = async (sentenceIds) => {
        if (!sentenceIds?.length || !documentFilename) return null;

        const cacheKey = `${documentFilename}_${sentenceIds.join(',')}_${currentPage}`;

        if (mappingsCache.current.has(cacheKey)) {
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
     * Create highlights using spatial reasoning + consumption data
     */
    const createSpatiallyAwareHighlights = async (stableMappings) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

        // Filter for current page and found sentences
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
            // Apply spatial + consumption filtering
            const relevantElements = applySpatialConsumptionFiltering(
                mapping.stable_elements, 
                mapping.sentence_text,
                sentenceId
            );

            if (relevantElements.length === 0) {
                log(`⚠️ No relevant elements after spatial-consumption filtering for sentence ${sentenceId}`);
                continue;
            }

            // Create spatially-coherent highlight groups
            const spatialGroups = createSpatiallyCoherentGroups(relevantElements, mapping.sentence_text);

            // Create highlights for each group
            for (const group of spatialGroups) {
                const highlight = await createHighlightFromSpatialGroup(group, sentenceId, mapping.sentence_text);
                
                if (highlight) {
                    highlightCount++;
                    log(`✨ Created spatial-consumption highlight for sentence ${sentenceId}, group of ${group.elements.length} elements`);
                }
            }
        }

        log(`✅ Created ${highlightCount} spatial-consumption highlights on page ${currentPage}`);
    };

    /**
     * Apply spatial reasoning + consumption filtering
     */
    const applySpatialConsumptionFiltering = (stableElements, sentenceText, sentenceId) => {
        if (!stableElements || !sentenceText) return [];

        // 1. Extract and analyze sentence words
        const sentenceWords = extractSentenceWords(sentenceText);
        const sentenceWordOrder = createWordOrderMap(sentenceWords);

        log(`📝 Sentence has ${sentenceWords.length} meaningful words`);

        // 2. Categorize elements by consumption quality
        const elementCategories = categorizeElementsByConsumption(
            stableElements, 
            sentenceWords, 
            sentenceWordOrder
        );

        log(`🏷️ Element categories: high=${elementCategories.high.length}, medium=${elementCategories.medium.length}, low=${elementCategories.low.length}`);

        // 3. Start with high-quality anchor elements
        let selectedElements = [...elementCategories.high];

        // 4. Add medium-quality elements if they're spatially connected
        const connectedMedium = findSpatiallyConnectedElements(
            selectedElements,
            elementCategories.medium,
            'medium'
        );
        selectedElements.push(...connectedMedium);

        // 5. Add low-quality elements only if they complete word sequences
        const necessaryLow = findNecessarySequenceElements(
            selectedElements,
            elementCategories.low,
            sentenceWords,
            sentenceWordOrder
        );
        selectedElements.push(...necessaryLow);

        // 6. Sort by reading order for final coherence check
        selectedElements.sort((a, b) => {
            // Sort by Y coordinate first (reading order), then X coordinate
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff;
            return a.coordinates.x - b.coordinates.x;
        });

        log(`✅ Selected ${selectedElements.length}/${stableElements.length} elements after spatial-consumption filtering`);
        return selectedElements;
    };

    /**
     * Extract meaningful words and create order mapping
     */
    const extractSentenceWords = (sentenceText) => {
        return sentenceText.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1) // Keep words with 2+ characters
            .map((word, index) => ({ word, originalIndex: index }));
    };

    const createWordOrderMap = (sentenceWords) => {
        const orderMap = new Map();
        sentenceWords.forEach((wordObj, index) => {
            orderMap.set(wordObj.word, index);
        });
        return orderMap;
    };

    /**
     * Categorize elements by consumption quality
     */
    const categorizeElementsByConsumption = (stableElements, sentenceWords, wordOrderMap) => {
        const categories = { high: [], medium: [], low: [] };
        const sentenceWordSet = new Set(sentenceWords.map(w => w.word));

        stableElements.forEach(element => {
            const consumptionRatio = element.consumption_ratio || 0;
            const wordsConsumed = element.words_consumed || [];
            
            // Calculate word relevance and order consistency
            const relevantWords = wordsConsumed.filter(word => 
                sentenceWordSet.has(word.toLowerCase())
            );
            
            const wordRelevance = wordsConsumed.length > 0 ? 
                relevantWords.length / wordsConsumed.length : 0;

            // Check word order consistency (bonus for maintaining sequence)
            const orderConsistency = calculateWordOrderConsistency(
                relevantWords, 
                wordOrderMap
            );

            // Enhanced element with analysis
            const enhancedElement = {
                ...element,
                relevantWords,
                wordRelevance,
                orderConsistency,
                qualityScore: calculateQualityScore(consumptionRatio, wordRelevance, orderConsistency)
            };

            // Categorize based on multiple factors
            if (consumptionRatio >= 0.6 || (consumptionRatio >= 0.3 && wordRelevance >= 0.8)) {
                categories.high.push(enhancedElement);
            } else if (consumptionRatio >= 0.2 || wordRelevance >= 0.5 || relevantWords.length >= 2) {
                categories.medium.push(enhancedElement);
            } else if (relevantWords.length > 0) {
                categories.low.push(enhancedElement);
            }
            // Elements with no relevant words are excluded entirely
        });

        return categories;
    };

    /**
     * Calculate word order consistency
     */
    const calculateWordOrderConsistency = (words, wordOrderMap) => {
        if (words.length <= 1) return 1; // Single words are always consistent

        const positions = words
            .map(word => wordOrderMap.get(word.toLowerCase()))
            .filter(pos => pos !== undefined)
            .sort((a, b) => a - b);

        if (positions.length <= 1) return 1;

        // Check how many words are in correct order
        let correctOrder = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i] > positions[i-1]) {
                correctOrder++;
            }
        }

        return correctOrder / (positions.length - 1);
    };

    /**
     * Calculate overall quality score
     */
    const calculateQualityScore = (consumption, relevance, order) => {
        return (consumption * 0.5) + (relevance * 0.3) + (order * 0.2);
    };

    /**
     * Find spatially connected elements
     */
    const findSpatiallyConnectedElements = (anchorElements, candidateElements, quality) => {
        if (anchorElements.length === 0) return candidateElements; // If no anchors, include all

        const connected = [];
        const maxDistance = quality === 'medium' ? 50 : 30; // Allow more distance for medium quality

        candidateElements.forEach(candidate => {
            const isConnected = anchorElements.some(anchor => {
                const distance = calculateSpatialDistance(anchor, candidate);
                return distance <= maxDistance;
            });

            if (isConnected) {
                connected.push(candidate);
            }
        });

        log(`🔗 Found ${connected.length}/${candidateElements.length} spatially connected ${quality} elements`);
        return connected;
    };

    /**
     * Find elements necessary to complete word sequences
     */
    const findNecessarySequenceElements = (currentElements, candidateElements, sentenceWords, wordOrderMap) => {
        // Get words already covered
        const coveredWords = new Set();
        currentElements.forEach(el => {
            (el.relevantWords || []).forEach(word => {
                coveredWords.add(word.toLowerCase());
            });
        });

        const totalSentenceWords = sentenceWords.map(w => w.word);
        const missingWords = totalSentenceWords.filter(word => !coveredWords.has(word));

        if (missingWords.length === 0) {
            log(`✅ All sentence words already covered, no additional elements needed`);
            return [];
        }

        log(`🔍 Looking for elements to cover missing words: ${missingWords.join(', ')}`);

        // Find candidate elements that contain missing words
        const necessary = candidateElements.filter(candidate => {
            const candidateWords = (candidate.relevantWords || []).map(w => w.toLowerCase());
            const coversMissingWords = candidateWords.some(word => missingWords.includes(word));
            
            if (coversMissingWords) {
                // Additional check: is this element spatially reasonable?
                const isReasonablyPositioned = currentElements.length === 0 || 
                    currentElements.some(current => {
                        const distance = calculateSpatialDistance(current, candidate);
                        return distance <= 80; // More lenient for completing sequences
                    });

                return isReasonablyPositioned;
            }
            
            return false;
        });

        log(`🎯 Found ${necessary.length} necessary elements for sequence completion`);
        return necessary;
    };

    /**
     * Calculate spatial distance between two elements
     */
    const calculateSpatialDistance = (element1, element2) => {
        const coords1 = element1.coordinates;
        const coords2 = element2.coordinates;

        // Calculate center points
        const center1 = {
            x: coords1.x + coords1.width / 2,
            y: coords1.y + coords1.height / 2
        };
        const center2 = {
            x: coords2.x + coords2.width / 2,
            y: coords2.y + coords2.height / 2
        };

        // Euclidean distance
        const dx = center1.x - center2.x;
        const dy = center1.y - center2.y;
        
        return Math.sqrt(dx * dx + dy * dy);
    };

    /**
     * Create spatially coherent groups from selected elements
     */
    const createSpatiallyCoherentGroups = (elements, sentenceText) => {
        if (elements.length === 0) return [];

        // Sort elements by reading order
        const sortedElements = [...elements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff;
            return a.coordinates.x - b.coordinates.x;
        });

        const groups = [];
        let currentGroup = {
            elements: [sortedElements[0]],
            avgConsumption: sortedElements[0].consumption_ratio || 0,
            totalRelevantWords: (sortedElements[0].relevantWords || []).length,
            spatialCohesion: 1.0
        };

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const lastInGroup = currentGroup.elements[currentGroup.elements.length - 1];

            const distance = calculateSpatialDistance(lastInGroup, current);
            const maxGroupDistance = 60; // Maximum distance to stay in same group

            if (distance <= maxGroupDistance) {
                // Add to current group
                currentGroup.elements.push(current);
                currentGroup.avgConsumption = 
                    (currentGroup.avgConsumption * (currentGroup.elements.length - 1) + 
                     (current.consumption_ratio || 0)) / currentGroup.elements.length;
                currentGroup.totalRelevantWords += (current.relevantWords || []).length;
            } else {
                // Start new group
                groups.push(currentGroup);
                currentGroup = {
                    elements: [current],
                    avgConsumption: current.consumption_ratio || 0,
                    totalRelevantWords: (current.relevantWords || []).length,
                    spatialCohesion: 1.0
                };
            }
        }

        // Don't forget the last group
        groups.push(currentGroup);

        // Calculate spatial cohesion for each group
        groups.forEach(group => {
            group.spatialCohesion = calculateGroupSpatialCohesion(group.elements);
        });

        log(`🏗️ Created ${groups.length} spatially coherent groups`);
        return groups;
    };

    /**
     * Calculate spatial cohesion score for a group
     */
    const calculateGroupSpatialCohesion = (elements) => {
        if (elements.length <= 1) return 1.0;

        let totalDistance = 0;
        let pairCount = 0;

        for (let i = 0; i < elements.length - 1; i++) {
            const distance = calculateSpatialDistance(elements[i], elements[i + 1]);
            totalDistance += distance;
            pairCount++;
        }

        const avgDistance = totalDistance / pairCount;
        // Convert to cohesion score (lower distance = higher cohesion)
        return Math.max(0, 1 - (avgDistance / 100));
    };

    /**
     * Create highlight from spatial group
     */
    const createHighlightFromSpatialGroup = async (spatialGroup, sentenceId, sentenceText) => {
        if (!containerRef?.current || spatialGroup.elements.length === 0) return null;

        try {
            // Find the actual text elements in the text layer
            const textElements = spatialGroup.elements
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                log(`❌ No text elements found for spatial group`);
                return null;
            }

            // Create highlight element with spatial-consumption styling
            const highlightElement = createHighlightFromTextElements(
                textElements, 
                sentenceId, 
                spatialGroup,
                sentenceText
            );

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                // Store reference for cleanup
                const highlightKey = `spatial_${sentenceId}_${spatialGroup.elements[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    spatialGroup: spatialGroup,
                    textElements: textElements,
                    type: 'spatial_consumption'
                });

                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight from spatial group:', error);
        }

        return null;
    };

    /**
     * Create highlight element with spatial + consumption styling
     */
    const createHighlightFromTextElements = (textElements, sentenceId, spatialGroup, sentenceText) => {
        if (!containerRef?.current) return null;

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            // Calculate encompassing rectangle
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

            // Get styling based on group quality
            const groupStyle = getSpatialGroupStyle(spatialGroup);

            // Create highlight element
            const highlightDiv = document.createElement('div');
            highlightDiv.className = className;

            Object.assign(highlightDiv.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: groupStyle.backgroundColor,
                border: groupStyle.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
            });

            // Enhanced tooltip with spatial + consumption details
            const qualityDetails = spatialGroup.elements.map(el => 
                `${el.stable_index}: ${(el.consumption_ratio * 100).toFixed(1)}% (${el.relevantWords?.length || 0} words)`
            ).join(', ');

            highlightDiv.title = `
Sentence: ${sentenceId}
Text: "${sentenceText.substring(0, 60)}..."
Avg Consumption: ${(spatialGroup.avgConsumption * 100).toFixed(1)}%
Spatial Cohesion: ${(spatialGroup.spatialCohesion * 100).toFixed(1)}%
Total Words: ${spatialGroup.totalRelevantWords}
Elements: ${qualityDetails}
Quality: ${groupStyle.label}
            `.trim();

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight from text elements:', error);
            return null;
        }
    };

    /**
     * Get styling based on spatial group quality
     */
    const getSpatialGroupStyle = (spatialGroup) => {
        const avgConsumption = spatialGroup.avgConsumption;
        const spatialCohesion = spatialGroup.spatialCohesion;
        const combinedQuality = (avgConsumption * 0.6) + (spatialCohesion * 0.4);

        if (combinedQuality >= 0.7) {
            return {
                backgroundColor: 'rgba(76, 175, 80, 0.4)',   // Green - high quality
                border: '2px solid rgba(76, 175, 80, 0.8)',
                label: 'HIGH QUALITY'
            };
        } else if (combinedQuality >= 0.4) {
            return {
                backgroundColor: 'rgba(255, 193, 7, 0.4)',    // Yellow - medium quality
                border: '2px solid rgba(255, 193, 7, 0.8)',
                label: 'MEDIUM QUALITY'
            };
        } else {
            return {
                backgroundColor: 'rgba(255, 152, 0, 0.4)',    // Orange - lower quality
                border: '2px solid rgba(255, 152, 0, 0.8)',
                label: 'LOWER QUALITY'
            };
        }
    };

    /**
     * Find text element in text layer
     */
    const findTextElement = (stableIndex, pageNumber) => {
        if (!textLayerRef?.current) {
            return null;
        }

        const selectors = [
            `[data-stable-index="${stableIndex}"][data-page-number="${pageNumber}"]`,
            `[data-stable-index="${stableIndex}"]`,
            `.pdf-text-item[data-stable-index="${stableIndex}"]`
        ];

        for (const selector of selectors) {
            const element = textLayerRef.current.querySelector(selector);
            if (element) {
                return element;
            }
        }

        return null;
    };

    /**
     * Clear all active highlights
     */
    const clearAllHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        activeHighlights.current.clear();
        log('🧹 Cleared all spatial-consumption highlights');
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

export default SpatialConsumptionHighlighter;