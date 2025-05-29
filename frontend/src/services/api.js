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
 * Enhanced question progress with timeout and special status handling
 */
export const getQuestionProgress = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/progress`);
    
    // Enhanced response handling
    const data = response.data;
    
    // Transform the response to ensure consistent format
    return {
      ...data,
      // Ensure we have the expected fields
      progress: data.progress || 0,
      done: data.done || false,
      data: Array.isArray(data.data) ? data.data.slice(0, 5) : [], // Always limit to top-5 for user
      logs: Array.isArray(data.logs) ? data.logs : [],
      status: data.status || 'processing',
      processing_status: data.processing_status || data.status || 'processing',
      user_message: data.user_message || null,
      explanation: data.explanation || null,
      
      // Enhanced: Include total vs user-visible counts
      total_found: data.total_found || 0,
      user_visible_count: data.user_visible_count || 0,
      experiment_top_k: data.experiment_top_k || 5,
      
      // Handle special cases
      is_timeout: data.processing_status === 'timeout' || data.user_message?.includes('timeout'),
      is_no_provenance: data.processing_status === 'no_provenance_found' || data.user_message?.includes('No atomic evidence'),
      is_error: data.processing_status === 'error' || data.status === 'error'
    };
  } catch (error) {
    console.error('Error getting question progress:', error);
    
    // Enhanced error handling
    if (error.response?.status === 404) {
      return {
        progress: 0,
        done: true,
        data: [],
        logs: ['Question not found'],
        status: 'error',
        processing_status: 'error',
        user_message: 'Question processing session not found',
        is_error: true,
        total_found: 0,
        user_visible_count: 0
      };
    }
    
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced question results with provenance limiting
 */
export const getQuestionResults = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/results`);
    const data = response.data;
    
    // Ensure provenance is limited to top-5
    if (data.success && data.provenance && Array.isArray(data.provenance)) {
      data.provenance = data.provenance.slice(0, 5);
    }
    
    return data;
  } catch (error) {
    console.error('Error getting question results:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced question status with special case handling
 */
export const getQuestionStatus = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}/questions/${questionId}/status`);
    const data = response.data;
    
    return {
      ...data,
      // Normalize status information
      completed: data.completed || false,
      status: data.status || 'processing',
      total_provenance: Math.min(data.total_provenance || 0, 5), // Cap at 5
      processing_time: data.processing_time || 0,
      
      // Special status flags
      is_timeout: data.status === 'timeout',
      is_no_provenance: data.status === 'no_provenance_found',
      is_error: data.status === 'error'
    };
  } catch (error) {
    console.error('Error checking question status:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced legacy progress checking with timeout detection
 */
export const checkProgress = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/check-progress/${questionId}`);
    const data = response.data;
    
    // Limit provenance data to top-5 for legacy compatibility
    if (data.data && Array.isArray(data.data)) {
      data.data = data.data.slice(0, 5);
    }
    
    return {
      ...data,
      // Add timeout detection for legacy
      is_timeout: data.status === 'timeout' || data.logs?.some(log => 
        log.includes('timeout') || log.includes('timed out')
      ),
      is_no_provenance: data.status === 'completed' && (!data.data || data.data.length === 0),
      is_error: data.status === 'error'
    };
  } catch (error) {
    console.error('Error checking progress (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced legacy results with provenance limiting
 */
export const getResults = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/results/${questionId}`);
    const data = response.data;
    
    // Limit provenance to top-5 for legacy compatibility
    if (data.success && data.provenance && Array.isArray(data.provenance)) {
      data.provenance = data.provenance.slice(0, 5);
    }
    
    return data;
  } catch (error) {
    console.error('Error getting results (legacy):', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced feedback submission with processing status context
 */
export const submitFeedback = async (feedbackData) => {
  try {
    // Enhance feedback data with processing context
    const enhancedFeedback = {
      ...feedbackData,
      
      // Add processing status context
      processing_status: feedbackData.processing_status || 'completed',
      had_timeout: feedbackData.is_timeout || false,
      had_no_provenance: feedbackData.is_no_provenance || false,
      had_error: feedbackData.is_error || false,
      
      // Add provenance statistics
      provenance_count: feedbackData.provenance_count || 0,
      max_provenance_limit: 5,
      
      // Timestamp
      feedback_submitted_at: new Date().toISOString()
    };
    
    const response = await axios.post(`${API_URL}/feedback`, enhancedFeedback);
    return response.data;
  } catch (error) {
    console.error('Error submitting feedback:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Utility function to check if a question processing has special status
 */
export const getQuestionSpecialStatus = (question) => {
  if (!question) return null;
  
  if (question.processingStatus === 'timeout' || question.is_timeout) {
    return {
      type: 'timeout',
      message: 'Processing timed out. The document may be too complex.',
      suggestion: 'Try asking more specific questions or use shorter documents.'
    };
  }
  
  if (question.processingStatus === 'no_provenance_found' || question.is_no_provenance) {
    return {
      type: 'no_provenance',
      message: 'No atomic evidence found in the document.',
      suggestion: 'The document may not be suitable for breaking into smaller units to answer this question. Try more specific questions.'
    };
  }
  
  if (question.processingStatus === 'error' || question.is_error) {
    return {
      type: 'error',
      message: 'An error occurred during processing.',
      suggestion: 'Please try again or contact support if the problem persists.'
    };
  }
  
  return null;
};

/**
 * Utility function to format processing time
 */
export const formatProcessingTime = (timeInSeconds) => {
  if (!timeInSeconds || timeInSeconds < 0) return 'N/A';
  
  if (timeInSeconds < 60) {
    return `${timeInSeconds.toFixed(1)}s`;
  } else if (timeInSeconds < 3600) {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
};

/**
 * Get complete provenance data (admin/research function)
 */
export const getCompleteProvenance = async (sessionId, questionId) => {
  try {
    const response = await axios.get(`${API_URL}/admin/sessions/${sessionId}/questions/${questionId}/complete-provenance`);
    return response.data;
  } catch (error) {
    console.error('Error getting complete provenance:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get/Set experiment configuration
 */
export const getExperimentConfig = async () => {
  try {
    const response = await axios.get(`${API_URL}/admin/experiment-config`);
    return response.data;
  } catch (error) {
    console.error('Error getting experiment config:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const setExperimentConfig = async (config) => {
  try {
    const response = await axios.post(`${API_URL}/admin/experiment-config`, config);
    return response.data;
  } catch (error) {
    console.error('Error setting experiment config:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Enhanced document sentences with retry logic
 */
export const getDocumentSentences = async (documentId, start = null, end = null, retries = 2) => {
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let url = `${API_URL}/documents/${documentId}/sentences`;
      const params = new URLSearchParams();
      
      if (start !== null) params.append('start', start);
      if (end !== null) params.append('end', end);
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await axios.get(url);
      const data = response.data;
      
      // Validate response
      if (!data.success || !data.sentences) {
        throw new Error('Invalid sentence data received');
      }
      
      return data;
      
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1} failed for document sentences:`, error.message);
      
      if (attempt < retries) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  console.error('All attempts failed for document sentences:', lastError);
  throw new Error(lastError.response?.data?.error || lastError.message);
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