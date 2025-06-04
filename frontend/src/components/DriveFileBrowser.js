// DriveInventoryBrowser.js
import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCloud, faDownload, faDice, faSpinner, faFileAlt, faFolder,
  faArrowLeft, faBuilding, faMapMarkerAlt, faUser, faCalendar
} from '@fortawesome/free-solid-svg-icons';

import { getDriveCounties, getDriveAgencies, getDriveFiles, downloadDriveFile, sampleExtractableDocuments } from '../services/api'; // Adjust the import path as needed

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

  useEffect(() => {
    if (isOpen && currentView === 'counties') {
      fetchCounties();
    }
  }, [isOpen, currentView]);

  const handleSmartSampling = async () => {
  setSampling(true);
  try {
    const result = await sampleExtractableDocuments(5);
    
    if (result.success && result.documents.length > 0) {
      // Show success modal or notification
      alert(`Successfully found ${result.documents.length} extractable PDFs! Check your document list.`);
      
      // Close the browser since documents are now available
      onClose();
      
    } else {
      alert(`Sampling completed but only found ${result.documents?.length || 0} extractable PDFs.`);
    }
  } catch (error) {
    console.error('Sampling failed:', error);
    alert('Sampling failed. Please try again.');
  } finally {
    setSampling(false);
  }
};

  // Replace the fetch calls with:
  const fetchCounties = async () => {
    setLoading(true);
    try {
      const data = await getDriveCounties();
      if (data.success) {
        setCounties(data.counties);
      }
    } catch (error) {
      console.error('Error fetching counties:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgencies = async (county) => {
    setLoading(true);
    try {
      const data = await getDriveAgencies(county);
      if (data.success) {
        setAgencies(data.agencies);
        setSelectedCounty(county);
        setCurrentView('agencies');
      }
    } catch (error) {
      console.error('Error fetching agencies:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (county, agency) => {
    setLoading(true);
    try {
      const data = await getDriveFiles(county, agency);
      if (data.success) {
        setFiles(data.files);
        setSelectedAgency(agency);
        setCurrentView('files');
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file) => {
    if (!file.id) {
      console.error('File missing Drive ID');
      return;
    }

    setDownloadingFile(file.path);
    try {
      const data = await downloadDriveFile(file.id);

      if (data.success) {
        onFileSelect(data);
        onClose();
      } else {
        console.error('Failed to download file:', data.error);
        alert(`Failed to download file: ${data.error}`);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error downloading file');
    } finally {
      setDownloadingFile(null);
    }
  };


  const goBack = () => {
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

  const resetBrowser = () => {
    setCurrentView('counties');
    setSelectedCounty(null);
    setSelectedAgency(null);
    setCounties([]);
    setAgencies([]);
    setFiles([]);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preloaded-modal">
        <div className="modal-header">
          <div className="header-content">
            <h3>
              <FontAwesomeIcon icon={faCloud} /> Drive Document Browser
            </h3>
            <div className="breadcrumb">
              {currentView === 'agencies' && selectedCounty && (
                <span><FontAwesomeIcon icon={faMapMarkerAlt} /> {selectedCounty}</span>
              )}
              {currentView === 'files' && selectedCounty && selectedAgency && (
                <span>
                  <FontAwesomeIcon icon={faMapMarkerAlt} /> {selectedCounty} /
                  <FontAwesomeIcon icon={faBuilding} /> {selectedAgency}
                </span>
              )}
            </div>
          </div>
          <div className="header-actions">
            {currentView !== 'counties' && (
              <button className="back-btn" onClick={goBack}>
                <FontAwesomeIcon icon={faArrowLeft} /> Back
              </button>
            )}
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <FontAwesomeIcon icon={faSpinner} spin />
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {/* Counties View */}
              {currentView === 'counties' && (
                <>
                  <p>Select a county to browse documents, or:</p>

                  {/* Smart Sampling Section */}
                  <div className="sampling-section">
                    <div className="sampling-card">
                      <h4>🎲 Smart Document Sampling</h4>
                      <p>Automatically find and download 5 random PDFs with extractable text</p>
                      <button
                        className="sample-btn"
                        onClick={handleSmartSampling}
                      >
        
                      </button>
                    </div>
                  </div>
                  <div className="browser-grid">
                    {counties.map(county => (
                      <button
                        key={county.name}
                        className="browser-card county-card"
                        onClick={() => fetchAgencies(county.name)}
                      >
                        <div className="card-icon">
                          <FontAwesomeIcon icon={faMapMarkerAlt} />
                        </div>
                        <div className="card-info">
                          <h4>{county.name}</h4>
                          <div className="card-stats">
                            <span>{county.pdf_count} PDFs</span>
                            <span>{county.agency_count} agencies</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Agencies View */}
              {currentView === 'agencies' && (
                <>
                  <p>Select an agency in {selectedCounty}:</p>
                  <div className="browser-grid">
                    {agencies.map(agency => (
                      <button
                        key={agency.name}
                        className="browser-card agency-card"
                        onClick={() => fetchFiles(selectedCounty, agency.name)}
                      >
                        <div className="card-icon">
                          <FontAwesomeIcon icon={faBuilding} />
                        </div>
                        <div className="card-info">
                          <h4>{agency.name}</h4>
                          <div className="card-stats">
                            <span>{agency.pdf_count} PDFs</span>
                            <span>{agency.subject_count} subjects</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Files View */}
              {currentView === 'files' && (
                <>
                  <p>Select a document from {selectedAgency}:</p>
                  <div className="browser-grid files-grid">
                    {files.map(file => (
                      <button
                        key={file.path}
                        className="browser-card file-card"
                        onClick={() => handleFileSelect(file)}
                        disabled={downloadingFile === file.path || !file.path}
                      >
                        <div className="card-icon">
                          {downloadingFile === file.path ? (
                            <FontAwesomeIcon icon={faSpinner} spin />
                          ) : (
                            <FontAwesomeIcon icon={faFileAlt} />
                          )}
                        </div>
                        <div className="card-info">
                          <h4 title={file.name}>{file.name}</h4>
                          <div className="card-metadata">
                            {file.subject && file.subject !== 'Unknown' && (
                              <div className="meta-item">
                                <FontAwesomeIcon icon={faUser} />
                                <span>{file.subject}</span>
                              </div>
                            )}
                            {file.incident_date && (
                              <div className="meta-item">
                                <FontAwesomeIcon icon={faCalendar} />
                                <span>{file.incident_date}</span>
                              </div>
                            )}
                            {file.case_numbers && (
                              <div className="meta-item">
                                <span className="case-badge">{file.case_numbers}</span>
                              </div>
                            )}
                          </div>
                          {!file.id && (
                            <div className="error-badge">No Drive ID</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriveFileBrowser;