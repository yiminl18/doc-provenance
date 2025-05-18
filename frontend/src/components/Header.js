import React from 'react';
import '../styles/Header.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGraduationCap } from '@fortawesome/free-solid-svg-icons';

const Header = () => {
  return (
    <div className="header">
      <div className="chat-title">
        What can I help with?
      </div>
      <div className="mode-selector">
        <button className="mode-btn active">General</button>
        <button className="mode-btn">
          <FontAwesomeIcon icon={faGraduationCap} /> Scholar
        </button>
      </div>
    </div>
  );
};

export default Header; 