// PDFTextHighlighter.js - Refactored to use PDFTextMatcher
import React, { useState, useEffect, useRef } from 'react';
import { findTextMatches, findHighConfidenceMatches, testTextMatching } from './PDFTextMatcher';
import { getSentenceElementMappings } from '../services/api';

/**
 * PDFTextHighlighter component that uses PDFTextMatcher for text matching
 * and focuses on DOM manipulation and highlighting
 */
export function PDFTextHighlighterModular({
    documentId,
    currentPage,
    provenanceData,
    textLayerRef, // Reference to the PDF.js text layer
    highlightLayerRef, // Reference to highlight overlay layer
    currentViewport, // Current PDF.js viewport
    onHighlightClick = null,
    isRendering = false
}) {
    const [activeHighlights, setActiveHighlights] = useState([]);
    const [highlightsPersisted, setHighlightsPersisted] = useState(false);
    const [currentProvenanceId, setCurrentProvenanceId] = useState(null);
    const highlightElementsRef = useRef(new Map());
    const searchTimeoutRef = useRef(null);

    // Extract provenance text from the provenance data
    const getProvenanceText = () => {
        if (!provenanceData) return '';

        // Try different possible text sources
        return provenanceData.provenance ||
            provenanceData.content?.join(' ') ||
            provenanceData.text ||
            '';
    };

    // Main effect: highlight text when provenance changes
    useEffect(() => {
        const provenanceText = getProvenanceText();
        const provenanceId = provenanceData?.provenance_id;

        if (!provenanceText || !textLayerRef?.current || !highlightLayerRef?.current || isRendering) {
            clearHighlights();
            return;
        }

        // Check if we need to create new highlights
        if (provenanceId !== currentProvenanceId || !highlightsPersisted) {
            console.log('🎯 PDFTextHighlighter: Creating highlights for provenance:', provenanceId);
            setCurrentProvenanceId(provenanceId);

            // Debounce the highlighting to avoid rapid re-renders
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }

            searchTimeoutRef.current = setTimeout(() => {
                highlightProvenanceText(provenanceText, provenanceId);
            }, 100);
        }
    }, [provenanceData, currentPage, currentViewport, isRendering, currentProvenanceId, highlightsPersisted]);

    const highlightProvenanceText = async (searchText, highlightId) => {
        if (!searchText || searchText.length < 3) {
            console.log('⚠️ Search text too short, skipping');
            return;
        }

        clearHighlights();
        console.log(`🔍 Highlighting using mappings for: "${searchText.substring(0, 100)}..."`);

        try {
            // Get sentence IDs from provenance data
            const sentenceIds = provenanceData?.sentences_ids ||
                provenanceData?.provenance_ids ||
                provenanceData?.input_sentence_ids || [];

            if (sentenceIds.length === 0) {
                console.log('⚠️ No sentence IDs found in provenance data');
                createFallbackHighlight(searchText, highlightId);
                return;
            }

            console.log('🎯 Looking for sentence IDs:', sentenceIds);

            // Get the pre-computed mappings
            const mappings = await getSentenceElementMappings(documentId, sentenceIds);
            console.log('📄 Retrieved mappings:', mappings);

            if (!mappings || !mappings.sentence_mappings) {
                console.log('⚠️ No sentence mappings found, falling back to text search');
                // Fall back to your existing text search
                await highlightProvenanceTextOld(searchText, highlightId);
                return;
            }

            // In your highlightProvenanceText function, after getting the response:
            console.log('📄 Retrieved filtered mappings:', mappings);

            // Add this to see the structure clearly:
            Object.entries(mappings.sentence_mappings).forEach(([sentenceId, sentenceMapping]) => {
                console.log(`📝 Sentence ${sentenceId}:`, sentenceMapping.text.substring(0, 100));
                console.log(`🎯 Element matches:`, sentenceMapping.element_matches.length);

                sentenceMapping.element_matches.forEach((match, i) => {
                    console.log(`   Match ${i}: page ${match.page}, element ${match.element_index}, confidence ${match.confidence}`);
                    console.log(`   Strategy: ${match.match_strategy}`);
                    console.log(`   Text: "${match.matched_text?.substring(0, 50)}..."`);
                });
            });

            // Find matching elements for current page
            const highlights = [];

            Object.entries(mappings.sentence_mappings).forEach(([sentenceId, sentenceMapping]) => {

                if (sentenceMapping && sentenceMapping.element_matches) {
                    console.log(`📝 Found mapping for sentence ${sentenceId}:`, sentenceMapping);

                    // Filter matches for current page
                    const currentPageMatches = sentenceMapping.element_matches.filter(
                        match => match.page === currentPage
                    );

                    if (currentPageMatches.length > 0) {
                        console.log(`✅ Found ${currentPageMatches.length} matches on page ${currentPage} for sentence ${sentenceId}`);

                        currentPageMatches.forEach(match => {
                            highlights.push({
                                sentenceId,
                                elementIndices: match.element_span || [match.element_index],
                                confidence: match.confidence,
                                strategy: match.match_strategy,
                                matchedText: match.matched_text,
                                elementIndex: match.element_index, // Primary element
                                selectors: match.selectors
                            });
                        });
                    }
                } else {
                    console.log(`❌ No mapping found for sentence ${sentenceId}`);
                }
            });

            if (highlights.length > 0) {
                console.log(`🎨 Creating highlights for ${highlights.length} mapped elements`);
                createHighlightsFromMappings(highlights, highlightId);
                setActiveHighlights(highlights);
                setHighlightsPersisted(true);
            } else {
                console.log('⚠️ No highlights found for current page, creating fallback');
                createFallbackHighlight(searchText, highlightId);
            }

        } catch (error) {
            console.error('❌ Error using mappings:', error);
            createFallbackHighlight(searchText, highlightId);
        }
    };

    const remapElementSpan = (highlight, textElements, correctElementIndex) => {
    const originalIndex = highlight.elementIndex;
    const offset = correctElementIndex - originalIndex;
    
    console.log(`🔄 Remapping: original index ${originalIndex} → correct index ${correctElementIndex} (offset: ${offset})`);
    
    if (!highlight.elementIndices || highlight.elementIndices.length <= 1) {
        // Single element, no span to remap
        return [correctElementIndex];
    }
    
    // Apply offset to all elements in the span
    const remappedIndices = highlight.elementIndices.map(originalIdx => {
        const newIdx = originalIdx + offset;
        console.log(`   Remapping span element: ${originalIdx} → ${newIdx}`);
        return newIdx;
    });
    
    // Validate that remapped indices are within bounds and contain reasonable text
    const validIndices = remappedIndices.filter(idx => {
        if (idx < 0 || idx >= textElements.length) {
            console.log(`   ❌ Index ${idx} out of bounds`);
            return false;
        }
        
        const elementText = textElements[idx].textContent.trim();
        if (elementText.length === 0) {
            console.log(`   ❌ Index ${idx} has empty text`);
            return false;
        }
        
        console.log(`   ✅ Index ${idx}: "${elementText.substring(0, 30)}..."`);
        return true;
    });
    
    console.log(`🎯 Remapped span: ${highlight.elementIndices.length} → ${validIndices.length} valid elements`);
    return validIndices;
};

   const findElementBySelector = (highlight, textElements) => {
    const { selectors, matchedText, elementIndex } = highlight;
    
    console.log(`🔍 Trying to find element for: "${matchedText?.substring(0, 50)}..."`);
    
    // Strategy 1: Try text content selector
    const textSelector = selectors?.find(s => s.type === 'text_content');
    if (textSelector && textSelector.text_snippet) {
        const targetText = textSelector.text_snippet.toLowerCase();
        console.log(`🎯 Searching for text snippet: "${targetText}"`);
        
        for (let i = 0; i < textElements.length; i++) {
            const elementText = textElements[i].textContent.toLowerCase();
            if (elementText.includes(targetText.substring(0, 20))) {
                console.log(`✅ Found by text selector at index ${i}: "${elementText.substring(0, 50)}..."`);
                
                // NEW: Remap the entire span
                const remappedIndices = remapElementSpan(highlight, textElements, i);
                
                return { 
                    elements: remappedIndices.map(idx => textElements[idx]),
                    indices: remappedIndices,
                    primaryIndex: i, 
                    method: 'text_selector' 
                };
            }
        }
    }
    
    // Strategy 2: Search for key phrases (also with remapping)
    if (matchedText) {
        const keyPhrases = ['ecce 2019', 'september', 'belfast', 'computing machinery'];
        
        for (let i = 0; i < textElements.length; i++) {
            const elementText = textElements[i].textContent.toLowerCase();
            
            const foundPhrases = keyPhrases.filter(phrase => elementText.includes(phrase));
            if (foundPhrases.length > 0) {
                console.log(`✅ Found by key phrases [${foundPhrases.join(', ')}] at index ${i}: "${elementText.substring(0, 50)}..."`);
                
                // NEW: Remap the entire span
                const remappedIndices = remapElementSpan(highlight, textElements, i);
                
                return { 
                    elements: remappedIndices.map(idx => textElements[idx]),
                    indices: remappedIndices,
                    primaryIndex: i, 
                    method: 'key_phrases', 
                    phrases: foundPhrases 
                };
            }
        }
    }
    
    // Strategy 3: Fallback
    console.log(`⚠️ Falling back to original index ${elementIndex}`);
    return { 
        elements: [textElements[elementIndex]],
        indices: [elementIndex],
        primaryIndex: elementIndex, 
        method: 'original_index' 
    };
};

    const createHighlightsFromMappings = (highlights, highlightId) => {
    if (!highlightLayerRef?.current || !textLayerRef?.current) return;

    console.log(`🎨 Creating ${highlights.length} highlights from mappings`);

    highlights.forEach((highlight, index) => {
        const textElements = getTextElements();
        
        // Use the new smart element finder with span remapping
        const result = findElementBySelector(highlight, textElements);
        
        if (result && result.elements && result.elements.length > 0) {
            console.log(`✅ Found ${result.elements.length} elements using ${result.method}`);
            
            // Create highlights for all elements in the span
            result.elements.forEach((element, spanIndex) => {
                if (element) {
                    console.log(`   Highlighting span element ${spanIndex}: "${element.textContent.substring(0, 30)}..."`);
                    
                    const highlightElement = createMappingHighlight(
                        element, 
                        highlight, 
                        `${index}_${spanIndex}`, // Unique ID for each span element
                        highlightId
                    );
                    
                    if (highlightElement) {
                        // Add span info to the highlight
                        highlightElement.setAttribute('data-span-index', spanIndex);
                        highlightElement.setAttribute('data-span-total', result.elements.length);
                        highlightLayerRef.current.appendChild(highlightElement);
                    }
                }
            });
        } else {
            console.log(`❌ Could not find any elements for highlight:`, highlight);
        }
    });
};

    const createMappingHighlight = (element, highlight, index, highlightId) => {
        const rect = element.getBoundingClientRect();
        const highlightLayer = highlightLayerRef.current;
        const layerRect = highlightLayer.getBoundingClientRect();

        // Calculate position relative to highlight layer
        const left = rect.left - layerRect.left;
        const top = rect.top - layerRect.top;
        const width = rect.width;
        const height = rect.height;

        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid dimensions for mapping highlight: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-mapping-highlight';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);
        overlay.setAttribute('data-sentence-id', highlight.sentenceId);
        overlay.setAttribute('data-confidence', highlight.confidence.toFixed(2));
        overlay.setAttribute('data-strategy', highlight.strategy);

        // Bright color to make it obvious
        overlay.style.cssText = `
        position: absolute;
        left: ${left}px;
        top: ${top}px;
        width: ${width}px;
        height: ${height}px;
        background-color: rgba(255, 0, 255, 0.4);
        border: 3px solid rgba(255, 0, 255, 0.8);
        border-radius: 4px;
        z-index: 100;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0.8;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;

        overlay.title = `Mapping Highlight\nSentence: ${highlight.sentenceId}\nStrategy: ${highlight.strategy}\nConfidence: ${(highlight.confidence * 100).toFixed(0)}%\nText: "${highlight.matchedText?.substring(0, 100) || element.textContent.substring(0, 100)}..."`;

        // Simple click handler
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('🎯 Clicked mapping highlight:', highlight);

            if (onHighlightClick) {
                onHighlightClick({
                    index,
                    text: highlight.matchedText || element.textContent,
                    confidence: highlight.confidence,
                    matchType: 'mapping_match',
                    strategy: highlight.strategy,
                    sentenceId: highlight.sentenceId,
                    page: currentPage
                });
            }
        });

        return overlay;
    };

    /**
     * Main highlighting function - now much simpler!
     */
    const highlightProvenanceTextOld = async (searchText, highlightId) => {
        if (!searchText || searchText.length < 3) {
            console.log('⚠️ Search text too short, skipping');
            return;
        }

        clearHighlights();
        console.log(`🔍 Highlighting with PDFTextMatcher: "${searchText.substring(0, 100)}..."`);

        try {
            await waitForTextLayer();

            // Get text elements
            const textElements = getTextElements();
            if (textElements.length === 0) {
                console.warn('⚠️ No text elements found');
                createFallbackHighlight(searchText, highlightId);
                return;
            }

            console.log(`📄 Found ${textElements.length} text elements to search`);

            // Use PDFTextMatcher to find matches
            const matches = findTextMatches(textElements, searchText, {
                debug: true,
                minMatchLength: 3,
                maxCandidates: 20
            });

            console.log(`🎯 PDFTextMatcher found ${matches.length} matches`);

            if (matches.length > 0) {
                // Log top matches for debugging
                matches.slice(0, 3).forEach((match, i) => {
                    console.log(`   ${i + 1}. "${match.elementText.substring(0, 50)}..." (${match.matchType}, conf: ${match.confidence.toFixed(2)}, strategy: ${match.strategy})`);
                });

                // Filter to high-quality matches if we have many
                const qualityMatches = matches.length > 10
                    ? findHighConfidenceMatches(textElements, searchText, 0.6)
                    : matches;

                console.log(`📊 Using ${qualityMatches.length} quality matches for highlighting`);

                // Create visual highlights from matches
                createHighlightElements(qualityMatches, highlightId);
                setActiveHighlights(qualityMatches);
                setHighlightsPersisted(true);
            } else {
                console.log('⚠️ No matches found, creating fallback');
                createFallbackHighlight(searchText, highlightId);
            }

        } catch (error) {
            console.error('❌ Error in highlighting:', error);
            createFallbackHighlight(searchText, highlightId);
        }
    };

    /**
     * Get valid text elements from the PDF.js text layer
     */
    const getTextElements = () => {
        if (!textLayerRef?.current) return [];

        const selectors = ['span[dir="ltr"]', 'span', 'div'];
        let textElements = [];

        for (const selector of selectors) {
            textElements = Array.from(textLayerRef.current.querySelectorAll(selector));
            if (textElements.length > 0) break;
        }

        // Filter out whitespace-only elements
        return textElements.filter(element => {
            const text = element.textContent?.trim();
            return text && text.length > 0 && !/^\s*$/.test(text);
        });
    };

    /**
     * Wait for text layer to be ready
     */
    const waitForTextLayer = async (maxWait = 3000) => {
        const startTime = Date.now();

        while ((!textLayerRef.current || textLayerRef.current.children.length === 0) &&
            (Date.now() - startTime) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!textLayerRef.current || textLayerRef.current.children.length === 0) {
            throw new Error('Text layer not ready after waiting');
        }
    };

    /**
     * Create visual highlight elements from text matches
     */
    const createHighlightElements = (matches, highlightId) => {
        if (!highlightLayerRef?.current || matches.length === 0) return;

        console.log(`🎨 Creating ${matches.length} highlight elements`);

        // Group matches by line for continuous highlighting
        const lineGroups = groupMatchesByLine(matches);
        console.log(`📏 Grouped into ${lineGroups.length} line groups`);

        let highlightsCreated = 0;
        const newHighlights = new Map();

        lineGroups.forEach((lineMatches, lineIndex) => {
            if (lineMatches.length === 1) {
                // Single highlight on line
                const highlightElement = createSingleHighlight(lineMatches[0], highlightsCreated, highlightId);
                if (highlightElement) {
                    newHighlights.set(`${highlightId}_${highlightsCreated}`, highlightElement);
                    highlightsCreated++;
                }
            } else {
                // Multiple highlights on same line - create continuous span
                const continuousHighlight = createContinuousHighlight(lineMatches, highlightsCreated, highlightId);
                if (continuousHighlight) {
                    newHighlights.set(`${highlightId}_${highlightsCreated}`, continuousHighlight);
                    highlightsCreated++;
                }
            }
        });

        highlightElementsRef.current = newHighlights;
        console.log(`✅ Created ${highlightsCreated} highlight elements`);
    };

    /**
     * Group matches by line (same vertical position)
     */
    const groupMatchesByLine = (matches) => {
        const lineGroups = [];
        const lineThreshold = 2; // pixels tolerance for "same line"

        matches.forEach(match => {
            const rect = match.element.getBoundingClientRect();
            const top = rect.top;

            // Find existing line group or create new one
            let lineGroup = lineGroups.find(group => {
                const groupTop = group[0].element.getBoundingClientRect().top;
                return Math.abs(top - groupTop) <= lineThreshold;
            });

            if (!lineGroup) {
                lineGroup = [];
                lineGroups.push(lineGroup);
            }

            lineGroup.push(match);
        });

        // Sort each line group by left position
        lineGroups.forEach(group => {
            group.sort((a, b) => {
                const rectA = a.element.getBoundingClientRect();
                const rectB = b.element.getBoundingClientRect();
                return rectA.left - rectB.left;
            });
        });

        // Sort line groups by top position
        lineGroups.sort((a, b) => {
            const topA = a[0].element.getBoundingClientRect().top;
            const topB = b[0].element.getBoundingClientRect().top;
            return topA - topB;
        });

        return lineGroups;
    };

    /**
     * Create a single highlight element
     */
    const createSingleHighlight = (match, index, highlightId) => {
        if (!match.element || !highlightLayerRef?.current) return null;

        const textElement = match.element;
        const rect = textElement.getBoundingClientRect();
        const highlightLayer = highlightLayerRef.current;
        const layerRect = highlightLayer.getBoundingClientRect();

        // Calculate position relative to highlight layer
        const left = rect.left - layerRect.left;
        const top = rect.top - layerRect.top;
        const width = rect.width;
        const height = rect.height;

        // Skip invalid dimensions
        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid dimensions: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-text-highlighter-overlay';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);
        overlay.setAttribute('data-confidence', match.confidence.toFixed(2));
        overlay.setAttribute('data-match-type', match.matchType);
        overlay.setAttribute('data-strategy', match.strategy);

        // Color coding based on match type and strategy
        const { backgroundColor, borderColor } = getHighlightColors(match);

        overlay.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            width: ${width}px;
            height: ${height}px;
            background-color: ${backgroundColor};
            border: 2px solid ${borderColor};
            border-radius: 3px;
            z-index: 100;
            pointer-events: auto;
            cursor: pointer;
            opacity: ${Math.max(0.6, match.confidence)};
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        `;

        // Create tooltip
        const tooltip = createTooltip(match);
        overlay.title = tooltip;

        // Add event handlers
        addHighlightEventHandlers(overlay, match, index);

        highlightLayerRef.current.appendChild(overlay);
        return overlay;
    };

    /**
     * Create a continuous highlight spanning multiple elements
     */
    const createContinuousHighlight = (lineMatches, index, highlightId) => {
        if (!lineMatches.length || !highlightLayerRef?.current) return null;

        // Calculate bounding box for the entire line span
        const rects = lineMatches.map(m => m.element.getBoundingClientRect());
        const highlightLayer = highlightLayerRef.current;
        const layerRect = highlightLayer.getBoundingClientRect();

        // Find leftmost and rightmost positions
        const leftmost = Math.min(...rects.map(r => r.left));
        const rightmost = Math.max(...rects.map(r => r.right));
        const top = rects[0].top; // All should have same top
        const height = Math.max(...rects.map(r => r.height));

        // Calculate position relative to highlight layer
        const left = leftmost - layerRect.left;
        const relativeTop = top - layerRect.top;
        const width = rightmost - leftmost;

        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid continuous highlight dimensions: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-text-highlighter-overlay continuous';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);
        overlay.setAttribute('data-span-count', lineMatches.length);

        // Use best match for styling
        const bestMatch = lineMatches.reduce((best, match) =>
            match.confidence > best.confidence ? match : best
        );

        const avgConfidence = lineMatches.reduce((sum, m) => sum + m.confidence, 0) / lineMatches.length;
        overlay.setAttribute('data-confidence', avgConfidence.toFixed(2));
        overlay.setAttribute('data-match-type', `continuous_${bestMatch.matchType}`);
        overlay.setAttribute('data-strategy', bestMatch.strategy);

        const { backgroundColor, borderColor } = getHighlightColors(bestMatch);

        overlay.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${relativeTop}px;
            width: ${width}px;
            height: ${height}px;
            background-color: ${backgroundColor};
            border: 2px solid ${borderColor};
            border-radius: 4px;
            z-index: 100;
            pointer-events: auto;
            cursor: pointer;
            opacity: ${Math.max(0.7, avgConfidence)};
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        `;

        // Combine text from all matches in the line
        const combinedText = lineMatches.map(m => m.elementText).join(' ');
        overlay.title = `Continuous highlight (${lineMatches.length} spans)\nAvg Confidence: ${(avgConfidence * 100).toFixed(0)}%\nStrategy: ${bestMatch.strategy}\nText: "${combinedText.substring(0, 150)}${combinedText.length > 150 ? '...' : ''}"`;

        // Add event handlers for continuous highlight
        addHighlightEventHandlers(overlay, {
            ...bestMatch,
            elementText: combinedText,
            isContinuous: true,
            spanCount: lineMatches.length
        }, index);

        highlightLayerRef.current.appendChild(overlay);
        return overlay;
    };

    /**
     * Get colors for highlight based on match type and strategy
     */
    const getHighlightColors = (match) => {
        // Color by strategy first, then by match type
        if (match.strategy === 'simple') {
            if (match.matchType === 'exact_substring' || match.matchType === 'exact_match') {
                return {
                    backgroundColor: 'rgba(76, 175, 80, 0.4)', // Green for exact
                    borderColor: 'rgba(76, 175, 80, 0.8)'
                };
            } else {
                return {
                    backgroundColor: 'rgba(139, 195, 74, 0.4)', // Light green for simple
                    borderColor: 'rgba(139, 195, 74, 0.8)'
                };
            }
        } else if (match.strategy === 'answer_extraction') {
            return {
                backgroundColor: 'rgba(33, 150, 243, 0.4)', // Blue for answer extraction
                borderColor: 'rgba(33, 150, 243, 0.8)'
            };
        } else if (match.strategy === 'phrase') {
            return {
                backgroundColor: 'rgba(255, 193, 7, 0.4)', // Yellow for phrase
                borderColor: 'rgba(255, 193, 7, 0.8)'
            };
        } else if (match.strategy === 'word') {
            return {
                backgroundColor: 'rgba(255, 152, 0, 0.4)', // Orange for word
                borderColor: 'rgba(255, 152, 0, 0.8)'
            };
        } else if (match.strategy === 'fuzzy') {
            return {
                backgroundColor: 'rgba(156, 39, 176, 0.4)', // Purple for fuzzy
                borderColor: 'rgba(156, 39, 176, 0.8)'
            };
        }

        // Default colors
        return {
            backgroundColor: 'rgba(96, 125, 139, 0.4)', // Blue-gray default
            borderColor: 'rgba(96, 125, 139, 0.8)'
        };
    };

    /**
     * Create tooltip text for a match
     */
    const createTooltip = (match) => {
        const strategyDescription = {
            'simple': 'Simple exact/substring matching',
            'answer_extraction': 'Answer pattern extraction',
            'phrase': 'Phrase-based matching',
            'word': 'Word-based matching',
            'fuzzy': 'Fuzzy text similarity'
        };

        let tooltip = `${strategyDescription[match.strategy] || match.strategy}\n`;
        tooltip += `Match Type: ${match.matchType}\n`;
        tooltip += `Confidence: ${(match.confidence * 100).toFixed(0)}%\n`;

        if (match.matchingWords && match.totalWords) {
            tooltip += `Words: ${match.matchingWords.length}/${match.totalWords}\n`;
        }

        if (match.similarity) {
            tooltip += `Similarity: ${(match.similarity * 100).toFixed(0)}%\n`;
        }

        tooltip += `Text: "${match.elementText.substring(0, 100)}${match.elementText.length > 100 ? '...' : ''}"`;

        return tooltip;
    };

    /**
     * Add event handlers to highlight elements
     */
    const addHighlightEventHandlers = (overlay, match, index) => {
        // Click handler
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked highlight ${index}:`, match.matchType, `(${match.strategy})`);

            // Visual feedback
            overlay.style.transform = 'scale(1.05)';
            overlay.style.borderWidth = '3px';
            overlay.style.zIndex = '200';

            setTimeout(() => {
                overlay.style.transform = 'scale(1)';
                overlay.style.borderWidth = '2px';
                overlay.style.zIndex = '100';
            }, 300);

            if (onHighlightClick) {
                onHighlightClick({
                    index,
                    text: match.elementText,
                    confidence: match.confidence,
                    matchType: match.matchType,
                    strategy: match.strategy,
                    searchText: match.searchText,
                    page: currentPage,
                    isContinuous: match.isContinuous || false,
                    spanCount: match.spanCount || 1
                });
            }
        });

        // Hover effects
        overlay.addEventListener('mouseenter', () => {
            overlay.style.transform = 'scale(1.02)';
            overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            overlay.style.zIndex = '150';
        });

        overlay.addEventListener('mouseleave', () => {
            overlay.style.transform = 'scale(1)';
            overlay.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
            overlay.style.zIndex = '100';
        });
    };

    /**
     * Create fallback highlight when no matches found
     */
    const createFallbackHighlight = (searchText, highlightId) => {
        if (!highlightLayerRef?.current) return;

        console.log('🆘 Creating fallback highlight');

        const overlay = document.createElement('div');
        overlay.className = 'pdf-text-highlighter-fallback';
        overlay.setAttribute('data-highlight-id', highlightId);

        overlay.style.cssText = `
            position: absolute;
            left: 20px;
            top: 20px;
            width: 300px;
            height: 40px;
            background-color: rgba(244, 67, 54, 0.9);
            border: 2px solid rgba(244, 67, 54, 1);
            border-radius: 6px;
            z-index: 200;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 13px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;

        overlay.innerHTML = `🔍 No text matches found`;
        overlay.title = `Could not find text matches for: "${searchText.substring(0, 100)}${searchText.length > 100 ? '...' : ''}"`;

        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onHighlightClick) {
                onHighlightClick({
                    index: 0,
                    text: searchText,
                    confidence: 0.0,
                    matchType: 'fallback',
                    strategy: 'fallback',
                    searchText: searchText,
                    page: currentPage
                });
            }
        });

        highlightLayerRef.current.appendChild(overlay);

        // Auto-remove fallback after 5 seconds
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 5000);

        setHighlightsPersisted(true);
    };

    /**
     * Clear all highlights
     */
    const clearHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const overlays = highlightLayerRef.current.querySelectorAll(
            '.pdf-text-highlighter-overlay, .pdf-text-highlighter-fallback'
        );

        console.log(`🧹 Clearing ${overlays.length} highlights`);

        overlays.forEach(overlay => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });

        highlightElementsRef.current.clear();
        setActiveHighlights([]);
        setHighlightsPersisted(false);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
            clearHighlights();
        };
    }, []);

    // This component manages DOM elements directly, no JSX render
    return null;
}

// Export utility functions for debugging
export const PDFTextHighlightingUtils = {
    /**
     * Scroll to the first highlight
     */
    scrollToFirstHighlight: (highlightLayerRef) => {
        if (!highlightLayerRef?.current) return false;

        const firstHighlight = highlightLayerRef.current.querySelector('.pdf-text-highlighter-overlay');
        if (firstHighlight) {
            firstHighlight.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            // Flash effect
            firstHighlight.style.animation = 'highlight-flash 1.5s ease-in-out';
            return true;
        }

        return false;
    },

    /**
     * Get highlight statistics
     */
    getHighlightStats: (highlightLayerRef) => {
        if (!highlightLayerRef?.current) return null;

        const highlights = highlightLayerRef.current.querySelectorAll('.pdf-text-highlighter-overlay');
        const strategies = {};
        const matchTypes = {};
        let totalConfidence = 0;

        highlights.forEach(highlight => {
            const strategy = highlight.getAttribute('data-strategy');
            const matchType = highlight.getAttribute('data-match-type');
            const confidence = parseFloat(highlight.getAttribute('data-confidence'));

            strategies[strategy] = (strategies[strategy] || 0) + 1;
            matchTypes[matchType] = (matchTypes[matchType] || 0) + 1;
            totalConfidence += confidence;
        });

        return {
            totalHighlights: highlights.length,
            averageConfidence: highlights.length > 0 ? totalConfidence / highlights.length : 0,
            strategies,
            matchTypes
        };
    },

    /**
     * Test the text matching with specific cases
     */
    testMatching: (textLayerRef, testCases = []) => {
        if (!textLayerRef?.current) {
            console.log('❌ No text layer reference for testing');
            return;
        }

        const textElements = Array.from(textLayerRef.current.querySelectorAll('*'))
            .filter(el => el.textContent?.trim().length > 0);

        testTextMatching(textElements, testCases);
    },

    /**
     * Debug current text layer
     */
    debugTextLayer: (textLayerRef) => {
        if (!textLayerRef?.current) {
            console.log('❌ No text layer reference');
            return;
        }

        const textLayer = textLayerRef.current;
        console.log('🔍 Text Layer Debug:');
        console.log(`📄 Children: ${textLayer.children.length}`);

        const textElements = Array.from(textLayer.querySelectorAll('*'))
            .filter(el => el.textContent?.trim().length > 0);

        console.log(`📝 Valid text elements: ${textElements.length}`);
        console.log(`📝 First 5 elements:`, textElements.slice(0, 5).map(el =>
            `"${el.textContent.substring(0, 30)}..." (${el.tagName})`
        ));

        const allText = textLayer.textContent;
        console.log(`📝 Total text length: ${allText.length}`);
        console.log(`📝 Sample text: "${allText.substring(0, 200)}..."`);
    }
};

export default PDFTextHighlighterModular;