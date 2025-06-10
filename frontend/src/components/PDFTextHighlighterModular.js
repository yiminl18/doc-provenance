// PDFTextHighlighter.js - Refactored to use PDFTextMatcher
import React, { useState, useEffect, useRef } from 'react';
import { findTextMatches, findHighConfidenceMatches, testTextMatching } from './PDFTextMatcher';
import { getSentenceItemMappings } from '../services/api';

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
    questionId,
    onHighlightClick = null,
    isRendering = false
}) {
    const [activeHighlights, setActiveHighlights] = useState([]);
    const [highlightsPersisted, setHighlightsPersisted] = useState(false);
    const [currentProvenanceId, setCurrentProvenanceId] = useState(null);
    const [stableTextElements, setStableTextElements] = useState([]);
    const highlightElementsRef = useRef(new Map());
    const searchTimeoutRef = useRef(null);
    const lastProcessedProvenanceRef = useRef(null);

    // Extract provenance text from the provenance data
    const getProvenanceData = () => {
        if (!provenanceData) return { text: '', sentenceIds: [] };

        const text = provenanceData.provenance ||
            provenanceData.content?.join(' ') ||
            provenanceData.text || '';

        const sentenceIds = 
            provenanceData?.provenance_ids ||
            provenanceData?.input_sentence_ids || [];

        return { text, sentenceIds };
    };

     // Monitor text layer changes to update stable element references
    useEffect(() => {
        if (textLayerRef?.current && !isRendering) {
            const elements = extractStableTextElements();
            setStableTextElements(elements);
            console.log(`📊 Updated stable text elements: ${elements.length} elements`);
        }
    }, [textLayerRef?.current, currentPage, currentViewport, isRendering]);

    // Main effect: highlight text when provenance changes
   useEffect(() => {
        const { text: provenanceText, sentenceIds } = getProvenanceData();
        const provenanceId = provenanceData?.provenance_id;

        const provenanceKey = `${provenanceId}_${questionId}_${currentPage}_${documentId}`;

        // Skip if we just processed this exact provenance
        if (lastProcessedProvenanceRef.current === provenanceKey) {
            console.log('🔄 Skipping re-processing of same provenance:', provenanceKey);
            return;
        }

        if (!provenanceText && sentenceIds.length === 0) {
            clearHighlights();
            lastProcessedProvenanceRef.current = null;
            return;
        }

        if (!textLayerRef?.current || !highlightLayerRef?.current || isRendering) {
            clearHighlights();
            return;
        }

        // Only proceed if we have stable text elements
        if (stableTextElements.length === 0) {
            console.log('⏳ Waiting for stable text elements...');
            return;
        }

        console.log('🎯 Creating highlights for provenance:', provenanceId);
        
        // Mark this provenance as being processed
        lastProcessedProvenanceRef.current = provenanceKey;
        setCurrentProvenanceId(provenanceId);

        // Debounce highlighting to prevent rapid re-execution
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            highlightProvenance(provenanceText, sentenceIds, provenanceId);
        }, 150); // Slightly longer debounce

    }, [
        provenanceData?.provenance_id, // Only track provenance ID changes
        provenanceData?.provenance_ids, // Track sentence ID changes
        provenanceData?.input_sentence_ids,
        provenanceData?.provenance,
        provenanceData?.content,
        currentPage,
        questionId,
        isRendering,
        stableTextElements.length, // Only track length, not the array itself
        getProvenanceData
    ]);

    /**
     * Extract stable text elements with IDs from the PDF.js text layer
     */
    const extractStableTextElements = () => {
        if (!textLayerRef?.current) return [];

        const textLayer = textLayerRef.current;
        const elements = [];

        // Look for elements with stable identifiers
        const stableElements = textLayer.querySelectorAll('[data-stable-index]');
        
        if (stableElements.length > 0) {
            console.log(`✅ Found ${stableElements.length} elements with stable IDs`);
            
            stableElements.forEach((element, index) => {
                const stableIndex = element.getAttribute('data-stable-index');
                const text = element.textContent?.trim();
                
                if (text && text.length > 0) {
                    elements.push({
                        element,
                        stableIndex: parseInt(stableIndex),
                        text,
                        index // DOM index for fallback
                    });
                }
            });
        } else {
            // Fallback: use regular elements with generated stable indices
            console.log(`⚠️ No stable IDs found, generating indices for ${textLayer.children.length} elements`);
            
            Array.from(textLayer.children).forEach((element, index) => {
                const text = element.textContent?.trim();
                
                if (text && text.length > 0) {
                    // Add stable attributes if missing
                    if (!element.hasAttribute('data-stable-index')) {
                        element.setAttribute('data-stable-index', index);
                        element.setAttribute('data-page-number', currentPage);
                    }
                    
                    elements.push({
                        element,
                        stableIndex: index,
                        text,
                        index
                    });
                }
            });
        }

        return elements;
    };


    /**
     * Main highlighting function using stable mappings
     */
    const highlightProvenance = async (provenanceText, sentenceIds, highlightId) => {
        clearHighlights();

        try {
            // Strategy 1: Use stable mappings if available
            if (sentenceIds.length > 0) {
                console.log(`🗺️ Trying stable mappings for ${sentenceIds.length} sentences`);
                
                const success = await highlightUsingStableMappings(sentenceIds, highlightId);
                if (success) {
                    setHighlightsPersisted(true);
                    return;
                }
            }

            // Strategy 2: Fall back to text search
            if (provenanceText && provenanceText.length > 3) {
                console.log(`🔍 Falling back to text search for: "${provenanceText.substring(0, 100)}..."`);
                
                const success = await highlightUsingTextSearch(provenanceText, highlightId);
                if (success) {
                    setHighlightsPersisted(true);
                    return;
                }
            }

            // Strategy 3: Create fallback highlight
            console.log('⚠️ No highlighting method succeeded, creating fallback');
            createFallbackHighlight(provenanceText || 'Provenance content', highlightId);
            setHighlightsPersisted(true);

        } catch (error) {
            console.error('❌ Error in highlighting:', error);
            createFallbackHighlight(provenanceText || 'Error in highlighting', highlightId);
            setHighlightsPersisted(true);
        }
    };

    /**
     * Highlight using stable element mappings
     */
    const highlightUsingStableMappings = async (sentenceIds, highlightId) => {
        try {
            const mappingsData = await getSentenceItemMappings(documentId, sentenceIds, currentPage);
            
            if (!mappingsData || !mappingsData.sentence_mappings) {
                console.log('⚠️ No stable mappings available');
                return false;
            }

            const highlights = [];
            const sentenceMappings = mappingsData.sentence_mappings;

            Object.entries(sentenceMappings).forEach(([sentenceId, mapping]) => {
                if (mapping.stable_matches && mapping.stable_matches.length > 0) {
                    // Filter matches for current page
                    const pageMatches = mapping.stable_matches.filter(match => match.page === currentPage);
                    
                    pageMatches.forEach(match => {
                        // Find the corresponding stable element
                        const stableElement = findStableElement(match);
                        
                        if (stableElement) {
                            highlights.push({
                                element: stableElement.element,
                                elementText: stableElement.text,
                                confidence: match.confidence,
                                matchType: 'stable_mapping',
                                strategy: match.match_strategy || 'mapping',
                                sentenceId,
                                stableIndex: match.stable_index || match.element_index,
                                matchedText: match.matched_text || stableElement.text
                            });
                        } else {
                            console.log(`⚠️ Could not find stable element for sentence ${sentenceId}, match index ${match.stable_index || match.element_index}`);
                        }

                        // get the item_span indices if available
                        if (match.item_span && match.item_span.length > 0) {
                            const spanIndices = match.item_span
                        // find the stable elements for the span
                            .map(spanIndex => stableTextElements.find(el => el.stableIndex === spanIndex))
                            .filter(el => el); // Filter out any undefined elements

                            spanIndices.forEach((el, index) => {
                                highlights.push({
                                    element: el.element, 
                                    elementText: el.text,
                                    confidence: match.confidence, // keep the confidence from the match
                                    matchType: 'stable_mapping_span',
                                    strategy: match.match_strategy || 'mapping',
                                    sentenceId,
                                    stableIndex: index,
                                    matchedText: el.text,
                                });
                            });
                        }
                    });
                }
            });

            if (highlights.length > 0) {
                console.log(`✅ Created ${highlights.length} stable mapping highlights`);
                createHighlightElements(highlights, highlightId);
                setActiveHighlights(highlights);
                return true;
            }

            console.log('⚠️ No stable elements found for current page');
            return false;

        } catch (error) {
            console.error('❌ Error using stable mappings:', error);
            return false;
        }
    };

    /**
     * Find stable element using multiple strategies
     */
    const findStableElement = (match) => {
        
        const targetIndex = match.stable_index || match.element_index;
        
        // Strategy 1: Direct stable index match
        let stableElement = stableTextElements.find(el => el.stableIndex === targetIndex);
        
        if (stableElement) {
            console.log(`✅ Found element by stable index ${targetIndex}`);
            return stableElement;
        }

        // Strategy 2: Text content matching with selectors
        if (match.selectors && match.selectors.length > 0) {
            for (const selector of match.selectors.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
                stableElement = findElementBySelector(selector);
                if (stableElement) {
                    console.log(`✅ Found element using ${selector.type} selector`);
                    return stableElement;
                }
            }
        }

        // Strategy 3: Text content fuzzy matching
        if (match.matched_text) {
            const matchText = match.matched_text.toLowerCase().trim();
            stableElement = stableTextElements.find(el => {
                const elementText = el.text.toLowerCase().trim();
                return elementText.includes(matchText) || matchText.includes(elementText);
            });
            
            if (stableElement) {
                console.log(`✅ Found element by text matching: "${stableElement.text.substring(0, 30)}..."`);
                return stableElement;
            }
        }

        console.log(`❌ Could not find stable element for index ${targetIndex}`);
        return null;
    };

    /**
     * Find element using selector strategies
     */
    const findElementBySelector = (selector) => {
        if (!textLayerRef?.current) return null;

        try {
            switch (selector.type) {
                case 'stable_index':
                    const element = textLayerRef.current.querySelector(`[data-stable-index="${selector.stable_index}"]`);
                    if (element) {
                        return stableTextElements.find(el => el.element === element);
                    }
                    break;

                case 'text_fingerprint':
                    const fingerprintEl = textLayerRef.current.querySelector(`[data-text-fingerprint="${selector.fingerprint}"]`);
                    if (fingerprintEl) {
                        return stableTextElements.find(el => el.element === fingerprintEl);
                    }
                    break;

                case 'text_content':
                    if (selector.text_snippet) {
                        return stableTextElements.find(el => 
                            el.text.toLowerCase().includes(selector.text_snippet.toLowerCase())
                        );
                    }
                    break;

                default:
                    // Try CSS selector
                    const selectorEl = textLayerRef.current.querySelector(selector.selector);
                    if (selectorEl) {
                        return stableTextElements.find(el => el.element === selectorEl);
                    }
            }
        } catch (error) {
            console.warn(`⚠️ Selector ${selector.type} failed:`, error);
        }

        return null;
    };

    /**
     * Fallback highlighting using text search
     */
    const highlightUsingTextSearch = async (searchText, highlightId) => {
        if (stableTextElements.length === 0) {
            console.log('⚠️ No stable text elements available for text search');
            return false;
        }

        // Use the text matcher to find matches
        const elements = stableTextElements.map(el => el.element);
        const matches = findTextMatches(elements, searchText, { debug: true });

        if (matches.length > 0) {
            console.log(`✅ Found ${matches.length} text search matches`);
            createHighlightElements(matches, highlightId);
            setActiveHighlights(matches);
            return true;
        }

        return false;
    };

    /**
     * Create visual highlight elements
     */
    const createHighlightElements = (highlights, highlightId) => {
        if (!highlightLayerRef?.current || highlights.length === 0) return;

        console.log(`🎨 Creating ${highlights.length} highlight elements`);

        highlights.forEach((highlight, index) => {
            const highlightElement = createSingleHighlight(highlight, index, highlightId);
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
            }
        });

        console.log(`✅ Created highlights for provenance`);
    };

    /**
     * Create a single highlight element
     */
    const createSingleHighlight = (highlight, index, highlightId) => {
        if (!highlight.element || !highlightLayerRef?.current) return null;

        const rect = highlight.element.getBoundingClientRect();
        const highlightLayer = highlightLayerRef.current;
        const layerRect = highlightLayer.getBoundingClientRect();

        const left = rect.left - layerRect.left;
        const top = rect.top - layerRect.top;
        const width = rect.width;
        const height = rect.height;

        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid dimensions: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-stable-highlight';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);
        overlay.setAttribute('data-confidence', highlight.confidence?.toFixed(2) || '1.0');
        overlay.setAttribute('data-match-type', highlight.matchType || 'stable_mapping');
        overlay.setAttribute('data-strategy', highlight.strategy || 'mapping');

        // Color coding based on strategy and confidence
        const { backgroundColor, borderColor } = getHighlightColors(highlight);

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
            opacity: ${Math.max(0.7, highlight.confidence || 0.8)};
            transition: all 0.2s ease;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        `;

        // Tooltip
        overlay.title = createTooltip(highlight);

        // Event handlers
        addHighlightEventHandlers(overlay, highlight, index);

        return overlay;
    };

    /**
     * Get colors based on highlight strategy
     */
    const getHighlightColors = (highlight) => {
        if (highlight.strategy === 'mapping' || highlight.matchType === 'stable_mapping') {
            return {
                backgroundColor: 'rgba(76, 175, 80, 0.4)', // Green for stable mappings
                borderColor: 'rgba(76, 175, 80, 0.8)'
            };
        } else if (highlight.strategy === 'simple' || highlight.matchType === 'exact_substring') {
            return {
                backgroundColor: 'rgba(33, 150, 243, 0.4)', // Blue for exact matches
                borderColor: 'rgba(33, 150, 243, 0.8)'
            };
        } else {
            return {
                backgroundColor: 'rgba(255, 193, 7, 0.4)', // Yellow for other matches
                borderColor: 'rgba(255, 193, 7, 0.8)'
            };
        }
    };

    /**
     * Create tooltip for highlight
     */
    const createTooltip = (highlight) => {
        let tooltip = `Strategy: ${highlight.strategy || 'Unknown'}\n`;
        tooltip += `Match Type: ${highlight.matchType || 'Unknown'}\n`;
        tooltip += `Confidence: ${((highlight.confidence || 0.8) * 100).toFixed(0)}%\n`;
        
        if (highlight.sentenceId) {
            tooltip += `Sentence ID: ${highlight.sentenceId}\n`;
        }
        
        if (highlight.stableIndex !== undefined) {
            tooltip += `Stable Index: ${highlight.stableIndex}\n`;
        }
        
        tooltip += `Text: "${(highlight.elementText || highlight.matchedText || '').substring(0, 100)}..."`;

        return tooltip;
    };

    /**
     * Add event handlers to highlights
     */
    const addHighlightEventHandlers = (overlay, highlight, index) => {
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked stable highlight ${index}:`, highlight);

            // Visual feedback
            overlay.style.transform = 'scale(1.05)';
            overlay.style.borderWidth = '3px';

            setTimeout(() => {
                overlay.style.transform = 'scale(1)';
                overlay.style.borderWidth = '2px';
            }, 300);

            if (onHighlightClick) {
                onHighlightClick({
                    index,
                    text: highlight.elementText || highlight.matchedText || '',
                    confidence: highlight.confidence || 0.8,
                    matchType: highlight.matchType || 'stable_mapping',
                    strategy: highlight.strategy || 'mapping',
                    sentenceId: highlight.sentenceId,
                    stableIndex: highlight.stableIndex,
                    page: currentPage
                });
            }
        });

        overlay.addEventListener('mouseenter', () => {
            overlay.style.transform = 'scale(1.02)';
            overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        });

        overlay.addEventListener('mouseleave', () => {
            overlay.style.transform = 'scale(1)';
            overlay.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
        });
    };

    /**
     * Create fallback highlight
     */
    const createFallbackHighlight = (searchText, highlightId) => {
        if (!highlightLayerRef?.current) return;

        console.log('🆘 Creating fallback highlight');

        const overlay = document.createElement('div');
        overlay.className = 'pdf-stable-highlight-fallback';
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

        overlay.innerHTML = `🔍 No stable mappings found`;
        overlay.title = `Could not find highlights for: "${searchText.substring(0, 100)}..."`;

        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onHighlightClick) {
                onHighlightClick({
                    index: 0,
                    text: searchText,
                    confidence: 0.0,
                    matchType: 'fallback',
                    strategy: 'fallback',
                    page: currentPage
                });
            }
        });

        highlightLayerRef.current.appendChild(overlay);

        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 5000);
    };

    /**
     * Clear all highlights
     */
    const clearHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const overlays = highlightLayerRef.current.querySelectorAll(
            '.pdf-stable-highlight, .pdf-stable-highlight-fallback'
        );

        overlays.forEach(overlay => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });

        highlightElementsRef.current.clear();
        setActiveHighlights([]);
        setHighlightsPersisted(false);
    };





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
            const mappings = await getSentenceItemMappings(documentId, sentenceIds);
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
                console.log(`🎯 Element matches:`, sentenceMapping.stable_matches.length);

                sentenceMapping.stable_matches.forEach((match, i) => {
                    console.log(`   Match ${i}: page ${match.page}, confidence ${match.confidence}`);
                    console.log(`   Strategy: ${match.match_strategy}`);
                    console.log(`   Text: "${match.matched_text?.substring(0, 50)}..."`);
                });
            });

            // Find matching elements for current page
            const highlights = [];

            Object.entries(mappings.sentence_mappings).forEach(([sentenceId, sentenceMapping]) => {

                if (sentenceMapping && sentenceMapping.stable_matches) {
                    console.log(`📝 Found mapping for sentence ${sentenceId}:`, sentenceMapping);

                    // Filter matches for current page
                    const currentPageMatches = sentenceMapping.stable_matches.filter(
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