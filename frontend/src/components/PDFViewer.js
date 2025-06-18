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
import * as pdfjsLib from 'pdfjs-dist';
import { useRenderManager } from '../utils/useRenderManager';
import { getSentenceItemMappings } from '../services/api';
import '../styles/pdf-viewer-render.css';
import CoordinateHighlighter from './CoordinateHighlighter';
import HybridCoordinateHighlighter from './HybridCoordinateHighlighter';

const PDFViewer = ({
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
    const [provenancePageCache, setProvenancePageCache] = useState(new Map());
    const [debugMode, setDebugMode] = useState(true);

    const [displayZoom, setDisplayZoom] = useState(1.0);
    const [provenanceTargetPage, setProvenanceTargetPage] = useState(null);
    const [pageInputValue, setPageInputValue] = useState('');
    const [showPageInput, setShowPageInput] = useState(false);

    const [isProvenanceProcessing, setIsProvenanceProcessing] = useState(false);
    const [provenanceProcessingMessage, setProvenanceProcessingMessage] = useState('');

    // Refs
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const textLayerRef = useRef(null);
    const highlightLayerRef = useRef(null);

    // Render manager - single source of truth for rendering
    const renderManager = useRenderManager({
        pdfDoc,
        canvasRef,
        containerRef,
        onViewportChange: handleViewportChange
    });

    // Initialize PDF.js worker
    useEffect(() => {
        // This tells the bundler to include the worker file and gives us its URL
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
        ).toString();
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

    useEffect(() => {
        if (pdfDocument && renderManager.isReady && renderManager.currentPage !== 1) {
            console.log('📄 New document loaded, resetting to page 1');
            renderManager.render(1);
        }
    }, [pdfDocument?.filename]); // Reset when filename changes



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



    function handleViewportChange({ page, zoom, displayViewport, textLayerViewport, zoomRatio }) {
        console.log(`📡 Viewport changed: page ${page}, display zoom ${(zoom * 100).toFixed(0)}%, text layer zoom: 100%`);

        // Store both viewports for text layer setup
        window.currentDisplayViewport = displayViewport;
        window.currentTextLayerViewport = textLayerViewport;
        window.currentZoomRatio = zoomRatio;

        setTimeout(() => {
            setupTextLayerSimple(page, displayViewport);
            setupHighlightLayer();
            const event = new CustomEvent('pdfViewportChanged', {
                detail: {
                    page,
                    zoom,
                    displayViewport,
                    textLayerViewport,
                    zoomRatio,
                    timestamp: Date.now()
                }
            });
            document.dispatchEvent(event);
        }, 100);
    }

    // Simpler approach: Use page.render() with textLayer option
const setupTextLayerSimple = async (pageNumber, displayViewport) => {
    if (!textLayerRef.current || !pdfDoc) return;

    try {
        const page = await pdfDoc.getPage(pageNumber);
        const textContent = await page.getTextContent({
            includeMarkedContent: true,
            disableNormalization: true
        })

        const textLayer = textLayerRef.current;
        textLayer.innerHTML = '';
        const textLayerViewport = page.getViewport({ scale: 1.0 });
        const zoomRatio = window.currentZoomRatio || 1.0;

        // Position text layer to match canvas
        const canvas = canvasRef.current;
         if (!canvas) {
            console.warn('⚠️ Canvas not available for text layer positioning');
            return;
        }
  
            const canvasRect = canvas.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();

            textLayer.style.position = 'absolute';
            textLayer.style.left = `${canvasRect.left - containerRect.left}px`;
            textLayer.style.top = `${canvasRect.top - containerRect.top}px`;
            textLayer.style.width = `${textLayerViewport.width}px`;
            textLayer.style.height = `${textLayerViewport.height}px`;
            textLayer.style.transform = `scale(${zoomRatio})`;
            textLayer.style.transformOrigin = '0 0'; // Scale from top-left
            textLayer.className = 'textLayer pdf-text-layer';
            textLayer.style.setProperty('--scale-factor', textLayerViewport.scale.toString());
            textLayer.style.opacity = debugMode ? '0.3' : '0';
        

         // Process text items using the textLayerViewport (1.0 scale)
        const items = textContent.items;
        const styles = textContent.styles || {};

        items.forEach((item, itemIndex) => {
            if (!item.transform || !item.str) return;

            const transform = item.transform;
            const [scaleX, skewY, skewX, scaleY, translateX, translateY] = transform;

            const span = document.createElement('span');
            
            // Calculate positioning based on textLayerViewport (1.0 scale)
            const fontSize = Math.sqrt(scaleX * scaleX + skewY * skewY);
            const angle = Math.atan2(skewY, scaleX);
            
            // Position using PDF coordinates (textLayerViewport coordinates)
            span.style.position = 'absolute';
            span.style.left = `${translateX}px`;
            span.style.bottom = `${translateY}px`; // PDF uses bottom-left origin
            span.style.fontSize = `${fontSize}px`;
            span.style.color = 'transparent';
            span.style.whiteSpace = 'pre';
            span.style.cursor = 'text';
            span.style.transformOrigin = '0% 0%';
            
            // Handle font family
            const fontName = item.fontName;
            if (fontName && styles[fontName] && styles[fontName].fontFamily) {
                span.style.fontFamily = styles[fontName].fontFamily;
            } else if (fontName) {
                // Map common PDF fonts to web fonts
                if (fontName.includes('Arial') || fontName.includes('Helvetica')) {
                    span.style.fontFamily = 'Arial, Helvetica, sans-serif';
                } else if (fontName.includes('Times')) {
                    span.style.fontFamily = 'Times, "Times New Roman", serif';
                } else if (fontName.includes('Courier')) {
                    span.style.fontFamily = 'Courier, "Courier New", monospace';
                } else {
                    span.style.fontFamily = 'serif';
                }
            } else {
                span.style.fontFamily = 'serif';
            }

            // Handle rotation
            if (Math.abs(angle) > 0.01) {
                span.style.transform = `rotate(${angle}rad)`;
            }

            // CRITICAL: Set the exact text content - preserve all spaces!
            span.textContent = item.str;
            
            
            // Add metadata for highlighting and debugging
            span.setAttribute('data-stable-index', itemIndex);
            span.setAttribute('data-page-number', pageNumber);
            span.setAttribute('data-original-text', item.str);
            span.setAttribute('data-font-size', fontSize.toFixed(2));
            span.setAttribute('data-font-name', fontName || 'unknown');
            span.classList.add('pdf-text-item');

            textLayer.appendChild(span);
        });

        console.log(`✅ Text layer created: ${items.length} elements at 1.0 scale`);

        // Debug: Log some sample text to verify spacing
        if (debugMode && items.length > 0) {
            const sampleTexts = items.slice(0, 5).map((item, i) => `${i}: "${item.str}"`);
            console.log('📝 Sample text items:', sampleTexts.join(' | '));
        }

    } catch (err) {
        console.error('❌ Text layer setup failed:', err);
    }
};


    const setupTextLayerManual = async (pageNumber, displayViewport) => {
        if (!textLayerRef.current || !pdfDoc) return;

        try {
            const page = await pdfDoc.getPage(pageNumber);
            const textContent = await page.getTextContent({
                normalizeWhitespace: false,
                disableCombineTextItems: false
            });
            const textLayer = textLayerRef.current;

            // Clear previous content
            textLayer.innerHTML = '';

            const textLayerViewport = page.getViewport({ scale: 1.0 });
            const zoomRatio = window.currentZoomRatio || 1.0;

            // Position text layer to match canvas
            const canvas = canvasRef.current;
            if (canvas) {
                const canvasRect = canvas.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();

                textLayer.style.position = 'absolute';
                textLayer.style.left = `${canvasRect.left - containerRect.left}px`;
                textLayer.style.top = `${canvasRect.top - containerRect.top}px`;

                textLayer.style.width = `${textLayerViewport.width}px`;
                textLayer.style.height = `${textLayerViewport.height}px`;
                textLayer.style.transform = `scale(${zoomRatio})`;
                textLayer.style.transformOrigin = '0 0'; // Scale from top-left
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
        if (!highlightLayerRef.current || !containerRef.current) return;

        const highlightLayer = highlightLayerRef.current;
        const pageContainer = containerRef.current.querySelector('.pdf-page-container');

        if (!pageContainer) {
            console.warn('PDF page container not found for highlight layer setup');
            return;
        }

        // Position highlight layer to exactly match the pdf-page-container
        const pageRect = pageContainer.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = `${pageRect.left - containerRect.left}px`;
        highlightLayer.style.top = `${pageRect.top - containerRect.top}px`;
        highlightLayer.style.width = `${pageContainer.offsetWidth}px`;
        highlightLayer.style.height = `${pageContainer.offsetHeight}px`;
        highlightLayer.style.transform = pageContainer.style.transform || 'none';
        highlightLayer.style.transformOrigin = pageContainer.style.transformOrigin || '0 0';
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';

        console.log('✅ Highlight layer positioned to match page container');
    };

    // Track user navigation vs auto-navigation
    const lastUserNavigationRef = useRef(Date.now());
    const lastAutoNavigationRef = useRef(0);

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

    // Track provenance processing state
    useEffect(() => {
        if (!activeQuestionId) {
            // No active question - clear processing state
            setIsProvenanceProcessing(false);
            setProvenanceProcessingMessage('');
            return;
        }

        if (!selectedProvenance) {
            // Question exists but no provenance yet - show processing
            setIsProvenanceProcessing(true);
            setProvenanceProcessingMessage('Finding relevant text passages...');
        } else {
            // Provenance arrived - clear processing
            setIsProvenanceProcessing(false);
            setProvenanceProcessingMessage('');
        }
    }, [activeQuestionId, selectedProvenance]);


    useEffect(() => {
        // Only auto-navigate when provenance first becomes available
        if (!selectedProvenance || !renderManager.isReady) return;

        const handleAutoNavigation = async () => {
            try {
                const provenancePage = await getProvenancePage(selectedProvenance); // AWAIT here!

                if (provenancePage && provenancePage !== renderManager.currentPage) {
                    console.log(`🧭 Auto-navigating to provenance page ${provenancePage}`);
                    goToPage(provenancePage, 'auto');
                } else if (provenancePage) {
                    console.log(`✅ Already on provenance page ${provenancePage}`);
                } else {
                    console.log('⚠️ No target page found for provenance');
                }
            } catch (error) {
                console.error('❌ Error in auto-navigation:', error);
            }
        };

        handleAutoNavigation();

    }, [selectedProvenance?.provenance_id]);


    useEffect(() => {
        if (!selectedProvenance) return;

        const updateProvenanceTarget = async () => {
            const targetPage = await getProvenancePage(selectedProvenance);
            setProvenanceTargetPage(targetPage);
        };

        updateProvenanceTarget();
    }, [selectedProvenance?.provenance_id]);

    const isAwayFromProvenance = selectedProvenance && provenanceTargetPage &&
        renderManager.currentPage !== provenanceTargetPage;

    const handlePreviousPage = () => {
        goToPage(renderManager.currentPage - 1, 'user');
    };

    const handleNextPage = () => {
        goToPage(renderManager.currentPage + 1, 'user');
    };

    const zoomIn = () => {
        lastUserNavigationRef.current = Date.now();
        const newZoom = Math.min(renderManager.currentZoom * 1.2, 3);

        renderManager.render(renderManager.currentPage, newZoom);
    };

    const zoomOut = () => {
        lastUserNavigationRef.current = Date.now();
        const newZoom = Math.max(renderManager.currentZoom * 0.8, 0.5);

        renderManager.render(renderManager.currentPage, newZoom);
    };

    const resetZoom = () => {
        lastUserNavigationRef.current = Date.now();

        // Calculate fit-to-width zoom
        if (renderManager.viewport && containerRef.current) {
            const baseViewport = { width: renderManager.viewport.width / renderManager.currentZoom };
            const containerWidth = containerRef.current.offsetWidth;
            const fitZoom = renderManager.calculateFitToWidthZoom(baseViewport, containerWidth);

            renderManager.render(renderManager.currentPage, fitZoom);
        } else {
            renderManager.render(renderManager.currentPage, 1.0);
        }
    };

    const handlePageInputSubmit = (e) => {
        e.preventDefault();
        const pageNum = parseInt(pageInputValue, 10);

        if (isNaN(pageNum)) {
            console.warn('Invalid page number entered');
            setPageInputValue('');
            return;
        }

        if (pageNum >= 1 && pageNum <= totalPages) {
            console.log(`🎯 Direct navigation to page ${pageNum}`);
            goToPage(pageNum, 'user');
            setShowPageInput(false);
            setPageInputValue('');
        } else {
            console.warn(`Page ${pageNum} out of range (1-${totalPages})`);
            setPageInputValue('');
        }
    };

    const handlePageInputKeyDown = (e) => {
        if (e.key === 'Escape') {
            setShowPageInput(false);
            setPageInputValue('');
        } else if (e.key === 'Enter') {
            handlePageInputSubmit(e);
        }
    };

    const handlePageInfoClick = () => {
        setShowPageInput(true);
        setPageInputValue(renderManager.currentPage.toString());
        // Focus the input after state update
        setTimeout(() => {
            const input = document.querySelector('.page-input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 0);
    };

    // Update page input when current page changes (but not if user is actively typing)
    useEffect(() => {
        if (!showPageInput) {
            setPageInputValue('');
        }
    }, [renderManager.currentPage, showPageInput]);




    const getProvenancePage = useCallback(async (provenance) => {
        if (!provenance || !pdfDocument?.filename) return null;

        const sentenceIds = provenance?.provenance_ids

        if (sentenceIds.length === 0) {
            console.log('⚠️ No sentence IDs found in provenance');
            return null;
        }

        const cacheKey = `${provenance.provenance_id}_${sentenceIds.join(',')}_${pdfDocument.filename}`;

        if (provenancePageCache.has(cacheKey)) {
            const cachedPage = provenancePageCache.get(cacheKey);
            console.log(`📋 Using cached page ${cachedPage} for provenance ${provenance.provenance_id}`);
            return cachedPage;
        }

        try {
            console.log(`🔍 Looking up page for provenance ${provenance.provenance_id} with sentences:`, sentenceIds);

            const mappingsData = await getSentenceItemMappings(pdfDocument.filename, sentenceIds);

            if (!mappingsData || !mappingsData.sentence_mappings) {
                console.log('⚠️ No sentence mappings found');
                return null;
            }

            const pages = new Set();

            Object.entries(mappingsData.sentence_mappings).forEach(([sentenceId, mapping]) => {
                console.log(`🔍 Processing sentence ${sentenceId}:`, {
                    hasMapping: !!mapping,
                    hasStableElements: !!mapping?.stable_elements,
                    hasStableMatches: !!mapping?.stable_matches,
                    primaryPage: mapping?.primary_page,
                    found: mapping?.found
                });

                if (mapping && mapping.stable_elements && mapping.stable_elements.length > 0) {

                    mapping.stable_elements.forEach((element) => {
                        if (element.page && element.page > 0) {
                            pages.add(element.page);
                        } else {
                            console.warn(`⚠️ Invalid page number in stable element: ${JSON.stringify(element)}`);
                        }
                    });
                }
            });



            if (pages.size === 0) {
                console.log('⚠️ No pages found in stable elements');
                return null;
            }

            const targetPage = Math.min(...Array.from(pages));

            console.log(`🎯 Determined target page: ${targetPage} (from pages: ${Array.from(pages).sort().join(', ')})`);

            const newCache = new Map(provenancePageCache);
            newCache.set(cacheKey, targetPage);
            setProvenancePageCache(newCache);

            return targetPage;

        } catch (error) {
            console.error('❌ Error getting provenance page:', error);
            return null;
        }
    }, [pdfDoc, provenancePageCache]);

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
        <div className={`pdf-viewer ${debugMode ? 'debug-mode' : ''}`}>
            {/* Header */}
            <div className="pdf-header">
                <div className="pdf-title">
                    <FontAwesomeIcon icon={faFileAlt} />
                    <span>{pdfDocument.filename}</span>


                    {/* Unified status indicator - prioritizes provenance over rendering */}
                    {isProvenanceProcessing ? (
                        <div className="status-indicator-pdf provenance">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Finding Evidence...</span>
                        </div>
                    ) : renderManager.isRendering ? (
                        <div className="status-indicator-pdf rendering">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Rendering Page...</span>
                        </div>
                    ) : renderManager.error ? (
                        <div className="status-indicator-pdf error">
                            <FontAwesomeIcon icon={faExclamationTriangle} />
                            <span>Render Error: {renderManager.error}</span>
                        </div>
                    ) : null}
                </div>


                {/* Navigation */}
                <div className="page-navigation">
                    <button
                        onClick={() => goToPage(renderManager.currentPage - 1, 'user')}
                        disabled={renderManager.currentPage <= 1 || renderManager.isRendering}
                        className="win95-btn nav"
                    >
                        <FontAwesomeIcon icon={faChevronLeft} />
                        Previous
                    </button>

                    {/* Page Info with Input */}
                    <div className="page-info-container">
                        {showPageInput ? (
                            <form onSubmit={handlePageInputSubmit} className="page-input-form">
                                <input
                                    type="number"
                                    min="1"
                                    max={totalPages}
                                    value={pageInputValue}
                                    onChange={(e) => setPageInputValue(e.target.value)}
                                    onKeyDown={handlePageInputKeyDown}
                                    onBlur={() => {
                                        // Hide input when clicking outside, but allow form submission
                                        setTimeout(() => setShowPageInput(false), 150);
                                    }}
                                    className="page-input"
                                    placeholder="Page #"
                                />
                                <span className="page-total">of {totalPages}</span>
                            </form>
                        ) : (
                            <span
                                className="page-info clickable"
                                onClick={handlePageInfoClick}
                                title="Click to jump to page"
                            >
                                Page {renderManager.currentPage} of {totalPages}
                            </span>
                        )}
                    </div>

                    <button
                        onClick={() => goToPage(renderManager.currentPage + 1, 'user')}
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
            <div className="pdf-content" ref={containerRef}>
                <div className="pdf-page-container">
                    <canvas ref={canvasRef} className="pdf-canvas" />
                    <div ref={textLayerRef} className="pdf-text-layer" />
                    <div ref={highlightLayerRef} className="pdf-highlight-layer" />

                    {/* Highlighter Component */}
                   
                    {/*{renderManager.isReady && selectedProvenance && (
                        <CoordinateHighlighter
                            provenanceData={selectedProvenance}
                            activeQuestionId={activeQuestionId}
                            pdfDocument={pdfDoc}
                            textLayerRef={textLayerRef}
                            highlightLayerRef={highlightLayerRef}
                            containerRef={containerRef}
                            currentPage={renderManager.currentPage}
                            currentZoom={renderManager.currentZoom}
                            documentFilename={pdfDocument?.filename || ''}
                            highlightStyle={{
                                backgroundColor: 'rgba(76, 175, 80, 0.4)',
                                border: '1px solid rgba(76, 175, 80, 0.8)',
                                borderRadius: '2px'
                            }}
                            searchOptions={{
                                caseSensitive: false,
                                matchThreshold: 0.75, // Slightly lower for better recall
                                maxGapBetweenWords: 30, // Pixels between words to group
                                contextWindow: 3 // Words of context
                            }}
                            className="direct-provenance-highlight"
                            verbose={true} // Enable detailed logging for debugging
                        />*/}
                        {renderManager.isReady && selectedProvenance && (
                        <HybridCoordinateHighlighter
                            provenanceData={selectedProvenance}
                            activeQuestionId={activeQuestionId}
                            pdfDocument={pdfDoc}
                            textLayerRef={textLayerRef}
                            highlightLayerRef={highlightLayerRef}
                            containerRef={containerRef}
                            currentPage={renderManager.currentPage}
                            currentZoom={renderManager.currentZoom}
                            documentFilename={pdfDocument?.filename || ''}
                            highlightStyle={{
                                backgroundColor: 'rgba(76, 175, 80, 0.4)',
                                border: '1px solid rgba(76, 175, 80, 0.8)',
                                borderRadius: '2px'
                            }}
                            searchOptions={{
                                caseSensitive: false,
                                matchThreshold: 0.75, // Slightly lower for better recall
                                maxGapBetweenWords: 30, // Pixels between words to group
                                contextWindow: 3 // Words of context
                            }}
                            className="direct-provenance-highlight"
                            verbose={true} // Enable detailed logging for debugging
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default PDFViewer;