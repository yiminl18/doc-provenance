/**
 * Smart Sequence Highlighter
 * 
 * Combines multiple strategies to achieve optimal sentence highlighting:
 * 1. Word sequence matching with gap tolerance
 * 2. Spatial continuity analysis
 * 3. Content completeness verification
 * 4. Reading order preservation
 */

import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';
import { useAppState } from '../contexts/AppStateContext';

const DirectTextHighlighter = ({
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
    className = 'smart-sequence-highlight',
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
            console.log(`[DirectText] ${message}`, ...args);
        }
    };

    // Clear highlights when question changes
    useEffect(() => {
        if (lastProcessedQuestionRef.current && lastProcessedQuestionRef.current !== activeQuestionId) {
            log('🧹 Question changed, clearing highlights');
            clearAllHighlights();
            lastProcessedProvenanceRef.current = null;
        }
        lastProcessedQuestionRef.current = activeQuestionId;
    }, [activeQuestionId]);

    // Process provenance changes
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
        log(`🎯 Smart sequence highlighting for sentences:`, sentenceIds);

        const performHighlighting = async () => {
            try {
                clearAllHighlights();
                const stableMappings = await getStableMappings(sentenceIds);

                if (!stableMappings) {
                    log('❌ No stable mappings found');
                    return;
                }

                await createSmartSequenceHighlights(stableMappings);

            } catch (error) {
                console.error('[SmartSequence] Error during highlighting:', error);
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
     * Main highlighting logic using smart sequence matching
     */
    const createSmartSequenceHighlights = async (stableMappings) => {
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
            log(`\n🔍 Smart sequence analysis for sentence ${sentenceId}:`);
            log(`📝 Target: "${mapping.sentence_text}"`);
            
            // Find the best sequence match for this sentence
            const sequenceMatch = findBestSequenceMatch(
                mapping.stable_elements, 
                mapping.sentence_text,
                sentenceId
            );

            if (!sequenceMatch || sequenceMatch.elements.length === 0) {
                log(`⚠️ No sequence match found for sentence ${sentenceId}`);
                continue;
            }

            log(`✅ Found sequence match with ${sequenceMatch.elements.length} elements`);
            log(`📊 Match quality: ${sequenceMatch.quality.toFixed(3)} | Coverage: ${(sequenceMatch.coverage * 100).toFixed(1)}%`);

            // Create highlights from the sequence
            const spatialGroups = createSpatialGroups(sequenceMatch.elements);
            
            for (const group of spatialGroups) {
                const highlight = await createHighlight(group, sentenceId, mapping.sentence_text, sequenceMatch);
                if (highlight) {
                    highlightCount++;
                }
            }
        }

        log(`✅ Created ${highlightCount} smart sequence highlights on page ${currentPage}`);
    };

    /**
     * Find the best contiguous sequence that matches the target sentence
     */
    const findBestSequenceMatch = (stableElements, sentenceText, sentenceId) => {
        log(`🎯 Finding best sequence match for: "${sentenceText}"`);

        // Normalize and tokenize the target sentence
        const targetWords = normalizeAndTokenize(sentenceText);
        log(`📝 Target words (${targetWords.length}): [${targetWords.join(', ')}]`);

        // Prepare elements with normalized text and word analysis
        const analyzedElements = analyzeElements(stableElements, targetWords);
        
        if (analyzedElements.length === 0) {
            log(`❌ No elements have relevant words`);
            return null;
        }

        log(`📊 ${analyzedElements.length} elements contain relevant words`);

        // Find all possible sequence candidates
        const sequenceCandidates = findSequenceCandidates(analyzedElements, targetWords);
        
        if (sequenceCandidates.length === 0) {
            log(`❌ No sequence candidates found`);
            return null;
        }

        log(`🔍 Found ${sequenceCandidates.length} sequence candidates`);

        // Evaluate and select the best sequence
        const bestSequence = selectBestSequence(sequenceCandidates, targetWords);
        
        if (!bestSequence) {
            log(`❌ No best sequence selected`);
            return null;
        }

        log(`🏆 Best sequence selected:`);
        log(`   Elements: ${bestSequence.elements.length}`);
        log(`   Coverage: ${(bestSequence.coverage * 100).toFixed(1)}%`);
        log(`   Quality: ${bestSequence.quality.toFixed(3)}`);
        log(`   Text: "${bestSequence.elements.map(el => el.text).join(' ')}"`);

        return bestSequence;
    };

    /**
     * Normalize text and split into meaningful tokens
     */
    const normalizeAndTokenize = (text) => {
        return text
            .toLowerCase()
            .replace(/[^\w\s\-\.]/g, ' ')  // Keep hyphens and periods
            .split(/\s+/)
            .filter(word => word.length > 0)
            .map(word => word.replace(/[^\w]/g, '')); // Clean individual words
    };

    /**
     * Analyze elements for word content and matching potential
     */
    const analyzeElements = (stableElements, targetWords) => {
        const targetWordSet = new Set(targetWords);
        
        return stableElements
            .map(element => {
                const elementWords = normalizeAndTokenize(element.text || '');
                const matchingWords = elementWords.filter(word => targetWordSet.has(word));
                
                if (matchingWords.length === 0) return null;

                // Calculate word coverage and position information
                const wordCoverage = matchingWords.length / targetWords.length;
                const elementDensity = matchingWords.length / Math.max(elementWords.length, 1);
                
                // Find positions of matching words in target sentence
                const wordPositions = matchingWords.map(word => {
                    return targetWords.findIndex(targetWord => targetWord === word);
                }).filter(pos => pos !== -1).sort((a, b) => a - b);

                return {
                    ...element,
                    elementWords,
                    matchingWords,
                    wordCoverage,
                    elementDensity,
                    wordPositions,
                    hasStartWord: wordPositions.includes(0),
                    hasEndWord: wordPositions.includes(targetWords.length - 1),
                    relevanceScore: calculateRelevanceScore(
                        matchingWords.length,
                        elementWords.length,
                        targetWords.length,
                        wordPositions
                    )
                };
            })
            .filter(element => element !== null)
            .sort((a, b) => (a.stable_index || 0) - (b.stable_index || 0)); // Sort by reading order
    };

    /**
     * Calculate relevance score for an element
     */
    const calculateRelevanceScore = (matchingWordCount, elementWordCount, targetWordCount, wordPositions) => {
        const coverage = matchingWordCount / targetWordCount;
        const density = matchingWordCount / Math.max(elementWordCount, 1);
        const efficiency = Math.min(1.0, matchingWordCount / Math.max(elementWordCount, 1));
        
        // Bonus for positional importance (start/end words)
        const hasKeyPositions = wordPositions.includes(0) || wordPositions.includes(targetWordCount - 1);
        const positionBonus = hasKeyPositions ? 0.1 : 0;
        
        // Penalty for very verbose elements (likely false matches)
        const verbosityPenalty = elementWordCount > 10 ? 0.1 : 0;
        
        return Math.min(1.0, coverage * 0.4 + density * 0.3 + efficiency * 0.2 + positionBonus - verbosityPenalty);
    };

    /**
     * Find all possible sequence candidates using sliding window approach
     */
    const findSequenceCandidates = (analyzedElements, targetWords) => {
        const candidates = [];
        const minSequenceLength = 1;
        const maxSequenceLength = Math.min(15, analyzedElements.length);
        
        // Try sequences of different lengths starting from different positions
        for (let startIdx = 0; startIdx < analyzedElements.length; startIdx++) {
            for (let length = minSequenceLength; length <= maxSequenceLength; length++) {
                if (startIdx + length > analyzedElements.length) break;
                
                const sequence = analyzedElements.slice(startIdx, startIdx + length);
                const candidate = evaluateSequenceCandidate(sequence, targetWords);
                
                if (candidate && candidate.quality >= 0.2) { // Minimum quality threshold
                    candidates.push(candidate);
                }
            }
        }
        
        // Also try smart growth: start with best elements and grow
        const smartGrowthCandidates = findSmartGrowthCandidates(analyzedElements, targetWords);
        candidates.push(...smartGrowthCandidates);
        
        return candidates;
    };

    /**
     * Evaluate a sequence candidate for quality and coverage
     */
    const evaluateSequenceCandidate = (sequence, targetWords) => {
        if (sequence.length === 0) return null;

        // Collect all matching words from the sequence
        const allMatchingWords = [];
        const wordPositionsCovered = new Set();
        
        sequence.forEach(element => {
            element.matchingWords.forEach(word => {
                allMatchingWords.push(word);
                const position = targetWords.findIndex(targetWord => targetWord === word);
                if (position !== -1) {
                    wordPositionsCovered.add(position);
                }
            });
        });

        // Calculate metrics
        const uniqueWordsMatched = new Set(allMatchingWords).size;
        const coverage = uniqueWordsMatched / targetWords.length;
        const elementCount = sequence.length;
        
        // Calculate spatial coherence (elements should be reasonably close)
        const spatialCoherence = calculateSpatialCoherence(sequence);
        
        // Calculate reading order consistency
        const readingOrderConsistency = calculateReadingOrderConsistency(sequence);
        
        // Calculate word order preservation
        const wordOrderPreservation = calculateWordOrderPreservation(sequence, targetWords);
        
        // Calculate completeness (prefer sequences that include start/end)
        const hasStart = sequence.some(el => el.hasStartWord);
        const hasEnd = sequence.some(el => el.hasEndWord);
        const completeness = (hasStart ? 0.2 : 0) + (hasEnd ? 0.2 : 0) + (coverage * 0.6);
        
        // Calculate efficiency (good coverage with fewer elements is better)
        const efficiency = coverage / Math.max(elementCount / 5, 1); // Normalize by expected element count
        
        // Overall quality score
        const quality = (
            coverage * 0.35 +
            spatialCoherence * 0.20 +
            readingOrderConsistency * 0.15 +
            wordOrderPreservation * 0.15 +
            completeness * 0.10 +
            efficiency * 0.05
        );

        return {
            elements: sequence,
            coverage,
            quality,
            spatialCoherence,
            readingOrderConsistency,
            wordOrderPreservation,
            completeness,
            efficiency,
            uniqueWordsMatched,
            elementCount,
            hasStart,
            hasEnd,
            matchedText: sequence.map(el => el.text).join(' ')
        };
    };

    /**
     * Find candidates using smart growth strategy
     */
    const findSmartGrowthCandidates = (analyzedElements, targetWords) => {
        const candidates = [];
        
        // Start with the best individual elements
        const sortedByRelevance = [...analyzedElements].sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        // Try growing sequences from top elements
        for (let i = 0; i < Math.min(3, sortedByRelevance.length); i++) {
            const seed = sortedByRelevance[i];
            const grownSequence = growSequenceFromSeed(seed, analyzedElements, targetWords);
            
            if (grownSequence) {
                candidates.push(grownSequence);
            }
        }
        
        return candidates;
    };

    /**
     * Grow a sequence starting from a seed element
     */
    const growSequenceFromSeed = (seed, allElements, targetWords) => {
        const sequence = [seed];
        const coveredWords = new Set(seed.matchingWords);
        const seedIndex = allElements.findIndex(el => el.stable_index === seed.stable_index);
        
        if (seedIndex === -1) return null;
        
        // Grow in both directions
        const maxGrowth = 8; // Limit growth to prevent over-expansion
        
        // Grow backwards
        for (let i = seedIndex - 1; i >= 0 && sequence.length < maxGrowth; i--) {
            const candidate = allElements[i];
            if (shouldAddToSequence(candidate, sequence, coveredWords, targetWords)) {
                sequence.unshift(candidate);
                candidate.matchingWords.forEach(word => coveredWords.add(word));
            } else if (sequence.length > 1) {
                break; // Stop if we can't add consecutive elements
            }
        }
        
        // Grow forwards
        for (let i = seedIndex + 1; i < allElements.length && sequence.length < maxGrowth; i++) {
            const candidate = allElements[i];
            if (shouldAddToSequence(candidate, sequence, coveredWords, targetWords)) {
                sequence.push(candidate);
                candidate.matchingWords.forEach(word => coveredWords.add(word));
            } else if (sequence.length > 1) {
                break; // Stop if we can't add consecutive elements
            }
        }
        
        return evaluateSequenceCandidate(sequence, targetWords);
    };

    /**
     * Determine if an element should be added to a growing sequence
     */
    const shouldAddToSequence = (candidate, currentSequence, coveredWords, targetWords) => {
        // Must have relevant words
        if (candidate.matchingWords.length === 0) return false;
        
        // Check if it adds new coverage
        const newWords = candidate.matchingWords.filter(word => !coveredWords.has(word));
        if (newWords.length === 0) return false;
        
        // Check spatial proximity to the sequence
        const lastElement = currentSequence[currentSequence.length - 1];
        const firstElement = currentSequence[0];
        
        const distanceToLast = calculateElementDistance(candidate, lastElement);
        const distanceToFirst = calculateElementDistance(candidate, firstElement);
        
        const minDistance = Math.min(distanceToLast, distanceToFirst);
        
        // Must be spatially reasonable (within same general area)
        if (minDistance > 100) return false; // Adjust threshold as needed
        
        // Must maintain reasonable element quality
        if (candidate.relevanceScore < 0.1) return false;
        
        return true;
    };

    /**
     * Calculate spatial coherence of a sequence
     */
    const calculateSpatialCoherence = (sequence) => {
        if (sequence.length <= 1) return 1.0;
        
        let totalDistance = 0;
        let maxDistance = 0;
        
        for (let i = 1; i < sequence.length; i++) {
            const distance = calculateElementDistance(sequence[i-1], sequence[i]);
            totalDistance += distance;
            maxDistance = Math.max(maxDistance, distance);
        }
        
        const avgDistance = totalDistance / (sequence.length - 1);
        
        // Good spatial coherence means elements are close together
        // Normalize based on typical text spacing
        const coherenceScore = Math.max(0, 1 - (avgDistance / 50)); // 50px is reasonable spacing
        
        return Math.min(1.0, coherenceScore);
    };

    /**
     * Calculate reading order consistency
     */
    const calculateReadingOrderConsistency = (sequence) => {
        if (sequence.length <= 1) return 1.0;
        
        let consistentTransitions = 0;
        
        for (let i = 1; i < sequence.length; i++) {
            const prev = sequence[i-1];
            const curr = sequence[i];
            
            // Check if current element comes after previous in reading order
            // Reading order: top-to-bottom, then left-to-right
            const yDiff = curr.coordinates.y - prev.coordinates.y;
            const xDiff = curr.coordinates.x - prev.coordinates.x;
            
            if (yDiff > 5) {
                // Different lines - current should be below previous
                consistentTransitions++;
            } else if (Math.abs(yDiff) <= 5) {
                // Same line - current should be to the right of previous
                if (xDiff > 0) {
                    consistentTransitions++;
                }
            }
        }
        
        return consistentTransitions / (sequence.length - 1);
    };

    /**
     * Calculate word order preservation
     */
    const calculateWordOrderPreservation = (sequence, targetWords) => {
        // Collect word positions from sequence in element order
        const sequenceWordPositions = [];
        
        sequence.forEach(element => {
            element.wordPositions.forEach(pos => {
                sequenceWordPositions.push(pos);
            });
        });
        
        if (sequenceWordPositions.length <= 1) return 1.0;
        
        // Check how many position pairs are in correct order
        let correctOrdering = 0;
        for (let i = 1; i < sequenceWordPositions.length; i++) {
            if (sequenceWordPositions[i] >= sequenceWordPositions[i-1]) {
                correctOrdering++;
            }
        }
        
        return correctOrdering / (sequenceWordPositions.length - 1);
    };

    /**
     * Calculate distance between two elements
     */
    const calculateElementDistance = (element1, element2) => {
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

    /**
     * Select the best sequence from candidates
     */
    const selectBestSequence = (candidates, targetWords) => {
        if (candidates.length === 0) return null;
        
        // Sort by quality score
        candidates.sort((a, b) => b.quality - a.quality);
        
        log(`🏆 Sequence candidate rankings:`);
        candidates.slice(0, 5).forEach((candidate, i) => {
            log(`   ${i + 1}. Quality: ${candidate.quality.toFixed(3)} | Coverage: ${(candidate.coverage * 100).toFixed(1)}% | Elements: ${candidate.elementCount} | "${candidate.matchedText.substring(0, 60)}..."`);
        });
        
        // Return the best candidate
        return candidates[0];
    };

    /**
     * Create spatial groups for highlighting
     */
    const createSpatialGroups = (elements) => {
        if (elements.length === 0) return [];
        
        // Sort by reading order
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
            
            const distance = calculateElementDistance(lastInGroup, current);
            
            // Group elements that are close together
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
     * Create highlight from spatial group
     */
    const createHighlight = async (spatialGroup, sentenceId, sentenceText, sequenceMatch) => {
        if (!containerRef?.current || spatialGroup.elements.length === 0) return null;

        try {
            const textElements = spatialGroup.elements
                .map(element => findTextElement(element.stable_index, element.page))
                .filter(el => el !== null);

            if (textElements.length === 0) return null;

            const highlightElement = createHighlightFromTextElements(
                textElements, 
                sentenceId, 
                sentenceText,
                sequenceMatch
            );

            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);

                const highlightKey = `smart_${sentenceId}_${spatialGroup.elements[0].stable_index}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentenceId: sentenceId,
                    spatialGroup: spatialGroup,
                    textElements: textElements,
                    sequenceMatch: sequenceMatch,
                    type: 'smart_sequence'
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
    const createHighlightFromTextElements = (textElements, sentenceId, sentenceText, sequenceMatch) => {
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
            const styling = getQualityBasedStyling(sequenceMatch);

            const highlightDiv = document.createElement('div');
            highlightDiv.className = `${className} quality-${styling.tier}`;

            Object.assign(highlightDiv.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: styling.backgroundColor,
                border: styling.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
            });

            // Enhanced tooltip
            highlightDiv.title = `
Smart Sequence Match
Sentence: ${sentenceId}
Quality: ${(sequenceMatch.quality * 100).toFixed(1)}%
Coverage: ${(sequenceMatch.coverage * 100).toFixed(1)}%
Elements: ${sequenceMatch.elementCount}
Text: "${sentenceText.substring(0, 80)}..."
            `.trim();

            return highlightDiv;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };

    /**
     * Get styling based on sequence match quality
     */
    const getQualityBasedStyling = (sequenceMatch) => {
        const quality = sequenceMatch.quality;
        
        if (quality >= 0.7) {
            return {
                tier: 'high',
                backgroundColor: 'rgba(76, 175, 80, 0.4)',   // Green
                border: '2px solid rgba(76, 175, 80, 0.8)'
            };
        } else if (quality >= 0.5) {
            return {
                tier: 'medium',
                backgroundColor: 'rgba(255, 193, 7, 0.4)',    // Yellow
                border: '2px solid rgba(255, 193, 7, 0.8)'
            };
        } else {
            return {
                tier: 'low',
                backgroundColor: 'rgba(255, 152, 0, 0.4)',    // Orange
                border: '2px solid rgba(255, 152, 0, 0.8)'
            };
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
        log('🧹 Cleared all smart sequence highlights');
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

export default DirectTextHighlighter;