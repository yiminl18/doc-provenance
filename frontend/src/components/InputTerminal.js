import React, { useState, useRef } from 'react';
import '../styles/brutalist-design.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faArrowRight, faFileAlt, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { 
  uploadFile, 
  askQuestion, 
  fetchSessionSentences, 
  checkSessionProgress, 
  getSessionResults, 
  checkSessionStatus 
} from '../services/api';

const InputTerminal = ({
  activeDocument,
  onDocumentCreate,
  onQuestionAdd,
  onQuestionUpdate,
  compactMode = false
}) => {
  const [questionText, setQuestionText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const fileInputRef = useRef(null);
  const pollingIntervals = useRef(new Map());

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadProgress({
      success: false,
      message: `Uploading: ${file.name}...`
    });

    try {
      const response = await uploadFile(formData);
      
      const docId = onDocumentCreate(response.filename, false); // false = not preloaded
      
      setUploadProgress({
        success: true,
        message: `Upload Complete: ${response.filename}`
      });

      setTimeout(() => setUploadProgress(null), 3000);

    } catch (error) {
      setUploadProgress({
        success: false,
        message: `Upload Error: ${error.message}`
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendQuestion = async () => {
    if (!questionText.trim() || !activeDocument) return;

    const processingQuestion = Array.from(activeDocument.questions.values())
      .find(q => q.isProcessing);
    
    if (processingQuestion) {
      return;
    }

    try {
      // Use the new session-based API - pass document IDs instead of filename
      const response = await askQuestion(questionText, [activeDocument.id]);
      
      onQuestionAdd(questionText, response.questionId);
      
      // Start polling with session IDs
      if (response.sessions && response.sessions.length > 0) {
        startPolling(response.questionId, response.sessions[0].sessionId);
      }
      
      setQuestionText('');

    } catch (error) {
      console.error('Error sending question:', error);
      setUploadProgress({
        success: false,
        message: `Query Error: ${error.message}`
      });
      setTimeout(() => setUploadProgress(null), 3000);
    }
  };

  const startPolling = (questionId, sessionId) => {
    if (pollingIntervals.current.has(questionId)) {
      clearInterval(pollingIntervals.current.get(questionId));
    }

    const interval = setInterval(async () => {
      try {
        const progress = await checkSessionProgress(sessionId);
        const status = await checkSessionStatus(sessionId);
        
        if (status.completed) {
          await getFullResults(questionId, sessionId);
          clearInterval(interval);
          pollingIntervals.current.delete(questionId);
          onQuestionUpdate(questionId, { isProcessing: false });
        }
      } catch (error) {
        console.error('Error checking progress:', error);
      }
    }, 1000);

    pollingIntervals.current.set(questionId, interval);
  };

  const checkProgress = async (questionId, sessionId) => {
    try {
      const data = await checkSessionProgress(sessionId);
      
      if (data.logs && data.logs.length > 0) {
        onQuestionUpdate(questionId, { logs: data.logs });
      }
      
      if (data.done && data.data && data.data.length > 0) {
        await updateProvenanceSources(questionId, sessionId, data.data);
        await getResults(questionId, sessionId);
      }
      
      return data;
    } catch (error) {
      console.error('Error checking progress:', error);
      return { progress: 0, done: false };
    }
  };

  const getResults = async (questionId, sessionId) => {
    try {
      const data = await getSessionResults(sessionId);
      
      if (data.success && data.answer) {
        onQuestionUpdate(questionId, { answer: data.answer });
      }
    } catch (error) {
      console.error('Error getting results:', error);
    }
  };
  
  const getFullResults = async (questionId, sessionId) => {
    try {
      const data = await getSessionResults(sessionId);
      
      if (data.success) {
        const updates = {};
        
        if (data.answer) {
          updates.answer = data.answer;
        }
        
        if (data.provenance && data.provenance.length > 0) {
          await updateProvenanceSources(questionId, sessionId, data.provenance);
        }
        
        onQuestionUpdate(questionId, updates);
      }
    } catch (error) {
      console.error('Error getting full results:', error);
    }
  };

  const updateProvenanceSources = async (questionId, sessionId, provenance) => {
    const provenanceArray = Array.isArray(provenance) ? provenance : [];
    
    if (provenanceArray.length === 0) {
      console.warn('No provenance data available');
      return;
    }
    
    const allSentenceIds = new Set();
    provenanceArray.forEach(source => {
      if (source.sentences_ids) {
        source.sentences_ids.forEach(id => allSentenceIds.add(id));
      }
    });
    
    let sentencesData = {};
    if (allSentenceIds.size > 0) {
      try {
        const response = await fetchSessionSentences(sessionId, Array.from(allSentenceIds));
        sentencesData = response.sentences || {};
      } catch (error) {
        console.error('Error fetching sentences:', error);
      }
    }
    
    const enhancedProvenance = provenanceArray.map(source => {
      if (!source.sentences_ids || source.sentences_ids.length === 0) {
        return source;
      }
      
      const content = source.sentences_ids.map(id => 
        sentencesData[id] || `[SENTENCE_${id}_NOT_FOUND]`
      );
      
      return { ...source, content };
    });
    
    const sortedProvenance = enhancedProvenance.sort((a, b) => 
      (a.provenance_id !== undefined && b.provenance_id !== undefined) 
        ? a.provenance_id - b.provenance_id 
        : 0
    );
    
    onQuestionUpdate(questionId, { provenanceSources: sortedProvenance });
  };

  const isProcessing = activeDocument && Array.from(activeDocument.questions.values())
    .some(q => q.isProcessing);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendQuestion();
    }
  };

  if (compactMode) {
    return (
      <div className="input-area compact">
        {/* Upload Progress */}
        {uploadProgress && (
          <div className={`upload-status compact ${uploadProgress.success ? 'success' : 'error'}`}>
            {uploadProgress.message}
          </div>
        )}

        {/* Active Document Indicator */}
        {activeDocument && (
          <div className="active-document compact">
            <FontAwesomeIcon icon={faFileAlt} />
            <span>{activeDocument.filename}</span>
          </div>
        )}

        {/* Compact Controls */}
        <div className="input-controls compact">
          {/* Upload Button */}
          <div className="upload-controls">
            <label htmlFor="file-upload" className="upload-btn">
              <FontAwesomeIcon icon={faUpload} />
              Upload PDF
            </label>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
          
          {/* Question Input */}
          <textarea
            className="question-input compact"
            placeholder={
              activeDocument 
                ? (isProcessing ? "Processing question..." : "Ask a question about this document...")
                : "Upload a PDF first"
            }
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!activeDocument || isProcessing}
            rows={3}
          />
          
          {/* Send Button */}
          <button
            className="send-btn compact"
            onClick={handleSendQuestion}
            disabled={!activeDocument || !questionText.trim() || isProcessing}
          >
            <FontAwesomeIcon icon={faPaperPlane} />
            {isProcessing ? 'Processing...' : 'Ask Question'}
          </button>
        </div>
      </div>
    );
  }

  // Original non-compact layout
  return (
    <div className="input-area">
      {uploadProgress && (
        <div className={`upload-status ${uploadProgress.success ? 'success' : 'error'}`}>
          {uploadProgress.message}
        </div>
      )}

      {activeDocument && (
        <div className="active-document">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>{activeDocument.filename}</span>
        </div>
      )}

      <div className="input-controls">
        <label htmlFor="file-upload" className="upload-btn" title="Upload PDF">
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
                ? (isProcessing ? "Processing question..." : "Ask a question about this document...")
                : "Upload a PDF to get started"
            }
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!activeDocument || isProcessing}
          />
          <button
            className="send-btn"
            onClick={handleSendQuestion}
            disabled={!activeDocument || !questionText.trim() || isProcessing}
            title="Send Query"
          >
            <FontAwesomeIcon icon={faArrowRight} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputTerminal;