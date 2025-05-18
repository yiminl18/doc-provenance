import React, { useState, useRef } from 'react';
import '../styles/InputArea.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faArrowUp } from '@fortawesome/free-solid-svg-icons';
import { uploadFile, askQuestion, fetchSentences, checkProgress as apiCheckProgress, getResults as apiGetResults, checkStatus } from '../services/api';

const InputArea = ({
  currentFile,
  setCurrentFile,
  setUploadStatus,
  isProcessing,
  setIsProcessing,
  setCurrentQuestion,
  setCurrentQuestionId,
  setProvenanceSources,
  setAnswer,
  setLogs
}) => {
  const [questionText, setQuestionText] = useState('');
  const fileInputRef = useRef(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadStatus({
      success: false,
      message: `Uploading ${file.name}...`
    });

    try {
      const response = await uploadFile(formData);
      setCurrentFile(response.filename);
      setUploadStatus({
        success: true,
        message: `${response.filename} uploaded successfully`
      });
    } catch (error) {
      setUploadStatus({
        success: false,
        message: `Error: ${error.message}`
      });
    }
  };

  const handleSendQuestion = async () => {
    if (!questionText.trim() || !currentFile || isProcessing) return;

    setCurrentQuestion(questionText);
    setAnswer(null);
    setProvenanceSources([]);
    setLogs([]);
    setIsProcessing(true);

    try {
      const response = await askQuestion(questionText, currentFile);
      setCurrentQuestionId(response.question_id);
      startPolling(response.question_id);
    } catch (error) {
      setAnswer(`Error: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const startPolling = (questionId) => {
    // Clear any existing polling
    if (pollingInterval) clearInterval(pollingInterval);

    // Set up new polling
    const interval = setInterval(async () => {
      try {
        // First check logs progress
        const progress = await checkProgress(questionId);
        
        // Then check if full processing is complete
        const status = await checkStatus(questionId);
        console.log('Processing status:', status);
        
        if (status.completed) {
          // If processing is complete, fetch final results
          await getFullResults(questionId);
          clearInterval(interval);
          setIsProcessing(false);
        }
      } catch (error) {
        console.error('Error checking progress:', error);
      }
    }, 1000);

    setPollingInterval(interval);
  };

  const checkProgress = async (questionId) => {
    try {
      const data = await apiCheckProgress(questionId);
      
      // Update logs if available
      if (data.logs && data.logs.length > 0) {
        setLogs(data.logs);
      }
      
      // If processing is done, fetch intermediate results
      if (data.done && data.data && data.data.length > 0) {
        updateProvenanceSources(questionId, data.data);
        
        // If we have an answer, show it
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
      
      if (data.success) {
        if (data.answer) {
          setAnswer(data.answer);
        }
      }
    } catch (error) {
      console.error('Error getting results:', error);
    }
  };
  
  const getFullResults = async (questionId) => {
    try {
      const data = await apiGetResults(questionId);
      
      if (data.success) {
        if (data.answer) {
          setAnswer(data.answer);
        }
        
        if (data.provenance && data.provenance.length > 0) {
          // When we have the full results, fetch all sentences
          await updateProvenanceSources(questionId, data.provenance);
        }
      }
    } catch (error) {
      console.error('Error getting full results:', error);
    }
  };

  const updateProvenanceSources = async (questionId, provenance) => {
    // Make sure provenance is an array
    const provenanceArray = Array.isArray(provenance) ? provenance : [];
    
    if (provenanceArray.length === 0) {
      console.warn('No provenance data available');
      return;
    }
    
    console.log('Updating provenance sources:', provenanceArray);
    
    // Collect all unique sentence IDs from all provenance entries
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
        console.log('Fetching all sentences:', Array.from(allSentenceIds));
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
      
      // Create content array for this provenance entry
      const content = source.sentences_ids.map(id => 
        sentencesData[id] || `[Sentence ${id} not found]`
      );
      
      return {
        ...source,
        content
      };
    });
    
    // Sort by provenance_id
    const sortedProvenance = enhancedProvenance.sort((a, b) => 
      (a.provenance_id !== undefined && b.provenance_id !== undefined) 
        ? a.provenance_id - b.provenance_id 
        : 0
    );
    
    console.log('Setting provenance sources:', sortedProvenance);
    setProvenanceSources(sortedProvenance);
  };

  return (
    <div className="input-area">
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
          placeholder="When was this paper published?"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendQuestion()}
          disabled={!currentFile || isProcessing}
        />
        <button
          className="send-btn"
          onClick={handleSendQuestion}
          disabled={!currentFile || !questionText.trim() || isProcessing}
        >
          <FontAwesomeIcon icon={faArrowUp} />
        </button>
      </div>
    </div>
  );
};

export default InputArea; 