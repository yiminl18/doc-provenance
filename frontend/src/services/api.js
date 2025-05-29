import axios from 'axios';

// Base URL for API requests
const API_URL = '/api';

// ===== SESSION MANAGEMENT =====

/**
 * Get or create current session
 */
export const getCurrentSession = async () => {
  try {
    const response = await axios.get(`${API_URL}/sessions/current`);
    return response.data;
  } catch (error) {
    console.error('Error getting current session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Create new session
 */
export const createNewSession = async () => {
  try {
    const response = await axios.post(`${API_URL}/sessions/current`);
    return response.data;
  } catch (error) {
    console.error('Error creating new session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get session summary
 */
export const getSessionSummary = async (sessionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/summary`);
    return response.data;
  } catch (error) {
    console.error('Error getting session summary:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get session statistics
 */
export const getSessionsStats = async () => {
  try {
    const response = await axios.get(`${API_URL}/sessions/stats`);
    return response.data;
  } catch (error) {
    console.error('Error getting sessions stats:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== UNIFIED DOCUMENT MANAGEMENT =====

/**
 * Upload a document - now unified with preloaded logic
 */
export const uploadDocument = async (formData) => {
  try {
    const response = await axios.post(`${API_URL}/upload`, formData, {
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
 * Process a document for the current session
 */
export const processDocumentForSession = async (documentId) => {
  try {
    const response = await axios.post(`${API_URL}/documents/${documentId}/process`);
    return response.data;
  } catch (error) {
    console.error('Error processing document for session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get preloaded documents - UI compatibility wrapper
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
 * Load any document (unified - works for both uploaded and preloaded)
 */
export const loadDocument = async (documentId) => {
  try {
    const response = await axios.post(`${API_URL}/documents/${documentId}/load`);
    return response.data;
  } catch (error) {
    console.error('Error loading document:', error);
    
    if (error.response?.status === 404) {
      console.warn(`Document ${documentId} not found on server, allowing fallback handling`);
      return {
        success: true,
        document_id: documentId,
        message: 'Document loaded (fallback mode)',
        fallback: true
      };
    }
    
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get document text - unified for all document types
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
 * Get document sentences - unified for all document types
 */
export const getDocumentSentences = async (documentId, start = null, end = null) => {
  try {
    let url = `${API_URL}/documents/${documentId}/sentences`;
    const params = new URLSearchParams();
    
    if (start !== null) params.append('start', start);
    if (end !== null) params.append('end', end);
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error getting document sentences:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== SESSION-BASED QUESTION PROCESSING =====

/**
 * Ask a question within a session
 */
export const askQuestionInSession = async (sessionId, questionText, documentId) => {
  try {
    const response = await axios.post(`${API_URL}/sessions/${sessionId}/ask`, {
      question: questionText,
      document_id: documentId
    });
    return response.data;
  } catch (error) {
    console.error('Error asking question in session:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get question progress in session
 */
export const getQuestionProgress = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/progress`);
    return response.data;
  } catch (error) {
    console.error('Error getting question progress:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get question results in session
 */
export const getQuestionResults = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/results`);
    return response.data;
  } catch (error) {
    console.error('Error getting question results:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get question sentences in session
 */
export const getQuestionSentences = async (sessionId, questionId, sentenceIds) => {
  try {
    const idsParam = Array.isArray(sentenceIds) ? sentenceIds.join(',') : sentenceIds;
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/sentences?ids=${idsParam}`);
    return response.data;
  } catch (error) {
    console.error('Error getting question sentences:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Check question status in session
 */
export const getQuestionStatus = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/status`);
    return response.data;
  } catch (error) {
    console.error('Error checking question status:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== CLEANUP MANAGEMENT =====

/**
 * Clean up session data
 */
export const cleanupSessionData = async (sessionId, type = 'all', confirm = true) => {
  try {
    const response = await axios.delete(`${API_URL}/sessions/${sessionId}/cleanup`, {
      data: { type, confirm }
    });
    return response.data;
  } catch (error) {
    console.error('Error cleaning up session data:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Remove specific document from session
 */
export const removeSessionDocument = async (sessionId, documentId) => {
  try {
    const response = await axios.delete(`${API_URL}/sessions/${sessionId}/documents/${documentId}`);
    return response.data;
  } catch (error) {
    console.error('Error removing session document:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Remove specific question from session
 */
export const removeSessionQuestion = async (sessionId, questionId) => {
  try {
    const response = await axios.delete(`${API_URL}/sessions/${sessionId}/questions/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error removing session question:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Nuclear option - clean up all sessions
 */
export const cleanupAllSessions = async (confirmPhrase) => {
  try {
    const response = await axios.delete(`${API_URL}/sessions`, {
      data: { 
        confirm: true, 
        confirm_phrase: confirmPhrase 
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error cleaning up all sessions:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== FEEDBACK =====

export const submitFeedback = async (feedbackData) => {
  try {
    const response = await axios.post(`${API_URL}/feedback`, feedbackData);
    return response.data;
  } catch (error) {
    console.error('Error submitting feedback:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== BACKWARD COMPATIBILITY (for gradual migration) =====

/**
 * Legacy simplified question processing - now routes to session-based approach
 */
export const askQuestion = async (question, filename) => {
  try {
    // For backward compatibility, try the old endpoint first
    const response = await axios.post(`${API_URL}/ask`, {
      question,
      filename
    });
    return response.data;
  } catch (error) {
    console.error('Error asking question (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const checkProgress = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/check-progress/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking progress (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const getResults = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/results/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting results (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const fetchSentences = async (questionId, sentenceIds) => {
  try {
    const idsParam = Array.isArray(sentenceIds) ? sentenceIds.join(',') : sentenceIds;
    const response = await axios.get(`${API_URL}/sentences/${questionId}?ids=${idsParam}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching sentences (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const checkStatus = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/status/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking status (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// ===== COMPATIBILITY ALIASES =====
export const loadPreloadedDocument = loadDocument;
export const uploadFile = uploadDocument;

// Export all functions as default object for convenience
export default {
  // Session Management
  getCurrentSession,
  createNewSession,
  getSessionSummary,
  getSessionsStats,
  
  // Unified Document Management
  uploadDocument,
  processDocumentForSession,
  getPreloadedDocuments,
  loadDocument,
  getDocumentText,
  getDocumentSentences,
  
  // Session-Based Question Processing
  askQuestionInSession,
  getQuestionProgress,
  getQuestionResults,
  getQuestionSentences,
  getQuestionStatus,
  
  // Cleanup Management
  cleanupSessionData,
  removeSessionDocument,
  removeSessionQuestion,
  cleanupAllSessions,
  
  // Feedback
  submitFeedback,
  
  // Legacy Support
  askQuestion,
  checkProgress,
  getResults,
  fetchSentences,
  checkStatus,
  
  // Compatibility Aliases
  loadPreloadedDocument,
  uploadFile
};