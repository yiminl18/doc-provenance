import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// Try multiple worker configurations - Fixed URLs
const WORKER_CONFIGS = [
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`,
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`,
  // Fallback to specific known working version
  `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`
];

const PDFViewerDebug = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [debugInfo, setDebugInfo] = useState({});
  const [workerIndex, setWorkerIndex] = useState(0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [documentState, setDocumentState] = useState('initializing');
  const [errorLog, setErrorLog] = useState([]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setErrorLog(prev => [...prev, { timestamp, message, type }]);
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
  };

  // Initialize PDF.js worker
  useEffect(() => {
    const workerUrl = WORKER_CONFIGS[workerIndex];
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    
    addLog(`Setting PDF.js worker to: ${workerUrl}`);
    addLog(`PDF.js version: ${pdfjs.version}`);
    
    setDebugInfo({
      pdfVersion: pdfjs.version,
      workerUrl: pdfjs.GlobalWorkerOptions.workerSrc,
      workerIndex: workerIndex
    });
  }, [workerIndex]);

  // Generate PDF URL
  useEffect(() => {
    if (!pdfDocument) {
      setPdfUrl(null);
      return;
    }

    const generatePdfUrl = async () => {
      const baseUrl = process.env.REACT_APP_API_URL || '';
      const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
      
      addLog(`Setting up PDF for document: ${pdfDocument.filename}`);
      addLog(`Backend ID: ${docId}`);
      
      // For preloaded documents, ensure they're loaded first
      if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
        try {
          addLog('Activating preloaded document...');
          const response = await fetch(`${baseUrl}/api/documents/preloaded/${docId}`, {
            method: 'POST'
          });
          
          if (response.ok) {
            addLog('✅ Preloaded document activated');
          } else {
            addLog(`⚠️ Preloaded activation returned ${response.status}`, 'warn');
          }
        } catch (error) {
          addLog(`⚠️ Preloaded activation error: ${error.message}`, 'warn');
        }
      }

      const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
      const absolutePdfUrl = new URL(pdfUrl, window.location.origin).href;
      
      addLog(`PDF URL: ${absolutePdfUrl}`);
      
      // Test URL accessibility
      try {
        const testResponse = await fetch(absolutePdfUrl, { method: 'HEAD' });
        addLog(`URL test: ${testResponse.status} ${testResponse.statusText}`);
        addLog(`Content-Type: ${testResponse.headers.get('content-type')}`);
        addLog(`Content-Length: ${testResponse.headers.get('content-length')}`);
        
        if (testResponse.ok) {
          setPdfUrl(absolutePdfUrl);
          setDocumentState('url-ready');
          addLog('✅ PDF URL is accessible, setting for react-pdf');
        } else {
          addLog(`❌ PDF URL returned ${testResponse.status}`, 'error');
          setDocumentState('url-error');
        }
      } catch (fetchError) {
        addLog(`❌ URL test failed: ${fetchError.message}`, 'error');
        setDocumentState('url-error');
      }
    };

    generatePdfUrl();
  }, [pdfDocument]);

  // Document load handlers with extensive logging
  const onDocumentLoadStart = () => {
    addLog('🔄 react-pdf: Document load started!');
    setDocumentState('loading');
  };

  const onDocumentLoadSuccess = ({ numPages }) => {
    addLog(`✅ react-pdf: Document loaded successfully! Pages: ${numPages}`);
    setDocumentState('loaded');
  };

  const onDocumentLoadError = (error) => {
    addLog(`❌ react-pdf: Document load error: ${error.message}`, 'error');
    setDocumentState('error');
  };

  const onSourceSuccess = () => {
    addLog('✅ react-pdf: Source loaded successfully');
  };

  const onSourceError = (error) => {
    addLog(`❌ react-pdf: Source error: ${error.message}`, 'error');
  };

  // Force PDF.js test
  const testDirectPdfJs = async () => {
    if (!pdfUrl) return;
    
    addLog('🔍 Testing direct PDF.js loading...');
    
    try {
      const loadingTask = pdfjs.getDocument({
        url: pdfUrl,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@2.16.105/cmaps/',
        cMapPacked: true,
      });
      
      const pdf = await loadingTask.promise;
      addLog(`✅ Direct PDF.js load successful! Pages: ${pdf.numPages}`);
      
      // Try to get first page
      const page = await pdf.getPage(1);
      addLog(`✅ First page loaded successfully`);
      
    } catch (error) {
      addLog(`❌ Direct PDF.js load failed: ${error.message}`, 'error');
    }
  };

  // Try different worker
  const tryNextWorker = () => {
    const nextIndex = (workerIndex + 1) % WORKER_CONFIGS.length;
    setWorkerIndex(nextIndex);
    setPdfUrl(null);
    setDocumentState('initializing');
    addLog(`Trying worker configuration ${nextIndex + 1}/${WORKER_CONFIGS.length}`);
  };

  if (!pdfDocument) {
    return (
      <div className="pdf-empty">
        <div className="empty-icon">📄</div>
        <div className="empty-message">No document selected</div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {/* Debug Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <span className="doc-name">{pdfDocument.filename}</span>
          <span style={{ marginLeft: '1rem', fontSize: '0.8rem', color: '#666' }}>
            State: {documentState}
          </span>
        </div>
        
        <div className="pdf-controls">
          <button className="control-btn" onClick={testDirectPdfJs}>
            Test PDF.js
          </button>
          <button className="control-btn" onClick={tryNextWorker}>
            Try Worker {workerIndex + 2}
          </button>
          {onClose && (
            <button className="control-btn close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Debug Info Panel */}
      <div className="document-info">
        <div className="info-item">
          <strong>PDF.js Version:</strong> {debugInfo.pdfVersion}
        </div>
        <div className="info-item">
          <strong>Worker:</strong> {debugInfo.workerIndex + 1}/{WORKER_CONFIGS.length}
        </div>
        <div className="info-item">
          <strong>Document State:</strong> {documentState}
        </div>
        <div className="info-item">
          <strong>PDF URL Ready:</strong> {pdfUrl ? 'Yes' : 'No'}
        </div>
      </div>

      {/* Error Log */}
      <div style={{ 
        maxHeight: '200px', 
        overflow: 'auto', 
        padding: '1rem', 
        backgroundColor: '#f5f5f5',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        margin: '1rem'
      }}>
        <h4>Debug Log:</h4>
        {errorLog.map((log, index) => (
          <div 
            key={index} 
            style={{ 
              color: log.type === 'error' ? 'red' : log.type === 'warn' ? 'orange' : 'black',
              marginBottom: '0.25rem'
            }}
          >
            [{log.timestamp}] {log.message}
          </div>
        ))}
      </div>

      {/* PDF Content */}
      <div className="pdf-content">
        {documentState === 'url-ready' && pdfUrl ? (
          <div style={{ border: '2px solid blue', padding: '1rem' }}>
            <h4>React-PDF Document Component Test</h4>
            <p>URL: {pdfUrl}</p>
            <p>Expected: onLoadStart should fire immediately</p>
            
            <Document
              file={pdfUrl}
              onLoadStart={onDocumentLoadStart}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              onSourceSuccess={onSourceSuccess}
              onSourceError={onSourceError}
              loading={<div style={{ padding: '2rem', backgroundColor: 'yellow' }}>React-PDF Loading...</div>}
              error={<div style={{ padding: '2rem', backgroundColor: 'red', color: 'white' }}>React-PDF Error!</div>}
              options={{
                cMapUrl: 'https://unpkg.com/pdfjs-dist@2.16.105/cmaps/',
                cMapPacked: true,
              }}
            >
              <Page pageNumber={1} />
            </Document>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h3>Waiting for PDF URL...</h3>
            <p>Current State: {documentState}</p>
            {documentState === 'url-error' && (
              <button onClick={() => window.location.reload()}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewerDebug;