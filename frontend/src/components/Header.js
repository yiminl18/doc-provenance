import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserSecret, faDatabase, faCloud, faUpload, faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
const Header = ({
  activeDocument, // This will determine if we show the buttons
  onShowPreloaded,
  onUploadDocument,
  onShowDrive,
  onShowQuestionSuggestions
}) => {
  
  return (
    <div className="app-header-compact">
      <div className="header-left">
        <div className="logo">
          <FontAwesomeIcon icon={faUserSecret} />
          <span>PROVENANCE</span>
        </div>
      </div>

      <div className="header-right">
        {/* Only show document actions when there's an active document */}
        {activeDocument && (
          <div className="document-actions">
            {/* Upload Button */}
            <button
              className="win95-btn compact upload"
              onClick={onUploadDocument}
              title="Upload PDF"
            >
              <FontAwesomeIcon icon={faUpload} />
              <span>Upload PDF</span>
            </button>

            {/* Browse Documents Button */}
            <button
              className="win95-btn compact browse"
              onClick={onShowPreloaded}
              title="Browse Documents"
            >
              <FontAwesomeIcon icon={faDatabase} />
              <span>Browse Documents</span>
            </button>

            {/* Browse Drive Button */}
            <button className="win95-btn compact drive" onClick={onShowDrive}>
              <FontAwesomeIcon icon={faCloud} />
              <span>Browse Drive</span>
            </button>
            {/* Question Suggestions Button */}
            <button
              className="win95-btn"
              onClick={onShowQuestionSuggestions}
              title="View suggested questions for this document"
            >
              <FontAwesomeIcon icon={faQuestionCircle} />
              Question Suggestions
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

export default Header;