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
  faAlignLeft,
  faMapMarkedAlt
} from '@fortawesome/free-solid-svg-icons';
import '../styles/pdf-viewer.css'
import { SentencePDFMapper } from '../utils/SentencePDFMapper';
//import ProvenancePanel from './ProvenancePanel';

const HybridPDFViewer = ({ pdfDocument, selectedProvenance, onClose, navigationTrigger }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [showDetailPanel, setShowDetailPanel] = useState(true);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState(null);

  // Enhanced sentence mapping
  const [sentences, setSentences] = useState([]);
  const [sentenceMapper, setSentenceMapper] = useState(null);
  const [mappingStats, setMappingStats] = useState(null);

  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const highlightLayerRef = useRef(null);

  // Initialize PDF.js worker once
  useEffect(() => {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      console.log('✅ PDF.js worker initialized');
    }
  }, []);

  // Generate PDF URL when document changes
  useEffect(() => {
    if (!pdfDocument) {
      setPdfUrl(null);
      return;
    }

    let url = '';

    if (pdfDocument.file) {
      url = URL.createObjectURL(pdfDocument.filename);
      console.log('📁 Using file blob URL');
    } else {
      url = `/api/documents/${pdfDocument.filename}`;
      console.log('🔗 Using backend PDF URL:', url);
    }

    setPdfUrl(url);

    return () => {
      if (pdfDocument.file && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pdfDocument]);

  // Load PDF document and sentence data
  useEffect(() => {
    if (!pdfUrl || !window.pdfjsLib) return;
    loadPDFAndSentences();
  }, [pdfUrl]);

  const loadPDFAndSentences = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🔄 Loading PDF and sentence data...');

      const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
      if (!testResponse.ok) {
        throw new Error(`PDF not accessible: ${testResponse.status} ${testResponse.statusText}`);
      }

      const loadingTask = window.pdfjsLib.getDocument({
        url: pdfUrl,
        verbosity: 0
      });

      const pdf = await loadingTask.promise;
      console.log('✅ PDF loaded successfully:', pdf.numPages, 'pages');

      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);

      // Load sentence mapping in parallel
      loadSentenceMapping(pdf).catch(err => {
        console.warn('Sentence mapping failed, continuing with basic PDF:', err);
      });

      setLoading(false);

    } catch (err) {
      console.error('❌ Error loading PDF:', err);
      setError(`Failed to load document: ${err.message}`);
      setLoading(false);
    }
  };
const loadSentenceMapping = async (pdf) => {
  try {
  // Use the backend filename to construct sentences filename
    const backendFilename = pdfDocument.filename;
    console.log('🔄 PDF Document:', pdfDocument);
    console.log('📄 Backend filename:', backendFilename);
    const baseFilename = backendFilename.replace('.pdf', '');
    const sentencesFilename = `${baseFilename}_sentences.json`;
    
    
    console.log('📝 Base filename:', baseFilename);
    console.log('📋 Sentences filename:', sentencesFilename);
    
    
    // Use your existing file serving endpoint
    const sentencesResponse = await fetch(`/api/documents/${backendFilename}/sentences`);
    
    if (!sentencesResponse.ok) {
      throw new Error(`Sentences file not found: ${sentencesResponse.status}`);
    }
    console.log('sentencesResponse:', sentencesResponse);
    const sentences = await sentencesResponse.json();
    console.log('📄 Loaded sentences data:', sentences);
    
    if (!Array.isArray(sentences['sentences'])) {
      throw new Error('Invalid sentences data format - expected array');
    }

    setSentences(sentences['sentences']);
    console.log('✅ Loaded', sentences['sentences'].length, 'sentences from', sentencesFilename);

    // Initialize the sentence mapper
    const mapper = new SentencePDFMapper();
    const result = await mapper.initialize(pdf, sentences['sentences']);

    if (result.success) {
      setSentenceMapper(mapper);
      setMappingStats(mapper.getStatistics());
      console.log('✅ Sentence mapping completed:', result);
    } else {
      console.warn('⚠️ Sentence mapping failed:', result);
    }

  } catch (error) {
    console.warn('Could not load sentence mapping:', error);
    console.log('📄 PDF will work without sentence highlighting');
  }
};

  // Add effect to handle navigation triggers
  useEffect(() => {
    if (navigationTrigger && sentenceMapper && navigationTrigger.sentenceId) {
      console.log('🎯 PDF Viewer: Handling navigation trigger:', navigationTrigger);

      const targetPage = sentenceMapper.getPageForSentence(navigationTrigger.sentenceId);

      if (targetPage && targetPage !== currentPage) {
        console.log(`📖 PDF Viewer: Auto-navigating to page ${targetPage} for sentence ${navigationTrigger.sentenceId}`);
        setCurrentPage(targetPage);
      }
    }
  }, [navigationTrigger, sentenceMapper, currentPage]);

  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  // Enhanced render page with provenance overlay support
  useEffect(() => {
    if (pdfDoc && !loading) {
      const checkAndRender = () => {
        if (canvasRef.current) {
          console.log('🎯 Canvas ready, rendering page with provenance', currentPage);
          renderPageWithProvenance(currentPage);
        } else {
          setTimeout(checkAndRender, 100);
        }
      };
      checkAndRender();
    }
  }, [pdfDoc, loading, currentPage, zoomLevel, selectedProvenance, showHighlights]);

  const renderPageWithProvenance = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      console.log(`🔄 Rendering page ${pageNum} with provenance overlay...`);

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: zoomLevel });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      // Render the PDF page
      await page.render(renderContext).promise;
      
      // Render text layer (important for text matching)
      await renderTextLayer(page, viewport);

      // Add provenance overlays after a short delay to ensure text layer is ready
      if (selectedProvenance && showHighlights) {
        setTimeout(() => addProvenanceOverlays(), 150);
      }

      console.log(`✅ Page ${pageNum} rendered with provenance support`);

    } catch (err) {
      console.error(`❌ Error rendering page ${pageNum}:`, err);
    }
  };

  const renderTextLayer = async (page, viewport) => {
    if (!textLayerRef.current) return;

    try {
      const textContent = await page.getTextContent();
      const textLayer = textLayerRef.current;

      textLayer.innerHTML = '';
      textLayer.style.left = '0px';
      textLayer.style.top = '0px';
      textLayer.style.width = viewport.width + 'px';
      textLayer.style.height = viewport.height + 'px';
      textLayer.style.setProperty('--scale-factor', viewport.scale);

      if (window.pdfjsLib.renderTextLayer) {
        await window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport: viewport,
          textDivs: []
        });
      }

    } catch (err) {
      console.error('❌ Error rendering text layer:', err);
    }
  };

  // Main function to add provenance overlays
  const addProvenanceOverlays = () => {
    if (!selectedProvenance?.sentences_ids || !textLayerRef.current || !highlightLayerRef.current) return;

    // Clear existing overlays
    clearHighlights();

    const sentencesToHighlight = selectedProvenance.sentences_ids.filter(sentenceId => {
      const sentencePage = sentenceMapper?.getPageForSentence(sentenceId);
      return sentencePage === currentPage;
    });

    if (sentencesToHighlight.length === 0) return;

    console.log(`💡 Adding overlays for ${sentencesToHighlight.length} sentences on page ${currentPage}`);

    sentencesToHighlight.forEach((sentenceId, index) => {
      const sentence = sentences[sentenceId];
      if (sentence) {
        createProvenanceOverlay(sentence, sentenceId, index);
      }
    });
  };

  // Create overlay for a specific sentence
  const createProvenanceOverlay = (sentence, sentenceId, index) => {
    const textSpans = textLayerRef.current.querySelectorAll('span, div');
    
    // Clean and prepare sentence for matching
    const cleanSentence = sentence.toLowerCase().trim();
    const sentenceWords = cleanSentence.split(/\s+/).filter(word => word.length > 2);
    
    // Find matching text spans using fuzzy matching
    const matchingSpans = findMatchingTextSpans(textSpans, sentenceWords, cleanSentence);
    
    if (matchingSpans.length > 0) {
      // Create bounding box overlay
      const boundingBox = calculateBoundingBox(matchingSpans);
      createOverlayDiv(boundingBox, sentenceId, index);
      
      console.log(`✅ Created overlay for sentence ${sentenceId} with ${matchingSpans.length} spans`);
    } else {
      console.warn(`⚠️ No matching spans found for sentence ${sentenceId}`);
    }
  };

  // Find text spans that match the sentence
  const findMatchingTextSpans = (textSpans, sentenceWords, fullSentence) => {
    const matchingSpans = [];
    const spansArray = Array.from(textSpans);
    
    // Strategy 1: Direct substring match (most reliable)
    for (let span of spansArray) {
      const spanText = span.textContent.toLowerCase().trim();
      if (spanText.length > 10 && fullSentence.includes(spanText)) {
        matchingSpans.push(span);
      }
    }
    
    // Strategy 2: Word-based matching if direct match fails
    if (matchingSpans.length === 0) {
      for (let span of spansArray) {
        const spanText = span.textContent.toLowerCase().trim();
        const spanWords = spanText.split(/\s+/);
        
        // Check if span contains significant words from sentence
        const matchCount = spanWords.filter(word => 
          word.length > 2 && sentenceWords.includes(word)
        ).length;
        
        if (matchCount >= Math.min(3, spanWords.length * 0.6)) {
          matchingSpans.push(span);
        }
      }
    }
    
    // Strategy 3: Partial word matching (most permissive)
    if (matchingSpans.length === 0) {
      for (let span of spansArray) {
        const spanText = span.textContent.toLowerCase().trim();
        
        // Check if any significant words from sentence appear in span
        const hasMatch = sentenceWords.some(word => 
          word.length > 4 && spanText.includes(word)
        );
        
        if (hasMatch) {
          matchingSpans.push(span);
        }
      }
    }
    
    return matchingSpans;
  };

  // Calculate bounding box from multiple spans
  const calculateBoundingBox = (spans) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    spans.forEach(span => {
      const computedStyle = window.getComputedStyle(span);
      const left = parseFloat(span.style.left) || parseFloat(computedStyle.left) || 0;
      const top = parseFloat(span.style.top) || parseFloat(computedStyle.top) || 0;
      const width = parseFloat(span.style.width) || parseFloat(computedStyle.width) || 0;
      const height = parseFloat(span.style.height) || parseFloat(computedStyle.height) || 14; // default height
      
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    });
    
    // Add some padding to make the highlight more visible
    const padding = 4;
    return {
      left: minX - padding,
      top: minY - padding,
      width: (maxX - minX) + (padding * 2),
      height: (maxY - minY) + (padding * 2)
    };
  };

  // Create the actual overlay div
  const createOverlayDiv = (boundingBox, sentenceId, index) => {
    const overlay = document.createElement('div');
    overlay.className = 'provenance-overlay';
    overlay.setAttribute('data-sentence-id', sentenceId);
    overlay.setAttribute('data-provenance-index', index);
    
    // Position and style the overlay
    overlay.style.position = 'absolute';
    overlay.style.left = `${boundingBox.left}px`;
    overlay.style.top = `${boundingBox.top}px`;
    overlay.style.width = `${boundingBox.width}px`;
    overlay.style.height = `${boundingBox.height}px`;
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'pointer';
    overlay.style.zIndex = '10';
    
    // Style based on provenance index (rotating colors)
    const colors = [
      'rgba(255, 235, 59, 0.3)',  // Yellow
      'rgba(76, 175, 80, 0.3)',   // Green  
      'rgba(33, 150, 243, 0.3)',  // Blue
      'rgba(255, 152, 0, 0.3)',   // Orange
      'rgba(156, 39, 176, 0.3)'   // Purple
    ];
    
    const borderColors = [
      'rgba(255, 235, 59, 0.8)',
      'rgba(76, 175, 80, 0.8)',
      'rgba(33, 150, 243, 0.8)',
      'rgba(255, 152, 0, 0.8)',
      'rgba(156, 39, 176, 0.8)'
    ];
    
    const colorIndex = index % colors.length;
    overlay.style.backgroundColor = colors[colorIndex];
    overlay.style.border = `2px solid ${borderColors[colorIndex]}`;
    overlay.style.borderRadius = '4px';
    overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    
    // Add subtle animation
    overlay.style.transition = 'all 0.3s ease';
    overlay.style.opacity = '0';
    
    // Add tooltip
    overlay.title = `Provenance Evidence ${index + 1}\nSentence ID: ${sentenceId}\nClick to focus`;
    
    // Add click handler to focus this sentence
    overlay.addEventListener('click', () => {
      console.log(`📍 User clicked provenance overlay for sentence ${sentenceId}`);
      onProvenanceClick(sentenceId, index);
    });

    // Add hover effects
    overlay.addEventListener('mouseenter', () => {
      overlay.style.transform = 'scale(1.02)';
      overlay.style.zIndex = '15';
      overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.style.transform = 'scale(1)';
      overlay.style.zIndex = '10';
      overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    });
    
    // Add to highlight layer
    highlightLayerRef.current.appendChild(overlay);
    
    // Animate in
    setTimeout(() => {
      overlay.style.opacity = '1';
    }, 50);
    
    // Add pulse animation for emphasis
    setTimeout(() => {
      overlay.style.transform = 'scale(1.05)';
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
      }, 200);
    }, 100 + (index * 100)); // Stagger animation for multiple overlays
  };

  // Enhanced clear function
  const clearHighlights = () => {
    if (highlightLayerRef.current) {
      // Fade out existing overlays before removing
      const existingOverlays = highlightLayerRef.current.querySelectorAll('.provenance-overlay');
      existingOverlays.forEach(overlay => {
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.95)';
      });
      
      setTimeout(() => {
        highlightLayerRef.current.innerHTML = '';
      }, 150);
    }
  };

  // Callback when user clicks on a provenance overlay
  const onProvenanceClick = (sentenceId, index) => {
    // Scroll to sentence in provenance panel
    const sentenceElement = document.querySelector(`[data-sentence-id="${sentenceId}"]`);
    if (sentenceElement) {
      sentenceElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // Add temporary highlight to sentence in panel
      sentenceElement.classList.add('sentence-highlight-flash');
      setTimeout(() => {
        sentenceElement.classList.remove('sentence-highlight-flash');
      }, 2000);
    }
    
    console.log(`🔗 Provenance overlay clicked: sentence ${sentenceId}`);
  };

  // Control handlers
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);
  const toggleHighlights = () => setShowHighlights(!showHighlights);
  const toggleDetailPanel = () => setShowDetailPanel(!showDetailPanel);

  // Render states (keeping existing render states...)
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
          <h3>Loading PDF...</h3>
          <p>{pdfDocument.filename}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-viewer-error">
        <div className="error-content">
          <h3>PDF Loading Error</h3>
          <p>{error}</p>
          <button onClick={loadPDFAndSentences} className="retry-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`dual-view-pdf-viewer ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <FontAwesomeIcon icon={faFileAlt} />
          <span>{pdfDocument.filename}</span>
          {selectedProvenance && (
            <span className="provenance-badge">
              Evidence {selectedProvenance.provenance_id || 1}
              ({selectedProvenance.sentences_ids?.length || 0} sentences)
            </span>
          )}
        </div>

        <div className="pdf-controls">
          <button onClick={toggleDetailPanel} className="control-btn" title="Toggle Detail Panel">
            <FontAwesomeIcon icon={faMapMarkedAlt} />
          </button>

          <button onClick={toggleHighlights} className="control-btn" title="Toggle Highlights">
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
            <span style={{marginLeft: '4px', fontSize: '12px'}}>
              {showHighlights ? 'Hide' : 'Show'}
            </span>
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

      {/* Page Navigation */}
      <div className="page-navigation">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="nav-btn"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
          Previous
        </button>

        <span className="page-info">
          Page {currentPage} of {totalPages}
        </span>

        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="nav-btn"
        >
          Next
          <FontAwesomeIcon icon={faChevronRight} />
        </button>

        {sentences.length > 0 && (
          <div className="sentence-status">
            <small>
              📍 {sentences.length} sentences
              {mappingStats && (
                <span className="mapping-quality">
                  | {Math.round(mappingStats.averageConfidence * 100)}% avg confidence
                </span>
              )}
            </small>
          </div>
        )}
      </div>

      {/* Main Content - PDF + Detail Panel */}
      <div className="dual-view-content">
        {/* Main PDF View */}
        <div className={`pdf-main-view ${showDetailPanel ? 'with-detail-panel' : 'full-width'}`}>
          <div className="pdf-content" ref={containerRef}>
            <div className="pdf-page-container">
              <canvas ref={canvasRef} className="pdf-canvas" />
              <div ref={textLayerRef} className="pdf-text-layer" />
              <div ref={highlightLayerRef} className="pdf-highlight-layer" />
            </div>
          </div>
        </div>

        {/* Sentence Detail Panel
        {showDetailPanel && (
          <div className="detail-panel">
            <ProvenancePanel
              sentences={sentences}
              selectedProvenance={selectedProvenance}
              currentPage={currentPage}
              sentenceMapper={sentenceMapper}
              showHighlights={showHighlights}
            />
          </div>
        )} */}
      </div>

      {/* Provenance Info */}
      {selectedProvenance && showHighlights && (
        <div className="provenance-info">
          <h4>
            <FontAwesomeIcon icon={faHighlighter} />
            Current Evidence - Page {currentPage}
          </h4>
          <div className="provenance-summary">
            <div className="summary-item">
              <strong>Provenance ID:</strong> {selectedProvenance.provenance_id}
            </div>
            <div className="summary-item">
              <strong>Total Sentences:</strong> {selectedProvenance.sentences_ids?.length || 0}
            </div>
            <div className="summary-item">
              <strong>On This Page:</strong> {
                selectedProvenance.sentences_ids?.filter(id =>
                  sentenceMapper ? sentenceMapper.getPageForSentence(id) === currentPage : false
                ).length || 0
              }
            </div>
            <div className="summary-item">
              <strong>Processing Time:</strong> {selectedProvenance.time?.toFixed(2) || 'N/A'}s
            </div>
          </div>
        </div>
      )}

      {/* Add the CSS for overlays inline */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .pdf-highlight-layer {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 10;
          }

          .provenance-overlay {
            position: absolute;
            border-radius: 4px;
            transition: all 0.3s ease;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            pointer-events: auto;
          }

          .provenance-overlay:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
            z-index: 15;
          }

          @keyframes sentence-highlight-flash {
            0% {
              background-color: transparent;
              box-shadow: none;
            }
            25% {
              background-color: rgba(255, 235, 59, 0.6);
              box-shadow: 0 0 0 4px rgba(255, 235, 59, 0.3);
            }
            75% {
              background-color: rgba(255, 235, 59, 0.4);
              box-shadow: 0 0 0 2px rgba(255, 235, 59, 0.2);
            }
            100% {
              background-color: transparent;
              box-shadow: none;
            }
          }

          .sentence-highlight-flash {
            animation: sentence-highlight-flash 2s ease-in-out;
          }

          /* Other existing PDF viewer styles remain the same... */
          .dual-view-pdf-viewer {
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #f5f5f5;
          }
          
          .dual-view-pdf-viewer.fullscreen {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1000;
            background: white;
          }
          
          .pdf-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            background: white;
            border-bottom: 1px solid #ddd;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .pdf-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: bold;
          }
          
          .provenance-badge {
            background: #4CAF50;
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: normal;
          }
          
          .pdf-controls {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .control-btn {
            padding: 8px 12px;
            border: 1px solid #ddd;
            background: white;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.2s;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          .control-btn:hover {
            background: #f0f0f0;
          }
          
          .zoom-display {
            padding: 0 10px;
            font-weight: bold;
          }
          
          .page-navigation {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-bottom: 1px solid #ddd;
          }
          
          .nav-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 8px 16px;
            border: 1px solid #ddd;
            background: white;
            cursor: pointer;
            border-radius: 4px;
          }
          
          .page-info {
            font-weight: bold;
            min-width: 120px;
            text-align: center;
          }
          
          .sentence-status {
            color: #666;
            font-family: monospace;
          }
          
          .mapping-quality {
            color: #666;
            font-weight: normal;
          }
          
          .dual-view-content {
            flex: 1;
            display: flex;
            overflow: hidden;
          }
          
          .pdf-main-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: all 0.3s ease;
          }
          
          .pdf-main-view.with-detail-panel {
            flex: 0 0 70%;
          }
          
          .pdf-main-view.full-width {
            flex: 1;
          }
          
          .pdf-content {
            flex: 1;
            overflow: auto;
            padding: 20px;
            display: flex;
            justify-content: center;
            background: white;
          }
          
          .pdf-page-container {
            position: relative;
            display: inline-block;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          }
          
          .pdf-canvas {
            display: block;
            border: 1px solid #ccc;
          }
          
          .pdf-text-layer {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            overflow: hidden;
            opacity: 0.1;
            line-height: 1.0;
          }
          
          .pdf-text-layer span,
          .pdf-text-layer div {
            color: transparent;
            position: absolute;
            white-space: pre;
            cursor: text;
            transform-origin: 0% 0%;
          }
          
          .detail-panel {
            flex: 0 0 30%;
            background: #f8f9fa;
            border-left: 1px solid #ddd;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .provenance-info {
            padding: 15px;
            background: #e3f2fd;
            border-top: 1px solid #2196f3;
          }
          
          .provenance-info h4 {
            margin: 0 0 10px 0;
            color: #1976d2;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .provenance-summary {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          
          .summary-item {
            font-size: 12px;
          }
          
          .summary-item strong {
            color: #1976d2;
          }
          
          .pdf-viewer-empty,
          .pdf-viewer-loading,
          .pdf-viewer-error {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .empty-content,
          .loading-content,
          .error-content {
            text-align: center;
            color: #666;
          }
          
          .retry-btn {
            margin: 10px;
            padding: 8px 16px;
            background: #2196f3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
        `
      }} />
    </div>
  );
};

export default HybridPDFViewer;