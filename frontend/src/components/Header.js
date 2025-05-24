import React from 'react';
import '../styles/brutalist-design.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGraduationCap, faTerminal, faCog } from '@fortawesome/free-solid-svg-icons';

const Header = ({ activeDocument, theme }) => {
  const getGreeting = () => {
    const greetings = [
      "What patterns shall we uncover today?",
      "Ready to excavate knowledge from documents?",
      "Let's trace the provenance of ideas...",
      "What research questions are burning today?",
      "Time to dig into the evidence...",
      "What connections shall we discover?",
      "Ready to analyze and synthesize?"
    ];
    
    // Use document name to pick consistent greeting
    const index = activeDocument 
      ? activeDocument.filename.length % greetings.length
      : Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % greetings.length; // Daily rotation
    
    return greetings[index];
  };

  const getSessionStatus = () => {
    if (!activeDocument) {
      return {
        status: "No Active Document",
        color: "var(--concrete-accent)"
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
        <div className="chat-title">
          {getGreeting()}
        </div>
        <div className="session-status" style={{ color: sessionStatus.color }}>
          <FontAwesomeIcon icon={faTerminal} />
          <span>{sessionStatus.status}</span>
        </div>
      </div>
      
      <div className="header-right">
        <div className="mode-selector">
          <button className="mode-btn active">
            <FontAwesomeIcon icon={faTerminal} />
            <span>General</span>
          </button>
          <button className="mode-btn">
            <FontAwesomeIcon icon={faGraduationCap} />
            <span>Scholar</span>
          </button>
        </div>
        
        <div className="header-controls">
          <button className="control-btn" title="System Settings">
            <FontAwesomeIcon icon={faCog} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Header;
