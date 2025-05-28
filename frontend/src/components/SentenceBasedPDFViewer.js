import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTimes,
  faSearchPlus,
  faSearchMinus,
  faExpand,
  faCompress,
  faHighlighter,
  faFileAlt,
  faEye,
  faEyeSlash,
  faSpinner,
  faChevronLeft,
  faChevronRight,
  faAlignLeft
} from '@fortawesome/free-solid-svg-icons';
import '../styles/sentence-viewer.css'

const SentenceBasedPDFViewer = ({ pdfDocument, selectedProvenance, onClose, isGridMode = false }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [documentText, setDocumentText] = useState('');
  const [sentences, setSentences] = useState([]);
  const [viewMode, setViewMode] = useState('text'); // 'text' or 'pdf'

  const containerRef = useRef(null);
  const sentenceRefs = useRef({});

  // Load document text and sentences when document changes
  useEffect(() => {
    if (!pdfDocument) {
      setDocumentText('');
      setSentences([]);
      return;
    }

    loadDocumentContent();
  }, [pdfDocument]);

  const loadDocumentContent = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔄 Loading document content for:', pdfDocument.filename);

      // Get document sentences directly from backend
      const docId = pdfDocument.backendDocumentId || pdfDocument.id;
      
      // Try to get sentences first (more efficient for sentence-based viewing)
      let sentencesResponse;
      try {
        sentencesResponse = await fetch(`/api/documents/${docId}/sentences`);
      } catch (sentenceError) {
        console.warn('Sentences endpoint not available, falling back to text endpoint');
      }

      if (sentencesResponse && sentencesResponse.ok) {
        // Use sentences endpoint
        const sentencesData = await sentencesResponse.json();
        
        if (sentencesData.success && sentencesData.sentences) {
          setSentences(sentencesData.sentences);
          setDocumentText(sentencesData.sentences.join(' '));
          
          console.log('✅ Document sentences loaded:', {
            sentenceCount: sentencesData.sentences.length,
            totalSentences: sentencesData.total_sentences
          });
        } else {
          throw new Error('No sentence data available');
        }
      } else {
        // Fallback to text endpoint and extract sentences
        const textResponse = await fetch(`/api/documents/${docId}/text`);
        if (!textResponse.ok) {
          throw new Error(`Failed to load document: ${textResponse.status} ${textResponse.statusText}`);
        }

        const textData = await textResponse.json();
        
        if (textData.success && textData.text) {
          setDocumentText(textData.text);
          
          // Extract sentences from the text
          const sentenceArray = extractSentencesFromText(textData.text);
          setSentences(sentenceArray);
          
          console.log('✅ Document text loaded and processed:', {
            textLength: textData.text.length,
            sentenceCount: sentenceArray.length
          });
        } else {
          throw new Error('No text content available');
        }
      }

      setLoading(false);

    } catch (err) {
      console.error('❌ Error loading document:', err);
      setError(`Failed to load document: ${err.message}`);
      setLoading(false);
    }
  };

  // Extract sentences from text (simplified - matches backend tokenization)
  const extractSentencesFromText = (text) => {
    // Simple sentence splitting - you might want to match your backend exactly
    const sentences = text.split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s + (s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? '' : '.'));
    
    return sentences;
  };

  // Highlight provenance sentences
  useEffect(() => {
    if (selectedProvenance && showHighlights && sentences.length > 0) {
      highlightProvenanceSentences();
    } else {
      clearHighlights();
    }
  }, [selectedProvenance, showHighlights, sentences]);

  const highlightProvenanceSentences = () => {
    clearHighlights();

    if (!selectedProvenance?.sentences_ids || selectedProvenance.sentences_ids.length === 0) {
      return;
    }

    console.log('🎯 Highlighting sentences:', selectedProvenance.sentences_ids);

    // Highlight each sentence by ID
    selectedProvenance.sentences_ids.forEach((sentenceId, index) => {
      const sentenceElement = sentenceRefs.current[sentenceId];
      if (sentenceElement) {
        sentenceElement.classList.add('highlighted-sentence');
        sentenceElement.classList.add(`highlight-${index % 3}`);
        
        // Add pulse animation to first sentence
        if (index === 0) {
          sentenceElement.classList.add('pulse-highlight');
        }
      }
    });

    // Scroll to first highlighted sentence
    setTimeout(() => scrollToFirstHighlight(), 300);
  };

  const clearHighlights = () => {
    Object.values(sentenceRefs.current).forEach(element => {
      if (element) {
        element.classList.remove('highlighted-sentence', 'highlight-0', 'highlight-1', 'highlight-2', 'pulse-highlight');
      }
    });
  };

  const scrollToFirstHighlight = () => {
    if (!selectedProvenance?.sentences_ids || selectedProvenance.sentences_ids.length === 0) {
      return;
    }

    const firstSentenceId = selectedProvenance.sentences_ids[0];
    const firstElement = sentenceRefs.current[firstSentenceId];
    
    if (firstElement && containerRef.current) {
      firstElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center',
        inline: 'nearest'
      });
      console.log('📍 Scrolled to sentence:', firstSentenceId);
    }
  };

  // Control handlers
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.1, 2.0));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.1, 0.5));
  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);
  const toggleHighlights = () => setShowHighlights(!showHighlights);

  // Render states
  if (!pdfDocument) {
    return (
      <div className="pdf-viewer-empty">
        <div className="empty-content">
          <FontAwesomeIcon icon={faFileAlt} size="3x" />
          <h3>No Document Selected</h3>
          <p>Upload a PDF to view content</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pdf-viewer-loading">
        <div className="loading-content">
          <FontAwesomeIcon icon={faSpinner} spin size="2x" />
          <h3>Loading Document...</h3>
          <p>{pdfDocument.filename}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-viewer-error">
        <div className="error-content">
          <h3>Document Loading Error</h3>
          <p>{error}</p>
          <button onClick={loadDocumentContent} className="retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`sentence-pdf-viewer ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <FontAwesomeIcon icon={faAlignLeft} />
          <span>{pdfDocument.filename}</span>
          {selectedProvenance && (
            <span className="provenance-badge">
              Evidence {selectedProvenance.provenance_id || 1} ({selectedProvenance.sentences_ids?.length || 0} sentences)
            </span>
          )}
        </div>

        <div className="pdf-controls">
          <button onClick={toggleHighlights} className="control-btn">
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
          </button>
          
          <button onClick={handleZoomOut} className="control-btn">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>
          
          <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>
          
          <button onClick={handleZoomIn} className="control-btn">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>
          
          <button onClick={toggleFullscreen} className="control-btn">
            <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
          </button>
          
          {onClose && (
            <button onClick={onClose} className="control-btn close-btn">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          )}
        </div>
      </div>

      {/* Document Stats */}
      <div className="document-stats">
        <div className="stat">
          <span className="stat-label">Sentences:</span>
          <span className="stat-value">{sentences.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Characters:</span>
          <span className="stat-value">{documentText.length.toLocaleString()}</span>
        </div>
        {selectedProvenance && (
          <div className="stat highlighted">
            <span className="stat-label">Highlighted:</span>
            <span className="stat-value">{selectedProvenance.sentences_ids?.length || 0} sentences</span>
          </div>
        )}
      </div>

      {/* Document Content */}
      <div className="pdf-content" ref={containerRef}>
        <div 
          className="sentence-container"
          style={{ 
            fontSize: `${zoomLevel}rem`,
            lineHeight: 1.6
          }}
        >
          {sentences.map((sentence, index) => (
            <span
              key={index}
              ref={el => sentenceRefs.current[index] = el}
              className="sentence"
              data-sentence-id={index}
              onClick={() => console.log('Clicked sentence:', index, sentence)}
              title={`Sentence ${index}: Click to inspect`}
            >
              {sentence}{' '}
            </span>
          ))}
        </div>
      </div>

      {/* Provenance Info */}
      {selectedProvenance && showHighlights && (
        <div className="provenance-info">
          <h4>
            <FontAwesomeIcon icon={faHighlighter} />
            Highlighted Evidence
          </h4>
          <div className="provenance-details">
            <div className="detail">
              <strong>Provenance ID:</strong> {selectedProvenance.provenance_id}
            </div>
            <div className="detail">
              <strong>Sentence IDs:</strong> {selectedProvenance.sentences_ids?.join(', ') || 'None'}
            </div>
            <div className="detail">
              <strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s
            </div>
            <div className="detail">
              <strong>Token Usage:</strong> {selectedProvenance.input_token_size || 'N/A'} in, {selectedProvenance.output_token_size || 'N/A'} out
            </div>
          </div>
          
          {selectedProvenance.sentences_ids && selectedProvenance.sentences_ids.length > 0 && (
            <div className="highlighted-sentences-preview">
              <strong>Highlighted Text:</strong>
              <div className="preview-text">
                {selectedProvenance.sentences_ids.map(id => sentences[id]).join(' ')}
              </div>
            </div>
          )}
        </div>
      )}

     
    </div>
  );
};

export default SentenceBasedPDFViewer;