// PDFTextHighlighterFixed.js - Non-interfering version
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { findTextMatches, findHighConfidenceMatches } from './PDFTextMatcher';
import { getSentenceItemMappings } from '../services/api';

/**
 * Fixed PDFTextHighlighter that doesn't interfere with render manager
 */
export function PDFTextHighlighterFixed({
    documentId,
    currentPage,
    provenanceData,
    textLayerRef,
    canvasRef,
    containerRef,
    highlightLayerRef,
    currentViewport,
    questionId,
    isRendering = false,
    onHighlightClick = null
}) {
    // MINIMAL state - don't duplicate render manager state
    const [activeHighlights, setActiveHighlights] = useState([]);
    const [lastProcessedProvenance, setLastProcessedProvenance] = useState(null);
    
    // Refs for cleanup only
    const searchTimeoutRef = useRef(null);
    const highlightElementsRef = useRef(new Map());

    // Extract provenance data
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

    // MAIN EFFECT: Only highlight when provenance changes AND rendering is done
    useEffect(() => {
        const { text: provenanceText, sentenceIds } = getProvenanceData();
        const provenanceId = provenanceData?.provenance_id;
        const provenanceKey = `${provenanceId}_${questionId}_${currentPage}_${documentId}`;

        console.log('🎯 Highlighter effect triggered:', {
            provenanceKey,
            lastProcessed: lastProcessedProvenance,
            isRendering,
            hasText: !!provenanceText,
            sentenceIds: sentenceIds.length
        });

        // CRITICAL: Don't interfere if rendering is happening
        if (isRendering) {
            console.log('⏸️ Highlighting skipped: render manager is busy');
            return;
        }

        // Skip if we just processed this provenance
        if (lastProcessedProvenance === provenanceKey) {
            console.log('⏸️ Highlighting skipped: already processed');
            return;
        }

        // Skip if no provenance data
        if (!provenanceText && sentenceIds.length === 0) {
            clearHighlights();
            setLastProcessedProvenance(null);
            return;
        }

        // Skip if text layer isn't ready
        if (!textLayerRef?.current || !highlightLayerRef?.current) {
            console.log('⏸️ Highlighting skipped: layers not ready');
            return;
        }

        // Mark as processed immediately to prevent re-processing
        setLastProcessedProvenance(provenanceKey);

        // Debounce highlighting
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            highlightProvenance(provenanceText, sentenceIds, provenanceId);
        }, 200); // Slightly longer debounce

    }, [
        provenanceData?.provenance_id,
        provenanceData?.provenance,
        provenanceData?.content,
        currentPage,
        questionId,
        isRendering, // This is key - wait for rendering to complete
        getProvenanceData
    ]);

    // REMOVED: Viewport change listener that was causing conflicts
    // The main component will handle viewport changes properly

    // Main highlighting function
    const highlightProvenance = async (provenanceText, sentenceIds, highlightId) => {
        console.log('🎨 Starting highlighting process');
        
        try {
            clearHighlights();
            
            // Strategy 1: Use stable mappings if available
            if (sentenceIds.length > 0) {
                const success = await highlightUsingStableMappings(sentenceIds, highlightId);
                if (success) {
                    console.log('✅ Highlighting completed using stable mappings');
                    return;
                }
            }

            // Strategy 2: Fall back to text search
            if (provenanceText && provenanceText.length > 3) {
                const success = await highlightUsingTextSearch(provenanceText, highlightId);
                if (success) {
                    console.log('✅ Highlighting completed using text search');
                    return;
                }
            }

            // Strategy 3: Create fallback highlight
            console.log('⚠️ Creating fallback highlight');
            createFallbackHighlight(provenanceText || 'Provenance content');

        } catch (error) {
            console.error('❌ Error in highlighting:', error);
            createFallbackHighlight(provenanceText || 'Error in highlighting');
        }
    };

    // Stable mappings highlighting
    const highlightUsingStableMappings = async (sentenceIds, highlightId) => {
        try {
            console.log('🗺️ Attempting stable mappings for sentences:', sentenceIds);
            
            const mappingsData = await getSentenceItemMappings(documentId, sentenceIds);

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
                        }

                        // Handle item spans
                        if (match.item_span && match.item_span.length > 1) {
                            const spanElements = match.item_span
                                .map(spanIndex => findStableElementByIndex(spanIndex))
                                .filter(el => el);

                            spanElements.forEach((el, index) => {
                                if (index > 0) { // Skip first element (already added above)
                                    highlights.push({
                                        element: el.element,
                                        elementText: el.text,
                                        confidence: match.confidence,
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
                console.log(`✅ Created ${highlights.length} stable mapping highlights`);
                createHighlightElements(highlights);
                setActiveHighlights(highlights);
                return true;
            }

            return false;

        } catch (error) {
            console.error('❌ Error using stable mappings:', error);
            return false;
        }
    };

    // Text search highlighting
    const highlightUsingTextSearch = async (searchText, highlightId) => {
        try {
            console.log('🔍 Attempting text search highlighting');
            
            const textElements = getTextElements();
            if (textElements.length === 0) {
                console.warn('⚠️ No text elements found');
                return false;
            }

            const matches = findTextMatches(textElements, searchText, {
                debug: false, // Reduce console noise
                minMatchLength: 3,
                maxCandidates: 15
            });

            if (matches.length > 0) {
                const qualityMatches = matches.length > 8
                    ? findHighConfidenceMatches(textElements, searchText, 0.6)
                    : matches;

                console.log(`✅ Found ${qualityMatches.length} text search matches`);
                createHighlightElements(qualityMatches);
                setActiveHighlights(qualityMatches);
                return true;
            }

            return false;

        } catch (error) {
            console.error('❌ Error in text search:', error);
            return false;
        }
    };

    // Helper functions
    const getTextElements = () => {
        if (!textLayerRef?.current) return [];

        const selectors = ['span[dir="ltr"]', 'span', 'div'];
        let textElements = [];

        for (const selector of selectors) {
            textElements = Array.from(textLayerRef.current.querySelectorAll(selector));
            if (textElements.length > 0) break;
        }

        return textElements.filter(element => {
            const text = element.textContent?.trim();
            return text && text.length > 0;
        });
    };

    const findStableElement = (match) => {
        const targetIndex = match.stable_index || match.element_index;
        return findStableElementByIndex(targetIndex);
    };

    const findStableElementByIndex = (stableIndex) => {
        if (!textLayerRef?.current) return null;

        const element = textLayerRef.current.querySelector(`[data-stable-index="${stableIndex}"]`);
        if (element) {
            return {
                element,
                stableIndex,
                text: element.textContent?.trim() || ''
            };
        }

        return null;
    };

    // Create visual highlights
    const createHighlightElements = (highlights) => {
        if (!highlightLayerRef?.current || highlights.length === 0) return;

        console.log(`🎨 Creating ${highlights.length} highlight elements`);

        highlights.forEach((highlight, index) => {
            const highlightElement = createSingleHighlight(highlight, index);
            if (highlightElement) {
                highlightLayerRef.current.appendChild(highlightElement);
                highlightElementsRef.current.set(`highlight-${index}`, highlightElement);
            }
        });
    };

    const createSingleHighlight = (highlight, index) => {
        if (!highlight.element || !highlightLayerRef?.current) return null;

        const element = highlight.element;
        const elementRect = element.getBoundingClientRect();
        const highlightLayerRect = highlightLayerRef.current.getBoundingClientRect();

        const left = elementRect.left - highlightLayerRect.left;
        const top = elementRect.top - highlightLayerRect.top;
        const width = elementRect.width;
        const height = elementRect.height;

        if (width <= 0 || height <= 0) {
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-highlight-fixed';
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
            transition: opacity 0.2s ease;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        `;

        overlay.title = `${highlight.matchType} (${((highlight.confidence || 0.8) * 100).toFixed(0)}%): "${(highlight.elementText || '').substring(0, 100)}..."`;

        // Add click handler
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('🎯 Highlight clicked:', highlight);

            if (onHighlightClick) {
                onHighlightClick({
                    index,
                    text: highlight.elementText || highlight.matchedText || '',
                    confidence: highlight.confidence || 0.8,
                    matchType: highlight.matchType || 'highlight',
                    strategy: highlight.strategy || 'unknown',
                    sentenceId: highlight.sentenceId,
                    page: currentPage
                });
            }
        });

        return overlay;
    };

    const getHighlightColors = (highlight) => {
        if (highlight.matchType === 'stable_mapping') {
            return {
                backgroundColor: 'rgba(76, 175, 80, 0.4)',
                borderColor: 'rgba(76, 175, 80, 0.8)'
            };
        } else {
            return {
                backgroundColor: 'rgba(33, 150, 243, 0.4)',
                borderColor: 'rgba(33, 150, 243, 0.8)'
            };
        }
    };

    const createFallbackHighlight = (text) => {
        if (!highlightLayerRef?.current) return;

        const fallback = document.createElement('div');
        fallback.className = 'pdf-highlight-fallback';
        fallback.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            padding: 8px 12px;
            background: rgba(255, 193, 7, 0.9);
            border: 2px solid rgba(255, 193, 7, 1);
            border-radius: 4px;
            font-size: 14px;
            color: #333;
            z-index: 200;
            pointer-events: auto;
        `;
        fallback.textContent = `⚠️ Fallback highlight: ${text.substring(0, 50)}...`;
        
        highlightLayerRef.current.appendChild(fallback);
        highlightElementsRef.current.set('fallback', fallback);
    };

    const clearHighlights = () => {
        if (!highlightLayerRef?.current) return;

        // Clear all highlight elements
        const highlights = highlightLayerRef.current.querySelectorAll(
            '.pdf-highlight-fixed, .pdf-highlight-fallback'
        );

        highlights.forEach(highlight => {
            if (highlight.parentNode) {
                highlight.parentNode.removeChild(highlight);
            }
        });

        highlightElementsRef.current.clear();
        setActiveHighlights([]);
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

    // This component manages DOM directly, no JSX render
    return null;
}

export default PDFTextHighlighterFixed;