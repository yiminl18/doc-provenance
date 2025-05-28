import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHighlighter,
  faAlignLeft,
  faSearchPlus,
  faSearchMinus,
  faExpand,
  faCompress,
  faMapPin,
  faListOl
} from '@fortawesome/free-solid-svg-icons';

const ProvenancePanel = ({ 
  sentences, 
  selectedProvenance, 
  currentPage, 
  sentenceMapper, 
  showHighlights 
}) => {
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [viewMode, setViewMode] = useState('context'); // 'context' or 'evidence-only'
  const [isExpanded, setIsExpanded] = useState(false);
  
  const containerRef = useRef(null);
  const sentenceRefs = useRef({});

  // Auto-scroll to first highlighted sentence when provenance changes
  useEffect(() => {
    if (selectedProvenance && showHighlights && sentenceMapper) {
      scrollToFirstEvidence();
    }
  }, [selectedProvenance, showHighlights, sentenceMapper]);

  const scrollToFirstEvidence = () => {
    if (!selectedProvenance?.sentences_ids || selectedProvenance.sentences_ids.length === 0) return;

    const firstSentenceId = selectedProvenance.sentences_ids[0];
    const firstElement = sentenceRefs.current[firstSentenceId];
    
    if (firstElement && containerRef.current) {
      firstElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center',
        inline: 'nearest'
      });
      
      // Add pulse animation
      firstElement.classList.add('pulse-highlight');
      setTimeout(() => {
        firstElement.classList.remove('pulse-highlight');
      }, 2000);
    }
  };

  // Get sentences to display based on view mode
  const getSentencesToDisplay = () => {
    if (!sentenceMapper || !selectedProvenance) {
      return [];
    }

    if (viewMode === 'evidence-only') {
      // Show only the evidence sentences
      return selectedProvenance.sentences_ids
        .map(id => ({ id, sentence: sentences[id], isEvidence: true }))
        .filter(item => item.sentence);
    } else {
      // Show context around evidence (current page + some surrounding sentences)
      const evidenceSentences = new Set(selectedProvenance.sentences_ids);
      const contextSentences = [];
      
      // Find all sentences on current page
      const sentencesOnPage = sentenceMapper.getSentencesOnPage(currentPage);
      
      // Add some sentences before and after for context
      const contextRange = 5; // Show 5 sentences before and after evidence
      const allEvidenceIds = [...evidenceSentences];
      const minId = Math.max(0, Math.min(...allEvidenceIds) - contextRange);
      const maxId = Math.min(sentences.length - 1, Math.max(...allEvidenceIds) + contextRange);
      
      for (let i = minId; i <= maxId; i++) {
        if (sentences[i]) {
          contextSentences.push({
            id: i,
            sentence: sentences[i],
            isEvidence: evidenceSentences.has(i),
            isOnCurrentPage: sentenceMapper.getPageForSentence(i) === currentPage
          });
        }
      }
      
      return contextSentences;
    }
  };

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.1, 2.0));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.1, 0.5));
  const toggleViewMode = () => setViewMode(prev => prev === 'context' ? 'evidence-only' : 'context');
  const toggleExpanded = () => setIsExpanded(!isExpanded);

  const sentencesToDisplay = getSentencesToDisplay();

  if (!selectedProvenance || !showHighlights) {
    return (
      <div className="sentence-detail-panel">
        <div className="panel-header">
          <FontAwesomeIcon icon={faAlignLeft} />
          <h3>Sentence Detail</h3>
        </div>
        <div className="panel-empty">
          <p>Select evidence to see detailed sentence highlighting</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`sentence-detail-panel ${isExpanded ? 'expanded' : ''}`}>
      {/* Panel Header */}
      <div className="panel-header">
        <div className="panel-title">
          <FontAwesomeIcon icon={faHighlighter} />
          <h3>Evidence Detail</h3>
          <span className="evidence-badge">
            {selectedProvenance.provenance_id}
          </span>
        </div>
        
        <div className="panel-controls">
          <button 
            onClick={toggleViewMode} 
            className="control-btn"
            title={viewMode === 'context' ? 'Show evidence only' : 'Show with context'}
          >
            <FontAwesomeIcon icon={viewMode === 'context' ? faListOl : faMapPin} />
          </button>
          
          <button onClick={handleZoomOut} className="control-btn">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>
          
          <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>
          
          <button onClick={handleZoomIn} className="control-btn">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>
          
          <button onClick={toggleExpanded} className="control-btn">
            <FontAwesomeIcon icon={isExpanded ? faCompress : faExpand} />
          </button>
        </div>
      </div>

      {/* Panel Stats */}
      <div className="panel-stats">
        <div className="stat">
          <strong>Evidence Sentences:</strong> {selectedProvenance.sentences_ids?.length || 0}
        </div>
        <div className="stat">
          <strong>View Mode:</strong> {viewMode === 'context' ? 'With Context' : 'Evidence Only'}
        </div>
        <div className="stat">
          <strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s
        </div>
      </div>

      {/* Sentence Content */}
      <div className="sentence-content" ref={containerRef}>
        <div 
          className="sentence-container"
          style={{ 
            fontSize: `${zoomLevel}rem`,
            lineHeight: 1.6
          }}
        >
          {sentencesToDisplay.map((item, index) => (
            <span
              key={item.id}
              ref={el => sentenceRefs.current[item.id] = el}
              className={`
                sentence
                ${item.isEvidence ? 'evidence-sentence' : 'context-sentence'}
                ${item.isOnCurrentPage ? 'on-current-page' : 'other-page'}
                ${item.isEvidence ? `highlight-${(selectedProvenance.sentences_ids.indexOf(item.id)) % 3}` : ''}
              `}
              data-sentence-id={item.id}
              title={`Sentence ${item.id}${item.isEvidence ? ' (Evidence)' : ' (Context)'}${
                sentenceMapper ? ` - Page ${sentenceMapper.getPageForSentence(item.id)}` : ''
              }`}
            >
              {item.sentence}
              {index < sentencesToDisplay.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* Evidence Summary */}
      <div className="evidence-summary">
        <h4>Evidence Summary</h4>
        <div className="summary-grid">
          <div className="summary-item">
            <strong>Confidence:</strong>
            <div className="confidence-bar">
              {selectedProvenance.sentences_ids?.map((sentenceId, index) => {
                const mappingInfo = sentenceMapper?.getMappingInfo(sentenceId);
                const confidence = mappingInfo?.confidence || 0;
                return (
                  <div 
                    key={sentenceId}
                    className="confidence-segment"
                    style={{ 
                      width: `${100 / selectedProvenance.sentences_ids.length}%`,
                      backgroundColor: `hsl(${confidence * 120}, 70%, 50%)`,
                      opacity: 0.7
                    }}
                    title={`Sentence ${sentenceId}: ${Math.round(confidence * 100)}% confidence`}
                  />
                );
              })}
            </div>
          </div>
          
          <div className="summary-item">
            <strong>Page Distribution:</strong>
            <div className="page-distribution">
              {sentenceMapper && (() => {
                const pageCount = {};
                selectedProvenance.sentences_ids.forEach(id => {
                  const page = sentenceMapper.getPageForSentence(id);
                  pageCount[page] = (pageCount[page] || 0) + 1;
                });
                return Object.entries(pageCount).map(([page, count]) => (
                  <span key={page} className="page-badge">
                    Page {page}: {count}
                  </span>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .sentence-detail-panel {
            height: 100%;
            display: flex;
            flex-direction: column;
            background: white;
            font-family: var(--font-display, -apple-system, BlinkMacSystemFont, sans-serif);
          }
          
          .sentence-detail-panel.expanded {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 50%;
            z-index: 1000;
            box-shadow: -4px 0 8px rgba(0,0,0,0.2);
          }
          
          .panel-header {
            display: flex;
            justify-content: space-between;  
            align-items: center;
            padding: 12px 16px;
            background: #f8f9fa;
            border-bottom: 2px solid #dee2e6;
            flex-shrink: 0;
          }
          
          .panel-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: bold;
            color: #495057;
          }
          
          .panel-title h3 {
            margin: 0;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .evidence-badge {
            background: #007bff;
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: normal;
          }
          
          .panel-controls {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          
          .control-btn {
            padding: 6px 8px;
            border: 1px solid #dee2e6;
            background: white;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
            transition: background-color 0.2s;
          }
          
          .control-btn:hover {
            background: #f8f9fa;
          }
          
          .zoom-display {
            font-size: 11px;
            font-weight: bold;
            color: #007bff;
            min-width: 45px;
            text-align: center;
          }
          
          .panel-stats {
            padding: 8px 16px;
            background: #e9ecef;
            border-bottom: 1px solid #dee2e6;
            flex-shrink: 0;
          }
          
          .panel-stats .stat {
            font-size: 11px;
            color: #495057;
            margin-bottom: 4px;
          }
          
          .panel-stats .stat:last-child {
            margin-bottom: 0;
          }
          
          .panel-stats strong {
            color: #007bff;
          }
          
          .sentence-content {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            background: white;
          }
          
          .sentence-container {
            font-family: 'Times New Roman', serif;
            color: #333;
            line-height: 1.6;
          }
          
          .sentence {
            position: relative;
            cursor: pointer;
            transition: all 0.2s ease;
            border-radius: 3px;
            padding: 2px 3px;
            margin: 0 1px;
            display: inline;
          }
          
          .sentence:hover {
            background-color: rgba(0, 123, 255, 0.1);
          }
          
          .sentence.context-sentence {
            opacity: 0.7;
            font-style: italic;
          }
          
          .sentence.other-page {
            opacity: 0.5;
          }
          
          .sentence.evidence-sentence {
            font-weight: 600;
            padding: 4px 6px;
            margin: 2px;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .sentence.highlight-0 {
            background: linear-gradient(135deg, rgba(255, 235, 59, 0.9), rgba(255, 193, 7, 0.7));
            border: 2px solid #ffc107;
            color: #333;
          }
          
          .sentence.highlight-1 {
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.9), rgba(46, 125, 50, 0.7));
            border: 2px solid #28a745;
            color: white;
            text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
          }
          
          .sentence.highlight-2 {
            background: linear-gradient(135deg, rgba(33, 150, 243, 0.9), rgba(21, 101, 192, 0.7));
            border: 2px solid #007bff;
            color: white;
            text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
          }
          
          .sentence.pulse-highlight {
            animation: pulse-glow 2s ease-in-out;
          }
          
          @keyframes pulse-glow {
            0% { 
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              transform: scale(1);
            }
            50% { 
              box-shadow: 0 4px 16px rgba(255, 235, 59, 0.8);
              transform: scale(1.02);
            }
            100% { 
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              transform: scale(1);
            }
          }
          
          .sentence::before {
            content: "ID: " attr(data-sentence-id);
            position: absolute;
            top: -25px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-family: monospace;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
            z-index: 100;
          }
          
          .sentence:hover::before {
            opacity: 1;
          }
          
          .evidence-summary {
            padding: 12px 16px;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
            flex-shrink: 0;
          }
          
          .evidence-summary h4 {
            margin: 0 0 8px 0;
            font-size: 12px;
            color: #495057;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .summary-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          
          .summary-item {
            font-size: 11px;
          }
          
          .summary-item strong {
            color: #007bff;
            display: block;
            margin-bottom: 4px;
          }
          
          .confidence-bar {
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            display: flex;
            overflow: hidden;
            border: 1px solid #dee2e6;
          }
          
          .confidence-segment {
            height: 100%;
            transition: all 0.3s ease;
          }
          
          .confidence-segment:hover {
            opacity: 1 !important;
          }
          
          .page-distribution {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
          }
          
          .page-badge {
            background: #007bff;
            color: white;
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: bold;
          }
          
          .panel-empty {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #6c757d;
            font-style: italic;
            text-align: center;
            padding: 40px 20px;
          }
          
          /* Scrollbar styling */
          .sentence-content::-webkit-scrollbar {
            width: 8px;
          }
          
          .sentence-content::-webkit-scrollbar-track {
            background: #f1f1f1;
          }
          
          .sentence-content::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
          }
          
          .sentence-content::-webkit-scrollbar-thumb:hover {
            background: #a1a1a1;
          }
        `
      }} />
    </div>
  );
};

export default ProvenancePanel;