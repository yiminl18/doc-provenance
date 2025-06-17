// textSimilarity.js - Consolidated text similarity and matching utilities

/**
 * TEXT NORMALIZATION UTILITIES
 */

/**
 * Normalize text for comparison (remove punctuation, lowercase, etc.)
 */
export function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .replace(/\s+/g, ' ')     // Collapse multiple spaces
        .trim();
}

/**
 * Advanced text normalization for PDF text matching
 */
export function normalizeTextForPDF(text) {
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')      // Normalize whitespace
        .replace(/[^\w\s]/g, '')   // Remove punctuation for matching
        .toLowerCase()
        .trim();
}

/**
 * Clean text for enhanced matching (preserves more structure)
 */
export function cleanText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Split text into words, filtering out very short ones
 */
export function getWords(text, minLength = 2) {
    const normalized = normalizeText(text);
    return normalized.split(' ').filter(word => word.length >= minLength);
}

/**
 * SIMILARITY CALCULATION FUNCTIONS
 */

/**
 * Calculate Jaccard similarity between two sets of words
 */
export function jaccardSimilarity(words1, words2) {
    if (!words1.length || !words2.length) return 0;
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
}

/**
 * Calculate word overlap percentage
 */
export function wordOverlapRatio(words1, words2) {
    if (!words1.length || !words2.length) return 0;
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    
    // Return the percentage of sentence words found in element text
    return intersection.size / Math.min(set1.size, set2.size);
}

/**
 * Calculate token-level similarity with partial matching
 */
export function tokenSimilarity(text1, text2) {
    const words1 = getWords(text1);
    const words2 = getWords(text2);
    
    if (!words1.length || !words2.length) return 0;
    
    let matches = 0;
    const totalWords = words1.length;
    
    for (const word1 of words1) {
        // Exact match
        if (words2.includes(word1)) {
            matches += 1;
        } else if (word1.length >= 4) {
            // Partial match for longer words (prefix/suffix matching)
            const partialMatch = words2.some(word2 => 
                word2.length >= 4 && (
                    word1.startsWith(word2.slice(0, 3)) ||
                    word2.startsWith(word1.slice(0, 3)) ||
                    word1.endsWith(word2.slice(-3)) ||
                    word2.endsWith(word1.slice(-3))
                )
            );
            if (partialMatch) {
                matches += 0.7; // Partial match gets less weight
            }
        }
    }
    
    return matches / totalWords;
}

/**
 * Calculate comprehensive similarity score combining multiple metrics
 */
export function calculateSimilarity(sentenceText, elementText) {
    const sentenceWords = getWords(sentenceText);
    const elementWords = getWords(elementText);
    
    // Different similarity metrics
    const jaccard = jaccardSimilarity(sentenceWords, elementWords);
    const overlap = wordOverlapRatio(sentenceWords, elementWords);
    const token = tokenSimilarity(sentenceText, elementText);
    
    // Weighted combination - prioritize token similarity and overlap
    const combinedScore = (token * 0.5) + (overlap * 0.3) + (jaccard * 0.2);
    
    return {
        combined: combinedScore,
        jaccard: jaccard,
        overlap: overlap,
        token: token,
        sentenceWordCount: sentenceWords.length,
        elementWordCount: elementWords.length,
        sentenceWords: sentenceWords,
        elementWords: elementWords
    };
}

/**
 * STRING DISTANCE AND SIMILARITY FUNCTIONS
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Calculate string similarity using Levenshtein distance
 */
export function calculateStringSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

/**
 * WORD MATCHING FUNCTIONS
 */

/**
 * Check if two words match with fuzzy matching
 */
export function wordsMatch(word1, word2, threshold = 0.8) {
    if (word1 === word2) return true;
    
    // Handle common OCR/extraction differences
    const similarity = calculateStringSimilarity(word1, word2);
    return similarity > threshold;
}

/**
 * Calculate confidence for word match
 */
export function calculateWordMatchConfidence(target, matched) {
    return calculateStringSimilarity(target, matched);
}

/**
 * Find best word match in a list of candidates
 */
export function findBestWordMatch(targetWord, candidateWords, threshold = 0.6) {
    let bestMatch = null;
    let bestScore = 0;
    
    for (const candidate of candidateWords) {
        const score = calculateStringSimilarity(targetWord, candidate);
        if (score > bestScore && score >= threshold) {
            bestScore = score;
            bestMatch = {
                word: candidate,
                score: score,
                confidence: score
            };
        }
    }
    
    return bestMatch;
}

/**
 * TEXT SEQUENCE MATCHING
 */

/**
 * Find word sequence matches in text items
 */
export function findWordSequenceMatches(targetWords, textItems, options = {}) {
    const {
        confidenceThreshold = 0.6,
        wordMatchThreshold = 0.8,
        allowSkips = true,
        maxSkipPenalty = 0.1
    } = options;
    
    const matches = [];
    
    // Normalize text items
    const normalizedItems = textItems.map(item => ({
        ...item,
        normalizedStr: normalizeTextForPDF(item.str || item.text || '')
    }));

    // Sliding window approach to find word sequences
    for (let i = 0; i < normalizedItems.length; i++) {
        const match = findSequenceStartingAt(
            targetWords, 
            normalizedItems, 
            i, 
            {
                confidenceThreshold,
                wordMatchThreshold,
                allowSkips,
                maxSkipPenalty
            }
        );
        
        if (match && match.confidence > confidenceThreshold) {
            matches.push(match);
        }
    }

    // Remove overlapping matches, keep best ones
    return deduplicateMatches(matches);
}

/**
 * Find word sequence starting at a specific position
 */
export function findSequenceStartingAt(targetWords, textItems, startIndex, options = {}) {
    const {
        wordMatchThreshold = 0.8,
        allowSkips = true,
        maxSkipPenalty = 0.1
    } = options;
    
    let wordIndex = 0;
    let itemIndex = startIndex;
    const matchedItems = [];
    let totalConfidence = 0;

    while (wordIndex < targetWords.length && itemIndex < textItems.length) {
        const item = textItems[itemIndex];
        const itemWords = item.normalizedStr.split(/\s+/).filter(w => w.length > 0);

        let foundInItem = false;
        for (const itemWord of itemWords) {
            if (wordIndex < targetWords.length && 
                wordsMatch(targetWords[wordIndex], itemWord, wordMatchThreshold)) {
                matchedItems.push({ item, wordIndex, itemWord });
                totalConfidence += calculateWordMatchConfidence(targetWords[wordIndex], itemWord);
                wordIndex++;
                foundInItem = true;
            }
        }

        if (!foundInItem && allowSkips) {
            // Allow skipping some items (for formatting differences)
            totalConfidence -= maxSkipPenalty;
        }

        itemIndex++;

        // Early termination if confidence drops too low
        if (totalConfidence < wordIndex * 0.5) {
            break;
        }
    }

    if (wordIndex >= targetWords.length * 0.8) { // Found at least 80% of words
        return {
            matchedItems,
            confidence: totalConfidence / targetWords.length,
            startItem: startIndex,
            endItem: itemIndex - 1,
            wordsFound: wordIndex,
            totalWords: targetWords.length,
            completeness: wordIndex / targetWords.length
        };
    }

    return null;
}

/**
 * SUBSTRING MATCHING
 */

/**
 * Find direct substring matches in continuous text
 */
export function findDirectSubstringMatches(targetText, textItems) {
    const cleanTarget = normalizeTextForPDF(targetText);
    const matches = [];
    
    // Build continuous text from all items
    let continuousText = '';
    let charToItemMap = [];
    
    textItems.forEach((item, itemIndex) => {
        const startPos = continuousText.length;
        const cleanItemText = normalizeTextForPDF(item.str || item.text || '');
        
        continuousText += cleanItemText;
        
        // Map each character to its source item
        for (let i = 0; i < cleanItemText.length; i++) {
            charToItemMap.push({
                itemIndex,
                charIndex: i,
                item
            });
        }
        
        // Add space between items
        if (!item.hasEOL && cleanItemText.length > 0) {
            continuousText += ' ';
            charToItemMap.push({
                itemIndex,
                charIndex: -1, // Space character
                item
            });
        }
    });

    // Find target text in continuous text
    let searchPos = 0;
    while (true) {
        const foundPos = continuousText.indexOf(cleanTarget, searchPos);
        if (foundPos === -1) break;
        
        const endPos = foundPos + cleanTarget.length;
        
        // Map back to text items
        const relevantItems = new Set();
        for (let i = foundPos; i < endPos && i < charToItemMap.length; i++) {
            if (charToItemMap[i]) {
                relevantItems.add(charToItemMap[i].itemIndex);
            }
        }

        if (relevantItems.size > 0) {
            matches.push({
                type: 'direct_substring',
                itemIndices: Array.from(relevantItems),
                startPos: foundPos,
                endPos: endPos,
                confidence: 0.95, // High confidence for exact matches
                matchedText: cleanTarget
            });
        }
        
        searchPos = foundPos + 1; // Look for overlapping matches
    }

    return matches;
}

/**
 * FUZZY MATCHING
 */

/**
 * Find fuzzy word matches with scoring
 */
export function findFuzzyWordMatches(targetWords, textItems, options = {}) {
    const {
        minSimilarity = 0.6,
        maxResults = 5,
        scoreThreshold = 0.3
    } = options;
    
    const matches = [];
    const itemScores = new Map();
    
    // Score each text item based on word overlap
    textItems.forEach((item, itemIndex) => {
        const cleanItemText = normalizeTextForPDF(item.str || item.text || '');
        const itemWords = cleanItemText.split(/\s+/).filter(w => w.length > 0);
        
        let score = 0;
        let matchedWords = 0;
        
        for (const targetWord of targetWords) {
            const bestMatch = findBestWordMatch(targetWord, itemWords, minSimilarity);
            if (bestMatch) {
                score += bestMatch.score;
                matchedWords++;
            }
        }
        
        // Normalize score
        const normalizedScore = matchedWords > 0 ? (score / targetWords.length) : 0;
        
        if (normalizedScore > scoreThreshold) {
            itemScores.set(itemIndex, {
                score: normalizedScore,
                matchedWords: matchedWords,
                totalWords: targetWords.length,
                item: item
            });
        }
    });

    // Convert to matches array and sort by score
    const sortedMatches = Array.from(itemScores.entries())
        .map(([itemIndex, scoreData]) => ({
            type: 'fuzzy_word',
            itemIndex: itemIndex,
            confidence: scoreData.score,
            matchedWords: scoreData.matchedWords,
            totalWords: scoreData.totalWords,
            item: scoreData.item
        }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxResults);

    return sortedMatches;
}

/**
 * MATCH DEDUPLICATION
 */

/**
 * Remove overlapping matches, keep highest confidence
 */
export function deduplicateMatches(matches) {
    if (matches.length <= 1) return matches;

    matches.sort((a, b) => b.confidence - a.confidence);
    const filtered = [];

    for (const match of matches) {
        const overlaps = filtered.some(existing => 
            matchesOverlap(match, existing)
        );
        
        if (!overlaps) {
            filtered.push(match);
        }
    }

    return filtered;
}

/**
 * Check if two matches overlap significantly
 */
export function matchesOverlap(match1, match2) {
    // Handle different match types
    const getRange = (match) => {
        if (match.startItem !== undefined && match.endItem !== undefined) {
            return { start: match.startItem, end: match.endItem };
        }
        if (match.itemIndices && match.itemIndices.length > 0) {
            return { 
                start: Math.min(...match.itemIndices), 
                end: Math.max(...match.itemIndices) 
            };
        }
        if (match.itemIndex !== undefined) {
            return { start: match.itemIndex, end: match.itemIndex };
        }
        return null;
    };
    
    const range1 = getRange(match1);
    const range2 = getRange(match2);
    
    if (!range1 || !range2) return false;
    
    const overlap = Math.max(0, 
        Math.min(range1.end, range2.end) - 
        Math.max(range1.start, range2.start)
    );
    
    const minLength = Math.min(
        range1.end - range1.start,
        range2.end - range2.start
    );

    return overlap / Math.max(minLength, 1) > 0.5; // 50% overlap threshold
}

/**
 * Batch calculate similarities for multiple text pairs
 */
export function batchCalculateSimilarities(textPairs) {
    return textPairs.map(([text1, text2]) => ({
        texts: [text1, text2],
        similarity: calculateSimilarity(text1, text2)
    }));
}

/**
 * EXPORT COLLECTIONS FOR CONVENIENCE
 */

// Collection of normalization functions
export const textNormalization = {
    normalizeText,
    normalizeTextForPDF,
    cleanText,
    getWords
};

// Collection of similarity functions
export const similarityMetrics = {
    jaccardSimilarity,
    wordOverlapRatio,
    tokenSimilarity,
    calculateSimilarity,
    calculateStringSimilarity,
    levenshteinDistance
};

// Collection of matching functions
export const textMatching = {
    wordsMatch,
    findBestWordMatch,
    findWordSequenceMatches,
    findDirectSubstringMatches,
    findFuzzyWordMatches,
    deduplicateMatches,
    matchesOverlap
};

// Collection of utility functions
export const textUtils = {
    batchCalculateSimilarities,
    calculateWordMatchConfidence
};