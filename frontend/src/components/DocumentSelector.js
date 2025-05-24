import React, { useRef } from 'react';
import '../styles/brutalist-design.css';
import '../styles/document-selector.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpload, faFileAlt, faSearch } from '@fortawesome/free-solid-svg-icons';

const DocumentSelector = ({ 
  onDocumentUpload, 
  onShowPreloaded,
  uploadProgress,
  compactMode = false 
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

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (compactMode) {
    return (
      <div className="document-selector compact">
        {/* Upload Progress */}
        {uploadProgress && (
          <div className={`upload-status compact ${uploadProgress.success ? 'success' : 'error'}`}>
            {uploadProgress.message}
          </div>
        )}

        <div className="document-controls compact">
          {/* Upload Button */}
          <label htmlFor="file-upload-compact" className="upload-btn compact">
            <FontAwesomeIcon icon={faUpload} />
            Upload PDF
          </label>
          <input
            ref={fileInputRef}
            id="file-upload-compact"
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          
          {/* Browse Button */}
          <button className="browse-btn compact" onClick={onShowPreloaded}>
            <FontAwesomeIcon icon={faSearch} />
            Browse Papers
          </button>
        </div>
      </div>
    );
  }

  // Full mode for empty state
  return (
    <div className="document-selector">
      {uploadProgress && (
        <div className={`upload-status ${uploadProgress.success ? 'success' : 'error'}`}>
          {uploadProgress.message}
        </div>
      )}

      <div className="document-controls">
        <label htmlFor="file-upload" className="upload-btn primary">
          <FontAwesomeIcon icon={faUpload} />
          Upload Your PDF
        </label>
        <input
          ref={fileInputRef}
          id="file-upload"
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
        
        <button className="browse-btn secondary" onClick={onShowPreloaded}>
          <FontAwesomeIcon icon={faFileAlt} />
          Browse Research Papers
        </button>
      </div>
    </div>
  );
};

export default DocumentSelector;