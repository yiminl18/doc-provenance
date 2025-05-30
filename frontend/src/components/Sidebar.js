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
import CleanupManager from './CleanupManager';
import { getSessionsStats, createNewSession } from '../services/api';

const Sidebar = ({ 
  documents, 
  activeDocumentId, 
  onDocumentSelect, 
  onUploadNewDocument,
  currentSessionId,
  onSessionChanged
}) => {
  const [showCleanupManager, setShowCleanupManager] = useState(false);
  const [sessionStats, setSessionStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  // Load session stats
  useEffect(() => {
    loadSessionStats();
  }, [currentSessionId]);

  const loadSessionStats = async () => {
    try {
      const stats = await getSessionsStats();
      setSessionStats(stats);
    } catch (error) {
      console.error('Error loading session stats:', error);
    }
  };

  const handleNewSession = async () => {
    try {
      setRefreshing(true);
      const response = await createNewSession();
      if (response.success) {
        // Notify parent component
        onSessionChanged?.(response.session_id);
        await loadSessionStats();
      }
    } catch (error) {
      console.error('Error creating new session:', error);
      alert('Failed to create new session');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCleanupComplete = async () => {
    // Refresh stats after cleanup
    await loadSessionStats();
    // Notify parent that session may have changed
    onSessionChanged?.(currentSessionId);
  };

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

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-content">
          {/* Session Info */}
          <div className="session-info">
            <div className="session-header">
              <FontAwesomeIcon icon={faRocket} />
              <span className="session-label">Current Session</span>
            </div>
            <div className="session-id">
              {currentSessionId ? currentSessionId.split('_')[1] : 'Loading...'}
            </div>
            {sessionStats && (
              <div className="session-stats-mini">
                <div className="mini-stat">
                  <span>{sessionStats.total_documents}</span>
                  <span>docs</span>
                </div>
                <div className="mini-stat">
                  <span>{sessionStats.total_questions}</span>
                  <span>questions</span>
                </div>
                <div className="mini-stat">
                  <span>{formatBytes(sessionStats.total_size_bytes)}</span>
                  <span>data</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Session Controls */}
          <div className="session-controls">
            <button 
              className="session-control-btn new-session"
              onClick={handleNewSession}
              disabled={refreshing}
            >
              <FontAwesomeIcon icon={refreshing ? faRefresh : faPlus} spin={refreshing} />
              <span>New Session</span>
            </button>
            
            <button 
              className="session-control-btn cleanup"
              onClick={() => setShowCleanupManager(true)}
            >
              <FontAwesomeIcon icon={faBroom} />
              <span>Manage Data</span>
            </button>
          </div>

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
            <div className="nav-item" onClick={() => setShowCleanupManager(true)}>
              <FontAwesomeIcon icon={faCog} />
              <span>Settings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cleanup Manager Modal */}
      {showCleanupManager && (
        <CleanupManager
          currentSessionId={currentSessionId}
          onSessionCleared={handleCleanupComplete}
          onClose={() => setShowCleanupManager(false)}
        />
      )}

      {/* Additional Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .session-info {
            background: #1a1a1a;
            padding: 15px;
            margin: 0 0 15px 0;
            border-radius: 6px;
            border: 1px solid #333;
          }
          
          .session-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }
          
          .session-label {
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .session-id {
            font-family: monospace;
            font-size: 14px;
            color: #00ff00;
            margin-bottom: 10px;
          }
          
          .session-stats-mini {
            display: flex;
            gap: 10px;
          }
          
          .mini-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            font-size: 10px;
          }
          
          .mini-stat span:first-child {
            font-weight: bold;
            color: #fff;
          }
          
          .mini-stat span:last-child {
            color: #888;
          }
          
          .session-controls {
            display: flex;
            gap: 8px;
            margin-bottom: 15px;
          }
          
          .session-control-btn {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid #333;
            background: #2a2a2a;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-size: 11px;
            transition: all 0.2s;
          }
          
          .session-control-btn:hover:not(:disabled) {
            background: #3a3a3a;
            border-color: #555;
          }
          
          .session-control-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .session-control-btn.new-session {
            border-color: #007bff;
            color: #007bff;
          }
          
          .session-control-btn.cleanup {
            border-color: #ffc107;
            color: #ffc107;
          }
          
          .nav-item {
            cursor: pointer;
            transition: background-color 0.2s;
          }
          
          .nav-item:hover {
            background: rgba(255, 255, 255, 0.1);
          }
        `
      }} />
    </>
  );
};

export default Sidebar;