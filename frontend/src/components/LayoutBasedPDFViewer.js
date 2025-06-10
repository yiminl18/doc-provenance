// LayoutBasedPDFViewer.js - Updated to use PDFTextHighlighter
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSearchPlus,
    faSearchMinus,
    faComment,
    faFileAlt,
    faSpinner,
    faChevronLeft,
    faChevronRight,
    faTimes,
    faExclamationTriangle
} from '@fortawesome/free-solid-svg-icons';
import '../styles/pdf-viewer.css';
import { calculateProvenanceCost, formatCost } from '../utils/ProvenanceOutputsFormatting';
import { PDFTextHighlighterModular as PDFTextHighlighter, PDFTextHighlightingUtils } from './PDFTextHighlighterModular'; // Updated import

const LayoutBasedPDFViewer = ({
    pdfDocument,
    selectedProvenance,
    activeQuestionId,
    onClose,
    onFeedbackRequest,
    navigationTrigger
}) => {
    // Core PDF state
    const [zoomLevel, setZoomLevel] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [fixedDimensions, setFixedDimensions] = useState(null);
    const [currentViewport, setCurrentViewport] = useState(null);

    // Rendering state
    const [isRendering, setIsRendering] = useState(false);
    const [renderError, setRenderError] = useState(null);
    const [lastRenderedPage, setLastRenderedPage] = useState(null);

    // Magnify state
    const [magnifyMode, setMagnifyMode] = useState(false);
    const [selectedHighlight, setSelectedHighlight] = useState(null);

    // Refs
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);
    const highlightLayerRef = useRef(null);
    const containerRef = useRef(null);
    const renderTaskRef = useRef(null);
    const pdfViewerRef = useRef(null);

    // Initialize PDF.js worker
    useEffect(() => {
        if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            //console.log('✅ PDF.js worker initialized for layout-based viewer');
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
        //console.log('🔗 PDF URL set:', url);

        return () => {
            if (pdfDocument.file && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        }
    }, [pdfDocument]);

    // Load PDF
    useEffect(() => {
        if (!pdfUrl || !window.pdfjsLib) return;
        loadPDF();
    }, [pdfUrl]);

    // Handle page changes
    useEffect(() => {
        if (pdfDoc && !loading && !isRendering && currentPage !== lastRenderedPage) {
            //console.log(`📄 Page changed from ${lastRenderedPage} to ${currentPage} - rendering`);
            renderPageSafely(currentPage);
            
        }
    }, [pdfDoc, loading, currentPage, zoomLevel, lastRenderedPage]);



    

    // Calculate fixed viewer dimensions
    const calculateFixedViewerDimensions = () => {
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;

        const minWidth = Math.max(screenWidth * 0.5, 600);
        const minHeight = Math.max(screenHeight * 0.75, 800);
        const maxWidth = Math.min(minWidth, 800);
        const maxHeight = Math.min(minHeight, 1200);

        return {
            width: maxWidth,
            height: maxHeight,
            screenWidth,
            screenHeight
        };
    };

    // Initialize fixed dimensions
    useEffect(() => {
        const dimensions = calculateFixedViewerDimensions();
        setFixedDimensions(dimensions);

        //console.log('📐 Fixed PDF viewer dimensions calculated:', {
        //    viewerSize: `${dimensions.width}x${dimensions.height}`,
        //    screenSize: `${dimensions.screenWidth}x${dimensions.screenHeight}`
        //});
    }, []);

    // Calculate initial zoom for fixed dimensions
    const calculateInitialZoomFixed = (viewport, fixedWidth) => {
        if (!viewport || !fixedWidth) return 1.0;

        const padding = 40;
        const availableWidth = fixedWidth - padding;
        const scale = availableWidth / viewport.width;

        return Math.max(0.4, Math.min(2.5, scale));
    };

    // Handle navigation triggers - Updated for text-based highlighting
    useEffect(() => {
        if (!navigationTrigger) return;

        //console.log('🧭 Processing navigation trigger:', navigationTrigger);
        
        // For text-based highlighting, we can scroll to the first highlight
        setTimeout(() => {
            const scrolled = PDFTextHighlightingUtils.scrollToFirstHighlight(highlightLayerRef);
            if (scrolled) {
                console.log('✅ Scrolled to first text highlight');
            } else {
                console.log('⚠️ No highlights found to scroll to');
            }
        }, 300);
        
    }, [navigationTrigger]);

    const loadPDF = async () => {
        setLoading(true);
        setError(null);
        setRenderError(null);

        try {
            //console.log('🔄 Loading PDF...');

            const loadingTask = window.pdfjsLib.getDocument({
                url: pdfUrl,
                verbosity: 0
            });

            const pdf = await loadingTask.promise;
            //console.log('✅ PDF loaded:', pdf.numPages, 'pages');

            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setCurrentPage(1);
            setLastRenderedPage(null);
            setLoading(false);

        } catch (err) {
            console.error('❌ Error loading PDF:', err);
            setError(`Failed to load document: ${err.message}`);
            setLoading(false);
        }
    };

    const renderPageSafely = async (pageNum) => {
        if (isRendering) {
            //console.log(`⏸️ Render in progress, skipping page ${pageNum}`);
            return;
        }

        // Cancel any existing render task
        if (renderTaskRef.current) {
            //console.log('🛑 Cancelling previous render task');
            try {
                renderTaskRef.current.cancel();
            } catch (e) {
                console.error('🛑 Previous render task cancelled');
            }
            renderTaskRef.current = null;
        }

        setIsRendering(true);
        setRenderError(null);

        try {
            await renderPage(pageNum);
            setLastRenderedPage(pageNum);
            //console.log(`✅ Page ${pageNum} rendered successfully`);
        } catch (error) {
            if (error.name === 'RenderingCancelledException') {
                console.log(`🛑 Render cancelled for page ${pageNum} - this is normal`);
            } else {
                console.error(`❌ Render error for page ${pageNum}:`, error);
                setRenderError(error.message);
            }
        } finally {
            setIsRendering(false);
        }
    };

    const renderPage = async (pageNum) => {
        if (!pdfDoc || !canvasRef.current || !containerRef.current) {
            throw new Error('Missing PDF document or canvas refs');
        }

        //console.log(`🎨 Rendering page ${pageNum}...`);

        const page = await pdfDoc.getPage(pageNum);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        const baseViewport = page.getViewport({ scale: 1.0 });

        // Calculate zoom
        let finalScale;
        if (lastRenderedPage === null && zoomLevel === 1.0) {
            const initialZoom = calculateInitialZoomFixed(baseViewport, fixedDimensions.width);
            setZoomLevel(initialZoom);
            finalScale = initialZoom;
            //console.log(`📏 Setting initial zoom: ${(initialZoom * 100).toFixed(0)}%`);
        } else {
            finalScale = zoomLevel;
        }

        const viewport = page.getViewport({ scale: finalScale });
        setCurrentViewport(viewport);

        // Setup canvas
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.scale(devicePixelRatio, devicePixelRatio);

        // Render PDF
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        renderTaskRef.current = page.render(renderContext);
        try {
            await renderTaskRef.current.promise;
            //console.log(`✅ Render task completed for page ${pageNum}`);
        } catch (error) {
            if (error.name === 'RenderingCancelledException') {
                console.log(`🛑 Render task cancelled for page ${pageNum}`);
                throw error;
            } else {
                console.error(`❌ Render task failed for page ${pageNum}:`, error);
                throw error;
            }
        } finally {
            renderTaskRef.current = null;
        }

        // Setup text layer
        await setupTextLayer(page, viewport);

        // Setup highlight layer
        setupHighlightLayer();

        //console.log(`✅ Page ${pageNum} rendered at ${(finalScale * 100).toFixed(0)}% zoom`);
    };

    const setupTextLayer = async (page, viewport) => {
        if (!textLayerRef.current) return;

        try {
            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;

            textLayer.innerHTML = '';
            textLayer.style.position = 'absolute';
            textLayer.style.left = '0px';
            textLayer.style.top = '0px';
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            textLayer.style.overflow = 'hidden';
            textLayer.style.pointerEvents = 'none';
            textLayer.style.opacity = '0'; // Keep invisible for highlighting
            textLayer.style.setProperty('--scale-factor', viewport.scale);

            // Position relative to canvas
            const canvas = canvasRef.current;
            if (canvas) {
                const canvasRect = canvas.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();
                textLayer.style.left = `${canvasRect.left - containerRect.left}px`;
                textLayer.style.top = `${canvasRect.top - containerRect.top}px`;
            }

            // Render text layer for text search
            if (window.pdfjsLib.renderTextLayer) {
                await window.pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport: viewport,
                    textDivs: []
                });
            }

            //console.log('✅ Text layer setup completed');

        } catch (err) {
            console.error('❌ Error setting up text layer:', err);
        }
    };

    const setupHighlightLayer = () => {
        if (!highlightLayerRef.current || !textLayerRef.current) return;

        const highlightLayer = highlightLayerRef.current;
        const textLayer = textLayerRef.current;

        highlightLayer.innerHTML = '';
        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = textLayer.style.left;
        highlightLayer.style.top = textLayer.style.top;
        highlightLayer.style.width = textLayer.style.width;
        highlightLayer.style.height = textLayer.style.height;
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';

        //console.log('✅ Highlight layer positioned');
    };

    

    // Handle highlight clicks - Updated for text highlighter
    const handleHighlightClick = (highlightData) => {
        console.log('🎯 Text highlight clicked:', highlightData);

        
        
        setSelectedHighlight({
            index: highlightData.index,
            text: highlightData.text,
            confidence: highlightData.confidence,
            matchType: highlightData.matchType,
            searchText: highlightData.searchText,
            page: highlightData.page,
            inputTokens: selectedProvenance?.input_token_size,
            outputTokens: selectedProvenance?.output_token_size
        });
        setMagnifyMode(true);
    };

    // Magnify functionality
    const closeMagnify = () => {
        setMagnifyMode(false);
        setSelectedHighlight(null);
    };

    // Navigation handlers
    const goToPage = (pageNum) => {
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage && !isRendering) {
            //console.log(`📖 Navigating to page ${pageNum}`);
            setCurrentPage(pageNum);
        }
    };

    const handleZoomIn = () => {
        if (isRendering) return;
        const newZoom = Math.min(zoomLevel + 0.25, 3);
        //console.log(`🔍 Zoom IN: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
        setZoomLevel(newZoom);
        setLastRenderedPage(null);
    };

    const handleZoomOut = () => {
        if (isRendering) return;
        const newZoom = Math.max(zoomLevel - 0.25, 0.5);
        //console.log(`🔍 Zoom OUT: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
        setZoomLevel(newZoom);
        setLastRenderedPage(null);
    };

    const handleResetZoom = () => {
        if (isRendering) return;
        //console.log(`🔍 RESET ZOOM: ${(zoomLevel * 100).toFixed(0)}% → fit-to-width`);
        setZoomLevel(1.0);
        setLastRenderedPage(null);
    };

    // Cleanup
    useEffect(() => {
        return () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, []);

    // Extract document ID for highlighter
    const documentId = pdfDocument?.filename?.replace('.pdf', '') || '';

    // Render states
    if (!pdfDocument) {
        return (
            <div className="pdf-viewer-empty">
                <div className="empty-content">
                    <FontAwesomeIcon icon={faFileAlt} size="3x" />
                    <h3>No Document Selected</h3>
                    <p>Upload a PDF to view content with text-based highlighting</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="pdf-viewer-loading">
                <div className="loading-content">
                    <FontAwesomeIcon icon={faSpinner} spin size="2x" />
                    <h3>Loading PDF...</h3>
                    <p>Initializing text-based viewer for {pdfDocument.filename}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="pdf-viewer-error">
                <div className="error-content">
                    <h3>PDF Loading Error</h3>
                    <p>{error}</p>
                    <button onClick={loadPDF} className="win95-btn retry">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="pdf-viewer layout-based fixed-size" ref={pdfViewerRef}>
            {/* Header */}
            <div className="pdf-header">
                <div className="pdf-title">
                    <FontAwesomeIcon icon={faFileAlt} />
                    <span>{pdfDocument.filename}</span>
                </div>

                {/* Provenance info */}
                {selectedProvenance && selectedProvenance.input_token_size && selectedProvenance.output_token_size && (
                    <div className="layout-info">
                        <div className="provenance-meta">
                            <span><strong>Time Elapsed:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s</span>
                            | <span className="cost-estimate">
                                <strong>Cost Estimate:</strong> {calculateProvenanceCost(
                                    selectedProvenance.input_token_size,
                                    selectedProvenance.output_token_size
                                ).formattedCost}
                            </span>
                        </div>
                    </div>
                )}

                {isRendering && (
                    <span className="rendering-indicator">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        Rendering...
                    </span>
                )}

                {/* Show highlight statistics */}
                {!isRendering && selectedProvenance && (() => {
                    const stats = PDFTextHighlightingUtils.getHighlightStats(highlightLayerRef);
                    return stats && stats.totalHighlights > 0 ? (
                        <div className="highlight-stats">
                            <span>✨ {stats.totalHighlights} highlights ({(stats.averageConfidence * 100).toFixed(0)}% avg confidence)</span>
                        </div>
                    ) : null;
                })()}

                {/* Fixed size indicator */}
                {fixedDimensions && (
                    <div className="viewer-size-info">
                        <span className="size-display">
                            📐 {fixedDimensions.width}×{fixedDimensions.height}px
                        </span>
                    </div>
                )}
            </div>

            {/* Page Navigation */}
            <div className="page-navigation">
                <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage <= 1 || isRendering}
                    className="win95-btn nav"
                >
                    <FontAwesomeIcon icon={faChevronLeft} />
                    Previous
                </button>

                <span className="page-info">
                    Page {currentPage} of {totalPages}
                </span>

                <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages || isRendering}
                    className="win95-btn nav"
                >
                    Next
                    <FontAwesomeIcon icon={faChevronRight} />
                </button>

                <div className="pdf-controls">
                    <button onClick={handleZoomOut} className="win95-btn control" disabled={isRendering}>
                        <FontAwesomeIcon icon={faSearchMinus} />
                    </button>

                    <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>

                    <button onClick={handleZoomIn} className="win95-btn control" disabled={isRendering}>
                        <FontAwesomeIcon icon={faSearchPlus} />
                    </button>

                    <button
                        onClick={handleResetZoom}
                        className="win95-btn control reset-zoom-btn"
                        disabled={isRendering}
                        title="Reset to fit page width"
                    >
                        Reset
                    </button>
                </div>
            </div>

            {/* Render Error Display */}
            {renderError && (
                <div className="render-error">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <span>Render Error: {renderError}</span>
                    <button onClick={() => renderPageSafely(currentPage)} className="win95-btn retry">
                        Retry
                    </button>
                </div>
            )}

            {/* Main Content */}
            <div className="hybrid-content">
                <div className="pdf-main-view full-width">
                    <div className="pdf-content" ref={containerRef}>
                        <div className="pdf-page-container">
                            <canvas ref={canvasRef} className="pdf-canvas" />
                            <div ref={textLayerRef} className="pdf-text-layer" />
                            <div ref={highlightLayerRef} className="pdf-highlight-layer" />
                            
                            {/* PDFTextHighlighter Integration */}
                            {!isRendering && currentViewport && selectedProvenance && (
                                <PDFTextHighlighter
                                    documentId={documentId}
                                    currentPage={currentPage}
                                    provenanceData={selectedProvenance}
                                    textLayerRef={textLayerRef}
                                    highlightLayerRef={highlightLayerRef}
                                    currentViewport={currentViewport}
                                    onHighlightClick={handleHighlightClick}
                                    isRendering={isRendering}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Magnify Overlay - Updated for text highlighting */}
            {magnifyMode && selectedHighlight && (
                <div className="magnify-overlay" onClick={closeMagnify}>
                    <div className="magnify-content" onClick={(e) => e.stopPropagation()}>
                        <div className="magnify-header">
                            <h3>
                                <FontAwesomeIcon icon={faSearchPlus} />
                                Text Match ({selectedHighlight.matchType || 'Text Search'})
                            </h3>
                            <button onClick={closeMagnify} className="close-magnify-btn">
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </div>
                        <div className="magnify-body">
                            <div className="sentence-info">
                                <span><strong>Match Type:</strong> {selectedHighlight.matchType}</span>
                                {selectedHighlight.confidence !== undefined && (
                                    <span><strong>Confidence:</strong> {(selectedHighlight.confidence * 100).toFixed(0)}%</span>
                                )}
                                <span><strong>Page:</strong> {selectedHighlight.page}</span>

                                {selectedHighlight.inputTokens && selectedHighlight.outputTokens && (
                                    <div className="cost-details">
                                        {(() => {
                                            const cost = calculateProvenanceCost(
                                                selectedHighlight.inputTokens,
                                                selectedHighlight.outputTokens
                                            );
                                            return (
                                                <>
                                                    <span><strong>Input Tokens:</strong> {selectedHighlight.inputTokens.toLocaleString()}</span>
                                                    <span><strong>Output Tokens:</strong> {selectedHighlight.outputTokens.toLocaleString()}</span>
                                                    <span><strong>Input Cost:</strong> {formatCost(cost.inputCost)}</span>
                                                    <span><strong>Output Cost:</strong> {formatCost(cost.outputCost)}</span>
                                                    <span className="total-cost"><strong>Total Cost:</strong> {cost.formattedCost}</span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                            
                            <div className="magnified-text">
                                {selectedHighlight.text}
                            </div>
                            
                            {selectedHighlight.searchText && selectedHighlight.searchText !== selectedHighlight.text && (
                                <div className="search-context">
                                    <h4>Search Context:</h4>
                                    <p>{selectedHighlight.searchText}</p>
                                </div>
                            )}
                            
                            <div className="provenance-actions">
                                <button
                                    className="win95-btn feedback"
                                    onClick={() => onFeedbackRequest && onFeedbackRequest(activeQuestionId)}
                                >
                                    <FontAwesomeIcon icon={faComment} />
                                    Provide Feedback
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LayoutBasedPDFViewer;