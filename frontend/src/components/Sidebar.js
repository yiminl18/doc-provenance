import React from 'react';
import '../styles/Sidebar.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faPlus, 
  faRocket, 
  faFileAlt, 
  faChartLine, 
  faSun, 
  faMoon,
  faQuestionCircle,
  faCheck,
  faClock
} from '@fortawesome/free-solid-svg-icons';

const Sidebar = ({ 
  documents, 
  activeDocumentId, 
  onDocumentSelect, 
  onNewQuestion, 
  theme, 
  toggleTheme 
}) => {
  const documentList = Array.from(documents.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const getDocumentStats = (doc) => {
    const questions = Array.from(doc.questions.values());
    const totalQuestions = questions.length;
    const completedQuestions = questions.filter(q => !q.isProcessing && q.answer).length;
    const processingQuestions = questions.filter(q => q.isProcessing).length;
    
    return { totalQuestions, completedQuestions, processingQuestions };
  };

  const formatFileName = (filename) => {
    if (filename.length > 20) {
      return filename.substring(0, 17) + '...';
    }
    return filename;
  };

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
      
      <div className="documents-section">
        <div className="section-header">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>Documents</span>
          <div className="document-count">{documentList.length}</div>
        </div>
        
        <div className="documents-list">
          {documentList.length === 0 ? (
            <div className="empty-documents">
              <p>No documents uploaded</p>
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
                    <FontAwesomeIcon icon={faFileAlt} />
                    <span className="document-name" title={doc.filename}>
                      {formatFileName(doc.filename)}
                    </span>
                  </div>
                  
                  <div className="document-stats">
                    <div className="stat-item">
                      <FontAwesomeIcon icon={faQuestionCircle} />
                      <span>{stats.totalQuestions}</span>
                    </div>
                    
                    {stats.completedQuestions > 0 && (
                      <div className="stat-item completed">
                        <FontAwesomeIcon icon={faCheck} />
                        <span>{stats.completedQuestions}</span>
                      </div>
                    )}
                    
                    {stats.processingQuestions > 0 && (
                      <div className="stat-item processing">
                        <FontAwesomeIcon icon={faClock} />
                        <span>{stats.processingQuestions}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="document-time">
                    {new Date(doc.createdAt).toLocaleString()}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      <div className="sidebar-nav">
        <div className="nav-item active">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>My Documents</span>
          <div className="badge">{documentList.length}</div>
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