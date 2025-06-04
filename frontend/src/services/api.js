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

// Ask a question about a document (enhanced with library support)
export const askQuestion = async (question, filename, questionIdFromLibrary = null) => {
  try {
    const payload = {
      question,
      filename
    };
    
    // Include library question ID if this question came from the library
    if (questionIdFromLibrary) {
      payload.question_id = questionIdFromLibrary;
    }
    
    const response = await axios.post(`${API_URL}/ask`, payload);
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
// Question Library APIs
// =============================================================================

// Get the questions library
export const getQuestionsLibrary = async () => {
  try {
    const response = await axios.get(`${API_URL}/questions-library`);
    return response.data;
  } catch (error) {
    console.error('Error fetching questions library:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Add a question to the library
export const addQuestionToLibrary = async (questionData) => {
  try {
    const response = await axios.post(`${API_URL}/questions-library`, questionData);
    return response.data;
  } catch (error) {
    console.error('Error adding question to library:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Update a question in the library
export const updateQuestionInLibrary = async (questionId, questionData) => {
  try {
    const response = await axios.put(`${API_URL}/questions-library/${questionId}`, questionData);
    return response.data;
  } catch (error) {
    console.error('Error updating question in library:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Remove a question from the library
export const removeQuestionFromLibrary = async (questionId) => {
  try {
    const response = await axios.delete(`${API_URL}/questions-library/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error removing question from library:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// =============================================================================
// Helper Functions for Question Library
// =============================================================================

// Quick function to check if a question already exists in the library
export const checkQuestionExists = async (questionText) => {
  try {
    const library = await getQuestionsLibrary();
    if (library.success && library.library?.questions) {
      const normalizedQuestion = questionText.toLowerCase().trim();
      return library.library.questions.some(q => 
        q.text.toLowerCase().trim() === normalizedQuestion
      );
    }
    return false;
  } catch (error) {
    console.warn('Error checking if question exists:', error);
    return false;
  }
};

// Get popular questions from the library (most used)
export const getPopularQuestions = async (limit = 5) => {
  try {
    const library = await getQuestionsLibrary();
    if (library.success && library.library?.questions) {
      return library.library.questions
        .sort((a, b) => (b.use_count || 0) - (a.use_count || 0))
        .slice(0, limit);
    }
    return [];
  } catch (error) {
    console.warn('Error getting popular questions:', error);
    return [];
  }
};

// Get favorite questions from the library
export const getFavoriteQuestions = async () => {
  try {
    const library = await getQuestionsLibrary();
    if (library.success && library.library?.questions) {
      return library.library.questions.filter(q => q.is_favorite);
    }
    return [];
  } catch (error) {
    console.warn('Error getting favorite questions:', error);
    return [];
  }
};

// Get questions by category
export const getQuestionsByCategory = async (category) => {
  try {
    const library = await getQuestionsLibrary();
    if (library.success && library.library?.questions) {
      return library.library.questions.filter(q => q.category === category);
    }
    return [];
  } catch (error) {
    console.warn('Error getting questions by category:', error);
    return [];
  }
};

// =============================================================================
// Enhanced Question Processing with Decoupled Answer/Provenance
// =============================================================================

// Check if answer is ready for a question
export const checkAnswer = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/check-answer/${questionId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking answer:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

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

// Get comprehensive question status
export const getQuestionStatus = async (questionId) => {
  try {
    const response = await axios.get(`${API_URL}/question-status/${questionId}`);
    console.log('Response from getQuestionStatus:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error getting question status:', error);
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
// Enhanced Question Processing with Library Integration
// =============================================================================

// Ask a question with automatic library suggestion
export const askQuestionWithLibraryIntegration = async (
  question, 
  filename, 
  questionIdFromLibrary = null,
  autoAddToLibrary = false,
  category = 'Custom'
) => {
  try {
    // First, ask the question
    const result = await askQuestion(question, filename, questionIdFromLibrary);
    
    // If successful and auto-add is enabled, add to library
    if (result.success && autoAddToLibrary && !questionIdFromLibrary) {
      try {
        const exists = await checkQuestionExists(question);
        if (!exists) {
          await addQuestionToLibrary({
            question_text: question,
            category: category,
            description: `Auto-added from ${filename}`,
            is_favorite: false
          });
          console.log('Question automatically added to library');
        }
      } catch (libraryError) {
        console.warn('Failed to auto-add question to library:', libraryError);
        // Don't fail the main operation if library addition fails
      }
    }
    
    return result;
  } catch (error) {
    throw error;
  }
};

// =============================================================================
// Batch Operations
// =============================================================================

// Ask multiple questions from library on a document
export const askMultipleQuestionsFromLibrary = async (filename, questionIds, onProgress) => {
  const results = [];
  const errors = [];
  
  for (let i = 0; i < questionIds.length; i++) {
    const questionId = questionIds[i];
    
    try {
      // Get the question text from library first
      const library = await getQuestionsLibrary();
      const question = library.library?.questions.find(q => q.id === questionId);
      
      if (!question) {
        errors.push({ questionId, error: 'Question not found in library' });
        continue;
      }
      
      // Report progress
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: questionIds.length,
          currentQuestion: question.text,
          status: 'processing'
        });
      }
      
      // Ask the question
      const result = await askQuestion(question.text, filename, questionId);
      results.push({
        questionId,
        questionText: question.text,
        result
      });
      
    } catch (error) {
      errors.push({ questionId, error: error.message });
    }
  }
  
  return { results, errors };
};

// gdrive APIs

// Add these functions to your existing api.js file

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

// In api.js - Add this new function
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