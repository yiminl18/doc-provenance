import React, { useState, useEffect } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ProvenanceNavigator from './components/ProvenanceNavigator';
import PDFJSViewer from './components/PDFViewer'
import FeedbackModal from './components/FeedbackModal';
import DocumentSelector from './components/DocumentSelector';
import {
  uploadFile,
  createSession,
  processTextQuestion,
  getTextProcessingProgress,
  getTextProcessingResults,
  getProcessingSentences,
} from './services/api';

function App() {
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

  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;


  // Handle showing preloaded documents
  const handleShowPreloaded = () => {
    setLoadingPreloaded(true);
    import('./services/api').then(({ getPreloadedDocuments }) => {
      getPreloadedDocuments()
        .then(response => {
          if (response.success && response.documents) {
            setPreloadedDocuments(response.documents);
          } else {
            setPreloadedDocuments([
              {
                document_id: 'preloaded_1',
                filename: 'whatgoesaround-sigmodrec2024.pdf',
          
                text_length: 85000,
                sentence_count: 450,
                is_preloaded: true
              }
            ]);
          }
          setShowPreloadedModal(true);
        })
        .catch(error => {
          console.error('Error fetching preloaded documents:', error);
          setPreloadedDocuments([]);
          setShowPreloadedModal(true);
        })
        .finally(() => {
          setLoadingPreloaded(false);
        });
    });
  };

 // Update these functions in your App.js

const handlePreloadedSelect = async (document) => {
  try {
    setLoadingPreloaded(true);
    console.log('🔄 Loading preloaded document:', document);
    
    const { loadPreloadedDocument } = await import('./services/api');
    const response = await loadPreloadedDocument(document.document_id);

    if (response.success) {
      console.log('✅ Preloaded document loaded successfully:', response);
      
      const docId = createNewDocument(document.filename, true, {
        document_id: document.document_id,
        text_length: document.text_length || response.text_length,
        sentence_count: document.sentence_count || response.sentence_count
      });

      // Update the document with additional metadata needed for PDF viewing
      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(docId);
        if (doc) {
          doc.isPreloaded = true;
          doc.isPreLoaded = true; // Support both naming conventions
          doc.backendDocumentId = document.document_id; // This is crucial for PDF serving
          doc.textLength = document.text_length || response.text_length;
          doc.sentenceCount = document.sentence_count || response.sentence_count;
          
          console.log('📄 Updated document object:', {
            id: doc.id,
            filename: doc.filename,
            backendDocumentId: doc.backendDocumentId,
            isPreloaded: doc.isPreloaded
          });
          
          newDocs.set(docId, doc);
        }
        return newDocs;
      });

      setShowPreloadedModal(false);
    } else {
      console.error('❌ Failed to load preloaded document:', response);
      throw new Error(response.error || 'Failed to load preloaded document');
    }
  } catch (error) {
    console.error('Error loading preloaded document:', error);
    
    // Show error to user but still allow fallback
    alert(`Error loading document: ${error.message}`);
    
    // Create document anyway for fallback handling
    const docId = createNewDocument(document.filename, true, {
      document_id: document.document_id,
      text_length: document.text_length,
      sentence_count: document.sentence_count
    });
    
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.isPreloaded = true;
        doc.backendDocumentId = document.document_id;
        doc.uploadStatus = {
          success: false,
          message: `Error loading ${document.filename}: ${error.message}`
        };
        newDocs.set(docId, doc);
      }
      return newDocs;
    });
    
    setShowPreloadedModal(false);
  } finally {
    setLoadingPreloaded(false);
  }
};

