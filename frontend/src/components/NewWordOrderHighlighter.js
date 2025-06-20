// SequentialWordOrderHighlighter.js - Spatial + Consumption + Sequential Word Order Filtering
import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';

const NewWordOrderHighlighter = ({
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
    className = 'sequential-word-order-highlight',
    verbose = true
}) => {
    const activeHighlights = useRef(new Map());
    const mappingsCache = useRef(new Map());

    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[SequentialWordOrder] ${message}`, ...args);
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
        log(`🎯 Sequential word order highlighting for sentences:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();

                // Get stable mappings for these sentences
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                // Create highlights with sequential word order filtering
                await createSequentialWordOrderHighlights(stableMappings);

            } catch (error) {
                console.error('[SequentialWordOrder] Error during highlighting:', error);
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
     * Get stable mappings for sentence IDs (same as before)
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
     * Create highlights using spatial + consumption + sequential word order filtering
     */
    const createSequentialWordOrderHighlights = async (stableMappings) => {
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
            // Step 1: Apply existing spatial + consumption filtering
            const relevantElements = applySpatialConsumptionFiltering(
                mapping.stable_elements, 
                mapping.sentence_text,
                sentenceId
            );

            if (relevantElements.length === 0) {
                log(`⚠️ No relevant elements after spatial-consumption filtering for sentence ${sentenceId}`);
                continue;
            }

            // Step 2: Apply sequential word order filtering (NEW)
            const sequentiallyFilteredElements = applySequentialWordOrderFilter(
                relevantElements,
                mapping.sentence_text,
                sentenceId
            );

            if (sequentiallyFilteredElements.length === 0) {
                log(`⚠️ No elements passed sequential word order filter for sentence ${sentenceId}`);
                continue;
            }

            // Step 3: Create spatially-coherent groups from filtered elements
            const spatialGroups = createSpatiallyCoherentGroups(sequentiallyFilteredElements, mapping.sentence_text);

            // Step 4: Create highlights for each group
            for (const group of spatialGroups) {
                const highlight = await createHighlightFromSpatialGroup(group, sentenceId, mapping.sentence_text);
                
                if (highlight) {
                    highlightCount++;
                    log(`✨ Created sequential highlight for sentence ${sentenceId}, group of ${group.elements.length} elements`);
                }
            }
        }

        log(`✅ Created ${highlightCount} sequential word order highlights on page ${currentPage}`);
    };

    /**
     * NEW: Apply sequential word order filtering
     * Rewards elements that capture sentence beginnings/endings and follow logical word order
     */
    const applySequentialWordOrderFilter = (elements, sentenceText, sentenceId) => {
        log(`🔄 Applying sequential word order filter to ${elements.length} elements for sentence ${sentenceId}`);

        // Extract sentence words with positions
        const sentenceWords = extractSentenceWordsWithPositions(sentenceText);
        
        if (sentenceWords.length === 0) {
            log(`⚠️ No words found in sentence text`);
            return elements;
        }

        log(`📝 Sentence has ${sentenceWords.length} words: ${sentenceWords.slice(0, 5).map(w => w.word).join(' ')}${sentenceWords.length > 5 ? '...' : ''}`);

        // Analyze each element for word order compliance
        const analyzedElements = elements.map(element => 
            analyzeElementWordOrder(element, sentenceWords, sentenceId)
        );

        // Find anchor elements (those with sentence start/end words)
        const anchorElements = findAnchorElements(analyzedElements, sentenceWords);
        log(`⚓ Found ${anchorElements.length} anchor elements (start/end words)`);

        // Build sequential chains from anchors
        const sequentialChains = buildSequentialChains(anchorElements, analyzedElements, sentenceWords);
        log(`🔗 Built ${sequentialChains.length} sequential chains`);

        // Select best elements from chains
        const selectedElements = selectBestSequentialElements(sequentialChains, sentenceWords);
        
        log(`✅ Sequential filter: ${selectedElements.length}/${elements.length} elements selected`);
        return selectedElements;
    };

    /**
     * Extract sentence words with their positions in the sentence
     */
    const extractSentenceWordsWithPositions = (sentenceText) => {
        return sentenceText.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1)
            .map((word, index) => ({ 
                word, 
                position: index, 
                isFirst: index === 0,
                isLast: false // Will be set after we know the length
            }))
            .map((wordObj, index, array) => ({
                ...wordObj,
                isLast: index === array.length - 1
            }));
    };

    /**
     * Analyze element for word order compliance
     */
    const analyzeElementWordOrder = (element, sentenceWords, sentenceId) => {
        const consumedWords = element.words_consumed || [];
        const relevantWords = consumedWords.filter(word => 
            sentenceWords.some(sw => sw.word === word.toLowerCase())
        );

        // Map consumed words to their sentence positions
        const wordPositions = relevantWords.map(word => {
            const sentenceWord = sentenceWords.find(sw => sw.word === word.toLowerCase());
            return sentenceWord ? sentenceWord.position : -1;
        }).filter(pos => pos >= 0).sort((a, b) => a - b);

        // Calculate sequential properties
        const hasFirstWord = relevantWords.some(word => 
            sentenceWords[0] && sentenceWords[0].word === word.toLowerCase()
        );
        
        const hasLastWord = relevantWords.some(word => 
            sentenceWords[sentenceWords.length - 1] && 
            sentenceWords[sentenceWords.length - 1].word === word.toLowerCase()
        );

        // Calculate word order consistency
        const orderConsistency = calculateWordOrderConsistency(wordPositions);

        // Calculate sentence coverage contribution
        const coverageContribution = wordPositions.length / sentenceWords.length;

        // Calculate sequential score
        const sequentialScore = calculateSequentialScore(
            hasFirstWord, hasLastWord, orderConsistency, coverageContribution, element.consumption_ratio
        );

        return {
            ...element,
            // Word order analysis
            relevantWords,
            wordPositions,
            hasFirstWord,
            hasLastWord,
            orderConsistency,
            coverageContribution,
            sequentialScore,
            // Categorization
            isAnchor: hasFirstWord || hasLastWord,
            isSequential: orderConsistency >= 0.7 && wordPositions.length >= 2
        };
    };

    /**
     * Calculate word order consistency for an element
     */
    const calculateWordOrderConsistency = (positions) => {
        if (positions.length <= 1) return 1; // Single words are always consistent

        let correctTransitions = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i] > positions[i-1]) {
                correctTransitions++;
            }
        }

        return correctTransitions / (positions.length - 1);
    };

    /**
     * Calculate sequential score for an element
     */
    const calculateSequentialScore = (hasFirstWord, hasLastWord, orderConsistency, coverageContribution, consumptionRatio) => {
        let score = 0;

        // Anchor bonuses
        if (hasFirstWord) score += 0.3;  // Big bonus for sentence start
        if (hasLastWord) score += 0.2;   // Bonus for sentence end

        // Order consistency bonus
        score += orderConsistency * 0.2;

        // Coverage contribution
        score += coverageContribution * 0.2;

        // Consumption quality
        score += (consumptionRatio || 0) * 0.1;

        return Math.min(1.0, score);
    };

    /**
     * Find anchor elements (containing first or last words)
     */
    const findAnchorElements = (analyzedElements, sentenceWords) => {
        return analyzedElements.filter(element => element.isAnchor);
    };

    /**
     * Build sequential chains starting from anchor elements
     */
    const buildSequentialChains = (anchorElements, allElements, sentenceWords) => {
        const chains = [];

        // Start chains from each anchor element
        anchorElements.forEach(anchor => {
            const chain = buildChainFromAnchor(anchor, allElements, sentenceWords);
            if (chain.elements.length > 0) {
                chains.push(chain);
            }
        });

        return chains;
    };

    /**
     * Build a sequential chain starting from an anchor element
     */
    const buildChainFromAnchor = (anchor, allElements, sentenceWords) => {
        const chain = {
            anchorElement: anchor,
            elements: [anchor],
            totalCoverage: anchor.coverageContribution,
            averageSequentialScore: anchor.sequentialScore,
            isComplete: false
        };

        // Track covered word positions
        const coveredPositions = new Set(anchor.wordPositions);

        // Sort other elements by spatial proximity to anchor
        const candidateElements = allElements
            .filter(el => el !== anchor && !el.isAnchor) // Don't include other anchors
            .map(el => ({
                ...el,
                distanceFromAnchor: calculateSpatialDistance(anchor, el)
            }))
            .sort((a, b) => a.distanceFromAnchor - b.distanceFromAnchor);

        // Add elements that continue the sequence
        for (const candidate of candidateElements) {
            // Check if this element continues the word sequence
            const continuesSequence = checkIfContinuesSequence(
                candidate, 
                coveredPositions, 
                sentenceWords,
                anchor
            );

            if (continuesSequence) {
                chain.elements.push(candidate);
                candidate.wordPositions.forEach(pos => coveredPositions.add(pos));
                chain.totalCoverage = coveredPositions.size / sentenceWords.length;
                
                // Update average sequential score
                const totalScore = chain.elements.reduce((sum, el) => sum + el.sequentialScore, 0);
                chain.averageSequentialScore = totalScore / chain.elements.length;

                // Check if we've covered most of the sentence
                if (chain.totalCoverage >= 0.7) {
                    chain.isComplete = true;
                    break; // Stop adding elements for this chain
                }
            }
        }

        return chain;
    };

    /**
     * Check if an element continues the word sequence
     */
    const checkIfContinuesSequence = (candidate, coveredPositions, sentenceWords, anchor) => {
        // Element must have good spatial proximity (already filtered by distance)
        const spatialThreshold = 80; // pixels
        if (candidate.distanceFromAnchor > spatialThreshold) {
            return false;
        }

        // Element must have reasonable consumption quality
        if ((candidate.consumption_ratio || 0) < 0.1) {
            return false;
        }

        // Element should have words that logically follow the covered positions
        const candidatePositions = candidate.wordPositions;
        const maxCoveredPosition = Math.max(...Array.from(coveredPositions));
        const minCoveredPosition = Math.min(...Array.from(coveredPositions));

        // Check if candidate has words that extend the sequence
        const extendsSequence = candidatePositions.some(pos => 
            pos > maxCoveredPosition || // Continues forward
            pos < minCoveredPosition    // Fills in backward
        );

        // Or fills gaps in the sequence
        const fillsGaps = candidatePositions.some(pos => 
            pos > minCoveredPosition && pos < maxCoveredPosition && !coveredPositions.has(pos)
        );

        return extendsSequence || fillsGaps;
    };

    /**
     * Select best elements from all chains
     */
    const selectBestSequentialElements = (chains, sentenceWords) => {
        if (chains.length === 0) return [];

        // Rank chains by quality
        const rankedChains = chains
            .map(chain => ({
                ...chain,
                chainScore: calculateChainScore(chain, sentenceWords)
            }))
            .sort((a, b) => b.chainScore - a.chainScore);

        log(`📊 Chain rankings:`);
        rankedChains.forEach((chain, index) => {
            log(`   ${index + 1}. Score: ${chain.chainScore.toFixed(3)}, Coverage: ${(chain.totalCoverage * 100).toFixed(1)}%, Elements: ${chain.elements.length}`);
        });

        // Select elements from the best chain(s)
        const selectedElements = [];
        const usedElements = new Set();

        // Always include the best chain
        if (rankedChains.length > 0) {
            const bestChain = rankedChains[0];
            bestChain.elements.forEach(element => {
                if (!usedElements.has(element.stable_index)) {
                    selectedElements.push(element);
                    usedElements.add(element.stable_index);
                }
            });

            log(`✅ Selected best chain with ${bestChain.elements.length} elements (score: ${bestChain.chainScore.toFixed(3)})`);
        }

        return selectedElements;
    };

    /**
     * Calculate overall score for a chain
     */
    const calculateChainScore = (chain, sentenceWords) => {
        const coverageWeight = 0.4;
        const sequentialWeight = 0.3;
        const anchorWeight = 0.2;
        const completenessWeight = 0.1;

        const coverageScore = chain.totalCoverage;
        const sequentialScore = chain.averageSequentialScore;
        const anchorScore = chain.anchorElement.isAnchor ? 1.0 : 0.0;
        const completenessScore = chain.isComplete ? 1.0 : 0.0;

        return (coverageScore * coverageWeight) +
               (sequentialScore * sequentialWeight) +
               (anchorScore * anchorWeight) +
               (completenessScore * completenessWeight);
    };

    /**
     * Calculate spatial distance between two elements
     */
    const calculateSpatialDistance = (element1, element2) => {
        const coords1 = element1.coordinates;
        const coords2 = element2.coordinates;

        const center1 = {
            x: coords1.x + coords1.width / 2,
            y: coords1.y + coords1.height / 2
        };
        const center2 = {
            x: coords2.x + coords2.width / 2,
            y: coords2.y + coords2.height / 2
        };

        const dx = center1.x - center2.x;
        const dy = center1.y - center2.y;
        
        return Math.sqrt(dx * dx + dy * dy);
    };

    // Include the other utility functions from previous implementation
    // (applySpatialConsumptionFiltering, createSpatiallyCoherentGroups, etc.)
    
    const applySpatialConsumptionFiltering = (stableElements, sentenceText, sentenceId) => {
        // Use the same logic from the previous spatial-consumption highlighter
        // This is the existing logic that works well
        
        if (!stableElements || !sentenceText) return [];

        const sentenceWords = new Set(
            sentenceText.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 2)
        );

        const filteredElements = stableElements.filter(element => {
            if (!element.words_consumed || !element.consumption_ratio) {
                return false;
            }

            if (element.consumption_ratio < 0.1) {
                return false;
            }

            const consumedWords = Array.isArray(element.words_consumed) 
                ? element.words_consumed 
                : [];

            const relevantConsumedWords = consumedWords.filter(word => 
                sentenceWords.has(word.toLowerCase())
            );

            if (relevantConsumedWords.length === 0) {
                return false;
            }

            const wordRelevanceRatio = relevantConsumedWords.length / consumedWords.length;
            if (element.consumption_ratio > 0.5 && wordRelevanceRatio < 0.5) {
                return false;
            }

            return true;
        });

        filteredElements.sort((a, b) => b.consumption_ratio - a.consumption_ratio);
        return filteredElements;
    };

    const createSpatiallyCoherentGroups = (elements, sentenceText) => {
        if (elements.length === 0) return [];

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
            const maxGroupDistance = 60;

            if (distance <= maxGroupDistance) {
                currentGroup.elements.push(current);
                currentGroup.avgConsumption = 
                    (currentGroup.avgConsumption * (currentGroup.elements.length - 1) + 
                     (current.consumption_ratio || 0)) / currentGroup.elements.length;
                currentGroup.totalRelevantWords += (current.relevantWords || []).length;
            } else {
                groups.push(currentGroup);
                currentGroup = {
                    elements: [current],
                    avgConsumption: current.consumption_ratio || 0,
                    totalRelevantWords: (current.relevantWords || []).length,
                    spatialCohesion: 1.0
                };
            }
        }

        groups.push(currentGroup);
        return groups;
    };

    const createHighlightFromSpatialGroup = async (spatialGroup, sentenceId, sentenceText) => {
        if (!containerRef?.current || spatialGroup.elements.length === 0) return null;

        try {
            const textElements = spatialGroup.elements
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) {
                return null;
            }

            const highlightElement = createHighlightFromTextElements(
                textElements, 
                sentenceId, 
                spatialGroup,
                sentenceText
            );

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                const highlightKey = `sequential_${sentenceId}_${spatialGroup.elements[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    spatialGroup: spatialGroup,
                    textElements: textElements,
                    type: 'sequential_word_order'
                });

                return highlightElement;
            }

        } catch (error) {
            log('❌ Error creating highlight from spatial group:', error);
        }

        return null;
    };

    const createHighlightFromTextElements = (textElements, sentenceId, spatialGroup, sentenceText) => {
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

            if (width <= 0 || height <= 0) {
                return null;
            }

            // Enhanced styling based on sequential analysis
            const groupStyle = getSequentialGroupStyle(spatialGroup);

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

            // Enhanced tooltip
            const hasAnchor = spatialGroup.elements.some(el => el.isAnchor);
            const avgSequentialScore = spatialGroup.elements.reduce((sum, el) => 
                sum + (el.sequentialScore || 0), 0) / spatialGroup.elements.length;

            highlightDiv.title = `
Sentence: ${sentenceId}
Text: "${sentenceText.substring(0, 60)}..."
Sequential Score: ${(avgSequentialScore * 100).toFixed(1)}%
Has Anchor: ${hasAnchor ? 'Yes' : 'No'}
Avg Consumption: ${(spatialGroup.avgConsumption * 100).toFixed(1)}%
Elements: ${spatialGroup.elements.length}
            `.trim();

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight from text elements:', error);
            return null;
        }
    };

    const getSequentialGroupStyle = (spatialGroup) => {
        const hasAnchor = spatialGroup.elements.some(el => el.isAnchor);
        const avgSequentialScore = spatialGroup.elements.reduce((sum, el) => 
            sum + (el.sequentialScore || 0), 0) / spatialGroup.elements.length;

        if (hasAnchor && avgSequentialScore >= 0.7) {
            return {
                backgroundColor: 'rgba(76, 175, 80, 0.4)',   // Green - excellent sequential match
                border: '2px solid rgba(76, 175, 80, 0.8)',
                label: 'SEQUENTIAL MATCH'
            };
        } else if (avgSequentialScore >= 0.5) {
            return {
                backgroundColor: 'rgba(255, 193, 7, 0.4)',    // Yellow - good match
                border: '2px solid rgba(255, 193, 7, 0.8)',
                label: 'GOOD SEQUENCE'
            };
        } else {
            return {
                backgroundColor: 'rgba(255, 152, 0, 0.4)',    // Orange - basic match
                border: '2px solid rgba(255, 152, 0, 0.8)',
                label: 'BASIC MATCH'
            };
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
        log('🧹 Cleared all sequential word order highlights');
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

export default NewWordOrderHighlighter;