// DirectTextHighlighter.js - Real-time text search and highlighting for PDF.js
import React, { useEffect, useRef } from 'react';
import { getDocumentSentences } from '../services/api'; // You'll need this to fetch sentences JSON
import { getDocument } from 'pdfjs-dist';

const DirectTextHighlighter = ({
    provenanceData,
    activeQuestionId,
    pdfDocument, // PDF.js document object
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
    searchOptions = {
        caseSensitive: false,
        matchThreshold: 0.8, // Minimum similarity for fuzzy matching
        maxGapBetweenWords: 50, // Max pixels between words to consider them part of same highlight
        contextWindow: 5 // Number of surrounding words to include in search context
    },
    className = 'direct-provenance-highlight',
    verbose = true
}) => {
    const activeHighlights = useRef(new Map());
    const pageTextCache = useRef(new Map());
    const sentencesCache = useRef(null);

    // Debug logging
    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[DirectTextHighlighter] ${message}`, ...args);
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
        log(`🔄 Highlighting effect triggered:`, {
            provenanceId: provenanceData?.provenance_id,
            provenanceIds: provenanceData?.provenance_ids,
            provenanceText: provenanceData?.provenance?.substring(0, 100) + '...',
            activeQuestionId,
            currentPage,
            documentFilename,
            hasProvenanceData: !!provenanceData,
            hasPdfDocument: !!pdfDocument,
            timestamp: Date.now()
        });

        if (!provenanceData?.provenance_ids || !documentFilename || !pdfDocument) {
            log('⏸️ Missing required data for highlighting', {
                hasProvenanceIds: !!provenanceData?.provenance_ids,
                hasDocumentFilename: !!documentFilename,
                hasPdfDocument: !!pdfDocument
            });
            clearAllHighlights();
            return;
        }

        const performHighlighting = async () => {
            try {
                log(`🎯 Starting highlighting for provenance ${provenanceData.provenance_id} with sentence IDs:`, provenanceData.provenance_ids);
                
                // Clear sentences cache when provenance changes to force reload
                if (provenanceData.provenance_id) {
                    log('🗑️ Clearing sentences cache for new provenance');
                    sentencesCache.current = null;
                }
                
                // Get sentence data
                const sentences = await getSentencesData(documentFilename);
                if (!sentences) {
                    log('❌ Failed to load sentences data');
                    return;
                }

                // Get target sentences from provenance
                const targetSentences = getTargetSentences(provenanceData.provenance_ids, sentences);
                if (targetSentences.length === 0) {
                    log('⚠️ No target sentences found for highlighting', {
                        provenanceIds: provenanceData.provenance_ids,
                        sentencesLength: sentences.length,
                        sentencesType: typeof sentences,
                        isArray: Array.isArray(sentences)
                    });
                    clearAllHighlights();
                    return;
                }

                log(`🎯 Found ${targetSentences.length} target sentences to highlight:`, 
                    targetSentences.map(s => ({ id: s.id, textPreview: s.text.substring(0, 50) + '...' }))
                );

                // Clear page text cache to ensure fresh content
                const cacheKey = `page_${currentPage}_zoom_${currentZoom}`;
                if (pageTextCache.current.has(cacheKey)) {
                    log('🗑️ Clearing page text cache for fresh content');
                    pageTextCache.current.delete(cacheKey);
                }

                // Extract and cache page text content
                const pageTextContent = await getPageTextContent(currentPage);
                if (!pageTextContent) {
                    log(`❌ Failed to extract text content for page ${currentPage}`);
                    return;
                }

                // Clear existing highlights
                clearAllHighlights();

                // Search for each target sentence on current page
                let totalHighlights = 0;
                for (const sentence of targetSentences) {
                    log(`🔍 Searching for sentence ${sentence.id} on page ${currentPage}`);
                    const highlights = await searchAndHighlightSentence(sentence, pageTextContent);
                    totalHighlights += highlights.length;
                    log(`✅ Found ${highlights.length} highlights for sentence ${sentence.id}`);
                }

                log(`✅ Created ${totalHighlights} total highlights on page ${currentPage}`);

            } catch (error) {
                console.error('[DirectTextHighlighter] Error during highlighting:', error);
                clearAllHighlights();
            }
        };

        // Small delay to ensure text layer is ready
        const timeoutId = setTimeout(performHighlighting, 150);
        return () => clearTimeout(timeoutId);

    }, [
        provenanceData?.provenance_id, 
        JSON.stringify(provenanceData?.provenance_ids), // Watch the actual sentence IDs
        provenanceData?.provenance, // Watch the provenance text too
        currentPage, 
        documentFilename,
        activeQuestionId // Make sure it re-runs when question changes
    ]);


    // Function to get sentences data from your JSON
    const getSentencesData = async (filename) => {
        if (sentencesCache.current) {
            return sentencesCache.current;
        }

        try {
            log(`📄 Loading sentences data for ${filename}`);
            
            // This would call your API to get the sentences JSON
            // Adjust the API call to match your backend structure
            const response = await getDocumentSentences(filename);

            if (response.success && response.sentences) {
                sentencesCache.current = response.sentences;
                log(`✅ Loaded ${response.sentences.length} sentences`);
                return response.sentences;
            } else {
                console.error('Failed to load sentences:', response);
                return null;
            }
        } catch (error) {
            console.error('Error loading sentences:', error);
            return null;
        }
    };

    const getTargetSentences = (provenanceIds, allSentences) => {
        const targetSentences = [];
        
        log(`🔍 Extracting target sentences:`, {
            provenanceIds,
            allSentencesType: typeof allSentences,
            isArray: Array.isArray(allSentences),
            allSentencesLength: Array.isArray(allSentences) ? allSentences.length : 'N/A',
            hasNestedSentences: !!(allSentences && allSentences.sentences),
            nestedSentencesLength: allSentences?.sentences ? allSentences.sentences.length : 'N/A'
        });
        
        provenanceIds.forEach((sentenceId, index) => {
            log(`🔍 Looking for sentence ID ${sentenceId} (index ${index})`);
            
            // Handle different sentence formats
            let sentence = null;
            
            if (Array.isArray(allSentences)) {
                // Simple array format - try both numeric index and direct lookup
                sentence = allSentences[sentenceId] || allSentences[parseInt(sentenceId)];
                log(`📄 Array lookup for ${sentenceId}:`, sentence ? 'Found' : 'Not found');
            } else if (allSentences && allSentences.sentences) {
                // Nested format
                sentence = allSentences.sentences[sentenceId] || allSentences.sentences[parseInt(sentenceId)];
                log(`📄 Nested lookup for ${sentenceId}:`, sentence ? 'Found' : 'Not found');
            } else if (allSentences && typeof allSentences === 'object') {
                // Direct object lookup
                sentence = allSentences[sentenceId] || allSentences[parseInt(sentenceId)];
                log(`📄 Object lookup for ${sentenceId}:`, sentence ? 'Found' : 'Not found');
            }
            
            if (sentence) {
                // Handle both string and object formats
                const sentenceText = typeof sentence === 'string' ? sentence : sentence.text || sentence.content || sentence;
                if (sentenceText && sentenceText.trim && sentenceText.trim().length > 0) {
                    const cleanText = sentenceText.trim();
                    targetSentences.push({
                        id: sentenceId,
                        text: cleanText,
                        originalData: sentence
                    });
                    log(`✅ Added sentence ${sentenceId}: "${cleanText.substring(0, 100)}..."`);
                } else {
                    log(`⚠️ Sentence ${sentenceId} found but has no valid text:`, sentence);
                }
            } else {
                log(`❌ Sentence ${sentenceId} not found in data`);
                
                // Debug: Show what's actually available
                if (Array.isArray(allSentences)) {
                    log(`🔍 Available array indices: 0-${allSentences.length - 1}`);
                    if (allSentences.length <= 10) {
                        log(`🔍 Sample array content:`, allSentences.map((s, i) => ({ index: i, preview: typeof s === 'string' ? s.substring(0, 50) : JSON.stringify(s).substring(0, 50) })));
                    }
                } else if (allSentences && typeof allSentences === 'object') {
                    const keys = Object.keys(allSentences);
                    log(`🔍 Available object keys:`, keys.slice(0, 10));
                }
            }
        });

        log(`✅ Successfully extracted ${targetSentences.length} target sentences from ${provenanceIds.length} IDs`);
        
        return targetSentences;
    };

    // Function to extract text content from current PDF page
    const getPageTextContent = async (pageNumber) => {
        const cacheKey = `page_${pageNumber}_zoom_${currentZoom}`;
        
        if (pageTextCache.current.has(cacheKey)) {
            return pageTextCache.current.get(cacheKey);
        }

        try {
            const page = await pdfDocument.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });

            // Process text items with position information
            const processedItems = textContent.items.map((item, index) => {
                const transform = item.transform || [1, 0, 0, 1, 0, 0];
                return {
                    text: item.str || '',
                    index: index,
                    x: transform[4],
                    y: transform[5],
                    width: item.width || 0,
                    height: item.height || 0,
                    fontName: item.fontName || 'default',
                    fontSize: item.height || 12,
                    hasEOL: item.hasEOL || false,
                    // Normalized text for searching
                    normalizedText: normalizeText(item.str || '')
                };
            });

            const pageData = {
                items: processedItems,
                viewport: viewport,
                fullText: processedItems.map(item => item.text).join(' '),
                normalizedFullText: processedItems.map(item => item.normalizedText).join(' ')
            };

            pageTextCache.current.set(cacheKey, pageData);
            log(`📝 Cached text content for page ${pageNumber}: ${processedItems.length} items`);
            
            return pageData;

        } catch (error) {
            console.error(`Error extracting text from page ${pageNumber}:`, error);
            return null;
        }
    };

    // Function to search for and highlight a sentence
    const searchAndHighlightSentence = async (targetSentence, pageTextContent) => {
        log(`🔍 Searching for sentence ${targetSentence.id}: "${targetSentence.text.substring(0, 100)}..."`);

        const searchResults = performTextSearch(targetSentence.text, pageTextContent);
        
        if (searchResults.length === 0) {
            log(`❌ No matches found for sentence ${targetSentence.id}`);
            return [];
        }

        log(`✅ Found ${searchResults.length} matches for sentence ${targetSentence.id}`);

        // Create highlight elements for each match
        const highlights = [];
        searchResults.forEach((match, matchIndex) => {
            const highlightElements = createHighlightElements(match, targetSentence, matchIndex);
            highlights.push(...highlightElements);
        });

        return highlights;
    };

    // Core text search function with multiple strategies
    const performTextSearch = (targetText, pageTextContent) => {
        const normalizedTarget = normalizeText(targetText);
        const targetWords = normalizedTarget.split(/\s+/).filter(word => word.length > 0);
        
        if (targetWords.length === 0) {
            return [];
        }

        log(`🔎 Searching for ${targetWords.length} words in ${pageTextContent.items.length} text items`);

        // Strategy 1: Direct substring search
        let matches = findDirectSubstringMatches(normalizedTarget, pageTextContent);
        if (matches.length > 0) {
            log('✅ Found direct substring matches');
            return matches;
        }

        // Strategy 2: Word sequence matching
        matches = findWordSequenceMatches(targetWords, pageTextContent);
        if (matches.length > 0) {
            log('✅ Found word sequence matches');
            return matches;
        }

        // Strategy 3: Fuzzy matching
        matches = findFuzzyMatches(targetWords, pageTextContent);
        if (matches.length > 0) {
            log('✅ Found fuzzy matches');
            return matches;
        }

        return [];
    };

    // Strategy 1: Direct substring search
    const findDirectSubstringMatches = (normalizedTarget, pageTextContent) => {
        const matches = [];
        const fullText = pageTextContent.normalizedFullText;
        
        let startIndex = 0;
        while (true) {
            const foundIndex = fullText.indexOf(normalizedTarget, startIndex);
            if (foundIndex === -1) break;

            // Map back to text items
            const itemSpan = mapTextPositionToItems(foundIndex, foundIndex + normalizedTarget.length, pageTextContent);
            if (itemSpan.length > 0) {
                matches.push({
                    type: 'direct_substring',
                    confidence: 1.0,
                    itemSpan: itemSpan,
                    matchedText: normalizedTarget
                });
            }

            startIndex = foundIndex + 1;
        }

        return matches;
    };

    // Strategy 2: Word sequence matching
    const findWordSequenceMatches = (targetWords, pageTextContent) => {
        const matches = [];
        const items = pageTextContent.items;
        
        // Sliding window approach
        for (let startIdx = 0; startIdx < items.length; startIdx++) {
            const match = findWordSequenceStartingAt(targetWords, items, startIdx);
            if (match) {
                matches.push(match);
            }
        }

        return matches;
    };

    // Strategy 3: Fuzzy matching
    const findFuzzyMatches = (targetWords, pageTextContent) => {
        const matches = [];
        const items = pageTextContent.items;
        
        // Score each potential span
        for (let startIdx = 0; startIdx < items.length; startIdx++) {
            for (let endIdx = startIdx; endIdx < Math.min(startIdx + targetWords.length * 2, items.length); endIdx++) {
                const span = items.slice(startIdx, endIdx + 1);
                const score = calculateFuzzyScore(targetWords, span);
                
                if (score >= searchOptions.matchThreshold) {
                    matches.push({
                        type: 'fuzzy_match',
                        confidence: score,
                        itemSpan: span.map(item => item.index),
                        matchedText: span.map(item => item.text).join(' ')
                    });
                }
            }
        }

        // Sort by confidence and remove overlaps
        return deduplicateMatches(matches);
    };

    // Helper: Find word sequence starting at specific position
    const findWordSequenceStartingAt = (targetWords, items, startIndex) => {
        let wordIndex = 0;
        let itemIndex = startIndex;
        const matchedItems = [];
        let confidence = 0;

        while (wordIndex < targetWords.length && itemIndex < items.length) {
            const item = items[itemIndex];
            const itemWords = item.normalizedText.split(/\s+/).filter(w => w.length > 0);

            let foundInItem = false;
            for (const itemWord of itemWords) {
                if (wordIndex < targetWords.length) {
                    const similarity = calculateStringSimilarity(targetWords[wordIndex], itemWord);
                    if (similarity >= 0.8) {
                        matchedItems.push(item.index);
                        confidence += similarity;
                        wordIndex++;
                        foundInItem = true;
                    }
                }
            }

            if (!foundInItem) {
                // Allow some gaps, but penalize
                confidence -= 0.1;
            }

            itemIndex++;

            // Early termination if confidence too low
            if (confidence < wordIndex * 0.5) {
                break;
            }
        }

        if (wordIndex >= targetWords.length * 0.8) { // Found at least 80% of words
            return {
                type: 'word_sequence',
                confidence: confidence / targetWords.length,
                itemSpan: matchedItems,
                matchedText: matchedItems.map(idx => 
                    items.find(item => item.index === idx)?.text || ''
                ).join(' ')
            };
        }

        return null;
    };

    // Helper: Calculate fuzzy score for a span
    const calculateFuzzyScore = (targetWords, itemSpan) => {
        const spanText = itemSpan.map(item => item.normalizedText).join(' ');
        const spanWords = spanText.split(/\s+/).filter(w => w.length > 0);

        if (spanWords.length === 0) return 0;

        let totalScore = 0;
        let matchedWords = 0;

        targetWords.forEach(targetWord => {
            const bestMatch = spanWords.reduce((best, spanWord) => {
                const similarity = calculateStringSimilarity(targetWord, spanWord);
                return Math.max(best, similarity);
            }, 0);

            if (bestMatch > 0.6) {
                totalScore += bestMatch;
                matchedWords++;
            }
        });

        return matchedWords > 0 ? totalScore / targetWords.length : 0;
    };

    // Helper: Map text position back to item indices
    const mapTextPositionToItems = (startPos, endPos, pageTextContent) => {
        const items = pageTextContent.items;
        const fullText = pageTextContent.normalizedFullText;
        
        let currentPos = 0;
        const result = [];

        for (const item of items) {
            const itemText = item.normalizedText;
            const itemStart = currentPos;
            const itemEnd = currentPos + itemText.length;

            // Check if this item overlaps with target range
            if (itemEnd > startPos && itemStart < endPos) {
                result.push(item.index);
            }

            currentPos = itemEnd + 1; // +1 for space between items
        }

        return result;
    };

    // Helper: Create highlight DOM elements
    const createHighlightElements = (match, targetSentence, matchIndex) => {
        if (!highlightLayerRef.current || !textLayerRef.current) {
            return [];
        }

        const highlights = [];
        const pageContainer = containerRef.current?.querySelector('.pdf-page-container');
        
        if (!pageContainer) {
            log('⚠️ Page container not found');
            return [];
        }

        // Get text elements for each item in the span
        const textElements = match.itemSpan.map(itemIndex => {
            return textLayerRef.current.querySelector(
                `[data-stable-index="${itemIndex}"][data-page-number="${currentPage}"]`
            );
        }).filter(el => el !== null);

        if (textElements.length === 0) {
            log(`⚠️ No text elements found for match ${matchIndex}`);
            return [];
        }

        // Group adjacent elements into continuous highlight regions
        const highlightRegions = groupAdjacentElements(textElements);

        highlightRegions.forEach((region, regionIndex) => {
            const highlightElement = createHighlightElement(region, pageContainer);
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
                
                // Store reference
                const highlightKey = `${targetSentence.id}_${matchIndex}_${regionIndex}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentence: targetSentence,
                    match: match,
                    region: region
                });

                highlights.push(highlightElement);
                
                log(`✨ Created highlight region ${regionIndex + 1} with ${region.length} elements`);
            }
        });

        return highlights;
    };

    // Helper: Group adjacent text elements
    const groupAdjacentElements = (textElements) => {
        if (textElements.length === 0) return [];
        
        const regions = [];
        let currentRegion = [textElements[0]];

        for (let i = 1; i < textElements.length; i++) {
            const prevRect = currentRegion[currentRegion.length - 1].getBoundingClientRect();
            const currentRect = textElements[i].getBoundingClientRect();

            // Check if elements are adjacent
            const isAdjacent = isElementsAdjacent(prevRect, currentRect);

            if (isAdjacent) {
                currentRegion.push(textElements[i]);
            } else {
                regions.push(currentRegion);
                currentRegion = [textElements[i]];
            }
        }

        regions.push(currentRegion);
        return regions;
    };

    // Helper: Check if elements are adjacent
    const isElementsAdjacent = (rect1, rect2) => {
        // Check vertical alignment (same line)
        const verticalOverlap = Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top);
        const minHeight = Math.min(rect1.height, rect2.height);
        const overlapRatio = verticalOverlap / minHeight;

        if (overlapRatio < 0.5) return false;

        // Check horizontal gap
        const horizontalGap = Math.max(0, rect2.left - rect1.right);
        return horizontalGap <= searchOptions.maxGapBetweenWords;
    };

    // Helper: Create single highlight element
    const createHighlightElement = (textElements, pageContainer) => {
        try {
            // Calculate bounding box for all elements
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            const left = Math.min(...rects.map(r => r.left)) - pageRect.left;
            const top = Math.min(...rects.map(r => r.top)) - pageRect.top;
            const right = Math.max(...rects.map(r => r.right)) - pageRect.left;
            const bottom = Math.max(...rects.map(r => r.bottom)) - pageRect.top;

            const highlightElement = document.createElement('div');
            highlightElement.className = className;

            // Apply styles
            Object.assign(highlightElement.style, {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${right - left}px`,
                height: `${bottom - top}px`,
                backgroundColor: highlightStyle.backgroundColor,
                border: highlightStyle.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: '1000',
                opacity: '0.8'
            });

            return highlightElement;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };

    // Utility functions
    const normalizeText = (text) => {
        if (!text) return '';
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const calculateStringSimilarity = (str1, str2) => {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1;

        const distance = levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    };

    const levenshteinDistance = (str1, str2) => {
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
    };

    const deduplicateMatches = (matches) => {
        // Sort by confidence, keep highest scoring non-overlapping matches
        const sorted = matches.sort((a, b) => b.confidence - a.confidence);
        const filtered = [];

        for (const match of sorted) {
            const overlaps = filtered.some(existing => 
                hasOverlap(match.itemSpan, existing.itemSpan)
            );
            if (!overlaps) {
                filtered.push(match);
            }
        }

        return filtered;
    };

    const hasOverlap = (span1, span2) => {
        const set1 = new Set(span1);
        const set2 = new Set(span2);
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        return intersection.size > 0;
    };

    // Function to clear all highlights
    const clearAllHighlights = () => {
        if (!highlightLayerRef.current) return;

        // Remove all highlight elements
        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        // Clear references
        activeHighlights.current.clear();
        log('🧹 Cleared all highlights');
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearAllHighlights();
            pageTextCache.current.clear();
        };
    }, []);

    // This component manages highlights but doesn't render anything
    return null;
};

export default DirectTextHighlighter;