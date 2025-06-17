// PDFViewer.js - Refactored to use react-pdf
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
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
import { getSentenceItemMappings } from '../services/api';
import HybridCoordinateHighlighter from './HybridCoordinateHighlighter';
import ReactHighlighter from './ReactHighlighter';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import '../styles/pdf-viewer-react.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const ReactPDFViewer = ({
    pdfDocument,
    selectedProvenance,
    activeQuestionId,
    onClose,
    onFeedbackRequest
}) => {
    // Core state
    const [numPages, setNumPages] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1.0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [provenancePageCache, setProvenancePageCache] = useState(new Map());
    const [debugMode, setDebugMode] = useState(true);
    
    // UI state
    const [provenanceTargetPage, setProvenanceTargetPage] = useState(null);
    const [pageInputValue, setPageInputValue] = useState('');
    const [showPageInput, setShowPageInput] = useState(false);
    const [isProvenanceProcessing, setIsProvenanceProcessing] = useState(false);
    const [provenanceProcessingMessage, setProvenanceProcessingMessage] = useState('');
    
    // Refs
    const containerRef = useRef(null);
    const pageRef = useRef(null);
    const highlightLayerRef = useRef(null);
    
    // Track user navigation vs auto-navigation
    const lastUserNavigationRef = useRef(Date.now());
    const lastAutoNavigationRef = useRef(0);

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

    // Reset to page 1 when document changes
    useEffect(() => {
        if (pdfDocument) {
            console.log('📄 New document loaded, resetting to page 1');
            setCurrentPage(1);
        }
    }, [pdfDocument?.filename]);

    // Track provenance processing state
    useEffect(() => {
        if (!activeQuestionId) {
            setIsProvenanceProcessing(false);
            setProvenanceProcessingMessage('');
            return;
        }

        if (!selectedProvenance) {
            setIsProvenanceProcessing(true);
            setProvenanceProcessingMessage('Finding relevant text passages...');
        } else {
            setIsProvenanceProcessing(false);
            setProvenanceProcessingMessage('');
        }
    }, [activeQuestionId, selectedProvenance]);

    // Auto-navigate to provenance when it becomes available
    useEffect(() => {
        if (!selectedProvenance || !numPages) return;

        const handleAutoNavigation = async () => {
            try {
                const provenancePage = await getProvenancePage(selectedProvenance);

                if (provenancePage && provenancePage !== currentPage) {
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
    }, [selectedProvenance?.provenance_id, numPages]);

    // Update provenance target page
    useEffect(() => {
        if (!selectedProvenance) return;

        const updateProvenanceTarget = async () => {
            const targetPage = await getProvenancePage(selectedProvenance);
            setProvenanceTargetPage(targetPage);
        };

        updateProvenanceTarget();
    }, [selectedProvenance?.provenance_id]);

    // PDF document load handlers
    const onDocumentLoadSuccess = ({ numPages }) => {
        console.log(`✅ PDF loaded: ${numPages} pages`);
        setNumPages(numPages);
        setLoading(false);
        setLoadError(null);
    };

    const onDocumentLoadError = (error) => {
        console.error('❌ Error loading PDF:', error);
        setLoadError(`Failed to load document: ${error.message}`);
        setLoading(false);
    };

    const onPageLoadSuccess = (page) => {
        console.log(`✅ Page ${page.pageNumber} loaded`);
        
        // Set up highlight layer positioning after page loads
        setTimeout(() => {
            setupHighlightLayer();
        }, 100);
    };

    const onPageLoadError = (error) => {
        console.error('❌ Error loading page:', error);
    };

    // Navigation functions
    const goToPage = (pageNum, source = 'user') => {
        console.log(`🎯 goToPage called: ${pageNum} (source: ${source})`, {
            currentPage,
            numPages,
        });

        if (pageNum >= 1 && pageNum <= numPages && pageNum !== currentPage) {
            console.log(`📖 Navigating to page ${pageNum} (${source})`);

            // Track navigation source and timing
            if (source === 'user') {
                lastUserNavigationRef.current = Date.now();
            } else if (source === 'auto') {
                lastAutoNavigationRef.current = Date.now();
            }

            setCurrentPage(pageNum);
        } else {
            console.warn(`⚠️ Cannot navigate to page ${pageNum}:`, {
                valid: pageNum >= 1 && pageNum <= numPages,
                different: pageNum !== currentPage,
            });
        }
    };

    const handlePreviousPage = () => {
        goToPage(currentPage - 1, 'user');
    };

    const handleNextPage = () => {
        goToPage(currentPage + 1, 'user');
    };

    // Zoom functions
    const zoomIn = () => {
        lastUserNavigationRef.current = Date.now();
        setZoom(prevZoom => Math.min(prevZoom * 1.2, 3));
    };

    const zoomOut = () => {
        lastUserNavigationRef.current = Date.now();
        setZoom(prevZoom => Math.max(prevZoom * 0.8, 0.5));
    };

    const resetZoom = () => {
        lastUserNavigationRef.current = Date.now();
        setZoom(1.0);
    };

    // Page input handlers
    const handlePageInputSubmit = (e) => {
        e.preventDefault();
        const pageNum = parseInt(pageInputValue, 10);

        if (isNaN(pageNum)) {
            console.warn('Invalid page number entered');
            setPageInputValue('');
            return;
        }

        if (pageNum >= 1 && pageNum <= numPages) {
            console.log(`🎯 Direct navigation to page ${pageNum}`);
            goToPage(pageNum, 'user');
            setShowPageInput(false);
            setPageInputValue('');
        } else {
            console.warn(`Page ${pageNum} out of range (1-${numPages})`);
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
        setPageInputValue(currentPage.toString());
        setTimeout(() => {
            const input = document.querySelector('.page-input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 0);
    };

    // Setup highlight layer
    const setupHighlightLayer = () => {
        if (!highlightLayerRef.current || !pageRef.current) return;

        const highlightLayer = highlightLayerRef.current;
        const pageElement = pageRef.current;

        // Find the actual page canvas/svg element
        const pageCanvas = pageElement.querySelector('canvas') || pageElement.querySelector('svg');
        if (!pageCanvas) {
            console.warn('Page canvas/svg not found for highlight layer setup');
            return;
        }

        const pageRect = pageCanvas.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        highlightLayer.style.position = 'absolute';
        highlightLayer.style.left = `${pageRect.left - containerRect.left}px`;
        highlightLayer.style.top = `${pageRect.top - containerRect.top}px`;
        highlightLayer.style.width = `${pageCanvas.offsetWidth}px`;
        highlightLayer.style.height = `${pageCanvas.offsetHeight}px`;
        highlightLayer.style.pointerEvents = 'none';
        highlightLayer.style.zIndex = '10';

        console.log('✅ Highlight layer positioned to match page');
    };

    // Get provenance page
    const getProvenancePage = useCallback(async (provenance) => {
        if (!provenance || !pdfDocument?.filename) return null;

        const sentenceIds = provenance?.provenance_ids;

        if (!sentenceIds || sentenceIds.length === 0) {
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
                if (mapping && mapping.stable_elements && mapping.stable_elements.length > 0) {
                    mapping.stable_elements.forEach((element) => {
                        if (element.page && element.page > 0) {
                            pages.add(element.page);
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
    }, [provenancePageCache, pdfDocument]);

    const goBackToProvenance = async () => {
        if (!selectedProvenance) {
            console.log('⚠️ No provenance to navigate back to');
            return;
        }

        try {
            const provenancePage = await getProvenancePage(selectedProvenance);

            if (provenancePage && provenancePage !== currentPage) {
                console.log(`🔙 Going back to provenance page ${provenancePage}`);
                goToPage(provenancePage, 'user');
            } else if (provenancePage === currentPage) {
                console.log('✅ Already on provenance page');
            } else {
                console.log('⚠️ Could not find provenance page');
            }
        } catch (error) {
            console.error('❌ Error going back to provenance:', error);
        }
    };

    const isAwayFromProvenance = selectedProvenance && provenanceTargetPage &&
        currentPage !== provenanceTargetPage;

    // Render states
    if (!pdfDocument) {
        return (
            <div className="pdf-viewer-empty">
                <FontAwesomeIcon icon={faFileAlt} size="3x" />
                <h3>No Document Selected</h3>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="pdf-viewer-error">
                <h3>PDF Loading Error</h3>
                <p>{loadError}</p>
                <button onClick={() => window.location.reload()} className="win95-btn retry">
                    Retry
                </button>
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

                    {/* Status indicator */}
                    {isProvenanceProcessing ? (
                        <div className="status-indicator provenance">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Finding Evidence...</span>
                        </div>
                    ) : loading ? (
                        <div className="status-indicator rendering">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Loading PDF...</span>
                        </div>
                    ) : null}
                </div>

                {/* Navigation */}
                <div className="page-navigation">
                    <button
                        onClick={handlePreviousPage}
                        disabled={currentPage <= 1}
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
                                    max={numPages}
                                    value={pageInputValue}
                                    onChange={(e) => setPageInputValue(e.target.value)}
                                    onKeyDown={handlePageInputKeyDown}
                                    onBlur={() => {
                                        setTimeout(() => setShowPageInput(false), 150);
                                    }}
                                    className="page-input"
                                    placeholder="Page #"
                                />
                                <span className="page-total">of {numPages}</span>
                            </form>
                        ) : (
                            <span
                                className="page-info clickable"
                                onClick={handlePageInfoClick}
                                title="Click to jump to page"
                            >
                                Page {currentPage} of {numPages || '?'}
                            </span>
                        )}
                    </div>

                    <button
                        onClick={handleNextPage}
                        disabled={currentPage >= numPages}
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
                    <button onClick={zoomOut} className="win95-btn control">
                        <FontAwesomeIcon icon={faSearchMinus} />
                    </button>

                    <span className="zoom-display">
                        {Math.round(zoom * 100)}%
                    </span>

                    <button onClick={zoomIn} className="win95-btn control">
                        <FontAwesomeIcon icon={faSearchPlus} />
                    </button>

                    <button
                        onClick={resetZoom}
                        className="win95-btn control reset-zoom-btn"
                        title="Reset zoom"
                    >
                        Reset
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="pdf-content" ref={containerRef}>
                <div className="pdf-page-container">
                    {pdfUrl && (
                        <Document
                            file={pdfUrl}
                            onLoadSuccess={onDocumentLoadSuccess}
                            onLoadError={onDocumentLoadError}
                            loading={
                                <div className="pdf-viewer-loading">
                                    <FontAwesomeIcon icon={faSpinner} spin size="2x" />
                                    <h3>Loading PDF...</h3>
                                </div>
                            }
                        >
                            <div ref={pageRef} className="react-pdf-page-wrapper">
                                <Page
                                    pageNumber={currentPage}
                                    scale={zoom}
                                    onLoadSuccess={onPageLoadSuccess}
                                    onLoadError={onPageLoadError}
                                    loading={
                                        <div className="page-loading">
                                            <FontAwesomeIcon icon={faSpinner} spin />
                                            <span>Loading page...</span>
                                        </div>
                                    }
                                />
                            </div>
                        </Document>
                    )}

                    <div ref={highlightLayerRef} className="pdf-highlight-layer" />

                    {/* Highlighter Component */}
                    {numPages && selectedProvenance && (
                        <ReactHighlighter
                            provenanceData={selectedProvenance}
                            activeQuestionId={activeQuestionId}
                            pdfDocument={null} // react-pdf handles the PDF document internally
                            textLayerRef={pageRef} // Use pageRef instead of textLayerRef
                            highlightLayerRef={highlightLayerRef}
                            containerRef={containerRef}
                            currentPage={currentPage}
                            currentZoom={zoom}
                            documentFilename={pdfDocument?.filename || ''}
                            highlightStyle={{
                                backgroundColor: 'rgba(76, 175, 80, 0.4)',
                                border: '1px solid rgba(76, 175, 80, 0.8)',
                                borderRadius: '2px'
                            }}
                            searchOptions={{
                                caseSensitive: false,
                                matchThreshold: 0.75,
                                maxGapBetweenWords: 30,
                                contextWindow: 3
                            }}
                            className="direct-provenance-highlight"
                            verbose={true}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReactPDFViewer;