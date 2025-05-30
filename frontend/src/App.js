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
  createNewSessionWithDocuments,
  uploadDocumentToSession,
  loadSessionDocument,
  processDocumentForSession,
  getDocumentText,
  askQuestionInSession,
  getQuestionProgress,
  getQuestionResults,
  getQuestionSentences,
  getQuestionStatus,
  getSessionDocuments,  // NEW: Replace getPreloadedDocuments
  // Legacy fallbacks
  askQuestion,
  checkProgress,
  getResults,
  fetchSentences,
  checkStatus
} from './services/api';

function App() {

  const EXPERIMENT_TOP_K = 5;
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

// Update the session initialization
const initializeSession = async () => {
  try {
    const response = await getCurrentSession();
    if (response.success) {
      setCurrentSessionId(response.session_id);
      setSessionReady(true);
      console.log('✅ Session initialized:', response.session_id);
      
      // If session was just initialized with documents, log that info
      if (response.preloaded_documents_available > 0) {
        console.log(`📚 Session has ${response.preloaded_documents_available} documents available`);
      }
    }
  } catch (error) {
    console.error('❌ Failed to initialize session, continuing in legacy mode');
    setSessionReady(true); // Continue without session features
  }
};

  // Update the handleDocumentSelect function
const handleDocumentSelect = async (document) => {
  if (!sessionReady || !currentSessionId) {
    console.error('Session not ready for document processing');
    return;
  }

  try {
    setLoadingPreloaded(true);
    console.log('🔄 Loading session document:', document);

    // For session documents, they're already processed - just load them
    const loadResponse = await loadSessionDocument(currentSessionId, document.document_id);

    if (!loadResponse.success) {
      throw new Error(loadResponse.error || 'Failed to load session document');
    }

    console.log('✅ Session document loaded:', loadResponse);

    // Create the frontend document object
    const docId = createNewDocument(document.filename, document.is_preloaded_origin || false, {
      document_id: document.document_id,
      text_length: document.text_length || 0,
      sentence_count: document.sentence_count || 0
    });

    // Update document with session-specific metadata
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.isSessionDocument = true;
        doc.backendDocumentId = document.document_id;
        doc.textLength = document.text_length || 0;
        doc.sentenceCount = document.sentence_count || 0;
        doc.sourceFolder = document.source_folder || 'session';
        doc.sessionProcessed = true;
        doc.isPreloadedOrigin = document.is_preloaded_origin || false;

        // Add session document metadata
        doc.sessionDocumentId = document.session_document_id;
        doc.processedAt = document.processed_at;

        newDocs.set(docId, doc);
        console.log('✅ Session document created and configured:', doc);
      }
      return newDocs;
    });

    // Close modal and show success
    if (showPreloadedModal) {
      setShowPreloadedModal(false);
    }

    console.log('🎉 Session document selection completed successfully');

  } catch (error) {
    console.error('❌ Error loading session document:', error);
    alert(`Error loading document: ${error.message}`);
  } finally {
    setLoadingPreloaded(false);
  }
};

