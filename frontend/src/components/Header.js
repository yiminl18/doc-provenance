import React from 'react';
import '../styles/brutalist-design.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket, faTerminal, faFileAlt, faDatabase, faUpload } from '@fortawesome/free-solid-svg-icons';

const Header = ({
  activeDocument,
  onShowPreloaded,
  onUploadDocument
}) => {



  return (
    <div className="app-header-compact">
      <div className="header-left">
        <div className="logo">
          <FontAwesomeIcon icon={faRocket} />
          <span>PROVENANCE</span>
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