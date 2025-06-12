// useRenderManager.js - Clean render management hook
import { useRef, useCallback, useState, useEffect } from 'react';

export function useRenderManager({ pdfDoc, canvasRef, containerRef, onViewportChange }) {
    // Simple state machine
    const [state, setState] = useState('idle'); // idle | queued | rendering | error
    const [currentPage, setCurrentPage] = useState(1);
    const [currentZoom, setCurrentZoom] = useState(1);
    const [viewport, setViewport] = useState(null);
    const [error, setError] = useState(null);

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
        
        // Skip if already rendering this exact page
        if (state === 'rendering' && renderQueue.current === renderKey) {
            console.log('📋 Render skipped: already rendering this page');
            return false;
        }

        // Cancel any existing render
        await cancelCurrentRender();

        // Queue this render
        renderQueue.current = renderKey;
        setState('queued');
        setError(null);

        try {
            setState('rendering');
            
            const page = await pdfDoc.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1.0 });
            
            // Auto-calculate fit-to-width if no zoom specified
            let finalZoom = zoomLevel;
            if (finalZoom === null) {
                const containerWidth = containerRef.current.offsetWidth;
                finalZoom = calculateFitToWidthZoom(baseViewport, containerWidth);
                console.log(`📏 Auto-calculated fit-to-width: ${(finalZoom * 100).toFixed(0)}%`);
            }

            const scaledViewport = page.getViewport({ scale: finalZoom });
            
            // Setup canvas
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            
            if (!context) {
                throw new Error('Failed to get canvas context');
            }

            // Clear and resize canvas
            const devicePixelRatio = window.devicePixelRatio || 1;
            canvas.width = scaledViewport.width * devicePixelRatio;
            canvas.height = scaledViewport.height * devicePixelRatio;
            canvas.style.width = `${scaledViewport.width}px`;
            canvas.style.height = `${scaledViewport.height}px`;
            
            context.scale(devicePixelRatio, devicePixelRatio);
            context.clearRect(0, 0, scaledViewport.width, scaledViewport.height);

            // Render PDF
            const renderContext = {
                canvasContext: context,
                viewport: scaledViewport,
                enableWebGL: false
            };

            renderOperation.current = page.render(renderContext);
            await renderOperation.current.promise;

            // Success - update state
            setCurrentPage(pageNum);
            setCurrentZoom(finalZoom);
            setViewport(scaledViewport);
            setState('idle');
            
            // Notify parent component
            if (onViewportChange) {
                onViewportChange({
                    page: pageNum,
                    zoom: finalZoom,
                    viewport: scaledViewport
                });
            }

            console.log(`✅ Rendered page ${pageNum} at ${(finalZoom * 100).toFixed(0)}%`);
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
    }, [pdfDoc, canvasRef, containerRef, onViewportChange, calculateFitToWidthZoom]);

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
        isReady: state === 'idle' && viewport !== null
    };
}
