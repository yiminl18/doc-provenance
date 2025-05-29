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
  faMapMarkedAlt,
  faDownload,
  faExclamationTriangle
} from '@fortawesome/free-solid-svg-icons';
import { SentencePDFMapper } from '../utils/SentencePDFMapper';
import ProvenancePanel from './ProvenancePanel';
import { getDocumentSentences } from '../services/api';

const HybridPDFViewer = ({ 
  pdfDocument, 
  selectedProvenance, 
  onClose, 
  isGridMode = false,
  currentSession 
}) => {
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

  // Generate PDF URL when document changes - with session-based and fallback support
  useEffect(() => {
    if (!pdfDocument) {
      setPdfUrl(null);
      return;
    }

    let url = '';
    
    // Strategy 1: Use file blob if available (for newly uploaded files)
    if (pdfDocument.file) {
      url = URL.createObjectURL(pdfDocument.file);
      console.log('📁 Using file blob URL');
    } 
    // Strategy 2: Use session-based document endpoint
    else if (pdfDocument.backendDocumentId) {
      url = `/api/documents/${pdfDocument.backendDocumentId}/pdf`;
      console.log('🔗 Using session-based PDF URL:', url);
    }
    // Strategy 3: Fallback to uploads endpoint (legacy compatibility)
    else if (pdfDocument.filename) {
      url = `/uploads/${pdfDocument.filename}`;
      console.log('📄 Using legacy uploads URL:', url);
    }
    else {
      console.error('❌ No valid PDF source found');
      setError('Unable to locate PDF file');
      return;
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

  // Update this part of your HybridPDFViewer.js loadPDFAndSentences function

const loadPDFAndSentences = async () => {
  setLoading(true);
  setError(null);

  try {
    console.log('🔄 Loading PDF and sentence data...');

    // Test PDF accessibility with the new working endpoint
    let pdfAccessible = false;
    let finalUrl = pdfUrl;

    try {
      console.log('🔍 Testing PDF URL:', pdfUrl);
      const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
      console.log('📡 PDF HEAD response:', testResponse.status);
      
      if (testResponse.ok) {
        pdfAccessible = true;
        console.log('✅ PDF is accessible at primary URL');
      }
    } catch (testError) {
      console.warn('❌ Primary PDF URL failed:', testError);
      
      // Try alternative URLs only if primary fails
      if (pdfDocument.backendDocumentId) {
        const fallbackUrls = [
          `/uploads/${pdfDocument.filename}`,
          `/api/uploads/${pdfDocument.filename}`
        ];
        
        for (const altUrl of fallbackUrls) {
          try {
            console.log('🔍 Trying fallback URL:', altUrl);
            const altResponse = await fetch(altUrl, { method: 'HEAD' });
            if (altResponse.ok) {
              finalUrl = altUrl;
              pdfAccessible = true;
              console.log('✅ Fallback URL works:', altUrl);
              break;
            }
          } catch (altError) {
            console.warn('❌ Fallback URL failed:', altUrl, altError);
          }
        }
      }
    }

    if (!pdfAccessible) {
      throw new Error(`PDF not accessible: ${finalUrl}`);
    }

    console.log('🔄 Loading PDF with PDF.js...');
    const loadingTask = window.pdfjsLib.getDocument({
      url: finalUrl,
      verbosity: 0
    });

    const pdf = await loadingTask.promise;
    console.log('✅ PDF loaded successfully:', pdf.numPages, 'pages');

    setPdfDoc(pdf);
    setTotalPages(pdf.numPages);
    setCurrentPage(1);

    // Load sentence mapping in parallel
    loadSentenceMapping(pdf).catch(err => {
      console.warn('⚠️ Sentence mapping failed, continuing with basic PDF:', err);
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
      const docId = pdfDocument.backendDocumentId || pdfDocument.id;
      
      if (!docId) {
        console.warn('No document ID available for sentence mapping');
        return;
      }

      // Use unified sentence loading
      let sentencesData;
      try {
        const response = await getDocumentSentences(docId);
        if (response.success && response.sentences) {
          sentencesData = response;
        } else {
          throw new Error('No sentence data in response');
        }
      } catch (sessionError) {
        console.warn('Session-based sentence loading failed, trying legacy...');
        
        // Fallback to legacy endpoint if available
        try {
          const legacyUrl = `/api/sentences/${docId}?ids=${Array.from({length: 100}, (_, i) => i).join(',')}`;
          const legacyResponse = await fetch(legacyUrl);
          if (legacyResponse.ok) {
            const legacyData = await legacyResponse.json();
            if (legacyData.success && legacyData.sentences) {
              sentencesData = { 
                sentences: Object.values(legacyData.sentences),
                total_sentences: Object.keys(legacyData.sentences).length 
              };
            }
          }
        } catch (legacyError) {
          throw new Error('Both session and legacy sentence loading failed');
        }
      }

      if (!sentencesData || !sentencesData.sentences) {
        throw new Error('No sentence data available');
      }

      setSentences(sentencesData.sentences);
      
      // Initialize sentence mapper if we have a PDF
      if (window.SentencePDFMapper) {
        const mapper = new window.SentencePDFMapper();
        const result = await mapper.initialize(pdf, sentencesData.sentences);
        
        if (result.success) {
          setSentenceMapper(mapper);
          setMappingStats(mapper.getStatistics());
          console.log('✅ Advanced sentence mapping completed:', result);
        }
      } else {
        console.warn('SentencePDFMapper not available, using basic mapping');
      }
      
    } catch (error) {
      console.warn('Could not load sentence mapping:', error);
    }
  };

  // Auto-navigate to provenance page
  useEffect(() => {
    if (selectedProvenance && sentenceMapper && showHighlights) {
      navigateToProvenance();
    }
  }, [selectedProvenance, sentenceMapper, showHighlights]);

  const navigateToProvenance = () => {
    if (!selectedProvenance?.sentences_ids || !sentenceMapper) return;

    // Find the first page that contains any of the highlighted sentences
    let targetPage = currentPage;
    for (const sentenceId of selectedProvenance.sentences_ids) {
      const sentencePage = sentenceMapper.getPageForSentence(sentenceId);
      if (sentencePage) {
        targetPage = sentencePage;
        break;
      }
    }

    if (targetPage !== currentPage) {
      console.log(`📖 Auto-navigating to page ${targetPage} for provenance ${selectedProvenance.provenance_id}`);
      setCurrentPage(targetPage);
    }
  };

  // Render page when ready
  useEffect(() => {
    if (pdfDoc && !loading) {
      const checkAndRender = () => {
        if (canvasRef.current) {
          console.log('🎯 Canvas ready, rendering page', currentPage);
          renderPage(currentPage);
        } else {
          setTimeout(checkAndRender, 100);
        }
      };
      checkAndRender();
    }
  }, [pdfDoc, loading, currentPage, zoomLevel]);

  const renderPage = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      console.log(`🔄 Rendering page ${pageNum}...`);
      
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

      await page.render(renderContext).promise;
      await renderTextLayer(page, viewport);

      // Light highlighting on main PDF (just to show general area)
      if (selectedProvenance && showHighlights) {
        setTimeout(() => addLightHighlighting(), 100);
      }

      console.log(`✅ Page ${pageNum} rendered successfully`);

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

  // Light highlighting on main PDF - just to show general area
  const addLightHighlighting = () => {
    if (!selectedProvenance?.sentences_ids || !sentenceMapper || !textLayerRef.current) return;

    clearHighlights();

    const sentencesToHighlight = selectedProvenance.sentences_ids.filter(sentenceId => {
      const sentencePage = sentenceMapper.getPageForSentence(sentenceId);
      return sentencePage === currentPage;
    });

    if (sentencesToHighlight.length === 0) return;

    console.log(`💡 Adding light highlights for ${sentencesToHighlight.length} sentences on page ${currentPage}`);

    // Very subtle highlighting - just to indicate general area
    sentencesToHighlight.forEach((sentenceId, index) => {
      const sentence = sentences[sentenceId];
      if (sentence) {
        addSubtleHighlight(sentence, index);
      }
    });
  };

  const addSubtleHighlight = (sentence, index) => {
    const textSpans = textLayerRef.current.querySelectorAll('span, div');
    const searchWords = sentence.toLowerCase().split(/\s+/).filter(word => word.length > 3);
    
    textSpans.forEach(span => {
      const spanText = span.textContent.toLowerCase();
      const matchCount = searchWords.filter(word => spanText.includes(word)).length;
      
      if (matchCount >= Math.max(1, searchWords.length * 0.3)) {
        const highlight = document.createElement('div');
        highlight.className = 'pdf-light-highlight';
        
        const computedStyle = window.getComputedStyle(span);
        highlight.style.position = 'absolute';
        highlight.style.left = span.style.left || computedStyle.left;
        highlight.style.top = span.style.top || computedStyle.top;
        highlight.style.width = span.style.width || computedStyle.width;
        highlight.style.height = span.style.height || computedStyle.height;
        highlight.style.pointerEvents = 'none';
        highlight.style.zIndex = '5';

        if (highlightLayerRef.current) {
          highlightLayerRef.current.appendChild(highlight);
        }
      }
    });
  };

  const clearHighlights = () => {
    if (highlightLayerRef.current) {
      highlightLayerRef.current.innerHTML = '';
    }
  };

  // Control handlers
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);
  const toggleHighlights = () => setShowHighlights(!showHighlights);
  const toggleDetailPanel = () => setShowDetailPanel(!showDetailPanel);
  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  const handleDownloadPDF = () => {
    if (pdfUrl && pdfDocument.filename) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = pdfDocument.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

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
          <h3>Loading PDF...</h3>
          <p>{pdfDocument.filename}</p>
          {currentSession && (
            <small>Session: {currentSession.session_id?.split('_')[1] || 'Active'}</small>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-viewer-error">
        <div className="error-content">
          <FontAwesomeIcon icon={faExclamationTriangle} size="2x" />
          <h3>PDF Loading Error</h3>
          <p>{error}</p>
          <div className="error-actions">
            <button onClick={loadPDFAndSentences} className="retry-btn">
              <FontAwesomeIcon icon={faSpinner} />
              Retry
            </button>
            {pdfDocument.backendDocumentId && (
              <button onClick={handleDownloadPDF} className="download-btn">
                <FontAwesomeIcon icon={faDownload} />
                Download PDF
              </button>
            )}
          </div>
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
          {pdfDocument.isPreloaded && (
            <span className="preloaded-badge">📚 Research Paper</span>
          )}
        </div>

        <div className="pdf-controls">
          <button onClick={toggleDetailPanel} className="control-btn" title="Toggle Detail Panel">
            <FontAwesomeIcon icon={faMapMarkedAlt} />
          </button>
          
          <button onClick={toggleHighlights} className="control-btn" title="Toggle Highlights">
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
          </button>
          
          <button onClick={handleZoomOut} className="control-btn" title="Zoom Out">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>
          
          <span className="zoom-display">{Math.round(zoomLevel * 100)}%</span>
          
          <button onClick={handleZoomIn} className="control-btn" title="Zoom In">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>

          <button onClick={handleDownloadPDF} className="control-btn" title="Download PDF">
            <FontAwesomeIcon icon={faDownload} />
          </button>
          
          <button onClick={toggleFullscreen} className="control-btn" title="Toggle Fullscreen">
            <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
          </button>
          
          {onClose && (
            <button onClick={onClose} className="control-btn close-btn" title="Close Viewer">
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

        {/* Document info */}
        <div className="document-info">
          {sentences.length > 0 && (
            <span className="sentence-status">
              📍 {sentences.length} sentences
            </span>
          )}
          {mappingStats && (
            <span className="mapping-quality">
              | {Math.round(mappingStats.averageConfidence * 100)}% mapping confidence
            </span>
          )}
          {pdfDocument.sessionProcessed && (
            <span className="session-processed">
              | ✅ Session processed
            </span>
          )}
        </div>
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

        {/* Sentence Detail Panel */}
        {showDetailPanel && (
          <div className="detail-panel">
            <ProvenancePanel
              sentences={sentences}
              selectedProvenance={selectedProvenance}
              currentPage={currentPage}
              sentenceMapper={sentenceMapper}
              showHighlights={showHighlights}
              pdfDocument={pdfDocument}
              currentSession={currentSession}
            />
          </div>
        )}
      </div>

      {/* Keep existing styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
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

          .preloaded-badge {
            background: #2196F3;
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
          }
          
          .control-btn:hover {
            background: #f0f0f0;
          }

          .control-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
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
            flex-wrap: wrap;
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

          .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .page-info {
            font-weight: bold;
            min-width: 120px;
            text-align: center;
          }
          
          .document-info {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #666;
            font-family: monospace;
            font-size: 12px;
          }
          
          .sentence-status, .mapping-quality, .session-processed {
            white-space: nowrap;
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
            opacity: 0.2;
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
          
          .pdf-highlight-layer {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 10;
          }
          
          .pdf-light-highlight {
            background-color: rgba(255, 235, 59, 0.2);
            border: 1px solid rgba(255, 235, 59, 0.4);
            border-radius: 2px;
          }
          
          .detail-panel {
            flex: 0 0 30%;
            background: #f8f9fa;
            border-left: 1px solid #ddd;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .pdf-viewer-empty,
          .pdf-viewer-loading,
          .pdf-viewer-error {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f5f5f5;
          }
          
          .empty-content,
          .loading-content,
          .error-content {
            text-align: center;
            color: #666;
            padding: 40px;
          }

          .error-actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            justify-content: center;
          }
          
          .retry-btn, .download-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: #2196f3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
          }

          .retry-btn:hover, .download-btn:hover {
            background: #1976d2;
          }

          .download-btn {
            background: #4CAF50;
          }

          .download-btn:hover {
            background: #388E3C;
          }
        `
      }} />
    </div>
  );
};

export default HybridPDFViewer;