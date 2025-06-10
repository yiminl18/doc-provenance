// PDFDebugHighlighter.js - Debug component to visualize all sentence bounding boxes
import React, { useState, useEffect, useRef } from 'react';

/**
 * Debug component that shows ALL sentence bounding boxes from layout data
 * This helps visualize coordinate mapping issues
 */
export function PDFDebugHighlighter({ 
  documentId, 
  currentPage, 
  pdfViewerRef,
  highlightLayerRef,
  currentViewport,
  debugMode = false,
  onDebugInfo = null
}) {
  const [debugHighlights, setDebugHighlights] = useState([]);
  const [layoutData, setLayoutData] = useState(null);
  const [debugStats, setDebugStats] = useState(null);
  const debugElementsRef = useRef(new Map());

  // Load layout data when component mounts or document changes
  useEffect(() => {
    if (!documentId || !debugMode) {
      clearDebugHighlights();
      return;
    }

    loadLayoutData();
  }, [documentId, debugMode]);

  // Create debug highlights when page or viewport changes
  useEffect(() => {
    if (!debugMode || !layoutData || !currentViewport || !highlightLayerRef?.current) {
      return;
    }

    createDebugHighlights();
  }, [debugMode, layoutData, currentPage, currentViewport]);

  const loadLayoutData = async () => {
    try {
      console.log('🐛 Debug: Loading layout data for', documentId);
      
      const response = await fetch(`/api/documents/${documentId}.pdf/layout`);
      if (!response.ok) {
        throw new Error(`Failed to load layout data: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.success && result.layout_data) {
        setLayoutData(result.layout_data);
        
        // Calculate debug statistics
        const stats = calculateLayoutStats(result.layout_data);
        setDebugStats(stats);
        
        if (onDebugInfo) {
          onDebugInfo(stats);
        }
        
        console.log('🐛 Debug: Layout data loaded', stats);
      } else {
        throw new Error('Layout data not available');
      }
    } catch (error) {
      console.error('🐛 Debug: Error loading layout data:', error);
      setLayoutData(null);
      setDebugStats(null);
    }
  };

  const calculateLayoutStats = (data) => {
    const sentences = data.sentences || [];
    const stats = {
      totalSentences: sentences.length,
      sentencesWithBoxes: 0,
      totalBoxes: 0,
      pageDistribution: {},
      confidenceDistribution: { high: 0, medium: 0, low: 0 },
      coordinateSystems: new Set(),
      averageBoxesPerSentence: 0
    };

    sentences.forEach(sentence => {
      const boxes = sentence.bounding_boxes || [];
      if (boxes.length > 0) {
        stats.sentencesWithBoxes++;
        stats.totalBoxes += boxes.length;

        boxes.forEach(box => {
          // Track page distribution
          const page = box.page || sentence.primary_page || 1;
          stats.pageDistribution[page] = (stats.pageDistribution[page] || 0) + 1;

          // Track confidence distribution
          const confidence = box.confidence || 0.8;
          if (confidence > 0.8) stats.confidenceDistribution.high++;
          else if (confidence > 0.6) stats.confidenceDistribution.medium++;
          else stats.confidenceDistribution.low++;

          // Track coordinate systems
          if (box.coordinate_system) {
            stats.coordinateSystems.add(box.coordinate_system);
          }
          if (box.x0 !== undefined) stats.coordinateSystems.add('x0_y0_x1_y1');
          if (box.left !== undefined) stats.coordinateSystems.add('left_top_width_height');
        });
      }
    });

    stats.averageBoxesPerSentence = stats.sentencesWithBoxes > 0 ? 
      (stats.totalBoxes / stats.sentencesWithBoxes).toFixed(2) : 0;
    stats.coordinateSystems = Array.from(stats.coordinateSystems);

    return stats;
  };

  const createDebugHighlights = () => {
    clearDebugHighlights();

    if (!layoutData?.sentences || !highlightLayerRef?.current) {
      console.log('🐛 Debug: No sentences or highlight layer available');
      return;
    }

    const sentences = layoutData.sentences;
    let highlightsCreated = 0;
    const newHighlights = new Map();

    console.log(`🐛 Debug: Creating highlights for ${sentences.length} sentences on page ${currentPage}`);

    sentences.forEach((sentence, sentenceIndex) => {
      const sentenceId = sentence.sentence_id ?? sentenceIndex;
      const boxes = sentence.bounding_boxes || [];
      
      // Filter boxes for current page
      const pageBoxes = boxes.filter(box => {
        const boxPage = box.page || sentence.primary_page || 1;
        return boxPage === currentPage;
      });

      if (pageBoxes.length === 0) {
        return; // No boxes on this page
      }

      console.log(`🐛 Debug: Sentence ${sentenceId} has ${pageBoxes.length} boxes on page ${currentPage}`);

      pageBoxes.forEach((box, boxIndex) => {
        const debugElement = createDebugHighlightElement(
          box, 
          sentenceId, 
          boxIndex, 
          sentence.text || `Sentence ${sentenceId}`
        );

        if (debugElement) {
          const key = `debug_${sentenceId}_${boxIndex}`;
          newHighlights.set(key, debugElement);
          highlightsCreated++;
        }
      });
    });

    debugElementsRef.current = newHighlights;
    console.log(`🐛 Debug: Created ${highlightsCreated} debug highlights on page ${currentPage}`);
  };

  const createDebugHighlightElement = (box, sentenceId, boxIndex, sentenceText) => {
    if (!currentViewport || !highlightLayerRef?.current) return null;

    let left, top, width, height;
    let transformInfo = '';

    // Handle different coordinate systems with detailed logging
    if (box.coordinate_system === 'pdfminer' || (box.left !== undefined && box.top !== undefined)) {
      // PDFMiner coordinates: origin at bottom-left, Y increases upward
      console.log(`🐛 Debug: PDFMiner coordinates for sentence ${sentenceId}:`, {
        left: box.left, top: box.top, width: box.width, height: box.height
      });

      const pageHeightInPdfCoords = currentViewport.height / currentViewport.scale;
      
      left = box.left * currentViewport.scale;
      
      // Convert Y coordinate: flip the Y axis
      const regionBottomInPdfCoords = box.top;
      const regionTopInPdfCoords = box.top + box.height;
      const topInPdfJsCoords = pageHeightInPdfCoords - regionTopInPdfCoords;
      
      top = topInPdfJsCoords * currentViewport.scale;
      width = box.width * currentViewport.scale;
      height = box.height * currentViewport.scale;
      
      transformInfo = `PDFMiner→PDF.js: (${box.left},${box.top}) → (${left.toFixed(1)},${top.toFixed(1)})`;

    } else if (box.x0 !== undefined && box.y0 !== undefined) {
      // x0, y0, x1, y1 coordinates
      console.log(`🐛 Debug: x0y0x1y1 coordinates for sentence ${sentenceId}:`, {
        x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1
      });

      // For x0,y0,x1,y1 coordinates:
      // - x0,y0 = bottom-left corner
      // - x1,y1 = top-right corner
      // - PDF coordinate system: origin at bottom-left, Y increases upward
      // - PDF.js coordinate system: origin at top-left, Y increases downward
      
      const pageHeightInPdfCoords = currentViewport.height / currentViewport.scale;
      
      // Transform to PDF.js coordinates
      left = box.x0 * currentViewport.scale;
      top = (pageHeightInPdfCoords - box.y1) * currentViewport.scale;
      width = (box.x1 - box.x0) * currentViewport.scale;
      height = (box.y1 - box.y0) * currentViewport.scale;
      
      transformInfo = `x0y0x1y1: (${box.x0},${box.y0},${box.x1},${box.y1}) → (${left.toFixed(1)},${top.toFixed(1)}) size:${width.toFixed(1)}x${height.toFixed(1)}`;

    } else {
      console.warn(`🐛 Debug: Unknown coordinate system for sentence ${sentenceId}:`, box);
      return null;
    }

    // Validate dimensions
    if (width <= 0 || height <= 0) {
      console.warn(`🐛 Debug: Invalid dimensions for sentence ${sentenceId}: ${width}x${height}`);
      return null;
    }

    // Create debug overlay with distinctive styling
    const overlay = document.createElement('div');
    overlay.className = 'pdf-debug-highlight';
    overlay.setAttribute('data-sentence-id', sentenceId);
    overlay.setAttribute('data-box-index', boxIndex);
    overlay.setAttribute('data-confidence', (box.confidence || 0.8).toFixed(2));
    overlay.setAttribute('data-transform-info', transformInfo);

    // Color-code based on confidence and coordinate system
    let backgroundColor, borderColor;
    const confidence = box.confidence || 0.8;
    
    if (box.coordinate_system === 'pdfminer' || box.left !== undefined) {
      // Blue for PDFMiner coordinates
      backgroundColor = `rgba(0, 123, 255, ${0.2 + confidence * 0.2})`;
      borderColor = `rgba(0, 123, 255, ${0.6 + confidence * 0.4})`;
    } else {
      // Purple for x0y0x1y1 coordinates
      backgroundColor = `rgba(138, 43, 226, ${0.2 + confidence * 0.2})`;
      borderColor = `rgba(138, 43, 226, ${0.6 + confidence * 0.4})`;
    }

    overlay.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${width}px;
      height: ${height}px;
      background-color: ${backgroundColor};
      border: 1px dashed ${borderColor};
      border-radius: 2px;
      z-index: 8888;
      pointer-events: auto;
      cursor: crosshair;
      opacity: 0.8;
      display: block;
      visibility: visible;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    `;

    // Add sentence ID label for small boxes
    if (width > 30 && height > 15) {
      overlay.innerHTML = `<span style="
        position: absolute;
        top: 2px;
        left: 2px;
        font-size: 10px;
        font-weight: bold;
        color: ${borderColor};
        text-shadow: 1px 1px 1px rgba(255,255,255,0.8);
        pointer-events: none;
      ">${sentenceId}</span>`;
    }

    overlay.title = `DEBUG: Sentence ${sentenceId} (Box ${boxIndex + 1})
Confidence: ${(confidence * 100).toFixed(0)}%
Dimensions: ${width.toFixed(1)}×${height.toFixed(1)}px
${transformInfo}
Text: "${sentenceText.substring(0, 100)}..."`;

    // Add click handler for detailed debug info
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log(`🐛 Debug: Clicked sentence ${sentenceId}, box ${boxIndex}:`, {
        originalBox: box,
        transformedCoords: { left, top, width, height },
        transformInfo,
        sentenceText: sentenceText.substring(0, 200)
      });

      // Visual feedback
      overlay.style.borderWidth = '3px';
      overlay.style.borderStyle = 'solid';
      setTimeout(() => {
        overlay.style.borderWidth = '1px';
        overlay.style.borderStyle = 'dashed';
      }, 500);
    });

    // Add hover effects
    overlay.addEventListener('mouseenter', () => {
      overlay.style.opacity = '1';
      overlay.style.zIndex = '8999';
      overlay.style.borderWidth = '2px';
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.style.opacity = '0.8';
      overlay.style.zIndex = '8888';
      overlay.style.borderWidth = '1px';
    });

    highlightLayerRef.current.appendChild(overlay);
    return overlay;
  };

  const clearDebugHighlights = () => {
    if (!highlightLayerRef?.current) return;

    // Remove all debug highlights
    const debugOverlays = highlightLayerRef.current.querySelectorAll('.pdf-debug-highlight');
    console.log(`🐛 Debug: Clearing ${debugOverlays.length} debug highlights`);

    debugOverlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    debugElementsRef.current.clear();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearDebugHighlights();
    };
  }, []);

  // This component doesn't render anything directly
  return null;
}

/**
 * Debug control panel component
 */
export function PDFDebugControls({ 
  debugMode, 
  onToggleDebug, 
  debugStats,
  currentPage 
}) {
  if (!debugMode && !debugStats) return null;

  return (
    <div className="pdf-debug-controls" style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '12px',
      fontFamily: 'monospace',
      zIndex: 10000,
      minWidth: '250px'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        🐛 DEBUG MODE
        <button 
          onClick={onToggleDebug}
          style={{
            marginLeft: '10px',
            padding: '2px 6px',
            fontSize: '10px',
            background: debugMode ? '#dc3545' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          {debugMode ? 'OFF' : 'ON'}
        </button>
      </div>
      
      {debugStats && (
        <div>
          <div>📄 Page: {currentPage}</div>
          <div>📝 Total Sentences: {debugStats.totalSentences}</div>
          <div>📦 Sentences w/ Boxes: {debugStats.sentencesWithBoxes}</div>
          <div>🎯 Total Boxes: {debugStats.totalBoxes}</div>
          <div>📊 Avg Boxes/Sentence: {debugStats.averageBoxesPerSentence}</div>
          <div>🗺️ Coordinate Systems: {debugStats.coordinateSystems.join(', ')}</div>
          
          {debugStats.pageDistribution[currentPage] && (
            <div>📍 Boxes on Page {currentPage}: {debugStats.pageDistribution[currentPage]}</div>
          )}
          
          <div style={{ marginTop: '5px', fontSize: '10px', color: '#ccc' }}>
            Blue = PDFMiner coords | Purple = x0y0x1y1 coords<br/>
            Click boxes for detailed info
          </div>
        </div>
      )}
    </div>
  );
}

export default PDFDebugHighlighter;