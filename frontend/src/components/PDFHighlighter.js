// PDFHighlighter.js - React component that uses pre-computed mappings
import React, { useState, useEffect, useRef } from 'react';

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
 * PDF Highlighter component that applies highlights using pre-computed mappings
 */
export function PDFHighlighter({ 
  documentId, 
  currentPage, 
  sentenceIds = [], 
  pdfViewerRef,
  highlightColor = 'rgba(255, 255, 0, 0.3)',
  onHighlightClick = null 
}) {
  const { mappings, loading, error } = usePDFMappings(documentId);
  const [activeHighlights, setActiveHighlights] = useState([]);
  const highlightElementsRef = useRef(new Map());

  // Apply highlights when sentence IDs or page changes
  useEffect(() => {
    if (!mappings || !sentenceIds.length || !pdfViewerRef.current) {
      clearHighlights();
      return;
    }

    applyHighlights();
  }, [mappings, sentenceIds, currentPage]);

  const applyHighlights = () => {
    clearHighlights();

    if (!mappings || !sentenceIds.length) return;

    const pageKey = currentPage.toString();
    const pageMappings = mappings[pageKey];
    
    if (!pageMappings) {
      console.log(`No mappings found for page ${currentPage}`);
      return;
    }

    const highlights = [];

    // Collect all highlight regions for the requested sentences
    for (const sentenceId of sentenceIds) {
      const sentenceMapping = pageMappings[sentenceId.toString()];
      
      if (sentenceMapping && sentenceMapping.highlight_regions) {
        for (const region of sentenceMapping.highlight_regions) {
          if (region.page === currentPage) {
            highlights.push({
              ...region,
              sentenceId,
              originalText: sentenceMapping.original_text
            });
          }
        }
      } else {
        console.log(`No mapping found for sentence ${sentenceId} on page ${currentPage}`);
        
        // Try fallback coordinates if available
        const fallbackHighlight = tryFallbackCoordinates(sentenceMapping, currentPage);
        if (fallbackHighlight) {
          highlights.push(fallbackHighlight);
        }
      }
    }

    // Create and position highlight elements
    createHighlightElements(highlights);
    setActiveHighlights(highlights);
  };

  const tryFallbackCoordinates = (sentenceMapping, pageNum) => {
    if (!sentenceMapping?.fallback_coordinates) return null;

    const fallback = sentenceMapping.fallback_coordinates;
    const pageBounds = fallback.bounding_boxes?.filter(box => box.page === pageNum);

    if (!pageBounds?.length) return null;

    // Use the first bounding box as fallback
    const bound = pageBounds[0];
    return {
      page: pageNum,
      left: bound.x0,
      top: bound.y0,
      width: bound.x1 - bound.x0,
      height: bound.y1 - bound.y0,
      confidence: 0.5,
      match_type: 'fallback',
      sentenceId: sentenceMapping.sentence_id,
      originalText: sentenceMapping.original_text
    };
  };

  const createHighlightElements = (highlights) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;

    // Find the current page element in PDF.js viewer
    const pageElement = pdfViewer.querySelector(`[data-page-number="${currentPage}"]`);
    if (!pageElement) {
      console.warn(`Page element not found for page ${currentPage}`);
      return;
    }

    // Get the page's text layer for coordinate reference
    const textLayer = pageElement.querySelector('.textLayer');
    if (!textLayer) {
      console.warn('Text layer not found');
      return;
    }

    // Get the page viewport for coordinate conversion
    const pageRect = pageElement.getBoundingClientRect();
    const textLayerRect = textLayer.getBoundingClientRect();

    highlights.forEach((highlight, index) => {
      const highlightElement = createHighlightElement(highlight, index);
      
      // Position the highlight element
      positionHighlightElement(
        highlightElement, 
        highlight, 
        textLayerRect,
        pageRect
      );

      // Add to page
      textLayer.appendChild(highlightElement);
      
      // Store reference for cleanup
      highlightElementsRef.current.set(`${highlight.sentenceId}-${index}`, highlightElement);
    });
  };

  const createHighlightElement = (highlight, index) => {
    const element = document.createElement('div');
    element.className = 'pdf-highlight';
    element.style.cssText = `
      position: absolute;
      background-color: ${highlightColor};
      border: 1px solid rgba(255, 215, 0, 0.6);
      pointer-events: auto;
      cursor: pointer;
      z-index: 1000;
      transition: opacity 0.2s ease;
    `;

    // Add data attributes for debugging and interaction
    element.setAttribute('data-sentence-id', highlight.sentenceId);
    element.setAttribute('data-confidence', highlight.confidence.toFixed(2));
    element.setAttribute('data-match-type', highlight.match_type);
    element.setAttribute('data-highlight-index', index);

    // Add hover effects
    element.addEventListener('mouseenter', () => {
      element.style.backgroundColor = highlightColor.replace('0.3', '0.5');
    });

    element.addEventListener('mouseleave', () => {
      element.style.backgroundColor = highlightColor;
    });

    // Add click handler
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onHighlightClick) {
        onHighlightClick(highlight, index);
      }
    });

    // Add tooltip with debug info
    element.title = `Sentence ${highlight.sentenceId} (${highlight.match_type}, ${(highlight.confidence * 100).toFixed(0)}%)`;

    return element;
  };

  const positionHighlightElement = (element, highlight, textLayerRect, pageRect) => {
    // Convert highlight coordinates to CSS positioning
    // Note: You may need to adjust this based on your coordinate system
    
    // Scale factor between PDF coordinates and display coordinates
    const scaleX = textLayerRect.width / pageRect.width;
    const scaleY = textLayerRect.height / pageRect.height;

    const left = highlight.left * scaleX;
    const top = highlight.top * scaleY;
    const width = highlight.width * scaleX;
    const height = highlight.height * scaleY;

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  };

  const clearHighlights = () => {
    // Remove all existing highlight elements
    highlightElementsRef.current.forEach((element) => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });
    
    highlightElementsRef.current.clear();
    setActiveHighlights([]);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, []);

  // Return status and control functions
  return {
    loading,
    error,
    activeHighlights,
    clearHighlights,
    // Helper function to manually trigger highlight refresh
    refreshHighlights: applyHighlights
  };
}

/**
 * Higher-level component that integrates with your PDF viewer
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
  
  const highlighter = PDFHighlighter({
    documentId,
    currentPage,
    sentenceIds,
    pdfViewerRef,
    onHighlightClick
  });

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    // Highlights will update automatically via useEffect
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

  if (highlighter.error) {
    return (
      <div className="pdf-viewer-error">
        <p>Error loading PDF mappings: {highlighter.error}</p>
        <button onClick={highlighter.refreshHighlights}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-container">
      {highlighter.loading && (
        <div className="pdf-loading-overlay">
          Loading mappings...
        </div>
      )}
      
      <div 
        ref={pdfViewerRef}
        className="pdf-viewer"
        data-current-page={currentPage}
      >
        {/* Your existing PDF.js viewer integration goes here */}
        {/* The highlighter will automatically add highlights to the text layer */}
      </div>
      
      <div className="pdf-controls">
        <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))}>
          Previous Page
        </button>
        
        <span>Page {currentPage}</span>
        
        <button onClick={() => handlePageChange(currentPage + 1)}>
          Next Page
        </button>
        
        <button onClick={highlighter.clearHighlights}>
          Clear Highlights
        </button>
        
        <button onClick={highlighter.refreshHighlights}>
          Refresh Highlights
        </button>
      </div>
      
      {highlighter.activeHighlights.length > 0 && (
        <div className="highlight-info">
          <p>{highlighter.activeHighlights.length} highlight(s) on this page</p>
          <details>
            <summary>Debug Info</summary>
            <ul>
              {highlighter.activeHighlights.map((h, i) => (
                <li key={i}>
                  Sentence {h.sentenceId}: {h.match_type} ({(h.confidence * 100).toFixed(0)}%)
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
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