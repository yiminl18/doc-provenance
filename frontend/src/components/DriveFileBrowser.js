// DriveFileBrowser.js - Updated with DocumentSelectionModal styling
import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCloud, faDownload, faDice, faSpinner, faFileText, faFolder,
  faArrowLeft, faBuilding, faMapMarkerAlt, faUser, faCalendar, faIdCard,
  faTimes, faExclamationTriangle, faHashtag, faAlignLeft, faInfoCircle
} from '@fortawesome/free-solid-svg-icons';

import { getDriveCounties, getDriveAgencies, getDriveFiles, downloadDriveFile, sampleExtractableDocuments } from '../services/api';

const DriveFileBrowser = ({ isOpen, onClose, onFileSelect }) => {
  const [currentView, setCurrentView] = useState('counties'); // counties -> agencies -> files
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedAgency, setSelectedAgency] = useState(null);

  const [counties, setCounties] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [files, setFiles] = useState([]);

  const [sampling, setSampling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && currentView === 'counties') {
      fetchCounties();
    }
  }, [isOpen, currentView]);

  const handleSmartSampling = async () => {
    setSampling(true);
    setError(null);
    try {
      const result = await sampleExtractableDocuments({
        max_documents: 5,
        prefer_diverse_cases: true,
        min_pages: 2
      });
      
      if (result.success && result.documents.length > 0) {
        // Show success and refresh
        alert(`Successfully sampled ${result.documents.length} documents from ${result.stats.cases_represented} different cases!`);
        
        // Refresh the counties view to show newly sampled files
        if (currentView === 'counties') {
          fetchCounties();
        }
        
        // Close the browser since documents are now available
        onClose();
        
      } else {
        setError(`Sampling completed but only found ${result.documents?.length || 0} extractable PDFs.`);
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
      const data = await getDriveCounties();
      if (data.success) {
        // Filter and enhance counties data for provisional cases
        const enhancedCounties = data.counties.map(county => ({
          ...county,
          displayName: county.name.replace(/^\d+-/, ''), // Remove timestamp prefix for display
          originalName: county.name,
          isProvisionalCase: true
        })).sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        setCounties(enhancedCounties);
      } else {
        setError('Failed to load document cases');
      }
    } catch (error) {
      console.error('Error fetching counties:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgencies = async (countyOriginalName) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDriveAgencies(countyOriginalName);
      if (data.success) {
        setAgencies(data.agencies);
        setSelectedCounty(countyOriginalName);
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
      const data = await getDriveFiles(county, agency);
      if (data.success) {
        // Enhance files with display information
        const enhancedFiles = data.files.map(file => {
          // Extract truncated gdrive_id for display (last 8 characters)
          let truncatedId = '';
          if (file.file_id) {
            truncatedId = file.file_id.length > 8 
              ? '...' + file.file_id.slice(-8) 
              : file.file_id;
          }
          
          return {
            ...file,
            displayName: file.name,
            truncatedId,
            fullId: file.file_id
          };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName));
        
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

  const handleFileSelect = async (file) => {
    if (!file.fullId) {
      setError('File missing Drive ID');
      return;
    }

    setDownloadingFile(file.path);
    setError(null);
    try {
      const data = await downloadDriveFile(file.fullId);

      if (data.success) {
        onFileSelect({
          ...data,
          provisional_case_name: selectedCounty,
          county: file.county,
          agency: file.agency
        });
        onClose();
      } else {
        setError(`Failed to download file: ${data.error}`);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      setError('Error downloading file');
    } finally {
      setDownloadingFile(null);
    }
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

  const getDisplayCountyName = (originalName) => {
    const county = counties.find(c => c.originalName === originalName);
    return county ? county.displayName : originalName;
  };

  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const retryCurrentAction = () => {
    setError(null);
    if (currentView === 'counties') {
      fetchCounties();
    } else if (currentView === 'agencies' && selectedCounty) {
      fetchAgencies(selectedCounty);
    } else if (currentView === 'files' && selectedCounty && selectedAgency) {
      fetchFiles(selectedCounty, selectedAgency);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-container document-selection">
        <div className="modal-header">
          <div className="header-content">
            <FontAwesomeIcon icon={faCloud} />
            <h3>
              {currentView === 'counties' && 'Document Browser'}
              {currentView === 'agencies' && `${getDisplayCountyName(selectedCounty)} Sources`}
              {currentView === 'files' && `${selectedAgency} Documents`}
            </h3>
            {(currentView === 'agencies' || currentView === 'files') && (
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
            {currentView !== 'counties' && (
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
              <p>Loading document collection...</p>
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
              {/* Counties View - now showing provisional cases */}
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
                        <div key={county.originalName} className="document-card-container">
                          <button
                            className="document-card"
                            onClick={() => fetchAgencies(county.originalName)}
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
                                  <small>Case: {county.originalName}</small>
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
                      <h4>No Documents Available</h4>
                      <p>No document cases are currently available in the system.</p>
                      <p className="empty-subtitle">
                        Use the sampling feature above to discover and download documents from the collection.
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
                        onClick={() => handleFileSelect(file)}
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
                            
                            {/* File ID for disambiguation */}
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
        </div>
      </div>
    </div>
  );
};

export default DriveFileBrowser;