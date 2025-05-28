import React, { useState, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up worker with absolute fallback
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const WorkingPDFViewer = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [documentReady, setDocumentReady] = useState(false);

  // Memoize options to prevent unnecessary reloads
  const documentOptions = useMemo(() => ({
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/',
  }), []);

  // Generate PDF URL
  useEffect(() => {
    if (!pdfDocument) {
      setPdfUrl(null);
      setDocumentReady(false);
      return;
    }

    const setupPdfUrl = async () => {
      try {
        // Use the correct backend URL (from your .env)
        const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
        const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
        
        console.log('🔧 Setting up PDF URL:', {
          filename: pdfDocument.filename,
          docId,
          baseUrl,
          isPreloaded: pdfDocument.isPreloaded
        });

        // For preloaded documents, ensure they're activated first
        if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
          try {
            const activateResponse = await fetch(`${baseUrl}/api/documents/preloaded/${docId}`, {
              method: 'POST'
            });
            if (activateResponse.ok) {
              console.log('✅ Preloaded document activated');
            } else {
              console.warn('⚠️ Preloaded activation returned:', activateResponse.status);
            }
          } catch (activateError) {
            console.warn('⚠️ Preloaded activation failed:', activateError.message);
          }
        }

        const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
        console.log('📄 Final PDF URL:', pdfUrl);
        
        // Test URL accessibility
        const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
        if (!testResponse.ok) {
          throw new Error(`PDF endpoint returned ${testResponse.status}: ${testResponse.statusText}`);
        }

        console.log('✅ PDF URL is accessible');
        setPdfUrl(pdfUrl);
        setDocumentReady(true);
        setError(null);
        
      } catch (urlError) {
        console.error('❌ PDF URL setup failed:', urlError);
        setError(`Failed to setup PDF URL: ${urlError.message}`);
        setLoading(false);
      }
    };

    setupPdfUrl();
  }, [pdfDocument]);

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
    setError(null);
  };

  const onSourceSuccess = () => {
    console.log('✅ PDF source loaded successfully');
  };

  const onSourceError = (error) => {
    console.error('❌ PDF source error:', error);
    setError(`PDF source error: ${error.message}`);
    setLoading(false);
  };

  // Page navigation
  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  const zoomIn = () => setScale(prev => Math.min(3.0, prev + 0.2));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.2));

  // Render states
  if (!pdfDocument) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">📄</div>
        <div className="empty-message">No document selected</div>
      </div>
    );
  }

  if (!documentReady) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⚙️</div>
        <div className="empty-message">
          Setting up PDF...
          <br />
          <small style={{ color: '#666' }}>
            Document: {pdfDocument.filename}
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

  if (loading) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⏳</div>
        <div className="empty-message">
          Loading PDF...
          <br />
          <small style={{ color: '#666' }}>
            {pdfDocument.filename}
          </small>
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
          <strong>PDF URL:</strong> <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Open Direct</a>
        </div>
      </div>

      {/* PDF Content */}
      <div className="pdf-content">
        {pdfUrl && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              onLoadStart={onDocumentLoadStart}
              onSourceSuccess={onSourceSuccess}
              onSourceError={onSourceError}
              loading={
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <div>Loading PDF Document...</div>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                    Using stable PDF.js worker v3.11.174
                  </div>
                </div>
              }
              error={
                <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>
                  <div>Failed to load PDF</div>
                  <div style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                      Try opening directly
                    </a>
                  </div>
                </div>
              }
              options={documentOptions}
            >
              <Page 
                pageNumber={pageNumber} 
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                loading={
                  <div style={{ padding: '1rem', textAlign: 'center' }}>
                    Loading page {pageNumber}...
                  </div>
                }
                error={
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'red' }}>
                    Failed to load page {pageNumber}
                  </div>
                }
              />
            </Document>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkingPDFViewer;