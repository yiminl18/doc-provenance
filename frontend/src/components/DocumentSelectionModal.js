// components/DocumentSelectionModal.js
import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBookOpen,
  faTimes,
  faSpinner,
  faExclamationTriangle,
  faFileText,
  faHashtag,
  faAlignLeft,
  faChartBar,
  faQuestionCircle,
  faClock,
  faInfoCircle
} from '@fortawesome/free-solid-svg-icons';
import { getDocuments, getGeneratedQuestions } from '../services/api';

const DocumentSelectionModal = ({ 
  isOpen, 
  onClose, 
  onDocumentSelect,
  showProvenanceStats = true 
}) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [documentStats, setDocumentStats] = useState(new Map());
  const [loadingStats, setLoadingStats] = useState(new Set());

  useEffect(() => {
    if (isOpen) {
      loadDocuments();
    }
  }, [isOpen]);

  const loadDocuments = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await getDocuments();
      
      if (response.success && response.documents) {
        console.log('📚 Documents loaded:', response.documents);
        setDocuments(response.documents);
        
        // Load provenance stats for each document if enabled
        if (showProvenanceStats) {
          loadProvenanceStatsForDocuments(response.documents);
        }
      } else {
        setDocuments([]);
        setError('Failed to load documents');
      }
    } catch (err) {
      console.error('Error loading documents:', err);
      setError(err.message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const loadProvenanceStatsForDocuments = async (docs) => {
    console.log('📊 Loading provenance stats for documents...');
    
    // Load stats for each document in parallel
    const statsPromises = docs.map(async (doc) => {
      try {
        setLoadingStats(prev => new Set(prev).add(doc.filename));
        
        const response = await getGeneratedQuestions(doc.filename);
        
        if (response.success && response.questions) {
          const stats = calculateDocumentStats(response.questions, response.metadata);
          setDocumentStats(prev => new Map(prev).set(doc.filename, stats));
        }
      } catch (error) {
        console.warn(`Failed to load stats for ${doc.filename}:`, error);
        // Set empty stats so we don't keep trying
        setDocumentStats(prev => new Map(prev).set(doc.filename, {
          total_questions: 0,
          total_provenances: 0,
          total_sentences: 0,
          avg_provenances_per_question: 0,
          error: true
        }));
      } finally {
        setLoadingStats(prev => {
          const newSet = new Set(prev);
          newSet.delete(doc.filename);
          return newSet;
        });
      }
    });

    await Promise.allSettled(statsPromises);
    console.log('✅ Provenance stats loading completed');
  };

  const calculateDocumentStats = (questions, metadata) => {
    if (!questions || questions.length === 0) {
      return {
        total_questions: 0,
        total_provenances: 0,
        total_sentences: 0,
        total_characters: 0,
        avg_provenances_per_question: 0,
        avg_sentences_per_question: 0,
        quality_score: 0
      };
    }

    let totalProvenances = 0;
    let totalSentences = 0;
    let totalCharacters = 0;
    let questionsWithProvenances = 0;

    questions.forEach(question => {
      if (question.provenance_data && question.provenance_data.length > 0) {
        questionsWithProvenances++;
        totalProvenances += question.provenance_data.length;
        
        question.provenance_data.forEach(prov => {
          const sentenceCount = prov.provenance_ids ? prov.provenance_ids.length : 0;
          const characterCount = prov.output_token_size || 0; // Using token size as proxy
          
          totalSentences += sentenceCount;
          totalCharacters += characterCount;
        });
      }
    });

    // Calculate quality score (0-100) based on coverage and completeness
    const coverageScore = (questionsWithProvenances / questions.length) * 100;
    const avgProvenancesPerQuestion = questions.length > 0 ? totalProvenances / questions.length : 0;
    const avgSentencesPerQuestion = questions.length > 0 ? totalSentences / questions.length : 0;
    
    // Quality factors: good coverage, reasonable provenance count, meaningful sentence count
    const qualityScore = Math.min(100, (
      (coverageScore * 0.4) + 
      (Math.min(avgProvenancesPerQuestion / 3, 1) * 30) + 
      (Math.min(avgSentencesPerQuestion / 10, 1) * 30)
    ));

    return {
      total_questions: questions.length,
      total_provenances: totalProvenances,
      total_sentences: totalSentences,
      total_characters: totalCharacters,
      questions_with_provenances: questionsWithProvenances,
      coverage_percentage: Math.round(coverageScore),
      avg_provenances_per_question: Math.round(avgProvenancesPerQuestion * 10) / 10,
      avg_sentences_per_question: Math.round(avgSentencesPerQuestion * 10) / 10,
      quality_score: Math.round(qualityScore),
      generation_date: metadata?.generated_at ? new Date(metadata.generated_at * 1000).toLocaleDateString() : null
    };
  };

  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const getQualityColor = (score) => {
    if (score >= 80) return '#4CAF50'; // Green
    if (score >= 60) return '#FF9800'; // Orange
    if (score >= 40) return '#FFC107'; // Yellow
    return '#F44336'; // Red
  };

  const handleDocumentClick = (doc) => {
    onDocumentSelect(doc);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-container document-selection">
        <div className="modal-header">
          <div className="header-content">
            <FontAwesomeIcon icon={faBookOpen} />
            <h3>{documents.length} Available Documents</h3>
           
          </div>
          <button className="win95-btn close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <FontAwesomeIcon icon={faSpinner} spin size="2x" />
              <p>Loading available documents...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <p>Error loading documents: {error}</p>
              <button className="retry-btn" onClick={loadDocuments}>
                Try Again
              </button>
            </div>
          ) : documents.length > 0 ? (
            <>
              
              <div className="modal-grid document-selection">
                {documents.map(doc => {
                  const stats = documentStats.get(doc.filename);
                  const isLoadingStats = loadingStats.has(doc.filename);
                  
                  return (
                    <div key={doc.filename} className="document-card-container">
                      <button
                        className="document-card"
                        onClick={() => handleDocumentClick(doc)}
                        disabled={loading}
                      >
                        <div className="document-main-info">
                          <div className="doc-icon">
                            <FontAwesomeIcon icon={faFileText} />
                          </div>
                          
                          <div className="doc-details">
                            <h4 className="doc-title">{doc.filename}</h4>
                            
                            <div className="doc-basic-stats">
                              <span className="stat">
                                <FontAwesomeIcon icon={faAlignLeft} />
                                {formatNumber(doc.text_length || 0)} chars
                              </span>
                              <span className="stat">
                                <FontAwesomeIcon icon={faHashtag} />
                                {doc.sentence_count || 0} sentences
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        {showProvenanceStats && (
                          <div className="provenance-stats-section">
                            {isLoadingStats ? (
                              <div className="stats-loading">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                <small>Loading stats...</small>
                              </div>
                            ) : stats ? (
                              <>
                                
                                
                                <div className="provenance-summary">
                                  <div className="summary-stat">
                                    <FontAwesomeIcon icon={faQuestionCircle} />
                                    <span>{stats.total_questions}</span>
                                    <small>questions</small>
                                  </div>
                                  
                                  <div className="summary-stat">
                                    <FontAwesomeIcon icon={faFileText} />
                                    <span>{stats.total_provenances}</span>
                                    <small>provenances</small>
                                  </div>
                                  
                                  <div className="summary-stat">
                                    <FontAwesomeIcon icon={faHashtag} />
                                    <span>{formatNumber(stats.total_sentences)}</span>
                                    <small>sentences</small>
                                  </div>
                                </div>
                                
                                {stats.generation_date && (
                                  <div className="generation-info">
                                    <FontAwesomeIcon icon={faClock} />
                                    <small>Generated {stats.generation_date}</small>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="no-stats">
                                <FontAwesomeIcon icon={faExclamationTriangle} />
                                <small>No question data available</small>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <FontAwesomeIcon icon={faBookOpen} size="3x" />
              <h4>No Documents Available</h4>
              <p>No documents are currently available in the system.</p>
              <p className="empty-subtitle">
                Upload a document or check back later.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentSelectionModal;