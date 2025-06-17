import React, { useState, useEffect, useCallback } from 'react';
import './styles/brutalist-design.css';
import './styles/layout.css';
import HistorySidebar from './components/HistorySidebar';
import Header from './components/Header';
import FeedbackModal from './components/FeedbackModal';
import DocumentSelector from './components/DocumentSelector';
import ProvenanceQA from './components/ProvenanceQA';
import QuestionHistory from './components/QuestionHistory';
import PDFViewer from './components/PDFViewer';
import ReactPDFViewer from './components/ReactPDFViewer';
import DocumentSelectionModal from './components/DocumentSelectionModal';
//import LayoutBasedPDFViewer from './components/LayoutBasedPDFViewer';
import DriveFileBrowser from './components/DriveFileBrowser';
import QuestionSuggestionsModal from './components/QuestionSuggestionsModal';
import {
  uploadFile,
  getDocuments,
  askQuestion,
  getSentenceItemMappings,
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

  // Questions history state (for history sidebar)
  const [questionsHistory, setQuestionsHistory] = useState(new Map());
  const [activeQuestionId, setActiveQuestionId] = useState(null);

  // Modal state
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [selectedQuestionForFeedback, setSelectedQuestionForFeedback] = useState(null);
  const [showPreloadedModal, setShowPreloadedModal] = useState(false);
  const [preloadedDocuments, setPreloadedDocuments] = useState([]);
  const [loadingPreloaded, setLoadingPreloaded] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showQuestionSuggestions, setShowQuestionSuggestions] = useState(false);
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
      //await userStudyLogger.logDocumentSelected(
      //  doc_obj.document_id,
      //  doc_obj.filename,
      //  true // isPreloaded = true for session documents
      //);

      // Create the frontend document object
      const docId = createNewDocument(doc_obj.filename || false, {
        document_id: doc_obj.document_id,
        text_length: doc_obj.text_length || 0,
        sentence_count: doc_obj.sentence_count || 0
      });

      console.log('🧹 Clearing questions before loading new document');
      setQuestionsHistory(new Map());
      setActiveQuestionId(null);
      setSelectedProvenance(null);
      setNavigationTrigger(null);

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

  // Add this new useEffect to handle question switching and provenance management
  useEffect(() => {
    console.log(`🔄 Active question changed to: ${activeQuestionId}`);

    if (!activeQuestionId) {
      // No active question - clear provenance
      console.log('❌ No active question - clearing provenance');
      setSelectedProvenance(null);
      return;
    }

    // Get the current question data
    const currentQuestion = questionsHistory.get(activeQuestionId);

    if (!currentQuestion) {
      // Question not found - clear provenance
      console.log('❌ Question not found in history - clearing provenance');
      setSelectedProvenance(null);
      return;
    }

    // Check if this question has any provenance sources
    if (currentQuestion.provenanceSources && currentQuestion.provenanceSources.length > 0) {
      // Question has provenance - restore the last viewed one (or first one)
      const lastViewedProvenance = currentQuestion.lastViewedProvenance || currentQuestion.provenanceSources[0];
      console.log(`✅ Restoring provenance for question ${activeQuestionId}:`, lastViewedProvenance?.provenance_id);
      setSelectedProvenance(lastViewedProvenance);
    } else {
      // Question has no provenance yet - clear it
      console.log(`⚪ Question ${activeQuestionId} has no provenance yet - clearing`);
      setSelectedProvenance(null);
    }
  }, [activeQuestionId, questionsHistory]);

  useEffect(() => {
    if (activeDocumentId) {
      const activeDoc = documents.get(activeDocumentId);

      // Check if this is actually a new document (not just a re-selection)
      const previousDocumentId = localStorage.getItem('lastActiveDocumentId');

      if (activeDoc && activeDocumentId !== previousDocumentId) {
        console.log('📄 New document activated, clearing questions history');

        // Clear all questions and reset active question
        setQuestionsHistory(new Map());
        setActiveQuestionId(null);

        // Clear any selected provenance
        setSelectedProvenance(null);

        // Clear navigation and highlight triggers
        setNavigationTrigger(null);

        // Store the current document ID for future comparisons
        localStorage.setItem('lastActiveDocumentId', activeDocumentId);

        console.log('✅ Questions and provenance cleared for new document:', activeDoc.filename);
      }
    }
  }, [activeDocumentId, documents]);



  const handleHistoryQuestionSelect = async (questionId) => {
    //await logUserInteraction('question_select', 'history_sidebar', { question_id: questionId });
    setActiveQuestionId(questionId);

    // Also tell the ProvenanceQA component about this selection
    if (window.integratedQARef && window.integratedQARef.selectQuestion) {
      window.integratedQARef.selectQuestion(questionId);
    }
  };

  const handleHistoryQuestionDelete = async (questionId) => {
    if (window.confirm('Are you sure you want to delete this question from history?')) {
      //await logUserInteraction('question_delete', 'history_sidebar', { question_id: questionId });

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

  const handleShowQuestionSuggestions = async () => {
    //await logUserInteraction('question_suggestions_click', 'header');
    setShowQuestionSuggestions(true);
  };

  // Add this handler function to App.js  
  const handleSuggestedQuestionSelect = (questionText) => {
    console.log('🎯 App: Suggested question selected:', questionText);

    // Close the modal first
    setShowQuestionSuggestions(false);

    // Pass the question to ProvenanceQA to submit
    if (window.integratedQARef && window.integratedQARef.submitQuestion) {
      window.integratedQARef.submitQuestion(questionText);
    } else {
      // Fallback: create a question directly in App
      handleDirectQuestionSubmit(questionText);
    }
  };

  // Optional: Direct question submission handler (fallback)
  const handleDirectQuestionSubmit = async (questionText) => {
    if (!activeDocument) {
      console.warn('No active document for question submission');
      return;
    }

    try {
      // Cancel any existing processing
      const isProcessing = Array.from(questionsHistory.values()).some(q => q.isProcessing);
      if (isProcessing) {
        console.log('🛑 Cancelling existing processing before new submission');
        // You could implement cancellation logic here if needed
      }

      // Create question ID
      const questionId = `q_${Date.now()}`;

      console.log('🔄 App: Submitting suggested question:', questionText);

      // Submit question to backend
      const response = await askQuestion(questionText, activeDocument.filename);

      if (response.success && response.question_id) {
        const backendQuestionId = response.question_id;

        // Create question object
        const questionData = {
          id: questionId,
          backendQuestionId: backendQuestionId,
          text: questionText,
          answer: null,
          answerReady: false,
          provenanceSources: [],
          provenanceCount: 0,
          userProvenanceCount: 0,
          maxProvenances: 5,
          canRequestMore: false,
          isProcessing: true,
          logs: [`Processing started: ${questionText}`],
          createdAt: new Date(),
          processingStatus: 'processing',
          userMessage: null,
          processingTime: null,
          submitTime: Date.now(),
          cancellable: true,
          source: 'suggestion' // Mark as coming from suggestions
        };

        // Add to questions history
        addQuestion(questionData);



        console.log('✅ Suggested question processing initialized');
      } else {
        throw new Error(response.error || 'Failed to submit suggested question');
      }
    } catch (error) {
      console.error('❌ Error submitting suggested question:', error);
      // You could show an error message here
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

  // Helper function to collect stable indices for the current page
  const collectStableIndices = (mappingsData, currentPage) => {
    const sentenceSpans = new Set();

    Object.entries(mappingsData.sentence_mappings).forEach(([sentenceId, mapping]) => {
      if (mapping.stable_matches && mapping.stable_matches.length > 0) {
        const pageMatches = mapping.stable_matches.filter(match => match.page === currentPage);
        pageMatches.forEach(match => {
          const spanElements = match.item_span || [];
          spanElements.forEach(spanIndex => {
            sentenceSpans.add(spanIndex);
          });
        });
      }
    });

    return sentenceSpans;
  };

  // Helper function to find text element by stable index
  const findTextElement = (stableIndex, pageNumber) => {
    if (!document) return null;

    return document.querySelector(
      `[data-stable-index="${stableIndex}"][data-page-number="${pageNumber}"]`
    );
  };


  // Function to scroll to specific sentence in provenance panel
  const scrollToProvenanceSentence = async (provenance) => {
    if (!provenance?.sentences_ids || provenance.sentences_ids.length === 0) return;

    try {


      const stableElement = document.querySelector('.direct-provenance-highlight');


      if (stableElement) {
        console.log('📜 Scrolling to stable element:', stableElement);

        // Scroll into view for all stable match elements
        stableElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });

      } else {
        console.warn('Could not find stable element for provenance ids:', provenance.sentences_ids);
      }

    } catch (error) {
      console.warn('Could not scroll to provenance sentence:', error);
    }
  };

  const handleProvenanceSelect = async (provenance) => {
    console.log('🎯 App: Provenance selected:', provenance);

    // Always update the selected provenance
    setSelectedProvenance(provenance);

    // Also store this as the "last viewed" provenance for the current question
    if (activeQuestionId && provenance) {
      console.log(`💾 Storing provenance ${provenance.provenance_id} as last viewed for question ${activeQuestionId}`);

      setQuestionsHistory(prev => {
        const newHistory = new Map(prev);
        const currentQuestion = newHistory.get(activeQuestionId);

        if (currentQuestion) {
          const updatedQuestion = {
            ...currentQuestion,
            lastViewedProvenance: provenance
          };
          newHistory.set(activeQuestionId, updatedQuestion);
        }

        return newHistory;
      });
    }

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


  // handle gdrive modal
  const handleShowDrive = async () => {
    //await logUserInteraction('browse_drive_click', 'document_selector');
    setShowDriveModal(true);
  };

  // Add Drive file selection handler
  const handleDriveFileSelect = async (fileData) => {
    try {
      // Create document using your existing logic
      const docId = createNewDocument(fileData.filename, fileData.filename);

      // Update with Drive-specific metadata
      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(docId);
        if (doc) {
          doc.isDriveDocument = true;
          doc.driveFileId = fileData.drive_file_id;
          doc.source = 'google_drive';
          // ... other metadata
          newDocs.set(docId, doc);
        }
        return newDocs;
      });

      // Log the Drive document selection
      //await userStudyLogger.logDocumentSelected(
      //  docId,
      //  fileData.filename,
      //  false, // isPreloaded = false for Drive docs
      //  'google_drive'
      //);

    } catch (error) {
      console.error('Error selecting Drive file:', error);
    }
  };


  // Handle feedback
  const handleFeedbackSubmit = async (questionId, feedback) => {

    // The feedback modal already logs the submission, 
    // but we can log the completion here
    //await userStudyLogger.logUserInteraction(
    //  'feedback_completed',
    //  'feedback_modal',
    //  { question_id: questionId }
    //);

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
  //const logUserInteraction = async (type, element, details = {}) => {
  //  await userStudyLogger.logUserInteraction(type, element, details);
  //};

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
        //userStudyLogger.logUserInteraction(
        //  'document_activated',
        //  'document_selector',
        //  {
        //    document_id: activeDocumentId,
        //    filename: activeDoc.filename,
        //    is_preloaded: activeDoc.isSessionDocument || false
        //  }
        //);
      }
    }
  }, [activeDocumentId, documents]);

  // Performance monitoring
  useEffect(() => {
    // Log performance metrics periodically
    const performanceInterval = setInterval(() => {
      if (performance && performance.memory) {
        //userStudyLogger.logPerformanceMetric(
        //  'memory_usage',
        //  performance.memory.usedJSHeapSize,
        //  {
        //    total_heap: performance.memory.totalJSHeapSize,
        //    heap_limit: performance.memory.jsHeapSizeLimit
        //  }
        //);
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
            //await logUserInteraction('upload_button_click', 'header');
            handleUploadNewDocument();
          }}
          onShowDrive={handleShowDrive}
          onShowQuestionSuggestions={handleShowQuestionSuggestions}
        />
        {/* Left Sidebar */}
        {/*<div className="left-panel">
          <QuestionHistory
            questionsHistory={questionsHistory}
            activeQuestionId={activeQuestionId}
            onQuestionSelect={handleHistoryQuestionSelect}
            onQuestionDelete={handleHistoryQuestionDelete}
            onProvenanceSelect={handleProvenanceSelect}
            onFeedbackRequest={openFeedbackModal}
          />
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

        </div>*/}

        {/* Main Content Area */}
        <div className="main-content">
          <div className="pdf-section">
            {activeDocument ? (
              <PDFViewer
                pdfDocument={activeDocument}
                selectedProvenance={selectedProvenance}
                activeQuestionId={activeQuestionId}
                navigationTrigger={navigationTrigger}
                onFeedbackRequest={openFeedbackModal}
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
                    onShowDrive={handleShowDrive}
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
      <DriveFileBrowser
        isOpen={showDriveModal}
        onClose={() => setShowDriveModal(false)}
        onFileSelect={handleDriveFileSelect}
      />


      {/* Enhanced Feedback Modal */}
      {feedbackModalOpen && selectedQuestionForFeedback && (
        <FeedbackModal
          pdfDocument={activeDocument}
          question={selectedQuestionForFeedback}
          allProvenances={selectedQuestionForFeedback.provenanceSources || []}
          onSubmit={handleFeedbackSubmit}
          onClose={async () => {
            //await logUserInteraction('close_feedback_modal', 'feedback_modal');
            setFeedbackModalOpen(false);
          }}
        />
      )}

      {/* Preloaded Documents Modal */}
      {showPreloadedModal && (
        <DocumentSelectionModal
          isOpen={showPreloadedModal}
          onClose={() => setShowPreloadedModal(false)}
          onDocumentSelect={handleDocumentSelect}
          showProvenanceStats={true}
        />
      )}

      {/* Question Suggestions Modal - NEW */}
      {showQuestionSuggestions && (
        <QuestionSuggestionsModal
          isOpen={showQuestionSuggestions}
          onClose={() => setShowQuestionSuggestions(false)}
          filename={activeDocument?.filename}
          onQuestionSelect={handleSuggestedQuestionSelect}
        />
      )}
    </div>
  );
}

export default App;