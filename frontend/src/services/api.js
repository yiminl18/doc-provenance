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

export const getDocumentLayout = async (filename) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${filename}/layout`);
    return response.data;
  } catch (error) {
    console.error('Error fetching document layout:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
}


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
// PDF Mappings APIs
// =============================================================================

/**
 * Get pre-computed PDF mappings for a document
 */
export const getDocumentMappings = async (documentId) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${documentId}/mappings`);
    return response.data;
  } catch (error) {
    console.error('Error fetching document mappings:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get index of all available document mappings
 */
export const getMappingsIndex = async () => {
  try {
    const response = await axios.get(`${API_URL}/mappings/index`);
    return response.data;
  } catch (error) {
    console.error('Error fetching mappings index:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get highlighting data for specific sentences using pre-computed mappings
 * This replaces the current getProvenanceHighlightingBoxes for documents with mappings
 */
export const getHighlightingFromMappings = async (filename, sentenceIds, currentPage) => {
  try {
    // Extract document ID from filename (remove .pdf extension)
    const documentId = filename.replace('.pdf', '');
    
    console.log(`🗺️ Getting highlights from mappings for ${documentId}, sentences:`, sentenceIds);
    
    // Get the pre-computed mappings
    const mappings = await getDocumentMappings(documentId);
    
    if (!mappings || typeof mappings !== 'object') {
      throw new Error('Invalid mappings format received');
    }
    
    // Extract highlights for the requested sentences on the current page
    const pageKey = currentPage.toString();
    const pageHighlights = {};
    
    if (mappings[pageKey]) {
      sentenceIds.forEach(sentenceId => {
        const sentenceKey = sentenceId.toString();
        if (mappings[pageKey][sentenceKey]) {
          const sentenceMapping = mappings[pageKey][sentenceKey];
          
          // Convert to the format expected by your existing highlighting code
          if (sentenceMapping.highlight_regions && sentenceMapping.highlight_regions.length > 0) {
            // Filter highlights to only include those on the current page
            const currentPageHighlights = sentenceMapping.highlight_regions.filter(region => 
              region.page === currentPage
            );
            
            if (currentPageHighlights.length > 0) {
              pageHighlights[sentenceId] = currentPageHighlights.map(region => {
                return {
                  page: region.page,
                  left: region.left,
                  top: region.top,
                  width: region.width,
                  height: region.height,
                  confidence: region.confidence || sentenceMapping.match_confidence || 0.8,
                  source: 'pre_computed_mapping',
                  match_type: region.match_type || 'mapping',
                  coordinate_system: 'pdfminer' // Mark the coordinate system
                };
              });
            } else {
              // No highlights on current page - this sentence spans other pages
              console.log(`📄 Sentence ${sentenceId} has no highlights on page ${currentPage} (spans other pages)`);
            }
          }
        }
      });
    }
    
    console.log(`✅ Found highlights for ${Object.keys(pageHighlights).length} sentences on page ${currentPage}`);
    
    return {
      success: true,
      bounding_boxes: pageHighlights,
      statistics: {
        total_boxes: Object.values(pageHighlights).reduce((sum, boxes) => sum + boxes.length, 0),
        pages_with_matches: Object.keys(pageHighlights).length > 0 ? 1 : 0,
        avg_confidence: Object.values(pageHighlights).length > 0 
          ? Object.values(pageHighlights).flat().reduce((sum, box) => sum + box.confidence, 0) / Object.values(pageHighlights).flat().length 
          : 0,
        coordinate_system: 'pre_computed_mapping',
        data_source: 'pre_computed_mapping'
      },
      data_source: 'pre_computed_mapping'
    };
    
  } catch (error) {
    console.error('❌ Error getting highlights from mappings:', error);
    throw error;
  }
};

// Add these functions to your api.js file

/**
 * Get simple provenance highlighting boxes using direct PDF.js text search
 */
export const getSimpleProvenanceBoxes = async (filename, options = {}) => {
  try {
    const payload = {
      sentence_ids: options.sentenceIds || [],
      provenance_text: options.provenanceText || '',
      page: options.currentPage || 1
    };
    
    console.log(`🎯 Getting simple highlighting for ${filename}:`, payload);
    
    const response = await axios.post(`${API_URL}/documents/${filename}/simple-provenance-boxes`, payload);
    
    if (response.data.success) {
      console.log(`✅ Simple highlighting successful: ${response.data.total_boxes} boxes`);
      return {
        success: true,
        bounding_boxes: response.data.bounding_boxes,
        statistics: {
          total_boxes: response.data.total_boxes,
          search_method: response.data.search_method,
          pages_with_matches: Object.keys(response.data.bounding_boxes).length
        }
      };
    } else {
      console.error(`❌ Simple highlighting failed: ${response.data.error}`);
      return { success: false, error: response.data.error };
    }
    
  } catch (error) {
    console.error('❌ Error in simple provenance boxes:', error);
    throw error;
  }
};

/**
 * Test simple highlighting with custom text
 */
export const testSimpleHighlighting = async (filename, testText) => {
  try {
    const response = await axios.post(`${API_URL}/documents/${filename}/test-simple-highlighting`, {
      test_text: testText
    });
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error in test highlighting:', error);
    throw error;
  }
};

/**
 * Preprocess a document for simple mappings
 */
export const preprocessSimpleMapping = async (filename) => {
  try {
    console.log(`🔄 Preprocessing simple mappings for ${filename}`);
    
    const response = await axios.post(`${API_URL}/documents/${filename}/preprocess-simple-mapping`);
    
    if (response.data.success) {
      console.log(`✅ Preprocessing completed: ${response.data.statistics.success_rate}% success rate`);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error in preprocessing:', error);
    throw error;
  }
};

/**
 * Batch preprocess multiple documents
 */
export const batchPreprocessSimpleMappings = async (maxDocuments = 10) => {
  try {
    console.log(`🔄 Batch preprocessing up to ${maxDocuments} documents`);
    
    const response = await axios.post(`${API_URL}/batch-preprocess-simple-mappings`, {
      max_documents: maxDocuments
    });
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error in batch preprocessing:', error);
    throw error;
  }
};

/**
 * Enhanced version of existing getProvenanceHighlightingBoxes that tries simple method first
 */
export const getProvenanceHighlightingBoxesEnhanced = async (filename, sentenceIds, provenanceId = null, provenanceText = null, currentPage = 1) => {
  try {
    console.log(`🎯 Enhanced highlighting for ${filename}`);
    
    // Try simple method first if we have provenance text
    if (provenanceText && provenanceText.length > 10) {
      try {
        console.log(`🔄 Trying simple method first...`);
        
        const simpleResult = await getSimpleProvenanceBoxes(filename, {
          provenanceText: provenanceText,
          currentPage: currentPage
        });
        
        if (simpleResult.success && simpleResult.statistics.total_boxes > 0) {
          console.log(`✅ Simple method succeeded with ${simpleResult.statistics.total_boxes} boxes`);
          return {
            ...simpleResult,
            method_used: 'simple_pdfjs_search',
            sentence_ids: sentenceIds // Include for compatibility
          };
        }
      } catch (simpleError) {
        console.log(`⚠️ Simple method failed, falling back to complex method`);
      }
    }
    
    // Fallback to existing complex method
    console.log(`🔄 Using complex highlighting method`);
    
    // Use existing getProvenanceHighlightingBoxes function
    const complexResult = await getProvenanceHighlightingBoxes(filename, sentenceIds, provenanceId, provenanceText);
    
    if (complexResult) {
      return {
        ...complexResult,
        method_used: 'complex_coordinate_mapping'
      };
    }
    
    // Final fallback: try simple method with sentence IDs
    if (sentenceIds && sentenceIds.length > 0) {
      console.log(`🔄 Final fallback: simple method with sentence IDs`);
      
      const fallbackResult = await getSimpleProvenanceBoxes(filename, {
        sentenceIds: sentenceIds,
        currentPage: currentPage
      });
      
      if (fallbackResult.success) {
        return {
          ...fallbackResult,
          method_used: 'simple_sentence_lookup'
        };
      }
    }
    
    // No method worked
    return {
      success: false,
      error: 'All highlighting methods failed',
      bounding_boxes: {},
      statistics: { total_boxes: 0 }
    };
    
  } catch (error) {
    console.error('❌ Error in enhanced highlighting:', error);
    throw error;
  }
};

/**
 * Simple utility to check if a document has simple mappings preprocessed
 */
export const hasSimpleMappings = async (filename) => {
  try {
    // Try to load a small test to see if mappings exist
    const testResult = await testSimpleHighlighting(filename, 'test');
    return testResult.success;
  } catch (error) {
    return false;
  }
};

/**
 * Get statistics about simple mapping quality for a document
 */
export const getSimpleMappingStats = async (filename) => {
  try {
    // This could be enhanced to return actual stats if you store them
    const testResult = await testSimpleHighlighting(filename, 'the and of in to');
    
    return {
      available: testResult.success,
      total_boxes: testResult.total_boxes || 0,
      pages_with_matches: testResult.pages_with_matches || 0,
      best_confidence: testResult.best_confidence || 0
    };
    
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
};




/**
 * Enhanced provenance highlighting that tries mappings first, then falls back to API
 */
export const getProvenanceHighlightingBoxes = async (filename, sentenceIds, provenanceId = null, provenanceText = null) => {
  try {
    console.log(`🎯 Enhanced highlighting for ${filename}`);
    
    // First, try to get highlights from pre-computed mappings
    try {
      const currentPage = 1; // You'll need to pass this from your component
      const mappingsResult = await getHighlightingFromMappings(filename, sentenceIds, currentPage);
      
      if (mappingsResult.success && Object.keys(mappingsResult.bounding_boxes).length > 0) {
        console.log(`✅ Using pre-computed mappings for ${filename}`);
        return mappingsResult;
      }
    } catch (mappingsError) {
      console.log(`⚠️ Mappings not available for ${filename}, falling back to API`);
    }
    
    // Fallback to existing API-based highlighting
    console.log(`🔄 Falling back to API-based highlighting for ${filename}`);
    return await getProvenanceHighlightingBoxes(filename, sentenceIds, provenanceId, provenanceText);
    
  } catch (error) {
    console.error('❌ Error in enhanced highlighting:', error);
    throw error;
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