// Create this file as: src/components/DevelopmentHelper.js

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCog, 
  faEye, 
  faEyeSlash, 
  faDatabase,
  faChartBar,
  faDownload
} from '@fortawesome/free-solid-svg-icons';

const DevelopmentHelper = ({ 
  currentSession, 
  activeDocument, 
  activeQuestion,
  onConfigChange 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [config, setConfig] = useState(null);
  const [completeProvenance, setCompleteProvenance] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load experiment config
  useEffect(() => {
    if (isVisible && !config && process.env.NODE_ENV === 'development') {
      loadConfig();
    }
  }, [isVisible]);

  // Only show in development - but call hooks first!
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const loadConfig = async () => {
    try {
      // Try to get experiment config from backend
      const response = await fetch('/api/admin/experiment-config');
      if (response.ok) {
        const configData = await response.json();
        setConfig(configData);
      } else {
        // Fallback default config
        setConfig({
          experiment_top_k: 5,
          max_provenance_processing: 50,
          processing_timeout: 300
        });
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      // Fallback default config
      setConfig({
        experiment_top_k: 5,
        max_provenance_processing: 50,
        processing_timeout: 300
      });
    }
  };

  const updateTopK = async (newK) => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/experiment-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ experiment_top_k: newK }),
      });

      if (response.ok) {
        const result = await response.json();
        setConfig(prev => ({ ...prev, experiment_top_k: newK }));
        onConfigChange?.(result);
        alert(`Updated experiment top-K to ${newK}. This affects new questions only.`);
      } else {
        throw new Error('Failed to update config');
      }
    } catch (error) {
      console.error('Failed to update config:', error);
      alert(`Failed to update config: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadCompleteProvenance = async () => {
    if (!currentSession?.session_id || !activeQuestion?.id) {
      alert('Need active session and question to load complete provenance');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/admin/sessions/${currentSession.session_id}/questions/${activeQuestion.id}/complete-provenance`);
      
      if (response.ok) {
        const complete = await response.json();
        setCompleteProvenance(complete);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load complete provenance:', error);
      alert(`Failed to load complete provenance: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadCompleteData = () => {
    if (!completeProvenance) return;

    const dataStr = JSON.stringify(completeProvenance, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `complete_provenance_${activeQuestion?.id || 'unknown'}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const getProvenanceStats = () => {
    if (!activeQuestion) return null;

    return {
      totalFound: activeQuestion.totalProvenanceFound || 0,
      userVisible: activeQuestion.userVisibleProvenance || 0,
      currentSources: activeQuestion.provenanceSources?.length || 0,
      experimentTopK: activeQuestion.experimentTopK || 5,
      processingStatus: activeQuestion.processingStatus,
      hasHiddenResults: !!activeQuestion.hiddenResultsMessage
    };
  };

  const stats = getProvenanceStats();

  return (
    <div className="development-helper">
      <button
        className="dev-toggle-btn"
        onClick={() => setIsVisible(!isVisible)}
        title="Development Tools"
      >
        <FontAwesomeIcon icon={faCog} />
        {isVisible ? <FontAwesomeIcon icon={faEyeSlash} /> : <FontAwesomeIcon icon={faEye} />}
      </button>

      {isVisible && (
        <div className="dev-panel">
          <div className="dev-header">
            <h4>🔧 Development Tools</h4>
            <button onClick={() => setIsVisible(false)}>✕</button>
          </div>

          {/* Experiment Configuration */}
          <div className="dev-section">
            <h5><FontAwesomeIcon icon={faCog} /> Experiment Config</h5>
            {config && (
              <div className="config-controls">
                <div className="config-item">
                  <label>Top-K Limit:</label>
                  <select 
                    value={config.experiment_top_k} 
                    onChange={(e) => updateTopK(parseInt(e.target.value))}
                    disabled={loading}
                  >
                    {[1,2,3,4,5,6,7,8,9,10,15,20].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div className="config-item">
                  <label>Max Processing:</label>
                  <span>{config.max_provenance_processing}</span>
                </div>
                <div className="config-item">
                  <label>Timeout:</label>
                  <span>{config.processing_timeout}s</span>
                </div>
              </div>
            )}
          </div>

          {/* Current Question Stats */}
          {stats && (
            <div className="dev-section">
              <h5><FontAwesomeIcon icon={faChartBar} /> Current Question Stats</h5>
              <div className="stats-grid">
                <div className="stat-item">
                  <label>Total Found:</label>
                  <span className={stats.totalFound > stats.userVisible ? 'highlight' : ''}>
                    {stats.totalFound}
                  </span>
                </div>
                <div className="stat-item">
                  <label>User Visible:</label>
                  <span>{stats.userVisible}</span>
                </div>
                <div className="stat-item">
                  <label>Currently Loaded:</label>
                  <span>{stats.currentSources}</span>
                </div>
                <div className="stat-item">
                  <label>Experiment Top-K:</label>
                  <span>{stats.experimentTopK}</span>
                </div>
                <div className="stat-item">
                  <label>Status:</label>
                  <span className={`status-${stats.processingStatus}`}>
                    {stats.processingStatus}
                  </span>
                </div>
                <div className="stat-item">
                  <label>Has Hidden:</label>
                  <span className={stats.hasHiddenResults ? 'highlight' : ''}>
                    {stats.hasHiddenResults ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Complete Provenance Tools */}
          <div className="dev-section">
            <h5><FontAwesomeIcon icon={faDatabase} /> Complete Provenance</h5>
            <div className="provenance-tools">
              <button 
                onClick={loadCompleteProvenance}
                disabled={loading || !activeQuestion}
                className="dev-btn"
              >
                Load Complete Data
              </button>
              
              {completeProvenance && (
                <div className="complete-info">
                  <p>
                    Loaded {completeProvenance.complete_provenance?.all_provenance_entries?.length || 0} total entries
                  </p>
                  <button 
                    onClick={downloadCompleteData}
                    className="dev-btn download-btn"
                  >
                    <FontAwesomeIcon icon={faDownload} />
                    Download JSON
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Session Info */}
          <div className="dev-section">
            <h5>📋 Session Info</h5>
            <div className="session-info">
              <div><strong>Session:</strong> {currentSession?.session_id || 'None'}</div>
              <div><strong>Document:</strong> {activeDocument?.filename || 'None'}</div>
              <div><strong>Question:</strong> {activeQuestion?.id || 'None'}</div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
          .development-helper {
            position: fixed;
            top: 100px;
            right: 10px;
            z-index: 9999;
          }
          
          .dev-toggle-btn {
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            font-size: 12px;
          }
          
          .dev-panel {
            position: absolute;
            top: 60px;
            right: 0;
            width: 350px;
            max-height: 80vh;
            background: white;
            border: 2px solid #333;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
          }
          
          .dev-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px;
            background: #333;
            color: white;
            border-radius: 6px 6px 0 0;
          }
          
          .dev-header h4 {
            margin: 0;
            font-size: 14px;
          }
          
          .dev-header button {
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            font-size: 16px;
          }
          
          .dev-section {
            padding: 15px;
            border-bottom: 1px solid #eee;
          }
          
          .dev-section:last-child {
            border-bottom: none;
          }
          
          .dev-section h5 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          
          .config-controls, .stats-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          
          .config-item, .stat-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .config-item label, .stat-item label {
            font-weight: bold;
            color: #666;
          }
          
          .config-item select {
            padding: 2px 5px;
            border: 1px solid #ccc;
            border-radius: 3px;
          }
          
          .highlight {
            color: #ff6b6b !important;
            font-weight: bold;
          }
          
          .status-completed { color: #4CAF50; }
          .status-processing { color: #2196F3; }
          .status-error { color: #f44336; }
          .status-timeout { color: #ff9800; }
          
          .provenance-tools {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          
          .dev-btn {
            padding: 8px 12px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
          }
          
          .dev-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .dev-btn:hover:not(:disabled) {
            background: #1976D2;
          }
          
          .download-btn {
            background: #4CAF50;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
          }
          
          .download-btn:hover {
            background: #388E3C;
          }
          
          .complete-info {
            background: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            margin-top: 8px;
          }
          
          .complete-info p {
            margin: 0 0 8px 0;
            font-size: 11px;
          }
          
          .session-info div {
            margin-bottom: 5px;
            font-size: 11px;
          }
          
          .session-info strong {
            color: #333;
          }
        `
      }} />
    </div>
  );
};

export default DevelopmentHelper;