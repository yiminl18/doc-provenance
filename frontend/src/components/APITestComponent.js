import React, { useState } from 'react';

const APITestComponent = () => {
  const [results, setResults] = useState({});
  const [testing, setTesting] = useState(false);

  const runTests = async () => {
    setTesting(true);
    const testResults = {};

    // Test 1: Check if backend is running
    try {
      const response = await fetch('/api/debug/routes');
      testResults.backendRunning = {
        success: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null
      };
    } catch (error) {
      testResults.backendRunning = {
        success: false,
        error: error.message
      };
    }

    // Test 2: Check upload folder contents
    try {
      const response = await fetch('/api/debug/upload-folder');
      testResults.uploadFolder = {
        success: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null
      };
    } catch (error) {
      testResults.uploadFolder = {
        success: false,
        error: error.message
      };
    }

    // Test 3: Check preloaded documents
    try {
      const response = await fetch('/api/documents/preloaded');
      testResults.preloadedDocs = {
        success: response.ok,
        status: response.status,
        data: response.ok ? await response.json() : null
      };
    } catch (error) {
      testResults.preloadedDocs = {
        success: false,
        error: error.message
      };
    }

    // Test 4: Test direct PDF access (if we have documents)
    if (testResults.preloadedDocs?.success && testResults.preloadedDocs.data?.documents?.length > 0) {
      const firstDoc = testResults.preloadedDocs.data.documents[0];
      try {
        const response = await fetch(`/api/documents/${firstDoc.document_id}/pdf`, { method: 'HEAD' });
        testResults.pdfAccess = {
          success: response.ok,
          status: response.status,
          documentId: firstDoc.document_id,
          filename: firstDoc.filename
        };
      } catch (error) {
        testResults.pdfAccess = {
          success: false,
          error: error.message,
          documentId: firstDoc.document_id
        };
      }
    }

    setResults(testResults);
    setTesting(false);
  };

  const testUpload = async () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        console.log('🔄 Testing file upload...');
        const response = await fetch('/api/documents', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();
        console.log('📤 Upload result:', result);

        // Test immediate PDF access
        if (result.success && result.document_id) {
          setTimeout(async () => {
            try {
              const pdfResponse = await fetch(`/api/documents/${result.document_id}/pdf`, { method: 'HEAD' });
              console.log('📄 PDF access test:', pdfResponse.status, pdfResponse.ok);
            } catch (pdfError) {
              console.error('❌ PDF access failed:', pdfError);
            }
          }, 1000);
        }

        setResults(prev => ({
          ...prev,
          uploadTest: {
            success: response.ok,
            status: response.status,
            data: result
          }
        }));

      } catch (error) {
        console.error('❌ Upload test failed:', error);
        setResults(prev => ({
          ...prev,
          uploadTest: {
            success: false,
            error: error.message
          }
        }));
      }
    };
    fileInput.click();
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>🔧 API Debug Panel</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={runTests} disabled={testing} style={{ 
          padding: '10px 20px', 
          marginRight: '10px',
          background: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: testing ? 'not-allowed' : 'pointer'
        }}>
          {testing ? 'Testing...' : 'Run API Tests'}
        </button>
        
        <button onClick={testUpload} style={{ 
          padding: '10px 20px',
          background: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}>
          Test File Upload
        </button>
      </div>

      {Object.keys(results).length > 0 && (
        <div>
          <h3>📊 Test Results:</h3>
          
          {Object.entries(results).map(([testName, result]) => (
            <div key={testName} style={{ 
              marginBottom: '15px', 
              padding: '10px', 
              border: `2px solid ${result.success ? '#4CAF50' : '#f44336'}`,
              borderRadius: '4px',
              background: result.success ? '#e8f5e8' : '#ffeaea'
            }}>
              <h4>{testName.toUpperCase()}: {result.success ? '✅ PASS' : '❌ FAIL'}</h4>
              
              {result.status && <p><strong>Status:</strong> {result.status}</p>}
              
              {result.error && (
                <p style={{ color: '#d32f2f' }}><strong>Error:</strong> {result.error}</p>
              )}
              
              {result.data && (
                <details>
                  <summary>View Data</summary>
                  <pre style={{ 
                    background: '#f5f5f5', 
                    padding: '10px', 
                    overflow: 'auto',
                    maxHeight: '200px',
                    fontSize: '12px'
                  }}>
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
      
      <div style={{ marginTop: '30px', padding: '15px', background: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px' }}>
        <h4>🔍 Quick Checks:</h4>
        <ul>
          <li>Is your Flask backend running on port 5000?</li>
          <li>Are there PDF files in your app/uploads or app/preloaded directories?</li>
          <li>Check browser console for network errors</li>
          <li>Verify PDF.js is loaded (check browser dev tools → Sources)</li>
        </ul>
      </div>
    </div>
  );
};

export default APITestComponent;