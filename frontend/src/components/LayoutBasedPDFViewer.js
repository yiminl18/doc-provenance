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
import { getProvenanceHighlightingBoxes } from '../services/api';

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

    // Document sentences for text display
    const [documentSentences, setDocumentSentences] = useState([]);

    // Rendering state
    const [isRendering, setIsRendering] = useState(false);
    const [renderError, setRenderError] = useState(null);
    const [lastRenderedPage, setLastRenderedPage] = useState(null);

    // Highlight persistence state
    const [activeHighlights, setActiveHighlights] = useState(new Map());
    const [highlightsPersisted, setHighlightsPersisted] = useState(false);
    const [currentProvenanceId, setCurrentProvenanceId] = useState(null);

    // Magnify state
    const [magnifyMode, setMagnifyMode] = useState(false);
    const [selectedHighlight, setSelectedHighlight] = useState(null);

    // Refs
    const canvasRef = useRef(null);
    const textLayerRef = useRef(null);
    const highlightLayerRef = useRef(null);
    const containerRef = useRef(null);
    const renderTaskRef = useRef(null);

    // Initialize PDF.js worker
    useEffect(() => {
        if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            console.log('✅ PDF.js worker initialized for layout-based viewer');
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
        console.log('🔗 PDF URL set:', url);

        return () => {
            if (pdfDocument.file && url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        };
    }, [pdfDocument]);

    // Load PDF and document data
    useEffect(() => {
        if (!pdfUrl || !window.pdfjsLib) return;
        loadPDFWithDocumentData();
    }, [pdfUrl]);

    // Handle page changes
    useEffect(() => {
        if (pdfDoc && !loading && !isRendering && currentPage !== lastRenderedPage) {
            console.log(`📄 Page changed from ${lastRenderedPage} to ${currentPage} - rendering`);
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

        console.log('📐 Fixed PDF viewer dimensions calculated:', {
            viewerSize: `${dimensions.width}x${dimensions.height}`,
            screenSize: `${dimensions.screenWidth}x${dimensions.screenHeight}`
        });
    }, []);

    // Calculate initial zoom for fixed dimensions
    const calculateInitialZoomFixed = (viewport, fixedWidth) => {
        if (!viewport || !fixedWidth) return 1.0;

        const padding = 40;
        const availableWidth = fixedWidth - padding;
        const scale = availableWidth / viewport.width;

        return Math.max(0.4, Math.min(2.5, scale));
    };

    // Create highlights when provenance is selected
    const stableCreateHighlights = useCallback(() => {
        if (selectedProvenance && currentViewport && !isRendering && highlightLayerRef.current) {
            const provenanceId = selectedProvenance.provenance_id;

            if (provenanceId !== currentProvenanceId || !highlightsPersisted) {
                console.log('🎯 Creating NEW API-based highlights for provenance:', provenanceId);
                setCurrentProvenanceId(provenanceId);
                createLayoutBasedHighlights();
            }
        }
    }, [selectedProvenance?.provenance_id, currentPage, currentViewport, currentProvenanceId, highlightsPersisted, isRendering]);

    // Trigger highlighting after rendering
    useEffect(() => {
        if (!isRendering && currentViewport && selectedProvenance) {
            const timer = setTimeout(() => {
                console.log('🕐 Timer triggered - checking if highlights should be created');
                stableCreateHighlights();
            }, 200);

            return () => {
                console.log('🕐 Timer cancelled');
                clearTimeout(timer);
            };
        }
    }, [stableCreateHighlights, isRendering, currentViewport, selectedProvenance]);

    // Handle navigation triggers
    useEffect(() => {
        if (!navigationTrigger) return;

        console.log('🧭 Processing navigation trigger:', navigationTrigger);
        const { sentenceId } = navigationTrigger;

        if (sentenceId !== undefined) {
            console.log(`📄 Navigation to sentence ${sentenceId}`);

            // Find any existing highlight for this sentence
            setTimeout(() => {
                const existingHighlight = highlightLayerRef.current?.querySelector(`[data-sentence-id="${sentenceId}"]`);

                if (existingHighlight) {
                    console.log(`✅ Found existing highlight for sentence ${sentenceId}, scrolling`);
                    existingHighlight.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                        inline: 'center'
                    });
                } else {
                    console.log(`⚠️ No highlight found for sentence ${sentenceId} on current page`);
                }
            }, 300);
        }
    }, [navigationTrigger]);

    const loadPDFWithDocumentData = async () => {
        setLoading(true);
        setError(null);
        setRenderError(null);
        setHighlightsPersisted(false);

        try {
            console.log('🔄 Loading PDF with document data...');

            // Load PDF document
            const loadingTask = window.pdfjsLib.getDocument({
                url: pdfUrl,
                verbosity: 0
            });

            const pdf = await loadingTask.promise;
            console.log('✅ PDF loaded:', pdf.numPages, 'pages');

            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setCurrentPage(1);
            setLastRenderedPage(null);

            // Load document sentences for text display
            await loadDocumentSentences();

            setLoading(false);

        } catch (err) {
            console.error('❌ Error loading PDF:', err);
            setError(`Failed to load document: ${err.message}`);
            setLoading(false);
        }
    };

    const loadDocumentSentences = async () => {
        try {
            console.log('📄 Loading document sentences for text display');

            const sentencesResponse = await fetch(`/api/documents/${pdfDocument.filename}/sentences`);

            if (sentencesResponse.ok) {
                const sentencesResult = await sentencesResponse.json();

                if (sentencesResult.success) {
                    const sentences = sentencesResult.sentences;
                    console.log('✅ Loaded document sentences:', Array.isArray(sentences) ? sentences.length : Object.keys(sentences).length);

                    setDocumentSentences(sentences);
                    return;
                }
            }

            console.warn('⚠️ Could not load document sentences');

        } catch (error) {
            console.error('❌ Error loading document sentences:', error);
        }
    };

    const renderPageSafely = async (pageNum) => {
        if (isRendering) {
            console.log(`⏸️ Render in progress, skipping page ${pageNum}`);
            return;
        }

        // Cancel any existing render task
        if (renderTaskRef.current) {
            console.log('🛑 Cancelling previous render task');
            try {
                renderTaskRef.current.cancel();
            } catch (e) {
                console.log('🛑 Previous render task cancelled');
            }
            renderTaskRef.current = null;
        }

        setIsRendering(true);
        setRenderError(null);
        setHighlightsPersisted(false);

        try {
            await renderPageWithLayout(pageNum);
            setLastRenderedPage(pageNum);
            console.log(`✅ Page ${pageNum} rendered successfully`);
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

    const renderPageWithLayout = async (pageNum) => {
        if (!pdfDoc || !canvasRef.current || !containerRef.current) {
            throw new Error('Missing PDF document or canvas refs');
        }

        console.log(`🎨 Rendering page ${pageNum}...`);

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
            console.log(`📏 Setting initial zoom: ${(initialZoom * 100).toFixed(0)}%`);
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
            console.log(`✅ Render task completed for page ${pageNum}`);
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

        console.log(`✅ Page ${pageNum} rendered at ${(finalScale * 100).toFixed(0)}% zoom`);
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
            textLayer.style.opacity = '0';
            textLayer.style.setProperty('--scale-factor', viewport.scale);

            // Position relative to canvas
            const canvas = canvasRef.current;
            if (canvas) {
                const canvasRect = canvas.getBoundingClientRect();
                const containerRect = containerRef.current.getBoundingClientRect();
                textLayer.style.left = `${canvasRect.left - containerRect.left}px`;
                textLayer.style.top = `${canvasRect.top - containerRect.top}px`;
            }

            // Render text layer
            if (window.pdfjsLib.renderTextLayer) {
                await window.pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport: viewport,
                    textDivs: []
                });
            }

            console.log('✅ Text layer setup completed');

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

        console.log('✅ Highlight layer positioned');
    };

   // In LayoutBasedPDFViewer.js, make sure you're passing the provenance text:
