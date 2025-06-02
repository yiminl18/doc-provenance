import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSearchPlus,
    faSearchMinus,
    faExpand,
    faCompress,
    faFileAlt,
    faSpinner,
    faChevronLeft,
    faChevronRight,
    faHighlighter,
    faMapMarkedAlt,
    faTimes,
    faExclamationTriangle,
    faLayerGroup,
    faBullseye
} from '@fortawesome/free-solid-svg-icons';
import '../styles/pdf-viewer.css';
import { calculateProvenanceCost, formatCost } from '../utils/ProvenanceOutputsFormatting'

const LayoutBasedPDFViewer = ({
    pdfDocument,
    selectedProvenance,
    activeQuestionId,
    onClose,
    navigationTrigger
}) => {
    // Core PDF state
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [pdfUrl, setPdfUrl] = useState(null);

    // Layout-specific state
    const [layoutData, setLayoutData] = useState(null);
    const [enhancedSentences, setEnhancedSentences] = useState([]);
    const [currentViewport, setCurrentViewport] = useState(null);
    const [highlightMode, setHighlightMode] = useState('precise'); // 'precise' | 'fallback'

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
    const magnifyOverlayRef = useRef(null);

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

    // Load PDF and layout data
    useEffect(() => {
        if (!pdfUrl || !window.pdfjsLib) return;
        loadPDFWithLayoutData();
    }, [pdfUrl]);

    // Handle page changes - FIXED: Only render if page actually changed
    useEffect(() => {
        if (pdfDoc && !loading && !isRendering && layoutData && currentPage !== lastRenderedPage) {
            console.log(`📄 Page changed from ${lastRenderedPage} to ${currentPage} - rendering`);
            renderPageSafely(currentPage);
        }
    }, [pdfDoc, loading, currentPage, zoomLevel, layoutData, lastRenderedPage]);


    // Handle provenance highlighting
    const stableCreateHighlights = useCallback(() => {
        if (selectedProvenance && layoutData && currentViewport && !isRendering && highlightLayerRef.current) {
            const provenanceId = selectedProvenance.provenance_id;

            
            // Only recreate highlights if provenance actually changed
            if (provenanceId !== currentProvenanceId) {
                console.log('🎯 Creating NEW layout-based highlights for provenance:', provenanceId);
                setCurrentProvenanceId(provenanceId);
                createLayoutBasedHighlights();
            } else if (!highlightsPersisted) {
                console.log('🔄 Restoring highlights for current provenance:', provenanceId);
                createLayoutBasedHighlights();
            }
        }
    }, [selectedProvenance?.provenance_id, currentPage, currentViewport, layoutData, currentProvenanceId, highlightsPersisted]);

    // Trigger highlighting when conditions are met
    useEffect(() => {
        if (!isRendering && currentViewport) {
            // Small delay to ensure rendering is complete
            const timer = setTimeout(() => {
                stableCreateHighlights();
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [stableCreateHighlights, isRendering, currentViewport]);

    // Replace the navigation trigger useEffect with this improved version:
    useEffect(() => {
        if (!navigationTrigger || !layoutData) return;

        console.log('🧭 Processing navigation trigger:', navigationTrigger);
        const { sentenceId } = navigationTrigger;

        if (sentenceId !== undefined && enhancedSentences[sentenceId]) {
            const sentenceData = enhancedSentences[sentenceId];

            // IMPROVED: Handle multi-page sentences
            const { primary_page, page_spans, bounding_boxes } = sentenceData;

            console.log(`📄 Sentence ${sentenceId} spans pages:`, page_spans, 'primary:', primary_page);

            // Check if sentence has content on current page
            const hasContentOnCurrentPage = bounding_boxes?.some(bbox => bbox.page === currentPage && bbox.confidence > 0.3);

            if (hasContentOnCurrentPage) {
                console.log(`✅ Sentence ${sentenceId} has content on current page ${currentPage}`);
                // Same page with content - just scroll and highlight
                setTimeout(() => {
                    const bestBox = bounding_boxes
                        .filter(bbox => bbox.page === currentPage)
                        .sort((a, b) => b.confidence - a.confidence)[0];

                    if (bestBox) {
                        scrollToHighlight(sentenceId, bestBox);
                    }
                }, 300);
            } else if (primary_page && primary_page !== currentPage) {
                console.log(`🔄 Navigating to primary page ${primary_page} for sentence ${sentenceId}`);
                setCurrentPage(primary_page);
            } else if (page_spans && page_spans.length > 0 && !page_spans.includes(currentPage)) {
                // Navigate to first page that has this sentence
                const targetPage = page_spans[0];
                console.log(`🔄 Navigating to first span page ${targetPage} for sentence ${sentenceId}`);
                setCurrentPage(targetPage);
            }
        }
    }, [navigationTrigger, layoutData, enhancedSentences, currentPage]);


    const loadPDFWithLayoutData = async () => {
        setLoading(true);
        setError(null);
        setRenderError(null);
        setHighlightsPersisted(false);

        try {
            console.log('🔄 Loading PDF with enhanced layout data...');

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
            setLastRenderedPage(null)

            // Load enhanced layout data
            await loadEnhancedLayoutData();

            setLoading(false);

        } catch (err) {
            console.error('❌ Error loading PDF:', err);
            setError(`Failed to load document: ${err.message}`);
            setLoading(false);
        }
    };

    const loadEnhancedLayoutData = async () => {
        try {
            const baseFilename = pdfDocument.filename.replace('.pdf', '');

            // Try to load enhanced layout data
            const layoutResponse = await fetch(`/api/documents/${pdfDocument.filename}/layout`);

            if (layoutResponse.ok) {
                const layoutResult = await layoutResponse.json();

                if (layoutResult.success && layoutResult.layout_data) {
                    console.log('✅ Loaded enhanced layout data:', layoutResult.layout_data.metadata);

                    setLayoutData(layoutResult.layout_data);
                    setEnhancedSentences(layoutResult.layout_data.sentences);
                    setHighlightMode('precise');

                    return;
                }
            }

            // Fallback: load basic sentences for compatibility
            console.log('📄 No enhanced layout data, loading basic sentences');
            const sentencesResponse = await fetch(`/api/documents/${pdfDocument.filename}/sentences`);

            if (sentencesResponse.ok) {
                const sentencesData = await sentencesResponse.json();
                const basicSentences = Array.isArray(sentencesData) ? sentencesData : sentencesData.sentences;

                // Create minimal layout data for fallback
                setLayoutData({
                    sentences: basicSentences.map((text, id) => ({
                        sentence_id: id,
                        text,
                        bounding_boxes: [], // Empty - will use fallback highlighting
                        primary_page: 1,
                        page_spans: [1]
                    })),
                    metadata: {
                        total_sentences: basicSentences.length,
                        method: 'fallback_basic_sentences'
                    }
                });

                setEnhancedSentences(basicSentences.map((text, id) => ({
                    sentence_id: id,
                    text,
                    bounding_boxes: [],
                    primary_page: 1,
                    page_spans: [1]
                })));

                setHighlightMode('fallback');
                console.log('✅ Loaded basic sentences as fallback');
            }

        } catch (error) {
            console.error('❌ Error loading layout data:', error);
            setHighlightMode('fallback');
        }
    };

    const renderPageSafely = async (pageNum) => {
        if (isRendering) {
            console.log(`⏸️ Render in progress, skipping page ${pageNum}`);
            return;
        }

        // Cancel any existing render task
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
            renderTaskRef.current = null;
        }

        setIsRendering(true);
        setRenderError(null);
        setHighlightsPersisted(false);

        try {
            await renderPageWithLayout(pageNum);
            setLastRenderedPage(pageNum);
        } catch (error) {
            console.error(`❌ Render error for page ${pageNum}:`, error);
            setRenderError(error.message);
        } finally {
            setIsRendering(false);
        }
    };

    const renderPageWithLayout = async (pageNum) => {
        if (!pdfDoc || !canvasRef.current || !containerRef.current) {
            throw new Error('Missing PDF document or canvas refs');
        }

        console.log(`🎨 Rendering page ${pageNum} with layout support...`);

        const page = await pdfDoc.getPage(pageNum);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        const container = containerRef.current;

        // Calculate optimal scale
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const originalViewport = page.getViewport({ scale: 1.0 });

        const availableWidth = containerWidth - 40;
        const availableHeight = containerHeight - 40;
        const scaleToFit = Math.min(
            availableWidth / originalViewport.width,
            availableHeight / originalViewport.height,
            2.0 // Maximum scale
        );

        const finalScale = scaleToFit * zoomLevel;
        const viewport = page.getViewport({ scale: finalScale });

        setCurrentViewport(viewport);
        console.log(`📏 Viewport: ${viewport.width}x${viewport.height} at scale ${finalScale}`);

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
        await renderTaskRef.current.promise;
        renderTaskRef.current = null;

        // Setup text layer for fallback highlighting
        await setupTextLayer(page, viewport);

        // Setup highlight layer
        setupHighlightLayer();

        console.log(`✅ Page ${pageNum} rendered successfully`);
    };

    const setupTextLayer = async (page, viewport) => {
        if (!textLayerRef.current) return;

        try {
            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;

            // Clear and position text layer
            textLayer.innerHTML = '';
            textLayer.style.position = 'absolute';
            textLayer.style.left = '0px';
            textLayer.style.top = '0px';
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            textLayer.style.overflow = 'hidden';
            textLayer.style.pointerEvents = 'none';
            textLayer.style.opacity = '0'; // Hidden but available for fallback
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

        // Clear existing highlights
        highlightLayer.innerHTML = '';

        // Position highlight layer to match text layer
        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = textLayer.style.left;
        highlightLayer.style.top = textLayer.style.top;
        highlightLayer.style.width = textLayer.style.width;
        highlightLayer.style.height = textLayer.style.height;
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';

        console.log('✅ Highlight layer positioned');
    };

    // Replace the createLayoutBasedHighlights function:
    const createLayoutBasedHighlights = () => {
        if (!selectedProvenance || !enhancedSentences || !currentViewport || !highlightLayerRef.current) {
            console.warn('⚠️ Missing requirements for layout-based highlighting');
            return;
        }

        // Clear existing highlights
        clearHighlights();

        const { sentences_ids, provenance_id } = selectedProvenance;
        if (!sentences_ids || sentences_ids.length === 0) {
            console.warn('⚠️ No sentence IDs in provenance');
            return;
        }

        console.log(`🎨 Creating PERSISTENT highlights for ${sentences_ids.length} sentences on page ${currentPage}`);

        let highlightsCreated = 0;
        const newHighlights = new Map();

        sentences_ids.forEach((sentenceId, index) => {
            const sentenceData = enhancedSentences[sentenceId];

            if (!sentenceData) {
                console.warn(`⚠️ No data for sentence ${sentenceId}`);
                return;
            }

            // IMPROVED: Get bounding boxes for current page with better filtering
            const pageBoxes = sentenceData.bounding_boxes?.filter(bbox =>
                bbox.page === currentPage && bbox.confidence > 0.2 // Lower threshold
            ) || [];

            if (pageBoxes.length === 0) {
                console.log(`📄 Sentence ${sentenceId} not on page ${currentPage} (spans: ${sentenceData.page_spans})`);
                return;
            }

            console.log(`📍 Sentence ${sentenceId} has ${pageBoxes.length} boxes on page ${currentPage}:`);
            pageBoxes.forEach((bbox, i) => {
                console.log(`  Box ${i}: confidence=${bbox.confidence.toFixed(2)}, coords=(${bbox.x0.toFixed(1)}, ${bbox.y0.toFixed(1)})`);
            });

            if (highlightMode === 'precise') {
                // Use precise layout-based highlighting for ALL boxes above threshold
                pageBoxes.forEach((bbox, bboxIndex) => {
                    const highlightElement = createPreciseHighlight(bbox, sentenceId, index, bboxIndex, provenance_id, sentenceData.text);
                    if (highlightElement) {
                        newHighlights.set(`${sentenceId}_${bboxIndex}`, highlightElement);
                        highlightsCreated++;
                    }
                });
            } else {
                // Fallback highlighting
                const highlightElement = createFallbackHighlight(sentenceData.text, sentenceId, index, provenance_id);
                if (highlightElement) {
                    newHighlights.set(`${sentenceId}_fallback`, highlightElement);
                    highlightsCreated++;
                }
            }
        });

        setActiveHighlights(newHighlights);
        setHighlightsPersisted(true);

        console.log(`✅ Created ${highlightsCreated} PERSISTENT highlights on page ${currentPage}`);
    };

    const scrollToHighlight = (sentenceId, bbox = null) => {
        if (!containerRef.current || !currentViewport) return;

        const container = containerRef.current;
        const scrollContainer = container.querySelector('.pdf-content') || container;

        if (bbox && highlightMode === 'precise') {
            // IMPROVED: Handle multi-page bboxes better
            console.log(`📜 Scrolling to bbox for sentence ${sentenceId} on page ${bbox.page}`);

            if (bbox.page !== currentPage) {
                console.log(`⚠️ Bbox is on page ${bbox.page} but current page is ${currentPage}`);
                return; // Don't scroll if bbox is on different page
            }

            const pdfToViewport = (pdfX, pdfY) => {
                const viewportX = pdfX * currentViewport.scale;
                const viewportY = (currentViewport.height / currentViewport.scale - pdfY) * currentViewport.scale;
                return { x: viewportX, y: viewportY };
            };

            const topLeft = pdfToViewport(bbox.x0, bbox.y1);

            // Calculate scroll position with fixed offset
            const targetScrollTop = topLeft.y - 200 + scrollContainer.scrollTop; // Fixed offset from top
            const targetScrollLeft = Math.max(0, topLeft.x - 100 + scrollContainer.scrollLeft);

            console.log(`📜 Scrolling to precise location:`, { x: topLeft.x, y: topLeft.y, scrollTop: targetScrollTop });

            scrollContainer.scrollTo({
                top: Math.max(0, targetScrollTop),
                left: targetScrollLeft,
                behavior: 'smooth'
            });

        } else {
            // Fallback scrolling unchanged
            const highlightElement = highlightLayerRef.current?.querySelector(`[data-sentence-id="${sentenceId}"]`);

            if (highlightElement) {
                console.log(`📜 Scrolling to highlight element for sentence ${sentenceId}`);

                highlightElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center'
                });
            }
        }
    };

    const createPreciseHighlight = (bbox, sentenceId, index, bboxIndex, provenanceId, sentenceText) => {
        if (!currentViewport || !highlightLayerRef.current) return;

        // Convert PDF coordinates to viewport coordinates
        const pdfToViewport = (pdfX, pdfY) => {
            // PDF coordinates are from bottom-left, viewport from top-left
            const viewportX = pdfX * currentViewport.scale;
            const viewportY = (currentViewport.height / currentViewport.scale - pdfY) * currentViewport.scale;
            return { x: viewportX, y: viewportY };
        };

        const topLeft = pdfToViewport(bbox.x0, bbox.y1);
        const bottomRight = pdfToViewport(bbox.x1, bbox.y0);

        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        // Validate dimensions
        if (width < 5 || height < 5 || width > 800 || height > 200) {
            console.log(`⚠️ Invalid dimensions for bbox: ${width}x${height}`);
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'provenance-overlay precise-highlight';
        overlay.setAttribute('data-sentence-id', sentenceId);
        overlay.setAttribute('data-bbox-index', bboxIndex);
        overlay.setAttribute('data-provenance-id', provenanceId);
        overlay.setAttribute('data-confidence', bbox.confidence.toFixed(2));
        overlay.setAttribute('data-sentence-text', sentenceText || '')

        // Styling based on confidence
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
      z-index: 500;
      pointer-events: auto;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      opacity: 1;
    `;

        overlay.title = `Precise Evidence ${index + 1}.${bboxIndex + 1}\nSentence: ${sentenceId}\nConfidence: ${(bbox.confidence * 100).toFixed(0)}%\nLayout-based highlighting`;

        // ENHANCED: Add click handler for magnify mode
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked precise highlight: sentence ${sentenceId}, bbox ${bboxIndex}`);

            // Visual feedback
            overlay.style.transform = 'scale(1.05)';
            overlay.style.borderWidth = '3px';
            setTimeout(() => {
                overlay.style.transform = 'scale(1)';
                overlay.style.borderWidth = '2px';
            }, 200);

            console.log(`Selected provenance: ${selectedProvenance}`)

            // NEW: Trigger magnify mode
            showMagnifiedText({
                sentenceId,
                sentenceText: sentenceText || `Sentence ${sentenceId}`,
                bbox,
                overlayElement: overlay,
                confidence: bbox.confidence,
                inputTokens: selectedProvenance.input_token_size,
                outputTokens: selectedProvenance.output_token_size
            });
        });

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


        console.log(`✅ Created precise highlight for sentence ${sentenceId} at (${topLeft.x}, ${topLeft.y})`);
        return overlay;
    };

    const createFallbackHighlight = (sentenceText, sentenceId, index, provenanceId) => {
        console.log(`🆘 Creating fallback highlight for sentence ${sentenceId}`);

        // Simple positioned fallback
        const fallbackBox = {
            left: 20,
            top: 20 + (index * 40),
            width: Math.min(300, (sentenceText?.length || 100) * 8),
            height: 35
        };

        const overlay = document.createElement('div');
        overlay.className = 'provenance-overlay fallback-highlight';
        overlay.setAttribute('data-sentence-id', sentenceId);
        overlay.setAttribute('data-provenance-id', provenanceId);
        overlay.setAttribute('data-sentence-text', sentenceText || '');

        overlay.style.cssText = `
      position: absolute;
      left: ${fallbackBox.left}px;
      top: ${fallbackBox.top}px;
      width: ${fallbackBox.width}px;
      height: ${fallbackBox.height}px;
      background-color: rgba(255, 69, 0, 0.7);
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
      opacity: 1;
      pointer-events: auto;
    `;

        overlay.innerHTML = `📍 Evidence ${index + 1} (Fallback)`;
        overlay.title = `Fallback highlight for sentence ${sentenceId}\nText: ${sentenceText?.substring(0, 100)}...`;

        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked fallback highlight for sentence ${sentenceId}`);

            // NEW: Trigger magnify mode for fallback
            showMagnifiedText({
                sentenceId,
                sentenceText: sentenceText || `Sentence ${sentenceId}`,
                overlayElement: overlay,
                isFallback: true,
                inputTokens: selectedProvenance.input_token_size,
                outputTokens: selectedProvenance.output_token_size
            });
        });

        highlightLayerRef.current.appendChild(overlay);
        return overlay;
    };

    // NEW: Magnify functionality
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

        // Remove all highlights immediately (no fade for faster switching)
        highlightLayerRef.current.innerHTML = '';
        setActiveHighlights(new Map());
        setHighlightsPersisted(false);
    };

    // Navigation handlers
    const goToPage = (pageNum) => {
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage && !isRendering) {
            console.log(`📖 Navigating to page ${pageNum}`);
            setCurrentPage(pageNum);
            // Don't clear highlights here - let the effect handle it
        }
    };

    const handleZoomIn = () => {
        if (isRendering) return;
        const newZoom = Math.min(zoomLevel + 0.25, 3);
        setZoomLevel(newZoom);
        setLastRenderedPage(null); // Reset last rendered page to force re-render
    };

    const handleZoomOut = () => {
        if (isRendering) return;
        const newZoom = Math.max(zoomLevel - 0.25, 0.5);
        setZoomLevel(newZoom);
        setLastRenderedPage(null); // Reset last rendered page to force re-render
    };

    const toggleFullscreen = () => setIsFullscreen(!isFullscreen);



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
                    <button onClick={loadPDFWithLayoutData} className="retry-btn">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`hybrid-pdf-viewer layout-based ${isFullscreen ? 'fullscreen' : ''}`}>
            {/* Header */}
            <div className="pdf-header">
                <div className="pdf-title">
                    <FontAwesomeIcon icon={faFileAlt} />
                    <span>{pdfDocument.filename}</span>
                </div>
                {/* Layout info */}
                {layoutData && (
                    <div className="layout-info">
                        {selectedProvenance && selectedProvenance.input_token_size && selectedProvenance.output_token_size && (
                            <div className="provenance-meta">

                                                <span><strong>Time Elapsed:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s</span>
                                          
                            | <span className="cost-estimate">
                            
                                <>
                                     <strong>Cost Estimate:</strong> {calculateProvenanceCost(
                                        selectedProvenance.input_token_size,
                                        selectedProvenance.output_token_size
                                    ).formattedCost}
                                </>
                            

                        </span>
                        </div>
                    )}
                    </div>
                )}
                    {isRendering && (
                        <span className="rendering-indicator">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            Rendering...
                        </span>
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

                    <button onClick={toggleFullscreen} className="control-btn">
                        <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
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
            {/* NEW: Magnify Overlay */}
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

                                {/* NEW: Add detailed cost breakdown in magnify */}
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
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
};

export default LayoutBasedPDFViewer;