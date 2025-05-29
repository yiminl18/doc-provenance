import React, { useState, useEffect } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import QuestionCollection from './components/QuestionCollection';
import ProvenanceNavigator from './components/ProvenanceNavigator';
import HybridPDFViewer from './components/HybridPDFViewer';
import FeedbackModal from './components/FeedbackModal';
import DocumentSelector from './components/DocumentSelector';
import {
  // Session-based imports
  getCurrentSession,
  uploadDocument,
  loadDocument,
  processDocumentForSession,
  getDocumentText,
  askQuestionInSession,
  getQuestionProgress,
  getQuestionResults,
  getQuestionSentences,
  getQuestionStatus,
  getPreloadedDocuments,
  // Legacy fallbacks
  askQuestion,
  checkProgress,
  getResults,
  fetchSentences,
  checkStatus
} from './services/api';

function App() {
  // Session management - simplified
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  // Document management
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);

  // UI state
  const [selectedProvenance, setSelectedProvenance] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);
  const [preloadedDocuments, setPreloadedDocuments] = useState([]);
  const [loadingPreloaded, setLoadingPreloaded] = useState(false);

  // debugging
  const [debugInfo, setDebugInfo] = useState(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);

  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;

  // Initialize session on app start
  useEffect(() => {
    initializeSession();
  }, []);

  const initializeSession = async () => {
    try {
      const response = await getCurrentSession();
      if (response.success) {
        setCurrentSessionId(response.session_id);
        setSessionReady(true);
        console.log('✅ Session initialized:', response.session_id);
      }
    } catch (error) {
      console.error('❌ Failed to initialize session, continuing in legacy mode');
      setSessionReady(true); // Continue without session features
    }
  };

  // UNIFIED document upload handler
  const handleDocumentUpload = async (formData) => {
    const fileName = formData.get('file')?.name || 'Unknown file';

    setUploadProgress({
      success: false,
      message: `Uploading: ${fileName}...`
    });

    try {
      const response = await uploadDocument(formData);
      
      // Try to process for session if available
      let textLength = 0;
      let sentenceCount = 0;
      
      if (sessionReady && currentSessionId) {
        try {
          const processResponse = await processDocumentForSession(response.document_id);
          textLength = processResponse.text_length;
          sentenceCount = processResponse.sentence_count;
        } catch (processError) {
          console.warn('Session processing failed, continuing with basic upload');
        }
      }

      const docId = createNewDocument(response.filename, false, {
        document_id: response.document_id,
        text_length: textLength,
        sentence_count: sentenceCount
      });

      setUploadProgress({
        success: true,
        message: `Upload Complete: ${response.filename}`
      });

      setTimeout(() => setUploadProgress(null), 3000);
      return docId;

    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress({
        success: false,
        message: `Upload Error: ${error.message}`
      });
      setTimeout(() => setUploadProgress(null), 5000);
      throw error;
    }
  };

  // Add this function to debug document loading
const debugDocumentLoading = async () => {
  try {
    console.log('🔍 Starting document loading debug...');
    
    // Test 1: Check preloaded documents endpoint
    const preloadedResponse = await fetch('/api/documents/preloaded');
    const preloadedData = await preloadedResponse.json();
    
    // Test 2: Check session status
    const sessionResponse = await fetch('/api/sessions/current');
    const sessionData = await sessionResponse.json();
    
    // Test 3: Test debug endpoint
    const debugResponse = await fetch('/api/debug/preloaded-docs');
    const debugData = await debugResponse.json();
    
    const debugInfo = {
      preloaded_endpoint: {
        status: preloadedResponse.status,
        success: preloadedData.success,
        documents_count: preloadedData.documents?.length || 0,
        documents: preloadedData.documents || [],
        error: preloadedData.error
      },
      session_endpoint: {
        status: sessionResponse.status,
        success: sessionData.success,
        session_id: sessionData.session_id,
        error: sessionData.error
      },
      debug_endpoint: {
        status: debugResponse.status,
        preload_dir: debugData.preload_dir,
        preload_dir_exists: debugData.preload_dir_exists,
        pdf_count: debugData.pdf_count,
        processed_count: debugData.processed_count,
        files_in_preload: debugData.files_in_preload,
        error: debugData.error
      },
      frontend_state: {
        sessionReady,
        currentSessionId,
        documentsCount: documents.size,
        loadingPreloaded
      }
    };
    
    setDebugInfo(debugInfo);
    setShowDebugInfo(true);
    
    console.log('🔍 Debug info collected:', debugInfo);
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
    setDebugInfo({ error: error.message });
    setShowDebugInfo(true);
  }
};


  // Handle preloaded document selection
  const handleShowPreloaded = async () => {
    setLoadingPreloaded(true);
    try {
      const response = await getPreloadedDocuments();
      if (response.success && response.documents) {
        setPreloadedDocuments(response.documents);
      } else {
        setPreloadedDocuments([]);
      }
      setShowPreloadedModal(true);
    } catch (error) {
      console.error('Error fetching preloaded documents:', error);
      setPreloadedDocuments([]);
      setShowPreloadedModal(true);
    } finally {
      setLoadingPreloaded(false);
    }
  };

 // Add this improved handleDocumentSelect function to your App.js

