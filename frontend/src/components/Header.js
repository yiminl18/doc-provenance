import React from 'react';
import '../styles/brutalist-design.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket, faTerminal, faFileAlt, faDatabase, faUpload } from '@fortawesome/free-solid-svg-icons';

const Header = ({ 
  activeDocument, 
  onShowPreloaded,
  onUploadDocument,
  currentSession,
  sessionStats 
}) => {

  const getSessionStatus = () => {
    if (!activeDocument) {
      return {
        status: "Ready for Questions",
        color: "var(--terminal-amber)"
      };
    }

    // Get questions from activeDocument if available
    const questions = activeDocument.questions ? Array.from(activeDocument.questions.values()) : [];
    const processing = questions.filter(q => q.isProcessing).length;
    const completed = questions.filter(q => !q.isProcessing && q.answer).length;
    
    if (processing > 0) {
      return {
        status: `Processing ${processing} questions...`,
        color: "var(--terminal-cyan)"
      };
    }
    
    if (completed > 0) {
      return {
        status: `Session Active - ${completed} completed`,
        color: "var(--terminal-green)"
      };
    }
    
    return {
      status: "Ready for Questions",
      color: "var(--terminal-amber)"
    };
  };

  const sessionStatus = getSessionStatus();

  // Session info display
  const getSessionInfo = () => {
    if (!currentSession) {
      return {
        id: 'No Session',
        stats: 'Initializing...'
      };
    }

    const stats = sessionStats || {};
    const totalQuestions = stats.total_questions || 0;
    const totalDocuments = stats.total_documents || 0;

    return {
      id: currentSession.session_id || 'Current Session',
      stats: `${totalDocuments} docs, ${totalQuestions} questions`
    };
  };

  const sessionInfo = getSessionInfo();

  return (
    <div className="app-header-compact">
      <div className="header-left">
        <div className="logo">
          <FontAwesomeIcon icon={faRocket} />
          <span>PROVENANCE</span>
        </div>
        
        <div className="session-status" style={{ color: sessionStatus.color }}>
          <FontAwesomeIcon icon={faTerminal} />
          <span>{sessionStatus.status}</span>
        </div>
      </div>
      
      <div className="header-right">
        {/* Document Actions */}
        <div className="document-actions">
          {activeDocument && (
            <div className="active-document-info">
              <FontAwesomeIcon icon={faFileAlt} />
              <span className="doc-name">{activeDocument.filename}</span>
              {activeDocument.isPreloadedOrigin && (
                <span className="preloaded-badge">📚</span>
              )}
              {activeDocument.isSessionDocument && (
                <span className="session-badge">📋</span>
              )}
            </div>
          )}
          
          {/* Upload Button */}
          <button 
            className="header-action-btn upload-btn"
            onClick={onUploadDocument}
            title="Upload PDF Document"
          >
            <FontAwesomeIcon icon={faUpload} />
            <span>Upload PDF</span>
          </button>
          
          {/* Browse Documents Button - Updated */}
          <button 
            className="header-action-btn"
            onClick={onShowPreloaded}
            title="Browse Session Documents"
          >
            <FontAwesomeIcon icon={faDatabase} />
            <span>Browse Documents</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Header;