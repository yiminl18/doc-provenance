import React, { useState, useEffect, useRef } from 'react';
import '../styles/PDFViewer.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faTimes, 
  faSearchPlus, 
  faSearchMinus, 
  faExpand,
  faCompress,
  faHighlighter
} from '@fortawesome/free-solid-svg-icons';

const PDFViewer = ({ document, selectedProvenance, onClose }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pdfText, setPdfText] = useState('');
  const [highlightedText, setHighlightedText] = useState('');
  const viewerRef = useRef(null);

  useEffect(() => {
    if (selectedProvenance && selectedProvenance.content) {
      // Create highlighted text from provenance content
      const highlighted = selectedProvenance.content.join(' ');
      setHighlightedText(highlighted);
      
      // In a real implementation, you would:
      // 1. Load the actual PDF file
      // 2. Extract text with position information
      // 3. Map sentence IDs to text regions
      // 4. Apply highlighting to those regions
      
      // For now, we'll simulate this with the extracted text
      simulatePDFLoad();
    }
  }, [selectedProvenance]);

  const simulatePDFLoad = async () => {
    // Simulate loading PDF text - in reality, you'd use PDF.js or similar
    // This would fetch the original PDF text and position data
    try {
      // Placeholder for actual PDF loading
      const mockPDFText = generateMockPDFText();
      setPdfText(mockPDFText);
    } catch (error) {
      console.error('Error loading PDF:', error);
    }
  };

  const generateMockPDFText = () => {
    // This is a placeholder - in reality, you'd extract this from the actual PDF
    return `
      Research Paper Title: Advanced Document Analysis

      Abstract
      This paper presents a novel approach to document analysis and provenance tracking.
      The methodology combines natural language processing with machine learning techniques
      to provide accurate and efficient document understanding.

      Introduction
      Document analysis has become increasingly important in the digital age.
      Traditional methods often fail to capture the nuanced relationships between
      different sections of complex documents.

      Methodology
      Our approach utilizes a multi-stage pipeline:
      1. Text extraction and preprocessing
      2. Semantic analysis and entity recognition
      3. Relationship mapping and provenance tracking

      Results
      The experimental results show significant improvements over baseline methods.
      Processing time was reduced by 45% while maintaining 95% accuracy.

      Conclusion
      This work demonstrates the effectiveness of our proposed methodology.
      Future work will focus on extending the approach to multimedia documents.
    `;
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const renderHighlightedText = () => {
    if (!pdfText || !highlightedText) return pdfText;

    // Simple highlighting - in a real implementation, you'd use more sophisticated matching
    const sentences = highlightedText.split('. ');
    let result = pdfText;

    sentences.forEach((sentence, index) => {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence.length > 10) { // Only highlight substantial sentences
        const regex = new RegExp(escapeRegExp(trimmedSentence), 'gi');
        result = result.replace(regex, `<mark class="highlight-${index % 3}">${trimmedSentence}</mark>`);
      }
    });

    return result;
  };

  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  return (
    <div className={`pdf-viewer-overlay ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="pdf-viewer">
        <div className="pdf-header">
          <div className="pdf-title">
            <FontAwesomeIcon icon={faHighlighter} />
            <span>{document.filename}</span>
            {selectedProvenance && (
              <span className="provenance-indicator">
                - Top-{selectedProvenance.provenance_id} Provenance Highlighted
              </span>
            )}
          </div>
          
          <div className="pdf-controls">
            <button className="control-btn" onClick={handleZoomOut} title="Zoom Out">
              <FontAwesomeIcon icon={faSearchMinus} />
            </button>
            
            <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
            
            <button className="control-btn" onClick={handleZoomIn} title="Zoom In">
              <FontAwesomeIcon icon={faSearchPlus} />
            </button>
            
            <button className="control-btn" onClick={toggleFullscreen} title="Toggle Fullscreen">
              <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
            </button>
            
            <button className="control-btn close-btn" onClick={onClose} title="Close">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>
        </div>

        <div className="pdf-content" ref={viewerRef}>
          {/* Provenance Legend */}
          {selectedProvenance && (
            <div className="highlight-legend">
              <h4>Highlighted Provenance:</h4>
              <div className="legend-items">
                <div className="legend-item">
                  <span className="legend-color highlight-0"></span>
                  <span>Primary Evidence</span>
                </div>
                <div className="legend-item">
                  <span className="legend-color highlight-1"></span>
                  <span>Supporting Context</span>
                </div>
                <div className="legend-item">
                  <span className="legend-color highlight-2"></span>
                  <span>Related Information</span>
                </div>
              </div>
            </div>
          )}

          {/* PDF Content Area */}
          <div 
            className="pdf-text-content"
            style={{ 
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top left'
            }}
            dangerouslySetInnerHTML={{ 
              __html: renderHighlightedText().replace(/\n/g, '<br/>') 
            }}
          />

          {/* In a real implementation, you would use PDF.js here: */}
          {/* 
          <div className="pdf-canvas-container">
            <canvas ref={canvasRef} className="pdf-canvas" />
          </div>
          */}
        </div>

        {/* Provenance Details Panel */}
        {selectedProvenance && (
          <div className="provenance-details">
            <h4>Provenance Details</h4>
            <div className="detail-item">
              <strong>Provenance ID:</strong> {selectedProvenance.provenance_id}
            </div>
            <div className="detail-item">
              <strong>Sentences:</strong> {selectedProvenance.sentences_ids?.join(', ') || 'N/A'}
            </div>
            <div className="detail-item">
              <strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s
            </div>
            <div className="detail-item">
              <strong>Token Usage:</strong> {selectedProvenance.input_token_size || 0} → {selectedProvenance.output_token_size || 0}
            </div>
            {selectedProvenance.content && (
              <div className="detail-item">
                <strong>Content Preview:</strong>
                <div className="content-preview">
                  {selectedProvenance.content.slice(0, 3).map((sentence, idx) => (
                    <p key={idx}>{sentence}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewer;