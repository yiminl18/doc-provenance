import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserSecret, faDatabase, faUpload } from '@fortawesome/free-solid-svg-icons';

const Header = ({
  activeDocument, // This will determine if we show the buttons
  onShowPreloaded,
  onUploadDocument
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
              className="upload-btn compact"
              onClick={onUploadDocument}
              title="Upload PDF"
            >
              <FontAwesomeIcon icon={faUpload} />
              <span>Upload PDF</span>
            </button>

            {/* Browse Documents Button */}
            <button
              className="browse-btn compact"
              onClick={onShowPreloaded}
              title="Browse Documents"
            >
              <FontAwesomeIcon icon={faDatabase} />
              <span>Browse Documents</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Header;