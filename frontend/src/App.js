import React, { useState, useEffect, useCallback } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import HybridPDFViewer from './components/HybridPDFViewer';
import FeedbackModal from './components/FeedbackModal';
import DocumentSelector from './components/DocumentSelector';
import ProvenanceQA from './components/ProvenanceQA';
import QuestionLibrary from './components/QuestionLibrary';
import userStudyLogger from './services/UserStudyLogger';

import {
  uploadFile,
  getDocuments,
  askQuestion,
  checkAnswer,
  getNextProvenance,
  getQuestionStatus,
  fetchSentences,
  getQuestionsLibrary,
  addQuestionToLibrary,
  removeQuestionFromLibrary
} from './services/api';

function App() {
  const EXPERIMENT_TOP_K = 5;

  // documents state
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [selectedProvenance, setSelectedProvenance] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Question Library state
  const [questionLibraryOpen, setQuestionLibraryOpen] = useState(false);
  const [questionsLibrary, setQuestionsLibrary] = useState(null);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);
  const [preloadedDocuments, setPreloadedDocuments] = useState([]);
  const [loadingPreloaded, setLoadingPreloaded] = useState(false);

  const [navigationTrigger, setNavigationTrigger] = useState(null);

  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;

  // Load questions library on mount
  useEffect(() => {
    loadQuestionsLibrary();
  }, []);

  const loadQuestionsLibrary = async () => {
    try {
      const library = await getQuestionsLibrary();
      if (library.success) {
        setQuestionsLibrary(library.library);
      }
    } catch (error) {
      console.warn('Failed to load questions library:', error);
    }
  };

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

  // Question Library Handlers (simplified)
  const handleQuestionLibrarySelect = async (questionText, questionId) => {
    console.log('📚 Selected question from library:', questionText);

    // Log library question selection
    await userStudyLogger.logQuestionSelectedFromLibrary(questionId, questionText);
    
    setQuestionLibraryOpen(false);

    // The IntegratedQAComponent will handle the submission
    // We just need to pass the question text to it somehow
    // For now, we'll trigger a custom event or use a ref
    if (window.integratedQARef && window.integratedQARef.submitQuestion) {
      window.integratedQARef.submitQuestion(questionText, questionId);
    }
  };

  const handleAddQuestionToLibrary = async (questionText, category = 'Custom', description = '') => {
    try {
      const response = await addQuestionToLibrary({
        question_text: questionText,
        category,
        description,
        is_favorite: false
      });

      if (response.success) {
        // Reload library
        await loadQuestionsLibrary();
        console.log('✅ Question added to library:', questionText);
        return true;
      } else {
        console.error('❌ Failed to add question to library:', response.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to add question to library:', error);
      return false;
    }
  };

  const handleRemoveQuestionFromLibrary = async (questionId) => {
    try {
      const response = await removeQuestionFromLibrary(questionId);

      if (response.success) {
        // Reload library
        await loadQuestionsLibrary();
        console.log('✅ Question removed from library');
        return true;
      } else {
        console.error('❌ Failed to remove question from library:', response.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to remove question from library:', error);
      return false;
    }
  };

  const handleHighlightInPDF = async (provenance) => {
    console.log('🔍 App: Highlighting provenance in PDF:', provenance?.provenance_id);

     // Log PDF highlighting
    if (provenance && activeDocument) {
      await userStudyLogger.logProvenanceHighlighted(
        provenance.questionId || 'unknown',
        provenance.provenance_id || provenance.id,
        1, // You could pass actual page number here
        'automatic'
      );
    }

    // Always update the selected provenance first
    setSelectedProvenance(provenance);

    if (provenance && provenance.sentences_ids?.length > 0) {
      console.log('✨ Triggering highlight for sentences:', provenance.sentences_ids);

      // Scroll to provenance sentence in panel
      setTimeout(() => {
        scrollToProvenanceSentence(provenance);
      }, 300);
    }
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
    // Log library opening
    await userStudyLogger.logUserInteraction(
      'open_document_library',
      'document_selector'
    );
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

   const openQuestionLibrary = async () => {
    await userStudyLogger.logQuestionLibraryOpened();
    setQuestionLibraryOpen(true);
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
      {/* Header */}
       <Header
        activeDocument={activeDocument}
        onShowPreloaded={handleShowDocuments}
        onUploadDocument={async () => {
          await logUserInteraction('upload_button_click', 'header');
          handleUploadNewDocument();
        }}
        onOpenQuestionLibrary={openQuestionLibrary}
        questionsLibrary={questionsLibrary}
      />

      {/* Main Content Grid */}
      <div className="app-content-grid">
        {/* Left Sidebar */}
          <div className="sidebar-panel">
          <Sidebar
            documents={documents}
            activeDocumentId={activeDocumentId}
            onDocumentSelect={async (docId) => {
              await logUserInteraction('document_select', 'sidebar', { document_id: docId });
              setActiveDocumentId(docId);
            }}
            onUploadNewDocument={async () => {
              await logUserInteraction('upload_button_click', 'sidebar');
              handleUploadNewDocument();
            }}
          />
        </div>

        {/* Main Content Area */}
        <div className="main-content">
          <div className="pdf-section">
            {activeDocument ? (
              <HybridPDFViewer
                pdfDocument={activeDocument}
                selectedProvenance={selectedProvenance}
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
            questionsLibrary={questionsLibrary}
            onOpenQuestionLibrary={() => setQuestionLibraryOpen(true)}
            onAddQuestionToLibrary={handleAddQuestionToLibrary}
            onProvenanceSelect={handleProvenanceSelect}
            onFeedbackRequest={openFeedbackModal}
            onHighlightInPDF={handleHighlightInPDF}
            onNavigationTrigger={handleNavigationTrigger}
            ref={(ref) => {
              // Store reference for library integration
              window.integratedQARef = ref;
            }}
          />
        </div>
      </div>

      {/* Question Library Modal */}
        <QuestionLibrary
          isOpen={questionLibraryOpen}
          onClose={async () => {
            await logUserInteraction('close_question_library', 'question_library');
            setQuestionLibraryOpen(false);
          }}
          onQuestionSelect={handleQuestionLibrarySelect}
          onQuestionAdd={handleAddQuestionToLibrary}
          onQuestionRemove={handleRemoveQuestionFromLibrary}
          questionsLibrary={questionsLibrary}
          simplified={true}
        />

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