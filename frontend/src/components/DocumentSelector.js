import React, { useRef } from 'react';
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
import { faGoogleDrive } from '@fortawesome/free-brands-svg-icons';

const DocumentSelector = ({ 
  onDocumentUpload, 
  onShowPreloaded, 
  onShowDrive,
  uploadProgress,
  compactMode = false,
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

  const handleDriveClick = () => {
    if (disabled) return;
    onShowDrive();
  };

  if (compactMode) {
    return (
      <div className="document-selector compact">

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
            className={`action-btn compact upload ${disabled ? 'disabled' : ''}`}
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
          
          {/* Browse Button - Updated */}
          <button 
            className={`action-btn compact browse ${disabled ? 'disabled' : ''}`}
            onClick={handleBrowseClick}
            disabled={disabled}
          >
            <FontAwesomeIcon icon={disabled ? faSpinner : faDatabase} spin={disabled} />
            <span>Browse Documents</span>
          </button>

           {/* drive Button - Updated */}
          <button 
            className={`action-btn compact drive ${disabled ? 'disabled' : ''}`}
            onClick={handleDriveClick}
            disabled={disabled}
          >
            <FontAwesomeIcon icon={disabled ? faSpinner : faDatabase} spin={disabled} />
            <span>Connect to GDrive</span>
          </button>
        </div>
      </div>
    );
  }

  // Full mode for empty state
  return (
    <div className="document-selector">


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

  {/* Additional Info - Updated */}
        <div className="document-info">
          <div className="info-section">
            <h5>📄 Supported Format</h5>
            <p>PDF documents up to 50MB</p>
          </div>
          
          <div className="info-section">
            <h5>🔍 Analysis Features</h5>
            <p>Question answering with document provenance</p>
          </div>
          
          <div className="info-section">
            <h5>📋 Session Documents</h5>
            <p>Research papers and uploaded documents available in your session</p>
          </div>
        </div>

        <div className="document-selector-section">
          {/* Upload Button */}
          <button 
            className={`action-btn upload ${disabled ? 'disabled' : ''}`}
            onClick={handleUploadClick}
            disabled={disabled}
            title={disabled ? 'Session initializing, please wait...' : 'Upload PDF'}
          >
            <FontAwesomeIcon 
              icon={disabled ? faSpinner : faUpload} 
              spin={disabled}
              size="lg" 
            />
            <div className="btn-content">
              <span className="btn-title">Upload PDF</span>
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
          
          {/* Browse Button - Updated */}
          <button 
            className={`action-btn browse ${disabled ? 'disabled' : ''}`}
            onClick={handleBrowseClick}
            disabled={disabled}
            title={disabled ? 'Session initializing, please wait...' : 'Browse documents'}
          >
            <FontAwesomeIcon 
              icon={disabled ? faSpinner : faDatabase} 
              spin={disabled}
              size="lg" 
            />
            <div className="btn-content">
              <span className="btn-title">Browse Documents</span>
           
            </div>
          </button>

          {/* drive Button - Updated */}
          <button 
            className={`action-btn drive ${disabled ? 'disabled' : ''}`}
            onClick={handleDriveClick}
            disabled={disabled}
          >
            <FontAwesomeIcon 
              icon= {disabled ? faSpinner : faGoogleDrive}
              spin={disabled}
              size="lg"
            />
            <div className="btn-content">
              <span className="btn-title">Browse GDrive</span>
           
            </div>
          </button>
        </div>

      
      </div>

      {/* Processing Status */}
      {disabled && (
        <div className="processing-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>Initializing document analysis...</span>
        </div>
      )}
    </div>
  );
};

export default DocumentSelector;