import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

const PDFViewer = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [urlReady, setUrlReady] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [textItems, setTextItems] = useState(new Map());
  const containerRef = useRef(null);

  // Check and setup worker - similar to your working PDF.js version
  useEffect(() => {
    const setupWorker = () => {
      // First check if PDF.js is available globally (from index.html)
      if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        console.log('✅ Global PDF.js found with worker:', window.pdfjsLib.GlobalWorkerOptions.workerSrc);
        // Use the global PDF.js worker for react-pdf
        pdfjs.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc;
        setWorkerReady(true);
        return;
      }

      // Fallback: Set worker directly
      const workerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      console.log('✅ PDF.js worker set directly:', workerUrl);
      
      // Test worker accessibility
      fetch(workerUrl, { method: 'HEAD' })
        .then(response => {
          if (response.ok) {
            console.log('✅ Worker URL is accessible');
            setWorkerReady(true);
          } else {
            throw new Error(`Worker URL returned ${response.status}`);
          }
        })
        .catch(error => {
          console.error('❌ Worker URL test failed:', error);
          setError(`PDF.js worker not accessible: ${error.message}`);
          setLoading(false);
        });
    };

    setupWorker();
  }, []);

  // Memoize document options
  const documentOptions = useMemo(() => ({
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
    cMapPacked: true,
  }), []);

  // Generate PDF URL (only when worker is ready)
  useEffect(() => {
    if (!pdfDocument || !workerReady) {
      setPdfUrl(null);
      return;
    }

    const ensureDocumentAndGetPdfUrl = async () => {
      try {
        const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
        const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
        
        console.log('📄 Setting up PDF for document:', {
          filename: pdfDocument.filename,
          docId,
          isPreloaded: pdfDocument.isPreloaded,
          workerReady
        });

        // For preloaded documents, ensure they're loaded first
        if (pdfDocument.isPreloaded) {
          try {
            console.log('🔄 Ensuring preloaded document is activated...');
            const response = await fetch(`${baseUrl}/api/documents/preloaded/${docId}`, {
              method: 'POST'
            });
            
            if (response.ok) {
              console.log('✅ Preloaded document activated');
            } else {
              console.warn('⚠️ Preloaded document activation returned:', response.status);
            }
          } catch (error) {
            console.warn('⚠️ Preloaded document activation error:', error.message);
          }
        }

        const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
        console.log('📄 Final PDF URL:', pdfUrl);
        
        // Test PDF URL accessibility
        const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
        if (!testResponse.ok) {
          throw new Error(`PDF endpoint returned ${testResponse.status}: ${testResponse.statusText}`);
        }

        console.log('✅ PDF URL is accessible');
        setPdfUrl(pdfUrl);
        setUrlReady(true);
        
      } catch (urlError) {
        console.error('❌ PDF URL setup failed:', urlError);
        setError(`Failed to setup PDF URL: ${urlError.message}`);
        setLoading(false);
      }
    };

    ensureDocumentAndGetPdfUrl();
  }, [pdfDocument, workerReady]);

  // React-PDF event handlers
  const onDocumentLoadSuccess = ({ numPages }) => {
    console.log('✅ Document loaded successfully:', numPages, 'pages');
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  };

  const onDocumentLoadError = (error) => {
    console.error('❌ Document load error:', error);
    setError(`PDF load failed: ${error.message}`);
    setLoading(false);
  };

  const onDocumentLoadStart = () => {
    console.log('🔄 Document load started');
    setLoading(true);
  };

  const onSourceSuccess = () => {
    console.log('✅ PDF source loaded successfully');
  };

  const onSourceError = (error) => {
    console.error('❌ PDF source error:', error);
    setError(`PDF source error: ${error.message}`);
    setLoading(false);
  };

  // Page render success handler
  const onPageRenderSuccess = (page) => {
    const pageNum = page.pageNumber;
    
    page.getTextContent().then((textContent) => {
      const items = textContent.items.map((item, index) => ({
        id: index,
        text: item.str,
        transform: item.transform,
        width: item.width,
        height: item.height,
        x: item.transform[4],
        y: item.transform[5],
        fontSize: item.transform[0]
      }));
      
      setTextItems(prev => new Map(prev).set(pageNum, items));
    }).catch(console.error);
  };

  // Navigation functions
  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  const zoomIn = () => setScale(prev => Math.min(3.0, prev + 0.2));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.2));

  // Create highlight overlays for provenance
  const createHighlightOverlays = (pageNum) => {
    if (!selectedProvenance || !selectedProvenance.content) return null;
    
    const pageItems = textItems.get(pageNum);
    if (!pageItems) return null;
    
    const provenanceTexts = Array.isArray(selectedProvenance.content) 
      ? selectedProvenance.content 
      : [selectedProvenance.content];
    
    const allMatches = [];
    provenanceTexts.forEach((text, textIndex) => {
      if (typeof text === 'string') {
        const searchText = text.toLowerCase().trim();
        const words = searchText.split(/\s+/).filter(word => word.length > 2);
        
        for (let i = 0; i < pageItems.length; i++) {
          const item = pageItems[i];
          const itemText = item.text.toLowerCase();
          
          if (words.some(word => itemText.includes(word) && word.length > 3)) {
            allMatches.push({ ...item, provenanceIndex: textIndex });
          }
          
          if (itemText.length > 3 && searchText.includes(itemText.trim())) {
            allMatches.push({ ...item, provenanceIndex: textIndex });
          }
        }
      }
    });
    
    return allMatches.map((match, index) => (
      <div
        key={`highlight-${pageNum}-${index}`}
        className={`pdf-highlight highlight-${match.provenanceIndex % 3}`}
        style={{
          position: 'absolute',
          left: `${(match.x / 612) * 100}%`,
          top: `${100 - ((match.y + match.height) / 792) * 100}%`,
          width: `${Math.max((match.width / 612) * 100, 0.5)}%`,
          height: `${Math.max((match.height / 792) * 100, 0.5)}%`,
          pointerEvents: 'none',
          zIndex: 10,
          minWidth: '4px',
          minHeight: '12px'
        }}
        title={`Provenance ${match.provenanceIndex + 1}: ${match.text}`}
      />
    ));
  };

  // Render conditions
  if (!pdfDocument) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">📄</div>
        <div className="empty-message">No document selected</div>
      </div>
    );
  }

  if (!workerReady) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⚙️</div>
        <div className="empty-message">Initializing PDF.js worker...</div>
      </div>
    );
  }

  if (loading && !error) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⏳</div>
        <div className="empty-message">
          Loading PDF: {pdfDocument.filename}
          <br />
          <small style={{ color: '#666', marginTop: '0.5rem', display: 'block' }}>
            Worker ready • URL {urlReady ? 'ready' : 'preparing'}
          </small>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⚠️</div>
        <div className="empty-message">PDF Error</div>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          {error}
        </p>
        <div style={{ marginTop: '1rem' }}>
          <a 
            href={pdfUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ 
              padding: '0.5rem 1rem', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              textDecoration: 'none',
              borderRadius: '4px'
            }}
          >
            Open PDF Directly
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {/* Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <span className="doc-name">{pdfDocument.filename}</span>
          {pdfDocument.isPreloaded && (
            <span className="preloaded-indicator">PRELOADED</span>
          )}
          {selectedProvenance && (
            <span className="provenance-indicator">
              📍 PROV {selectedProvenance.provenance_id || '#'}
            </span>
          )}
        </div>
        
        <div className="pdf-controls">
          <button className="control-btn" onClick={goToPrevPage} disabled={pageNumber <= 1}>
            ←
          </button>
          <span className="zoom-level">
            {pageNumber} / {numPages}
          </span>
          <button className="control-btn" onClick={goToNextPage} disabled={pageNumber >= numPages}>
            →
          </button>
          
          <button className="control-btn" onClick={zoomOut} disabled={scale <= 0.5}>
            -
          </button>
          <span className="zoom-level">
            {Math.round(scale * 100)}%
          </span>
          <button className="control-btn" onClick={zoomIn} disabled={scale >= 3.0}>
            +
          </button>
          
          {onClose && (
            <button className="control-btn close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Document Info */}
      <div className="document-info">
        <div className="info-item">
          <strong>Document:</strong> {pdfDocument.filename}
        </div>
        <div className="info-item">
          <strong>Pages:</strong> {numPages}
        </div>
        <div className="info-item">
          <strong>Scale:</strong> {Math.round(scale * 100)}%
        </div>
        <div className="info-item">
          <strong>Worker:</strong> {window.pdfjsLib ? 'Global' : 'Direct'} PDF.js
        </div>
      </div>

      {/* Highlight Legend */}
      {selectedProvenance && selectedProvenance.content && (
        <div className="highlight-legend">
          <h4>📍 Provenance Highlighting</h4>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-color highlight-0"></div>
              <span>Primary Evidence</span>
            </div>
            <div className="legend-item">
              <div className="legend-color highlight-1"></div>
              <span>Supporting Context</span>
            </div>
            <div className="legend-item">
              <div className="legend-color highlight-2"></div>
              <span>Related Information</span>
            </div>
          </div>
        </div>
      )}

      {/* PDF Content */}
      <div className="pdf-content" ref={containerRef}>
        {urlReady && pdfUrl && workerReady ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              onLoadStart={onDocumentLoadStart}
              onSourceSuccess={onSourceSuccess}
              onSourceError={onSourceError}
              loading={<div>Loading PDF Document...</div>}
              error={<div>Failed to load PDF</div>}
              options={documentOptions}
            >
              <Page 
                pageNumber={pageNumber} 
                scale={scale}
                onRenderSuccess={onPageRenderSuccess}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
              {createHighlightOverlays(pageNumber)}
            </Document>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div>Preparing PDF...</div>
            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
              Worker: {workerReady ? '✅' : '⏳'} • URL: {urlReady ? '✅' : '⏳'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewer;