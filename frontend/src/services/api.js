import axios from 'axios';

// Base URL for API requests
const API_URL = '/api';

// ===== DOCUMENT MANAGEMENT ENDPOINTS =====

/**
 * Upload a PDF document
 * @param {FormData} formData - Form data containing the PDF file
 * @returns {Promise} Response with document_id, filename, text_length, etc.
 */
export const uploadDocument = async (formData) => {
  try {
    const response = await axios.post(`${API_URL}/documents`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading document:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get document metadata
 * @param {string} documentId - The document ID
 * @returns {Promise} Document metadata
 */
export const getDocument = async (documentId) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${documentId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting document:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get the full text of a document
 * @param {string} documentId - The document ID
 * @returns {Promise} Document text
 */
export const getDocumentText = async (documentId) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${documentId}/text`);
    return response.data;
  } catch (error) {
    console.error('Error getting document text:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get list of available preloaded documents
 * @returns {Promise} List of preloaded documents
 */
export const getPreloadedDocuments = async () => {
  try {
    const response = await axios.get(`${API_URL}/documents/preloaded`);
    return response.data;
  } catch (error) {
    console.error('Error fetching preloaded documents:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Load a preloaded document for use
 * @param {string} documentId - The preloaded document ID
 * @returns {Promise} Success response
 */
export const loadPreloadedDocument = async (documentId) => {
  try {
    const response = await axios.post(`${API_URL}/documents/preloaded/${documentId}`);
    return response.data;
  } catch (error) {
    console.error('Error loading preloaded document:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== SESSION MANAGEMENT ENDPOINTS =====

/**
 * Create a new analysis session
 * @returns {Promise} Session information with session_id
 */
export const createSession = async () => {
  try {
    const response = await axios.post(`${API_URL}/sessions`);
    return response.data;
  } catch (error) {
    console.error('Error creating session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get session information
 * @param {string} sessionId - The session ID
 * @returns {Promise} Session data
 */
export const getSession = async (sessionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== TEXT PROCESSING ENDPOINTS =====

/**
 * Process a question against document text using provenance algorithm
 * @param {string} sessionId - The session ID
 * @param {string} questionText - The question to ask
 * @param {string} documentId - The document ID to analyze
 * @returns {Promise} Processing session information
 */
export const processTextQuestion = async (sessionId, questionText, documentId) => {
  try {
    const response = await axios.post(`${API_URL}/sessions/${sessionId}/process-text`, {
      question: questionText,
      document_id: documentId
    });
    return response.data;
  } catch (error) {
    console.error('Error processing text question:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get progress of text processing
 * @param {string} sessionId - The session ID
 * @param {string} processingSessionId - The processing session ID
 * @returns {Promise} Processing progress
 */
export const getTextProcessingProgress = async (sessionId, processingSessionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/processing/${processingSessionId}/progress`);
    return response.data;
  } catch (error) {
    console.error('Error getting text processing progress:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get results of text processing
 * @param {string} sessionId - The session ID
 * @param {string} processingSessionId - The processing session ID
 * @returns {Promise} Processing results with provenance data
 */
export const getTextProcessingResults = async (sessionId, processingSessionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/processing/${processingSessionId}/results`);
    return response.data;
  } catch (error) {
    console.error('Error getting text processing results:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get sentences for a specific processing session
 * @param {string} sessionId - The session ID
 * @param {string} processingSessionId - The processing session ID
 * @param {Array<number>} sentenceIds - Array of sentence IDs to fetch
 * @returns {Promise} Sentences data
 */
export const getProcessingSentences = async (sessionId, processingSessionId, sentenceIds) => {
  try {
    const idsParam = Array.isArray(sentenceIds) ? sentenceIds.join(',') : sentenceIds;
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/processing/${processingSessionId}/sentences?ids=${idsParam}`);
    return response.data;
  } catch (error) {
    console.error('Error getting processing sentences:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== QUESTION MANAGEMENT ENDPOINTS =====

/**
 * Get all questions asked in a session
 * @param {string} sessionId - The session ID
 * @returns {Promise} List of questions in the session
 */
export const getSessionQuestions = async (sessionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions`);
    return response.data;
  } catch (error) {
    console.error('Error getting session questions:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get all questions asked about a specific document in a session
 * @param {string} sessionId - The session ID
 * @param {string} documentId - The document ID
 * @returns {Promise} List of questions for the document
 */
export const getDocumentQuestions = async (sessionId, documentId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/documents/${documentId}/questions`);
    return response.data;
  } catch (error) {
    console.error('Error getting document questions:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get a specific question and its results
 * @param {string} sessionId - The session ID
 * @param {string} documentId - The document ID
 * @param {string} questionId - The question ID
 * @returns {Promise} Specific question data
 */
export const getSpecificQuestion = async (sessionId, documentId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/documents/${documentId}/questions/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting specific question:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== FEEDBACK ENDPOINTS =====

/**
 * Submit comprehensive user feedback
 * @param {Object} feedbackData - Feedback data object
 * @returns {Promise} Success response
 */
export const submitFeedback = async (feedbackData) => {
  try {
    const response = await axios.post(`${API_URL}/feedback`, feedbackData);
    return response.data;
  } catch (error) {
    console.error('Error submitting feedback:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== UTILITY FUNCTIONS =====

/**
 * Generate a client-side content hash (for consistency checking)
 * @param {string|Object} content - Content to hash
 * @param {string} prefix - Optional prefix for the hash
 * @returns {Promise<string>} Generated hash
 */
export const generateContentHash = async (content, prefix = "") => {
  const encoder = new TextEncoder();
  let data;
  
  if (typeof content === 'string') {
    data = encoder.encode(content);
  } else if (typeof content === 'object') {
    data = encoder.encode(JSON.stringify(content));
  } else {
    data = encoder.encode(String(content));
  }
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `${prefix}${hashHex.substring(0, 12)}`;
};

/**
 * Helper function to batch multiple processing operations
 * @param {Array<string>} processingSessionIds - Array of processing session IDs
 * @param {string} sessionId - The main session ID
 * @param {string} operation - Operation type ('progress' or 'results')
 * @returns {Promise} Batch operation results
 */
export const batchProcessingOperations = async (processingSessionIds, sessionId, operation) => {
  try {
    const promises = processingSessionIds.map(processingSessionId => {
      switch (operation) {
        case 'progress':
          return getTextProcessingProgress(sessionId, processingSessionId);
        case 'results':
          return getTextProcessingResults(sessionId, processingSessionId);
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    });
    
    const results = await Promise.allSettled(promises);
    
    const successfulResults = [];
    const failedResults = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push({
          processingSessionId: processingSessionIds[index],
          data: result.value
        });
      } else {
        failedResults.push({
          processingSessionId: processingSessionIds[index],
          error: result.reason.message
        });
      }
    });
    
    return {
      successful: successfulResults,
      failed: failedResults,
      totalRequested: processingSessionIds.length,
      successCount: successfulResults.length,
      failureCount: failedResults.length
    };
    
  } catch (error) {
    console.error('Error in batch processing operations:', error);
    throw new Error(error.message);
  }
};

/**
 * Helper function to poll processing sessions until completion
 * @param {Array<string>} processingSessionIds - Array of processing session IDs
 * @param {string} sessionId - The main session ID
 * @param {Function} onProgress - Optional progress callback
 * @param {number} maxPollingTime - Maximum polling time in milliseconds (default: 5 minutes)
 * @returns {Promise} Polling results
 */
export const pollProcessingUntilComplete = async (processingSessionIds, sessionId, onProgress = null, maxPollingTime = 300000) => {
  const startTime = Date.now();
  const completedSessions = new Set();
  const sessionResults = new Map();
  
  while (completedSessions.size < processingSessionIds.length && (Date.now() - startTime) < maxPollingTime) {
    const pendingSessions = processingSessionIds.filter(id => !completedSessions.has(id));
    
    try {
      const batchResults = await batchProcessingOperations(pendingSessions, sessionId, 'progress');
      
      for (const result of batchResults.successful) {
        const { processingSessionId, data } = result;
        
        if (data.done && data.status === 'completed') {
          completedSessions.add(processingSessionId);
          
          // Get final results for completed session
          try {
            const finalResults = await getTextProcessingResults(sessionId, processingSessionId);
            sessionResults.set(processingSessionId, finalResults);
          } catch (error) {
            console.error(`Error getting final results for processing session ${processingSessionId}:`, error);
          }
        }
        
        // Call progress callback if provided
        if (onProgress) {
          onProgress({
            processingSessionId,
            progress: data.progress,
            done: data.done,
            status: data.status,
            totalCompleted: completedSessions.size,
            totalSessions: processingSessionIds.length
          });
        }
      }
      
      // Wait before next poll if not all completed
      if (completedSessions.size < processingSessionIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      console.error('Error during polling:', error);
      // Continue polling even if there's an error
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return {
    completedSessions: Array.from(completedSessions),
    sessionResults: Object.fromEntries(sessionResults),
    totalRequested: processingSessionIds.length,
    totalCompleted: completedSessions.size,
    timedOut: completedSessions.size < processingSessionIds.length
  };
};

// ===== COMPATIBILITY LAYER =====
// These functions provide backward compatibility with your existing frontend

/**
 * @deprecated Use uploadDocument instead
 */
export const uploadFile = uploadDocument;

/**
 * @deprecated Use processTextQuestion instead
 */
export const askQuestion = async (questionText, documentIds, sessionId = null) => {
  console.warn('askQuestion is deprecated. Use createSession + processTextQuestion instead.');
  
  // If no session provided, create one
  if (!sessionId) {
    const sessionResponse = await createSession();
    sessionId = sessionResponse.session_id;
  }
  
  // Process question for first document (maintaining backward compatibility)
  const documentId = Array.isArray(documentIds) ? documentIds[0] : documentIds;
  return await processTextQuestion(sessionId, questionText, documentId);
};

/**
 * @deprecated Use getTextProcessingProgress instead
 */
export const checkSessionProgress = async (processingSessionId) => {
  console.warn('checkSessionProgress is deprecated. Use getTextProcessingProgress instead.');
  // This requires session_id which we don't have in the old API
  // For now, we'll try to extract it from the processingSessionId or use a placeholder
  const sessionId = 'legacy'; // You might need to adjust this based on your ID format
  return await getTextProcessingProgress(sessionId, processingSessionId);
};

/**
 * @deprecated Use getTextProcessingResults instead
 */
export const getSessionResults = async (processingSessionId) => {
  console.warn('getSessionResults is deprecated. Use getTextProcessingResults instead.');
  const sessionId = 'legacy'; // You might need to adjust this based on your ID format
  return await getTextProcessingResults(sessionId, processingSessionId);
};

/**
 * @deprecated Use getProcessingSentences instead
 */
export const fetchSessionSentences = async (processingSessionId, sentenceIds) => {
  console.warn('fetchSessionSentences is deprecated. Use getProcessingSentences instead.');
  const sessionId = 'legacy'; // You might need to adjust this based on your ID format
  return await getProcessingSentences(sessionId, processingSessionId, sentenceIds);
};

/**
 * @deprecated Use getTextProcessingProgress instead
 */
export const checkSessionStatus = async (processingSessionId) => {
  console.warn('checkSessionStatus is deprecated. Use getTextProcessingProgress instead.');
  const sessionId = 'legacy'; // You might need to adjust this based on your ID format
  const progress = await getTextProcessingProgress(sessionId, processingSessionId);
  return {
    completed: progress.done,
    status: progress.status
  };
};

// Export all functions as default object for convenience
export default {
  // Document Management
  uploadDocument,
  getDocument,
  getDocumentText,
  getPreloadedDocuments,
  loadPreloadedDocument,
  
  // Session Management
  createSession,
  getSession,
  
  // Text Processing
  processTextQuestion,
  getTextProcessingProgress,
  getTextProcessingResults,
  getProcessingSentences,
  
  // Question Management
  getSessionQuestions,
  getDocumentQuestions,
  getSpecificQuestion,
  
  // Feedback
  submitFeedback,
  
  // Utilities
  generateContentHash,
  batchProcessingOperations,
  pollProcessingUntilComplete,
  
  // Backward Compatibility (deprecated)
  uploadFile,
  askQuestion,
  checkSessionProgress,
  getSessionResults,
  fetchSessionSentences,
  checkSessionStatus
};