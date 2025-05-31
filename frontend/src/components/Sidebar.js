import React, { useState, useEffect } from 'react';
import '../styles/sidebar.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faPlus, 
  faRocket, 
  faFileAlt, 
  faChartLine, 
  faQuestionCircle,
  faCheck,
  faClock,
  faDatabase,
  faUpload,
  faBroom,
  faCog,
  faRefresh,
  faTrash
} from '@fortawesome/free-solid-svg-icons';

const Sidebar = ({ 
  documents, 
  activeDocumentId, 
  onDocumentSelect, 
  onUploadNewDocument
}) => {

  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const formatFileName = (filename) => {
    // Remove extension and truncate if too long
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    if (nameWithoutExt.length > 15) {
      return nameWithoutExt.substring(0, 12) + '...';
    }
    return nameWithoutExt;
  };

  const formatTimestamp = (date) => {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'NOW';
    if (diffMins < 60) return `${diffMins}M_AGO`;
    if (diffHours < 24) return `${diffHours}H_AGO`;
    if (diffDays < 7) return `${diffDays}D_AGO`;
    return date.toLocaleDateString().replace(/\//g, '.');
  };

  

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-content">
         
          {/* Upload New Document */}
          <button className="upload-new-document-btn" onClick={onUploadNewDocument}>
            <FontAwesomeIcon icon={faUpload} style={{ marginRight: '8px' }} />
            Upload New Document
          </button>
          
          <div className="documents-section">
            <div className="section-header">
              <FontAwesomeIcon icon={faDatabase} />
              <span className="section-title">Document Library</span>
              <div className="document-count">{documentList.length}</div>
            </div>
            
            <div className="documents-list">
              {documentList.length === 0 ? (
                <div className="empty-documents">
                  <div className="empty-icon">
                    <FontAwesomeIcon icon={faFileAlt} />
                  </div>
                  <div className="empty-text">
                    No Documents Uploaded
                    <br />
                    <span style={{ fontSize: '10px', color: 'var(--terminal-amber)' }}>
                      Upload PDF to begin analysis
                    </span>
                  </div>
                </div>
              ) : (
                documentList.map((doc) => {
                  const isActive = doc.id === activeDocumentId;
                  
                  return (
                    <div
                      key={doc.id}
                      className={`document-item ${isActive ? 'active' : ''}`}
                      onClick={() => onDocumentSelect(doc.id)}
                    >
                      <div className="document-header">
                        <div className="document-name" title={doc.filename}>
                          <FontAwesomeIcon icon={faFileAlt} />
                          <span>{formatFileName(doc.filename)}</span>
                          {doc.isPreloaded && (
                            <span className="preloaded-badge">📚</span>
                          )}
                        </div>
                        <div className="document-status">
                  
                          {doc.uploadStatus && !doc.uploadStatus.success && (
                            <div className="status-indicator error" title={doc.uploadStatus.message}>
                              ⚠️
                            </div>
                          )}
                        </div>
                      </div>
                      
                  
                      
                      <div className="document-timestamp">
                        {formatTimestamp(new Date(doc.createdAt))}
                      </div>

                      {/* Upload status indicator */}
                      {doc.uploadStatus && (
                        <div className={`upload-status ${doc.uploadStatus.success ? 'success' : 'error'}`}>
                          {doc.uploadStatus.success ? '✓' : '✗'} 
                          {doc.uploadStatus.success ? 'Ready' : 'Upload Failed'}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          

        </div>
      </div>



 
    </>
  );
};

export default Sidebar;