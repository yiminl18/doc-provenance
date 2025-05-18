import React from 'react';
import '../styles/Sidebar.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faRocket, faHome, faChartLine, faSun, faMoon } from '@fortawesome/free-solid-svg-icons';

const Sidebar = ({ onNewQuestion, theme, toggleTheme }) => {
  return (
    <div className="sidebar">
      <div className="logo">
        <FontAwesomeIcon icon={faRocket} />
        <span>Provenance</span>
      </div>
      
      <button className="new-question-btn" onClick={onNewQuestion}>
        <FontAwesomeIcon icon={faPlus} />
        <span>New question</span>
      </button>
      
      <div className="sidebar-nav">
        <div className="nav-item active">
          <FontAwesomeIcon icon={faHome} />
          <span>My Space</span>
          <div className="badge">1</div>
        </div>
        <div className="nav-item">
          <FontAwesomeIcon icon={faChartLine} />
          <span>Activity</span>
        </div>
      </div>
      
      <div className="theme-toggle">
        <button className="theme-button" onClick={toggleTheme}>
          <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} />
          <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar; 