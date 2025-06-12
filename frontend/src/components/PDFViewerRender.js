// CleanPDFViewer.js - Simplified main component
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSearchPlus,
    faSearchMinus,
    faChevronLeft,
    faChevronRight,
    faSpinner,
    faFileAlt,
    faExclamationTriangle
} from '@fortawesome/free-solid-svg-icons';
import { useRenderManager } from '../utils/useRenderManager';
import { PDFTextHighlighterFixed as PDFTextHighlighter } from './PDFTextHighlighterFixed';
//import { MinimalTestHighlighter as PDFTextHighlighter } from './MinimalTestHighlighter';
import { getSentenceItemMappings } from '../services/api';
import { text } from 'd3';

const PDFViewerRender = ({
    pdfDocument,
    selectedProvenance,
    activeQuestionId,
    onClose,
    onFeedbackRequest
}) => {
    // Core state
    const [pdfDoc, setPdfDoc] = useState(null);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [provenancePageCache, setProvenancePageCache] = useState(new Map())
    const [provenanceSpanCache, setProvenanceSpanCache] = useState(new Map());
    // Check if user is away from provenance page
    const [provenanceTargetPage, setProvenanceTargetPage] = useState(null);

    // Refs
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const textLayerRef = useRef(null);
    const highlightLayerRef = useRef(null);

    console.log('selectedProvenance', selectedProvenance);
    // Render manager - single source of truth for rendering
    const renderManager = useRenderManager({
        pdfDoc,
        canvasRef,
        containerRef,
        onViewportChange: handleViewportChange
    });

    // Initialize PDF.js worker
    useEffect(() => {
        if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }, []);

    // Generate PDF URL
    useEffect(() => {
        if (!pdfDocument) {
            setPdfUrl(null);
            return;
        }

        const url = pdfDocument.file
            ? URL.createObjectURL(pdfDocument.file)
            : `/api/documents/${pdfDocument.filename}`;

        setPdfUrl(url);

        return () => {
            if (pdfDocument.file && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        };
    }, [pdfDocument]);

    // Load PDF
    useEffect(() => {
        if (!pdfUrl || !window.pdfjsLib) return;
        loadPDF();
    }, [pdfUrl]);

    const loadPDF = async () => {
        setLoading(true);
        setLoadError(null);

        try {
            const loadingTask = window.pdfjsLib.getDocument({
                url: pdfUrl,
                verbosity: 0
            });

            const pdf = await loadingTask.promise;

            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setLoading(false);

            console.log(`✅ PDF loaded: ${pdf.numPages} pages`);

        } catch (err) {
            console.error('❌ Error loading PDF:', err);
            setLoadError(`Failed to load document: ${err.message}`);
            setLoading(false);
        }
    };

    function handleViewportChange({ page, zoom, viewport }) {
        console.log(`📡 Viewport changed: page ${page}, zoom ${(zoom * 100).toFixed(0)}%`);

        // Setup text layer when viewport changes
        

        // Notify highlighter component
        setTimeout(() => {
            const event = new CustomEvent('pdfViewportChanged', {
                detail: { page, zoom, viewport, timestamp: Date.now() }
            });
            document.dispatchEvent(event);
        }, 100);
    }

    useEffect(() => {
        if (renderManager.isReady && renderManager.viewport) {
            console.log('Setting up layers after render completion');
            setupTextLayer(renderManager.currentPage, renderManager.viewport);
            setupHighlightLayer();
        }
    }, [renderManager.isReady, renderManager.currentPage, renderManager.viewport]);

    const setupTextLayer = async (pageNumber, viewport) => {
        if (!textLayerRef.current || !pdfDoc) return;

        try {
            const page = await pdfDoc.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;

            // Clear previous content
            textLayer.innerHTML = '';

            // Position text layer to match canvas
            const canvas = canvasRef.current;
            if (canvas) {
                const canvasRect = canvas.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();

                textLayer.style.position = 'absolute';
                textLayer.style.left = `${canvasRect.left - containerRect.left}px`;
                textLayer.style.top = `${canvasRect.top - containerRect.top}px`;
                textLayer.style.width = `${viewport.width}px`;
                textLayer.style.height = `${viewport.height}px`;
                textLayer.style.overflow = 'hidden';
                textLayer.style.opacity = '0';
            }

            // Create text elements
            textContent.items.forEach((item, itemIndex) => {
                const textDiv = document.createElement('span');
                const transform = item.transform;

                if (!transform) return;

                const [scaleX, skewY, skewX, scaleY, translateX, translateY] = transform;
                const fontHeight = item.height || 12;

                textDiv.style.position = 'absolute';
                textDiv.style.left = `${translateX}px`;
                textDiv.style.bottom = `${translateY}px`;
                textDiv.style.fontSize = `${fontHeight}px`;
                textDiv.style.fontFamily = item.fontName || 'sans-serif';
                textDiv.style.color = 'transparent';
                textDiv.style.whiteSpace = 'pre';

                textDiv.textContent = item.str || '';
                textDiv.setAttribute('data-stable-index', itemIndex);
                textDiv.setAttribute('data-page-number', pageNumber);
                textDiv.className = 'pdf-text-item';

                textLayer.appendChild(textDiv);
            });

            console.log(`✅ Text layer setup: ${textContent.items.length} elements`);

        } catch (err) {
            console.error('❌ Error setting up text layer:', err);
        }
    };

    const setupHighlightLayer = () => {
        if (!highlightLayerRef.current || !textLayerRef.current) return;

        const highlightLayer = highlightLayerRef.current;
        const textLayer = textLayerRef.current;
        const textLayerStyle = window.getComputedStyle(textLayer);

        // Position highlight layer exactly on text layer
        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = textLayerStyle.left;
        highlightLayer.style.top = textLayerStyle.top;
        highlightLayer.style.width = textLayerStyle.width;
        highlightLayer.style.height = textLayerStyle.height;
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';

        console.log('✅ Highlight layer synced with text layer');
    };

    // Track user navigation vs auto-navigation
    const lastUserNavigationRef = useRef(Date.now());
    const lastAutoNavigationRef = useRef(0);

    // Helper to extract page from provenance (implement based on your data structure)
    // Implement getProvenancePage using your stable mappings
    // Enhanced navigation that tracks source
    const goToPage = (pageNum, source = 'user') => {
        console.log(`🎯 goToPage called: ${pageNum} (source: ${source})`, {
            currentPage: renderManager.currentPage,
            totalPages,
            isRendering: renderManager.isRendering
        });

        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== renderManager.currentPage && !renderManager.isRendering) {
            console.log(`📖 Navigating to page ${pageNum} (${source})`);

            // Track navigation source and timing
            if (source === 'user') {
                lastUserNavigationRef.current = Date.now();
            } else if (source === 'auto') {
                lastAutoNavigationRef.current = Date.now();
            }

            renderManager.render(pageNum);
        } else {
            console.warn(`⚠️ Cannot navigate to page ${pageNum}:`, {
                valid: pageNum >= 1 && pageNum <= totalPages,
                different: pageNum !== renderManager.currentPage,
                notRendering: !renderManager.isRendering
            });
        }
    };

    // SMARTER auto-navigation that respects user actions
    useEffect(() => {
        // Only auto-navigate when provenance first becomes available
        if (!selectedProvenance || !renderManager.isReady) return;

        // Use async function inside effect
        const handleAutoNavigation = async () => {
            try {
                const provenancePage = await getProvenancePage(selectedProvenance); // AWAIT here!

                if (provenancePage && provenancePage !== renderManager.currentPage) {
                    console.log(`🧭 Auto-navigating to provenance page ${provenancePage}`);
                    goToPage(provenancePage);
                } else if (provenancePage) {
                    console.log(`✅ Already on provenance page ${provenancePage}`);
                } else {
                    console.log('⚠️ No target page found for provenance');
                }
            } catch (error) {
                console.error('❌ Error in auto-navigation:', error);
            }
        };

        handleAutoNavigation(); // Call the async function

        // Only depend on provenance ID changes, not render state
    }, [selectedProvenance?.provenance_id]);



    // Update this when provenance changes (in your auto-nav effect)
    useEffect(() => {
        if (!selectedProvenance) return;

        const updateProvenanceTarget = async () => {
            const targetPage = await getProvenancePage(selectedProvenance);
            setProvenanceTargetPage(targetPage);
            // ... rest of auto-nav logic
        };

        updateProvenanceTarget();
    }, [selectedProvenance?.provenance_id]);

    // Then your button logic:
    const isAwayFromProvenance = selectedProvenance && provenanceTargetPage &&
        renderManager.currentPage !== provenanceTargetPage;

    // Update button handlers to use new goToPage
    const handlePreviousPage = () => {
        goToPage(renderManager.currentPage - 1, 'user');
    };

    const handleNextPage = () => {
        goToPage(renderManager.currentPage + 1, 'user');
    };

    // Update zoom functions to track as user actions
    const zoomIn = () => {
        console.log('🔍 Zoom in clicked');
        lastUserNavigationRef.current = Date.now(); // Zoom counts as user interaction
        const newZoom = Math.min(renderManager.currentZoom * 1.25, 3);
        renderManager.render(renderManager.currentPage, newZoom);
    };

    const zoomOut = () => {
        console.log('🔍 Zoom out clicked');
        lastUserNavigationRef.current = Date.now(); // Zoom counts as user interaction
        const newZoom = Math.max(renderManager.currentZoom * 0.8, 0.5);
        renderManager.render(renderManager.currentPage, newZoom);
    };

    const resetZoom = () => {
        console.log('🔍 Reset zoom clicked');
        lastUserNavigationRef.current = Date.now(); // Zoom counts as user interaction
        renderManager.render(renderManager.currentPage, null);
    };



    const getProvenancePage = useCallback(async (provenance) => {
        if (!provenance || !pdfDocument?.filename) return null;



        // Extract sentence IDs from provenance
        const sentenceIds = provenance?.provenance_ids

        if (sentenceIds.length === 0) {
            console.log('⚠️ No sentence IDs found in provenance');
            return null;
        }

        // Create cache key
        const cacheKey = `${provenance.provenance_id}_${sentenceIds.join(',')}_${pdfDocument.filename}`;

        // Check cache first
        if (provenancePageCache.has(cacheKey)) {
            const cachedPage = provenancePageCache.get(cacheKey);
            console.log(`📋 Using cached page ${cachedPage} for provenance ${provenance.provenance_id}`);
            return cachedPage;
        }

        try {
            console.log(`🔍 Looking up page for provenance ${provenance.provenance_id} with sentences:`, sentenceIds);

            // Get mappings for these sentence IDs
            const mappingsData = await getSentenceItemMappings(pdfDocument.filename, sentenceIds);

            if (!mappingsData || !mappingsData.sentence_mappings) {
                console.log('⚠️ No sentence mappings found');
                return null;
            }

            // Collect all pages from the best stable match
            const pages = new Set();

            Object.entries(mappingsData.sentence_mappings).forEach(([sentenceId, mapping]) => {
                if (mapping && mapping.stable_matches && mapping.stable_matches.length > 0) {
                    pages.add(mapping.primary_page);
                }
            });


            if (pages.size === 0) {
                console.log('⚠️ No pages found in stable matches');
                return null;
            }

            // Choose the primary page (earliest page if multiple)
            const targetPage = Math.min(...Array.from(pages));

            console.log(`🎯 Determined target page: ${targetPage} (from pages: ${Array.from(pages).sort().join(', ')})`);

            // Cache the result
            const newCache = new Map(provenancePageCache);
            newCache.set(cacheKey, targetPage);
            setProvenancePageCache(newCache);

            return targetPage;

        } catch (error) {
            console.error('❌ Error getting provenance page:', error);
            return null;
        }
    }, [pdfDoc, provenancePageCache]);

    // Add this function to your main PDF viewer component
    const goBackToProvenance = async () => {
        if (!selectedProvenance) {
            console.log('⚠️ No provenance to navigate back to');
            return;
        }

        try {
            const provenancePage = await getProvenancePage(selectedProvenance);

            if (provenancePage && provenancePage !== renderManager.currentPage) {
                console.log(`🔙 Going back to provenance page ${provenancePage}`);
                goToPage(provenancePage, 'user'); // Mark as user action so it doesn't conflict
            } else if (provenancePage === renderManager.currentPage) {
                console.log('✅ Already on provenance page');
            } else {
                console.log('⚠️ Could not find provenance page');
            }
        } catch (error) {
            console.error('❌ Error going back to provenance:', error);
        }
    };


    const SimpleHighlighter = ({ provenanceData, textLayerRef, highlightLayerRef, canvasLayerRef }) => {
        useEffect(() => {
            console.log('🔍 Highlighter effect - Layer status:', {
                textLayer: !!textLayerRef?.current,
                highlightLayer: !!highlightLayerRef?.current,
                textLayerChildren: textLayerRef?.current?.children?.length || 0,
                highlightLayerChildren: highlightLayerRef?.current?.children?.length || 0
            });

            if (!provenanceData?.provenance || !textLayerRef?.current || !highlightLayerRef?.current || !canvasLayerRef?.current) {
                console.log('⏸️ Skipping highlight - missing layers');
                return;
            }

            const canvas = canvasLayerRef.current;
            const scale = canvas.offsetWidth / canvas.width; // Actual vs native size
            console.log('📏 Canvas scale:', scale);
            const highlightLayer = highlightLayerRef.current;
            const canvasRect = canvas.getBoundingClientRect();
            const layerRect = highlightLayer.getBoundingClientRect();
            console.log('📏 Highlight layer rect:', {
                left: layerRect.left,
                top: layerRect.top,
                width: layerRect.width,
                height: layerRect.height
            });
            console.log('📏 Canvas rect:', {
                left: canvasRect.left,
                top: canvasRect.top,
                width: canvasRect.width,
                height: canvasRect.height
            });
            console.log('📏 Highlight layer position:', {
                left: highlightLayer.style.left,
                top: highlightLayer.style.top,
                width: highlightLayer.style.width,
                height: highlightLayer.style.height
            });

            const handleHighlight = async () => {
                const sentenceIds = provenanceData.provenance_ids || [];
                const textElements = Array.from(textLayerRef.current.querySelectorAll('[data-stable-index]'));

                console.log('🗺️ Attempting stable mappings for sentences:', sentenceIds);

                const mappingsData = await getSentenceItemMappings(pdfDocument.filename, sentenceIds);

                if (!mappingsData || !mappingsData.sentence_mappings) {
                    console.log('⚠️ No stable mappings available');
                    return false;
                }

                const highlights = [];
                const sentenceMappings = mappingsData.sentence_mappings;
                const currentPage = renderManager.currentPage;
                const sentenceSpans = new Set();

                Object.entries(sentenceMappings).forEach(([sentenceId, mapping]) => {
                    if (mapping.stable_matches && mapping.stable_matches.length > 0) {
                        const pageMatches = mapping.stable_matches.filter(match => match.page === renderManager.currentPage);
                        pageMatches.forEach(match => {
                            const spanElements = match.item_span || [];
                            spanElements.forEach(spanIndex => {
                                sentenceSpans.add(spanIndex);
                            });
                        });
                    }
                });



                // Clear previous highlights
                highlightLayer.querySelectorAll('.temp-highlight').forEach(el => el.remove());
                const matchingElements = [];
                // first filter the text elements to only those on the current page
                sentenceSpans.forEach((index) => {
                    const element = textLayerRef.current.querySelector(`[data-stable-index="${index}"][data-page-number="${renderManager.currentPage}"]`);
                    if (element) {
                        matchingElements.push(element);
                    }
                });

                console.log(`🔍 Found ${matchingElements.length} text elements on current page ${renderManager.currentPage}`);

                matchingElements.forEach((textElement) => {
                    const stableIndex = parseInt(textElement.getAttribute('data-stable-index'));


                    highlights.push({
                        element: textElement,
                        elementText: textElement.textContent,
                        stableIndex: stableIndex,
                        matchedText: textElement.textContent
                    });

                    const elementRect = textElement.getBoundingClientRect();
                    const highlightLayerRect = highlightLayer.getBoundingClientRect();
                    const left = elementRect.left - highlightLayerRect.left;
                    const top = elementRect.top - highlightLayerRect.top;

                    // Optional: Apply zoom correction if needed
                    const zoomLevel = renderManager.currentZoom || 1;
                    const correctedLeft = left / zoomLevel;
                    const correctedTop = top / zoomLevel;

                    const highlightBox = document.createElement('div');
                    highlightBox.className = 'temp-highlight'; // Add class for cleanup
                    highlightBox.title = `Stable Index: ${stableIndex}_Matched Text: ${textElement.textContent}`;
                    highlightBox.style.cssText = `
                        position: absolute;
                        left: ${left}px;
                        top: ${top}px;
                        width: ${elementRect.width}px;
                        height: ${elementRect.height}px;
                        background: rgba(255, 0, 0, 0.3);
                        pointer-events: none;
                        z-index: 1000;
                    `;
                    highlightLayer.appendChild(highlightBox);

                });

                console.log(`Found ${highlights.length} text matches`);
            };

            handleHighlight();
        }, [provenanceData?.provenance_id]); // Fixed dependency

        return null;
    };



    // Render states
    if (!pdfDocument) {
        return (
            <div className="pdf-viewer-empty">
                <FontAwesomeIcon icon={faFileAlt} size="3x" />
                <h3>No Document Selected</h3>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="pdf-viewer-loading">
                <FontAwesomeIcon icon={faSpinner} spin size="2x" />
                <h3>Loading PDF...</h3>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="pdf-viewer-error">
                <h3>PDF Loading Error</h3>
                <p>{loadError}</p>
                <button onClick={loadPDF} className="win95-btn retry">Retry</button>
            </div>
        );
    }

    return (
        <div className="pdf-viewer clean-architecture">
            {/* Header */}
            <div className="pdf-header">
                <div className="pdf-title">
                    <FontAwesomeIcon icon={faFileAlt} />
                    <span>{pdfDocument.filename}</span>


                    {renderManager.isRendering && (
                        <div className="rendering-indicator">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Rendering...</span>
                        </div>
                    )}

                    {renderManager.error && (
                        <div className="render-error">
                            <FontAwesomeIcon icon={faExclamationTriangle} />
                            <span>Render Error: {renderManager.error}</span>
                        </div>
                    )}
                </div>


                {/* Navigation */}
                <div className="page-navigation">
                    <button
                        onClick={() => goToPage(renderManager.currentPage - 1)}
                        disabled={renderManager.currentPage <= 1 || renderManager.isRendering}
                        className="win95-btn nav"
                    >
                        <FontAwesomeIcon icon={faChevronLeft} />
                        Previous
                    </button>

                    <span className="page-info">
                        Page {renderManager.currentPage} of {totalPages}
                    </span>

                    <button
                        onClick={() => goToPage(renderManager.currentPage + 1)}
                        disabled={renderManager.currentPage >= totalPages || renderManager.isRendering}
                        className="win95-btn nav"
                    >
                        Next
                        <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                    {isAwayFromProvenance && (
                        <button onClick={goBackToProvenance} className="win95-btn control">
                            ← Back to Provenance (Page {provenanceTargetPage})
                        </button>
                    )}
                </div>

                <div className="zoom-controls">
                    <button
                        onClick={zoomOut}
                        disabled={renderManager.isRendering}
                        className="win95-btn control"
                    >
                        <FontAwesomeIcon icon={faSearchMinus} />
                    </button>

                    <span className="zoom-display">
                        {Math.round(renderManager.currentZoom * 100)}%
                    </span>

                    <button
                        onClick={zoomIn}
                        disabled={renderManager.isRendering}
                        className="win95-btn control"
                    >
                        <FontAwesomeIcon icon={faSearchPlus} />
                    </button>

                    <button
                        onClick={resetZoom}
                        disabled={renderManager.isRendering}
                        className="win95-btn control reset-zoom-btn"
                        title="Fit to width"
                    >
                        Fit
                    </button>


                </div>
            </div>


            {/* Main Content */}
            <div className="pdf-main-view">
                <div className="pdf-content" ref={containerRef}>
                    <div className="pdf-page-container">
                        <canvas ref={canvasRef} className="pdf-canvas" />
                        <div ref={textLayerRef} className="pdf-text-layer" />
                        <div ref={highlightLayerRef} className="pdf-highlight-layer" />

                        {/* Highlighter Component */}
                        {renderManager.isReady && selectedProvenance && (
                            <PDFTextHighlighter
                                documentId={pdfDocument?.filename || ''}
                                currentPage={renderManager.currentPage}
                                provenanceData={selectedProvenance}
                                textLayerRef={textLayerRef}
                                canvasRef={canvasRef}
                                containerRef={containerRef}
                                highlightLayerRef={highlightLayerRef}
                                currentViewport={renderManager.viewport}
                                questionId={activeQuestionId}
                                isRendering={renderManager.isRendering}
                            />
                        )}

                        {renderManager.isReady && selectedProvenance && (
                            <SimpleHighlighter
                                provenanceData={selectedProvenance}
                                textLayerRef={textLayerRef}
                                highlightLayerRef={highlightLayerRef}
                                canvasLayerRef={canvasRef}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PDFViewerRender;