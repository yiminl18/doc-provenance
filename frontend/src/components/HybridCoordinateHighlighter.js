// HybridCoordinateHighlighter.js - Uses your PDF.js cache with react-pdf
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getSentenceItemMappings } from '../services/api';

const HybridCoordinateHighlighter = ({
    provenanceData,
    activeQuestionId,
    textLayerRef, // pageRef from react-pdf
    highlightLayerRef,
    containerRef,
    currentPage,
    currentZoom,
    documentFilename,
    highlightStyle = {
        backgroundColor: 'rgba(76, 175, 80, 0.4)',
        border: '1px solid rgba(76, 175, 80, 0.8)',
        borderRadius: '2px'
    },
    className = '',
    verbose = false
}) => {
    const [mappingsCache, setMappingsCache] = useState(new Map());
    const [highlightElements, setHighlightElements] = useState([]);
    const [isHighlighting, setIsHighlighting] = useState(false);
    const [error, setError] = useState(null);
    
    const activeHighlightsRef = useRef([]);
    const lastProvenanceIdRef = useRef(null);

    const log = useCallback((...args) => {
        if (verbose) {
            console.log('[HybridHighlighter]', ...args);
        }
    }, [verbose]);

    // Clear all highlights
    const clearHighlights = useCallback(() => {
        if (highlightLayerRef?.current) {
            highlightLayerRef.current.innerHTML = '';
        }
        activeHighlightsRef.current = [];
        setHighlightElements([]);
        log('🧹 Cleared all highlights');
    }, [highlightLayerRef, log]);

    // Get react-pdf canvas for coordinate conversion
    const getReactPdfCanvas = useCallback(() => {
        if (!textLayerRef?.current) return null;
        
        // Find the canvas element that react-pdf creates
        const canvas = textLayerRef.current.querySelector('canvas');
        return canvas;
    }, [textLayerRef]);

    // Convert your cached PDF.js coordinates to react-pdf screen coordinates
    const convertCachedCoordsToScreen = useCallback((cachedElement, canvas) => {
        if (!canvas || !cachedElement.coordinates) return null;

        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = containerRef?.current?.getBoundingClientRect();
        
        if (!containerRect) return null;

        // Your cached coordinates are in PDF.js coordinate space
        const pdfjsCoords = cachedElement.coordinates;
        
        // Convert to screen coordinates accounting for react-pdf scaling
        // React-pdf handles scaling internally, so we need to map from PDF coordinate space to screen space
        const scaleX = 1//canvas.width / canvas.offsetWidth; // Account for device pixel ratio
        const scaleY = 1//canvas.height / canvas.offsetHeight;
        
        const screenCoords = {
            x: (pdfjsCoords.x / scaleX) + (canvasRect.left - containerRect.left),
            y: (pdfjsCoords.y / scaleY) + (canvasRect.top - containerRect.top),
            width: pdfjsCoords.width, /// scaleX,
            height: pdfjsCoords.height /// scaleY
        };

        return screenCoords;
    }, [containerRef]);

    // Create highlight using your cached coordinate data
    const createHighlightFromCachedData = useCallback((cachedElement, highlightId) => {
        const canvas = getReactPdfCanvas();
        if (!canvas) {
            log('❌ No react-pdf canvas found');
            return null;
        }

        const screenCoords = convertCachedCoordsToScreen(cachedElement, canvas);
        if (!screenCoords) {
            log('❌ Could not convert coordinates to screen space');
            return null;
        }

        const highlight = document.createElement('div');
        highlight.className = `coordinate-highlight ${className}`;
        highlight.setAttribute('data-highlight-id', highlightId);
        highlight.setAttribute('data-stable-index', cachedElement.stable_index);
        highlight.setAttribute('data-page', cachedElement.page);

        // Apply positioning and styling
        Object.assign(highlight.style, {
            position: 'absolute',
            left: `${screenCoords.x}px`,
            top: `${screenCoords.y}px`,
            width: `${screenCoords.width}px`,
            height: `${screenCoords.height}px`,
            pointerEvents: 'none',
            zIndex: '5',
            ...highlightStyle
        });

        log(`✨ Created highlight from cached data at (${screenCoords.x.toFixed(0)}, ${screenCoords.y.toFixed(0)})`);
        
        return highlight;
    }, [getReactPdfCanvas, convertCachedCoordsToScreen, highlightStyle, className, log]);

    // Apply highlights using your existing stable mappings
    const applyHighlights = useCallback(async () => {
        if (!provenanceData || !documentFilename || !highlightLayerRef?.current) {
            log('❌ Missing required data for highlighting');
            return;
        }

        setIsHighlighting(true);
        setError(null);
        clearHighlights();

        try {
            const sentenceIds = provenanceData.provenance_ids || provenanceData.sentences_ids;
            
            if (!sentenceIds || sentenceIds.length === 0) {
                log('⚠️ No sentence IDs in provenance data');
                setIsHighlighting(false);
                return;
            }

            log(`🎯 Highlighting provenance ${provenanceData.provenance_id} on page ${currentPage}`);

            // Use your existing API that returns stable mappings
            const cacheKey = `${documentFilename}_${sentenceIds.join(',')}`;
            let mappingsData;

            if (mappingsCache.has(cacheKey)) {
                mappingsData = mappingsCache.get(cacheKey);
                log('📋 Using cached sentence mappings');
            } else {
                log('🔍 Fetching sentence mappings from API');
                mappingsData = await getSentenceItemMappings(documentFilename, sentenceIds);
                
                if (mappingsData) {
                    const newCache = new Map(mappingsCache);
                    newCache.set(cacheKey, mappingsData);
                    setMappingsCache(newCache);
                }
            }

            if (!mappingsData?.sentence_mappings) {
                throw new Error('No sentence mappings found');
            }

            // Process your stable element mappings
            const allHighlights = [];
            let highlightId = 0;

            for (const [sentenceId, mapping] of Object.entries(mappingsData.sentence_mappings)) {
                if (!mapping || !mapping.stable_elements) {
                    continue;
                }

                // Filter elements for current page
                const pageElements = mapping.stable_elements.filter(
                    elem => elem.page === currentPage
                );

                if (pageElements.length === 0) {
                    continue;
                }

                log(`📍 Processing sentence ${sentenceId} with ${pageElements.length} elements on page ${currentPage}`);

                // Create highlights from your cached stable element data
                for (const element of pageElements) {
                    const highlight = createHighlightFromCachedData(element, `highlight_${highlightId++}`);
                    if (highlight) {
                        allHighlights.push(highlight);
                    }
                }
            }

            // Add highlights to DOM
            const highlightLayer = highlightLayerRef.current;
            allHighlights.forEach(highlight => {
                highlightLayer.appendChild(highlight);
            });

            activeHighlightsRef.current = allHighlights;
            setHighlightElements(allHighlights);

            log(`✅ Applied ${allHighlights.length} highlights using cached coordinate data`);

        } catch (error) {
            console.error('❌ Error applying highlights:', error);
            setError(error.message);
        } finally {
            setIsHighlighting(false);
        }
    }, [
        provenanceData,
        documentFilename,
        currentPage,
        highlightLayerRef,
        mappingsCache,
        createHighlightFromCachedData,
        clearHighlights,
        log
    ]);

    // Effect: Apply highlights when provenance or page changes
    useEffect(() => {
        if (lastProvenanceIdRef.current !== provenanceData?.provenance_id) {
            clearHighlights();
            lastProvenanceIdRef.current = provenanceData?.provenance_id;
        }

        // Apply highlights after react-pdf has rendered
        const timeoutId = setTimeout(() => {
            applyHighlights();
        }, 300); // Slightly longer delay for react-pdf

        return () => clearTimeout(timeoutId);
    }, [provenanceData?.provenance_id, currentPage, currentZoom, applyHighlights, clearHighlights]);

    // Effect: Clear highlights on unmount
    useEffect(() => {
        return () => {
            clearHighlights();
        };
    }, [clearHighlights]);

    // Debug info
    if (verbose) {
        return (
            <div className="coordinate-highlighter-debug" style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'rgba(0,0,0,0.8)',
                color: 'white',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '12px',
                zIndex: '1000',
                maxWidth: '300px'
            }}>
                <div><strong>Hybrid Highlighter Debug</strong></div>
                <div>Mode: Using cached PDF.js coordinates</div>
                <div>Provenance ID: {provenanceData?.provenance_id || 'None'}</div>
                <div>Current Page: {currentPage}</div>
                <div>Zoom: {(currentZoom * 100).toFixed(0)}%</div>
                <div>Active Highlights: {highlightElements.length}</div>
                <div>Is Highlighting: {isHighlighting ? 'Yes' : 'No'}</div>
                {error && <div style={{color: 'red'}}>Error: {error}</div>}
            </div>
        );
    }

    return null;
};

export default HybridCoordinateHighlighter;