// Also update the createNewDocument function to better handle document IDs
const createNewDocument = (filename, isPreLoaded = false, backendData = null) => {
  const docId = `doc_${Date.now()}`;
  const newDoc = {
    id: docId,
    filename,
    questions: new Map(),
    activeQuestionId: null,
    uploadStatus: { 
      success: true, 
      message: isPreLoaded ? `${filename} loaded successfully` : `${filename} uploaded successfully` 
    },
    isPreLoaded,
    isPreloaded: isPreLoaded, // Support both naming conventions
    createdAt: new Date(),
    ...(backendData && {
      backendDocumentId: backendData.document_id,
      textLength: backendData.text_length,
      sentenceCount: backendData.sentence_count
    })
  };

  console.log('📄 Creating new document:', {
    id: newDoc.id,
    filename: newDoc.filename,
    backendDocumentId: newDoc.backendDocumentId,
    isPreloaded: newDoc.isPreloaded
  });

  setDocuments(prev => new Map(prev).set(docId, newDoc));
  setActiveDocumentId(docId);
  return docId;
};

// Update the handleDocumentUpload function too
const handleDocumentUpload = async (formData) => {
  const fileName = formData.get('file')?.name || 'Unknown file';

  setUploadProgress({
    success: false,
    message: `Uploading: ${fileName}...`
  });

  try {
    console.log('🔄 Uploading document:', fileName);
    const response = await uploadFile(formData);
    console.log('✅ Upload response:', response);

    const docId = createNewDocument(response.filename, false, {
      document_id: response.document_id,
      text_length: response.text_length,
      sentence_count: response.sentence_count
    });

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.uploadStatus = {
          success: true,
          message: response.message || `${response.filename} uploaded successfully`
        };
        doc.backendDocumentId = response.document_id;
        doc.textLength = response.text_length;
        doc.sentenceCount = response.sentence_count;
        
        console.log('📄 Updated uploaded document:', {
          id: doc.id,
          filename: doc.filename,
          backendDocumentId: doc.backendDocumentId
        });
        
        newDocs.set(docId, doc);
      }
      return newDocs;
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

  // Add question to active document
  const addQuestionToDocument = async (questionText) => {
    if (!activeDocumentId || !activeDocument) return;

    const backendDocumentId = activeDocument.backendDocumentId;
    if (!backendDocumentId) {
      console.error('No backend document ID found');
      return;
    }

    const tempQuestionId = `temp_${Date.now()}`;

    try {
      const questionData = {
        id: tempQuestionId,
        text: questionText,
        answer: null,
        provenanceSources: [],
        isProcessing: true,
        logs: [],
        feedback: null,
        createdAt: new Date()
      };

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

      const sessionResponse = await createSession();
      const sessionId = sessionResponse.session_id;

      const response = await processTextQuestion(sessionId, questionText, backendDocumentId);
      const processingSessionId = response.processing_session_id;

      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(activeDocumentId);
        if (doc && doc.questions.has(tempQuestionId)) {
          const question = doc.questions.get(tempQuestionId);
          question.sessionId = sessionId;
          question.processingSessionId = processingSessionId;
          newDocs.set(activeDocumentId, doc);
        }
        return newDocs;
      });

      startPollingForResults(tempQuestionId, sessionId, processingSessionId);

    } catch (error) {
      console.error('Error submitting question:', error);
      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(activeDocumentId);
        if (doc && doc.questions.has(tempQuestionId)) {
          const question = doc.questions.get(tempQuestionId);
          question.isProcessing = false;
          question.answer = `Error: ${error.message}`;
          newDocs.set(activeDocumentId, doc);
        }
        return newDocs;
      });
    }
  };

  // Start polling for results
  const startPollingForResults = (questionId, sessionId, processingSessionId) => {
    const pollInterval = setInterval(async () => {
      try {
        const progress = await getTextProcessingProgress(sessionId, processingSessionId);

        if (progress.logs) {
          updateQuestion(questionId, { logs: progress.logs });
        }

        if (progress.done && progress.status === 'completed') {
          clearInterval(pollInterval);

          const results = await getTextProcessingResults(sessionId, processingSessionId);

          if (results.success && results.provenance) {
            const enhancedProvenance = await enhanceProvenanceWithContent(
              sessionId,
              processingSessionId,
              results.provenance
            );

            updateQuestion(questionId, {
              isProcessing: false,
              answer: results.answer || "Analysis completed - see provenance evidence below",
              provenanceSources: enhancedProvenance
            });
          } else {
            updateQuestion(questionId, {
              isProcessing: false,
              answer: "Processing completed but no results available"
            });
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 1000);

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const question = doc.questions.get(questionId);
        question.pollInterval = pollInterval;
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });
  };

  // Enhance provenance with content
  const enhanceProvenanceWithContent = async (sessionId, processingSessionId, provenanceArray) => {
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
        const response = await getProcessingSentences(sessionId, processingSessionId, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching sentences:', error);
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

  // Update question
  const updateQuestion = (questionId, updates) => {
    if (!activeDocumentId) return;

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const question = { ...doc.questions.get(questionId), ...updates };
        doc.questions.set(questionId, question);
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });
  };

  // Handle provenance selection
  const handleProvenanceSelect = (provenance) => {
    console.log('Provenance selected:', provenance);
    setSelectedProvenance(provenance);
  };

  // Handle highlighting in PDF
  const handleHighlightInPDF = (provenance) => {
    console.log('Highlighting provenance in PDF:', provenance);
    setSelectedProvenance(provenance);
    // The PDFViewer will handle the actual highlighting
  };

  // Handle feedback
  const handleFeedbackSubmit = (questionId, feedback) => {
    updateQuestion(questionId, { feedback });
    setFeedbackModalOpen(false);
    setSelectedQuestionForFeedback(null);
    console.log('Submitting feedback:', { questionId, feedback });
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

  return (
    <div className="app-improved">
      {/* Streamlined Header */}
      <Header 
        activeDocument={activeDocument} 
        onShowPreloaded={handleShowPreloaded}
      />
      
      {/* Main Content Grid */}
      <div className="app-content-grid">
        {/* Left Sidebar */}
        <div className="sidebar-panel">
          <Sidebar
            documents={documents}
            activeDocumentId={activeDocumentId}
            onDocumentSelect={setActiveDocumentId}
            onUploadNewDocument={handleUploadNewDocument}
          />
        </div>

        {/* Main Content Area */}
        <div className="main-content">
          {/* PDF Section */}
          <div className="pdf-section">
            {activeDocument ? (
              <PDFJSViewer
                document={activeDocument}
                selectedProvenance={selectedProvenance}
                onClose={() => {}}
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
                  />
                </div>
              </div>
            )}
          </div>

          {/* Q&A Flow Section */}
          <div className="qa-flow-section">
            <ProvenanceNavigator
              document={activeDocument}
              onQuestionSubmit={addQuestionToDocument}
              onProvenanceSelect={handleProvenanceSelect}
              onFeedbackRequest={openFeedbackModal}
              onHighlightInPDF={handleHighlightInPDF}
            />
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          session={{
            sessionId: selectedQuestionForFeedback.sessionId,
            processingSessionId: selectedQuestionForFeedback.processingSessionId,
            documentName: activeDocument?.filename,
            createdAt: selectedQuestionForFeedback.createdAt,
            completedAt: selectedQuestionForFeedback.isProcessing ? null : new Date(),
            processingTime: selectedQuestionForFeedback.time ||
              (selectedQuestionForFeedback.provenanceSources && selectedQuestionForFeedback.provenanceSources[0]?.time),
            algorithmMethod: 'default',
            userSessionId: `user_${Date.now()}`
          }}
          question={selectedQuestionForFeedback}
          allProvenances={selectedQuestionForFeedback.provenanceSources || []}
          onSubmit={handleFeedbackSubmit}
          onClose={() => setFeedbackModalOpen(false)}
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
                        onClick={() => handlePreloadedSelect(doc)}
                        disabled={loadingPreloaded}
                      >
                        <div className="doc-icon">📄</div>
                        <div className="doc-info">
                          <h4>{doc.filename}</h4>
                          <div className="doc-stats">
                            <span>{Math.round(doc.text_length / 1000)}k chars</span>
                            <span>{doc.sentence_count} sentences</span>
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