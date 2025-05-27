import React from 'react';
import '../styles/brutalist-design.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket, faTerminal, faFileAlt, faDatabase } from '@fortawesome/free-solid-svg-icons';

const Header = ({ activeDocument, onShowPreloaded }) => {

  const getSessionStatus = () => {
    if (!activeDocument) {
      return {
        status: "Ready for Questions",
        color: "var(--terminal-amber)"
      };
    }

    const questions = Array.from(activeDocument.questions.values());
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
              {activeDocument.isPreloaded && (
                <span className="preloaded-badge">📚</span>
              )}
            </div>
          )}
          
          <button 
            className="header-action-btn"
            onClick={onShowPreloaded}
            title="Browse Research Papers"
          >
            <FontAwesomeIcon icon={faDatabase} />
            <span>Browse Papers</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Header;