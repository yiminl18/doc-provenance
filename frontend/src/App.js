import React, { useState, useEffect } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';
import './styles/analysis-panel.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ProvenanceOutput from './components/ProvenanceOutput';
import PDFViewer from './components/PDFViewer';
import FeedbackModal from './components/FeedbackModal';
import QuestionCollection from './components/QuestionCollection';
import DocumentSelector from './components/DocumentSelector';
import {
  uploadFile,
  createSession,
  processTextQuestion,
  getTextProcessingProgress,
  getTextProcessingResults,
  getProcessingSentences,
  askQuestion,
  fetchSessionSentences,
  checkSessionProgress,
  getSessionResults,
  checkSessionStatus
} from './services/api';

function App() {
  // Document management
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);

  // UI state
  const [selectedProvenance, setSelectedProvenance] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Provenance display state
  const [currentProvenancePage, setCurrentProvenancePage] = useState(0);
  const [provenancesPerPage] = useState(2);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);

  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;

  // Handle center panel upload - now properly implemented
  const handleCenterUpload = async (formData) => {

    const fileName = formData.get('file')?.name || 'Unknown file';

    setUploadProgress({
      success: false,
      message: `Uploading: ${fileName}...`
    });

    try {
      const response = await uploadFile(formData);

      // Create document with proper data from backend response
      const docId = createNewDocument(response.filename, false, {
        document_id: response.document_id,
        text_length: response.text_length,
        sentence_count: response.sentence_count
      });

      // Update document with upload success status
      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(docId);
        if (doc) {
          doc.uploadStatus = {
            success: true,
            message: response.message || `${response.filename} uploaded successfully`
          };
          doc.backendDocumentId = response.document_id; // Store backend document ID
          doc.textLength = response.text_length;
          doc.sentenceCount = response.sentence_count;
          newDocs.set(docId, doc);
        }
        return newDocs;
      });

      setUploadProgress({
        success: true,
        message: `Upload Complete: ${response.filename}`
      });

      // Clear progress after 3 seconds
      setTimeout(() => setUploadProgress(null), 3000);

      return docId;

    } catch (error) {
      console.error('Upload error:', error);

      setUploadProgress({
        success: false,
        message: `Upload Error: ${error.message}`
      });

      // Clear error after 5 seconds
      setTimeout(() => setUploadProgress(null), 5000);

      throw error;
    }
  };

  // Handle showing preloaded documents
  const handleShowPreloaded = () => {
    setShowPreloadedModal(true);
  };

  // Handle selecting a preloaded document
  const handlePreloadedSelect = (document) => {
    const docId = createNewDocument(document.filename, true);
    setShowPreloadedModal(false);
  };

  // Create new document environment
  const createNewDocument = (filename, isPreLoaded = false, backendData = null) => {
    const docId = `doc_${Date.now()}`;
    const newDoc = {
      id: docId,
      filename,
      questions: new Map(),
      activeQuestionId: null,
      uploadStatus: { success: true, message: isPreLoaded ? `${filename} loaded successfully` : `${filename} uploaded successfully` },
      isPreLoaded,
      createdAt: new Date(),
      // Add backend data if provided
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

  // Add question to active document - updated with proper API integration
  const addQuestionToDocument = async (questionText) => {
    if (!activeDocumentId || !activeDocument) return;

    // Get the backend document ID
    const backendDocumentId = activeDocument.backendDocumentId;
    if (!backendDocumentId) {
      console.error('No backend document ID found');
      return;
    }

    // Generate temporary question ID
    const tempQuestionId = `temp_${Date.now()}`;

    try {


      // Add question to state immediately with processing status
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

      // Create a session first
      const sessionResponse = await createSession();
      const sessionId = sessionResponse.session_id;

      // Submit question to backend with proper IDs
      const response = await processTextQuestion(sessionId, questionText, backendDocumentId);
      const processingSessionId = response.processing_session_id;

      // Update question with real IDs and start polling
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

      // Start polling for results
      startPollingForResults(tempQuestionId, sessionId, processingSessionId);

      setCurrentProvenancePage(0);

    } catch (error) {
      console.error('Error submitting question:', error);
      // Update question with error status
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

  // Start polling for question results
  const startPollingForResults = (questionId, sessionId, processingSessionId) => {
    const pollInterval = setInterval(async () => {
      try {
        const progress = await getTextProcessingProgress(sessionId, processingSessionId);

        // Update logs
        if (progress.logs) {
          updateQuestion(questionId, { logs: progress.logs });
        }

        // Check if completed
        if (progress.done && progress.status === 'completed') {
          clearInterval(pollInterval);

          // Get final results
          const results = await getTextProcessingResults(sessionId, processingSessionId);

          if (results.success && results.provenance) {
            // Fetch sentence content for provenance
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
        // Continue polling unless it's a critical error
      }
    }, 1000);

    // Store interval reference for cleanup
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

  // Enhance provenance with sentence content
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

  // Update question in active document
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
    setSelectedProvenance(provenance);
  };

  // Handle feedback submission
  const handleFeedbackSubmit = (questionId, feedback) => {
    updateQuestion(questionId, { feedback });
    setFeedbackModalOpen(false);
    setSelectedQuestionForFeedback(null);

    console.log('Submitting feedback:', { questionId, feedback });
  };

  // Open feedback modal
  const openFeedbackModal = (question) => {
    setSelectedQuestionForFeedback(question);
    setFeedbackModalOpen(true);
  };

  // Handle uploading new document (replaces "New Question")
  const handleUploadNewDocument = () => {
    // Trigger file input click
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          await handleCenterUpload(formData);
        } catch (error) {
          console.error('Upload failed:', error);
        }
      }
    };
    fileInput.click();
  };

  // Handle re-asking a question
  const handleReaskQuestion = (questionText) => {
    addQuestionToDocument(questionText);
  };

  // Load next batch of provenances
  const loadNextProvenances = () => {
    if (!activeDocument || !activeDocument.activeQuestionId) return;

    const currentQuestion = activeDocument.questions.get(activeDocument.activeQuestionId);
    if (!currentQuestion || !currentQuestion.provenanceSources) return;

    const totalProvenances = currentQuestion.provenanceSources.length;
    const maxPage = Math.ceil(totalProvenances / provenancesPerPage) - 1;

    if (currentProvenancePage < maxPage) {
      setCurrentProvenancePage(prev => prev + 1);
    }
  };

  // Get current provenance slice for display
  const getCurrentProvenances = () => {
    if (!activeDocument || !activeDocument.activeQuestionId) return [];

    const currentQuestion = activeDocument.questions.get(activeDocument.activeQuestionId);
    if (!currentQuestion || !currentQuestion.provenanceSources) return [];

    const startIndex = 0;
    const endIndex = (currentProvenancePage + 1) * provenancesPerPage;

    return currentQuestion.provenanceSources.slice(startIndex, endIndex);
  };

  // Check if more provenances available
  const hasMoreProvenances = () => {
    if (!activeDocument || !activeDocument.activeQuestionId) return false;

    const currentQuestion = activeDocument.questions.get(activeDocument.activeQuestionId);
    if (!currentQuestion || !currentQuestion.provenanceSources) return false;

    const totalProvenances = currentQuestion.provenanceSources.length;
    const shownProvenances = (currentProvenancePage + 1) * provenancesPerPage;

    return shownProvenances < totalProvenances;
  };

  return (
    <div className="app-improved">

      {/* HEADER COMPONENT */}
      <Header activeDocument={activeDocument} theme="muted" />
      {/* MAIN CONTENT GRID */}
      <div className="app-content-grid">

        {/* LEFT SIDEBAR - Document Management Only */}
        <div className="sidebar-panel">
          <Sidebar
            documents={documents}
            activeDocumentId={activeDocumentId}
            onDocumentSelect={setActiveDocumentId}
            onUploadNewDocument={handleUploadNewDocument} // Changed from onNewQuestion
          />
        </div>

        {/* CENTER - PDF VIEWER + DOCUMENT SELECTOR */}
        <div className="pdf-panel">
          {activeDocument ? (
            <>
              {/* PDF Viewer Section - Main document display */}
              <div className="pdf-viewer-section">
                <PDFViewer
                  document={activeDocument}
                  selectedProvenance={selectedProvenance}
                  onClose={() => { }} // No close in this layout
                  isGridMode={true}
                  isMainView={true}
                />
              </div>

              {/* Compact Document Selector - For quick document changes */}
              <div className="document-selector-section compact">
                <DocumentSelector
                  onDocumentUpload={handleCenterUpload}
                  onShowPreloaded={handleShowPreloaded}
                  uploadProgress={uploadProgress}
                  compactMode={true}
                />
              </div>
            </>
          ) : (
            <div className="pdf-empty-state">
              <div className="empty-icon">📄</div>
              <h3>Ready to Analyze Documents</h3>
              <p>Upload your own PDF or choose from our preloaded research papers to begin document analysis and provenance extraction.</p>

              <div className="pdf-empty-actions">
                <DocumentSelector
                  onDocumentUpload={handleCenterUpload}
                  onShowPreloaded={handleShowPreloaded}
                  uploadProgress={uploadProgress}
                  compactMode={false}
                />

                <div className="upload-prompt">
                  💡 Start by selecting a document to analyze
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT - QUESTION INPUT + ANALYSIS RESULTS */}
        <div className="analysis-panel">
          {activeDocument ? (
            <>
              {/* Question Input Section - Primary interaction area */}
              <div className="question-input-section">
                <div className="section-header">
                  <h3>
                    <span aria-hidden="true">❓</span>
                    Ask Questions
                  </h3>
                </div>

                <QuestionCollection
                  document={activeDocument}
                  onQuestionSubmit={addQuestionToDocument}
                  onReaskQuestion={handleReaskQuestion}
                />
              </div>

              {/* Analysis Results Section - Answer + provenance display */}
              <div className="analysis-results-section">
                <div className="section-header">
                  <h3>
                    <span aria-hidden="true">📊</span>
                    Analysis Results
                  </h3>
                  {activeDocument && (
                    <div className="question-count" aria-label={`${Array.from(activeDocument.questions.values()).length} questions`}>
                      {Array.from(activeDocument.questions.values()).length}
                    </div>
                  )}
                </div>
                <div className="provenance-content">
                  <ProvenanceOutput
                    document={activeDocument}
                    currentProvenances={getCurrentProvenances()}
                    onProvenanceSelect={handleProvenanceSelect}
                    onFeedbackRequest={openFeedbackModal}
                    onLoadNextProvenances={loadNextProvenances}
                    hasMoreProvenances={hasMoreProvenances()}
                    remainingCount={
                      activeDocument && activeDocument.activeQuestionId
                        ? Math.max(0, (activeDocument.questions.get(activeDocument.activeQuestionId)?.provenanceSources?.length || 0) - ((currentProvenancePage + 1) * provenancesPerPage))
                        : 0
                    }
                    compactMode={true}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="analysis-empty">
              <div className="empty-icon">🤔</div>
              <h3>Ready for Questions</h3>
              <p>Upload a document to start asking questions and analyzing provenance.</p>
            </div>
          )}
        </div>
      </div>

      {/* FEEDBACK MODAL */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          // Create proper session object with all needed data
          session={{
            sessionId: selectedQuestionForFeedback.sessionId,
            processingSessionId: selectedQuestionForFeedback.processingSessionId,
            documentName: activeDocument?.filename,
            createdAt: selectedQuestionForFeedback.createdAt,
            completedAt: selectedQuestionForFeedback.isProcessing ? null : new Date(),
            processingTime: selectedQuestionForFeedback.time ||
              (selectedQuestionForFeedback.provenanceSources && selectedQuestionForFeedback.provenanceSources[0]?.time),
            algorithmMethod: 'default', // You can track this based on your algorithm selection
            userSessionId: `user_${Date.now()}` // Generate or track user session
          }}
          question={selectedQuestionForFeedback}
          // Pass actual provenance data
          allProvenances={selectedQuestionForFeedback.provenanceSources || []}
          onSubmit={handleFeedbackSubmit}
          onClose={() => setFeedbackModalOpen(false)}
        />
      )}

      {/* PRELOADED DOCUMENTS MODAL */}
      {showPreloadedModal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setShowPreloadedModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="preloaded-modal-title"
        >
          <div className="preloaded-modal">
            <div className="modal-header">
              <h3 id="preloaded-modal-title">
                <span aria-hidden="true">📚</span>
                Research Papers
              </h3>
              <button
                className="close-btn"
                onClick={() => setShowPreloadedModal(false)}
                aria-label="Close modal"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <div className="modal-body">
              <p>Choose from our collection of research papers:</p>
              <div className="documents-grid" role="list">
                {[
                  {
                    id: 1,
                    title: "What Goes Around Comes Around",
                    description: "Database evolution research paper examining 20 years of data model developments",
                    pages: 24
                  },
                  {
                    id: 2,
                    title: "Machine Learning Systems",
                    description: "Modern ML architecture survey covering distributed training and inference",
                    pages: 18
                  },
                  {
                    id: 3,
                    title: "Data Privacy in the Cloud",
                    description: "Privacy-preserving techniques for cloud-based data processing",
                    pages: 32
                  }
                ].map(doc => (
                  <button
                    key={doc.id}
                    className="document-card"
                    onClick={() => handlePreloadedSelect(doc)}
                    role="listitem"
                    aria-describedby={`doc-desc-${doc.id}`}
                  >
                    <div className="doc-icon" aria-hidden="true">📄</div>
                    <div className="doc-info">
                      <h4>{doc.title}</h4>
                      <p id={`doc-desc-${doc.id}`}>{doc.description}</p>
                      <span className="doc-pages" aria-label={`${doc.pages} pages`}>
                        {doc.pages} pages
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;