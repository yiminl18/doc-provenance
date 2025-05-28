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
  faSpinner
} from '@fortawesome/free-solid-svg-icons';

const PDFJSViewer = ({ document: pdfDocument, selectedProvenance, onClose, isGridMode = false }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [sentences, setSentences] = useState([]);
  const [textContent, setTextContent] = useState('');

  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const highlightLayerRef = useRef(null);

  // Check PDF.js availability
  useEffect(() => {
    const checkPDFJS = () => {
      if (window.pdfjsLib) {
        console.log('✅ PDF.js already available');
        
        // Ensure worker is set (in case it wasn't set in index.html)
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          console.log('✅ PDF.js worker source set');
        }
        
        return;
      } else {
        console.warn('⚠️ PDF.js not found - make sure it\'s loaded in index.html');
        setError('PDF.js library not available. Please ensure it\'s loaded in your HTML.');
      }
    };

    // Check immediately
    checkPDFJS();
    
    // If not available, wait a bit and check again (in case it's still loading)
    if (!window.pdfjsLib) {
      const timeout = setTimeout(checkPDFJS, 1000);
      return () => clearTimeout(timeout);
    }
  }, []);

  // Load PDF document
  useEffect(() => {
    if (!pdfDocument || !window.pdfjsLib) return;

    loadPDFDocument();
  }, [pdfDocument]);

  // Load sentences from backend
  useEffect(() => {
    if (!pdfDocument) return;

    loadSentences();
  }, [pdfDocument]);

  // Handle provenance highlighting
  useEffect(() => {
    if (selectedProvenance && sentences.length > 0 && showHighlights) {
      console.log('🎯 PDFJSViewer highlighting provenance:', {
        provenanceId: selectedProvenance.provenance_id,
        sentenceIds: selectedProvenance.sentences_ids
      });

      highlightProvenance();
    } else if (!showHighlights) {
      clearHighlights();
    }
  }, [selectedProvenance, sentences, showHighlights, currentPage]);

  const loadPDFDocument = async () => {
    setLoading(true);
    setError(null);

    let pdfUrl = '';

    try {


      console.log('🔍 PDF Document Debug:', {
        hasFile: !!pdfDocument.file,
        backendDocumentId: pdfDocument.backendDocumentId,
        isPreloaded: pdfDocument.isPreloaded,
        filename: pdfDocument.filename,
        id: pdfDocument.id
      });

      // Determine how to load the PDF
      if (pdfDocument.file) {
        // File upload case - direct file object
        pdfUrl = URL.createObjectURL(pdfDocument.file);
        console.log('📁 Using file object URL');
      } else if (pdfDocument.backendDocumentId) {
        // Backend document case - use the PDF endpoint
        pdfUrl = `/api/documents/${pdfDocument.backendDocumentId}/pdf`;
        console.log('🔗 Using backend PDF URL:', pdfUrl);
      } else if (pdfDocument.id) {
        // Use the document ID if available
        pdfUrl = `/api/documents/${pdfDocument.id}/pdf`;
        console.log('🆔 Using document ID PDF URL:', pdfUrl);
      } else if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
        // Preloaded document case - try uploads directory
        pdfUrl = `/uploads/${pdfDocument.filename}`;
        console.log('📚 Using preloaded PDF URL:', pdfUrl);
      } else {
        throw new Error('No valid PDF source found - missing document ID or file');
      }

      console.log('🎯 Final PDF URL:', pdfUrl);

      // Test if the URL is accessible before loading with PDF.js
      try {
        const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
        if (!testResponse.ok) {
          throw new Error(`PDF not accessible: ${testResponse.status} ${testResponse.statusText}`);
        }
        console.log('✅ PDF URL is accessible');
      } catch (fetchError) {
        console.error('❌ PDF URL test failed:', fetchError);
        throw new Error(`Cannot access PDF: ${fetchError.message}`);
      }

      const loadingTask = window.pdfjsLib.getDocument({
        url: pdfUrl,
        // Add some options for better compatibility
        verbosity: 0, // Reduce console spam
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true
      });

      const pdf = await loadingTask.promise;

      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);

      console.log('✅ PDF loaded successfully:', pdf.numPages, 'pages');
      console.log('📄 PDF loaded from URL:', pdfUrl);

    } catch (err) {
      console.error('❌ Error loading PDF:', err);
      setError(`Failed to load PDF: ${err.message}`);

      // Try fallback approaches
      if (pdfDocument.filename && !pdfUrl?.includes('/uploads/')) {
        console.log('🔄 Trying fallback URL...');
        try {
          const fallbackUrl = `/uploads/${pdfDocument.filename}`;
          const fallbackTask = window.pdfjsLib.getDocument(fallbackUrl);
          const fallbackPdf = await fallbackTask.promise;

          setPdfDoc(fallbackPdf);
          setTotalPages(fallbackPdf.numPages);
          setCurrentPage(1);

          console.log('✅ PDF loaded with fallback URL:', fallbackUrl);
          setError(null); // Clear error since fallback worked

        } catch (fallbackError) {
          console.error('❌ Fallback also failed:', fallbackError);
          setError(`Failed to load PDF: ${err.message}. Fallback also failed: ${fallbackError.message}`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSentences = async () => {
    if (!pdfDocument) return;

    try {
      // Try multiple approaches to get the document ID
      const backendDocumentId = pdfDocument.backendDocumentId || pdfDocument.id;

      console.log('🔍 Loading sentences for document:', {
        backendDocumentId,
        filename: pdfDocument.filename,
        isPreloaded: pdfDocument.isPreloaded
      });

      if (backendDocumentId) {
        try {
          const response = await fetch(`/api/documents/${backendDocumentId}/text`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.text) {
              setTextContent(data.text);
              // Split into sentences (you might want to use your exact sentence splitting logic)
              const sentenceList = data.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
              setSentences(sentenceList);
              console.log('✅ Loaded sentences from text endpoint:', sentenceList.length);
              return;
            }
          }
          console.log('⚠️ Text endpoint failed, trying fallback approaches');
        } catch (error) {
          console.log('⚠️ Text endpoint error:', error);
        }
      }

      // Fallback - use existing text if available  
      if (pdfDocument.fullText) {
        setTextContent(pdfDocument.fullText);
        const sentenceList = pdfDocument.fullText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        setSentences(sentenceList);
        console.log('✅ Used fallback text from document object');
      } else {
        console.log('⚠️ No text content available for sentence extraction');
      }

    } catch (err) {
      console.error('❌ Error loading sentences:', err);
    }
  };

  const renderPage = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({
        scale: zoomLevel,
        rotation: 0 
      });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // Render text layer for searching
      await renderTextLayer(page, viewport);

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

      // Create text layer
      const textLayer = new window.pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerRef.current,
        viewport: viewport,
        textDivs: []
      });

      await textLayer.render();

      console.log('✅ Text layer rendered');

    } catch (err) {
      console.error('❌ Error rendering text layer:', err);
    }
  };

  const highlightProvenance = () => {
    if (!selectedProvenance?.sentences_ids || !sentences.length) return;

    clearHighlights();

    try {
      // Get sentences to highlight
      const sentencesToHighlight = selectedProvenance.sentences_ids
        .filter(id => id >= 0 && id < sentences.length)
        .map(id => sentences[id]);

      console.log('🔍 Highlighting sentences:', sentencesToHighlight.length);

      // Search for each sentence in the text layer and highlight
      sentencesToHighlight.forEach((sentence, index) => {
        highlightTextInLayer(sentence, index);
      });

      // Scroll to first highlight
      setTimeout(() => scrollToFirstHighlight(), 500);

    } catch (err) {
      console.error('❌ Error highlighting provenance:', err);
    }
  };

  const highlightTextInLayer = (searchText, highlightIndex) => {
    if (!textLayerRef.current || !searchText || searchText.length < 10) return;

    const textLayer = textLayerRef.current;
    const textDivs = textLayer.querySelectorAll('.textLayer > span, .textLayer > div');

    // Clean search text
    const cleanSearchText = searchText.trim().replace(/\s+/g, ' ');
    const searchWords = cleanSearchText.split(/\s+/).filter(word => word.length > 3);

    if (searchWords.length === 0) return;

    // Try to find text spans that contain our search words
    const matchingSpans = [];

    textDivs.forEach((span, spanIndex) => {
      const spanText = span.textContent.trim();
      if (!spanText) return;

      // Check if this span contains significant words from our search
      const spanWords = spanText.toLowerCase().split(/\s+/);
      const matchCount = searchWords.filter(word =>
        spanWords.some(spanWord => spanWord.includes(word.toLowerCase()))
      ).length;

      if (matchCount >= Math.min(2, searchWords.length * 0.5)) {
        matchingSpans.push({ span, spanIndex, matchCount });
      }
    });

    // Sort by match quality and highlight the best matches
    matchingSpans
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, Math.min(5, matchingSpans.length)) // Limit highlights per sentence
      .forEach(({ span }) => {
        highlightSpan(span, highlightIndex);
      });
  };

  const highlightSpan = (span, highlightIndex) => {
    // Create highlight overlay
    const highlight = document.createElement('div');
    highlight.className = `pdf-highlight provenance-${highlightIndex % 5}`;
    highlight.style.position = 'absolute';
    highlight.style.left = span.style.left;
    highlight.style.top = span.style.top;
    highlight.style.width = span.style.width || 'auto';
    highlight.style.height = span.style.height || 'auto';
    highlight.style.fontSize = span.style.fontSize;
    highlight.style.fontFamily = span.style.fontFamily;
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '10';

    // Add to highlight layer
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
      const containerRect = containerRef.current.getBoundingClientRect();
      const highlightRect = firstHighlight.getBoundingClientRect();

      const scrollTop = highlightRect.top - containerRect.top + containerRef.current.scrollTop - 100;

      containerRef.current.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      });

      // Add pulse animation
      firstHighlight.style.animation = 'highlightPulse 2s ease-in-out';
      setTimeout(() => {
        if (firstHighlight.style) {
          firstHighlight.style.animation = '';
        }
      }, 2000);
    }
  };

  // Re-render page when zoom changes
  useEffect(() => {
    if (pdfDoc && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, zoomLevel]);

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const toggleHighlights = () => {
    setShowHighlights(!showHighlights);
  };

  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  if (!pdfDocument) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-empty">
          <div className="empty-icon">
            <FontAwesomeIcon icon={faFileAlt} />
          </div>
          <div className="empty-message">
            NO_DOCUMENT_SELECTED
            <br />
            <span style={{ fontSize: '11px', color: 'var(--win95-text-muted)' }}>
              Upload PDF to view content
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* PDF Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <FontAwesomeIcon icon={faFileAlt} />
          <span className="doc-name">{pdfDocument.filename}</span>
          {selectedProvenance && (
            <span className="provenance-indicator">
              PROV_{String(selectedProvenance.provenance_id || 0).padStart(3, '0')}_HIGHLIGHTED
            </span>
          )}
          {pdfDocument.isPreloaded && (
            <span className="preloaded-indicator">📚 PRELOADED</span>
          )}
        </div>

        <div className="pdf-controls">
          <button
            className="control-btn"
            onClick={toggleHighlights}
            title={showHighlights ? "Hide Highlights" : "Show Highlights"}
          >
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
          </button>

          <button className="control-btn" onClick={handleZoomOut} title="Zoom Out">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>

          <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>

          <button className="control-btn" onClick={handleZoomIn} title="Zoom In">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>

          {!isGridMode && (
            <>
              <button className="control-btn" onClick={toggleFullscreen} title="Toggle Fullscreen">
                <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
              </button>

              <button className="control-btn close-btn" onClick={onClose} title="Close">
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* PDF Content */}
      <div className="pdf-content" ref={containerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {loading && (
          <div className="pdf-loading">
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>Loading PDF...</span>
          </div>
        )}

        {error && (
          <div className="pdf-error">
            <div style={{ color: 'red', marginBottom: '10px' }}>❌ {error}</div>
            <button onClick={() => loadPDFDocument()} className="retry-btn">
              Retry Loading
            </button>
          </div>
        )}

        {pdfDoc && !loading && !error && (
          <>
            {/* Page Navigation */}
            <div className="page-navigation">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="nav-btn"
              >
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
              </button>
            </div>

            {/* PDF Rendering Container */}
            <div className="pdf-page-container" style={{ position: 'relative', display: 'inline-block' }}>
              {/* PDF Canvas */}
              <canvas
                ref={canvasRef}
                style={{ display: 'block', border: '1px solid #ccc' }}
              />

              {/* Text Layer for Selection/Search */}
              <div
                ref={textLayerRef}
                className="textLayer"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  overflow: 'hidden',
                  opacity: 0.2,
                  lineHeight: 1.0,
                  pointerEvents: 'none'
                }}
              />

              {/* Highlight Layer */}
              <div
                ref={highlightLayerRef}
                className="highlightLayer"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  zIndex: 10
                }}
              />
            </div>

            {/* Provenance Info */}
            {/*selectedProvenance && showHighlights && (
              <div className="provenance-info" style={{
                margin: '20px',
                padding: '15px',
                backgroundColor: '#f5f5f5',
                border: '1px solid #ddd',
                borderRadius: '5px'
              }}>
                <h4>
                  <FontAwesomeIcon icon={faHighlighter} />
                  Highlighted Provenance Evidence
                </h4>
                <div><strong>Provenance ID:</strong> {selectedProvenance.provenance_id}</div>
                <div><strong>Sentences:</strong> {selectedProvenance.sentences_ids?.length || 0}</div>
                <div><strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s</div>
              </div>
            )*/}
          </>
        )}
      </div>

      {/* Add CSS styles to head */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .pdf-highlight {
            background-color: rgba(255, 235, 59, 0.4);
            border: 2px solid #ffeb3b;
            border-radius: 3px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          
          .pdf-highlight.provenance-0 {
            background-color: rgba(255, 235, 59, 0.4);
            border-color: #ffeb3b;
          }
          
          .pdf-highlight.provenance-1 {
            background-color: rgba(76, 175, 80, 0.4);
            border-color: #4caf50;
          }
          
          .pdf-highlight.provenance-2 {
            background-color: rgba(33, 150, 243, 0.4);
            border-color: #2196f3;
          }
          
          .pdf-highlight.provenance-3 {
            background-color: rgba(255, 152, 0, 0.4);
            border-color: #ff9800;
          }
          
          .pdf-highlight.provenance-4 {
            background-color: rgba(156, 39, 176, 0.4);
            border-color: #9c27b0;
          }

          @keyframes highlightPulse {
            0% { 
              box-shadow: 0 0 0 0 rgba(255, 235, 59, 0.7);
            }
            70% {
              box-shadow: 0 0 0 10px rgba(255, 235, 59, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(255, 235, 59, 0);
            }
          }

          .pdf-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 200px;
            gap: 10px;
          }

          .pdf-error {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 200px;
            gap: 10px;
          }

          .page-navigation {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
          }

          .nav-btn {
            padding: 5px 10px;
            border: 1px solid #ccc;
            background: white;
            cursor: pointer;
          }

          .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .page-info {
            font-weight: bold;
            min-width: 100px;
            text-align: center;
          }

          .retry-btn {
            padding: 8px 16px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }

          .textLayer > span,
          .textLayer > div {
            color: transparent;
            position: absolute;
            white-space: pre;
            cursor: text;
            transform-origin: 0% 0%;
          }
        `
      }} />
    </div>
  );
};

export default PDFJSViewer;