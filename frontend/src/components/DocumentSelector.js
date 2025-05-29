import React, { useRef } from 'react';
import '../styles/brutalist-design.css';
import '../styles/document-selector.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUpload, 
  faFileAlt, 
  faSearch, 
  faSpinner,
  faCheckCircle,
  faExclamationTriangle,
  faDatabase
} from '@fortawesome/free-solid-svg-icons';

const DocumentSelector = ({ 
  onDocumentUpload, 
  onShowPreloaded,
  uploadProgress,
  compactMode = false,
  currentSession,
  disabled = false
}) => {
  const fileInputRef = useRef(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    
    try {
      await onDocumentUpload(formData);
    } catch (error) {
      console.error('Upload failed:', error);
    }

    // Clear the input to allow same file re-upload
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleBrowseClick = () => {
    if (disabled) return;
    onShowPreloaded();
  };

  if (compactMode) {
    return (
      <div className="document-selector compact">
        {/* Session Info */}
        {currentSession && (
          <div className="session-info compact">
            <span className="session-label">
              Session: {currentSession.session_id?.split('_')[1] || 'Active'}
            </span>
          </div>
        )}

        {/* Upload Progress */}
        {uploadProgress && (
          <div className={`upload-status compact ${uploadProgress.success ? 'success' : 'error'}`}>
            <FontAwesomeIcon 
              icon={uploadProgress.success ? faCheckCircle : faExclamationTriangle} 
            />
            <span>{uploadProgress.message}</span>
          </div>
        )}

        <div className="document-controls compact">
          {/* Upload Button */}
          <button 
            className={`upload-btn compact ${disabled ? 'disabled' : ''}`}
            onClick={handleUploadClick}
            disabled={disabled}
            title={disabled ? 'Session not ready' : 'Upload PDF Document'}
          >
            <FontAwesomeIcon icon={disabled ? faSpinner : faUpload} spin={disabled} />
            <span>Upload PDF</span>
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
            disabled={disabled}
          />
          
          {/* Browse Button */}
          <button 
            className={`browse-btn compact ${disabled ? 'disabled' : ''}`}
            onClick={handleBrowseClick}
            disabled={disabled}
            title={disabled ? 'Session not ready' : 'Browse Research Papers'}
          >
            <FontAwesomeIcon icon={disabled ? faSpinner : faDatabase} spin={disabled} />
            <span>Browse Papers</span>
          </button>
        </div>
      </div>
    );
  }

  // Full mode for empty state
  return (
    <div className="document-selector">
      {/* Session Status */}
      {currentSession && (
        <div className="session-status">
          <div className="session-info-full">
            <h4>Document Analysis Session</h4>
            <div className="session-details">
              <span className="session-id">
                Session ID: {currentSession.session_id?.split('_')[1] || 'Unknown'}
              </span>
              <span className="session-ready">
                {disabled ? '⏳ Initializing...' : '✅ Ready for documents'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress && (
        <div className={`upload-status ${uploadProgress.success ? 'success' : 'error'}`}>
          <div className="status-content">
            <FontAwesomeIcon 
              icon={uploadProgress.success ? faCheckCircle : faExclamationTriangle} 
              size="lg"
            />
            <div className="status-text">
              <div className="status-message">{uploadProgress.message}</div>
              {uploadProgress.success && (
                <div className="status-hint">Document ready for analysis</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Controls */}
      <div className="document-controls">
        <div className="primary-actions">
          {/* Upload Button */}
          <button 
            className={`upload-btn primary ${disabled ? 'disabled' : ''}`}
            onClick={handleUploadClick}
            disabled={disabled}
            title={disabled ? 'Session initializing, please wait...' : 'Upload your PDF document'}
          >
            <FontAwesomeIcon 
              icon={disabled ? faSpinner : faUpload} 
              spin={disabled}
              size="lg" 
            />
            <div className="btn-content">
              <span className="btn-title">Upload Your PDF</span>
              <span className="btn-subtitle">
                {disabled ? 'Session initializing...' : 'Drag & drop or click to select'}
              </span>
            </div>
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
            disabled={disabled}
          />
          
          {/* Browse Button */}
          <button 
            className={`browse-btn secondary ${disabled ? 'disabled' : ''}`}
            onClick={handleBrowseClick}
            disabled={disabled}
            title={disabled ? 'Session initializing, please wait...' : 'Browse preloaded research papers'}
          >
            <FontAwesomeIcon 
              icon={disabled ? faSpinner : faDatabase} 
              spin={disabled}
              size="lg" 
            />
            <div className="btn-content">
              <span className="btn-title">Browse Research Papers</span>
              <span className="btn-subtitle">
                {disabled ? 'Loading papers...' : 'Select from our collection'}
              </span>
            </div>
          </button>
        </div>

        {/* Additional Info */}
        <div className="document-info">
          <div className="info-section">
            <h5>📄 Supported Format</h5>
            <p>PDF documents up to 50MB</p>
          </div>
          
          <div className="info-section">
            <h5>🔍 Analysis Features</h5>
            <p>Question answering with evidence-based provenance</p>
          </div>
          
          <div className="info-section">
            <h5>🎯 Best Results</h5>
            <p>Research papers, reports, and academic documents</p>
          </div>
        </div>
      </div>

      {/* Processing Status */}
      {disabled && (
        <div className="processing-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>Initializing document analysis session...</span>
        </div>
      )}
    </div>
  );
};

export default DocumentSelector;