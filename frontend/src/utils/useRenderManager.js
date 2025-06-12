// useRenderManager.js - Clean render management hook
import { useRef, useCallback, useState, useEffect } from 'react';

export function useRenderManager({ pdfDoc, canvasRef, containerRef, onViewportChange }) {
    // Simple state machine
    const [state, setState] = useState('idle'); // idle | queued | rendering | error
    const [currentPage, setCurrentPage] = useState(1);
    const [currentZoom, setCurrentZoom] = useState(1);
    const [viewport, setViewport] = useState(null);
    const [error, setError] = useState(null);
    const [hasSetInitialZoom, setHasSetInitialZoom] = useState(false);

    // Single render operation tracking
    const renderOperation = useRef(null);
    const renderQueue = useRef(null);

    // Calculate fit-to-width zoom
    const calculateFitToWidthZoom = useCallback((pageViewport, containerWidth) => {
        if (!pageViewport || !containerWidth) return 1;

        const padding = 40; // 20px on each side
        const availableWidth = containerWidth - padding;
        const scale = availableWidth / pageViewport.width;

        // Reasonable zoom bounds
        return Math.max(0.5, Math.min(3.0, scale));
    }, []);

    // Main render function - single entry point
    const render = useCallback(async (pageNum, zoomLevel = null) => {
        if (!pdfDoc || !canvasRef?.current || !containerRef?.current) {
            console.warn('📋 Render skipped: missing prerequisites');
            return false;
        }

        const renderKey = `page-${pageNum}`;

        if (state === 'rendering' && renderQueue.current === renderKey) {
            console.log('📋 Render skipped: already rendering this page');
            return false;
        }

        await cancelCurrentRender();
        renderQueue.current = renderKey;
        setState('queued');
        setError(null);

        try {
            setState('rendering');

            const page = await pdfDoc.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1.0 });

            // SMART ZOOM LOGIC: Always create text layer at 1.0, but display at desired zoom
            let displayZoom = zoomLevel;
            let textLayerZoom = 1.0; // Always 1.0 for stable mappings

            if (displayZoom === null) {
                const containerWidth = containerRef.current.offsetWidth;
                displayZoom = calculateFitToWidthZoom(baseViewport, containerWidth);

                // Only set as initial zoom once
                if (!hasSetInitialZoom) {
                    console.log(`📏 Calculated initial fit-to-width: ${(displayZoom * 100).toFixed(0)}%`);
                    setHasSetInitialZoom(true);
                }
            }

            // Create TWO viewports:
            // 1. Display viewport for canvas rendering (can be any zoom)
            const displayViewport = page.getViewport({ scale: displayZoom });
            // 2. Text layer viewport at 1.0 for stable mapping consistency
            const textLayerViewport = page.getViewport({ scale: textLayerZoom });

            // Setup canvas with display zoom
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');

            if (!context) {
                throw new Error('Failed to get canvas context');
            }

            const devicePixelRatio = window.devicePixelRatio || 1;
            canvas.width = displayViewport.width * devicePixelRatio;
            canvas.height = displayViewport.height * devicePixelRatio;
            canvas.style.width = `${displayViewport.width}px`;
            canvas.style.height = `${displayViewport.height}px`;

            context.scale(devicePixelRatio, devicePixelRatio);
            context.clearRect(0, 0, displayViewport.width, displayViewport.height);

            // Render PDF at display zoom
            const renderContext = {
                canvasContext: context,
                viewport: displayViewport,
                enableWebGL: false
            };

            renderOperation.current = page.render(renderContext);
            await renderOperation.current.promise;

            // Success - update state
            setCurrentPage(pageNum);
            setCurrentZoom(displayZoom);
            setViewport(displayViewport);
            setState('idle');

            // Notify parent with BOTH viewports
        if (onViewportChange) {
            setTimeout(() => {
                onViewportChange({
                    page: pageNum,
                    zoom: displayZoom,
                    displayViewport: displayViewport,
                    textLayerViewport: textLayerViewport, // Pass both viewports
                    zoomRatio: displayZoom / textLayerZoom
                });
            }, 0);
        }

        console.log(`✅ Rendered page ${pageNum} at display: ${(displayZoom * 100).toFixed(0)}%, text layer: ${(textLayerZoom * 100).toFixed(0)}%`);
        return true;

        } catch (err) {
            if (err.name === 'RenderingCancelledException') {
                console.log('📋 Render cancelled (normal)');
                setState('idle');
                return false;
            } else {
                console.error('❌ Render error:', err);
                setError(err.message);
                setState('error');
                return false;
            }
        } finally {
            renderOperation.current = null;
            renderQueue.current = null;
        }
    }, [pdfDoc, canvasRef, containerRef, onViewportChange, calculateFitToWidthZoom, state, currentPage, currentZoom, hasSetInitialZoom]);

    // Cancel current render operation
    const cancelCurrentRender = useCallback(async () => {
        if (renderOperation.current) {
            console.log('🛑 Cancelling current render');
            try {
                await renderOperation.current.cancel();
            } catch (e) {
                // Cancellation errors are expected
            }
            renderOperation.current = null;
        }
        renderQueue.current = null;
    }, []);

    // Auto-render when PDF loads
    useEffect(() => {
        if (pdfDoc && state === 'idle' && currentPage === 1) {
            console.log('📋 Auto-rendering first page');
            render(1);
        }
    }, [pdfDoc]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelCurrentRender();
        };
    }, [cancelCurrentRender]);

    return {
        // State
        state,
        currentPage,
        currentZoom,
        viewport,
        error,

        // Actions
        render,
        cancelCurrentRender,

        // Computed
        isRendering: state === 'rendering' || state === 'queued',
        isReady: state === 'idle' && viewport !== null,
        hasSetInitialZoom,
        calculateFitToWidthZoom
    };
}
