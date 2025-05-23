import React, { useState, useRef } from 'react';
import '../styles/InputArea.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faArrowUp, faFileAlt } from '@fortawesome/free-solid-svg-icons';
import { 
  uploadFile, 
  askQuestion, 
  fetchSentences, 
  checkProgress as apiCheckProgress, 
  getResults as apiGetResults, 
  checkStatus 
} from '../services/api';

const InputArea = ({
  activeDocument,
  onDocumentCreate,
  onQuestionAdd,
  onQuestionUpdate
}) => {
  const [questionText, setQuestionText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputRef = useRef(null);
  const pollingIntervals = useRef(new Map()); // Track polling for each question

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadProgress({
      success: false,
      message: `Uploading ${file.name}...`
    });

    try {
      const response = await uploadFile(formData);
      
      // Create new document environment
      const docId = onDocumentCreate(response.filename);
      
      setUploadProgress({
        success: true,
        message: `${response.filename} uploaded successfully`
      });

      // Clear upload progress after a delay
      setTimeout(() => setUploadProgress(null), 3000);

    } catch (error) {
      setUploadProgress({
        success: false,
        message: `Error: ${error.message}`
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendQuestion = async () => {
    if (!questionText.trim() || !activeDocument) return;

    // Check if there's already a processing question
    const processingQuestion = Array.from(activeDocument.questions.values())
      .find(q => q.isProcessing);
    
    if (processingQuestion) {
      // Don't allow new questions while processing
      return;
    }

    try {
      const response = await askQuestion(questionText, activeDocument.filename);
      
      // Add question to document
      onQuestionAdd(questionText, response.question_id);
      
      // Start polling for this question
      startPolling(response.question_id);
      
      // Clear input
      setQuestionText('');

    } catch (error) {
      console.error('Error sending question:', error);
      // You might want to show an error message to the user
    }
  };

  const startPolling = (questionId) => {
    // Clear any existing polling for this question
    if (pollingIntervals.current.has(questionId)) {
      clearInterval(pollingIntervals.current.get(questionId));
    }

    // Set up new polling
    const interval = setInterval(async () => {
      try {
        // Check progress
        const progress = await checkProgress(questionId);
        
        // Check if fully complete
        const status = await checkStatus(questionId);
        
        if (status.completed) {
          // Get final results
          await getFullResults(questionId);
          
          // Stop polling
          clearInterval(interval);
          pollingIntervals.current.delete(questionId);
          
          // Mark as not processing
          onQuestionUpdate(questionId, { isProcessing: false });
        }
      } catch (error) {
        console.error('Error checking progress:', error);
        // Continue polling even on error, but maybe limit retries
      }
    }, 1000);

    pollingIntervals.current.set(questionId, interval);
  };

  const checkProgress = async (questionId) => {
    try {
      const data = await apiCheckProgress(questionId);
      
      // Update logs if available
      if (data.logs && data.logs.length > 0) {
        onQuestionUpdate(questionId, { logs: data.logs });
      }
      
      // If processing is done and we have data, update provenance
      if (data.done && data.data && data.data.length > 0) {
        await updateProvenanceSources(questionId, data.data);
        
        // Try to get answer
        await getResults(questionId);
      }
      
      return data;
    } catch (error) {
      console.error('Error checking progress:', error);
      return { progress: 0, done: false };
    }
  };

  const getResults = async (questionId) => {
    try {
      const data = await apiGetResults(questionId);
      
      if (data.success && data.answer) {
        onQuestionUpdate(questionId, { answer: data.answer });
      }
    } catch (error) {
      console.error('Error getting results:', error);
    }
  };
  
  const getFullResults = async (questionId) => {
    try {
      const data = await apiGetResults(questionId);
      
      if (data.success) {
        const updates = {};
        
        if (data.answer) {
          updates.answer = data.answer;
        }
        
        if (data.provenance && data.provenance.length > 0) {
          await updateProvenanceSources(questionId, data.provenance);
        }
        
        onQuestionUpdate(questionId, updates);
      }
    } catch (error) {
      console.error('Error getting full results:', error);
    }
  };

  const updateProvenanceSources = async (questionId, provenance) => {
    const provenanceArray = Array.isArray(provenance) ? provenance : [];
    
    if (provenanceArray.length === 0) {
      console.warn('No provenance data available');
      return;
    }
    
    // Collect all unique sentence IDs
    const allSentenceIds = new Set();
    provenanceArray.forEach(source => {
      if (source.sentences_ids) {
        source.sentences_ids.forEach(id => allSentenceIds.add(id));
      }
    });
    
    // Fetch all sentences at once
    let sentencesData = {};
    if (allSentenceIds.size > 0) {
      try {
        const response = await fetchSentences(questionId, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching sentences:', error);
      }
    }
    
    // Map sentences to each provenance entry
    const enhancedProvenance = provenanceArray.map(source => {
      if (!source.sentences_ids || source.sentences_ids.length === 0) {
        return source;
      }
      
      const content = source.sentences_ids.map(id => 
        sentencesData[id] || `[Sentence ${id} not found]`
      );
      
      return { ...source, content };
    });
    
    // Sort by provenance_id
    const sortedProvenance = enhancedProvenance.sort((a, b) => 
      (a.provenance_id !== undefined && b.provenance_id !== undefined) 
        ? a.provenance_id - b.provenance_id 
        : 0
    );
    
    onQuestionUpdate(questionId, { provenanceSources: sortedProvenance });
  };

  const isProcessing = activeDocument && Array.from(activeDocument.questions.values())
    .some(q => q.isProcessing);

  return (
    <div className="input-area">
      {/* Upload Progress */}
      {uploadProgress && (
        <div className="upload-progress">
          <div className={`progress-message ${uploadProgress.success ? 'success' : 'error'}`}>
            {uploadProgress.message}
          </div>
        </div>
      )}

      {/* Active Document Indicator */}
      {activeDocument && (
        <div className="active-document">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>{activeDocument.filename}</span>
        </div>
      )}

      {/* Input Controls */}
      <div className="input-controls">
        <label htmlFor="file-upload" className="upload-btn">
          <FontAwesomeIcon icon={faUpload} />
        </label>
        <input
          ref={fileInputRef}
          id="file-upload"
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
        
        <div className="input-container">
          <input
            className="question-input"
            type="text"
            placeholder={
              activeDocument 
                ? (isProcessing ? "Processing previous question..." : "Ask a question about this document...")
                : "Upload a PDF to get started"
            }
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendQuestion()}
            disabled={!activeDocument || isProcessing}
          />
          <button
            className="send-btn"
            onClick={handleSendQuestion}
            disabled={!activeDocument || !questionText.trim() || isProcessing}
          >
            <FontAwesomeIcon icon={faArrowUp} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputArea;