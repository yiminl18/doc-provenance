// PDFHighlighter.js - Optimized for pre-computed mappings
import React, { useState, useEffect, useRef } from 'react';
import { getProvenanceHighlightingBoxesEnhanced, getHighlightingFromMappings } from '../services/api';

/**
 * Hook for loading and using pre-computed PDF mappings
 */
export function usePDFMappings(documentId) {
  const [mappings, setMappings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!documentId) return;

    const loadMappings = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load pre-computed mappings from your backend or static files
        const response = await fetch(`/api/documents/${documentId}/mappings`);
        
        if (!response.ok) {
          throw new Error(`Failed to load mappings: ${response.statusText}`);
        }

        const mappingsData = await response.json();
        setMappings(mappingsData);
        
      } catch (err) {
        console.error('Failed to load PDF mappings:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadMappings();
  }, [documentId]);

  return { mappings, loading, error };
}

/**
 * Enhanced PDFHighlighter component that integrates with LayoutBasedPDFViewer
 */
export function PDFHighlighter({ 
  documentId, 
  currentPage, 
  sentenceIds = [], 
  pdfViewerRef,
  provenanceData,
  onHighlightClick = null,
  highlightLayerRef, // Accept this from parent
  currentViewport, // Accept this from parent
  highlightColor = 'rgba(255, 255, 0, 0.3)'
}) {
  const [activeHighlights, setActiveHighlights] = useState([]);
  const [highlightsPersisted, setHighlightsPersisted] = useState(false);
  const [currentProvenanceId, setCurrentProvenanceId] = useState(null);
  const highlightElementsRef = useRef(new Map());

  // Apply highlights when sentence IDs, page, or viewport changes
  useEffect(() => {
    if (!sentenceIds.length || !highlightLayerRef?.current || !currentViewport) {
      clearHighlights();
      return;
    }

    // Check if we need to create new highlights
    const provenanceId = provenanceData?.provenance_id;
    if (provenanceId !== currentProvenanceId || !highlightsPersisted) {
      console.log('🎯 PDFHighlighter: Creating new highlights for provenance:', provenanceId);
      setCurrentProvenanceId(provenanceId);
      applyHighlights();
    }
  }, [sentenceIds, currentPage, currentViewport, provenanceData?.provenance_id, currentProvenanceId, highlightsPersisted]);

  const applyHighlights = async () => {
        clearHighlights();

        if (!sentenceIds.length || !provenanceData) return;

        console.log(`🎯 PDFHighlighter: Creating highlights for ${documentId}:`, {
            sentenceIds: sentenceIds,
            currentPage: currentPage,
            provenanceId: provenanceData.provenance_id
        });

        try {
            // PRIORITY 1: Try to use pre-computed mappings
            const mappingsResult = await tryMappingsHighlighting();
            
            if (mappingsResult.success && mappingsResult.highlights.length > 0) {
                console.log('✅ PDFHighlighter: Using pre-computed mappings');
                createHighlightElements(mappingsResult.highlights);
                setActiveHighlights(mappingsResult.highlights);
                setHighlightsPersisted(true);
                return;
            }

            console.log('⚠️ PDFHighlighter: Mappings not available, falling back to API highlighting');

            // FALLBACK: Use API-based highlighting
            const provenanceText = provenanceData.provenance || 
                               (provenanceData.content && provenanceData.content.join(' ')) || '';

            const response = await getProvenanceHighlightingBoxesEnhanced(
                `${documentId}.pdf`,
                sentenceIds,
                provenanceData.provenance_id,
                provenanceText,
                currentPage
            );

            if (response.success && response.bounding_boxes) {
                console.log('✅ PDFHighlighter: Using API-based highlighting');
                const highlights = processAPIHighlights(response);
                createHighlightElements(highlights);
                setActiveHighlights(highlights);
                setHighlightsPersisted(true);
            } else {
                console.warn('⚠️ PDFHighlighter: All highlighting methods failed, using fallback');
                createFallbackHighlights();
            }

        } catch (error) {
            console.error('❌ PDFHighlighter: Error in highlighting:', error);
            createFallbackHighlights();
        }
    };

  const tryMappingsHighlighting = async () => {
    try {
      // Use the existing mappings API function
      const mappingsResponse = await getHighlightingFromMappings(
        `${documentId}.pdf`,
        sentenceIds,
        currentPage
      );

      if (mappingsResponse.success && mappingsResponse.bounding_boxes) {
        const highlights = [];

        Object.entries(mappingsResponse.bounding_boxes).forEach(([sentenceId, boxes]) => {
          boxes.forEach((bbox, bboxIndex) => {
            highlights.push({
              ...bbox,
              sentenceId: parseInt(sentenceId),
              bboxIndex,
              originalText: provenanceData.provenance || `Sentence ${sentenceId}`,
              dataSource: 'pre_computed_mapping'
            });
          });
        });

        return { success: true, highlights };
      }

      return { success: false, highlights: [] };

    } catch (error) {
      console.log('🗺️ PDFHighlighter: Mappings not available:', error.message);
      return { success: false, highlights: [] };
    }
  };

  const processAPIHighlights = (response) => {
    const highlights = [];

    Object.entries(response.bounding_boxes).forEach(([sentenceId, boxes]) => {
      const pageBoxes = boxes.filter(box =>
        box.page === currentPage &&
        box.confidence > 0.4
      );

      pageBoxes.forEach((bbox, bboxIndex) => {
        highlights.push({
          ...bbox,
          sentenceId: parseInt(sentenceId),
          bboxIndex,
          originalText: provenanceData.provenance || `Sentence ${sentenceId}`,
          dataSource: response.data_source || 'api'
        });
      });
    });

    return highlights;
  };

  const createHighlightElements = (highlights) => {
    if (!highlightLayerRef?.current || !currentViewport) return;

    let highlightsCreated = 0;
    const newHighlights = new Map();

    highlights.forEach((highlight) => {
      const highlightElement = createPreciseHighlightFromAPI(highlight);

      if (highlightElement) {
        newHighlights.set(`${highlight.sentenceId}_${highlight.bboxIndex}`, highlightElement);
        highlightsCreated++;
      }
    });

    // Update our ref
    highlightElementsRef.current = newHighlights;

    console.log(`✅ PDFHighlighter: Created ${highlightsCreated} highlight elements`);
  };

  const createPreciseHighlightFromAPI = (highlight) => {
    if (!currentViewport || !highlightLayerRef?.current) return null;

    let left, top, width, height;

    // Handle different coordinate systems (especially PDFMiner from mappings)
    if (highlight.dataSource === 'pre_computed_mapping' && highlight.coordinate_system === 'pdfminer') {
      // Transform PDFMiner coordinates to PDF.js viewport coordinates
      // PDFMiner: origin at bottom-left, Y increases upward
      // PDF.js: origin at top-left, Y increases downward
      
      const pageHeightInPdfCoords = currentViewport.height / currentViewport.scale;
      
      left = highlight.left * currentViewport.scale;
      
      // Convert Y coordinate: flip the Y axis
      // PDFMiner top = distance from bottom
      // PDF.js top = distance from top
      const regionBottomInPdfCoords = highlight.top;
      const regionTopInPdfCoords = highlight.top + highlight.height;
      
      // Convert to PDF.js coordinates (flip Y axis)
      const topInPdfJsCoords = pageHeightInPdfCoords - regionTopInPdfCoords;
      
      top = topInPdfJsCoords * currentViewport.scale;
      width = highlight.width * currentViewport.scale;
      height = highlight.height * currentViewport.scale;
      
      console.log(`🔄 PDFMiner→PDF.js coordinate transform:`, {
        pdfminer: { left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height },
        pdfjs: { left, top, width, height },
        pageHeight: pageHeightInPdfCoords,
        scale: currentViewport.scale
      });
      
    } else if (highlight.dataSource === 'pre_computed_mapping') {
      // Pre-computed mappings with different coordinate system
      left = highlight.x0 * currentViewport.scale;
      top = highlight.y1 * currentViewport.scale;
      width = (highlight.x1 - highlight.x0) * currentViewport.scale;
      height = (highlight.y0 - highlight.y1) * currentViewport.scale;
    } else {
      // API-based coordinates (original system)
      const pdfToViewport = (pdfX, pdfY) => {
        const viewportX = pdfX * currentViewport.scale;
        const viewportY = (currentViewport.height / currentViewport.scale - pdfY) * currentViewport.scale;
        return { x: viewportX, y: viewportY };
      };

      const topLeft = pdfToViewport(highlight.x0, highlight.y1);
      const bottomRight = pdfToViewport(highlight.x1, highlight.y0);
      left = topLeft.x;
      top = topLeft.y;
      width = bottomRight.x - topLeft.x;
      height = bottomRight.y - topLeft.y;
    }

    // Basic validation
    if (width <= 0 || height <= 0) {
      console.warn(`⚠️ PDFHighlighter: Invalid bbox dimensions: ${width}x${height}`);
      return null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'pdf-highlighter-overlay';
    overlay.setAttribute('data-sentence-id', highlight.sentenceId);
    overlay.setAttribute('data-bbox-index', highlight.bboxIndex);
    overlay.setAttribute('data-confidence', (highlight.confidence || 0.8).toFixed(2));
    overlay.setAttribute('data-source', highlight.dataSource);

    // Different styling based on data source
    let backgroundColor, borderColor;
    if (highlight.dataSource === 'pre_computed_mapping') {
      backgroundColor = 'rgba(76, 175, 80, 0.4)'; // Green for mappings
      borderColor = 'rgba(76, 175, 80, 0.8)';
    } else {
      backgroundColor = 'rgba(255, 193, 7, 0.4)'; // Yellow for API
      borderColor = 'rgba(255, 193, 7, 0.8)';
    }

    overlay.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${width}px;
      height: ${height}px;
      background-color: ${backgroundColor};
      border: 2px solid ${borderColor};
      border-radius: 4px;
      z-index: 9999;
      pointer-events: auto;
      cursor: pointer;
      opacity: 1;
      display: block;
      visibility: visible;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    `;

    overlay.title = `Evidence ${highlight.bboxIndex + 1}\nSentence: ${highlight.sentenceId}\nConfidence: ${((highlight.confidence || 0.8) * 100).toFixed(0)}%\nSource: ${highlight.dataSource}`;

    // Add click handler
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log(`📍 PDFHighlighter: Clicked highlight: sentence ${highlight.sentenceId}, bbox ${highlight.bboxIndex}`);

      // Visual feedback
      overlay.style.transform = 'scale(1.05)';
      overlay.style.borderWidth = '3px';
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
        overlay.style.borderWidth = '2px';
      }, 200);

      // Call the highlight click handler
      if (onHighlightClick) {
        onHighlightClick({
          sentenceId: highlight.sentenceId,
          text: highlight.originalText,
          confidence: highlight.confidence || 0.8,
          matchType: highlight.dataSource,
          page: currentPage
        });
      }
    });

    // Hover effects
    overlay.addEventListener('mouseenter', () => {
      overlay.style.transform = 'scale(1.02)';
      overlay.style.zIndex = '10000';
      overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.style.transform = 'scale(1)';
      overlay.style.zIndex = '9999';
      overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    });

    highlightLayerRef.current.appendChild(overlay);
    return overlay;
  };

  const createFallbackHighlights = () => {
    console.log('🆘 PDFHighlighter: Creating fallback highlights');

    if (!highlightLayerRef?.current) return;

    let highlightsCreated = 0;
    const newHighlights = new Map();

    sentenceIds.forEach((sentenceId, index) => {
      const fallbackBox = {
        left: 20,
        top: 20 + (index * 40),
        width: 250,
        height: 35
      };

      const overlay = document.createElement('div');
      overlay.className = 'pdf-highlighter-fallback';
      overlay.setAttribute('data-sentence-id', sentenceId);

      overlay.style.cssText = `
        position: absolute;
        left: ${fallbackBox.left}px;
        top: ${fallbackBox.top}px;
        width: ${fallbackBox.width}px;
        height: ${fallbackBox.height}px;
        background-color: rgba(255, 69, 0, 0.8);
        border: 2px solid rgba(255, 69, 0, 1);
        border-radius: 4px;
        z-index: 550;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 12px;
        cursor: pointer;
      `;

      overlay.innerHTML = `📍 Evidence ${index + 1} (Fallback)`;
      overlay.title = `Fallback highlight for sentence ${sentenceId}`;

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();

        if (onHighlightClick) {
          onHighlightClick({
            sentenceId,
            text: `Sentence ${sentenceId} (fallback)`,
            confidence: 0.5,
            matchType: 'fallback',
            page: currentPage
          });
        }
      });

      highlightLayerRef.current.appendChild(overlay);
      newHighlights.set(`${sentenceId}_fallback`, overlay);
      highlightsCreated++;
    });

    highlightElementsRef.current = newHighlights;
    setActiveHighlights([]);
    setHighlightsPersisted(true);
    console.log(`✅ PDFHighlighter: Created ${highlightsCreated} fallback highlights`);
  };

  const clearHighlights = () => {
    if (!highlightLayerRef?.current) return;

    // Remove all highlight elements created by this component
    const overlays = highlightLayerRef.current.querySelectorAll('.pdf-highlighter-overlay, .pdf-highlighter-fallback');
    console.log(`🧹 PDFHighlighter: Clearing ${overlays.length} highlights`);

    overlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    highlightElementsRef.current.clear();
    setActiveHighlights([]);
    setHighlightsPersisted(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, []);

  // This component doesn't render anything directly - it manages DOM elements
  return null;
}

/**
 * Higher-level component that integrates with your PDF viewer
 * This is kept for backward compatibility but not needed with LayoutBasedPDFViewer
 */
export function PDFViewerWithHighlights({ 
  documentId, 
  provenanceData, 
  onHighlightClick 
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pdfViewerRef = useRef(null);
  
  // Extract sentence IDs from current provenance
  const sentenceIds = provenanceData?.sentences_ids || provenanceData?.provenance_ids || [];
  
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handleHighlightClick = (highlight, index) => {
    console.log('Highlight clicked:', highlight);
    
    if (onHighlightClick) {
      onHighlightClick({
        sentenceId: highlight.sentenceId,
        text: highlight.originalText,
        confidence: highlight.confidence,
        matchType: highlight.match_type,
        page: currentPage
      });
    }
  };

  return (
    <div className="pdf-viewer-container">
      <div 
        ref={pdfViewerRef}
        className="pdf-viewer"
        data-current-page={currentPage}
      >
        {/* Your existing PDF.js viewer integration goes here */}
        <PDFHighlighter
          documentId={documentId}
          currentPage={currentPage}
          sentenceIds={sentenceIds}
          pdfViewerRef={pdfViewerRef}
          provenanceData={provenanceData}
          onHighlightClick={handleHighlightClick}
        />
      </div>
      
      <div className="pdf-controls">
        <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))}>
          Previous Page
        </button>
        
        <span>Page {currentPage}</span>
        
        <button onClick={() => handlePageChange(currentPage + 1)}>
          Next Page
        </button>
      </div>
    </div>
  );
}

// Export utility functions for integration
export const PDFHighlightingUtils = {
  /**
   * Generate mapping file path for a document
   */
  getMappingPath: (documentId) => `/api/documents/${documentId}/mappings`,
  
  /**
   * Validate that mappings exist for a document
   */
  validateMappings: async (documentId) => {
    try {
      const response = await fetch(PDFHighlightingUtils.getMappingPath(documentId));
      return response.ok;
    } catch {
      return false;
    }
  },
  
  /**
   * Get mapping statistics for debugging
   */
  getMappingStats: (mappings) => {
    if (!mappings) return null;
    
    let totalSentences = 0;
    let totalRegions = 0;
    const confidenceDistribution = { high: 0, medium: 0, low: 0 };
    
    Object.values(mappings).forEach(pageMappings => {
      Object.values(pageMappings).forEach(sentenceMapping => {
        totalSentences++;
        totalRegions += sentenceMapping.highlight_regions?.length || 0;
        
        const confidence = sentenceMapping.match_confidence;
        if (confidence > 0.8) confidenceDistribution.high++;
        else if (confidence > 0.6) confidenceDistribution.medium++;
        else confidenceDistribution.low++;
      });
    });
    
    return {
      totalSentences,
      totalRegions,
      confidenceDistribution
    };
  }
};