const handleDocumentSelect = async (document) => {
  if (!sessionReady) {
    console.error('Session not ready for document processing');
    return;
  }

  try {
    setLoadingPreloaded(true);
    console.log('🔄 Loading document:', document);
    
    // Step 1: Load the document (this makes it available)
    console.log('Step 1: Loading document...');
    const loadResponse = await loadDocument(document.document_id);
    
    if (!loadResponse.success) {
      throw new Error(loadResponse.error || 'Failed to load document');
    }
    
    console.log('✅ Document loaded:', loadResponse);
    
    // Step 2: Process document for current session (extracts sentences, etc.)
    console.log('Step 2: Processing document for session...');
    let processResponse;
    try {
      processResponse = await processDocumentForSession(document.document_id);
      console.log('✅ Document processed for session:', processResponse);
    } catch (processError) {
      console.warn('⚠️ Session processing failed, using basic document info:', processError);
      // Continue with basic document info if session processing fails
      processResponse = {
        success: true,
        text_length: document.text_length || 0,
        sentence_count: document.sentence_count || 0,
        document_id: document.document_id,
        filename: document.filename
      };
    }
    
    // Step 3: Create the frontend document object
    console.log('Step 3: Creating frontend document...');
    const docId = createNewDocument(document.filename, document.is_preloaded || false, {
      document_id: document.document_id,
      text_length: processResponse.text_length || document.text_length || 0,
      sentence_count: processResponse.sentence_count || document.sentence_count || 0
    });

    // Step 4: Update document with additional metadata
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.isPreloaded = document.is_preloaded || false;
        doc.backendDocumentId = document.document_id;
        doc.textLength = processResponse.text_length || document.text_length || 0;
        doc.sentenceCount = processResponse.sentence_count || document.sentence_count || 0;
        doc.sourceFolder = document.source_folder || (document.is_preloaded ? 'preloaded' : 'uploads');
        doc.sessionProcessed = processResponse.success || false;
        
        // Add additional metadata for PDF loading
        doc.originalDocument = document; // Keep reference to original
        
        newDocs.set(docId, doc);
        console.log('✅ Document created and configured:', doc);
      }
      return newDocs;
    });

    // Step 5: Close modal and show success
    if (showPreloadedModal) {
      setShowPreloadedModal(false);
    }
    
    console.log('🎉 Document selection completed successfully');
    
  } catch (error) {
    console.error('❌ Error loading document:', error);
    alert(`Error loading document: ${error.message}`);
  } finally {
    setLoadingPreloaded(false);
  }
};

  const createNewDocument = (filename, isPreloaded = false, backendData = null) => {
    const docId = `doc_${Date.now()}`;
    const newDoc = {
      id: docId,
      filename,
      questions: new Map(),
      activeQuestionId: null,
      uploadStatus: { 
        success: true, 
        message: isPreloaded ? `${filename} loaded successfully` : `${filename} uploaded successfully` 
      },
      isPreloaded,
      createdAt: new Date(),
      sessionId: currentSessionId,
      ...(backendData && {
        backendDocumentId: backendData.document_id,
        textLength: backendData.text_length,
        sentenceCount: backendData.sentence_count
      })
    };

    setDocuments(prev => new Map(prev).set(docId, newDoc));
    setActiveDocumentId(docId);
    return docId;
  };

  // SIMPLIFIED question submission with progressive loading
  const addQuestionToDocument = async (questionText) => {
    if (!activeDocumentId || !activeDocument) {
      console.error('No active document');
      return;
    }

    const tempQuestionId = `temp_${Date.now()}`;
    const questionData = {
      id: tempQuestionId,
      text: questionText,
      answer: null,
      provenanceSources: [],
      isProcessing: true,
      logs: [],
      createdAt: new Date()
    };

    // Add question to document immediately
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc) {
        doc.questions.set(tempQuestionId, questionData);
        doc.activeQuestionId = tempQuestionId;
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });

    try {
      // Try session-based approach first
      if (sessionReady && currentSessionId && activeDocument.backendDocumentId) {
        const response = await askQuestionInSession(currentSessionId, questionText, activeDocument.backendDocumentId);
        startSessionPolling(tempQuestionId, currentSessionId, response.question_id);
      } else {
        // Fallback to legacy
        const response = await askQuestion(questionText, activeDocument.filename);
        startLegacyPolling(tempQuestionId, response.question_id);
      }
    } catch (error) {
      console.error('Error submitting question:', error);
      updateQuestion(tempQuestionId, {
        isProcessing: false,
        answer: `Error: ${error.message}`
      });
    }
  };

  // Session-based polling with progressive provenance loading
  const startSessionPolling = (questionId, sessionId, sessionQuestionId) => {
    let currentProvenanceCount = 0;

    const pollInterval = setInterval(async () => {
      try {
        // Check progress
        const progress = await getQuestionProgress(sessionId, sessionQuestionId);
        
        // Update logs
        if (progress.logs) {
          updateQuestion(questionId, { logs: progress.logs });
        }

        // Progressive provenance loading
        if (progress.data && progress.data.length > currentProvenanceCount) {
          const newProvenances = await enhanceSessionProvenanceWithContent(
            sessionId, sessionQuestionId, progress.data.slice(currentProvenanceCount)
          );

          updateQuestion(questionId, (prev) => ({
            provenanceSources: [...(prev.provenanceSources || []), ...newProvenances]
          }));
          
          currentProvenanceCount = progress.data.length;
        }

        // Try to get answer as soon as possible
        if (progress.done || progress.data?.length > 0) {
          try {
            const results = await getQuestionResults(sessionId, sessionQuestionId);
            if (results.success && results.answer) {
              updateQuestion(questionId, { answer: results.answer });
            }
          } catch (error) {
            console.warn('Answer not ready yet');
          }
        }

        // Check if fully complete
        const status = await getQuestionStatus(sessionId, sessionQuestionId);
        if (status.completed) {
          clearInterval(pollInterval);
          updateQuestion(questionId, { isProcessing: false });
        }

      } catch (error) {
        console.error('Session polling error:', error);
        clearInterval(pollInterval);
        updateQuestion(questionId, { isProcessing: false });
      }
    }, 1000);
  };

  // Legacy polling (fallback)
  const startLegacyPolling = (questionId, backendQuestionId) => {
    let currentProvenanceCount = 0;

    const pollInterval = setInterval(async () => {
      try {
        const progress = await checkProgress(backendQuestionId);
        
        if (progress.logs) {
          updateQuestion(questionId, { logs: progress.logs });
        }

        if (progress.data && progress.data.length > currentProvenanceCount) {
          const newProvenances = await enhanceLegacyProvenanceWithContent(
            backendQuestionId, progress.data.slice(currentProvenanceCount)
          );

          updateQuestion(questionId, (prev) => ({
            provenanceSources: [...(prev.provenanceSources || []), ...newProvenances]
          }));
          
          currentProvenanceCount = progress.data.length;
        }

        if (progress.done || progress.data?.length > 0) {
          try {
            const results = await getResults(backendQuestionId);
            if (results.success && results.answer) {
              updateQuestion(questionId, { answer: results.answer });
            }
          } catch (error) {
            console.warn('Answer not ready yet');
          }
        }

        const status = await checkStatus(backendQuestionId);
        if (status.completed) {
          clearInterval(pollInterval);
          updateQuestion(questionId, { isProcessing: false });
        }

      } catch (error) {
        console.error('Legacy polling error:', error);
        clearInterval(pollInterval);
        updateQuestion(questionId, { isProcessing: false });
      }
    }, 1000);
  };

  // Enhanced provenance loading for session-based approach
  const enhanceSessionProvenanceWithContent = async (sessionId, sessionQuestionId, provenanceArray) => {
    if (!Array.isArray(provenanceArray) || provenanceArray.length === 0) {
      return [];
    }

    const allSentenceIds = new Set();
    provenanceArray.forEach(source => {
      if (source.sentences_ids) {
        source.sentences_ids.forEach(id => allSentenceIds.add(id));
      }
    });

    let sentencesData = {};
    if (allSentenceIds.size > 0) {
      try {
        const response = await getQuestionSentences(sessionId, sessionQuestionId, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching session sentences:', error);
      }
    }

    return provenanceArray.map(source => {
      if (!source.sentences_ids || source.sentences_ids.length === 0) {
        return source;
      }

      const content = source.sentences_ids.map(id =>
        sentencesData[id] || `[SENTENCE_${id}_NOT_FOUND]`
      );

      return { ...source, content };
    }).sort((a, b) =>
      (a.provenance_id !== undefined && b.provenance_id !== undefined)
        ? a.provenance_id - b.provenance_id
        : 0
    );
  };

  // Enhanced provenance loading for legacy approach
  const enhanceLegacyProvenanceWithContent = async (backendQuestionId, provenanceArray) => {
    if (!Array.isArray(provenanceArray) || provenanceArray.length === 0) {
      return [];
    }

    const allSentenceIds = new Set();
    provenanceArray.forEach(source => {
      if (source.sentences_ids) {
        source.sentences_ids.forEach(id => allSentenceIds.add(id));
      }
    });

    let sentencesData = {};
    if (allSentenceIds.size > 0) {
      try {
        const response = await fetchSentences(backendQuestionId, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching legacy sentences:', error);
      }
    }

    return provenanceArray.map(source => {
      if (!source.sentences_ids || source.sentences_ids.length === 0) {
        return source;
      }

      const content = source.sentences_ids.map(id =>
        sentencesData[id] || `[SENTENCE_${id}_NOT_FOUND]`
      );

      return { ...source, content };
    }).sort((a, b) =>
      (a.provenance_id !== undefined && b.provenance_id !== undefined)
        ? a.provenance_id - b.provenance_id
        : 0
    );
  };

  // Update question helper
  const updateQuestion = (questionId, updates) => {
    if (!activeDocumentId) return;

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const currentQuestion = doc.questions.get(questionId);
        const newQuestion = typeof updates === 'function'
          ? { ...currentQuestion, ...updates(currentQuestion) }
          : { ...currentQuestion, ...updates };
        doc.questions.set(questionId, newQuestion);
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });
  };

  // Handle provenance selection
  const handleProvenanceSelect = (provenance) => {
    setSelectedProvenance(provenance);
  };

  // Handle feedback
  const handleFeedbackSubmit = (questionId, feedback) => {
    updateQuestion(questionId, { feedback });
    setFeedbackModalOpen(false);
    setSelectedQuestionForFeedback(null);
  };

  const openFeedbackModal = (question) => {
    setSelectedQuestionForFeedback(question);
    setFeedbackModalOpen(true);
  };

  // Handle uploading new document
  const handleUploadNewDocument = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          await handleDocumentUpload(formData);
        } catch (error) {
          console.error('Upload failed:', error);
        }
      }
    };
    fileInput.click();
  };

  // Show loading screen while session is initializing
  if (!sessionReady) {
    return (
      <div className="app-loading">
        <div className="loading-content">
          <div className="loading-spinner">🚀</div>
          <h3>Initializing Session...</h3>
          <p>Setting up your document analysis environment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-improved">
      {/* Header */}
      <Header 
        activeDocument={activeDocument} 
        onShowPreloaded={handleShowPreloaded}
        onUploadDocument={handleUploadNewDocument}
        currentSession={{ session_id: currentSessionId }}
      />

      {process.env.NODE_ENV === 'development' && (
  <>
    <button 
      onClick={debugDocumentLoading}
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: 9999,
        padding: '5px 10px',
        background: '#ff6b6b',
        color: 'white',
        border: 'none',
        borderRadius: '3px',
        fontSize: '12px'
      }}
    >
      Debug Document Loading
    </button>
    
    {showDebugInfo && debugInfo && (
      <div style={{
        position: 'fixed',
        top: '50px',
        right: '10px',
        width: '400px',
        maxHeight: '80vh',
        background: 'white',
        border: '2px solid #333',
        padding: '10px',
        zIndex: 9999,
        overflow: 'auto',
        fontSize: '12px',
        fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h4>Document Loading Debug</h4>
          <button onClick={() => setShowDebugInfo(false)}>✕</button>
        </div>
        <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
      </div>
    )}
  </>
)}
      
      {/* Main Content Grid */}
      <div className="app-content-grid">
        {/* Left Sidebar */}
        <div className="sidebar-panel">
          <Sidebar
            documents={documents}
            activeDocumentId={activeDocumentId}
            onDocumentSelect={setActiveDocumentId}
            onUploadNewDocument={handleUploadNewDocument}
            currentSessionId={currentSessionId}
            onSessionChanged={setCurrentSessionId}
          />
        </div>

        {/* Main Content Area - PDF Viewer */}
        <div className="main-content">
          <div className="pdf-section">
            {activeDocument ? (
              <HybridPDFViewer
                pdfDocument={activeDocument}
                selectedProvenance={selectedProvenance}
                onClose={() => {}}
                currentSession={{ session_id: currentSessionId }}
              />
            ) : (
              <div className="pdf-empty-state">
                <div className="empty-icon">📄</div>
                <h3>Ready to Analyze Documents</h3>
                <p>Upload your own PDF or choose from our preloaded research papers to begin document analysis and provenance extraction.</p>
                
                <div className="pdf-empty-actions">
                  <DocumentSelector
                    onDocumentUpload={handleDocumentUpload}
                    onShowPreloaded={handleShowPreloaded}
                    uploadProgress={uploadProgress}
                    compactMode={false}
                    currentSession={{ session_id: currentSessionId }}
                    disabled={!sessionReady}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Right Panel - Q&A Flow */}
        <div className="right-panel">
          <div className="qa-flow-section">
            {/* Question Collection - Top */}
            <div className="question-section">
              <QuestionCollection
                pdfDocument={activeDocument}
                onQuestionSubmit={addQuestionToDocument}
                currentSession={{ session_id: currentSessionId }}
              />
            </div>
            
            {/* Provenance Navigator - Bottom */}
            <div className="provenance-section">
              <ProvenanceNavigator
                pdfDocument={activeDocument}
                onProvenanceSelect={handleProvenanceSelect}
                onFeedbackRequest={openFeedbackModal}
                onHighlightInPDF={setSelectedProvenance}
                currentSession={{ session_id: currentSessionId }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          session={{
            sessionId: currentSessionId,
            documentName: activeDocument?.filename,
            createdAt: selectedQuestionForFeedback.createdAt,
            completedAt: selectedQuestionForFeedback.isProcessing ? null : new Date(),
            processingTime: selectedQuestionForFeedback.time ||
              (selectedQuestionForFeedback.provenanceSources && selectedQuestionForFeedback.provenanceSources[0]?.time),
            algorithmMethod: 'default',
            userSessionId: currentSessionId
          }}
          question={selectedQuestionForFeedback}
          allProvenances={selectedQuestionForFeedback.provenanceSources || []}
          onSubmit={handleFeedbackSubmit}
          onClose={() => setFeedbackModalOpen(false)}
          currentSession={{ session_id: currentSessionId }}
        />
      )}

      {/* Preloaded Documents Modal */}
      {showPreloadedModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowPreloadedModal(false)}>
          <div className="preloaded-modal">
            <div className="modal-header">
              <h3>📚 Research Papers</h3>
              <button className="close-btn" onClick={() => setShowPreloadedModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {loadingPreloaded ? (
                <div className="loading-state">
                  <p>Loading available research papers...</p>
                </div>
              ) : preloadedDocuments.length > 0 ? (
                <>
                  <p>Choose from our collection of research papers:</p>
                  <div className="documents-grid">
                    {preloadedDocuments.map(doc => (
                      <button
                        key={doc.document_id}
                        className="document-card"
                        onClick={() => handleDocumentSelect(doc)}
                        disabled={loadingPreloaded}
                      >
                        <div className="doc-icon">📄</div>
                        <div className="doc-info">
                          <h4>{doc.filename}</h4>
                          <div className="doc-stats">
                            <span>{Math.round(doc.text_length / 1000)}k chars</span>
                            <span>{doc.sentence_count} sentences</span>
                            <span className="source-badge">
                              {doc.source_folder === 'preloaded' ? '📚' : '📄'}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No preloaded documents are currently available.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;