// Update the document upload handler to use session-aware upload
const handleDocumentUpload = async (formData) => {
  const fileName = formData.get('file')?.name || 'Unknown file';

  setUploadProgress({
    success: false,
    message: `Uploading: ${fileName}...`
  });

  try {
    const response = await uploadDocumentToSession(formData, currentSessionId);

    const docId = createNewDocument(response.filename, false, {
      document_id: response.document_id,
      text_length: response.text_length || 0,
      sentence_count: response.sentence_count || 0
    });

    // Mark as session processed
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(docId);
      if (doc) {
        doc.sessionProcessed = response.session_processed || false;
        doc.sessionId = currentSessionId;
        newDocs.set(docId, doc);
      }
      return newDocs;
    });

    setUploadProgress({
      success: true,
      message: `Upload Complete: ${response.filename}${response.session_processed ? ' (Ready for analysis)' : ''}`
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


// Replace the existing handleShowPreloaded function
const handleShowSessionDocuments = async () => {
  if (!currentSessionId) {
    console.error('No active session');
    return;
  }
  
  setLoadingPreloaded(true);
  try {
    const response = await getSessionDocuments(currentSessionId);
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

  // Helper function to get question logs safely
  const getQuestionLogs = (questionId) => {
    if (!activeDocumentId) return [];
    const doc = documents.get(activeDocumentId);
    if (doc && doc.questions.has(questionId)) {
      return doc.questions.get(questionId).logs || [];
    }
    return [];
  };


  // Enhanced legacy polling with similar improvements
  const startLegacyPolling = (questionId, backendQuestionId) => {
    let currentProvenanceCount = 0;
    let pollCount = 0;
    const maxPolls = 300; // 5 minutes timeout

    const pollInterval = setInterval(async () => {
      try {
        pollCount++;

        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          updateQuestion(questionId, {
            isProcessing: false,
            processingStatus: 'timeout',
            userMessage: 'Processing took too long. Please try a more specific question.'
          });
          return;
        }

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
          updateQuestion(questionId, {
            isProcessing: false,
            processingStatus: status.status || 'completed'
          });
        }

      } catch (error) {
        console.error('Legacy polling error:', error);
        clearInterval(pollInterval);
        updateQuestion(questionId, {
          isProcessing: false,
          processingStatus: 'error',
          userMessage: `Processing error: ${error.message}`
        });
      }
    }, 1000);
  };

  // Enhanced question update helper to handle cleanup
  const updateQuestion = (questionId, updates) => {
    if (!activeDocumentId) return {};

    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const currentQuestion = doc.questions.get(questionId);

        // If we're getting a new question state, clean up any existing polling
        if (updates && typeof updates === 'object' && 'isProcessing' in updates && !updates.isProcessing) {
          if (currentQuestion.pollInterval) {
            clearInterval(currentQuestion.pollInterval);
          }
        }

        const newQuestion = typeof updates === 'function'
          ? { ...currentQuestion, ...updates(currentQuestion) }
          : { ...currentQuestion, ...updates };

        doc.questions.set(questionId, newQuestion);
        newDocs.set(activeDocumentId, doc);

        return newDocs;
      }
      return prev;
    });

    // Return current question for chaining/access
    const doc = documents.get(activeDocumentId);
    return doc?.questions.get(questionId) || {};
  };

  // Add cleanup function to prevent memory leaks
  const cleanupQuestionPolling = (questionId) => {
    if (!activeDocumentId) return;

    const doc = documents.get(activeDocumentId);
    if (doc && doc.questions.has(questionId)) {
      const question = doc.questions.get(questionId);
      if (question.pollInterval) {
        clearInterval(question.pollInterval);
      }
    }
  };

  // Enhanced document removal with cleanup
  const removeDocument = (docId) => {
    // Clean up any active polling for questions in this document
    const doc = documents.get(docId);
    if (doc) {
      doc.questions.forEach((question, questionId) => {
        if (question.pollInterval) {
          clearInterval(question.pollInterval);
        }
      });
    }

    setDocuments(prev => {
      const newDocs = new Map(prev);
      newDocs.delete(docId);
      return newDocs;
    });

    if (activeDocumentId === docId) {
      setActiveDocumentId(null);
    }
  };

  // Add component cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up all polling intervals on component unmount
      documents.forEach((doc, docId) => {
        doc.questions.forEach((question, questionId) => {
          if (question.pollInterval) {
            clearInterval(question.pollInterval);
          }
        });
      });
    };
  }, []);

  // Enhanced error boundary for question processing
  const handleQuestionError = (questionId, error) => {
    console.error('Question processing error:', error);

    updateQuestion(questionId, {
      isProcessing: false,
      processingStatus: 'error',
      userMessage: `Processing failed: ${error.message}`,
      logs: [...(updateQuestion(questionId, {}).logs || []), `Error: ${error.message}`]
    });
  };

