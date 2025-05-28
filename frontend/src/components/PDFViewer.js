import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import '../styles/pdf-viewer.css'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Multiple worker configurations to try
const WORKER_CONFIGS = [
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`,
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`,
  // Fallback to known working version
  `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`
];

const PDFViewer = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [urlReady, setUrlReady] = useState(false);
  const [textItems, setTextItems] = useState(new Map()); // Map of page -> text items
  const [workerIndex, setWorkerIndex] = useState(0);
  const [workerInitialized, setWorkerInitialized] = useState(false);
  const containerRef = useRef(null);

  // Memoize document options to prevent unnecessary reloads
  const documentOptions = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
  }), []);

  // Initialize PDF.js worker with cycling capability
  useEffect(() => {
    const initializeWorker = async () => {
      const workerUrl = WORKER_CONFIGS[workerIndex];
      console.log(`🔧 Trying PDF.js worker ${workerIndex + 1}/${WORKER_CONFIGS.length}: ${workerUrl}`);
      
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      
      // Test if worker URL is accessible
      try {
        const response = await fetch(workerUrl, { method: 'HEAD' });
        if (response.ok) {
          console.log(`✅ Worker ${workerIndex + 1} is accessible`);
          setWorkerInitialized(true);
          setError(null);
        } else {
          throw new Error(`Worker returned ${response.status}`);
        }
      } catch (workerError) {
        console.warn(`⚠️ Worker ${workerIndex + 1} failed: ${workerError.message}`);
        
        // Try next worker if available
        if (workerIndex < WORKER_CONFIGS.length - 1) {
          setTimeout(() => {
            setWorkerIndex(prev => prev + 1);
          }, 100);
        } else {
          setError(`All PDF.js workers failed. Last error: ${workerError.message}`);
          setLoading(false);
        }
      }
    };

    initializeWorker();
  }, [workerIndex]);

  // Reset worker cycling when document changes
  useEffect(() => {
    if (pdfDocument) {
      setWorkerIndex(0);
      setWorkerInitialized(false);
      setError(null);
      setLoading(true);
    }
  }, [pdfDocument]);

  // Generate PDF URL (only when worker is ready)
  useEffect(() => {
    if (!pdfDocument || !workerInitialized) {
      setPdfUrl(null);
      return;
    }

    const ensureDocumentAndGetPdfUrl = async () => {
      const baseUrl = process.env.REACT_APP_API_URL || '';
      const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
      
      console.log('📄 Setting up PDF for document:', {
        filename: pdfDocument.filename,
        isPreloaded: pdfDocument.isPreloaded || pdfDocument.isPreLoaded,
        backendDocumentId: docId,
        workerIndex: workerIndex + 1
      });

      // For preloaded documents, ensure they're loaded first
      if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
        try {
          console.log('🔄 Ensuring preloaded document is activated...');
          const response = await fetch(`${baseUrl}/api/documents/preloaded/${docId}`, {
            method: 'POST'
          });
          
          if (!response.ok) {
            console.warn('⚠️ Preloaded document activation failed, but continuing...');
          } else {
            console.log('✅ Preloaded document activated');
          }
        } catch (error) {
          console.warn('⚠️ Preloaded document activation error:', error.message);
        }
      }

      const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
      const absolutePdfUrl = new URL(pdfUrl, window.location.origin).href;
      console.log('📄 PDF URLs:', { relative: pdfUrl, absolute: absolutePdfUrl });
      
      // Test if the PDF URL is accessible
      try {
        console.log('🔍 Testing PDF URL accessibility...');
        const testResponse = await fetch(absolutePdfUrl, { method: 'HEAD' });
        console.log('📊 PDF URL test response:', {
          status: testResponse.status,
          statusText: testResponse.statusText,
          contentType: testResponse.headers.get('content-type'),
          contentLength: testResponse.headers.get('content-length')
        });
        
        if (!testResponse.ok) {
          setError(`PDF endpoint returned ${testResponse.status}: ${testResponse.statusText}`);
          setLoading(false);
          return;
        }
        
        if (!testResponse.headers.get('content-type')?.includes('pdf')) {
          console.warn('⚠️ Response is not a PDF:', testResponse.headers.get('content-type'));
        }
        
      } catch (fetchError) {
        console.error('❌ PDF URL test failed:', fetchError);
        setError(`PDF URL not accessible: ${fetchError.message}`);
        setLoading(false);
        return;
      }
      
      console.log('✅ PDF URL validated, setting for react-pdf...');
      setPdfUrl(absolutePdfUrl);
      setUrlReady(true);
      
      // Set a timeout to catch if react-pdf never starts loading
      setTimeout(() => {
        if (loading && urlReady) {
          console.warn('⚠️ react-pdf timeout: Document component never started loading');
          // Try next worker
          if (workerIndex < WORKER_CONFIGS.length - 1) {
            console.log('🔄 Trying next worker due to timeout...');
            setWorkerIndex(prev => prev + 1);
            setUrlReady(false);
            setPdfUrl(null);
          } else {
            setError('PDF loading timed out - all workers exhausted');
            setLoading(false);
          }
        }
      }, 10000); // 10 second timeout
    };

    ensureDocumentAndGetPdfUrl();
  }, [pdfDocument, workerInitialized, workerIndex]);

  // Handle successful PDF load
  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
    console.log('✅ PDF loaded successfully:', { 
      numPages, 
      filename: pdfDocument?.filename,
      workerUsed: workerIndex + 1
    });
  };

  // Handle PDF load error with worker cycling
  const onDocumentLoadError = (error) => {
    console.error('❌ PDF load error:', error);
    
    // Try next worker if available
    if (workerIndex < WORKER_CONFIGS.length - 1) {
      console.log('🔄 Trying next worker due to load error...');
      setWorkerIndex(prev => prev + 1);
      setUrlReady(false);
      setPdfUrl(null);
      setError(null);
    } else {
      setError(`Failed to load PDF with all workers. Last error: ${error.message}`);
      setLoading(false);
    }
  };

  // Handle load start
  const onDocumentLoadStart = () => {
    console.log('🔄 react-pdf: Load started successfully!');
    setLoading(true);
    setError(null);
  };

  // Handle source success
  const onSourceSuccess = () => {
    console.log('✅ react-pdf: Source loaded successfully');
  };

  // Handle source error with worker cycling
  const onSourceError = (error) => {
    console.error('❌ react-pdf: Source error:', error);
    
    // Try next worker if available
    if (workerIndex < WORKER_CONFIGS.length - 1) {
      console.log('🔄 Trying next worker due to source error...');
      setWorkerIndex(prev => prev + 1);
      setUrlReady(false);
      setPdfUrl(null);
      setError(null);
    } else {
      setError(`PDF source error with all workers. Last error: ${error.message}`);
      setLoading(false);
    }
  };

  // Handle page render success to extract text items for highlighting
  const onPageRenderSuccess = (page) => {
    const pageNum = page.pageNumber;
    
    // Get text content for this page
    page.getTextContent().then((textContent) => {
      const items = textContent.items.map((item, index) => ({
        id: index,
        text: item.str,
        transform: item.transform,
        width: item.width,
        height: item.height,
        // Calculate position from transform matrix
        x: item.transform[4],
        y: item.transform[5],
        fontSize: item.transform[0]
      }));
      
      setTextItems(prev => new Map(prev).set(pageNum, items));
    }).catch(console.error);
  };

  // Find text items that match provenance content
  const findProvenanceMatches = (pageItems, provenanceText) => {
    if (!pageItems || !provenanceText) return [];
    
    const matches = [];
    const searchText = provenanceText.toLowerCase().trim();
    
    // Try to find longer phrase matches first
    const words = searchText.split(/\s+/).filter(word => word.length > 2);
    
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const itemText = item.text.toLowerCase();
      
      // Look for exact matches of significant words
      if (words.some(word => itemText.includes(word) && word.length > 3)) {
        matches.push(item);
      }
      
      // Also check if the provenance text contains this item's text
      if (itemText.length > 3 && searchText.includes(itemText.trim())) {
        matches.push(item);
      }
    }
    
    return matches;
  };

  // Create highlight overlays for provenance
  const createHighlightOverlays = (pageNum) => {
    if (!selectedProvenance || !selectedProvenance.content) return null;
    
    const pageItems = textItems.get(pageNum);
    if (!pageItems) return null;
    
    // Get all content text from the provenance
    const provenanceTexts = Array.isArray(selectedProvenance.content) 
      ? selectedProvenance.content 
      : [selectedProvenance.content];
    
    const allMatches = [];
    provenanceTexts.forEach((text, textIndex) => {
      if (typeof text === 'string') {
        const matches = findProvenanceMatches(pageItems, text);
        // Add text index to distinguish different provenance segments
        matches.forEach(match => {
          allMatches.push({ ...match, provenanceIndex: textIndex });
        });
      }
    });
    
    return allMatches.map((match, index) => (
      <div
        key={`highlight-${pageNum}-${index}`}
        className={`pdf-highlight highlight-${match.provenanceIndex % 3}`}
        style={{
          position: 'absolute',
          left: `${(match.x / 612) * 100}%`, // Assuming standard page width
          top: `${100 - ((match.y + match.height) / 792) * 100}%`, // Assuming standard page height
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

  // Navigation functions
  const goToPrevPage = () => {
    setPageNumber(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  };

  const zoomIn = () => {
    setScale(prev => Math.min(3.0, prev + 0.2));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.2));
  };

  const resetZoom = () => {
    setScale(1.0);
  };

  // Manual retry function
  const retryWithNextWorker = () => {
    if (workerIndex < WORKER_CONFIGS.length - 1) {
      setWorkerIndex(prev => prev + 1);
      setError(null);
      setLoading(true);
      setUrlReady(false);
      setPdfUrl(null);
    }
  };

  if (!pdfDocument) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">📄</div>
        <div className="empty-message">No document selected</div>
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
            Worker {workerIndex + 1}/{WORKER_CONFIGS.length}
            {!workerInitialized && ' - Initializing worker...'}
            {workerInitialized && !urlReady && ' - Preparing PDF...'}
            {urlReady && ' - Loading document...'}
          </small>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">⚠️</div>
        <div className="empty-message">PDF Load Error</div>
        <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--win95-text-muted)' }}>
          {error}
        </p>
        <div style={{ marginTop: '1rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
          Document: {pdfDocument.filename}<br/>
          Type: {pdfDocument.isPreloaded ? 'Preloaded' : 'Uploaded'}<br/>
          ID: {pdfDocument.backendDocumentId}<br/>
          Worker: {workerIndex + 1}/{WORKER_CONFIGS.length}
        </div>
        {workerIndex < WORKER_CONFIGS.length - 1 && (
          <button 
            onClick={retryWithNextWorker}
            style={{ 
              marginTop: '1rem', 
              padding: '0.5rem 1rem',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Try Worker {workerIndex + 2}
          </button>
        )}
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
          <small style={{ marginLeft: '1rem', color: '#666' }}>
            Worker {workerIndex + 1}/{WORKER_CONFIGS.length}
          </small>
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

      {/* Document Info Panel */}
      <div className="document-info">
        <div className="info-item">
          <strong>Document:</strong> {pdfDocument.filename}
        </div>
        <div className="info-item">
          <strong>Type:</strong> {pdfDocument.isPreloaded ? 'Preloaded Research Paper' : 'Uploaded Document'}
        </div>
        <div className="info-item">
          <strong>Pages:</strong> {numPages}
        </div>
        <div className="info-item">
          <strong>Scale:</strong> {Math.round(scale * 100)}%
        </div>
        <div className="info-item">
          <strong>Worker:</strong> {workerIndex + 1}/{WORKER_CONFIGS.length}
        </div>
        {pdfDocument.textLength && (
          <div className="info-item">
            <strong>Text Length:</strong> {Math.round(pdfDocument.textLength / 1000)}k chars
          </div>
        )}
        {pdfDocument.sentenceCount && (
          <div className="info-item">
            <strong>Sentences:</strong> {pdfDocument.sentenceCount}
          </div>
        )}
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
          <div className="provenance-summary">
            <div className="summary-item">
              <span className="summary-label">Provenance ID:</span>
              <span className="summary-value">{selectedProvenance.provenance_id || 'N/A'}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Text Segments:</span>
              <span className="summary-value">
                {Array.isArray(selectedProvenance.content) 
                  ? selectedProvenance.content.length 
                  : 1
                }
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Current Page:</span>
              <span className="summary-value">{pageNumber} of {numPages}</span>
            </div>
          </div>
        </div>
      )}

      {/* PDF Document */}
      <div className="pdf-content" ref={containerRef}>
        {urlReady && pdfUrl && workerInitialized ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              onLoadStart={onDocumentLoadStart}
              onSourceSuccess={onSourceSuccess}
              onSourceError={onSourceError}
              loading={<div>Loading PDF...</div>}
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
              {/* Provenance highlights overlay */}
              {createHighlightOverlays(pageNumber)}
            </Document>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div>Preparing PDF...</div>
            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
              {!workerInitialized && 'Initializing PDF.js worker...'}
              {workerInitialized && !urlReady && 'Setting up document URL...'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewer;