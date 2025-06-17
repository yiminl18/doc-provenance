// Simplified Exact Text Matcher for Provenance
// Finds consecutive PDF.js text elements that exactly match provenance text on a specific page

/**
 * Find exact consecutive text spans for multiple stableMappings on a specific page
 * @param {Array} stableMappings - contains text to search for. Object {sentence_id: {sentence_text: sentence_str}} Mappings of stable indices to text elements (not used here)
 * @param {Array} provenanceIds - Array of sentence IDs from provenance (identical to stableMappings keys)
 * @param {number} primaryPageNumber - The main page to search on
 * @param {Object} pdfJSCache - PDF.js stable items for the specific page
 * @returns {Array} Array of consecutive text spans that match each provenance text
 */
function findExactTextSpans(stableMappings, provenanceIds, primaryPageNumber, pdfJSCache) {
    console.log(`🔍 Finding exact spans for ${Object.keys(stableMappings).length} provenance texts on page ${primaryPageNumber}`);

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
    
    Object.entries(stableMappings).forEach(([sentenceId, mapping]) => {
        if (!mapping || !mapping.sentence_text) {
            console.warn(`⚠️ No text found for sentence ID ${sentenceId}`);
            return;
        }
        
        const provenanceText = mapping.sentence_text;
        console.log(`📝 Processing sentence ${sentenceId}: "${provenanceText.substring(0, 50)}..."`);
        
        // Clean and tokenize the provenance text
        const cleanText = normalizeText(provenanceText);
        const targetWords = cleanText.split(/\s+/).filter(word => word.length > 0);
        
        if (targetWords.length === 0) {
            console.warn(`⚠️ No words found in provenance text for sentence ${sentenceId}`);
            return;
        }
        
        console.log(`🔤 Looking for ${targetWords.length} words for sentence ${sentenceId}`);
        
        // Find consecutive spans for this specific text
        const spans = findConsecutiveSpans(targetWords, pageElements, [sentenceId], primaryPageNumber, provenanceText);
        
        console.log(`✅ Found ${spans.length} spans for sentence ${sentenceId}`);
        allSpans.push(...spans);
    });
    
    console.log(`🎯 Total spans found: ${allSpans.length}`);
    return allSpans;
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
 * Calculate confidence score based on match completeness
 */
function calculateConfidence(matchedWords, totalWords) {
    if (totalWords === 0) return 0;
    const ratio = matchedWords / totalWords;
    
    if (ratio >= 0.9) return 1.0;      // Nearly complete match
    if (ratio >= 0.7) return 0.8;      // Good match
    if (ratio >= 0.5) return 0.6;      // Partial match
    return 0.4;                        // Weak match
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
 * Normalize text for comparison
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .trim();
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { findExactTextSpans };
}

// Usage example for your setup with arrays:
/*
const createExactTextHighlights = async (stableMappings, provenanceTexts, provenanceIds) => {
    if (!highlightLayerRef?.current) return;
    
    const regionCoords = await getDocumentRegions(documentFilename);
    const primaryPageNumber = regionCoords[0]?.pages[0]; // Get first page from first region
    const pdfJSCache = await getPdfJSCache(documentFilename, primaryPageNumber);
    
    // Find exact text spans for all provenance texts
    const textSpans = findExactTextSpans(provenanceTexts, provenanceIds, primaryPageNumber, pdfJSCache);
    
    // Create highlight elements for each span
    textSpans.forEach(span => {
        span.elements.forEach(element => {
            const highlightElement = document.createElement('div');
            highlightElement.className = `${className} exact-text-highlight`;
            highlightElement.setAttribute('data-sentence-ids', span.sentence_ids.join(','));
            highlightElement.setAttribute('data-stable-index', element.stableIndex);
            highlightElement.setAttribute('data-confidence', span.confidence);
            
            // Position based on element coordinates
            Object.assign(highlightElement.style, {
                left: `${element.coordinates.x}px`,
                top: `${element.coordinates.y}px`,
                width: `${element.coordinates.width}px`,
                height: `${element.coordinates.height}px`
            });
            
            highlightLayerRef.current.appendChild(highlightElement);
        });
    });
};
*/