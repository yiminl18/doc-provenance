import React, { useState, useEffect, useCallback } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';
import HistorySidebar from './components/HistorySidebar';
import Header from './components/Header';
import FeedbackModal from './components/FeedbackModal';
import DocumentSelector from './components/DocumentSelector';
import ProvenanceQA from './components/ProvenanceQA';
import userStudyLogger from './services/UserStudyLogger';
import LayoutBasedPDFViewer from './components/LayoutBasedPDFViewer';
import {
  uploadFile,
  getDocuments,
  askQuestion,
  checkAnswer,
  getNextProvenance,
  getQuestionStatus,
  fetchSentences
} from './services/api';

function App() {
  const EXPERIMENT_TOP_K = 5;

  // documents state
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [selectedProvenance, setSelectedProvenance] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Questions history state (for history sidebar)
  const [questionsHistory, setQuestionsHistory] = useState(new Map());
  const [activeQuestionId, setActiveQuestionId] = useState(null);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);
  const [preloadedDocuments, setPreloadedDocuments] = useState([]);
  const [loadingPreloaded, setLoadingPreloaded] = useState(false);

  const [navigationTrigger, setNavigationTrigger] = useState(null);


  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;


  const createNewDocument = (filename, backendFilename = null) => {
    const docId = `doc_${Date.now()}`;
    const newDoc = {
      id: docId,
      filename,
      backendFilename: backendFilename || filename,
      uploadStatus: {
        success: true,
        message: `${filename} uploaded successfully`
      },
      createdAt: new Date(),
      sentencesLoaded: false,
      sentenceCount: 0
    };

    setDocuments(prev => new Map(prev).set(docId, newDoc));
    setActiveDocumentId(docId);
    return docId;
  };

  // Add this function to update questions from ProvenanceQA
  const updateQuestion = useCallback((questionId, updates) => {
    console.log(`🔄 App: updateQuestion called for ${questionId}:`, updates);

    setQuestionsHistory(prev => {
      const newHistory = new Map(prev);
      const currentQuestion = newHistory.get(questionId);

      if (currentQuestion) {
        const updatedQuestion = { ...currentQuestion, ...updates };
        newHistory.set(questionId, updatedQuestion);
      } else {
        console.error(`❌ Question ${questionId} not found in App's history!`);
      }

      return newHistory;
    });
  }, []);

  // Add this function to add new questions
  const addQuestion = useCallback((questionData) => {
    console.log(`➕ App: Adding new question:`, questionData.id);

    setQuestionsHistory(prev => new Map(prev).set(questionData.id, questionData));
    setActiveQuestionId(questionData.id);
  }, []);

  const handleNavigationTrigger = useCallback((navTrigger) => {
    console.log('🎯 App: Received navigation trigger from ProvenanceQA:', navTrigger);
    setNavigationTrigger(navTrigger);

    // Clear trigger after a delay to prevent re-triggers
    setTimeout(() => {
      setNavigationTrigger(null);
    }, 2000);
  }, []); // Empty dependency array - this function never changes

  const handleDocumentSelect = async (doc_obj) => {

    try {
      setLoadingPreloaded(true);
      console.log('🔄 Loading document:', doc_obj);

      // Log document selection
      await userStudyLogger.logDocumentSelected(
        doc_obj.document_id,
        doc_obj.filename,
        true // isPreloaded = true for session documents
      );

      // Create the frontend document object
      const docId = createNewDocument(doc_obj.filename || false, {
        document_id: doc_obj.document_id,
        text_length: doc_obj.text_length || 0,
        sentence_count: doc_obj.sentence_count || 0
      });

      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(docId);
        if (doc) {
          doc.isSessionDocument = true;
          doc.backendDocumentId = doc_obj.document_id;
          doc.textLength = doc_obj.text_length || 0;
          doc.sentenceCount = doc_obj.sentence_count || 0;
          doc.sourceFolder = doc_obj.source_folder || 'session';
          doc.sentencesLoaded = doc_obj.sentences_available || false;
          // Add session document metadata
          doc.processedAt = document.processed_at;

          newDocs.set(docId, doc);
        }
        return newDocs;
      });

      // Close modal and show success
      if (showPreloadedModal) {
        setShowPreloadedModal(false);
      }

    } catch (error) {
      console.error('❌ Error loading session document:', error);
      alert(`Error loading document: ${error.message}`);
    } finally {
      setLoadingPreloaded(false);
    }
  };

  // History sidebar handlers
  const handleHistoryDocumentSelect = async (docId) => {
    await logUserInteraction('document_select', 'history_sidebar', { document_id: docId });
    setActiveDocumentId(docId);
  };

  const handleHistoryQuestionSelect = async (questionId) => {
    await logUserInteraction('question_select', 'history_sidebar', { question_id: questionId });
    setActiveQuestionId(questionId);

    // Also tell the ProvenanceQA component about this selection
    if (window.integratedQARef && window.integratedQARef.selectQuestion) {
      window.integratedQARef.selectQuestion(questionId);
    }
  };

  const handleHistoryQuestionDelete = async (questionId) => {
    if (window.confirm('Are you sure you want to delete this question from history?')) {
      await logUserInteraction('question_delete', 'history_sidebar', { question_id: questionId });

      setQuestionsHistory(prev => {
        const newHistory = new Map(prev);
        newHistory.delete(questionId);

        // If we deleted the active question, clear active state
        if (questionId === activeQuestionId) {
          setActiveQuestionId(null);
        }

        return newHistory;
      });
    }
  };



  // Document upload with persistence
  const handleDocumentUpload = async (formData) => {
    const fileName = formData.get('file')?.name || 'Unknown file';

    setUploadProgress({
      success: false,
      message: `Uploading: ${fileName}...`
    });

    try {
      const response = await uploadFile(formData);

      if (response.success) {
        // Store both original filename and backend filename
        const docId = createNewDocument(fileName, response.filename);

        // Log document upload
        await userStudyLogger.logDocumentUploaded(
          docId,
          fileName,
          response.metadata?.text_length || 0,
          response.metadata?.sentence_count || 0
        );


        // Update document with metadata from upload
        if (response.metadata) {
          setDocuments(prev => {
            const newDocs = new Map(prev);
            const doc = newDocs.get(docId);
            if (doc) {
              doc.sentenceCount = response.metadata.sentence_count;
              doc.textLength = response.metadata.text_length;
              doc.sentencesLoaded = response.metadata.sentences_available;
              newDocs.set(docId, doc);
            }
            return newDocs;
          });
        }

        setUploadProgress({
          success: true,
          message: `Upload Complete: ${fileName}`
        });

        setTimeout(() => setUploadProgress(null), 3000);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
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


const handleHighlightInPDF = async (provenance) => {
  console.log('🔍 App: Highlighting provenance in PDF:', provenance?.provenance_id);


  // Also update selected provenance for normal highlights
  setSelectedProvenance(provenance);
  

};


  // Function to scroll to specific sentence in provenance panel
  const scrollToProvenanceSentence = (provenance) => {
    if (!provenance?.sentences_ids || provenance.sentences_ids.length === 0) return;

    try {
      const firstSentenceId = provenance.sentences_ids[0];

      // Try multiple selectors to find the sentence element
      const selectors = [
        `[data-sentence-id="${firstSentenceId}"]`,
        `.evidence-sentence[data-sentence-id="${firstSentenceId}"]`,
        `.sentence-text[data-sentence-id="${firstSentenceId}"]`
      ];

      let sentenceElement = null;
      for (const selector of selectors) {
        sentenceElement = document.querySelector(selector);
        if (sentenceElement) break;
      }

      if (sentenceElement) {
        console.log('📜 Scrolling to sentence element:', firstSentenceId);

        // Scroll the sentence into view with smooth animation
        sentenceElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });

        // Add a longer highlight effect for navigation
        sentenceElement.classList.add('sentence-highlight-flash');
        setTimeout(() => {
          sentenceElement.classList.remove('sentence-highlight-flash');
        }, 3000); // Longer highlight duration

      } else {
        console.warn('Could not find sentence element for ID:', firstSentenceId);

        // Fallback: scroll the provenance panel to top
        const provenancePanel = document.querySelector('.current-provenance, .provenance-content');
        if (provenancePanel) {
          provenancePanel.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }
      }

    } catch (error) {
      console.warn('Could not scroll to provenance sentence:', error);
    }
  };

  // Enhanced provenance selection handler that includes scrolling
  const handleProvenanceSelect = async (provenance) => {
    console.log('🎯 App: Provenance selected:', provenance);

    // Log provenance viewing
    if (provenance && activeDocument) {
      await userStudyLogger.logProvenanceViewed(
        provenance.questionId || 'unknown',
        provenance.provenance_id || provenance.id,
        provenance.index || 0
      );
    }

    // Always update the selected provenance
    setSelectedProvenance(provenance);

    if (provenance) {
      console.log('✅ Provenance details:', {
        id: provenance.provenance_id,
        sentences: provenance.sentences_ids?.length || 0,
        hasContent: provenance.content && provenance.content.length > 0,
        processingTime: provenance.time
      });

      // Trigger scrolling behaviors
      setTimeout(() => {
        scrollToProvenanceSentence(provenance);
      }, 100);

    } else {
      console.log('❌ No provenance selected - clearing highlights');
    }
  };

  // Handle feedback
  const handleFeedbackSubmit = async (questionId, feedback) => {

    // The feedback modal already logs the submission, 
    // but we can log the completion here
    await userStudyLogger.logUserInteraction(
      'feedback_completed',
      'feedback_modal',
      { question_id: questionId }
    );

    // Since we're using the IntegratedQAComponent, we'll need to pass this through
    setFeedbackModalOpen(false);
    setSelectedQuestionForFeedback(null);
  };

  const openFeedbackModal = (question) => {
    setSelectedQuestionForFeedback(question);
    setFeedbackModalOpen(true);
  };

  const handleShowDocuments = async () => {

    setLoadingPreloaded(true);
    try {
      const response = await getDocuments();
      console.log('📚 Preloaded documents fetched:', response);
      if (response.success && response.documents) {
        setPreloadedDocuments(response.documents);
      } else {
        setPreloadedDocuments([]);
      }
      setShowPreloadedModal(true);
    } catch (error) {
      console.error('Error fetching session documents:', error);
      setPreloadedDocuments([]);
      setShowPreloadedModal(true);
    } finally {
      setLoadingPreloaded(false);
    }
  };


  // Add user interaction logging for various UI elements
  const logUserInteraction = async (type, element, details = {}) => {
    await userStudyLogger.logUserInteraction(type, element, details);
  };

  // Handle file upload button
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

  // Page/document navigation logging
  useEffect(() => {
    if (activeDocumentId) {
      const activeDoc = documents.get(activeDocumentId);
      if (activeDoc) {
        userStudyLogger.logUserInteraction(
          'document_activated',
          'document_selector',
          {
            document_id: activeDocumentId,
            filename: activeDoc.filename,
            is_preloaded: activeDoc.isSessionDocument || false
          }
        );
      }
    }
  }, [activeDocumentId, documents]);

  // Performance monitoring
  useEffect(() => {
    // Log performance metrics periodically
    const performanceInterval = setInterval(() => {
      if (performance && performance.memory) {
        userStudyLogger.logPerformanceMetric(
          'memory_usage',
          performance.memory.usedJSHeapSize,
          {
            total_heap: performance.memory.totalJSHeapSize,
            heap_limit: performance.memory.jsHeapSizeLimit
          }
        );
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(performanceInterval);
  }, []);

  return (
    <div className="app-improved">
 

      {/* Main Content Grid */}
      <div className="app-content-grid">
      {/* Header */}
      <Header
        activeDocument={activeDocument}
        onShowPreloaded={handleShowDocuments}
        onUploadDocument={async () => {
          await logUserInteraction('upload_button_click', 'header');
          handleUploadNewDocument();
        }}
      />
        {/* Left Sidebar */}
        <div className="sidebar-panel">
          <HistorySidebar
            documents={documents}
            activeDocumentId={activeDocumentId}
            onDocumentUpload={handleDocumentUpload}
            onShowPreloaded={handleShowDocuments}
            onDocumentSelect={handleHistoryDocumentSelect}
            questionsHistory={questionsHistory}        // Same state as ProvenanceQA
            activeQuestionId={activeQuestionId}         // Same state as ProvenanceQA
            onQuestionSelect={setActiveQuestionId}      // Same setter as ProvenanceQA
            onQuestionDelete={handleHistoryQuestionDelete}
            onProvenanceSelect={handleProvenanceSelect}
            onFeedbackRequest={openFeedbackModal}
          />
        </div>

        {/* Main Content Area */}
        <div className="main-content">
          <div className="pdf-section">
            {activeDocument ? (
              <LayoutBasedPDFViewer
                pdfDocument={activeDocument}
                selectedProvenance={selectedProvenance}
                activeQuestionId={activeQuestionId}
                navigationTrigger={navigationTrigger}
                onClose={() => { }}
                />
             
              

            ) : (
              <div className="pdf-empty-state">
                <div className="empty-icon">📄</div>
                <h3>Ready to Analyze Documents</h3>
                <p>Upload a PDF to begin QA and provenance extraction.</p>
                <div className="pdf-empty-actions">
                  <DocumentSelector
                    onDocumentUpload={handleDocumentUpload}
                    onShowPreloaded={handleShowDocuments}
                    uploadProgress={uploadProgress}
                    compactMode={false}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          <ProvenanceQA
            pdfDocument={activeDocument}
            questionsHistory={questionsHistory}  // Pass the history
            activeQuestionId={activeQuestionId}   // Pass active ID
            onQuestionUpdate={updateQuestion}     // Pass update function
            onQuestionAdd={addQuestion}           // Pass add function
            onActiveQuestionChange={setActiveQuestionId}  // Pass setter
            onProvenanceSelect={handleProvenanceSelect}
            onFeedbackRequest={openFeedbackModal}
            onHighlightInPDF={handleHighlightInPDF}
            onNavigationTrigger={handleNavigationTrigger}
            ref={(ref) => {
              window.integratedQARef = ref;
            }}
          />
        </div>
      </div>



      {/* Enhanced Feedback Modal */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          pdfDocument={activeDocument}
          question={selectedQuestionForFeedback}
          allProvenances={selectedQuestionForFeedback.provenanceSources || []}
          onSubmit={handleFeedbackSubmit}
          onClose={async () => {
            await logUserInteraction('close_feedback_modal', 'feedback_modal');
            setFeedbackModalOpen(false);
          }}
        />
      )}

      {/* Preloaded Documents Modal */}
      {showPreloadedModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowPreloadedModal(false)}>
          <div className="preloaded-modal">
            <div className="modal-header">
              <h3>📚 Available Documents</h3>
              <button className="close-btn" onClick={() => setShowPreloadedModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {loadingPreloaded ? (
                <div className="loading-state">
                  <p>Loading available documents...</p>
                </div>
              ) : preloadedDocuments.length > 0 ? (
                <>
                  <p>Choose from documents:</p>
                  <div className="documents-grid">
                    {preloadedDocuments.map(doc => (
                      <button
                        key={doc.filename}
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

                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No documents are currently available.</p>
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