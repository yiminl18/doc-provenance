import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faSearchPlus,
  faSearchMinus,
  faExpand,
  faCompress,
  faHighlighter,
  faFileAlt,
  faEye,
  faEyeSlash,
  faSpinner,
  faChevronLeft,
  faChevronRight
} from '@fortawesome/free-solid-svg-icons';

const CleanPDFViewer = ({ pdfDocument, selectedProvenance, onClose, isGridMode = false }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState(null);

  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const highlightLayerRef = useRef(null);

  // Initialize PDF.js worker once
  useEffect(() => {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      console.log('✅ PDF.js worker initialized');
    }
  }, []);

  // Generate PDF URL when document changes
  useEffect(() => {
    if (!pdfDocument) {
      setPdfUrl(null);
      return;
    }

    let url = '';
    
    if (pdfDocument.file) {
      // Direct file upload case
      url = URL.createObjectURL(pdfDocument.file);
      console.log('📁 Using file blob URL');
    } else {
      // Backend document case - use the backend document ID
      const docId = pdfDocument.backendDocumentId || pdfDocument.id;
      url = `/api/documents/${docId}/pdf`;
      console.log('🔗 Using backend PDF URL:', url);
    }

    setPdfUrl(url);
    
    // Cleanup blob URL when component unmounts or document changes
    return () => {
      if (pdfDocument.file && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pdfDocument]);

  // Load PDF document when URL is ready
  useEffect(() => {
    if (!pdfUrl || !window.pdfjsLib) return;

    loadPDFDocument();
  }, [pdfUrl]);

  const loadPDFDocument = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔄 Loading PDF from:', pdfUrl);

      // Test URL accessibility first
      const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
      if (!testResponse.ok) {
        throw new Error(`PDF not accessible: ${testResponse.status} ${testResponse.statusText}`);
      }

      const loadingTask = window.pdfjsLib.getDocument({
        url: pdfUrl,
        verbosity: 0
      });

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setLoading(false);

      console.log('✅ PDF loaded successfully:', pdf.numPages, 'pages');

    } catch (err) {
      console.error('❌ Error loading PDF:', err);
      setError(`Failed to load PDF: ${err.message}`);
      setLoading(false);
    }
  };

  // Render current page
  useEffect(() => {
    if (pdfDoc && canvasRef.current) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, zoomLevel]);

  const renderPage = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoomLevel });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // Render text layer
      await renderTextLayer(page, viewport);

      // Highlight provenance if selected
      if (selectedProvenance && showHighlights) {
        setTimeout(() => highlightProvenance(), 100);
      }

      console.log(`✅ Rendered page ${pageNum}`);

    } catch (err) {
      console.error(`❌ Error rendering page ${pageNum}:`, err);
    }
  };

  const renderTextLayer = async (page, viewport) => {
    if (!textLayerRef.current) return;

    try {
      const textContent = await page.getTextContent();

      // Clear previous text layer
      textLayerRef.current.innerHTML = '';
      textLayerRef.current.style.left = '0px';
      textLayerRef.current.style.top = '0px';
      textLayerRef.current.style.width = viewport.width + 'px';
      textLayerRef.current.style.height = viewport.height + 'px';

      textLayerRef.current.style.setProperty('--scale-factor', viewport.scale);

      // Create text layer - updated for PDF.js 3.x
      if (window.pdfjsLib.renderTextLayer) {
        // PDF.js 3.x method
        await window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: viewport,
          textDivs: []
        });
      } else if (window.pdfjsLib.TextLayer) {
        // Fallback for older versions
        const textLayer = new window.pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: viewport,
          textDivs: []
        });
        await textLayer.render();
      } else {
        console.warn('TextLayer rendering not available in this PDF.js version');
      }

      console.log('✅ Text layer rendered');

    } catch (err) {
      console.error('❌ Error rendering text layer:', err);
      // Don't fail the whole rendering if text layer fails
    }
  };

  const highlightProvenance = () => {
    if (!selectedProvenance?.content || !textLayerRef.current) return;

    clearHighlights();

    try {
      const searchTexts = Array.isArray(selectedProvenance.content) 
        ? selectedProvenance.content 
        : [selectedProvenance.content];

      searchTexts.forEach((text, index) => {
        if (typeof text === 'string' && text.length > 10) {
          highlightTextInPage(text, index);
        }
      });

      // Scroll to first highlight
      setTimeout(() => scrollToFirstHighlight(), 300);

    } catch (err) {
      console.error('❌ Error highlighting provenance:', err);
    }
  };

  const highlightTextInPage = (searchText, highlightIndex) => {
    const textLayer = textLayerRef.current;
    const textSpans = textLayer.querySelectorAll('span, div');
    
    const cleanText = searchText.trim().toLowerCase();
    const searchWords = cleanText.split(/\s+/).filter(word => word.length > 3);

    textSpans.forEach(span => {
      const spanText = span.textContent.toLowerCase();
      
      // Check if span contains significant words from search text
      const matchCount = searchWords.filter(word => 
        spanText.includes(word)
      ).length;

      if (matchCount >= Math.min(2, searchWords.length * 0.4)) {
        createHighlight(span, highlightIndex);
      }
    });
  };

  const createHighlight = (span, highlightIndex) => {
    const highlight = document.createElement('div');
    highlight.className = `pdf-highlight highlight-${highlightIndex % 3}`;
    
    // Copy positioning from text span
    const computedStyle = window.getComputedStyle(span);
    highlight.style.position = 'absolute';
    highlight.style.left = span.style.left || computedStyle.left;
    highlight.style.top = span.style.top || computedStyle.top;
    highlight.style.width = span.style.width || computedStyle.width;
    highlight.style.height = span.style.height || computedStyle.height;
    highlight.style.fontSize = span.style.fontSize || computedStyle.fontSize;
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10';

    if (highlightLayerRef.current) {
      highlightLayerRef.current.appendChild(highlight);
    }
  };

  const clearHighlights = () => {
    if (highlightLayerRef.current) {
      highlightLayerRef.current.innerHTML = '';
    }
  };

  const scrollToFirstHighlight = () => {
    const firstHighlight = highlightLayerRef.current?.querySelector('.pdf-highlight');
    if (firstHighlight && containerRef.current) {
      firstHighlight.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // Add pulse animation
      firstHighlight.style.animation = 'pulse 2s ease-in-out';
    }
  };

  // Control handlers
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);
  const toggleHighlights = () => setShowHighlights(!showHighlights);
  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  // Render states
  if (!pdfDocument) {
    return (
      <div className="pdf-viewer-empty">
        <div className="empty-content">
          <FontAwesomeIcon icon={faFileAlt} size="3x" />
          <h3>No Document Selected</h3>
          <p>Upload a PDF to view content</p>
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
          <p>{pdfDocument.filename}</p>
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
          <button onClick={loadPDFDocument} className="retry-btn">
            Retry
          </button>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="direct-link">
            Open PDF Directly
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`pdf-viewer ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>{pdfDocument.filename}</span>
          {selectedProvenance && (
            <span className="provenance-badge">
              Evidence {selectedProvenance.provenance_id || 1} Highlighted
            </span>
          )}
        </div>

        <div className="pdf-controls">
          <button onClick={toggleHighlights} className="control-btn">
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
          </button>
          
          <button onClick={handleZoomOut} className="control-btn">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>
          
          <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>
          
          <button onClick={handleZoomIn} className="control-btn">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>
          
          <button onClick={toggleFullscreen} className="control-btn">
            <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
          </button>
          
          {onClose && (
            <button onClick={onClose} className="control-btn close-btn">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          )}
        </div>
      </div>

      {/* Page Navigation */}
      <div className="page-navigation">
        <button 
          onClick={() => goToPage(currentPage - 1)} 
          disabled={currentPage <= 1}
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
          disabled={currentPage >= totalPages}
          className="nav-btn"
        >
          Next
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>

      {/* PDF Content */}
      <div className="pdf-content" ref={containerRef}>
        <div className="pdf-page-container">
          {/* Canvas for PDF rendering */}
          <canvas ref={canvasRef} className="pdf-canvas" />
          
          {/* Text layer for selection */}
          <div ref={textLayerRef} className="pdf-text-layer" />
          
          {/* Highlight layer */}
          <div ref={highlightLayerRef} className="pdf-highlight-layer" />
        </div>
      </div>

      {/* Provenance Info */}
      {selectedProvenance && showHighlights && (
        <div className="provenance-info">
          <h4>
            <FontAwesomeIcon icon={faHighlighter} />
            Highlighted Evidence
          </h4>
          <p><strong>Provenance ID:</strong> {selectedProvenance.provenance_id}</p>
          <p><strong>Sentences:</strong> {selectedProvenance.sentences_ids?.length || 0}</p>
          <p><strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s</p>
        </div>
      )}

      {/* Add CSS styles to head dynamically */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .pdf-viewer {
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #f5f5f5;
          }
          
          .pdf-viewer.fullscreen {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1000;
            background: white;
          }
          
          .pdf-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background: white;
            border-bottom: 1px solid #ddd;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .pdf-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: bold;
          }
          
          .provenance-badge {
            background: #4CAF50;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
          }
          
          .pdf-controls {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .control-btn {
            padding: 8px 12px;
            border: 1px solid #ddd;
            background: white;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.2s;
          }
          
          .control-btn:hover {
            background: #f0f0f0;
          }
          
          .control-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .zoom-display {
            padding: 0 10px;
            font-weight: bold;
          }
          
          .page-navigation {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            padding: 10px;
            background: #f8f9fa;
          }
          
          .nav-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 8px 16px;
            border: 1px solid #ddd;
            background: white;
            cursor: pointer;
            border-radius: 4px;
          }
          
          .page-info {
            font-weight: bold;
            min-width: 120px;
            text-align: center;
          }
          
          .pdf-content {
            flex: 1;
            overflow: auto;
            padding: 20px;
            display: flex;
            justify-content: center;
          }
          
          .pdf-page-container {
            position: relative;
            display: inline-block;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          }
          
          .pdf-canvas {
            display: block;
            border: 1px solid #ccc;
          }
          
          .pdf-text-layer {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            overflow: hidden;
            opacity: 0.2;
            line-height: 1.0;
          }
          
          .pdf-text-layer span,
          .pdf-text-layer div {
            color: transparent;
            position: absolute;
            white-space: pre;
            cursor: text;
            transform-origin: 0% 0%;
          }
          
          .pdf-highlight-layer {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 10;
          }
          
          .pdf-highlight {
            background-color: rgba(255, 235, 59, 0.6);
            border: 2px solid #ffeb3b;
            border-radius: 3px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .pdf-highlight.highlight-0 {
            background-color: rgba(255, 235, 59, 0.6);
            border-color: #ffeb3b;
          }
          
          .pdf-highlight.highlight-1 {
            background-color: rgba(76, 175, 80, 0.6);
            border-color: #4caf50;
          }
          
          .pdf-highlight.highlight-2 {
            background-color: rgba(33, 150, 243, 0.6);
            border-color: #2196f3;
          }
          
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(255, 235, 59, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(255, 235, 59, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 235, 59, 0); }
          }
          
          .provenance-info {
            margin: 15px;
            padding: 15px;
            background: #e3f2fd;
            border: 1px solid #2196f3;
            border-radius: 6px;
          }
          
          .provenance-info h4 {
            margin: 0 0 10px 0;
            color: #1976d2;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .pdf-viewer-empty,
          .pdf-viewer-loading,
          .pdf-viewer-error {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .empty-content,
          .loading-content,
          .error-content {
            text-align: center;
            color: #666;
          }
          
          .retry-btn,
          .direct-link {
            margin: 10px;
            padding: 8px 16px;
            background: #2196f3;
            color: white;
            text-decoration: none;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: inline-block;
          }
          
          .retry-btn:hover,
          .direct-link:hover {
            background: #1976d2;
          }
        `
      }} />
    </div>
  );
};

export default CleanPDFViewer;