const createLayoutBasedHighlights = async () => {
    if (!selectedProvenance || !currentViewport || !highlightLayerRef.current) {
        console.warn('⚠️ Missing requirements for highlighting');
        return;
    }

    const { sentences_ids, provenance_id, provenance, content } = selectedProvenance;
    
    clearHighlights();

    

    if (!sentences_ids || sentences_ids.length === 0) {
        console.warn('⚠️ No sentence IDs in provenance');
        return;
    }

    // Get the actual provenance text to search for
    const provenanceText = provenance || (content && content.join(' ')) || '';
    
    console.log(`🎯 Creating SENTENCE-CONSTRAINED highlights:`, {
        sentenceIds: sentences_ids,
        provenanceText: provenanceText.substring(0, 100) + '...'
    });

    try {
        const response = await getProvenanceHighlightingBoxes(
            pdfDocument.filename,
            sentences_ids,
            provenance_id,
            provenanceText // The actual text to find within those sentences
        );

        if (response.success && response.bounding_boxes) {
            console.log('✅ Received sentence-constrained bounding boxes:', {
                dataSource: response.data_source,
                totalSentences: sentences_ids.length,
                boxesReceived: Object.keys(response.bounding_boxes).length,
                avgConfidence: response.statistics?.avg_confidence || 'N/A'
            });

            let highlightsCreated = 0;
            const newHighlights = new Map();

            Object.entries(response.bounding_boxes).forEach(([sentenceId, boxes]) => {
                const sentenceIdNum = parseInt(sentenceId);
                
                const pageBoxes = boxes.filter(box => 
                    box.page === currentPage && 
                    box.confidence > 0.4  // Slightly higher threshold for precise matches
                );

                if (pageBoxes.length === 0) {
                    console.log(`📄 Sentence ${sentenceId} not on page ${currentPage}`);
                    return;
                }

                console.log(`📍 Creating ${pageBoxes.length} CONSTRAINED highlights for sentence ${sentenceId}`);

                pageBoxes.forEach((bbox, bboxIndex) => {
                    const highlightElement = createPreciseHighlightFromAPI(
                        bbox, 
                        sentenceIdNum, 
                        bboxIndex, 
                        provenance_id,
                        provenanceText
                    );
                    
                    if (highlightElement) {
                        newHighlights.set(`${sentenceId}_${bboxIndex}`, highlightElement);
                        highlightsCreated++;
                    }
                });
            });

            setActiveHighlights(newHighlights);
            setHighlightsPersisted(true);
            
            console.log(`✅ Created ${highlightsCreated} sentence-constrained highlights`);

        } else {
            console.warn('⚠️ Sentence-constrained search failed, using fallback');
            createFallbackHighlights(sentences_ids, provenance_id);
        }

    } catch (error) {
        console.error('❌ Error getting sentence-constrained boxes:', error);
        createFallbackHighlights(sentences_ids, provenance_id);
    }
};
    const createPreciseHighlightFromAPI = (bbox, sentenceId, bboxIndex, provenanceId, sentenceText) => {
        if (!currentViewport || !highlightLayerRef.current) return null;

        // Convert PDF coordinates to viewport coordinates
        const pdfToViewport = (pdfX, pdfY) => {
            const viewportX = pdfX * currentViewport.scale;
            const viewportY = (currentViewport.height / currentViewport.scale - pdfY) * currentViewport.scale;
            return { x: viewportX, y: viewportY };
        };

        const topLeft = pdfToViewport(bbox.x0, bbox.y1);
        const bottomRight = pdfToViewport(bbox.x1, bbox.y0);
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        // Basic validation
        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid bbox dimensions: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'provenance-overlay';
        overlay.setAttribute('data-sentence-id', sentenceId);
        overlay.setAttribute('data-bbox-index', bboxIndex);
        overlay.setAttribute('data-provenance-id', provenanceId);
        overlay.setAttribute('data-confidence', bbox.confidence.toFixed(2));
        overlay.setAttribute('data-source', bbox.source || 'api');

        // Styling with confidence-based transparency
        const alpha = Math.max(0.3, bbox.confidence * 0.6);
        const borderAlpha = Math.max(0.5, bbox.confidence);

        overlay.style.cssText = `
            position: absolute;
            left: ${topLeft.x}px;
            top: ${topLeft.y}px;
            width: ${width}px;
            height: ${height}px;
            background-color: rgba(255, 193, 7, ${alpha});
            border: 2px solid rgba(255, 193, 7, ${borderAlpha});
            border-radius: 4px;
            z-index: 9999;
            pointer-events: auto;
            cursor: pointer;
            opacity: 1;
            display: block;
            visibility: visible;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        `;

        overlay.title = `Evidence ${bboxIndex + 1}\nSentence: ${sentenceId}\nConfidence: ${(bbox.confidence * 100).toFixed(0)}%\nSource: ${bbox.source}`;

        // Add click handler for magnification
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked highlight: sentence ${sentenceId}, bbox ${bboxIndex}`);

            // Visual feedback
            overlay.style.transform = 'scale(1.05)';
            overlay.style.borderWidth = '3px';
            setTimeout(() => {
                overlay.style.transform = 'scale(1)';
                overlay.style.borderWidth = '2px';
            }, 200);

            // Show magnified text
            showMagnifiedText({
                sentenceId,
                sentenceText: sentenceText,
                bbox,
                overlayElement: overlay,
                confidence: bbox.confidence,
                inputTokens: selectedProvenance.input_token_size,
                outputTokens: selectedProvenance.output_token_size,
                source: bbox.source
            });
        });

        // Hover effects
        overlay.addEventListener('mouseenter', () => {
            overlay.style.transform = 'scale(1.02)';
            overlay.style.zIndex = '600';
            overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
        });

        overlay.addEventListener('mouseleave', () => {
            overlay.style.transform = 'scale(1)';
            overlay.style.zIndex = '500';
            overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        });

        highlightLayerRef.current.appendChild(overlay);
        return overlay;
    };

    const createFallbackHighlights = (sentenceIds, provenanceId) => {
        console.log('🆘 Creating fallback highlights');

        let highlightsCreated = 0;
        const newHighlights = new Map();

        sentenceIds.forEach((sentenceId, index) => {
            const fallbackBox = {
                left: 20,
                top: 20 + (index * 40),
                width: 250,
                height: 35
            };

            const overlay = document.createElement('div');
            overlay.className = 'provenance-overlay fallback-highlight';
            overlay.setAttribute('data-sentence-id', sentenceId);
            overlay.setAttribute('data-provenance-id', provenanceId);

            overlay.style.cssText = `
                position: absolute;
                left: ${fallbackBox.left}px;
                top: ${fallbackBox.top}px;
                width: ${fallbackBox.width}px;
                height: ${fallbackBox.height}px;
                background-color: rgba(255, 69, 0, 0.8);
                border: 2px solid rgba(255, 69, 0, 1);
                border-radius: 4px;
                z-index: 550;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 12px;
                cursor: pointer;
            `;

            overlay.innerHTML = `📍 Evidence ${index + 1} (Fallback)`;
            overlay.title = `Fallback highlight for sentence ${sentenceId}`;

            overlay.addEventListener('click', (e) => {
                e.stopPropagation();

                // Get sentence text for fallback
                let sentenceText = `Sentence ${sentenceId}`;
                if (Array.isArray(documentSentences)) {
                    sentenceText = documentSentences[sentenceId] || sentenceText;
                } else if (documentSentences && typeof documentSentences === 'object') {
                    sentenceText = documentSentences[sentenceId] || sentenceText;
                }

                showMagnifiedText({
                    sentenceId,
                    sentenceText: sentenceText,
                    overlayElement: overlay,
                    isFallback: true,
                    inputTokens: selectedProvenance.input_token_size,
                    outputTokens: selectedProvenance.output_token_size
                });
            });

            highlightLayerRef.current.appendChild(overlay);
            newHighlights.set(`${sentenceId}_fallback`, overlay);
            highlightsCreated++;
        });

        setActiveHighlights(newHighlights);
        setHighlightsPersisted(true);
        console.log(`✅ Created ${highlightsCreated} fallback highlights`);
    };

    // Magnify functionality
    const showMagnifiedText = (highlightData) => {
        console.log(`🔍 Showing magnified text for highlight:`, highlightData);
        setSelectedHighlight(highlightData);
        setMagnifyMode(true);
    };

    const closeMagnify = () => {
        setMagnifyMode(false);
        setSelectedHighlight(null);
    };

    const clearHighlights = () => {
        if (!highlightLayerRef.current) return;

        const overlays = highlightLayerRef.current.querySelectorAll('.provenance-overlay');
        console.log(`🧹 Clearing ${overlays.length} highlights`);

        highlightLayerRef.current.innerHTML = '';
        setActiveHighlights(new Map());
        setHighlightsPersisted(false);
    };

    // Navigation handlers
    const goToPage = (pageNum) => {
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage && !isRendering) {
            console.log(`📖 Navigating to page ${pageNum}`);
            setCurrentPage(pageNum);
        }
    };

    const handleZoomIn = () => {
    if (isRendering) return;
    const newZoom = Math.min(zoomLevel + 0.25, 3);
    console.log(`🔍 Zoom IN: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
    setZoomLevel(newZoom);
    setLastRenderedPage(null); // Force re-render
    setHighlightsPersisted(false);
};

const handleZoomOut = () => {
    if (isRendering) return;
    const newZoom = Math.max(zoomLevel - 0.25, 0.5);
    console.log(`🔍 Zoom OUT: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
    setZoomLevel(newZoom);
    setLastRenderedPage(null); // Force re-render
    setHighlightsPersisted(false);
};

const handleResetZoom = () => {
    if (isRendering) return;
    console.log(`🔍 RESET ZOOM: ${(zoomLevel * 100).toFixed(0)}% → fit-to-width`);
    setZoomLevel(1.0); // This will trigger initial fit-to-width calculation
    setLastRenderedPage(null); // Force re-render
    setHighlightsPersisted(false);
};

    // Cleanup
    useEffect(() => {
        return () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, []);

    // Render states
    if (!pdfDocument) {
        return (
            <div className="pdf-viewer-empty">
                <div className="empty-content">
                    <FontAwesomeIcon icon={faFileAlt} size="3x" />
                    <h3>No Document Selected</h3>
                    <p>Upload a PDF to view content with layout-based highlighting</p>
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
                    <p>Initializing layout-based viewer for {pdfDocument.filename}</p>
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
                    <button onClick={loadPDFWithDocumentData} className="retry-btn">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="hybrid-pdf-viewer layout-based fixed-size">
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
                    className="nav-btn"
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
                    className="nav-btn"
                >
                    Next
                    <FontAwesomeIcon icon={faChevronRight} />
                </button>

                <div className="pdf-controls">
                    <button onClick={handleZoomOut} className="control-btn" disabled={isRendering}>
                        <FontAwesomeIcon icon={faSearchMinus} />
                    </button>

                    <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>

                    <button onClick={handleZoomIn} className="control-btn" disabled={isRendering}>
                        <FontAwesomeIcon icon={faSearchPlus} />
                    </button>

                    <button
                        onClick={handleResetZoom}
                        className="control-btn reset-zoom-btn"
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
                    <button onClick={() => renderPageSafely(currentPage)} className="retry-btn-small">
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
                        </div>
                    </div>
                </div>
            </div>

            {/* Magnify Overlay */}
            {magnifyMode && selectedHighlight && (
                <div className="magnify-overlay" onClick={closeMagnify}>
                    <div className="magnify-content" onClick={(e) => e.stopPropagation()}>
                        <div className="magnify-header">
                            <h3>
                                <FontAwesomeIcon icon={faSearchPlus} />
                                Evidence Text {selectedHighlight.isFallback ? '(Fallback)' : '(Precise)'}
                            </h3>
                            <button onClick={closeMagnify} className="close-magnify-btn">
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        </div>
                        <div className="magnify-body">
                            <div className="sentence-info">
                                <span><strong>Sentence ID:</strong> {selectedHighlight.sentenceId}</span>
                                {selectedHighlight.confidence && (
                                    <span><strong>Confidence:</strong> {(selectedHighlight.confidence * 100).toFixed(0)}%</span>
                                )}

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
                                {selectedHighlight.sentenceText}
                            </div>
                            <div className="provenance-actions">
                                <button
                                    className="action-btn feedback-btn"
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