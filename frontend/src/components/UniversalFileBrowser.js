// UnifiedDocumentBrowserModal.js - Combined DocumentSelectionModal and DriveFileBrowser
import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBookOpen, faFilter, faCheck, faCloud, faDice, faSpinner, faFileText, faFolder,
  faArrowLeft, faBuilding, faMapMarkerAlt, faUser, faCalendar, faIdCard,
  faTimes, faExclamationTriangle, faHashtag, faAlignLeft, faInfoCircle,
  faQuestionCircle, faClock, faChartBar, faDatabase
} from '@fortawesome/free-solid-svg-icons';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

import { filterDocuments, getFilteringStats, DEFAULT_THRESHOLDS, isGoodDocument } from '../utils/filteringUtils';

import {
  getDocuments,
  getGeneratedQuestions,
  getPvcSampleCounties,
  getPvcSampleAgencies,
  getPvcSampleFiles,
  downloadPvcSampleFile,
  sampleExtractableDocuments,
  initProvisionalSampler
} from '../services/api';

const UnifiedFileBrowser = ({
  isOpen,
  onClose,
  onDocumentSelect,
  mode = 'available', // 'available' | 'drive'
  showProvenanceStats = true
}) => {
  // Common state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showOnlyGoodDocuments, setShowOnlyGoodDocuments] = useState(false);
  const [filteringStats, setFilteringStats] = useState(null);

  // Add this function to calculate stats when documents change:
  const calculateFilteringStats = (docs) => {
    if (!docs || docs.length === 0) return null;

    // Convert your document format to the expected format
    const documentsWithQuestions = docs.map(doc => ({
      ...doc,
      questions: documentStats.get(doc.filename)?.questions || []
    }));

    return getFilteringStats(documentsWithQuestions);
  };

  // Initialize Tiktoken for token counting
  const enc = new Tiktoken(cl100k_base);

  // Available documents state
  const [documents, setDocuments] = useState([]);
  const [documentStats, setDocumentStats] = useState(new Map());
  const [loadingStats, setLoadingStats] = useState(new Set());

  // Drive browser state
  const [currentView, setCurrentView] = useState('counties'); // counties -> agencies -> files
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedAgency, setSelectedAgency] = useState(null);
  const [counties, setCounties] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [files, setFiles] = useState([]);
  const [sampling, setSampling] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState(null);

  // =============================================================================
  // Available Documents Functions
  // =============================================================================

  const loadDocuments = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getDocuments();

      if (response.success && response.documents) {
        setDocuments(response.documents);

        // Load provenance stats for each document if enabled
        if (showProvenanceStats) {
          await loadProvenanceStatsForDocuments(response.documents);
          // Calculate filtering stats after loading provenance data
          setFilteringStats(calculateFilteringStats(response.documents));
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

  const getDisplayDocuments = () => {
    if (!showOnlyGoodDocuments) return documents;

    return documents.filter(doc => {
      const stats = documentStats.get(doc.filename);
      if (!stats || !stats.questions) return false;

      const docWithQuestions = {
        ...doc,
        questions: stats.questions
      };

      return isGoodDocument(docWithQuestions);
    });
  };

  const loadProvenanceStatsForDocuments = async (docs) => {
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
        setDocumentStats(prev => new Map(prev).set(doc.filename, {
          total_questions: 0,
          total_provenances: 0,
          total_sentences: 0,
          total_tokens: 0,
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
  };

  const calculateDocumentStats = (questions, metadata) => {
    if (!questions || questions.length === 0) {
      return {
        total_questions: 0,
        total_provenances: 0,
        total_sentences: 0,
        total_tokens: 0,
        avg_provenances_per_question: 0,
        avg_sentences_per_question: 0,
        quality_score: 0
      };
    }

    let totalProvenances = 0;
    let totalSentences = 0;
    let totalTokens = 0;
    let questionsWithProvenances = 0;

    questions.forEach(question => {
      if (question.provenance_data && question.provenance_data.length > 0) {
        questionsWithProvenances++;
        totalProvenances += question.provenance_data.length;

        question.provenance_data.forEach(prov => {
          // Calculate per-provenance totals using TikToken
          const provenanceText = prov.provenance || '';
          const tokenCount = enc.encode(provenanceText).length;
          const sentenceCount = prov.provenance_ids ? prov.provenance_ids.length : 0;

          totalSentences += sentenceCount;
          totalTokens += tokenCount;
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
      total_tokens: totalTokens,
      questions_with_provenances: questionsWithProvenances,
      coverage_percentage: Math.round(coverageScore),
      avg_provenances_per_question: Math.round(avgProvenancesPerQuestion * 10) / 10,
      avg_sentences_per_question: Math.round(avgSentencesPerQuestion * 10) / 10,
      quality_score: Math.round(qualityScore),
      generation_date: metadata?.generated_at ? new Date(metadata.generated_at * 1000).toLocaleDateString() : null
    };
  };

  // =============================================================================
  // Drive Browser Functions
  // =============================================================================


  const handleSmartSampling = async () => {
    setSampling(true);
    setError(null);
    try {
      // Use the updated sampling function
      const result = await sampleExtractableDocuments({
        target_count: 30,
        prefer_diverse_cases: true,
        min_pages: 2,
        allow_duplicates: false  // New parameter to prevent duplicates
      });

      if (result.success) {
        const stats = result.stats || {};
        const newCount = stats.achieved_count || 0;
        const existingCount = stats.existing_count || 0;
        const totalCount = stats.total_count || 0;
        const duplicatesSkipped = stats.duplicates_skipped || 0;

        if (newCount > 0) {
          let message = `Successfully sampled ${newCount} new documents!`;
          if (existingCount > 0) {
            message += ` You now have ${totalCount} total documents.`;
          }
          if (duplicatesSkipped > 0) {
            message += ` (${duplicatesSkipped} duplicates were skipped)`;
          }

          alert(message);
        } else if (stats.all_candidates_were_duplicates) {
          alert(`All available documents have already been sampled. You have ${existingCount} documents in your collection.`);
        } else {
          alert(`No new documents were sampled. You have ${existingCount} existing documents.`);
        }

        // Refresh the counties view to show newly sampled files
        if (currentView === 'counties') {
          fetchCounties();
        }

      } else {
        setError(`Sampling failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Sampling failed:', error);
      setError('Sampling failed. Please try again.');
    } finally {
      setSampling(false);
    }
  };

  const fetchCounties = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🔄 Fetching PVC sample counties...');

      // Use the new PVC sampling API
      const data = await getPvcSampleCounties();

      console.log('📋 Counties API response:', data);

      if (data.success) {
        console.log('✅ Setting counties:', data.counties);
        setCounties(data.counties);
      } else {
        console.error('❌ Counties API returned error:', data.error);
        setError('Failed to load sampled document counties: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('❌ Exception in fetchCounties:', error);
      setError('Error fetching counties: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgencies = async (countyName) => {
    setLoading(true);
    setError(null);
    try {
      // Use the new PVC sampling API
      const data = await getPvcSampleAgencies(countyName);
      if (data.success) {
        setAgencies(data.agencies);
        setSelectedCounty(countyName);
        setCurrentView('agencies');
      } else {
        setError('Failed to load document sources');
      }
    } catch (error) {
      console.error('Error fetching agencies:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (county, agency) => {
    setLoading(true);
    setError(null);
    try {
      // Use the new PVC sampling API
      const data = await getPvcSampleFiles(county, agency);
      if (data.success) {
        const enhancedFiles = data.files.map(file => ({
          ...file,
          truncatedId: file.file_id && file.file_id.length > 8
            ? '...' + file.file_id.slice(-8)
            : file.file_id || 'local'
        }));

        setFiles(enhancedFiles);
        setSelectedAgency(agency);
        setCurrentView('files');
      } else {
        setError('Failed to load documents');
      }
    } catch (error) {
      console.error('Error fetching files:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDriveFileSelect = async (file) => {
    if (!file.file_id && !file.gdrive_id) {
      if (file.path || file.full_path) {
        const pdfUrl = file.provisional_case_name ?
          `/api/documents/pvc-sample/${file.provisional_case_name}/${file.name || file.displayName}` :
          `/api/documents/${file.name || file.displayName}?source=pvc-sample`;

        onDocumentSelect({
          success: true,
          filename: file.name || file.displayName,
          local_path: file.path || file.full_path,
          provisional_case_name: file.provisional_case_name,
          county: file.county,
          agency: file.agency,
          metadata: file.metadata,
          pdf_url: pdfUrl,
          source: 'pvc-sample'
        });
        onClose();
        return;
      } else {
        setError('File missing ID and path');
        return;
      }
    }

    setDownloadingFile(file.path || file.name);
    setError(null);
    try {
      // Use the new PVC sampling download API
      const data = await downloadPvcSampleFile(file.file_id || file.gdrive_id);

      if (data.success) {
        onDocumentSelect({
          ...data,
          provisional_case_name: file.provisional_case_name,
          county: file.county,
          agency: file.agency
        });
        onClose();
      } else {
        setError(`Failed to access file: ${data.error}`);
      }
    } catch (error) {
      console.error('Error accessing file:', error);
      setError('Error accessing file');
    } finally {
      setDownloadingFile(null);
    }
  };

  // Update the initialization logic in useEffect
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoading(false);

      if (mode === 'available') {
        loadDocuments();
      } else if (mode === 'drive') {
        setCurrentView('counties');
        setSelectedCounty(null);
        setSelectedAgency(null);
        // Initialize the sampler and fetch counties
        initializePvcSampler();
      }
    }
  }, [isOpen, mode]);

  // Add this new function to initialize the PVC sampler
  const initializePvcSampler = async () => {
    setLoading(true);
    try {
      // Try to initialize the sampler (this might already be done)
      await initProvisionalSampler();
      // Fetch counties after initialization
      await fetchCounties();
    } catch (error) {
      console.warn('Sampler initialization warning:', error);
      // Still try to fetch counties in case sampler is already initialized
      try {
        await fetchCounties();
      } catch (fetchError) {
        setError('No sampled documents available. Try sampling some documents first.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Update the getDisplayCountyName function to handle the new county structure
  const getDisplayCountyName = (countyName) => {
    const county = counties.find(c => c.name === countyName || c.originalName === countyName);
    return county ? county.displayName : countyName;
  };

  const getTitle = () => {
    if (mode === 'available') {
      return `${documents.length} Available Documents`;
    } else if (mode === 'drive') {
      if (currentView === 'counties') return 'Sampled Documents';
      if (currentView === 'agencies') return `${getDisplayCountyName(selectedCounty)} Sources`;
      if (currentView === 'files') return `${selectedAgency} Documents`;
    }
    return 'Document Browser';
  };

  const goBack = () => {
    setError(null);
    if (currentView === 'files') {
      setCurrentView('agencies');
      setSelectedAgency(null);
      setFiles([]);
    } else if (currentView === 'agencies') {
      setCurrentView('counties');
      setSelectedCounty(null);
      setAgencies([]);
    }
  };

  // =============================================================================
  // Common Functions
  // =============================================================================

  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const handleDocumentClick = (doc) => {
    onDocumentSelect(doc);
    onClose();
  };

  const retryCurrentAction = () => {
    setError(null);
    if (mode === 'available') {
      loadDocuments();
    } else if (mode === 'drive') {
      if (currentView === 'counties') {
        fetchCounties();
      } else if (currentView === 'agencies' && selectedCounty) {
        fetchAgencies(selectedCounty);
      } else if (currentView === 'files' && selectedCounty && selectedAgency) {
        fetchFiles(selectedCounty, selectedAgency);
      }
    }
  };

  // =============================================================================
  // Render
  // =============================================================================

  if (!isOpen) return null;

  const getIcon = () => {
    return mode === 'available' ? faBookOpen : faCloud;
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-container document-selection">
        <div className="modal-header">
          <div className="header-content">
            <FontAwesomeIcon icon={getIcon()} />
            <h3>{getTitle()}</h3>

            <div className="header-content">
              <FontAwesomeIcon icon={getIcon()} />
              <h3>{getTitle()}</h3>

              {/* Simple Quality Filter Toggle */}
              {mode === 'available' && filteringStats && (
                <div className="filter-toggle">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={showOnlyGoodDocuments}
                      onChange={(e) => setShowOnlyGoodDocuments(e.target.checked)}
                    />
                    <FontAwesomeIcon icon={faFilter} />
                    Show Quality Docs Only
                    <span className="filter-stats">
                      ({filteringStats.goodDocuments}/{filteringStats.totalDocuments})
                    </span>
                  </label>
                </div>
              )}
            </div>
            {/* Breadcrumb for drive mode */}
            {mode === 'drive' && (currentView === 'agencies' || currentView === 'files') && (
              <div className="breadcrumb">
                {currentView === 'agencies' && (
                  <span>
                    <FontAwesomeIcon icon={faFolder} /> {getDisplayCountyName(selectedCounty)}
                  </span>
                )}
                {currentView === 'files' && (
                  <span>
                    <FontAwesomeIcon icon={faFolder} /> {getDisplayCountyName(selectedCounty)} /
                    <FontAwesomeIcon icon={faBuilding} /> {selectedAgency}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="header-actions">
            {/* Back button for drive mode */}
            {mode === 'drive' && currentView !== 'counties' && (
              <button className="win95-btn" onClick={goBack}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
            )}
            <button className="win95-btn close" onClick={onClose}>
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <FontAwesomeIcon icon={faSpinner} spin size="2x" />
              <p>
                {mode === 'available' ? 'Loading available documents...' : 'Loading document collection...'}
              </p>
            </div>
          ) : error ? (
            <div className="error-state">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <p>Error: {error}</p>
              <button className="retry-btn" onClick={retryCurrentAction}>
                Try Again
              </button>
            </div>
          ) : (
            <>
              {/* Available Documents Mode */}
              {mode === 'available' && (
                <>
                  {documents.length > 0 ? (
                    <div className="modal-grid document-selection">
                      {getDisplayDocuments().map(doc => {
                        const stats = documentStats.get(doc.filename);
                        const isLoadingStats = loadingStats.has(doc.filename);

                        // Add quality indicator
                        const docWithQuestions = stats?.questions ? { ...doc, questions: stats.questions } : doc;
                        const isHighQuality = isGoodDocument(docWithQuestions);

                        return (
                          <div key={doc.filename} className={`document-card-container ${isHighQuality ? 'high-quality' : ''}`}>
                            <button
                              className="document-card"
                              onClick={() => handleDocumentClick(doc)}
                              disabled={loading}
                            >
                              {/* Add quality badge */}
                              {isHighQuality && (
                                <div className="quality-badge">
                                  <FontAwesomeIcon icon={faCheck} />
                                </div>
                              )}

                              {/* Rest of your existing card content */}
                              <div className="document-main-info">
                                <div className="doc-icon">
                                  <FontAwesomeIcon icon={faFileText} />
                                </div>

                                <div className="doc-details">
                                  <h4 className="doc-title">{doc.filename}</h4>

                                  <div className="doc-basic-stats">
                                    <span className="stat">
                                      <FontAwesomeIcon icon={faAlignLeft} />
                                      {formatNumber(stats?.total_tokens || 0)} tokens
                                    </span>
                                    <span className="stat">
                                      <FontAwesomeIcon icon={faHashtag} />
                                      {formatNumber(stats?.total_sentences || 0)} sentences
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
                </>
              )}

              {/* Drive Browser Mode */}
              {mode === 'drive' && (
                <>
                  {/* Counties View */}
                  {currentView === 'counties' && (
                    <>
                      {/* Smart Sampling Section */}
                      <div className="sampling-section">
                        <div className="sampling-card">
                          <div className="sampling-info">
                            <FontAwesomeIcon icon={faDice} />
                            <div>
                              <h4>Sample New Documents</h4>
                              <p>Automatically discover and download 5 diverse PDFs with extractable text</p>
                            </div>
                          </div>
                          <button
                            className={`win95-btn primary ${sampling ? 'disabled' : ''}`}
                            onClick={handleSmartSampling}
                            disabled={sampling}
                          >
                            {sampling ? (
                              <>
                                <FontAwesomeIcon icon={faSpinner} spin />
                                Sampling...
                              </>
                            ) : (
                              <>
                                <FontAwesomeIcon icon={faDice} />
                                Sample Documents
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Available Cases */}
                      {counties.length > 0 ? (
                        <div className="modal-grid document-selection">
                          {counties.map(county => (
                            <div key={county.name} className="document-card-container">
                              <button
                                className="document-card"
                                onClick={() => fetchAgencies(county.name)}
                              >
                                <div className="document-main-info">
                                  <div className="doc-icon">
                                    <FontAwesomeIcon icon={faFolder} />
                                  </div>

                                  <div className="doc-details">
                                    <h4 className="doc-title">{county.displayName}</h4>

                                    <div className="doc-basic-stats">
                                      <span className="stat">
                                        <FontAwesomeIcon icon={faFileText} />
                                        {county.pdf_count} documents
                                      </span>
                                      {county.avg_pages && (
                                        <span className="stat">
                                          <FontAwesomeIcon icon={faAlignLeft} />
                                          ~{Math.round(county.avg_pages)} pages avg
                                        </span>
                                      )}
                                    </div>

                                    <div className="case-id-info">
                                      <FontAwesomeIcon icon={faIdCard} />
                                      <small>Cases: {county.provisional_cases?.length || 0}</small>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state">
                          <FontAwesomeIcon icon={faFileText} size="3x" />
                          <h4>No Sampled Documents</h4>
                          <p>No documents have been sampled from the provisional cases yet.</p>
                          <p className="empty-subtitle">
                            Use the sampling feature above to discover and download documents.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Agencies View */}
                  {currentView === 'agencies' && (
                    <div className="modal-grid document-selection">
                      {agencies.map(agency => (
                        <div key={agency.name} className="document-card-container">
                          <button
                            className="document-card"
                            onClick={() => fetchFiles(selectedCounty, agency.name)}
                          >
                            <div className="document-main-info">
                              <div className="doc-icon">
                                <FontAwesomeIcon icon={faBuilding} />
                              </div>

                              <div className="doc-details">
                                <h4 className="doc-title">{agency.name}</h4>

                                <div className="doc-basic-stats">
                                  <span className="stat">
                                    <FontAwesomeIcon icon={faFileText} />
                                    {agency.pdf_count} documents
                                  </span>
                                  <span className="stat">
                                    <FontAwesomeIcon icon={faUser} />
                                    {agency.subject_count} subjects
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Files View */}
                  {currentView === 'files' && (
                    <div className="modal-grid document-selection">
                      {files.map(file => (
                        <div key={file.path || file.fullId} className="document-card-container">
                          <button
                            className="document-card"
                            onClick={() => handleDriveFileSelect(file)}
                            disabled={downloadingFile === file.path || !file.fullId}
                          >
                            <div className="document-main-info">
                              <div className="doc-icon">
                                {downloadingFile === file.path ? (
                                  <FontAwesomeIcon icon={faSpinner} spin />
                                ) : (
                                  <FontAwesomeIcon icon={faFileText} />
                                )}
                              </div>

                              <div className="doc-details">
                                <h4 className="doc-title" title={file.displayName}>
                                  {file.displayName}
                                </h4>

                                <div className="doc-basic-stats">
                                  {file.page_num > 0 && (
                                    <span className="stat">
                                      <FontAwesomeIcon icon={faAlignLeft} />
                                      {file.page_num} pages
                                    </span>
                                  )}
                                  {file.estimated_size_kb > 0 && (
                                    <span className="stat">
                                      <FontAwesomeIcon icon={faHashtag} />
                                      {formatNumber(file.estimated_size_kb)} KB
                                    </span>
                                  )}
                                </div>

                                {file.truncatedId && (
                                  <div className="case-id-info">
                                    <FontAwesomeIcon icon={faIdCard} />
                                    <small>ID: {file.truncatedId}</small>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* File metadata section */}
                            <div className="file-metadata-section">
                              {file.subject && file.subject !== 'Unknown' && (
                                <div className="metadata-item">
                                  <FontAwesomeIcon icon={faUser} />
                                  <small>{file.subject}</small>
                                </div>
                              )}
                              {file.incident_date && (
                                <div className="metadata-item">
                                  <FontAwesomeIcon icon={faCalendar} />
                                  <small>{file.incident_date}</small>
                                </div>
                              )}
                              {file.case_numbers && (
                                <div className="metadata-item">
                                  <span className="case-badge">{file.case_numbers}</span>
                                </div>
                              )}
                              {!file.fullId && (
                                <div className="metadata-item error">
                                  <FontAwesomeIcon icon={faExclamationTriangle} />
                                  <small>No Drive ID</small>
                                </div>
                              )}
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div >
  );
};

export default UnifiedFileBrowser;