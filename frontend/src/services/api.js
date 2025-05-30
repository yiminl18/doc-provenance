import axios from 'axios';

// Base URL for API requests
const API_URL = '/api';  // Using the /api prefix for all API calls

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

// Ask a question about a document
export const askQuestion = async (question, filename) => {
  try {
    const response = await axios.post(`${API_URL}/ask`, {
      question,
      filename
    });
    console.log('Response from askQuestion:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error asking question:', error);
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

// Fetch sentences
export const fetchSentences = async (filename, sentenceIds) => {
  try {
    
    const response = await axios.get(`${API_URL}/documents/${filename}/sentences?ids=${sentenceIds.join(',')}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching sentences:', error);
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