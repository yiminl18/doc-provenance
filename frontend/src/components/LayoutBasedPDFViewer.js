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
    const [lastRenderedZoom, setLastRenderedZoom] = useState(null);
    const [renderQueue, setRenderQueue] = useState(null);

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
    const zoomTimeoutRef = useRef(null);
    const renderTimeoutRef = useRef(null);
    const renderPromiseRef = useRef(null);

    const debugWithoutZoom = true;

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

    // Handle page changes
    useEffect(() => {
        if (pdfDoc && !loading && !isRendering && currentPage !== lastRenderedPage) {
            //console.log(`📄 Page changed from ${lastRenderedPage} to ${currentPage} - rendering`);
            renderPageSafely(currentPage);

        }
    }, [pdfDoc, loading, currentPage, zoomLevel, lastRenderedPage]);







    // Initialize fixed dimensions
    useEffect(() => {
        const dimensions = calculateFixedViewerDimensions();
        setFixedDimensions(dimensions);
    }, []);

    const calculateInitialZoomFixed = (viewport, fixedWidth) => {
        if (debugWithoutZoom) {
            console.log('🔒 DEBUG MODE: Zoom locked to 1.0');
            return 1.0; // Always return 1.0 for debugging
        }

        if (!viewport || !fixedWidth) return 1.0;
        const padding = 40;
        const availableWidth = fixedWidth - padding;
        const scale = availableWidth / viewport.width;
        return Math.max(0.4, Math.min(2.5, scale));
    };


    const requestRender = useCallback(async (pageNum, zoom, force = false) => {
        const renderKey = `${pageNum}_${zoom.toFixed(3)}`;

        // CRITICAL: Validate prerequisites before attempting render
        if (!pdfDoc) {
            console.warn(`🛑 Cannot render ${renderKey}: PDF document not loaded`);
            return;
        }

        if (!canvasRef?.current) {
            console.warn(`🛑 Cannot render ${renderKey}: Canvas ref not available`);
            return;
        }

        if (!containerRef?.current) {
            console.warn(`🛑 Cannot render ${renderKey}: Container ref not available`);
            return;
        }

        if (isRendering && !force) {
            console.log(`⏸️ Render blocked for ${renderKey}: already rendering`);
            return;
        }

        // Prevent duplicate renders
        if (!force && renderQueue === renderKey) {
            console.log(`🔄 Render already queued: ${renderKey}`);
            return;
        }

        // Cancel any pending renders
        if (renderTimeoutRef.current) {
            clearTimeout(renderTimeoutRef.current);
            renderTimeoutRef.current = null;
        }

        // Cancel active render if exists
        if (renderTaskRef.current) {
            console.log('🛑 Cancelling previous render task');
            try {
                await renderTaskRef.current.cancel();
            } catch (e) {
                // Cancellation errors are expected
            }
            renderTaskRef.current = null;
        }

        // Wait for any ongoing render promise to complete
        if (renderPromiseRef.current) {
            try {
                await renderPromiseRef.current;
            } catch (e) {
                // Ignore cancellation errors
            }
        }

        setRenderQueue(renderKey);

        // Small delay to ensure canvas is free
        renderTimeoutRef.current = setTimeout(async () => {
            try {
                // Double-check prerequisites before actual render
                if (!pdfDoc || !canvasRef?.current || !containerRef?.current) {
                    console.error(`❌ Render prerequisites missing at execution time for ${renderKey}`);
                    setRenderQueue(null);
                    return;
                }

                await performRender(pageNum, zoom);
                setLastRenderedPage(pageNum);
                setLastRenderedZoom(zoom);
            } catch (error) {
                if (error.name !== 'RenderingCancelledException') {
                    console.error(`❌ Render failed for ${renderKey}:`, error);
                    setRenderError(error.message);
                }
            } finally {
                setRenderQueue(null);
                renderTimeoutRef.current = null;
            }
        }, 100);
    }, [pdfDoc, canvasRef, containerRef, isRendering, renderQueue]);

    // Enhanced performRender with better error handling
    const performRender = async (pageNum, zoom) => {
        if (!pdfDoc) {
            throw new Error('PDF document is not loaded');
        }

        if (!canvasRef?.current) {
            throw new Error('Canvas ref is not available');
        }

        if (!containerRef?.current) {
            throw new Error('Container ref is not available');
        }

        console.log(`🎨 Starting render: page ${pageNum} at ${debugWithoutZoom ? '1.0 (LOCKED)' : (zoom * 100).toFixed(0) + '%'}`);

        setIsRendering(true);
        setRenderError(null);

        try {
            const page = await pdfDoc.getPage(pageNum);
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            // Validate canvas context
            if (!context) {
                throw new Error('Failed to get canvas 2D context');
            }

            const baseViewport = page.getViewport({ scale: 1.0 });

            // FORCE 1.0 scale for debugging
            let finalScale = debugWithoutZoom ? 1.0 : zoom;

            if (debugWithoutZoom) {
                console.log('🔒 DEBUG: Using scale 1.0 instead of', zoom);
                setZoomLevel(1.0); // Update UI to show correct zoom
            } else if (lastRenderedPage === null && zoom === 1.0 && fixedDimensions) {
                const initialZoom = calculateInitialZoomFixed(baseViewport, fixedDimensions.width);
                setZoomLevel(initialZoom);
                finalScale = initialZoom;
                console.log(`📏 Setting initial zoom: ${(initialZoom * 100).toFixed(0)}%`);
            }

            const viewport = page.getViewport({ scale: finalScale });
            setCurrentViewport(viewport);

            console.log('📐 Viewport details:', {
                scale: finalScale,
                width: viewport.width,
                height: viewport.height,
                debugMode: debugWithoutZoom
            });

            // Clear and setup canvas - CRITICAL: Clear before setup
            const devicePixelRatio = window.devicePixelRatio || 1;

            // Force canvas clear and reset
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.resetTransform(); // Reset any previous transforms

            canvas.width = viewport.width * devicePixelRatio;
            canvas.height = viewport.height * devicePixelRatio;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;

            // Clear again after resize
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.scale(devicePixelRatio, devicePixelRatio);

            // Create render promise and store it
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                enableWebGL: false // Disable WebGL to prevent conflicts
            };

            renderTaskRef.current = page.render(renderContext);
            renderPromiseRef.current = renderTaskRef.current.promise;

            await renderPromiseRef.current;

            console.log(`✅ PDF render completed for page ${pageNum} at ${(finalScale * 100).toFixed(0)}% zoom`);

            // Setup text and highlight layers
            await setupTextLayer(page, viewport);
            setupHighlightLayer();

            // Notify highlighter component
            notifyHighlighterOfViewportChange();

            console.log(`✅ Page ${pageNum} fully rendered and layers setup`);

        } catch (error) {
            if (error.name === 'RenderingCancelledException') {
                console.log(`🛑 Render cancelled for page ${pageNum} - this is normal`);
                throw error;
            } else {
                console.error(`❌ Render error for page ${pageNum}:`, error);
                throw error;
            }
        } finally {
            renderTaskRef.current = null;
            renderPromiseRef.current = null;
            setIsRendering(false);
        }
    };

    // Enhanced render effect with better validation
    useEffect(() => {
        // CRITICAL: Only proceed if we have all prerequisites
        if (!pdfDoc || loading || isRendering) {
            console.log(`⏸️ Render effect skipped: pdfDoc=${!!pdfDoc}, loading=${loading}, isRendering=${isRendering}`);
            return;
        }

        if (!canvasRef?.current || !containerRef?.current) {
            console.log(`⏸️ Render effect skipped: missing refs canvas=${!!canvasRef?.current}, container=${!!containerRef?.current}`);
            return;
        }

        const needsPageRender = currentPage !== lastRenderedPage;
        const needsZoomRender = Math.abs((zoomLevel || 1) - (lastRenderedZoom || 1)) > 0.01;

        if (needsPageRender || needsZoomRender) {
            const renderType = needsPageRender ? 'page change' : 'zoom change';
            console.log(`📄 Triggering render for ${renderType}: page ${currentPage}, zoom ${(zoomLevel * 100).toFixed(0)}%`);

            // Clear any existing zoom timeout
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
                zoomTimeoutRef.current = null;
            }

            // Immediate render for page changes, debounced for zoom
            if (needsPageRender) {
                requestRender(currentPage, zoomLevel);
            } else {
                // Debounce zoom changes
                zoomTimeoutRef.current = setTimeout(() => {
                    requestRender(currentPage, zoomLevel);
                }, 150);
            }
        }
    }, [pdfDoc, loading, currentPage, zoomLevel, lastRenderedPage, lastRenderedZoom, isRendering, requestRender, canvasRef, containerRef]);

    // Add validation useEffect to monitor ref availability
    useEffect(() => {
        const checkRefs = () => {
            const refs = {
                canvasRef: !!canvasRef?.current,
                containerRef: !!containerRef?.current,
                textLayerRef: !!textLayerRef?.current,
                highlightLayerRef: !!highlightLayerRef?.current
            };

            const missingRefs = Object.entries(refs).filter(([key, exists]) => !exists).map(([key]) => key);

            if (missingRefs.length > 0) {
                console.warn(`⚠️ Missing refs: ${missingRefs.join(', ')}`);
            } else {
                console.log(`✅ All refs available: ${Object.keys(refs).join(', ')}`);
            }
        };

        // Check refs when dependencies change
        if (pdfDoc && !loading) {
            setTimeout(checkRefs, 100);
        }
    }, [pdfDoc, loading, canvasRef, containerRef, textLayerRef, highlightLayerRef]);

    // Simplified navigation handlers with validation
    const goToPage = (pageNum) => {
        if (!pdfDoc) {
            console.warn('⚠️ Cannot navigate: PDF not loaded');
            return;
        }

        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage && !isRendering) {
            console.log(`📖 Navigating to page ${pageNum}`);
            setCurrentPage(pageNum);
        } else {
            console.warn(`⚠️ Cannot navigate to page ${pageNum}: invalid or busy`);
        }
    };

    // Enhanced zoom handlers with validation
    const handleZoomIn = () => {
        if (!pdfDoc) {
            console.warn('⚠️ Cannot zoom: PDF not loaded');
            return;
        }

        if (isRendering) {
            console.log('⏸️ Zoom in blocked - rendering in progress');
            return;
        }

        const newZoom = Math.min(zoomLevel + 0.25, 3);
        console.log(`🔍 Zoom IN: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
        setZoomLevel(newZoom);
    };

    const handleZoomOut = () => {
        if (!pdfDoc) {
            console.warn('⚠️ Cannot zoom: PDF not loaded');
            return;
        }

        if (isRendering) {
            console.log('⏸️ Zoom out blocked - rendering in progress');
            return;
        }

        const newZoom = Math.max(zoomLevel - 0.25, 0.5);
        console.log(`🔍 Zoom OUT: ${(zoomLevel * 100).toFixed(0)}% → ${(newZoom * 100).toFixed(0)}%`);
        setZoomLevel(newZoom);
    };

    const handleResetZoom = () => {
        if (!pdfDoc) {
            console.warn('⚠️ Cannot reset zoom: PDF not loaded');
            return;
        }

        if (isRendering) {
            console.log('⏸️ Zoom reset blocked - rendering in progress');
            return;
        }

        console.log(`🔍 RESET ZOOM: ${(zoomLevel * 100).toFixed(0)}% → fit-to-width`);
        setZoomLevel(1.0);
    };

    // Handle navigation triggers
    useEffect(() => {
        if (!navigationTrigger) return;

        console.log('🧭 Processing navigation trigger:', navigationTrigger);

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
            setLastRenderedZoom(null);
            setLoading(false);

        } catch (err) {
            console.error('❌ Error loading PDF:', err);
            setError(`Failed to load document: ${err.message}`);
            setLoading(false);
        }
    };




    // CORRECT APPROACH: Use PDF.js built-in text layer rendering
    const setupTextLayer = async (page, viewport) => {
        if (!textLayerRef.current) return;

        try {
            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;
            const canvas = canvasRef.current;
            const container = containerRef.current;

            // Clear previous content
            textLayer.innerHTML = '';

            if (!canvas || !container) return;

            // CRITICAL FIX: Position text layer to match canvas position exactly
            const canvasRect = canvas.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Calculate canvas position relative to its container
            const canvasLeft = canvasRect.left - containerRect.left;
            const canvasTop = canvasRect.top - containerRect.top;

            // CRITICAL: Let PDF.js handle all positioning and scaling
            textLayer.style.position = 'absolute';
            textLayer.style.left = `${canvasLeft}px`;
            textLayer.style.top = `${canvasTop}px`;
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            textLayer.style.overflow = 'hidden';
            textLayer.style.pointerEvents = 'none';
            textLayer.style.opacity = '0'; // Keep invisible
            textLayer.style.transformOrigin = '0% 0%';
            textLayer.style.margin = '0';
            textLayer.style.padding = '0';
            textLayer.style.border = 'none';

            console.log(`🎯 Text layer aligned to canvas:`, {
                canvasPosition: { left: canvasLeft, top: canvasTop },
                canvasRect: {
                    left: canvasRect.left,
                    top: canvasRect.top,
                    width: canvasRect.width,
                    height: canvasRect.height
                },
                containerRect: {
                    left: containerRect.left,
                    top: containerRect.top
                },
                textLayerStyle: {
                    left: textLayer.style.left,
                    top: textLayer.style.top,
                    width: textLayer.style.width,
                    height: textLayer.style.height
                }
            });

            // Use PDF.js TextLayerBuilder approach
            const textDivs = [];

            textContent.items.forEach((item, itemIndex) => {
                const textDiv = document.createElement('span');

                // Let PDF.js handle the positioning with its built-in logic
                const transform = item.transform;
                if (!transform) return;

                // PDF.js standard approach - minimal manual intervention
                textDiv.style.position = 'absolute';
                textDiv.style.whiteSpace = 'pre';
                textDiv.style.color = 'transparent';
                textDiv.style.transformOrigin = '0% 0%';
                textDiv.style.margin = '0';
                textDiv.style.padding = '0';
                textDiv.style.border = 'none';

                // CRITICAL: Use PDF.js coordinate system directly
                const fontHeight = item.height || 12;

                // Apply the transform matrix directly (this is what PDF.js does)
                const [scaleX, skewY, skewX, scaleY, translateX, translateY] = transform;



                // Position using bottom-left origin (PDF coordinate system)
                textDiv.style.left = `${translateX}px`;
                textDiv.style.bottom = `${translateY}px`; // Use bottom, not top!
                textDiv.style.fontSize = `${fontHeight}px`;
                textDiv.style.fontFamily = item.fontName || 'sans-serif';



                textDiv.textContent = item.str || '';

                // Add our stable identifiers for highlighting
                textDiv.setAttribute('data-stable-index', itemIndex);
                textDiv.setAttribute('data-page-number', currentPage);
                textDiv.setAttribute('data-pdf-x', translateX);
                textDiv.setAttribute('data-pdf-y', translateY);
                textDiv.setAttribute('data-font-size', fontHeight);

                // Simplified fingerprinting
                const normalizedText = (item.str || '').toLowerCase().replace(/\s+/g, ' ').trim();
                textDiv.setAttribute('data-normalized-text', normalizedText);
                textDiv.setAttribute('data-text-fingerprint', `${normalizedText}_${itemIndex}_${(item.str || '').length}`);

                textDiv.className = 'pdf-text-item';

                textLayer.appendChild(textDiv);
                textDivs.push(textDiv);

            });

            textLayerRef.current.textDivs = textDivs;
            textLayerRef.current.stableItemCount = textContent.items.length;

            console.log(`✅ PDF.js native text layer: ${textDivs.length} elements rendered`);
            // Temporary - make text layer visible
            textLayerRef.current.style.opacity = '0.3';
            textLayerRef.current.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';

            // Make individual text elements visible
            document.querySelectorAll('.pdf-text-item').forEach(el => {
                el.style.color = 'red';
                el.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            });

        } catch (err) {
            console.error('❌ Error setting up PDF.js native text layer:', err);
        }
    };

    // DEBUG TOOL: Add this to your LayoutBasedPDFViewer.js for debugging alignment

    const debugAlignment = () => {
        const canvas = canvasRef?.current;
        const textLayer = textLayerRef?.current;
        const highlightLayer = highlightLayerRef?.current;
        const container = containerRef?.current;

        if (!canvas || !textLayer || !highlightLayer || !container) {
            console.log('❌ Missing refs for alignment debug');
            return;
        }

        console.log('🔍 ALIGNMENT DEBUG REPORT');
        console.log('========================');

        // Get all bounding rects
        const containerRect = container.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const textLayerRect = textLayer.getBoundingClientRect();
        const highlightLayerRect = highlightLayer.getBoundingClientRect();

        console.log('📐 Element Positions:');
        console.log('Container:', {
            left: containerRect.left,
            top: containerRect.top,
            width: containerRect.width,
            height: containerRect.height
        });

        console.log('Canvas:', {
            left: canvasRect.left,
            top: canvasRect.top,
            width: canvasRect.width,
            height: canvasRect.height,
            relativeToContainer: {
                left: canvasRect.left - containerRect.left,
                top: canvasRect.top - containerRect.top
            }
        });

        console.log('Text Layer:', {
            left: textLayerRect.left,
            top: textLayerRect.top,
            width: textLayerRect.width,
            height: textLayerRect.height,
            relativeToContainer: {
                left: textLayerRect.left - containerRect.left,
                top: textLayerRect.top - containerRect.top
            },
            offsetFromCanvas: {
                left: textLayerRect.left - canvasRect.left,
                top: textLayerRect.top - canvasRect.top
            }
        });

        console.log('Highlight Layer:', {
            left: highlightLayerRect.left,
            top: highlightLayerRect.top,
            width: highlightLayerRect.width,
            height: highlightLayerRect.height,
            offsetFromTextLayer: {
                left: highlightLayerRect.left - textLayerRect.left,
                top: highlightLayerRect.top - textLayerRect.top
            }
        });

        // Check alignment issues
        const canvasTextOffset = {
            left: textLayerRect.left - canvasRect.left,
            top: textLayerRect.top - canvasRect.top
        };

        const textHighlightOffset = {
            left: highlightLayerRect.left - textLayerRect.left,
            top: highlightLayerRect.top - textLayerRect.top
        };

        console.log('🎯 Alignment Analysis:');

        if (Math.abs(canvasTextOffset.left) > 2 || Math.abs(canvasTextOffset.top) > 2) {
            console.error('❌ ISSUE: Text layer not aligned with canvas!', canvasTextOffset);
            console.log('🔧 FIX: Adjust text layer positioning in setupTextLayer()');
        } else {
            console.log('✅ Canvas and text layer are aligned');
        }

        if (Math.abs(textHighlightOffset.left) > 2 || Math.abs(textHighlightOffset.top) > 2) {
            console.error('❌ ISSUE: Highlight layer not aligned with text layer!', textHighlightOffset);
            console.log('🔧 FIX: Adjust highlight layer positioning in setupHighlightLayer()');
        } else {
            console.log('✅ Text layer and highlight layer are aligned');
        }

        // Check for problematic CSS
        const textLayerStyle = window.getComputedStyle(textLayer);
        const highlightLayerStyle = window.getComputedStyle(highlightLayer);

        console.log('🔍 CSS Analysis:');

        const problematicProps = {
            textLayer: {},
            highlightLayer: {}
        };

        // Check text layer CSS
        if (textLayerStyle.transform !== 'none') {
            problematicProps.textLayer.transform = textLayerStyle.transform;
        }
        if (textLayerStyle.margin !== '0px') {
            problematicProps.textLayer.margin = textLayerStyle.margin;
        }
        if (textLayerStyle.padding !== '0px') {
            problematicProps.textLayer.padding = textLayerStyle.padding;
        }

        // Check highlight layer CSS
        if (highlightLayerStyle.transform !== 'none') {
            problematicProps.highlightLayer.transform = highlightLayerStyle.transform;
        }
        if (highlightLayerStyle.margin !== '0px') {
            problematicProps.highlightLayer.margin = highlightLayerStyle.margin;
        }
        if (highlightLayerStyle.padding !== '0px') {
            problematicProps.highlightLayer.padding = highlightLayerStyle.padding;
        }

        if (Object.keys(problematicProps.textLayer).length > 0) {
            console.warn('⚠️ Text layer problematic CSS:', problematicProps.textLayer);
        }
        if (Object.keys(problematicProps.highlightLayer).length > 0) {
            console.warn('⚠️ Highlight layer problematic CSS:', problematicProps.highlightLayer);
        }



        // Sample element check
        const firstTextElement = textLayer.querySelector('.pdf-text-item[data-stable-index="256"]');
        const firstHighlight = highlightLayer.querySelector('.pdf-stable-highlight');

        if (firstTextElement && firstHighlight) {
            const textElementRect = firstTextElement.getBoundingClientRect();
            const highlightRect = firstHighlight.getBoundingClientRect();

            const elementOffset = {
                left: highlightRect.left - textElementRect.left,
                top: highlightRect.top - textElementRect.top
            };

            console.log('📝 Sample Element Check:');
            console.log('Text element:', {
                text: firstTextElement.textContent.substring(0, 30),
                position: { left: textElementRect.left, top: textElementRect.top }
            });
            console.log('Highlight:', {
                position: { left: highlightRect.left, top: highlightRect.top }
            });
            console.log('Element offset (highlight vs text):', elementOffset);

            if (Math.abs(elementOffset.left) > 5 || Math.abs(elementOffset.top) > 5) {
                console.error('❌ ISSUE: Significant element misalignment detected!', elementOffset);
            } else {
                console.log('✅ Elements are reasonably aligned');
            }
        }

        console.log('========================');
        return {
            canvasTextOffset,
            textHighlightOffset,
            problematicProps,
            rects: { containerRect, canvasRect, textLayerRect, highlightLayerRect }
        };
    };

    // Add this to window for debugging in browser console
    window.debugPDFAlignment = debugAlignment;




    const setupHighlightLayer = () => {
        if (!highlightLayerRef.current || !textLayerRef.current) return;

        const highlightLayer = highlightLayerRef.current;
        const textLayer = textLayerRef.current;

        // Clear highlights
        highlightLayer.innerHTML = '';

        const textLayerStyle = window.getComputedStyle(textLayer);

        // CRITICAL: Position highlight layer exactly on top of text layer
        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = textLayerStyle.left;      // Match text layer position
        highlightLayer.style.top = textLayerStyle.top;        // Match text layer position
        highlightLayer.style.width = textLayerStyle.width;    // Match text layer size
        highlightLayer.style.height = textLayerStyle.height;  // Match text layer size
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';
        highlightLayer.style.transform = 'none';
        highlightLayer.style.transformOrigin = '0% 0%';
        highlightLayer.style.overflow = 'visible';
        highlightLayer.style.margin = '0';
        highlightLayer.style.padding = '0';
        highlightLayer.style.border = 'none';

        console.log(`✅ Highlight layer synced with text layer:`, {
            position: {
                left: highlightLayer.style.left,
                top: highlightLayer.style.top,
                width: highlightLayer.style.width,
                height: highlightLayer.style.height
            },
            textLayerComputedPosition: {
                left: textLayerStyle.left,
                top: textLayerStyle.top,
                transform: textLayerStyle.transform
            }
        });
    };

    // Helper functions for creating stable identifiers
    const createTextFingerprint = (text, index) => {
        const cleanText = text.replace(/[^\w]/g, '');
        return `${cleanText}_${index}_${text.length}`;
    };

    const createPositionHash = (x, y, width, height) => {
        return `${Math.round(x)}_${Math.round(y)}_${Math.round(width)}_${Math.round(height)}`;
    };

    const createContextFingerprint = (before, current, after) => {
        const cleanBefore = (before || '').replace(/[^\w]/g, '').slice(-10);
        const cleanCurrent = (current || '').replace(/[^\w]/g, '');
        const cleanAfter = (after || '').replace(/[^\w]/g, '').slice(0, 10);
        return `${cleanBefore}|${cleanCurrent}|${cleanAfter}`;
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
                await renderTaskRef.current.cancel();
            } catch (e) {
            }
            renderTaskRef.current = null;
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure cancellation
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

    // Add this after rendering completes to notify the highlighter:
    const notifyHighlighterOfViewportChange = () => {
        // Delay notification to ensure DOM is fully updated
        setTimeout(() => {
            const event = new CustomEvent('pdfViewportChanged', {
                detail: {
                    scale: zoomLevel,
                    page: currentPage,
                    viewport: currentViewport,
                    timestamp: Date.now()
                }
            });
            document.dispatchEvent(event);
            console.log('📡 Notified highlighter of viewport change');
        }, 100);
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


    // Update the renderPage function to handle zoom vs page changes differently
    const renderPage = async (pageNum) => {
        if (!pdfDoc || !canvasRef.current || !containerRef.current) {
            throw new Error('Missing PDF document or canvas refs');
        }

        console.log(`🎨 Rendering page ${pageNum}...`);

        const page = await pdfDoc.getPage(pageNum);
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        const baseViewport = page.getViewport({ scale: 1.0 });

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
            console.log(`✅ PDF render completed for page ${pageNum} at ${(finalScale * 100).toFixed(0)}% zoom`);
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

        // Setup text and highlight layers
        await setupTextLayer(page, viewport);
        setupHighlightLayer();

        // Notify highlighter component that viewport has changed
        notifyHighlighterOfViewportChange();

        console.log(`✅ Page ${pageNum} fully rendered and layers setup at ${(finalScale * 100).toFixed(0)}% zoom`);
    };






    // Cleanup
    useEffect(() => {
        return () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
            if (renderTimeoutRef.current) {
                clearTimeout(renderTimeoutRef.current);
            }
            if (zoomTimeoutRef.current) {
                clearTimeout(zoomTimeoutRef.current);
            }
        };
    }, []);

    // Extract document ID for highlighter
    const documentId = pdfDocument?.filename || '';

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

                {renderQueue && (
                    <span className="render-queue-indicator">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        Queued: {renderQueue}
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
                    <button onClick={() => requestRender(currentPage, zoomLevel, true)} className="win95-btn retry">
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
                                    canvasRef={canvasRef}
                                    containerRef={containerRef}
                                    highlightLayerRef={highlightLayerRef}
                                    currentViewport={currentViewport}
                                    onHighlightClick={handleHighlightClick}
                                    isRendering={isRendering}
                                    questionId={activeQuestionId}
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