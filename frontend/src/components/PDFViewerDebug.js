import React, { useState, useEffect } from 'react';

const PDFViewerDebug = ({ pdfDocument, selectedProvenance, onClose }) => {
  const [debugInfo, setDebugInfo] = useState({});

  // Debug logging every time component renders
  console.log('🔍 PDFViewerDebug Component Render:', {
    pdfDocument,
    hasPdfDocument: !!pdfDocument,
    pdfDocumentType: typeof pdfDocument,
    pdfDocumentKeys: pdfDocument ? Object.keys(pdfDocument) : [],
    selectedProvenance,
    onClose: typeof onClose
  });

  useEffect(() => {
    setDebugInfo({
      componentMounted: true,
      timestamp: new Date().toISOString(),
      pdfDocumentReceived: !!pdfDocument,
      pdfDocumentDetails: pdfDocument ? {
        id: pdfDocument.id,
        filename: pdfDocument.filename,
        backendDocumentId: pdfDocument.backendDocumentId,
        isPreloaded: pdfDocument.isPreloaded,
        hasAllRequiredFields: !!(pdfDocument.id && pdfDocument.filename && pdfDocument.backendDocumentId)
      } : null
    });
  }, [pdfDocument]);

  // First check: No document at all
  if (!pdfDocument) {
    console.log('❌ PDFViewerDebug: No pdfDocument prop - returning empty state');
    return (
      <div className="pdf-viewer" style={{ 
        border: '3px solid red', 
        padding: '2rem', 
        backgroundColor: '#ffebee',
        margin: '1rem',
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'hidden'
      }}>
        <h3 style={{ color: 'red' }}>PDFViewerDebug: No Document</h3>
        <div style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
          <div><strong>pdfDocument prop:</strong> {String(pdfDocument)}</div>
          <div><strong>Type:</strong> {typeof pdfDocument}</div>
          <div><strong>Is null:</strong> {pdfDocument === null ? 'Yes' : 'No'}</div>
          <div><strong>Is undefined:</strong> {pdfDocument === undefined ? 'Yes' : 'No'}</div>
        </div>
        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fff', border: '1px solid #ddd' }}>
          <strong>This means:</strong> The PDFViewer component is being called, but no document is being passed to it.
          Check your App.js to see if activeDocument is being set correctly.
        </div>
      </div>
    );
  }

  // Second check: Document exists but missing required fields
  const missingFields = [];
  if (!pdfDocument.id) missingFields.push('id');
  if (!pdfDocument.filename) missingFields.push('filename');
  if (!pdfDocument.backendDocumentId) missingFields.push('backendDocumentId');

  if (missingFields.length > 0) {
    console.log('⚠️ PDFViewerDebug: Document missing required fields:', missingFields);
    return (
      <div className="pdf-viewer" style={{ 
        border: '3px solid orange', 
        padding: '2rem', 
        backgroundColor: '#fff3e0',
        margin: '1rem',
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'hidden'
      }}>
        <h3 style={{ color: 'orange' }}>PDFViewerDebug: Incomplete Document</h3>
        <div style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
          <div><strong>Missing fields:</strong> {missingFields.join(', ')}</div>
          <div><strong>Available fields:</strong> {Object.keys(pdfDocument).join(', ')}</div>
        </div>
        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fff', border: '1px solid #ddd' }}>
          <h4>Current Document Object:</h4>
          <pre style={{ 
            overflow: 'auto', 
            maxHeight: '300px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '0.75rem'
          }}>
            {JSON.stringify(pdfDocument, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  // Third check: All good, show success
  console.log('✅ PDFViewerDebug: Valid document, would normally render PDF viewer');
  
  return (
    <div className="pdf-viewer" style={{ 
      border: '3px solid green', 
      padding: '2rem', 
      backgroundColor: '#e8f5e8',
      margin: '1rem',
      maxHeight: '80vh',
      overflowY: 'auto',
      overflowX: 'hidden'
    }}>
      <h3 style={{ color: 'green' }}>✅ PDFViewerDebug: Ready to Load PDF</h3>
      
      {/* Document Info */}
      <div style={{ 
        marginTop: '1rem', 
        padding: '1rem', 
        backgroundColor: '#fff', 
        border: '1px solid #ddd',
        fontFamily: 'monospace',
        fontSize: '0.9rem'
      }}>
        <h4>Document Details:</h4>
        <div><strong>ID:</strong> {pdfDocument.id}</div>
        <div><strong>Filename:</strong> {pdfDocument.filename}</div>
        <div><strong>Backend ID:</strong> {pdfDocument.backendDocumentId}</div>
        <div><strong>Is Preloaded:</strong> {pdfDocument.isPreloaded ? 'Yes' : 'No'}</div>
        <div><strong>Text Length:</strong> {pdfDocument.textLength || 'Not set'}</div>
        <div><strong>Sentence Count:</strong> {pdfDocument.sentenceCount || 'Not set'}</div>
      </div>

      {/* Debug Info */}
      <div style={{ 
        marginTop: '1rem', 
        padding: '1rem', 
        backgroundColor: '#f5f5f5', 
        border: '1px solid #ddd',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        maxHeight: '300px',
        overflowY: 'auto'
      }}>
        <h4>Debug Info:</h4>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(debugInfo, null, 2)}
        </pre>
      </div>

      {/* Test PDF URL */}
      <div style={{ marginTop: '1rem' }}>
        <TestPDFUrl pdfDocument={pdfDocument} />
      </div>

      {/* Controls */}
      <div style={{ marginTop: '1rem' }}>
        <button 
          onClick={() => console.log('Full pdfDocument object:', pdfDocument)}
          style={{ padding: '0.5rem 1rem', marginRight: '1rem', backgroundColor: '#2196F3', color: 'white', border: 'none' }}
        >
          Log Full Document to Console
        </button>
        
        {onClose && (
          <button 
            onClick={onClose}
            style={{ padding: '0.5rem 1rem', backgroundColor: '#f44336', color: 'white', border: 'none' }}
          >
            Close Debug View
          </button>
        )}
      </div>
    </div>
  );
};

// Helper component to test PDF URL generation
const TestPDFUrl = ({ pdfDocument }) => {
  const [urlTest, setUrlTest] = useState({ status: 'pending', message: 'Testing...' });

  useEffect(() => {
    const testUrl = async () => {
      try {
        const baseUrl = process.env.REACT_APP_API_URL || '';
        const docId = pdfDocument.backendDocumentId || pdfDocument.document_id;
        const pdfUrl = `${baseUrl}/api/documents/${docId}/pdf`;
        const absoluteUrl = new URL(pdfUrl, window.location.origin).href;

        console.log('🔍 Testing PDF URL:', absoluteUrl);

        const response = await fetch(absoluteUrl, { method: 'HEAD' });
        
        setUrlTest({
          status: response.ok ? 'success' : 'error',
          message: response.ok ? 
            `✅ PDF accessible (${response.status}, ${response.headers.get('content-length')} bytes)` :
            `❌ PDF not accessible (${response.status} ${response.statusText})`,
          url: absoluteUrl,
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length')
        });

      } catch (error) {
        setUrlTest({
          status: 'error',
          message: `❌ URL test failed: ${error.message}`,
          error: error.message
        });
      }
    };

    testUrl();
  }, [pdfDocument]);

  return (
    <div style={{ 
      padding: '1rem', 
      backgroundColor: urlTest.status === 'success' ? '#e8f5e8' : '#ffebee', 
      border: '1px solid ' + (urlTest.status === 'success' ? 'green' : 'red') 
    }}>
      <h4>PDF URL Test:</h4>
      <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
        <div><strong>Status:</strong> {urlTest.message}</div>
        {urlTest.url && <div><strong>URL:</strong> {urlTest.url}</div>}
        {urlTest.contentType && <div><strong>Content-Type:</strong> {urlTest.contentType}</div>}
        {urlTest.contentLength && <div><strong>Size:</strong> {urlTest.contentLength} bytes</div>}
      </div>
      
      {urlTest.url && (
        <div style={{ marginTop: '0.5rem' }}>
          <a 
            href={urlTest.url} 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ 
              padding: '0.5rem 1rem', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              textDecoration: 'none',
              borderRadius: '4px',
              fontSize: '0.8rem'
            }}
          >
            Open PDF in New Tab
          </a>
        </div>
      )}
    </div>
  );
};

export default PDFViewerDebug;