// Enhanced question submission with detailed debugging
const addQuestionToDocument = async (questionText) => {
  console.log('🔄 Starting question submission:', questionText);
  console.log('📋 Current state:', {
    activeDocumentId,
    activeDocument: activeDocument ? {
      id: activeDocument.id,
      filename: activeDocument.filename,
      backendDocumentId: activeDocument.backendDocumentId,
      sessionId: activeDocument.sessionId
    } : null,
    currentSessionId,
    sessionReady
  });

  if (!activeDocumentId || !activeDocument) {
    console.error('❌ No active document');
    alert('No active document selected. Please select a document first.');
    return;
  }

  if (!activeDocument.backendDocumentId) {
    console.error('❌ Active document missing backend document ID');
    alert('Document not properly loaded. Please reload the document.');
    return;
  }

  const tempQuestionId = `temp_${Date.now()}`;
  console.log(`📝 Created temporary question ID: ${tempQuestionId}`);

  const questionData = {
    id: tempQuestionId,
    text: questionText,
    answer: null,
    provenanceSources: [],
    isProcessing: true,
    logs: [`[${new Date().toLocaleTimeString()}] Question submitted: ${questionText}`],
    createdAt: new Date(),
    processingStatus: 'processing',
    userMessage: null,
    explanation: null,
    processingMethod: sessionReady && currentSessionId ? 'session-based' : 'legacy'
  };

  // Add question to document immediately for UI feedback
  setDocuments(prev => {
    const newDocs = new Map(prev);
    const doc = newDocs.get(activeDocumentId);
    if (doc) {
      doc.questions.set(tempQuestionId, questionData);
      doc.activeQuestionId = tempQuestionId;
      newDocs.set(activeDocumentId, doc);
      console.log('✅ Question added to document state');
    } else {
      console.error('❌ Could not find document to add question to');
    }
    return newDocs;
  });

  try {
    console.log('🔄 Attempting to submit question...');
    
    // Try session-based approach first
    if (sessionReady && currentSessionId && activeDocument.backendDocumentId) {
      console.log('🔄 Using session-based approach');
      console.log('📋 Session submission params:', {
        sessionId: currentSessionId,
        questionText,
        documentId: activeDocument.backendDocumentId
      });

      try {
        const response = await askQuestionInSession(currentSessionId, questionText, activeDocument.backendDocumentId);
        console.log('✅ Session-based submission successful:', response);

        if (response.success && response.question_id) {
          console.log(`🔄 Starting session polling for question ${response.question_id}`);
          startSessionPolling(tempQuestionId, currentSessionId, response.question_id);
        } else {
          throw new Error(response.error || 'Invalid response from session-based submission');
        }
      } catch (sessionError) {
        console.error('❌ Session-based submission failed:', sessionError);
        
        // Check if it's a document processing issue
        if (sessionError.message.includes('Document not found') || sessionError.message.includes('not processed for session')) {
          console.log('🔄 Attempting to process document for session...');
          
          try {
            await processDocumentForSession(activeDocument.backendDocumentId);
            console.log('✅ Document processed for session, retrying question...');
            
            // Retry the question submission
            const retryResponse = await askQuestionInSession(currentSessionId, questionText, activeDocument.backendDocumentId);
            console.log('✅ Retry submission successful:', retryResponse);
            
            if (retryResponse.success && retryResponse.question_id) {
              startSessionPolling(tempQuestionId, currentSessionId, retryResponse.question_id);
            } else {
              throw new Error(retryResponse.error || 'Retry submission failed');
            }
          } catch (processError) {
            console.error('❌ Document processing failed:', processError);
            throw new Error(`Document processing failed: ${processError.message}`);
          }
        } else {
          throw sessionError;
        }
      }
    } else {
      console.log('🔄 Using legacy approach');
      console.log('📋 Legacy submission params:', {
        questionText,
        filename: activeDocument.filename
      });

      const response = await askQuestion(questionText, activeDocument.filename);
      console.log('✅ Legacy submission successful:', response);

      if (response.success && response.question_id) {
        console.log(`🔄 Starting legacy polling for question ${response.question_id}`);
        startLegacyPolling(tempQuestionId, response.question_id);
      } else {
        throw new Error(response.error || 'Invalid response from legacy submission');
      }
    }

    console.log('✅ Question submission completed successfully');

  } catch (error) {
    console.error('❌ Question submission failed:', error);
    handleQuestionError(tempQuestionId, error);
  }
};

const enhanceSessionProvenanceWithContent = async (sessionId, sessionQuestionId, provenanceArray) => {
  console.log('🔄 Enhancing provenance with content:', provenanceArray);
  
  if (!Array.isArray(provenanceArray) || provenanceArray.length === 0) {
    console.warn('⚠️ No provenance array provided or empty');
    return [];
  }

  const limitedProvenance = provenanceArray.slice(0, EXPERIMENT_TOP_K);
  console.log(`📊 Processing ${limitedProvenance.length} provenance entries`);

  const allSentenceIds = new Set();
  limitedProvenance.forEach(source => {
    if (source.sentences_ids && Array.isArray(source.sentences_ids)) {
      source.sentences_ids.forEach(id => allSentenceIds.add(id));
    } else {
      console.warn('⚠️ Provenance entry missing sentences_ids:', source);
    }
  });

  console.log(`📝 Found ${allSentenceIds.size} unique sentence IDs:`, Array.from(allSentenceIds));

  let sentencesData = {};
  if (allSentenceIds.size > 0) {
    try {
      console.log(`🔍 Fetching sentences from: /api/sessions/${sessionId}/questions/${sessionQuestionId}/sentences`);
      const response = await getQuestionSentences(sessionId, sessionQuestionId, Array.from(allSentenceIds));
      console.log('📋 Sentences response:', response);
      
      sentencesData = response.sentences || {};
      console.log(`✅ Retrieved ${Object.keys(sentencesData).length} sentences`);
    } catch (error) {
      console.error('❌ Error fetching session sentences:', error);
      // Continue with empty sentences data rather than failing completely
    }
  }

  const enhancedProvenance = limitedProvenance.map((source, index) => {
    console.log(`🔄 Enhancing provenance ${index + 1}:`, source);
    
    if (!source.sentences_ids || source.sentences_ids.length === 0) {
      console.warn(`⚠️ Provenance ${index + 1} has no sentence IDs`);
      return source;
    }

    const content = source.sentences_ids.map(id => {
      const sentence = sentencesData[id];
      if (!sentence) {
        console.warn(`⚠️ Sentence ${id} not found in sentences data`);
        return `[SENTENCE_${id}_NOT_FOUND]`;
      }
      return sentence;
    });

    const enhanced = { 
      ...source, 
      content,
      enhanced_at: new Date().getTime()
    };
    
    console.log(`✅ Enhanced provenance ${index + 1} with ${content.length} sentences`);
    return enhanced;
  });

  // Sort by provenance_id if available
  const sortedProvenance = enhancedProvenance.sort((a, b) =>
    (a.provenance_id !== undefined && b.provenance_id !== undefined)
      ? a.provenance_id - b.provenance_id
      : 0
  );

  console.log('✅ Provenance enhancement complete:', sortedProvenance);
  return sortedProvenance;
};

  // Enhanced legacy provenance loading with top-K limiting
  const enhanceLegacyProvenanceWithContent = async (backendQuestionId, provenanceArray) => {
    if (!Array.isArray(provenanceArray) || provenanceArray.length === 0) {
      return [];
    }

    // Strictly limit to top-K
    const limitedProvenance = provenanceArray.slice(0, EXPERIMENT_TOP_K);

    const allSentenceIds = new Set();
    limitedProvenance.forEach(source => {
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



  // Add admin function to check complete provenance (for development/research)
  const getCompleteProvenance = async (sessionId, questionId) => {
    try {
      const response = await fetch(`/api/admin/sessions/${sessionId}/questions/${questionId}/complete-provenance`);
      const data = await response.json();

      if (data.success) {
        console.log('🔍 Complete provenance data:', data);
        return data.complete_provenance;
      } else {
        console.warn('Could not fetch complete provenance:', data.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching complete provenance:', error);
      return null;
    }
  };

  // Enhanced debug function for development
  const debugProvenanceInfo = (question) => {
    if (!question) return;

    console.log('📊 Provenance Debug Info:', {
      questionId: question.id,
      totalFound: question.totalProvenanceFound,
      userVisible: question.userVisibleProvenance,
      experimentTopK: question.experimentTopK,
      currentProvenanceSources: question.provenanceSources?.length || 0,
      hiddenResultsMessage: question.hiddenResultsMessage,
      processingStatus: question.processingStatus
    });
  };

  // Add to your existing component - call this when a question completes
  useEffect(() => {
    if (activeDocument && activeDocument.activeQuestionId) {
      const activeQuestion = activeDocument.questions.get(activeDocument.activeQuestionId);
      if (activeQuestion && !activeQuestion.isProcessing && process.env.NODE_ENV === 'development') {
        debugProvenanceInfo(activeQuestion);
      }
    }
  }, [activeDocument?.activeQuestionId, documents]);


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

// Remove or modify this function to not trigger navigation updates:
const getSentencePageMapping = () => {
  // This would ideally come from your sentence mapper
  // For now, we'll return a simple mapping or empty object
  if (activeDocument && activeDocument.sentencePageMapping) {
    return activeDocument.sentencePageMapping;
  }
  return {};
};

// Updated polling function that stops as soon as an answer is detected
const startSessionPolling = (questionId, sessionId, sessionQuestionId) => {
  let currentProvenanceCount = 0;
  let pollCount = 0;
  const maxPolls = 300;
  let isPollingComplete = false;
  
  console.log(`🔄 Starting session polling for question ${sessionQuestionId} in session ${sessionId}`);

  const pollInterval = setInterval(async () => {
    try {
      pollCount++;
      console.log(`📊 Poll attempt ${pollCount}/${maxPolls} for question ${sessionQuestionId}`);
      
      // Check if we should stop polling
      if (isPollingComplete || pollCount >= maxPolls) {
        if (pollCount >= maxPolls) {
          console.error(`⏰ Frontend timeout after ${maxPolls} polls`);
          updateQuestion(questionId, {
            isProcessing: false,
            processingStatus: 'timeout',
            userMessage: 'Frontend timeout: Processing took too long.',
            logs: [...(getQuestionLogs(questionId) || []), 'Frontend timeout after 5 minutes']
          });
        }
        clearInterval(pollInterval);
        return;
      }

      const progress = await getQuestionProgress(sessionId, sessionQuestionId);
      console.log('📊 Progress response:', progress);

      // Update logs if available
      if (progress.logs && progress.logs.length > 0) {
        updateQuestion(questionId, { logs: progress.logs });
      }

      // Handle special processing statuses
      if (progress.processing_status && progress.processing_status !== 'processing') {
        console.log(`🎯 Special processing status: ${progress.processing_status}`);
        updateQuestion(questionId, {
          processingStatus: progress.processing_status,
          userMessage: progress.user_message,
          explanation: progress.explanation
        });
      }

      // Progressive provenance loading
      if (progress.data && progress.data.length > currentProvenanceCount) {
        console.log(`📄 New provenance data: ${progress.data.length} total, ${currentProvenanceCount} current`);
        
        try {
          const newProvenances = await enhanceSessionProvenanceWithContent(
            sessionId, sessionQuestionId, progress.data.slice(currentProvenanceCount)
          );
          
          console.log(`✅ Enhanced ${newProvenances.length} new provenances`);

          updateQuestion(questionId, (prev) => ({
            provenanceSources: [...(prev.provenanceSources || []), ...newProvenances]
          }));

          currentProvenanceCount = progress.data.length;
        } catch (enhanceError) {
          console.error('❌ Error enhancing provenance:', enhanceError);
        }
      }

      // IMMEDIATE ANSWER CHECK - Try to get answer as soon as we detect completion
      if (progress.done || progress.has_answer || progress.data?.length > 0 || 
          ['completed', 'success'].includes(progress.status) || 
          ['completed', 'success'].includes(progress.processing_status)) {
        
        console.log('🔍 Completion detected, attempting to get results...');
        console.log('🔍 Completion signals:', {
          done: progress.done,
          has_answer: progress.has_answer,
          data_length: progress.data?.length,
          status: progress.status,
          processing_status: progress.processing_status
        });
        
        try {
          const results = await getQuestionResults(sessionId, sessionQuestionId);
          console.log('📋 Results response:', results);
          
          if (results.success) {
            let shouldComplete = false;
            
            // Update answer if we got one
            if (results.answer) {
              console.log('✅ Got answer:', results.answer);
              updateQuestion(questionId, { answer: results.answer });
              shouldComplete = true;
            }
            
            // Update provenance if we got any
            if (results.provenance && results.provenance.length > 0) {
              console.log('✅ Got provenance in results:', results.provenance.length);
              // This might be the complete set, so enhance and update
              try {
                const enhancedProvenance = await enhanceSessionProvenanceWithContent(
                  sessionId, sessionQuestionId, results.provenance
                );
                updateQuestion(questionId, { provenanceSources: enhancedProvenance });
                shouldComplete = true;
              } catch (error) {
                console.error('Error enhancing results provenance:', error);
              }
            }
            
            // If we got either answer or provenance, mark as complete
            if (shouldComplete) {
              console.log('✅ Marking question as complete due to results');
              isPollingComplete = true;
              clearInterval(pollInterval);
              
              updateQuestion(questionId, {
                isProcessing: false,
                processingStatus: 'completed'
              });
              
              return; // Exit early
            }
          }
        } catch (resultError) {
          console.warn('⚠️ Could not get results yet:', resultError.message);
          // Don't stop polling yet, but log the issue
        }
      }

      // Check if processing is definitively complete based on status
      if (progress.done || 
          ['success', 'completed', 'no_provenance_found', 'timeout', 'error'].includes(progress.processing_status) ||
          ['completed'].includes(progress.status)) {
        
        console.log(`✅ Processing definitively complete with status: ${progress.processing_status || progress.status}`);
        isPollingComplete = true;
        clearInterval(pollInterval);

        // Final status update
        const finalStatus = {
          isProcessing: false,
          processingStatus: progress.processing_status || progress.status || 'completed'
        };

        // Handle special completion cases
        if (progress.processing_status === 'no_provenance_found') {
          finalStatus.userMessage = progress.user_message || 'No atomic evidence found for this question.';
          finalStatus.explanation = progress.explanation;
        } else if (progress.processing_status === 'timeout') {
          finalStatus.userMessage = progress.user_message || 'Processing timed out.';
          finalStatus.explanation = progress.explanation;
        } else if (progress.processing_status === 'error') {
          finalStatus.userMessage = progress.user_message || 'An error occurred during processing.';
          finalStatus.explanation = progress.explanation;
        }

        updateQuestion(questionId, finalStatus);

        // One final attempt to get results
        try {
          const finalResults = await getQuestionResults(sessionId, sessionQuestionId);
          if (finalResults.success) {
            if (finalResults.answer && !updateQuestion(questionId, {}).answer) {
              updateQuestion(questionId, { answer: finalResults.answer });
            }
            if (finalResults.provenance && finalResults.provenance.length > 0) {
              const currentProvenance = updateQuestion(questionId, {}).provenanceSources || [];
              if (currentProvenance.length === 0) {
                const enhancedProvenance = await enhanceSessionProvenanceWithContent(
                  sessionId, sessionQuestionId, finalResults.provenance
                );
                updateQuestion(questionId, { provenanceSources: enhancedProvenance });
              }
            }
          }
        } catch (error) {
          console.warn('Could not get final results:', error);
        }
      }

    } catch (error) {
      console.error('❌ Session polling error:', error);
      
      // Only stop polling if we've had many consecutive errors
      if (pollCount > 50 && error.message.includes('404')) {
        console.error('❌ Question not found, stopping polling');
        isPollingComplete = true;
        clearInterval(pollInterval);
        updateQuestion(questionId, {
          isProcessing: false,
          processingStatus: 'error',
          userMessage: `Question not found: ${error.message}`,
          hasError: true
        });
      }
    }
  }, 1000);

  // Store interval reference for potential cleanup
  updateQuestion(questionId, { pollInterval });
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
        onShowPreloaded={handleShowSessionDocuments}
        onUploadDocument={handleUploadNewDocument}
        currentSession={{ session_id: currentSessionId }}
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
                onClose={() => { }}
                currentSession={{ session_id: currentSessionId }}
                navigationTrigger={activeDocument?.navigationTrigger} // Add this prop
              />
            ) : (
              <div className="pdf-empty-state">
                <div className="empty-icon">📄</div>
                <h3>Ready to Analyze Documents</h3>
                <p>Upload your own PDF or choose from our sample documents to begin QA and provenance extraction.</p>

                <div className="pdf-empty-actions">
                  <DocumentSelector
                    onDocumentUpload={handleDocumentUpload}
                    onShowPreloaded={handleShowSessionDocuments}
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
                onHighlightInPDF={handleHighlightInPDF}
                currentSession={{ session_id: currentSessionId }}
                sentencePageMapping={getSentencePageMapping()}
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
                  <p>Choose from documents in your current session:</p>
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