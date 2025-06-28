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



export const getPdfJSCache = async (filename, pageNum) => {
  try {
    const pages = Array.isArray(pageNum) ? pageNum.join(',') : pageNum;
    const response = await axios.get(`${API_URL}/documents/${filename}/pdfjs-cache?pages=${pages}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching PDF.js cache:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

/**
 * Get pre-computed PDF mappings for a document
 */
export const getDocumentMappings = async (filename) => {
  try {
    const response = await axios.get(`${API_URL}/documents/${filename}/mappings/sentences`);
    const mappings = response.data;
    console.log('Sentence mappings for document:', filename, mappings);
    return response.data;
  } catch (error) {
    console.error('Error fetching document mappings:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const getSentenceItemMappings = async (filename, sentenceIds) => {
  try {
    const ids = Array.isArray(sentenceIds) ? sentenceIds.join(',') : sentenceIds;
    const response = await axios.get(
      `${API_URL}/documents/${filename}/sentence-items-enhanced?ids=${ids}`
    );
    console.log('✅ Received stable mappings:', {
            success: response.data.success,
            summary: response.data.quality_metrics
        });

    return response.data;
  } catch (error) {
    console.error('Error fetching sentence element mappings:', error);
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

    if (response.data.success && response.data.provenance) {
            console.log('✅ Received provenance with coordinate data:', {
                provenanceId: response.data.provenance.provenance_id,
                hasCoordinates: response.data.provenance.hasCoordinateData,
                coordinatePages: response.data.provenance.coordinate_highlights ? 
                    Object.keys(response.data.provenance.coordinate_highlights) : [],
                sentenceIds: response.data.provenance.provenance_ids
            });
        }


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

// Initialize the provisional case sampler
export const initProvisionalSampler = async () => {
  try {
    const response = await fetch('/api/drive/pvc-sample/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error initializing provisional sampler:', error);
    throw error;
  }
};

// Get available provisional cases (for debugging/stats, not for UI display)
export const getProvisionalCases = async () => {
  try {
    const response = await fetch('/api/drive/pvc-sample/cases');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting provisional cases:', error);
    throw error;
  }
};

// Sample documents from provisional cases
export const sampleProvisionalDocuments = async (params = {}) => {
  try {
    const response = await fetch('/api/drive/pvc-sample/get-documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target_count: params.target_count || 5,
        max_attempts: params.max_attempts || 20,
        prefer_diverse_cases: params.prefer_diverse_cases !== false,
        min_pages: params.min_pages || 2,
        ...params
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error sampling provisional documents:', error);
    throw error;
  }
};

// Get summary of downloaded files organized by county/agency
// This will need a new backend endpoint - see below
export const getSampledDocumentsSummary = async () => {
  try {
    const response = await fetch('/api/drive/pvc-sample/downloaded-summary');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting sampled documents summary:', error);
    throw error;
  }
};

// Updated function to replace the old drive browser calls
// This organizes sampled documents by county for the UI
export const getPvcSampleCounties = async () => {
  try {
    const summary = await getSampledDocumentsSummary();
    
    if (!summary.success) {
      return { success: false, error: summary.error };
    }
    
    // Group sampled documents by county
    const countiesByName = {};
    
    Object.entries(summary.cases || {}).forEach(([provisional_case, caseData]) => {
      caseData.files.forEach(file => {
        const county = file.metadata?.county || 'Unknown County';
        
        if (!countiesByName[county]) {
          countiesByName[county] = {
            name: county,
            originalName: county,
            displayName: county,
            pdf_count: 0,
            provisional_cases: new Set(),
            files: []
          };
        }
        
        countiesByName[county].pdf_count += 1;
        countiesByName[county].provisional_cases.add(provisional_case);
        countiesByName[county].files.push({
          ...file,
          provisional_case_name: provisional_case
        });
      });
    });
    
    // Convert to array and calculate avg_pages
    const counties = Object.values(countiesByName).map(county => ({
      ...county,
      provisional_cases: Array.from(county.provisional_cases),
      avg_pages: county.files.reduce((sum, file) => sum + (file.metadata?.page_count || 0), 0) / county.files.length
    }));
    
    return {
      success: true,
      counties: counties.sort((a, b) => a.displayName.localeCompare(b.displayName))
    };
  } catch (error) {
    console.error('Error getting PVC sample counties:', error);
    return { success: false, error: error.message };
  }
};

// Get agencies for a specific county from sampled documents
export const getPvcSampleAgencies = async (countyName) => {
  try {
    const summary = await getSampledDocumentsSummary();
    
    if (!summary.success) {
      return { success: false, error: summary.error };
    }
    
    // Group files by agency within the specified county
    const agenciesByName = {};
    
    Object.entries(summary.cases || {}).forEach(([provisional_case, caseData]) => {
      caseData.files.forEach(file => {
        const fileCounty = file.metadata?.county || 'Unknown County';
        
        if (fileCounty === countyName) {
          const agency = file.metadata?.agency || 'Unknown Agency';
          
          if (!agenciesByName[agency]) {
            agenciesByName[agency] = {
              name: agency,
              pdf_count: 0,
              subject_count: new Set(),
              files: []
            };
          }
          
          agenciesByName[agency].pdf_count += 1;
          if (file.metadata?.subject) {
            agenciesByName[agency].subject_count.add(file.metadata.subject);
          }
          agenciesByName[agency].files.push({
            ...file,
            provisional_case_name: provisional_case
          });
        }
      });
    });
    
    // Convert to array
    const agencies = Object.values(agenciesByName).map(agency => ({
      ...agency,
      subject_count: agency.subject_count.size
    }));
    
    return {
      success: true,
      agencies: agencies.sort((a, b) => a.name.localeCompare(b.name))
    };
  } catch (error) {
    console.error('Error getting PVC sample agencies:', error);
    return { success: false, error: error.message };
  }
};

// Get files for a specific county/agency from sampled documents
export const getPvcSampleFiles = async (countyName, agencyName) => {
  try {
    const summary = await getSampledDocumentsSummary();
    
    if (!summary.success) {
      return { success: false, error: summary.error };
    }
    
    const files = [];
    
    Object.entries(summary.cases || {}).forEach(([provisional_case, caseData]) => {
      caseData.files.forEach(file => {
        const fileCounty = file.metadata?.county || 'Unknown County';
        const fileAgency = file.metadata?.agency || 'Unknown Agency';
        
        if (fileCounty === countyName && fileAgency === agencyName) {
          files.push({
            ...file,
            provisional_case_name: provisional_case,
            // Map the fields to match the expected format
            name: file.filename,
            displayName: file.filename,
            file_id: file.gdrive_id,
            fullId: file.gdrive_id,
            path: file.full_path,
            page_num: file.metadata?.page_count || 0,
            estimated_size_kb: Math.round(file.size_bytes / 1024),
            subject: file.metadata?.subject || 'Unknown',
            incident_date: file.metadata?.incident_date,
            case_numbers: file.metadata?.case_numbers,
            county: fileCounty,
            agency: fileAgency
          });
        }
      });
    });
    
    return {
      success: true,
      files: files.sort((a, b) => a.displayName.localeCompare(b.displayName))
    };
  } catch (error) {
    console.error('Error getting PVC sample files:', error);
    return { success: false, error: error.message };
  }
};

// Download/select a sampled file (this might just return the local path)
export const downloadPvcSampleFile = async (fileId) => {
  try {
    // For sampled files, we might just need to return the local file info
    // since they're already downloaded. This depends on your backend implementation.
    
    const summary = await getSampledDocumentsSummary();
    
    if (!summary.success) {
      return { success: false, error: summary.error };
    }
    
    // Find the file in the summary
    let targetFile = null;
    let targetCase = null;
    
    Object.entries(summary.cases || {}).forEach(([provisional_case, caseData]) => {
      caseData.files.forEach(file => {
        if (file.gdrive_id === fileId) {
          targetFile = file;
          targetCase = provisional_case;
        }
      });
    });
    
    if (!targetFile) {
      return { success: false, error: 'File not found in sampled documents' };
    }
    
    return {
      success: true,
      filename: targetFile.filename,
      local_path: targetFile.full_path,
      provisional_case_name: targetCase,
      metadata: targetFile.metadata
    };
    
  } catch (error) {
    console.error('Error downloading PVC sample file:', error);
    return { success: false, error: error.message };
  }
};

// Update the existing sampleExtractableDocuments function to use the new endpoint
export const sampleExtractableDocuments = async (params = {}) => {
  // First, ensure the sampler is initialized
  try {
    const initResult = await initProvisionalSampler();
    if (!initResult.success) {
      throw new Error('Failed to initialize sampler: ' + initResult.error);
    }
  } catch (error) {
    // If init fails, still try to sample (maybe it's already initialized)
    console.warn('Sampler initialization warning:', error);
  }
  
  // Now sample documents
  return await sampleProvisionalDocuments(params);
};

export const getDriveStatus = async () => {
  try {
    const response = await fetch('/api/drive/status');
    return await response.json();
  } catch (error) {
    console.error('Error fetching drive status:', error);
    throw error;
  }
};

export const downloadDriveFile = async (fileId, provisionalCaseContext = null) => {
  try {
    console.log('🔄 Downloading file with context:', fileId, provisionalCaseContext);
    
    const payload = { file_id: fileId };
    if (provisionalCaseContext) {
      payload.context = provisionalCaseContext;
    }
    
    const response = await fetch('/api/drive/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.log('📡 Response status:', response.status);
    
    const responseText = await response.text();
    console.log('📡 Response text preview:', responseText.substring(0, 300));
    
    const data = JSON.parse(responseText);
    
    // Enhance response with provisional case info if available
    if (provisionalCaseContext) {
      data.provisional_case_context = provisionalCaseContext;
    }
    
    return data;
  } catch (error) {
    console.error('Error downloading Drive file:', error);
    throw error;
  }
};

// Utility function to check if the new provisional case endpoints are available
export const checkProvisionalCaseSupport = async () => {
  try {
    const response = await fetch('/api/drive/status');
    const data = await response.json();
    
    return {
      available: data.drive_services_available || false,
      provisional_cases_found: data.target_cases_found || 0,
      total_files: data.total_files_in_target_cases || 0
    };
  } catch (error) {
    console.warn('Provisional case support check failed:', error);
    return { available: false, error: error.message };
  }
};




// Get pre-generated questions for a document
export const getGeneratedQuestions = async (filename) => {
  try {
    const response = await axios.get(`${API_URL}/test-questions/${filename}`);
    return response.data;
  } catch (error) {
    console.error('Error getting generated questions:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

export const findSentenceMatches = async (targetSentence, elements) => {
  try {
    const response = await axios.post(`${API_URL}/find_sentence_matches`, {
      target_sentence: targetSentence,
      elements: elements
    });
    return response.data;
  } catch (error) {
    console.error('Error calling sentence matcher:', error);
    // Return a structured error response like your other endpoints
    return { 
      success: false, 
      error: error.response?.data?.error || error.message || 'Unknown error',
      matches: []
    };
  }
};