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

// Import the simple original API functions
import {
  uploadFile,
  getDocuments,
  askQuestion,
  checkProgress,
  getResults,
  fetchSentences,
  checkStatus
} from './services/api';

function App() {
  const EXPERIMENT_TOP_K = 5;
  
  // Simplified state - no sessions
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [selectedProvenance, setSelectedProvenance] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);
  const [preloadedDocuments, setPreloadedDocuments] = useState([]);
  const [loadingPreloaded, setLoadingPreloaded] = useState(false);

  // Get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;

  // Simplified document creation - no backend document ID needed
  const createNewDocument = (filename, backendFilename = null) => {
    const docId = `doc_${Date.now()}`;
    const newDoc = {
      id: docId,
      filename,
      backendFilename: backendFilename || filename,
      questions: new Map(),
      activeQuestionId: null,
      uploadStatus: {
        success: true,
        message: `${filename} uploaded successfully`
      },
      createdAt: new Date(),
      stats: {
        totalQuestions: 0,
        totalProvenances: 0,
        avgProcessingTime: 0
      }
    };

    setDocuments(prev => new Map(prev).set(docId, newDoc));
    setActiveDocumentId(docId);
    return docId;
  };

const handleDocumentSelect = async (document) => {
 
  try {
    setLoadingPreloaded(true);
    console.log('🔄 Loading document:', document);

    // Create the frontend document object
    const docId = createNewDocument(document.filename || false, {
      document_id: document.document_id,
      text_length: document.text_length || 0,
      sentence_count: document.sentence_count || 0
    });

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.isSessionDocument = true;
        doc.backendDocumentId = document.document_id;
        doc.textLength = document.text_length || 0;
        doc.sentenceCount = document.sentence_count || 0;
        doc.sourceFolder = document.source_folder || 'session';

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
        createNewDocument(fileName, response.filename);
        
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

  // Update questions with persistence
  const updateQuestion = (questionId, updates) => {
    if (!activeDocumentId) return {};

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const currentQuestion = doc.questions.get(questionId);
        
        // Clean up polling if question is completing
        if (updates && typeof updates === 'object' && 'isProcessing' in updates && !updates.isProcessing) {
          if (currentQuestion.pollInterval) {
            clearInterval(currentQuestion.pollInterval);
          }
        }

        const newQuestion = typeof updates === 'function'
          ? { ...currentQuestion, ...updates(currentQuestion) }
          : { ...currentQuestion, ...updates };

        doc.questions.set(questionId, newQuestion);
        
        // Update document stats
        const questions = Array.from(doc.questions.values());
        doc.stats = {
          totalQuestions: questions.length,
          totalProvenances: questions.reduce((acc, q) => acc + (q.provenanceSources?.length || 0), 0),
          avgProcessingTime: questions
            .filter(q => q.processingTime)
            .reduce((acc, q, _, arr) => acc + q.processingTime / arr.length, 0)
        };
        
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });

    // Return current question for chaining
    const doc = documents.get(activeDocumentId);
    return doc?.questions.get(questionId) || {};
  };

  // Enhanced provenance loading with content
  const enhanceProvenanceWithContent = async (backendQuestionId, provenanceArray) => {
    if (!Array.isArray(provenanceArray) || provenanceArray.length === 0) {
      return [];
    }

    // Limit to top-K
    const limitedProvenance = provenanceArray.slice(0, EXPERIMENT_TOP_K);

    // Collect all sentence IDs
    const allSentenceIds = new Set();
    limitedProvenance.forEach(source => {
      if (source.sentences_ids) {
        source.sentences_ids.forEach(id => allSentenceIds.add(id));
      }
    });

    // Fetch sentences
    let sentencesData = {};
    if (allSentenceIds.size > 0) {
      try {
        const response = await fetchSentences(activeDocument.filename, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching sentences:', error);
      }
    }

    // Enhance provenance with content
    return limitedProvenance.map(source => {
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

   // Polling with persistence
  const startPolling = (questionId, backendQuestionId) => {
    let pollCount = 0;
    const maxPolls = 300;
    const startTime = Date.now();

    const pollInterval = setInterval(async () => {
      try {
        pollCount++;

        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          updateQuestion(questionId, {
            isProcessing: false,
            processingStatus: 'timeout',
            userMessage: 'Processing took too long. Please try a more specific question.',
            processingTime: (Date.now() - startTime) / 1000
          });
          return;
        }

        const progress = await checkProgress(backendQuestionId);

        if (progress.logs) {
          updateQuestion(questionId, { logs: progress.logs });
        }

        if (progress.data && progress.data.length > 0) {
          const enhancedProvenance = await enhanceProvenanceWithContent(
            activeDocumentId.filename, progress.data
          );
          updateQuestion(questionId, { provenanceSources: enhancedProvenance });
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

        /*const status = await checkStatus(backendQuestionId);
        if (status.completed) {
          clearInterval(pollInterval);
          
          const finalResults = await getResults(backendQuestionId);
          if (finalResults.success) {
            const finalProvenance = await enhanceProvenanceWithContent(
              activeDocument.filename, finalResults.provenance || []
            );
            
            updateQuestion(questionId, {
              isProcessing: false,
              processingStatus: 'completed',
              answer: finalResults.answer || null,
              provenanceSources: finalProvenance,
              processingTime: (Date.now() - startTime) / 1000,
              backendQuestionId // Store for potential re-queries
            });
          }
        }*/

      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(pollInterval);
        updateQuestion(questionId, {
          isProcessing: false,
          processingStatus: 'error',
          userMessage: `Processing error: ${error.message}`,
          processingTime: (Date.now() - startTime) / 1000
        });
      }
    }, 1000);

    updateQuestion(questionId, { pollInterval });
  };

   // Question submission with persistence and duplicate detection
  const addQuestionToDocument = async (questionText) => {
    if (!activeDocumentId || !activeDocument) {
      throw new Error('No active document selected. Please select a document first.');
    }

    return await submitNewQuestion(questionText);
  };

   // Core question submission logic
  const submitNewQuestion = async (questionText) => {
    const questionId = `q_${Date.now()}`;
    const startTime = Date.now();

    const questionData = {
      id: questionId,
      text: questionText,
      answer: null,
      provenanceSources: [],
      isProcessing: true,
      logs: [`[${new Date().toLocaleTimeString()}] Processing started: ${questionText}`],
      createdAt: new Date(),
      processingStatus: 'processing',
      userMessage: null,
      backendQuestionId: null
    };

    // Add to UI immediately
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc) {
        doc.questions.set(questionId, questionData);
        doc.activeQuestionId = questionId;
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });

    try {
      console.log('🔄 App: Submitting question to backend:', questionText);
      console.log('📄 App: Using backend filename:', activeDocument.filename);
      
      // Call the original working API
      const response = await askQuestion(questionText, activeDocument.filename);
      
      if (response.success && response.question_id) {
        console.log('✅ App: Question submitted successfully, backend ID:', response.question_id);
        
        // Update with backend question ID and start polling
        updateQuestion(questionId, { 
          backendQuestionId: response.question_id,
          logs: [...questionData.logs, `[${new Date().toLocaleTimeString()}] Backend question ID: ${response.question_id}`]
        });
        
        startPolling(questionId, response.question_id);
        return questionId;
      } else {
        throw new Error(response.error || 'Failed to submit question to backend');
      }

    } catch (error) {
      console.error('❌ App: Question submission failed:', error);
      
      const processingTime = (Date.now() - startTime) / 1000;
      updateQuestion(questionId, {
        isProcessing: false,
        processingStatus: 'error',
        userMessage: error.message,
        processingTime,
        logs: [...questionData.logs, `[${new Date().toLocaleTimeString()}] Error: ${error.message}`]
      });
      
      throw error; // Re-throw so UI can handle it
    }
  };

  // Re-ask functionality
  const reaskQuestion = async (originalQuestion) => {
    console.log('🔄 App: Re-asking question:', originalQuestion.text);
    
    try {
      await submitNewQuestion(originalQuestion.text);
      console.log('✅ App: Question re-asked successfully');
    } catch (error) {
      console.error('❌ App: Failed to re-ask question:', error);
      // Error is already handled in submitNewQuestion, so we don't need to do anything else
    }
  };

// Enhanced function to handle both highlight and provenance selection with scrolling
const handleHighlightInPDF = (provenance) => {
  console.log('🔍 App: Highlighting provenance in PDF:', provenance?.provenance_id);

  // Always update the selected provenance first
  setSelectedProvenance(provenance);

  if (provenance && provenance.sentences_ids?.length > 0) {
    console.log('✨ Triggering highlight for sentences:', provenance.sentences_ids);

    // Only scroll to the relevant page in PDF viewer - don't update document state
    scrollToProvenancePage(provenance);

    // Scroll to the relevant sentence in provenance panel (with small delay)
    setTimeout(() => {
      scrollToProvenanceSentence(provenance);
    }, 300);
  }
};

// Function to scroll PDF viewer to the page containing the provenance
const scrollToProvenancePage = (provenance) => {
  if (!provenance?.sentences_ids || !activeDocument) return;

  try {
    // Get the first sentence ID to find its page
    const firstSentenceId = provenance.sentences_ids[0];

    // This will be handled by the HybridPDFViewer component
    // We'll pass additional props to trigger page navigation
    console.log('📖 Requesting page navigation for sentence:', firstSentenceId);

    // Set a flag to trigger page navigation in PDF viewer - but use a ref or different mechanism
    // to avoid triggering useEffect loops
    if (window.pdfViewerRef) {
      window.pdfViewerRef.navigateToSentence?.(firstSentenceId);
    }

  } catch (error) {
    console.warn('Could not scroll to provenance page:', error);
  }
};

// Function to scroll to specific sentence in provenance panel
const scrollToProvenanceSentence = (provenance) => {
  if (!provenance?.sentences_ids || provenance.sentences_ids.length === 0) return;

  try {
    const firstSentenceId = provenance.sentences_ids[0];

    // Try to find the sentence element in the provenance panel
    const sentenceElement = document.querySelector(`[data-sentence-id="${firstSentenceId}"]`);

    if (sentenceElement) {
      console.log('📜 Scrolling to sentence element:', firstSentenceId);

      // Scroll the sentence into view with smooth animation
      sentenceElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      // Add a temporary highlight effect
      sentenceElement.classList.add('sentence-highlight-flash');
      setTimeout(() => {
        sentenceElement.classList.remove('sentence-highlight-flash');
      }, 2000);

    } else {
      console.warn('Could not find sentence element for ID:', firstSentenceId);

      // Fallback: try to scroll the provenance panel to top
      const provenancePanel = document.querySelector('.sentence-content');
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
const handleProvenanceSelect = (provenance) => {
  console.log('🎯 App: Provenance selected:', provenance);

  // Always update the selected provenance
  setSelectedProvenance(provenance);

  if (provenance) {
    console.log('✅ Provenance details:', {
      id: provenance.provenance_id,
      sentences: provenance.sentences_ids?.length || 0,
      hasContent: provenance.content && provenance.content.length > 0,
      processingTime: provenance.time
    });

    // Trigger scrolling behaviors but don't update document navigation state
    setTimeout(() => {
      scrollToProvenancePage(provenance);
      scrollToProvenanceSentence(provenance);
    }, 100);

  } else {
    console.log('❌ No provenance selected - clearing highlights');
  }
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

  const handleShowDocuments = async () => {
  
  setLoadingPreloaded(true);
  try {
    const response = await getDocuments();
    console.log('📚 Preloaded documents fetched:', response);
    if (response.success && response.documents) {
      setPreloadedDocuments(response.documents);  // Keeping same state name for UI compatibility
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      documents.forEach((doc) => {
        doc.questions.forEach((question) => {
          if (question.pollInterval) {
            clearInterval(question.pollInterval);
          }
        });
      });
    };
  }, []);

  return (
    <div className="app-improved">
      {/* Header */}
      <Header
        activeDocument={activeDocument}
        onShowPreloaded={handleShowDocuments}
        onUploadDocument={handleUploadNewDocument}
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
          <div className="pdf-section">
            {activeDocument ? (
              <HybridPDFViewer
                pdfDocument={activeDocument}
                selectedProvenance={selectedProvenance}
                onClose={() => {}}
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
          <div className="qa-flow-section">
            <div className="question-section">
              <QuestionCollection
                pdfDocument={activeDocument}
                onQuestionSubmit={addQuestionToDocument}
                onReaskQuestion={reaskQuestion}
              />
            </div>

            <div className="provenance-section">
              <ProvenanceNavigator
                pdfDocument={activeDocument}
                onProvenanceSelect={handleProvenanceSelect}
                onFeedbackRequest={openFeedbackModal}
                onHighlightInPDF={handleHighlightInPDF}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          activeDocument={activeDocument}
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