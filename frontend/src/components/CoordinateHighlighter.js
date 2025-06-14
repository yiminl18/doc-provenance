// EnhancedDirectTextHighlighter.js - Uses coordinate-based highlighting when available
import React, { useEffect, useRef } from 'react';
import { getDocumentSentences } from '../services/api';

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
    searchOptions = {
        caseSensitive: false,
        matchThreshold: 0.8,
        maxGapBetweenWords: 50,
        contextWindow: 5
    },
    className = 'coordinate-provenance-highlight',
    verbose = true
}) => {
    const activeHighlights = useRef(new Map());
    const pageTextCache = useRef(new Map());
    const sentencesCache = useRef(null);

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

     // Main highlighting effect - FIXED to handle your exact data structure
    useEffect(() => {
        log(`🔄 Highlighting effect triggered:`, {
            provenanceId: provenanceData?.provenance_id,
            
            // CHECK ALL POSSIBLE PROVENANCE ID FIELDS
            provenance_ids: provenanceData?.provenance_ids,
            sentences_ids: provenanceData?.sentences_ids,
            input_sentence_ids: provenanceData?.input_sentence_ids,
            
            hasHighlightData: !!provenanceData?.highlight_data,
            activeQuestionId,
            currentPage,
            documentFilename,
            timestamp: Date.now(),
            
            // FULL PROVENANCE DATA DEBUG
            fullProvenanceData: provenanceData
        });

        if (!provenanceData?.provenance_ids || !documentFilename || !pdfDocument) {
            log('⏸️ Missing required data for highlighting');
            clearAllHighlights();
            return;
        }

        // FIXED: Extract sentence IDs from any available field
        const sentenceIds = getSentenceIds(provenanceData);
        if (!sentenceIds || sentenceIds.length === 0) {
            log('⏸️ No sentence IDs found in provenance data');
            clearAllHighlights();
            return;
        }

        log(`🎯 Found sentence IDs:`, sentenceIds);


        const performHighlighting = async () => {
            try {
                clearAllHighlights();

                // ENHANCED: Check if provenance data includes highlight_data
                if (provenanceData.highlight_data) {
                    log('🎯 Using coordinate-based highlighting from provenance data');
                    await handleCoordinateBasedHighlighting(provenanceData.highlight_data, sentenceIds);
                } else {
                    log('📝 No coordinate data available - would need text-based fallback');
                    log('💡 Ensure your mock server is returning highlight_data in provenance responses');
                }

            } catch (error) {
                console.error('[EnhancedDirectTextHighlighter] Error during highlighting:', error);
                clearAllHighlights();
            }
        };

        const timeoutId = setTimeout(performHighlighting, 100);
        return () => clearTimeout(timeoutId);

    }, [
        provenanceData?.provenance_id,
        
        // WATCH ALL POSSIBLE SENTENCE ID FIELDS
        JSON.stringify(provenanceData?.provenance_ids),
        JSON.stringify(provenanceData?.sentences_ids), 
        JSON.stringify(provenanceData?.input_sentence_ids),
        
        provenanceData?.highlight_data,
        currentPage,
        documentFilename,
        activeQuestionId
    ]);

    // HELPER: Extract sentence IDs from provenance data (handles multiple formats)
    const getSentenceIds = (provenance) => {
        if (!provenance) return null;

        // Try different possible fields in order of preference
        const candidates = [
            provenance.provenance_ids,    // Most common
            provenance.sentences_ids,     // Alternative format
            provenance.input_sentence_ids, // Another alternative
            provenance.sentence_ids       // Just in case
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate) && candidate.length > 0) {
                log(`📋 Using sentence IDs from field with ${candidate.length} items:`, candidate);
                return candidate;
            }
        }

        log('❌ No valid sentence IDs found in any expected field');
        return null;
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

    

    // EXISTING: Text-based highlighting (your original implementation)
    const handleTextBasedHighlighting = async () => {
        log(`🎯 Starting text-based highlighting for provenance ${provenanceData.provenance_id}`);
        
        // Get sentence data
        const sentences = await getSentencesData(documentFilename);
        if (!sentences) {
            log('❌ Failed to load sentences data');
            return;
        }

        // Get target sentences from provenance
        const targetSentences = getTargetSentences(provenanceData.provenance_ids, sentences);
        if (targetSentences.length === 0) {
            log('⚠️ No target sentences found for highlighting');
            return;
        }

        log(`🎯 Found ${targetSentences.length} target sentences to highlight`);

        // Extract and cache page text content
        const pageTextContent = await getPageTextContent(currentPage);
        if (!pageTextContent) {
            log(`❌ Failed to extract text content for page ${currentPage}`);
            return;
        }

        // Search for each target sentence on current page
        let totalHighlights = 0;
        for (const sentence of targetSentences) {
            log(`🔍 Searching for sentence ${sentence.id} on page ${currentPage}`);
            const highlights = await searchAndHighlightSentence(sentence, pageTextContent);
            totalHighlights += highlights.length;
            log(`✅ Found ${highlights.length} highlights for sentence ${sentence.id}`);
        }

        log(`✅ Created ${totalHighlights} text-based highlights on page ${currentPage}`);
    };

    // Your existing functions (keeping them exactly the same)
    const getSentencesData = async (filename) => {
        if (sentencesCache.current) {
            return sentencesCache.current;
        }

        try {
            log(`📄 Loading sentences data for ${filename}`);
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
        
        provenanceIds.forEach((sentenceId, index) => {
            let sentence = null;
            
            if (Array.isArray(allSentences)) {
                sentence = allSentences[sentenceId] || allSentences[parseInt(sentenceId)];
            } else if (allSentences && allSentences.sentences) {
                sentence = allSentences.sentences[sentenceId] || allSentences.sentences[parseInt(sentenceId)];
            } else if (allSentences && typeof allSentences === 'object') {
                sentence = allSentences[sentenceId] || allSentences[parseInt(sentenceId)];
            }
            
            if (sentence) {
                const sentenceText = typeof sentence === 'string' ? sentence : sentence.text || sentence.content || sentence;
                if (sentenceText && sentenceText.trim && sentenceText.trim().length > 0) {
                    const cleanText = sentenceText.trim();
                    targetSentences.push({
                        id: sentenceId,
                        text: cleanText,
                        originalData: sentence
                    });
                }
            }
        });

        return targetSentences;
    };

    

    const getPageTextContent = async (pageNumber) => {
        const cacheKey = `page_${pageNumber}_zoom_${currentZoom}`;
        
        if (pageTextCache.current.has(cacheKey)) {
            return pageTextCache.current.get(cacheKey);
        }

        try {
            const page = await pdfDocument.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });

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
            return pageData;

        } catch (error) {
            console.error(`Error extracting text from page ${pageNumber}:`, error);
            return null;
        }
    };

    const searchAndHighlightSentence = async (targetSentence, pageTextContent) => {
        const searchResults = performTextSearch(targetSentence.text, pageTextContent);
        
        if (searchResults.length === 0) {
            return [];
        }

        const highlights = [];
        searchResults.forEach((match, matchIndex) => {
            const highlightElements = createTextHighlightElements(match, targetSentence, matchIndex);
            highlights.push(...highlightElements);
        });

        return highlights;
    };

    const performTextSearch = (targetText, pageTextContent) => {
        const normalizedTarget = normalizeText(targetText);
        const targetWords = normalizedTarget.split(/\s+/).filter(word => word.length > 0);
        
        if (targetWords.length === 0) {
            return [];
        }

        // Try different search strategies
        let matches = findDirectSubstringMatches(normalizedTarget, pageTextContent);
        if (matches.length > 0) return matches;

        matches = findWordSequenceMatches(targetWords, pageTextContent);
        if (matches.length > 0) return matches;

        matches = findFuzzyMatches(targetWords, pageTextContent);
        return matches;
    };

    // Simplified versions of your search functions (keeping core logic)
    const findDirectSubstringMatches = (normalizedTarget, pageTextContent) => {
        const matches = [];
        const fullText = pageTextContent.normalizedFullText;
        
        let startIndex = 0;
        while (true) {
            const foundIndex = fullText.indexOf(normalizedTarget, startIndex);
            if (foundIndex === -1) break;

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

    const findWordSequenceMatches = (targetWords, pageTextContent) => {
        // Simplified word sequence matching
        const matches = [];
        const items = pageTextContent.items;
        
        for (let startIdx = 0; startIdx < items.length; startIdx++) {
            const match = findWordSequenceStartingAt(targetWords, items, startIdx);
            if (match) {
                matches.push(match);
            }
        }

        return matches;
    };

    const findFuzzyMatches = (targetWords, pageTextContent) => {
        // Simplified fuzzy matching
        return [];
    };

    const createTextHighlightElements = (match, targetSentence, matchIndex) => {
        if (!highlightLayerRef.current || !textLayerRef.current) {
            return [];
        }

        const highlights = [];
        const pageContainer = containerRef.current?.querySelector('.pdf-page-container');
        
        if (!pageContainer) {
            return [];
        }

        const textElements = match.itemSpan.map(itemIndex => {
            return textLayerRef.current.querySelector(
                `[data-stable-index="${itemIndex}"][data-page-number="${currentPage}"]`
            );
        }).filter(el => el !== null);

        if (textElements.length === 0) {
            return [];
        }

        const highlightRegions = groupAdjacentElements(textElements);

        highlightRegions.forEach((region, regionIndex) => {
            const highlightElement = createTextHighlightElement(region, pageContainer);
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
                
                const highlightKey = `text_${targetSentence.id}_${matchIndex}_${regionIndex}`;
                activeHighlights.current.set(highlightKey, {
                    element: highlightElement,
                    sentence: targetSentence,
                    match: match,
                    region: region,
                    type: 'text'
                });

                highlights.push(highlightElement);
            }
        });

        return highlights;
    };

    // Helper functions (keeping your implementations)
    const mapTextPositionToItems = (startPos, endPos, pageTextContent) => {
        const items = pageTextContent.items;
        const fullText = pageTextContent.normalizedFullText;
        
        let currentPos = 0;
        const result = [];

        for (const item of items) {
            const itemText = item.normalizedText;
            const itemStart = currentPos;
            const itemEnd = currentPos + itemText.length;

            if (itemEnd > startPos && itemStart < endPos) {
                result.push(item.index);
            }

            currentPos = itemEnd + 1;
        }

        return result;
    };

    const findWordSequenceStartingAt = (targetWords, items, startIndex) => {
        // Simplified implementation
        let wordIndex = 0;
        let itemIndex = startIndex;
        const matchedItems = [];

        while (wordIndex < targetWords.length && itemIndex < items.length) {
            const item = items[itemIndex];
            const itemWords = item.normalizedText.split(/\s+/).filter(w => w.length > 0);

            for (const itemWord of itemWords) {
                if (wordIndex < targetWords.length && calculateStringSimilarity(targetWords[wordIndex], itemWord) >= 0.8) {
                    matchedItems.push(item.index);
                    wordIndex++;
                    break;
                }
            }

            itemIndex++;
        }

        if (wordIndex >= targetWords.length * 0.8) {
            return {
                type: 'word_sequence',
                confidence: 0.8,
                itemSpan: matchedItems,
                matchedText: matchedItems.map(idx => 
                    items.find(item => item.index === idx)?.text || ''
                ).join(' ')
            };
        }

        return null;
    };

    const groupAdjacentElements = (textElements) => {
        if (textElements.length === 0) return [];
        
        const regions = [];
        let currentRegion = [textElements[0]];

        for (let i = 1; i < textElements.length; i++) {
            const prevRect = currentRegion[currentRegion.length - 1].getBoundingClientRect();
            const currentRect = textElements[i].getBoundingClientRect();

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

    const isElementsAdjacent = (rect1, rect2) => {
        const verticalOverlap = Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top);
        const minHeight = Math.min(rect1.height, rect2.height);
        const overlapRatio = verticalOverlap / minHeight;

        if (overlapRatio < 0.5) return false;

        const horizontalGap = Math.max(0, rect2.left - rect1.right);
        return horizontalGap <= searchOptions.maxGapBetweenWords;
    };

    const createTextHighlightElement = (textElements, pageContainer) => {
        try {
            const rects = textElements.map(el => el.getBoundingClientRect());
            const pageRect = pageContainer.getBoundingClientRect();

            const left = Math.min(...rects.map(r => r.left)) - pageRect.left;
            const top = Math.min(...rects.map(r => r.top)) - pageRect.top;
            const right = Math.max(...rects.map(r => r.right)) - pageRect.left;
            const bottom = Math.max(...rects.map(r => r.bottom)) - pageRect.top;

            const highlightElement = document.createElement('div');
            highlightElement.className = `${className} text-highlight`;

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

    const clearAllHighlights = () => {
        if (!highlightLayerRef.current) return;

        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

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

    return null;
};

export default CoordinateHighlighter;