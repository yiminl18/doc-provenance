import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Use a reliable worker setup
const setupWorker = () => {
  // Option 1: Try to use a working CDN
  const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  console.log('🔧 Using reliable PDF.js worker:', workerUrl);
};

const PDFViewerSimple = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [workerReady, setWorkerReady] = useState(false);
  const containerRef = useRef(null);

  // Initialize worker once
  useEffect(() => {
    setupWorker();
    setWorkerReady(true);
  }, []);

  // Memoize document options
  const documentOptions = useMemo(() => ({
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true,
  }), []);

  // Generate PDF URL
  useEffect(() => {
    if (!pdfDocument || !workerReady) {
      setPdfUrl(null);
      return;
    }

    const setupPdfUrl = async () => {
      const baseUrl = process.env.REACT_APP_API_URL || '';
      const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
      
      console.log('📄 Setting up PDF:', {
        filename: pdfDocument.filename,
        docId,
        isPreloaded: pdfDocument.isPreloaded
      });

      // For preloaded documents, ensure they're loaded
      if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
        try {
          const response = await fetch(`${baseUrl}/api/documents/preloaded/${docId}`, {
            method: 'POST'
          });
          if (response.ok) {
            console.log('✅ Preloaded document activated');
          }
        } catch (error) {
          console.warn('⚠️ Preloaded activation warning:', error.message);
        }
      }

      const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
      const absoluteUrl = new URL(pdfUrl, window.location.origin).href;
      
      console.log('📄 PDF URL:', absoluteUrl);
      
      // Test URL
      try {
        const testResponse = await fetch(absoluteUrl, { method: 'HEAD' });
        if (testResponse.ok) {
          console.log('✅ PDF URL accessible');
          setPdfUrl(absoluteUrl);
        } else {
          throw new Error(`PDF URL returned ${testResponse.status}`);
        }
      } catch (error) {
        console.error('❌ PDF URL test failed:', error);
        setError(`PDF not accessible: ${error.message}`);
        setLoading(false);
      }
    };

    setupPdfUrl();
  }, [pdfDocument, workerReady]);

  // PDF event handlers
  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
    console.log('✅ PDF loaded successfully:', { numPages, filename: pdfDocument?.filename });
  };

  const onDocumentLoadError = (error) => {
    console.error('❌ PDF load error:', error);
    setError(`Failed to load PDF: ${error.message}`);
    setLoading(false);
  };

  const onDocumentLoadStart = () => {
    console.log('🔄 PDF loading started');
    setLoading(true);
  };

  // Navigation
  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  const zoomIn = () => setScale(prev => Math.min(3.0, prev + 0.2));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.2));

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
        <div className="empty-message">Initializing PDF viewer...</div>
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
            Using reliable worker configuration
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
        <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--win95-text-muted)' }}>
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
            Open PDF in Browser
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {/* PDF Header */}
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
          <strong>Worker:</strong> Stable v3.11.174
        </div>
      </div>

      {/* PDF Content */}
      <div className="pdf-content" ref={containerRef}>
        {pdfUrl ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              onLoadStart={onDocumentLoadStart}
              loading={<div>Loading PDF...</div>}
              error={<div>PDF Error</div>}
              options={documentOptions}
            >
              <Page 
                pageNumber={pageNumber} 
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div>Preparing PDF...</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewerSimple;