// ReactHighlighter.js - Updated for react-pdf with coordinate adjustments
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getSentenceItemMappings } from '../services/api';

const ReactHighlighter = ({
    provenanceData,
    activeQuestionId,
    textLayerRef, // This is now the pageRef from react-pdf
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
    searchOptions = {
        caseSensitive: false,
        matchThreshold: 0.75,
        maxGapBetweenWords: 30,
        contextWindow: 3
    },
    className = '',
    verbose = false,
    // New prop for coordinate adjustments
   coordinateOffsets={
        useCanvasOffset: false, // Keep false since highlights work at 100%
        manualOffsetX: 0,       // No manual adjustment needed
        manualOffsetY: 0
    }
}) => {
    const [mappingsCache, setMappingsCache] = useState(new Map());
    const [highlightElements, setHighlightElements] = useState([]);
    const [isHighlighting, setIsHighlighting] = useState(false);
    const [error, setError] = useState(null);
    const [pageMetrics, setPageMetrics] = useState(null);
    
    const activeHighlightsRef = useRef([]);
    const lastProvenanceIdRef = useRef(null);

    // Helper function for logging
    const log = useCallback((...args) => {
        if (verbose) {
            console.log('[ReactHighlighter]', ...args);
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

     // Get page positioning info for zoom-aware highlighting
    const getPageMetrics = useCallback(() => {
        if (!textLayerRef?.current) {
            log('❌ No text layer ref available');
            return null;
        }

        // Find the react-pdf page container
        const pageElement = textLayerRef.current.querySelector('.react-pdf__Page');
        const canvas = textLayerRef.current.querySelector('.react-pdf__Page__canvas');

        if (!pageElement || !canvas) {
            log('❌ Could not find react-pdf page elements');
            return null;
        }

        // Get page dimensions and position
        const pageRect = pageElement.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = containerRef?.current?.getBoundingClientRect();

        if (!containerRect) {
            log('❌ Container rect not available');
            return null;
        }

        const metrics = {
            // Position relative to container (this is what we need)
            canvasLeft: canvasRect.left - containerRect.left,
            canvasTop: canvasRect.top - containerRect.top,
            
            // Canvas and PDF sizes for reference
            canvasWidth: canvasRect.width,
            canvasHeight: canvasRect.height,
            pdfWidth: canvas.width,
            pdfHeight: canvas.height,
            
            // Current zoom level
            currentZoom: currentZoom
        };

        log('📐 Simplified page metrics for direct positioning:', {
            canvasSize: `${metrics.canvasWidth}x${metrics.canvasHeight}`,
            pdfSize: `${metrics.pdfWidth}x${metrics.pdfHeight}`,
            position: `(${metrics.canvasLeft}, ${metrics.canvasTop})`,
            zoom: `${(metrics.currentZoom * 100).toFixed(0)}%`
        });

        return metrics;
    }, [textLayerRef, containerRef, currentZoom, log]);

    // Convert cached coordinates with zoom scaling
    const convertCachedCoordsWithZoom = useCallback((cachedElement, metrics) => {
        if (!metrics || !cachedElement.coordinates) {
            return null;
        }

        const { coordinates } = cachedElement;
        
        // Your cached coordinates are perfect at 100% zoom (scale 1.0)
        // When zoom changes, we need to scale them proportionally
        const zoomScale = metrics.currentZoom; // 1.0 = 100%, 1.5 = 150%, 0.5 = 50%
        
        // Calculate offsets based on configuration
        let offsetX = coordinateOffsets.manualOffsetX * zoomScale; // Scale manual offsets too
        let offsetY = coordinateOffsets.manualOffsetY * zoomScale;
        
        if (coordinateOffsets.useCanvasOffset) {
            offsetX += metrics.canvasLeft;
            offsetY += metrics.canvasTop;
        }
        
        const screenCoords = {
            left: (coordinates.x * zoomScale) + offsetX,
            top: (coordinates.y * zoomScale) + offsetY,
            width: coordinates.width * zoomScale,
            height: coordinates.height * zoomScale
        };

        log(`🎯 Zoom-proportional coordinate scaling:`, {
            original: coordinates,
            zoomScale: zoomScale.toFixed(3),
            offsets: {
                canvasOffset: coordinateOffsets.useCanvasOffset ? `(${metrics.canvasLeft}, ${metrics.canvasTop})` : 'disabled',
                manualOffset: `(${coordinateOffsets.manualOffsetX}, ${coordinateOffsets.manualOffsetY})`,
                scaledManualOffset: `(${(coordinateOffsets.manualOffsetX * zoomScale).toFixed(1)}, ${(coordinateOffsets.manualOffsetY * zoomScale).toFixed(1)})`,
                totalOffset: `(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`
            },
            zoom: `${(metrics.currentZoom * 100).toFixed(0)}%`,
            screen: screenCoords
        });

        return screenCoords;
    }, [coordinateOffsets, log]);

    // Update page metrics when page changes or zoom changes
    useEffect(() => {
        const updateMetrics = () => {
            const metrics = getPageMetrics();
            setPageMetrics(metrics);
        };

        // Update metrics after a delay to ensure react-pdf has rendered
        const timeoutId = setTimeout(updateMetrics, 200);
        
        return () => clearTimeout(timeoutId);
    }, [currentPage, currentZoom, getPageMetrics]);


    // Get react-pdf text layer elements
    const getReactPdfTextElements = useCallback(() => {
        if (!textLayerRef?.current) {
            log('❌ No text layer ref available');
            return [];
        }

        // React-pdf creates text elements with specific classes
        const textLayerDiv = textLayerRef.current.querySelector('.react-pdf__Page__textContent');
        
        if (!textLayerDiv) {
            log('❌ No react-pdf text content layer found');
            return [];
        }

        // Get all text items (spans) in the text layer
        const textItems = textLayerDiv.querySelectorAll('span[role="presentation"]');
        
        log(`📝 Found ${textItems.length} text items in react-pdf text layer`);
        
        return Array.from(textItems).map((span, index) => ({
            element: span,
            text: span.textContent || '',
            stableIndex: index, // Use DOM order as stable index
            page: currentPage,
            rect: span.getBoundingClientRect()
        }));
    }, [textLayerRef, currentPage, log]);

    // Find text items that match provenance text
    const findMatchingTextItems = useCallback((provenanceText, textItems) => {
        if (!provenanceText || !textItems.length) {
            return [];
        }

        const normalizeText = (text) => {
            return searchOptions.caseSensitive 
                ? text.trim() 
                : text.toLowerCase().trim();
        };

        const provenanceWords = normalizeText(provenanceText)
            .split(/\s+/)
            .filter(word => word.length > 0);

        if (provenanceWords.length === 0) {
            return [];
        }

        log(`🔍 Searching for ${provenanceWords.length} words in ${textItems.length} text items`);

        const matches = [];
        
        // Strategy 1: Try to find consecutive word sequences
        for (let startIdx = 0; startIdx < textItems.length; startIdx++) {
            const consecutiveMatch = findConsecutiveMatch(
                provenanceWords, 
                textItems, 
                startIdx, 
                normalizeText
            );
            
            if (consecutiveMatch.length > 0) {
                matches.push({
                    items: consecutiveMatch,
                    confidence: calculateMatchConfidence(consecutiveMatch, provenanceWords),
                    strategy: 'consecutive'
                });
            }
        }

        // Strategy 2: If no good consecutive matches, try fuzzy matching
        if (matches.length === 0 || matches[0].confidence < searchOptions.matchThreshold) {
            const fuzzyMatches = findFuzzyMatches(
                provenanceWords, 
                textItems, 
                normalizeText
            );
            
            if (fuzzyMatches.length > 0) {
                matches.push({
                    items: fuzzyMatches,
                    confidence: calculateMatchConfidence(fuzzyMatches, provenanceWords),
                    strategy: 'fuzzy'
                });
            }
        }

        // Sort by confidence and return best match
        matches.sort((a, b) => b.confidence - a.confidence);
        
        if (matches.length > 0 && matches[0].confidence >= searchOptions.matchThreshold) {
            log(`✅ Found match with confidence ${matches[0].confidence.toFixed(2)} using ${matches[0].strategy} strategy`);
            return matches[0].items;
        }

        log(`⚠️ No matches found above threshold ${searchOptions.matchThreshold}`);
        return [];
    }, [searchOptions, log]);

    // Find consecutive word matches
    const findConsecutiveMatch = useCallback((provenanceWords, textItems, startIdx, normalizeText) => {
        const matchedItems = [];
        let wordIndex = 0;
        
        for (let itemIdx = startIdx; itemIdx < textItems.length && wordIndex < provenanceWords.length; itemIdx++) {
            const itemText = normalizeText(textItems[itemIdx].text);
            const itemWords = itemText.split(/\s+/).filter(word => word.length > 0);
            
            let localWordMatches = 0;
            for (const itemWord of itemWords) {
                if (wordIndex < provenanceWords.length && 
                    itemWord === provenanceWords[wordIndex]) {
                    wordIndex++;
                    localWordMatches++;
                }
            }
            
            if (localWordMatches > 0) {
                matchedItems.push(textItems[itemIdx]);
            } else if (matchedItems.length > 0) {
                // Break if we started matching but then hit a non-match
                break;
            }
        }
        
        return matchedItems;
    }, []);

    // Find fuzzy matches allowing gaps
    const findFuzzyMatches = useCallback((provenanceWords, textItems, normalizeText) => {
        const matchedItems = [];
        const matchedWordIndices = new Set();
        
        // Try to match as many words as possible, allowing some gaps
        for (let wordIdx = 0; wordIdx < provenanceWords.length; wordIdx++) {
            const targetWord = provenanceWords[wordIdx];
            
            for (let itemIdx = 0; itemIdx < textItems.length; itemIdx++) {
                const itemText = normalizeText(textItems[itemIdx].text);
                
                if (itemText.includes(targetWord) && !matchedWordIndices.has(itemIdx)) {
                    matchedItems.push(textItems[itemIdx]);
                    matchedWordIndices.add(itemIdx);
                    break; // Move to next word
                }
            }
        }
        
        return matchedItems;
    }, []);

    // Calculate match confidence
    const calculateMatchConfidence = useCallback((matchedItems, provenanceWords) => {
        if (!matchedItems.length || !provenanceWords.length) {
            return 0;
        }

        const matchedText = matchedItems
            .map(item => item.text)
            .join(' ')
            .toLowerCase()
            .trim();

        const provenanceText = provenanceWords.join(' ');
        
        // Simple overlap calculation
        const matchedWordsInProvenance = provenanceWords.filter(word => 
            matchedText.includes(word)
        );
        
        const confidence = matchedWordsInProvenance.length / provenanceWords.length;
        return Math.min(0.95, confidence); // Cap at 95%
    }, []);

    // Convert your cached coordinates to react-pdf percentage-based positioning
    const convertCachedCoordsToPercentage = useCallback((cachedElement, metrics) => {
        if (!metrics || !cachedElement.coordinates) {
            return null;
        }

        const  coordinates  = cachedElement.coordinates;
        
        // Your cached coordinates are in PDF coordinate space (pixels from PDF.js)
        // React-pdf text layer uses percentages of the page size
        
        // Calculate the scale factor between PDF and canvas
        const pdfToCanvasScaleX = metrics.canvasWidth / metrics.pdfWidth;
        const pdfToCanvasScaleY = metrics.canvasHeight / metrics.pdfHeight;
        
        log(`📏 Scale factors: X=${pdfToCanvasScaleX.toFixed(3)}, Y=${pdfToCanvasScaleY.toFixed(3)}`);
        
        // Convert PDF coordinates to screen pixels directly, then apply adjustments
        const baseScreenCoords = {
            left: metrics.canvasLeft + (coordinates.x * pdfToCanvasScaleX),
            top: metrics.canvasTop + (coordinates.y * pdfToCanvasScaleY),
            width: coordinates.width * pdfToCanvasScaleX,
            height: coordinates.height * pdfToCanvasScaleY
        };
        
        // Apply coordinate adjustments
        const screenCoords = {
            left: baseScreenCoords.left + coordinateOffsets.manualOffsetX,
            top: baseScreenCoords.top + coordinateOffsets.manualOffsetY,
            width: baseScreenCoords.width,
            height: baseScreenCoords.height
        };

        log('Original coordinates for text item:', coordinates);

        log(`🎯 Coordinate conversion with direct scaling:`, {
            original: coordinates,
            pdfToCanvasScale: { x: pdfToCanvasScaleX, y: pdfToCanvasScaleY },
            baseScreen: baseScreenCoords,
            finalScreen: screenCoords
        });

        return screenCoords;
    }, [coordinateOffsets, log]);

    // Alternative: Convert pixel coordinates directly to screen coordinates
    const convertPixelCoordsToScreen = useCallback((cachedElement, metrics) => {
        if (!metrics || !cachedElement.coordinates) {
            return null;
        }

        const  coordinates  = cachedElement.coordinates;

        // Direct pixel-to-pixel conversion accounting for zoom and positioning
        const scaleX = metrics.canvasWidth / metrics.pdfWidth;
        const scaleY = metrics.canvasHeight / metrics.pdfHeight;
        
        // Apply coordinate adjustments for direct pixel conversion too
        const screenCoords = {
            left: metrics.canvasLeft + (coordinates.x * scaleX) + coordinateOffsets.manualOffsetX,
            top: metrics.canvasTop + (coordinates.y * scaleY) + coordinateOffsets.manualOffsetY,
            width: (coordinates.width * scaleX),
            height: (coordinates.height * scaleY)
        };

        log(`🎯 Direct pixel conversion with adjustments:`, {
            original: coordinates,
            scale: { scaleX, scaleY },
            offsets: coordinateOffsets,
            screen: screenCoords
        });

        return screenCoords;
    }, [coordinateOffsets, log]);

    // Create highlight elements
    const createHighlightElement = useCallback((textItem, highlightId, metrics) => {
        if (!textItem || !highlightId || !metrics) {
            return null;
            
        }

        const screenCoords = convertCachedCoordsWithZoom(textItem, metrics);

        const highlight = document.createElement('div');
        highlight.className = `coordinate-highlight ${className}`;
        highlight.setAttribute('data-highlight-id', highlightId);
        highlight.setAttribute('data-stable-index', textItem.stable_index);
        highlight.setAttribute('data-page', textItem.page);
        highlight.setAttribute('data-text', textItem.text);
        highlight.setAttribute('data-original-coords', JSON.stringify(textItem.coordinates || {}));

        const left = screenCoords.left;
        const top = screenCoords.top;
        const width = screenCoords.width;
        const height = screenCoords.height;

        // Apply positioning and styling
        Object.assign(highlight.style, {
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: 'none',
            zIndex: '5',
            ...highlightStyle
        });

        log(`✨ Created highlight at (${left.toFixed(0)}, ${top.toFixed(0)}) size ${width.toFixed(0)}x${height.toFixed(0)}`);

        return highlight;
    }, [convertCachedCoordsToPercentage, convertPixelCoordsToScreen, highlightStyle, className, log]);

    // Update page metrics when page changes or zoom changes
    useEffect(() => {
        const updateMetrics = () => {
            const metrics = getPageMetrics();
            setPageMetrics(metrics);
        };

        // Update metrics after a delay to ensure react-pdf has rendered
        const timeoutId = setTimeout(updateMetrics, 200);

        return () => clearTimeout(timeoutId);
    }, [currentPage, currentZoom, getPageMetrics]);

   // Apply highlights using cached coordinates with zoom scaling
    const applyHighlights = useCallback(async () => {
        if (!provenanceData || !documentFilename || !highlightLayerRef?.current || !pageMetrics) {
            log('❌ Missing required data for highlighting', {
                hasProvenance: !!provenanceData,
                hasFilename: !!documentFilename,
                hasHighlightLayer: !!highlightLayerRef?.current,
                hasPageMetrics: !!pageMetrics
            });
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

            log(`🎯 Highlighting provenance ${provenanceData.provenance_id} on page ${currentPage} at ${(currentZoom * 100).toFixed(0)}% zoom`);

            // Get sentence mappings from your existing API
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

            // Process stable element mappings with zoom-aware coordinate scaling
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

                // Create highlights using zoom-scaled coordinates
                for (const element of pageElements) {
                    const highlight = createHighlightElement(element, `highlight_${highlightId++}`, pageMetrics);
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

            log(`✅ Applied ${allHighlights.length} zoom-aware highlights at ${(currentZoom * 100).toFixed(0)}% zoom`);

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
        currentZoom,
        pageMetrics?.canvasLeft,
        pageMetrics?.canvasTop,
        pageMetrics?.currentZoom
    ]);

    // Effect: Apply highlights when provenance, page, or zoom changes
    useEffect(() => {
        // Clear highlights when provenance changes
        if (lastProvenanceIdRef.current !== provenanceData?.provenance_id) {
            clearHighlights();
            lastProvenanceIdRef.current = provenanceData?.provenance_id;
        }

        // Apply highlights with zoom awareness
        if (pageMetrics) {
            const timeoutId = setTimeout(() => {
                applyHighlights();
            }, 100); // Shorter delay since we're not doing complex conversions

            return () => clearTimeout(timeoutId);
        }
    }, [provenanceData?.provenance_id, currentPage, currentZoom, pageMetrics, clearHighlights]);


   

    // Effect: Clear highlights on unmount
    useEffect(() => {
        return () => {
            clearHighlights();
        };
    }, [clearHighlights]);

    // Effect: Listen for viewport changes from react-pdf
    useEffect(() => {
        const handleViewportChange = () => {
            // Reapply highlights when viewport changes
            setTimeout(() => {
                applyHighlights();
            }, 100);
        };

        document.addEventListener('pdfViewportChanged', handleViewportChange);
        return () => {
            document.removeEventListener('pdfViewportChanged', handleViewportChange);
        };
    }, [applyHighlights]);

    // Debug info with coordinate adjustment details
    if (verbose) {
        return (
            <div className="coordinate-highlighter-debug" style={{
                position: 'absolute',
                top: '-20px',
                right: '-150px',
                background: 'rgba(0,0,0,0.9)',
                color: 'white',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '11px',
                zIndex: '1000',
                maxWidth: '350px',
                fontFamily: 'monospace'
            }}>
                <div><strong>ReactHighlighter Debug</strong></div>
                <div>Provenance ID: {provenanceData?.provenance_id || 'None'}</div>
                <div>Current Page: {currentPage}</div>
                <div>Zoom: {(currentZoom * 100).toFixed(0)}%</div>
                <div>Active Highlights: {highlightElements.length}</div>
                <div>Is Highlighting: {isHighlighting ? 'Yes' : 'No'}</div>
                <div>Has Page Metrics: {pageMetrics ? 'Yes' : 'No'}</div>
                {pageMetrics && (
                    <div style={{ marginTop: '8px', fontSize: '10px' }}>
                        <div><strong>Page Metrics:</strong></div>
                        <div>Canvas: {pageMetrics.canvasWidth.toFixed(0)}x{pageMetrics.canvasHeight.toFixed(0)}</div>
                        <div>PDF: {pageMetrics.pdfWidth}x{pageMetrics.pdfHeight}</div>
                        <div>Position: ({pageMetrics.canvasLeft.toFixed(0)}, {pageMetrics.canvasTop.toFixed(0)})</div>
                    </div>
                )}
                <div style={{ marginTop: '8px', fontSize: '10px' }}>
                    <div><strong>Coordinate Offsets:</strong></div>
                    <div>Left: {coordinateOffsets.manualOffsetX}px</div>
                    <div>Top: {coordinateOffsets.manualOffsetY}px</div>
                    <div>Use Canvas Offset: {coordinateOffsets.useCanvasOffset ? 'Yes' : 'No'}</div>
                </div>
                {error && <div style={{color: 'red', marginTop: '8px'}}>Error: {error}</div>}
            </div>
        );
    }

    return null; // This component doesn't render anything visible
};

export default ReactHighlighter;