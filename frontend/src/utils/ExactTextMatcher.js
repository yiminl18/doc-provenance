// ExactTextMatcher.js - ES6 Module Version
// Simplified Exact Text Matcher for Provenance with ES6 exports
// Self-contained with all needed utilities

/**
 * Find exact consecutive text spans for multiple provenance texts on a specific page
 * @param {Object} stableMappings - dict of sentence stable mappings, where keys are sentence IDs and values are mapping objects
 * @param {Array} provenanceIds - Array of sentence IDs from provenance
 * @param {number} primaryPageNumber - The main page to search on
 * @param {Object} pdfJSCache - PDF.js stable items for the specific page
 * @param {Object} options - Matching options
 * @param {boolean} options.includeWordMatching - Include individual word matching (default: false)
 * @param {number} options.minWordMatchThreshold - Minimum words to match for word-level spans (default: 3)
 * @returns {Array} Array of consecutive text spans that match each provenance text
 */
export function findExactTextSpans(stableMappings, provenanceIds, primaryPageNumber, pdfJSCache, options = {}) {
    const {
        includeWordMatching = false,
        minWordMatchThreshold = 3
    } = options;

    console.log(`🔍 Finding spans for ${Object.keys(stableMappings).length} provenance texts on page ${primaryPageNumber}`);
    console.log(`📊 Options: consecutive=${true}, word-level=${includeWordMatching}, min-words=${minWordMatchThreshold}`);
    
    if (!pdfJSCache || !pdfJSCache.stableItems) {
        console.warn(`⚠️ No PDF.js cache data for page ${primaryPageNumber}`);
        return [];
    }
    
    // Get text elements for this page, sorted by stable index (document order)
    const pageElements = pdfJSCache.stableItems
        .filter(item => item.hasSignificantText && item.str.trim().length > 0)
        .sort((a, b) => a.stableIndex - b.stableIndex);
    
    if (pageElements.length === 0) {
        console.warn(`⚠️ No text elements found on page ${primaryPageNumber}`);
        return [];
    }
    
    const allSpans = [];
    
    // Process each provenance text separately
    Object.entries(stableMappings).forEach(([sentenceId, mappingData]) => {
        // Handle different mapping data formats
        const provenanceText = mappingData?.text || mappingData?.sentence_text || '';
        
        if (!provenanceText) {
            console.warn(`⚠️ No text found for sentence ${sentenceId}`);
            return;
        }
        
        console.log(`📝 Processing sentence ${sentenceId}: "${provenanceText.substring(0, 50)}..."`);
        
        // Clean and tokenize this provenance text
        const cleanText = normalizeText(provenanceText);
        const targetWords = cleanText.split(/\s+/).filter(word => word.length > 0);
        
        if (targetWords.length === 0) {
            console.warn(`⚠️ No words found in provenance text for sentence ${sentenceId}`);
            return;
        }
        
        console.log(`🔤 Looking for ${targetWords.length} words for sentence ${sentenceId}`);
        
        // 1. Find consecutive spans (primary method)
        const consecutiveSpans = findConsecutiveSpans(targetWords, pageElements, [sentenceId], primaryPageNumber, provenanceText);
        console.log(`✅ Found ${consecutiveSpans.length} consecutive spans for sentence ${sentenceId}`);
        allSpans.push(...consecutiveSpans);
        
        // 2. Find word-level matches if enabled and we have enough words
        if (includeWordMatching && targetWords.length >= minWordMatchThreshold) {
            const wordSpans = findWordLevelMatches(targetWords, pageElements, [sentenceId], primaryPageNumber, provenanceText, minWordMatchThreshold);
            console.log(`🔤 Found ${wordSpans.length} word-level spans for sentence ${sentenceId}`);
            allSpans.push(...wordSpans);
        }
    });
    
    // Remove duplicates and sort by confidence
    const uniqueSpans = removeDuplicateSpans(allSpans);
    console.log(`🎯 Total unique spans found: ${uniqueSpans.length}`);
    
    return uniqueSpans.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Find consecutive spans of elements that match the target words
 */
function findConsecutiveSpans(targetWords, pageElements, sentenceIds, pageNumber, originalText) {
    if (targetWords.length === 0) return [];
    
    const spans = [];
    let wordIndex = 0;
    
    // Use sliding window approach to find consecutive matches
    for (let startIdx = 0; startIdx < pageElements.length && wordIndex < targetWords.length; startIdx++) {
        const matchResult = attemptMatchFromPosition(targetWords, wordIndex, pageElements, startIdx);
        
        if (matchResult.success) {
            spans.push({
                sentence_ids: sentenceIds,
                page_number: pageNumber,
                original_text: originalText,
                elements: matchResult.elements,
                start_element_index: startIdx,
                end_element_index: matchResult.endIndex,
                matched_words_count: matchResult.wordsMatched,
                confidence: calculateConfidence(matchResult.wordsMatched, targetWords.length),
                match_type: 'exact_consecutive',
                bounding_box: calculateBoundingBox(matchResult.elements)
            });
            
            wordIndex += matchResult.wordsMatched;
            startIdx = matchResult.endIndex; // Continue from where we left off
        }
    }
    
    return spans;
}

/**
 * Attempt to match target words starting from a specific element position
 */
function attemptMatchFromPosition(targetWords, startWordIndex, pageElements, startElementIndex) {
    const matchedElements = [];
    let currentWordIndex = startWordIndex;
    let elementIndex = startElementIndex;
    
    while (elementIndex < pageElements.length && currentWordIndex < targetWords.length) {
        const element = pageElements[elementIndex];
        const elementText = normalizeText(element.str);
        
        if (elementText.length === 0) {
            elementIndex++;
            continue;
        }
        
        // Check how many consecutive words this element contains
        const wordsInElement = elementText.split(/\s+/).filter(w => w.length > 0);
        const remainingWords = targetWords.slice(currentWordIndex);
        
        const matchCount = countConsecutiveMatches(wordsInElement, remainingWords);
        
        if (matchCount > 0) {
            matchedElements.push({
                stableIndex: element.stableIndex,
                text: element.str,
                normalizedText: elementText,
                coordinates: {
                    x: element.x,
                    y: element.y,
                    width: element.width,
                    height: element.height
                },
                wordsMatched: matchCount,
                elementIndex: elementIndex
            });
            
            currentWordIndex += matchCount;
            elementIndex++;
            
            // If we've matched some words but this element doesn't contain all remaining words,
            // continue to next element
        } else {
            // No match found - if we haven't started matching, try next element
            // If we have started matching, this breaks the consecutive sequence
            if (matchedElements.length === 0) {
                elementIndex++;
            } else {
                break;
            }
        }
    }
    
    return {
        success: matchedElements.length > 0,
        elements: matchedElements,
        endIndex: elementIndex - 1,
        wordsMatched: currentWordIndex - startWordIndex
    };
}

/**
 * Count how many words from targetWords are consecutively found in elementWords
 */
function countConsecutiveMatches(elementWords, targetWords) {
    let matches = 0;
    let elementIndex = 0;
    
    for (const targetWord of targetWords) {
        // Look for this target word starting from current position in element
        let found = false;
        
        while (elementIndex < elementWords.length) {
            if (elementWords[elementIndex] === targetWord) {
                matches++;
                elementIndex++;
                found = true;
                break;
            } else if (matches === 0) {
                // Haven't started matching yet, can skip words in element
                elementIndex++;
            } else {
                // Already started matching, must be consecutive
                return matches;
            }
        }
        
        if (!found) {
            return matches;
        }
    }
    
    return matches;
}

/**
 * Find word-level matches for target words across page elements
 */
function findWordLevelMatches(targetWords, pageElements, sentenceIds, pageNumber, originalText, minWordThreshold) {
    const wordSpans = [];
    const wordToElements = new Map(); // Track which elements contain each word
    
    // First pass: Map each target word to elements that contain it
    targetWords.forEach((targetWord, wordIndex) => {
        const matchingElements = [];
        
        pageElements.forEach((element, elementIndex) => {
            const elementText = normalizeText(element.str);
            const elementWords = elementText.split(/\s+/).filter(w => w.length > 0);
            
            if (elementWords.includes(targetWord)) {
                matchingElements.push({
                    element: element,
                    elementIndex: elementIndex,
                    wordIndex: wordIndex,
                    word: targetWord
                });
            }
        });
        
        if (matchingElements.length > 0) {
            wordToElements.set(targetWord, matchingElements);
        }
    });
    
    console.log(`🔍 Word mapping: ${wordToElements.size}/${targetWords.length} words found in elements`);
    
    // Second pass: Find clusters of word matches
    const clusters = findWordClusters(wordToElements, targetWords, pageElements, minWordThreshold);
    
    // Third pass: Convert clusters to spans
    clusters.forEach((cluster, clusterIndex) => {
        const span = {
            sentence_ids: sentenceIds,
            page_number: pageNumber,
            original_text: originalText,
            elements: cluster.elements.map(el => ({
                stableIndex: el.element.stableIndex,
                text: el.element.str,
                normalizedText: normalizeText(el.element.str),
                coordinates: {
                    x: el.element.x,
                    y: el.element.y,
                    width: el.element.width,
                    height: el.element.height
                },
                matchedWords: el.matchedWords
            })),
            start_element_index: Math.min(...cluster.elements.map(el => el.elementIndex)),
            end_element_index: Math.max(...cluster.elements.map(el => el.elementIndex)),
            matched_words_count: cluster.totalWordsMatched,
            unique_words_matched: cluster.uniqueWordsMatched,
            confidence: calculateWordLevelConfidence(cluster.uniqueWordsMatched, targetWords.length, cluster.elements.length),
            match_type: 'word_level',
            cluster_span: cluster.elements.length,
            bounding_box: calculateBoundingBox(cluster.elements.map(el => ({ coordinates: {
                x: el.element.x,
                y: el.element.y,
                width: el.element.width,
                height: el.element.height
            }})))
        };
        
        wordSpans.push(span);
    });
    
    return wordSpans;
}

/**
 * Find clusters of elements that contain multiple target words
 */
function findWordClusters(wordToElements, targetWords, pageElements, minWordThreshold) {
    const clusters = [];
    const usedElements = new Set(); // Track elements already used in clusters
    
    // Get all elements that contain any target words
    const allMatchingElements = [];
    for (const [word, elements] of wordToElements.entries()) {
        elements.forEach(el => {
            allMatchingElements.push({
                ...el,
                matchedWords: [word]
            });
        });
    }
    
    // Sort by element index to process in document order
    allMatchingElements.sort((a, b) => a.elementIndex - b.elementIndex);
    
    // Group nearby elements into clusters
    let currentCluster = [];
    let lastElementIndex = -1;
    const maxGap = 5; // Maximum gap between elements in a cluster
    
    allMatchingElements.forEach(matchEl => {
        const elementIndex = matchEl.elementIndex;
        
        // If this element is far from the last one, start a new cluster
        if (currentCluster.length === 0 || elementIndex - lastElementIndex > maxGap) {
            // Finalize previous cluster if it meets threshold
            if (currentCluster.length > 0) {
                const cluster = finalizeCluster(currentCluster, minWordThreshold);
                if (cluster) {
                    clusters.push(cluster);
                }
            }
            currentCluster = [matchEl];
        } else {
            // Add to current cluster, merging words if same element
            const existingElement = currentCluster.find(el => el.elementIndex === elementIndex);
            if (existingElement) {
                // Merge matched words
                existingElement.matchedWords.push(...matchEl.matchedWords);
                existingElement.matchedWords = [...new Set(existingElement.matchedWords)]; // Remove duplicates
            } else {
                currentCluster.push(matchEl);
            }
        }
        
        lastElementIndex = elementIndex;
    });
    
    // Don't forget the last cluster
    if (currentCluster.length > 0) {
        const cluster = finalizeCluster(currentCluster, minWordThreshold);
        if (cluster) {
            clusters.push(cluster);
        }
    }
    
    return clusters;
}

/**
 * Finalize a cluster and check if it meets the minimum word threshold
 */
function finalizeCluster(clusterElements, minWordThreshold) {
    // Count unique words matched across all elements in cluster
    const allMatchedWords = new Set();
    clusterElements.forEach(el => {
        el.matchedWords.forEach(word => allMatchedWords.add(word));
    });
    
    if (allMatchedWords.size < minWordThreshold) {
        return null; // Doesn't meet threshold
    }
    
    const totalWordsMatched = clusterElements.reduce((sum, el) => sum + el.matchedWords.length, 0);
    
    return {
        elements: clusterElements,
        uniqueWordsMatched: allMatchedWords.size,
        totalWordsMatched: totalWordsMatched,
        wordSet: allMatchedWords
    };
}

/**
 * Calculate confidence score based on match completeness (for consecutive matches)
 */
function calculateConfidence(matchedWords, totalWords) {
    if (totalWords === 0) return 0;
    const ratio = matchedWords / totalWords;
    
    if (ratio >= 0.9) return 1.0;      // Nearly complete match
    if (ratio >= 0.7) return 0.9;      // Good match  
    if (ratio >= 0.5) return 0.7;      // Partial match
    return 0.5;                        // Weak match
}

/**
 * Calculate confidence for word-level matches
 */
function calculateWordLevelConfidence(uniqueWordsMatched, totalTargetWords, elementSpan) {
    const wordRatio = uniqueWordsMatched / totalTargetWords;
    const spanPenalty = Math.min(1.0, 10 / elementSpan); // Penalize very spread out matches
    
    let baseScore = wordRatio * spanPenalty;
    
    // Boost score based on word coverage
    if (wordRatio >= 0.8) baseScore *= 1.1;      // High coverage boost
    else if (wordRatio >= 0.6) baseScore *= 1.0; // Good coverage
    else if (wordRatio >= 0.4) baseScore *= 0.9; // Medium coverage penalty
    else baseScore *= 0.7;                        // Low coverage penalty
    
    // Cap at slightly lower than consecutive matches
    return Math.min(0.85, Math.max(0.3, baseScore));
}

/**
 * Calculate word match confidence (from textSimilarity.js)
 */
function calculateWordMatchConfidence(targetWords, matchedCount) {
    if (!targetWords || targetWords.length === 0) return 0;
    if (matchedCount <= 0) return 0;
    
    const ratio = matchedCount / targetWords.length;
    
    // Confidence based on coverage
    if (ratio >= 0.9) return 0.95;
    if (ratio >= 0.8) return 0.85;
    if (ratio >= 0.7) return 0.75;
    if (ratio >= 0.6) return 0.65;
    if (ratio >= 0.5) return 0.55;
    if (ratio >= 0.4) return 0.45;
    return 0.3;
}

/**
 * Calculate overall bounding box for a span of elements
 */
function calculateBoundingBox(elements) {
    if (elements.length === 0) return null;
    
    const coords = elements.map(el => el.coordinates);
    
    return {
        x: Math.min(...coords.map(c => c.x)),
        y: Math.min(...coords.map(c => c.y)),
        width: Math.max(...coords.map(c => c.x + c.width)) - Math.min(...coords.map(c => c.x)),
        height: Math.max(...coords.map(c => c.y + c.height)) - Math.min(...coords.map(c => c.y))
    };
}

/**
 * Remove duplicate spans based on element overlap
 */
function removeDuplicateSpans(spans) {
    const uniqueSpans = [];
    
    spans.forEach(span => {
        const spanElementIndices = new Set(span.elements.map(el => el.stableIndex));
        
        // Check if this span significantly overlaps with any existing span
        const hasSignificantOverlap = uniqueSpans.some(existingSpan => {
            const existingElementIndices = new Set(existingSpan.elements.map(el => el.stableIndex));
            const intersection = new Set([...spanElementIndices].filter(x => existingElementIndices.has(x)));
            const union = new Set([...spanElementIndices, ...existingElementIndices]);
            
            const overlapRatio = intersection.size / Math.min(spanElementIndices.size, existingElementIndices.size);
            return overlapRatio > 0.7; // 70% overlap threshold
        });
        
        if (!hasSignificantOverlap) {
            uniqueSpans.push(span);
        }
    });
    
    return uniqueSpans;
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .trim();
}

// Export additional utilities if needed
export { normalizeText };

// Default export for convenience
export default findExactTextSpans;