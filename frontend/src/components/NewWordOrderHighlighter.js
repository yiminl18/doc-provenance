import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';
import { useAppState } from '../contexts/AppStateContext';

const NewWordOrderHighlighter = ({
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
            console.log(`[NewWordOrder] ${message}`, ...args);
        }
    };

    useEffect(() => {
        if (lastProcessedQuestionRef.current && lastProcessedQuestionRef.current !== activeQuestionId) {
            log('🧹 Question changed, clearing all highlights');
            clearAllHighlights();
            lastProcessedProvenanceRef.current = null;
        }
        lastProcessedQuestionRef.current = activeQuestionId;
    }, [activeQuestionId]);

    useEffect(() => {
        const currentProvenanceId = selectedProvenance?.provenance_id;
        
        if (lastProcessedProvenanceRef.current === currentProvenanceId) {
            log('⚪ Same provenance, skipping processing');
            return;
        }

        if (activeQuestionId || selectedProvenance?.provenance_ids) {
            log(`🆔 Processing new provenance for question ${activeQuestionId}`);
            lastProcessedProvenanceRef.current = currentProvenanceId;
        } else {
            log('🧹 No provenance, clearing highlights');
            clearAllHighlights();
            lastProcessedProvenanceRef.current = null;
        }
    }, [activeQuestionId, selectedProvenance?.provenance_id]);

    // Main highlighting effect
    useEffect(() => {
        if (!provenanceData?.provenance_ids || !documentFilename || !pdfDocument) {
            log('⏸️ Missing required data for highlighting');
            clearAllHighlights();
            return;
        }

        const sentenceIds = selectedProvenance.provenance_ids || [];
        log(`🎯 Enhanced word order highlighting for sentences:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();

                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                await createEnhancedWordOrderHighlights(stableMappings);

            } catch (error) {
                console.error('[EnhancedWordOrder] Error during highlighting:', error);
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

    /**
     * FIXED: Enhanced highlighting that balances content coverage with sequential analysis
     */
    const createEnhancedWordOrderHighlights = async (stableMappings) => {
        if (!highlightLayerRef?.current) {
            log('❌ Highlight layer not available');
            return;
        }

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
            log(`\n🔍 Analyzing sentence ${sentenceId}: "${mapping.sentence_text.substring(0, 80)}..."`);
            
            // Step 1: Basic filtering (consumption + word relevance)
            const basicFilteredElements = applyBasicFiltering(
                mapping.stable_elements, 
                mapping.sentence_text,
                sentenceId
            );

            if (basicFilteredElements.length === 0) {
                log(`⚠️ No elements passed basic filtering for sentence ${sentenceId}`);
                continue;
            }

            log(`✅ ${basicFilteredElements.length} elements passed basic filtering`);

            // Step 2: Enhanced analysis with content priority
            const analyzedElements = analyzeElementsWithContentPriority(
                basicFilteredElements,
                mapping.sentence_text,
                sentenceId
            );

            // Step 3: Select best elements using hybrid approach
            const selectedElements = selectElementsWithHybridApproach(
                analyzedElements,
                mapping.sentence_text,
                sentenceId
            );

            if (selectedElements.length === 0) {
                log(`⚠️ No elements selected for sentence ${sentenceId}`);
                continue;
            }

            log(`✅ Selected ${selectedElements.length} elements for highlighting`);

            // Step 4: Create spatially-coherent groups
            const spatialGroups = createSpatiallyCoherentGroups(selectedElements, mapping.sentence_text);

            // Step 5: Create highlights
            for (const group of spatialGroups) {
                const highlight = await createHighlightFromSpatialGroup(group, sentenceId, mapping.sentence_text);
                
                if (highlight) {
                    highlightCount++;
                    log(`✨ Created highlight for sentence ${sentenceId}, group of ${group.elements.length} elements`);
                }
            }
        }

        log(`✅ Created ${highlightCount} enhanced highlights on page ${currentPage}`);
    };

    /**
     * Basic filtering: consumption ratio + word relevance
     */
    const applyBasicFiltering = (stableElements, sentenceText, sentenceId) => {
        if (!stableElements || !sentenceText) return [];

        const sentenceWords = new Set(
            sentenceText.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(word => word.length > 1) // Allow shorter words
        );

        const filteredElements = stableElements.filter(element => {
            // Must have words and consumption data
            if (!element.words_consumed || !element.consumption_ratio) {
                return false;
            }

            // Lower consumption threshold to catch more content
            if (element.consumption_ratio < 0.05) {
                return false;
            }

            const consumedWords = Array.isArray(element.words_consumed) 
                ? element.words_consumed 
                : [];

            const relevantConsumedWords = consumedWords.filter(word => 
                sentenceWords.has(word.toLowerCase())
            );

            // Must have at least one relevant word
            if (relevantConsumedWords.length === 0) {
                return false;
            }

            // Store for later analysis
            element.relevantWords = relevantConsumedWords;
            element.wordRelevanceRatio = relevantConsumedWords.length / Math.max(consumedWords.length, 1);

            return true;
        });

        log(`🔍 Basic filtering: ${filteredElements.length}/${stableElements.length} elements passed (${sentenceWords.size} sentence words)`);
        return filteredElements;
    };

    /**
     * FIXED: Analyze elements with content coverage priority
     */
    const analyzeElementsWithContentPriority = (elements, sentenceText, sentenceId) => {
        const sentenceWords = extractSentenceWordsWithPositions(sentenceText);
        
        return elements.map(element => {
            const analysis = analyzeElementContentCoverage(element, sentenceWords);
            
            // Log detailed analysis for debugging
            if (element.relevantWords && element.relevantWords.length > 3) {
                log(`🔍 Element ${element.stable_index}: "${element.text?.substring(0, 40)}..." - Score: ${analysis.contentScore.toFixed(3)}, Words: [${element.relevantWords.join(', ')}]`);
            }
            
            return {
                ...element,
                ...analysis
            };
        });
    };

    /**
     * Analyze element for content coverage (prioritizes substantial content)
     */
    const analyzeElementContentCoverage = (element, sentenceWords) => {
        const consumedWords = element.words_consumed || [];
        const relevantWords = element.relevantWords || [];

        // Map words to sentence positions
        const wordPositions = relevantWords.map(word => {
            const sentenceWord = sentenceWords.find(sw => sw.word === word.toLowerCase());
            return sentenceWord ? sentenceWord.position : -1;
        }).filter(pos => pos >= 0).sort((a, b) => a - b);

        // Calculate content metrics
        const contentCoverage = relevantWords.length / sentenceWords.length;
        const consumptionQuality = element.consumption_ratio || 0;
        const wordRelevanceRatio = element.wordRelevanceRatio || 0;
        
        // Check for important content indicators
        const hasSubstantialContent = relevantWords.length >= 3;
        const hasImportantWords = relevantWords.some(word => 
            ['must', 'shall', 'required', 'within', 'days', 'form', 'received', 'signature'].includes(word.toLowerCase())
        );
        
        // Position analysis
        const hasFirstWord = wordPositions.length > 0 && wordPositions[0] === 0;
        const hasLastWord = wordPositions.length > 0 && wordPositions[wordPositions.length - 1] === sentenceWords.length - 1;
        const orderConsistency = calculateWordOrderConsistency(wordPositions);

        // Calculate comprehensive content score
        let contentScore = 0;
        
        // Heavy weight on content coverage and quality
        contentScore += contentCoverage * 0.4;
        contentScore += consumptionQuality * 0.2;
        contentScore += wordRelevanceRatio * 0.1;
        
        // Bonus for substantial content
        if (hasSubstantialContent) contentScore += 0.15;
        if (hasImportantWords) contentScore += 0.1;
        
        // Bonus for position (but not required)
        if (hasFirstWord) contentScore += 0.03;
        if (hasLastWord) contentScore += 0.02;
        
        // Categorize element
        const isHighContent = hasSubstantialContent && contentCoverage >= 0.15;
        const isAnchor = hasFirstWord || hasLastWord;
        const isImportant = hasImportantWords || contentCoverage >= 0.2;

        return {
            relevantWords,
            wordPositions,
            contentCoverage,
            hasSubstantialContent,
            hasImportantWords,
            hasFirstWord,
            hasLastWord,
            orderConsistency,
            contentScore: Math.min(1.0, contentScore),
            isHighContent,
            isAnchor,
            isImportant
        };
    };

    /**
     * FIXED: Hybrid selection approach - prioritizes content while considering sequence
     */
    const selectElementsWithHybridApproach = (analyzedElements, sentenceText, sentenceId) => {
        // Sort by content score (descending)
        const sortedByContent = [...analyzedElements].sort((a, b) => b.contentScore - a.contentScore);
        
        log(`📊 Top elements by content score:`);
        sortedByContent.slice(0, 5).forEach((el, i) => {
            log(`   ${i + 1}. Score: ${el.contentScore.toFixed(3)} | Words: ${el.relevantWords.length} | Text: "${el.text?.substring(0, 30)}..."`);
        });

        const candidateElements = [];
        
        // Strategy 1: Always include high-content elements (regardless of position)
        const highContentElements = sortedByContent.filter(el => el.isHighContent);
        highContentElements.forEach(el => {
            if (!candidateElements.find(selected => selected.stable_index === el.stable_index)) {
                candidateElements.push(el);
                log(`✅ Candidate high-content element: "${el.text?.substring(0, 30)}..." (score: ${el.contentScore.toFixed(3)})`);
            }
        });

        // Strategy 2: Include anchor elements if they have decent content
        const anchorElements = sortedByContent.filter(el => 
            el.isAnchor && el.contentScore >= 0.2 && !candidateElements.find(s => s.stable_index === el.stable_index)
        );
        anchorElements.forEach(el => {
            candidateElements.push(el);
            log(`✅ Candidate anchor element: "${el.text?.substring(0, 30)}..." (score: ${el.contentScore.toFixed(3)})`);
        });

        // Strategy 3: Fill remaining with next highest scoring elements
        const remainingElements = sortedByContent.filter(el => 
            !candidateElements.find(s => s.stable_index === el.stable_index) && 
            el.contentScore >= 0.15 // Reasonable threshold
        );

        const maxTotalElements = 12; // Allow more candidates for reading order filter
        const remainingSlots = Math.max(0, maxTotalElements - candidateElements.length);
        
        remainingElements.slice(0, remainingSlots).forEach(el => {
            candidateElements.push(el);
            log(`✅ Candidate additional element: "${el.text?.substring(0, 30)}..." (score: ${el.contentScore.toFixed(3)})`);
        });

        log(`🎯 Initial candidates: ${candidateElements.length} elements`);
        
        // NEW: Apply reading order filter with sentence coverage tracking
        const finalSelectedElements = applyReadingOrderCoverageFilter(candidateElements, sentenceText, sentenceId);
        
        log(`🎯 Final selection after reading order filter: ${finalSelectedElements.length} elements`);
        
        return finalSelectedElements;
    };

    /**
     * NEW: Apply reading order filter with cumulative sentence coverage tracking
     */
    const applyReadingOrderCoverageFilter = (candidateElements, sentenceText, sentenceId) => {
        log(`\n📖 Applying reading order coverage filter for sentence ${sentenceId}`);
        
        // Get sentence words for tracking coverage
        const sentenceWords = extractSentenceWordsWithPositions(sentenceText);
        const totalSentenceWords = sentenceWords.length;
        
        // Sort candidates by reading order (top-to-bottom, left-to-right)
        const sortedByReadingOrder = [...candidateElements].sort((a, b) => {
            const yDiff = a.coordinates.y - b.coordinates.y;
            if (Math.abs(yDiff) > 5) return yDiff; // Different lines
            return a.coordinates.x - b.coordinates.x; // Same line, left-to-right
        });

        log(`📍 Elements in reading order:`);
        sortedByReadingOrder.forEach((el, i) => {
            log(`   ${i + 1}. Y:${Math.round(el.coordinates.y)} X:${Math.round(el.coordinates.x)} | "${el.text?.substring(0, 25)}..." | Words: [${el.relevantWords.join(', ')}]`);
        });

        // Track cumulative sentence coverage
        const coveredWordPositions = new Set();
        const selectedElements = [];
        let cumulativeCoverage = 0;
        
        // Coverage thresholds
        const EXCELLENT_COVERAGE_THRESHOLD = 0.8;  // 80% of sentence covered
        const GOOD_COVERAGE_THRESHOLD = 0.6;       // 60% of sentence covered
        const DIMINISHING_RETURNS_THRESHOLD = 0.05; // Don't add elements that contribute <5% new coverage

        for (const element of sortedByReadingOrder) {
            // Calculate what new coverage this element would add
            const elementWordPositions = new Set(element.wordPositions);
            const newWordPositions = [...elementWordPositions].filter(pos => !coveredWordPositions.has(pos));
            const newCoverageContribution = newWordPositions.length / totalSentenceWords;
            
            // Calculate current coverage before adding this element
            const currentCoverage = coveredWordPositions.size / totalSentenceWords;
            
            log(`🔍 Evaluating element: "${element.text?.substring(0, 25)}..."`);
            log(`   Current coverage: ${(currentCoverage * 100).toFixed(1)}%`);
            log(`   New contribution: ${(newCoverageContribution * 100).toFixed(1)}% (${newWordPositions.length} new words)`);
            log(`   Element score: ${element.contentScore.toFixed(3)}`);

            // Decision logic for inclusion
            let shouldInclude = false;
            let reason = '';

            // Always include high-value elements if we haven't hit excellent coverage
            if (element.contentScore >= 0.6 && currentCoverage < EXCELLENT_COVERAGE_THRESHOLD) {
                shouldInclude = true;
                reason = 'High-value element below excellent coverage threshold';
            }
            // Include anchor elements if they contribute meaningfully
            else if (element.isAnchor && newCoverageContribution >= DIMINISHING_RETURNS_THRESHOLD) {
                shouldInclude = true;
                reason = 'Anchor element with meaningful contribution';
            }
            // Include elements that make significant coverage contributions
            else if (newCoverageContribution >= 0.15) { // 15% or more new coverage
                shouldInclude = true;
                reason = 'Significant coverage contribution';
            }
            // Include moderate contributors if we're still below good coverage
            else if (currentCoverage < GOOD_COVERAGE_THRESHOLD && newCoverageContribution >= DIMINISHING_RETURNS_THRESHOLD) {
                shouldInclude = true;
                reason = 'Moderate contribution below good coverage threshold';
            }
            // Skip elements with diminishing returns
            else if (newCoverageContribution < DIMINISHING_RETURNS_THRESHOLD) {
                reason = `Diminishing returns (${(newCoverageContribution * 100).toFixed(1)}% < ${(DIMINISHING_RETURNS_THRESHOLD * 100)}%)`;
            }
            // Skip if we already have excellent coverage
            else if (currentCoverage >= EXCELLENT_COVERAGE_THRESHOLD) {
                reason = `Excellent coverage already achieved (${(currentCoverage * 100).toFixed(1)}%)`;
            }
            else {
                reason = 'Below inclusion thresholds';
            }

            if (shouldInclude) {
                selectedElements.push(element);
                
                // Update coverage tracking
                newWordPositions.forEach(pos => coveredWordPositions.add(pos));
                cumulativeCoverage = coveredWordPositions.size / totalSentenceWords;
                
                log(`   ✅ INCLUDED: ${reason}`);
                log(`   📊 New cumulative coverage: ${(cumulativeCoverage * 100).toFixed(1)}%`);
                
                // Early termination if we have excellent coverage and enough elements
                if (cumulativeCoverage >= EXCELLENT_COVERAGE_THRESHOLD && selectedElements.length >= 3) {
                    log(`   🎯 Excellent coverage achieved with ${selectedElements.length} elements, stopping early`);
                    break;
                }
            } else {
                log(`   ❌ SKIPPED: ${reason}`);
            }
        }

        log(`\n📊 Reading order filter summary:`);
        log(`   Candidates processed: ${sortedByReadingOrder.length}`);
        log(`   Elements selected: ${selectedElements.length}`);
        log(`   Final coverage: ${(cumulativeCoverage * 100).toFixed(1)}%`);
        log(`   Covered word positions: ${Array.from(coveredWordPositions).sort((a,b) => a-b).join(', ')}`);

        return selectedElements;
    };

    // Utility functions (keeping existing ones)
    const extractSentenceWordsWithPositions = (sentenceText) => {
        return sentenceText.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1)
            .map((word, index, array) => ({ 
                word, 
                position: index, 
                isFirst: index === 0,
                isLast: index === array.length - 1
            }));
    };

    const calculateWordOrderConsistency = (positions) => {
        if (positions.length <= 1) return 1;

        let correctTransitions = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i] > positions[i-1]) {
                correctTransitions++;
            }
        }

        return correctTransitions / (positions.length - 1);
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
            avgContentScore: sortedElements[0].contentScore || 0,
            spatialCohesion: 1.0
        };

        for (let i = 1; i < sortedElements.length; i++) {
            const current = sortedElements[i];
            const lastInGroup = currentGroup.elements[currentGroup.elements.length - 1];

            const distance = calculateSpatialDistance(lastInGroup, current);
            const maxGroupDistance = 60;

            if (distance <= maxGroupDistance) {
                currentGroup.elements.push(current);
                const len = currentGroup.elements.length;
                currentGroup.avgConsumption = 
                    (currentGroup.avgConsumption * (len - 1) + (current.consumption_ratio || 0)) / len;
                currentGroup.avgContentScore = 
                    (currentGroup.avgContentScore * (len - 1) + (current.contentScore || 0)) / len;
                currentGroup.totalRelevantWords += (current.relevantWords || []).length;
            } else {
                groups.push(currentGroup);
                currentGroup = {
                    elements: [current],
                    avgConsumption: current.consumption_ratio || 0,
                    avgContentScore: current.contentScore || 0,
                    totalRelevantWords: (current.relevantWords || []).length,
                    spatialCohesion: 1.0
                };
            }
        }

        groups.push(currentGroup);
        return groups;
    };

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

                const highlightKey = `enhanced_${sentenceId}_${spatialGroup.elements[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    spatialGroup: spatialGroup,
                    textElements: textElements,
                    type: 'enhanced_word_order'
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

            // Enhanced styling based on content analysis
            const groupStyle = getEnhancedGroupStyle(spatialGroup);

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

            // Enhanced tooltip with content analysis
            const hasHighContent = spatialGroup.elements.some(el => el.isHighContent);
            const avgContentScore = spatialGroup.avgContentScore || 0;

            highlightDiv.title = `
Sentence: ${sentenceId}
Text: "${sentenceText.substring(0, 60)}..."
Content Score: ${(avgContentScore * 100).toFixed(1)}%
High Content: ${hasHighContent ? 'Yes' : 'No'}
Total Words: ${spatialGroup.totalRelevantWords}
Elements: ${spatialGroup.elements.length}
            `.trim();

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight from text elements:', error);
            return null;
        }
    };

    const getEnhancedGroupStyle = (spatialGroup) => {
        const hasHighContent = spatialGroup.elements.some(el => el.isHighContent);
        const avgContentScore = spatialGroup.avgContentScore || 0;

        if (hasHighContent && avgContentScore >= 0.6) {
            return {
                backgroundColor: 'rgba(76, 175, 80, 0.4)',   // Green - excellent content match
                border: '2px solid rgba(76, 175, 80, 0.8)'
            };
        } else if (avgContentScore >= 0.4) {
            return {
                backgroundColor: 'rgba(255, 193, 7, 0.4)',    // Yellow - good content match
                border: '2px solid rgba(255, 193, 7, 0.8)'
            };
        } else {
            return {
                backgroundColor: 'rgba(255, 152, 0, 0.4)',    // Orange - basic match
                border: '2px solid rgba(255, 152, 0, 0.8)'
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
        log('🧹 Cleared all enhanced highlights');
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