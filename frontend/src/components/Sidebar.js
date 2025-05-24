import React from 'react';
import '../styles/brutalist-design.css';
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
  faUpload
} from '@fortawesome/free-solid-svg-icons';

const Sidebar = ({ 
  documents, 
  activeDocumentId, 
  onDocumentSelect, 
  onUploadNewDocument, // Changed from onNewQuestion
  theme 
}) => {
  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const getDocumentStats = (doc) => {
    const questions = Array.from(doc.questions.values());
    const totalQuestions = questions.length;
    const completedQuestions = questions.filter(q => !q.isProcessing && q.answer).length;
    const processingQuestions = questions.filter(q => q.isProcessing).length;
    const totalProvenances = questions.reduce((acc, q) => 
      acc + (q.provenanceSources ? q.provenanceSources.length : 0), 0
    );
    
    return { totalQuestions, completedQuestions, processingQuestions, totalProvenances };
  };

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
    <div className="sidebar">
      <div className="sidebar-content">
        <div className="logo">
          <FontAwesomeIcon icon={faRocket} style={{ marginRight: '8px' }} />
          PROVENANCE
        </div>
        
        {/* Changed from "New Question" to "Upload New Document" */}
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
                const stats = getDocumentStats(doc);
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
                        {stats.processingQuestions > 0 && (
                          <div className="status-indicator processing">
                            <FontAwesomeIcon icon={faClock} />
                          </div>
                        )}
                        {doc.uploadStatus && !doc.uploadStatus.success && (
                          <div className="status-indicator error" title={doc.uploadStatus.message}>
                            ⚠️
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="document-stats">
                      <div className="stat-row">
                        <div className="stat-item">
                          <FontAwesomeIcon icon={faQuestionCircle} />
                          <span className="stat-label">Q:</span>
                          <span className="stat-value">{stats.totalQuestions}</span>
                        </div>
                        
                        <div className="stat-item">
                          <FontAwesomeIcon icon={faFileAlt} />
                          <span className="stat-label">P:</span>
                          <span className="stat-value">{stats.totalProvenances}</span>
                        </div>
                      </div>
                      
                      {stats.completedQuestions > 0 && (
                        <div className="completion-bar">
                          <div 
                            className="completion-fill"
                            style={{ 
                              width: `${(stats.completedQuestions / stats.totalQuestions) * 100}%` 
                            }}
                          />
                        </div>
                      )}
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
        
        <div className="sidebar-nav">
          <div className="nav-item active">
            <FontAwesomeIcon icon={faFileAlt} />
            <span>Documents</span>
            <div className="nav-badge">{documentList.length}</div>
          </div>
          <div className="nav-item">
            <FontAwesomeIcon icon={faChartLine} />
            <span>Analytics</span>
            <div className="nav-badge">
              {documentList.reduce((acc, doc) => 
                acc + getDocumentStats(doc).totalQuestions, 0
              )}
            </div>
          </div>
        </div>
        
        <div className="system-info">
          <div className="info-line">
            <span className="info-label">Version:</span>
            <span className="info-value">Provenance v1.0</span>
          </div>
          <div className="info-line">
            <span className="info-label">Mode:</span>
            <span className="info-value">Research</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;