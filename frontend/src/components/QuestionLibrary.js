import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faBookOpen,
  faPlus,
  faSearch,
  faPlayCircle,
  faSpinner,
  faSave,
  faUndo,
  faQuestionCircle,
  faTrash,
  faEdit
} from '@fortawesome/free-solid-svg-icons';

const QuestionLibrary = ({
  isOpen,
  onClose,
  onQuestionSelect,
  onQuestionAdd,
  onQuestionRemove,
  questionsLibrary
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    question_text: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setShowAddForm(false);
      setAddForm({ question_text: '', description: '' });
      setError(null);
    }
  }, [isOpen]);

  const handleAddQuestion = async () => {
    if (!addForm.question_text.trim()) return;
    
    setLoading(true);
    try {
      const success = await onQuestionAdd(addForm.question_text.trim(), 'Custom', addForm.description.trim());
      
      if (success) {
        // Reset form
        setAddForm({ question_text: '', description: '' });
        setShowAddForm(false);
        setError(null);
      } else {
        setError('Failed to add question to library');
      }
    } catch (err) {
      setError('Error adding question to library');
      console.error('Error adding question:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteQuestion = async (questionId) => {
    if (!window.confirm('Are you sure you want to remove this question from your library?')) {
      return;
    }
    
    setLoading(true);
    try {
      const success = await onQuestionRemove(questionId);
      
      if (!success) {
        setError('Failed to remove question from library');
      }
    } catch (err) {
      setError('Error removing question from library');
      console.error('Error removing question:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionSelect = (question) => {
    if (onQuestionSelect) {
      onQuestionSelect(question.text, question.id);
    }
  };

  // Filter questions based on search
  const getFilteredQuestions = () => {
    if (!questionsLibrary?.questions) return [];
    
    return questionsLibrary.questions.filter(question =>
      question.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (question.description && question.description.toLowerCase().includes(searchTerm.toLowerCase()))
    ).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)); // Most recent first
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  const filteredQuestions = getFilteredQuestions();

  return (
    <div className="modal-overlay question-library-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="question-library-modal">
        {/* Header */}
        <div className="modal-header">
          <div className="header-left">
            <FontAwesomeIcon icon={faBookOpen} />
            <h3>Question Library</h3>
            {questionsLibrary && (
              <span className="question-count">{questionsLibrary.questions?.length || 0} questions</span>
            )}
          </div>
          <button className="close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {/* Controls */}
        <div className="library-controls">
          <div className="search-section">
            <div className="search-input">
              <FontAwesomeIcon icon={faSearch} />
              <input
                type="text"
                placeholder="Search questions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <button
              className="add-question-btn"
              onClick={() => setShowAddForm(!showAddForm)}
              disabled={loading}
            >
              <FontAwesomeIcon icon={faPlus} />
              Add Question
            </button>
          </div>
        </div>

        {/* Add Question Form */}
        {showAddForm && (
          <div className="add-question-form">
            <h4>Add New Question</h4>
            <textarea
              placeholder="Enter your question..."
              value={addForm.question_text}
              onChange={(e) => setAddForm(prev => ({ ...prev, question_text: e.target.value }))}
              className="question-input"
              rows={3}
            />
            <textarea
              placeholder="Optional description..."
              value={addForm.description}
              onChange={(e) => setAddForm(prev => ({ ...prev, description: e.target.value }))}
              className="description-input"
              rows={2}
            />
            <div className="form-actions">
              <button 
                onClick={handleAddQuestion} 
                className="save-btn"
                disabled={!addForm.question_text.trim() || loading}
              >
                {loading ? <FontAwesomeIcon icon={faSpinner} spin /> : <FontAwesomeIcon icon={faSave} />}
                Add Question
              </button>
              <button 
                onClick={() => setShowAddForm(false)} 
                className="cancel-btn"
                disabled={loading}
              >
                <FontAwesomeIcon icon={faUndo} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="error-message">
            <FontAwesomeIcon icon={faQuestionCircle} />
            {error}
            <button onClick={() => setError(null)} className="dismiss-error">×</button>
          </div>
        )}

        {/* Content */}
        <div className="modal-body">
          {questionsLibrary && questionsLibrary.questions ? (
            <>
              {/* Library Stats */}
              <div className="library-stats">
                <div className="stat-item">
                  <FontAwesomeIcon icon={faQuestionCircle} />
                  <span>{questionsLibrary.questions.length} Total Questions</span>
                </div>
                <div className="stat-item">
                  <span>Showing {filteredQuestions.length} results</span>
                </div>
              </div>

              {/* Questions List */}
              <div className="questions-list">
                {filteredQuestions.length === 0 ? (
                  <div className="empty-state">
                    <FontAwesomeIcon icon={faQuestionCircle} size="3x" />
                    <h4>
                      {searchTerm ? 'No Questions Found' : 'No Questions Yet'}
                    </h4>
                    <p>
                      {searchTerm 
                        ? 'Try adjusting your search term'
                        : 'Add questions to build your library'}
                    </p>
                  </div>
                ) : (
                  filteredQuestions.map(question => (
                    <div key={question.id} className="question-item">
                      <div className="question-header">
                        <div className="question-meta">
                          <span className="usage-count">{question.use_count || 0} uses</span>
                          <span className="created-date">{formatTimestamp(question.created_at)}</span>
                        </div>
                        <div className="question-actions">
                          <button
                            onClick={() => handleQuestionSelect(question)}
                            className="use-question-btn"
                            title="Use this question"
                            disabled={loading}
                          >
                            <FontAwesomeIcon icon={faPlayCircle} />
                          </button>
                          <button
                            onClick={() => handleDeleteQuestion(question.id)}
                            className="delete-question-btn"
                            title="Remove question"
                            disabled={loading}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="question-text">
                        {question.text}
                      </div>
                      
                      {question.description && (
                        <div className="question-description">
                          {question.description}
                        </div>
                      )}
                      
                      {question.use_count > 0 && (
                        <div className="question-footer">
                          <div className="question-stats">
                            {question.avg_processing_time && (
                              <span className="stat">
                                Avg: {question.avg_processing_time.toFixed(1)}s
                              </span>
                            )}
                            <span className="stat">
                              Success: {Math.round((question.success_rate || 1) * 100)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="loading-state">
              <FontAwesomeIcon icon={faSpinner} spin size="2x" />
              <p>Loading question library...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuestionLibrary;