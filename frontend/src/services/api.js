import axios from 'axios';

// Base URL for API requests
const API_URL = '/api';  // Using the /api prefix for all API calls


// =============================================================================
// Document Management APIs
// =============================================================================

// Upload a PDF file
export const uploadFile = async (formData) => {
  try {
    const response = await axios.post(`${API_URL}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Get documents
export const getDocuments = async () => {
  try {
    const response = await axios.get(`${API_URL}/documents`);
    return response.data;
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};


// Fetch sentences for a document
export const fetchSentences = async (filename, sentenceIds) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${filename}/sentences?ids=${sentenceIds.join(',')}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching sentences:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Get all sentences for a document (for preprocessing)
export const getDocumentSentences = async (filename) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${filename}/sentences`);
    return response.data;
  } catch (error) {
    console.error('Error fetching document sentences:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};


// =============================================================================
// Question Processing APIs
// =============================================================================

export const askQuestion = async (question, filename, options = {}) => {
  try {
    const payload = {
      question,
      filename
    };
    
    
    const response = await axios.post(`${API_URL}/ask`, payload, {
      signal: options.signal // Support abort signal
    });
    
    console.log('Response from askQuestion:', response.data);
    return response.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('🛑 Ask question request was cancelled');
      throw error;
    }
    console.error('Error asking question:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const checkAnswer = async (questionId, options = {}) => {
  try {
    const response = await axios.get(`${API_URL}/check-answer/${questionId}`, {
      signal: options.signal
    });
    return response.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error('Error checking answer:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const getQuestionStatus = async (questionId, options = {}) => {
  try {
    const response = await axios.get(`${API_URL}/question-status/${questionId}`, {
      signal: options.signal
    });
    console.log('Response from getQuestionStatus:', response.data);
    return response.data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error('Error getting question status:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Check processing progress
export const checkProgress = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/check-progress/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking progress:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Get final results
export const getResults = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/results/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting results:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Check processing status
export const checkStatus = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/status/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking status:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};


// =============================================================================
// Enhanced Question Processing with Decoupled Answer/Provenance
// =============================================================================



// Get the next provenance for a question
export const getNextProvenance = async (questionId, currentCount = 0) => {
  try {
    const response = await axios.post(`${API_URL}/get-next-provenance/${questionId}`, {
      current_count: currentCount
    });
    return response.data;
  } catch (error) {
    console.error('Error getting next provenance:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};



export const getProvenanceHighlightingBoxes = async (filename, sentenceIds, provenanceId = null, provenanceText = null) => {
  try {
    const response = await axios.post(`${API_URL}/documents/${filename}/provenance-boxes`, {
      sentence_ids: sentenceIds,
      provenance_id: provenanceId,
      provenance_text: provenanceText // NEW: include actual text
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Error getting provenance highlighting boxes:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// =============================================================================
// Legacy/Compatibility APIs
// =============================================================================

// Submit feedback function (can be simplified or kept for future use)
export const submitFeedback = async (feedbackData) => {
  try {
    const response = await axios.post(`${API_URL}/feedback`, feedbackData);
    return response.data;
  } catch (error) {
    console.error('Error submitting feedback:', error);
    // Don't throw error for feedback submission - it's not critical
    return { success: false, error: error.message };
  }
};


// =============================================================================
// Google Drive APIs
// =============================================================================

// Drive inventory browsing functions
export const getDriveCounties = async () => {
  try {
    const response = await fetch('/api/drive/counties');
    return await response.json();
  } catch (error) {
    console.error('Error fetching Drive counties:', error);
    throw error;
  }
};

export const getDriveAgencies = async (county) => {
  try {
    const response = await fetch(`/api/drive/agencies/${encodeURIComponent(county)}`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching Drive agencies:', error);
    throw error;
  }
};

export const getDriveFiles = async (county, agency) => {
  try {
    const response = await fetch(`/api/drive/files/${encodeURIComponent(county)}/${encodeURIComponent(agency)}`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching Drive files:', error);
    throw error;
  }
};

// In api.js - Update the function
export const downloadDriveFile = async (fileId) => {
  try {
    console.log('🔄 Downloading file:', fileId);
    
    const response = await fetch('/api/drive/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId })
    });
    
    console.log('📡 Response status:', response.status);
    
    const responseText = await response.text();
    console.log('📡 Response text:', responseText.substring(0, 300));
    
    const data = JSON.parse(responseText);
    return data;
  } catch (error) {
    console.error('Error downloading Drive file:', error);
    throw error;
  }
};

// sample extractable docs from google drive
export const sampleExtractableDocuments = async (maxDocuments = 5) => {
  try {
    console.log('🎲 Sampling extractable documents...');
    
    const response = await fetch('/api/drive/sample-documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        max_documents: maxDocuments,
        max_attempts: 20 
      })
    });
    
    const data = await response.json();
    console.log('📊 Sampling result:', data);
    
    return data;
  } catch (error) {
    console.error('Error sampling documents:', error);
    throw error;
  }
};

// Get pre-generated questions for a document
export const getGeneratedQuestions = async (filename) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${filename}/generated-questions`);
    return response.data;
  } catch (error) {
    console.error('Error getting generated questions:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};