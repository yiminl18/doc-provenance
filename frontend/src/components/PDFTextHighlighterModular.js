// PDFTextHighlighter.js - Refactored to use PDFTextMatcher
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    canvasRef,
    containerRef,
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
    const getProvenanceData = useCallback(() => {
        if (!provenanceData) return { text: '', sentenceIds: [] };

        const text = provenanceData.provenance ||
            provenanceData.content?.join(' ') ||
            provenanceData.text || '';

        const sentenceIds =
            provenanceData?.provenance_ids ||
            provenanceData?.input_sentence_ids || [];

        return { text, sentenceIds };
    }, [provenanceData]);

    // Monitor text layer changes to update stable element references
    useEffect(() => {
        if (textLayerRef?.current && !isRendering) {
            const elements = extractStableTextElements();
            setStableTextElements(elements);
            //console.log(`📊 Updated stable text elements: ${elements.length} elements`);
        }
    }, [textLayerRef?.current, currentPage, currentViewport, isRendering]);

    const updateHighlightPositions = useCallback(() => {
        if (!highlightLayerRef?.current || !textLayerRef?.current) return;

        const highlightLayer = highlightLayerRef.current;
        const textLayer = textLayerRef.current;

        // Update highlight layer to match text layer positioning
        highlightLayer.style.position = textLayer.style.position || 'absolute';
        highlightLayer.style.left = textLayer.style.left || '0px';
        highlightLayer.style.top = textLayer.style.top || '0px';
        highlightLayer.style.width = textLayer.style.width || '100%';
        highlightLayer.style.height = textLayer.style.height || '100%';
        highlightLayer.style.transform = textLayer.style.transform || 'none';

        // Update individual highlight positions
        const highlights = highlightLayer.querySelectorAll('.pdf-stable-highlight.zoom-stable');

        highlights.forEach(overlay => {
            const targetElement = overlay._targetElement;
            if (!targetElement || !targetElement.parentNode) {
                console.warn('⚠️ Target element no longer exists, removing highlight');
                overlay.remove();
                return;
            }

            try {
                // Use the element's current position within the text layer
                const elementStyle = window.getComputedStyle(targetElement);

                let left = parseFloat(elementStyle.left) || 0;
                let top = parseFloat(elementStyle.top) || 0;
                let width = parseFloat(elementStyle.width) || targetElement.offsetWidth;
                let height = parseFloat(elementStyle.height) || targetElement.offsetHeight;

                // If bottom is used instead of top (PDF.js often uses bottom positioning)
                if (elementStyle.bottom && elementStyle.bottom !== 'auto') {
                    const bottom = parseFloat(elementStyle.bottom);
                    const containerHeight = parseFloat(textLayer.style.height) || textLayer.offsetHeight;
                    top = containerHeight - bottom - height;
                }

                // Update overlay position
                overlay.style.left = `${left}px`;
                overlay.style.top = `${top}px`;
                overlay.style.width = `${width}px`;
                overlay.style.height = `${height}px`;

                //console.log(`🔄 Updated highlight ${overlay.getAttribute('data-index')}: ${left},${top} ${width}x${height}`);

            } catch (error) {
                console.warn('⚠️ Failed to update highlight position:', error);
            }
        });

        //console.log(`🔄 Updated positions for ${highlights.length} zoom-stable highlights`);
    }, []);

    // Main effect: highlight text when provenance changes
    useEffect(() => {
        const { text: provenanceText, sentenceIds } = getProvenanceData();
        const provenanceId = provenanceData?.provenance_id;

        const provenanceKey = `${provenanceId}_${questionId}_${currentPage}_${documentId}`;

        /*console.log('🔍 Main highlighting effect triggered:', {
            provenanceKey,
            lastProcessed: lastProcessedProvenanceRef.current,
            hasText: !!provenanceText,
            sentenceIdsCount: sentenceIds.length,
            isRendering,
            stableElementsCount: stableTextElements.length
        });*/

        // Skip if we just processed this exact provenance
        if (lastProcessedProvenanceRef.current === provenanceKey) {
            //console.log('🔄 Skipping re-processing of same provenance:', provenanceKey);
            return;
        }

        if (!provenanceText && sentenceIds.length === 0) {
            //console.log('⏸️ No provenance data to highlight');
            clearHighlights();
            lastProcessedProvenanceRef.current = null;
            return;
        }

        if (!textLayerRef?.current || !highlightLayerRef?.current || isRendering) {
            /*console.log('⏸️ Not ready for highlighting:', {
                textLayer: !!textLayerRef?.current,
                highlightLayer: !!highlightLayerRef?.current,
                isRendering
            });*/
            clearHighlights();
            return;
        }

        // Only proceed if we have stable text elements
        if (stableTextElements.length === 0) {
            //console.log('⏳ Waiting for stable text elements...');
            return;
        }

        //console.log('🎯 Starting highlighting process for provenance:', provenanceId);

        // Mark this provenance as being processed
        lastProcessedProvenanceRef.current = provenanceKey;
        setCurrentProvenanceId(provenanceId);

        // Debounce highlighting to prevent rapid re-execution
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            highlightProvenance(provenanceText, sentenceIds, provenanceId);
        }, 150);

    }, [
        provenanceData?.provenance_id,
        provenanceData?.provenance_ids,
        provenanceData?.input_sentence_ids,
        provenanceData?.provenance,
        provenanceData?.content,
        currentPage,
        questionId,
        isRendering,
        stableTextElements.length,
        getProvenanceData
    ]);

    useEffect(() => {
        const handleViewportChange = (event) => {
            debugHighlightingProcess('viewport_change_received', {
                timestamp: event.detail?.timestamp,
                scale: event.detail?.scale,
                page: event.detail?.page
            });

            // Only respond if we're not rendering and highlights exist
            if (!isRendering && highlightsPersisted && stableTextElements.length > 0) {
                //console.log('🔍 Received viewport change event, recreating highlights');

                const { text: provenanceText, sentenceIds } = getProvenanceData();
                const provenanceId = provenanceData?.provenance_id;

                if (provenanceText || sentenceIds.length > 0) {
                    setTimeout(() => {
                        highlightProvenance(provenanceText, sentenceIds, provenanceId);
                    }, 200);
                }
            } else {
                console.log('⏸️ Viewport change ignored:', {
                    isRendering,
                    highlightsPersisted,
                    stableTextElementsCount: stableTextElements.length
                });
            }
        };

        document.addEventListener('pdfViewportChanged', handleViewportChange);
        return () => {
            document.removeEventListener('pdfViewportChanged', handleViewportChange);
        };
    }, [isRendering, highlightsPersisted, stableTextElements.length, getProvenanceData, provenanceData?.provenance_id]);



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
            //console.log(`✅ Found ${stableElements.length} elements with stable IDs`);

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
            //console.log(`⚠️ No stable IDs found, generating indices for ${textLayer.children.length} elements`);

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

    const debugHighlightingProcess = (stage, data = {}) => {
        console.log(`🔍 HIGHLIGHT DEBUG [${stage}]:`, data);

        const textLayer = textLayerRef?.current;
        const highlightLayer = highlightLayerRef?.current;

        if (stage === 'viewport_change_received') {
            console.log('📡 Viewport change notification received');
            console.log('🔍 Current state:', {
                provenanceData: !!provenanceData,
                provenanceId: provenanceData?.provenance_id,
                isRendering,
                stableTextElements: stableTextElements.length,
                textLayerReady: !!textLayer,
                highlightLayerReady: !!highlightLayer
            });
        }

        if (stage === 'before_highlighting') {
            const { text, sentenceIds } = data;
            console.log('🎯 About to start highlighting:', {
                provenanceText: text?.substring(0, 100) + '...',
                sentenceIds: sentenceIds?.slice(0, 5),
                totalSentenceIds: sentenceIds?.length || 0,
                documentId,
                currentPage
            });
        }

        if (stage === 'stable_mappings_attempt') {
            console.log('🗺️ Attempting stable mappings for sentences:', data.sentenceIds);
        }

        if (stage === 'stable_mappings_result') {
            console.log('📊 Stable mappings result:', {
                success: data.success,
                mappingsFound: data.mappingsCount || 0,
                highlightsCreated: data.highlightsCreated || 0
            });
        }

        if (stage === 'text_search_attempt') {
            console.log('🔍 Falling back to text search:', {
                searchText: data.searchText?.substring(0, 50) + '...',
                elementsToSearch: data.elementsCount
            });
        }

        if (stage === 'highlights_created') {
            console.log('✨ Highlights created:', {
                count: data.count,
                type: data.type,
                highlightElements: highlightLayer?.children.length || 0
            });

        }

        if (stage === 'error') {
            console.error('❌ Highlighting error:', data.error);
        }
    };


    /**
     * Main highlighting function using stable mappings
     */
    const highlightProvenance = async (provenanceText, sentenceIds, highlightId) => {
        /*    debugHighlightingProcess('before_highlighting', { 
            text: provenanceText, 
            sentenceIds 
        });*/

        try {
            clearHighlights();
            // Strategy 1: Use stable mappings if available
            if (sentenceIds.length > 0) {

                /* debugHighlightingProcess('stable_mappings_attempt', { 
         sentenceIds 
     });*/
                const success = await highlightUsingStableMappings(sentenceIds, highlightId);
                /* debugHighlightingProcess('stable_mappings_result', { 
                success,
                mappingsCount: success ? sentenceIds.length : 0,
                highlightsCreated: highlightLayerRef?.current?.children.length || 0
            });*/

                if (success) {
                    setHighlightsPersisted(true);
                    /* debugHighlightingProcess('highlights_created', {
                         count: highlightLayerRef?.current?.children.length || 0,
                         type: 'stable_mappings'
                     });*/
                    return;
                }
            }

            // Strategy 2: Fall back to text search
            if (provenanceText && provenanceText.length > 3) {
                /* debugHighlightingProcess('text_search_attempt', {
                     searchText: provenanceText,
                     elementsCount: stableTextElements.length
                 });*/

                const success = await highlightUsingTextSearch(provenanceText, highlightId);
                if (success) {
                    setHighlightsPersisted(true);
                    /*debugHighlightingProcess('highlights_created', {
                        count: highlightLayerRef?.current?.children.length || 0,
                        type: 'text_search'
                    });*/
                    return;
                }
            }

            // Strategy 3: Create fallback highlight
            //console.log('⚠️ No highlighting method succeeded, creating fallback');
            createFallbackHighlight(provenanceText || 'Provenance content', highlightId);
            setHighlightsPersisted(true);

            /* debugHighlightingProcess('highlights_created', {
                 count: 1,
                 type: 'fallback'
             });*/

        } catch (error) {
            //debugHighlightingProcess('error', { error });
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
                //console.log('⚠️ No stable mappings available');
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
                        if (match.item_span && match.item_span.length > 1) {
                            const spanIndices = match.item_span
                                // find the stable elements for the span
                                .map(spanIndex => stableTextElements.find(el => el.stableIndex === spanIndex))
                                .filter(el => el); // Filter out any undefined elements

                            spanIndices.forEach((el, index) => {
                                if (index > 0) {
                                    highlights.push({
                                        element: el.element,
                                        elementText: el.text,
                                        confidence: match.confidence, // keep the confidence from the match
                                        matchType: 'stable_mapping_span',
                                        strategy: match.match_strategy || 'mapping',
                                        sentenceId,
                                        stableIndex: el.stableIndex,
                                        matchedText: el.text,
                                    });
                                }
                            });
                        }
                    });
                }
            });

            if (highlights.length > 0) {
                //console.log(`✅ Created ${highlights.length} stable mapping highlights`);
                createHighlightElements(highlights, highlightId);
                setActiveHighlights(highlights);
                return true;
            }

           //console.log('⚠️ No stable elements found for current page');
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
            return stableElement;
        }

        // Strategy 2: Text content matching with selectors
        if (match.selectors && match.selectors.length > 0) {
            for (const selector of match.selectors.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
                stableElement = findElementBySelector(selector);
                if (stableElement) {
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
                return stableElement;
            }
        }

        //console.log(`❌ Could not find stable element for index ${targetIndex}`);
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

        //console.log(`🎨 Creating ${highlights.length} highlight elements`);

        highlights.forEach((highlight, index) => {
            const highlightElement = createSingleHighlight(highlight, index, highlightId);
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
            }
        });

        //console.log(`✅ Created highlights for provenance`);
    };

    // Add this to your createSingleHighlight function for precise debugging
    const createSingleHighlight = (highlight, index, highlightId) => {
        if (!highlight.element || !highlightLayerRef?.current) return null;

        const element = highlight.element;
        const textLayer = textLayerRef.current;
        const highlightLayer = highlightLayerRef.current;
        const canvas = canvasRef?.current;

        const elementRect = element.getBoundingClientRect();
        const textLayerRect = textLayer.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        const left = elementRect.left - textLayerRect.left;
        const top = elementRect.top - textLayerRect.top;
        const width = elementRect.width;
        const height = elementRect.height;

        // DEBUGGING: Check for common offset sources
        const elementStyle = window.getComputedStyle(element);
        const textLayerStyle = window.getComputedStyle(textLayer);

        // VALIDATION: Check for coordinate system issues
        const isOffsetCorrect = Math.abs(textLayerRect.left - canvasRect.left) < 2 &&
            Math.abs(textLayerRect.top - canvasRect.top) < 2;

        if (!isOffsetCorrect) {
            console.warn('⚠️ Text layer not aligned with canvas!', {
                textLayerOffset: {
                    left: textLayerRect.left - canvasRect.left,
                    top: textLayerRect.top - canvasRect.top
                },
                canvasPosition: { left: canvasRect.left, top: canvasRect.top },
                textLayerPosition: { left: textLayerRect.left, top: textLayerRect.top }
            });
        }

        /*console.log(`🎯 PRECISE POSITIONING for "${element.textContent.substring(0, 20)}":`, {
            method: "DOM bounding rects (fixed coordinate system)",
            elementRect: {
                left: elementRect.left,
                top: elementRect.top,
                width: elementRect.width,
                height: elementRect.height
            },
            textLayerRect: {
                left: textLayerRect.left,
                top: textLayerRect.top
            },
            calculatedHighlightPosition: { left, top, width, height },
            alignmentCheck: isOffsetCorrect ? '✅ Aligned' : '❌ Misaligned'
        });*/

        // Element CSS
        const elementCSS = {
            position: elementStyle.position,
            left: elementStyle.left,
            top: elementStyle.top,
            bottom: elementStyle.bottom,
            fontSize: elementStyle.fontSize,
            lineHeight: elementStyle.lineHeight,
            transform: elementStyle.transform,
            margin: elementStyle.margin,
            padding: elementStyle.padding,
            border: elementStyle.border
        }


        // Calculated highlight position
        const highlightPosition = { left, top, width, height }

        // Potential offsets
        const potentialOffsets = {
            borderOffset: 2, // Your highlight has 2px border
            fontDescender: parseFloat(elementStyle.fontSize) * 0.2, // Rough estimate
            lineHeightOffset: parseFloat(elementStyle.lineHeight) || 0
        }

        /*console.logconsole.log(`🔍 PRECISE DEBUG for "${element.textContent.substring(0, 20)}":`, {
            // Element positioning
            elementRect: {
                left: elementRect.left,
                top: elementRect.top,
                bottom: elementRect.bottom,
                width: elementRect.width,
                height: elementRect.height
            },

            // Element CSS
            elementCSS,

            // Text layer info
            textLayerRect: {
                left: textLayerRect.left,
                top: textLayerRect.top,
                width: textLayerRect.width,
                height: textLayerRect.height
            },

            // Calculated highlight position
            highlightPosition,

            // Potential offsets
            potentialOffsets
        });*/

        // TEST: Try different positioning strategies
        const strategies = {
            current: { left, top },
            borderAdjusted: { left: left - potentialOffsets.borderOffset, top: top - potentialOffsets.borderOffset },
            fontAdjusted: { left, top: top - parseFloat(elementStyle.fontSize) * 0.1 },
            bothAdjusted: { left: left - potentialOffsets.borderOffset, top: top - parseFloat(elementStyle.fontSize) * 0.1 }
        };

        //console.log(`🎯 Position strategies for testing:`, strategies);

        // Use current strategy for now, but log alternatives
        const overlay = document.createElement('div');
        overlay.className = 'pdf-stable-highlight zoom-stable';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);

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
        transform: none;
        margin: 0;
        padding: 0;
    `;

        overlay.title = createTooltip(highlight);
        addHighlightEventHandlers(overlay, highlight, index);

        return overlay;
    };

    // Debug a specific text element vs its highlight positioning
    const debugSpecificElementHighlight = () => {
        const textLayer = textLayerRef?.current;
        const highlightLayer = highlightLayerRef?.current;

        if (!textLayer || !highlightLayer) return;

        // Find the first text element and its highlight
        const textElements = getTextElements();

        // Strategy 1: Direct stable index match
        let stableElement = stableTextElements.find(el => el.stableIndex === 256);


        const highlight = highlightLayer.querySelector('.pdf-stable-highlight');

        // Use the new smart element finder with span remapping
        //const result = findElementBySelector(highlight, textElements);

        if (!stableElement || !highlight) {
            console.log('❌ No text element or highlight found for comparison');
            return;
        }

        //console.log('🔍 SPECIFIC ELEMENT vs HIGHLIGHT DEBUG:');
        //console.log('Stable Element:', stableElement);
        //console.log('Highlight Element:', highlight);

        // Get absolute positions
        const textRect = stableElement.getBoundingClientRect();
        const highlightRect = highlight.getBoundingClientRect();
        const textLayerRect = textLayer.getBoundingClientRect();
        const highlightLayerRect = highlightLayer.getBoundingClientRect();

        /*console.log('Text Element:', {
            text: stableElement.textContent.substring(0, 30),
            absolutePosition: {
                left: textRect.left,
                top: textRect.top,
                width: textRect.width,
                height: textRect.height
            },
            relativeToTextLayer: {
                left: textRect.left - textLayerRect.left,
                top: textRect.top - textLayerRect.top
            },
            cssStyle: {
                left: stableElement.style.left,
                top: stableElement.style.top,
                bottom: stableElement.style.bottom,
                fontSize: stableElement.style.fontSize
            }
        });

        console.log('Highlight Element:', {
            absolutePosition: {
                left: highlightRect.left,
                top: highlightRect.top,
                width: highlightRect.width,
                height: highlightRect.height
            },
            relativeToHighlightLayer: {
                left: highlightRect.left - highlightLayerRect.left,
                top: highlightRect.top - highlightLayerRect.top
            },
            cssStyle: {
                left: highlight.style.left,
                top: highlight.style.top,
                width: highlight.style.width,
                height: highlight.style.height
            }
        });*/

        // Calculate the actual visual offset
        const visualOffset = {
            left: highlightRect.left - textRect.left,
            top: highlightRect.top - textRect.top,
            width: highlightRect.width - textRect.width,
            height: highlightRect.height - textRect.height
        };

        //console.log('Visual Offset (highlight vs text):', visualOffset);

        // Layer positioning comparison
        const layerOffset = {
            left: highlightLayerRect.left - textLayerRect.left,
            top: highlightLayerRect.top - textLayerRect.top
        };

        //console.log('Layer Offset (highlight layer vs text layer):', layerOffset);

        // Expected vs actual highlight position
        const expectedHighlightPosition = {
            left: textRect.left - textLayerRect.left,
            top: textRect.top - textLayerRect.top
        };

        const actualHighlightPosition = {
            left: parseFloat(highlight.style.left),
            top: parseFloat(highlight.style.top)
        };

        //console.log('Expected highlight position:', expectedHighlightPosition);
        //console.log('Actual highlight position:', actualHighlightPosition);

        const positionDifference = {
            left: actualHighlightPosition.left - expectedHighlightPosition.left,
            top: actualHighlightPosition.top - expectedHighlightPosition.top
        };

        //console.log('Position calculation difference:', positionDifference);

        // Identify the issue
        if (Math.abs(layerOffset.left) > 2 || Math.abs(layerOffset.top) > 2) {
            console.error('❌ ISSUE: Highlight layer is offset from text layer');
            console.log('Fix: Correct highlight layer positioning');
        } else if (Math.abs(positionDifference.left) > 2 || Math.abs(positionDifference.top) > 2) {
            console.error('❌ ISSUE: Highlight position calculation is incorrect');
            console.log('Fix: Adjust highlight position calculation');
        } else if (Math.abs(visualOffset.left) > 2 || Math.abs(visualOffset.top) > 2) {
            console.error('❌ ISSUE: Visual misalignment despite correct calculations');
            console.log('Possible causes: CSS transforms, font metrics, border effects');
        } else {
            console.log('✅ Positioning appears correct');
        }

        return {
            visualOffset,
            layerOffset,
            positionDifference,
            stableElement,
            highlight
        };
    };

    // Add this to your highlighting code to test specific elements
    window.debugElementHighlight = debugSpecificElementHighlight;

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
            //console.log(`📍 Clicked stable highlight ${index}:`, highlight);

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
    const createFallbackHighlight = (highlight, index, highlightId) => {
        const overlay = document.createElement('div');
        overlay.className = 'pdf-stable-highlight-fallback';
        overlay.textContent = '📍';
        overlay.style.left = '20px';
        overlay.style.top = `${20 + (index * 50)}px`;
        overlay.style.width = '30px';
        overlay.style.height = '30px';
        overlay.title = `Fallback highlight for: ${highlight.elementText?.substring(0, 50)}`;

        console.warn(`⚠️ Created fallback highlight for problematic element`);

        return overlay;
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
        //console.log(`🔍 Highlighting using mappings for: "${searchText.substring(0, 100)}..."`);

        try {
            // Get sentence IDs from provenance data
            const sentenceIds = provenanceData?.sentences_ids ||
                provenanceData?.provenance_ids ||
                provenanceData?.input_sentence_ids || [];

            if (sentenceIds.length === 0) {
                //console.log('⚠️ No sentence IDs found in provenance data');
                createFallbackHighlight(searchText, highlightId);
                return;
            }

            //console.log('🎯 Looking for sentence IDs:', sentenceIds);

            // Get the pre-computed mappings
            const mappings = await getSentenceItemMappings(documentId, sentenceIds);
            //console.log('📄 Retrieved mappings:', mappings);

            if (!mappings || !mappings.sentence_mappings) {
                //console.log('⚠️ No sentence mappings found, falling back to text search');
                // Fall back to your existing text search
                await highlightProvenanceTextOld(searchText, highlightId);
                return;
            }

            // In your highlightProvenanceText function, after getting the response:
            //console.log('📄 Retrieved filtered mappings:', mappings);

            // Add this to see the structure clearly:
            /*Object.entries(mappings.sentence_mappings).forEach(([sentenceId, sentenceMapping]) => {
                console.log(`📝 Sentence ${sentenceId}:`, sentenceMapping.text.substring(0, 100));
                console.log(`🎯 Element matches:`, sentenceMapping.stable_matches.length);

                sentenceMapping.stable_matches.forEach((match, i) => {
                    console.log(`   Match ${i}: page ${match.page}, confidence ${match.confidence}`);
                    console.log(`   Strategy: ${match.match_strategy}`);
                    console.log(`   Text: "${match.matched_text?.substring(0, 50)}..."`);
                });
            });*/

            // Find matching elements for current page
            const highlights = [];

            Object.entries(mappings.sentence_mappings).forEach(([sentenceId, sentenceMapping]) => {

                if (sentenceMapping && sentenceMapping.stable_matches) {
                   //console.log(`📝 Found mapping for sentence ${sentenceId}:`, sentenceMapping);

                    // Filter matches for current page
                    const currentPageMatches = sentenceMapping.stable_matches.filter(
                        match => match.page === currentPage
                    );

                    if (currentPageMatches.length > 0) {
                        //console.log(`✅ Found ${currentPageMatches.length} matches on page ${currentPage} for sentence ${sentenceId}`);

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
                //console.log(`🎨 Creating highlights for ${highlights.length} mapped elements`);
                createHighlightsFromMappings(highlights, highlightId);
                setActiveHighlights(highlights);
                setHighlightsPersisted(true);
            } else {
                //console.log('⚠️ No highlights found for current page, creating fallback');
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

        //console.log(`🎨 Creating ${highlights.length} highlights from mappings`);

        highlights.forEach((highlight, index) => {
            const textElements = getTextElements();

            // Use the new smart element finder with span remapping
            const result = findElementBySelector(highlight, textElements);

            if (result && result.elements && result.elements.length > 0) {
                //console.log(`✅ Found ${result.elements.length} elements using ${result.method}`);

                // Create highlights for all elements in the span
                result.elements.forEach((element, spanIndex) => {
                    if (element) {
                        //console.log(`   Highlighting span element ${spanIndex}: "${element.textContent.substring(0, 30)}..."`);

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
            //console.log('🎯 Clicked mapping highlight:', highlight);

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
            //console.log('⚠️ Search text too short, skipping');
            return;
        }

        clearHighlights();
        //console.log(`🔍 Highlighting with PDFTextMatcher: "${searchText.substring(0, 100)}..."`);

        try {
            await waitForTextLayer();

            // Get text elements
            const textElements = getTextElements();
            if (textElements.length === 0) {
                console.warn('⚠️ No text elements found');
                createFallbackHighlight(searchText, highlightId);
                return;
            }

            //console.log(`📄 Found ${textElements.length} text elements to search`);

            // Use PDFTextMatcher to find matches
            const matches = findTextMatches(textElements, searchText, {
                debug: true,
                minMatchLength: 3,
                maxCandidates: 20
            });

            //console.log(`🎯 PDFTextMatcher found ${matches.length} matches`);

            if (matches.length > 0) {
                // Log top matches for debugging
                /*matches.slice(0, 3).forEach((match, i) => {
                    console.log(`   ${i + 1}. "${match.elementText.substring(0, 50)}..." (${match.matchType}, conf: ${match.confidence.toFixed(2)}, strategy: ${match.strategy})`);
                });*/

                // Filter to high-quality matches if we have many
                const qualityMatches = matches.length > 10
                    ? findHighConfidenceMatches(textElements, searchText, 0.6)
                    : matches;

                //console.log(`📊 Using ${qualityMatches.length} quality matches for highlighting`);

                // Create visual highlights from matches
                createHighlightElements(qualityMatches, highlightId);
                setActiveHighlights(qualityMatches);
                setHighlightsPersisted(true);
            } else {
                //console.log('⚠️ No matches found, creating fallback');
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

        const firstHighlight = highlightLayerRef.current.querySelector('.pdf-stable-highlight');
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

        const highlights = highlightLayerRef.current.querySelectorAll('.pdf-stable-highlight');
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