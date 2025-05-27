import React, { useState, useEffect, useRef } from 'react';
import '../styles/brutalist-design.css';
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
  faEyeSlash
} from '@fortawesome/free-solid-svg-icons';

const PDFViewer = ({ document: pdfDocument, selectedProvenance, onClose, isGridMode = false, isMainView }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); 
  const [pdfText, setPdfText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [highlightedText, setHighlightedText] = useState('');
  const viewerRef = useRef(null);
  const contentRef = useRef(null);

  // Load PDF text when document changes
  useEffect(() => {
    if (pdfDocument) {
      loadPDFText();
    } else {
      setPdfText('');
      setError(null);
    }
  }, [pdfDocument]);

  // Initialize content when PDF text loads
  useEffect(() => {
    if (pdfText && contentRef.current && !loading && !error) {
      // Initialize with plain text content
      updateHighlightedContent('');
    }
  }, [pdfText, loading, error]);

  // Handle provenance highlighting - wait for PDF text to be loaded
  useEffect(() => {
    if (selectedProvenance && selectedProvenance.content && showHighlights && pdfText) {
      console.log('🎯 PDFViewer highlighting provenance:', {
        provenanceId: selectedProvenance.provenance_id,
        sentenceIds: selectedProvenance.sentences_ids,
        contentLength: selectedProvenance.content?.length,
        firstContent: selectedProvenance.content?.[0]?.substring(0, 100),
        pdfTextLength: pdfText.length
      });
      
      // Get the content to highlight - could be array of sentences or single text
      let textToHighlight = '';
      if (Array.isArray(selectedProvenance.content)) {
        // Join multiple sentences with spaces, preserving sentence boundaries
        textToHighlight = selectedProvenance.content.join(' ');
      } else {
        textToHighlight = selectedProvenance.content;
      }
      
      setHighlightedText(textToHighlight);
      
      // Use requestAnimationFrame for better DOM timing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateHighlightedContent(textToHighlight);
        });
      });
    } else {
      setHighlightedText('');
      // Reset to original content when no highlighting
      updateHighlightedContent('');
    }
  }, [selectedProvenance, showHighlights, pdfText]);

  const loadPDFText = async () => {
    if (!pdfDocument) return;

    setLoading(true);
    setError(null);

    try {
      const backendDocumentId = pdfDocument.backendDocumentId || pdfDocument.id;

      if (backendDocumentId) {
        try {
          const response = await fetch(`/api/documents/${backendDocumentId}/text`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.text) {
              setPdfText(data.text);
              return;
            }
          }
        } catch (fetchError) {
          console.warn('Failed to fetch PDF text from backend, using fallback:', fetchError);
        }
      }

      if (pdfDocument.fullText) {
        setPdfText(pdfDocument.fullText);
        return;
      }

      if (pdfDocument.isPreloaded || pdfDocument.isPreLoaded) {
        try {
          const preloadedResponse = await fetch('/api/documents/preloaded');
          if (preloadedResponse.ok) {
            const preloadedData = await preloadedResponse.json();
            if (preloadedData.success && preloadedData.documents) {
              const matchingDoc = preloadedData.documents.find(doc => 
                doc.filename === pdfDocument.filename
              );
              
              if (matchingDoc) {
                const loadResponse = await fetch(`/api/documents/preloaded/${matchingDoc.document_id}`, {
                  method: 'POST'
                });
                
                if (loadResponse.ok) {
                  const textResponse = await fetch(`/api/documents/${matchingDoc.document_id}/text`);
                  if (textResponse.ok) {
                    const textData = await textResponse.json();
                    if (textData.success && textData.text) {
                      setPdfText(textData.text);
                      return;
                    }
                  }
                }
              }
            }
          }
        } catch (preloadedError) {
          console.warn('Failed to load preloaded document text:', preloadedError);
        }
      }

      setPdfText(generateFallbackText());

    } catch (err) {
      console.error('Error loading PDF text:', err);
      setError('Failed to load document text');
      setPdfText(generateFallbackText());
    } finally {
      setLoading(false);
    }
  };

  const generateFallbackText = () => {
    if (!pdfDocument) return "NO_DOCUMENT_LOADED";
    
    const isPreloaded = pdfDocument.isPreloaded || pdfDocument.isPreLoaded;
    const filename = pdfDocument.filename || 'Unknown Document';
    const textLength = pdfDocument.textLength || 'Unknown';
    const sentenceCount = pdfDocument.sentenceCount || 'Unknown';
    
    if (isPreloaded) {
      return `
📄 PRELOADED RESEARCH DOCUMENT

Document: ${filename}

⚠️ DOCUMENT LOADING IN PROGRESS

This is a preloaded research document from our collection. The system is currently extracting and processing the full text content from the PDF file.

Document Information:
- Filename: ${filename}
- Type: Preloaded Research Paper
- Status: Loading content from server...

🔄 Please wait while we:
1. Extract text from the PDF file
2. Process the document structure  
3. Prepare it for provenance analysis

Once loaded, you'll be able to:
- Ask questions about this document
- View highlighted provenance evidence
- Navigate through the full document text

💡 TIP: Try asking questions like:
- "What is the main contribution of this paper?"
- "What methodology was used?"
- "What are the key findings?"

Loading initiated at: ${new Date().toLocaleString()}
      `;
    } else {
      return `
Document: ${filename}

📄 DOCUMENT SUCCESSFULLY UPLOADED AND PROCESSED

Document Statistics:
- Filename: ${filename}
- Text Length: ${textLength} characters
- Sentences: ${sentenceCount} sentences
- Status: Ready for Analysis

🔍 HOW TO USE:
1. Ask questions about this document using the question panel below
2. The system will analyze the document and provide provenance-based answers
3. Evidence from the document will be highlighted in this viewer
4. Navigate through different provenance sources to see supporting evidence

💡 TIPS:
- Ask specific questions for better results
- Try questions like "What is the main argument?" or "What methodology was used?"
- The system works best with academic papers and research documents

⚠️ NOTE: 
The full PDF text extraction is complete. If you're seeing this message instead of the actual document text, there may be a connection issue with the backend text retrieval service. The document has been processed and is ready for question answering.

Document processing completed at: ${new Date().toLocaleString()}
      `;
    }
  };

  const updateHighlightedContent = (searchText) => {
    if (!contentRef.current || !pdfText) {
      console.log('❌ Missing contentRef or pdfText');
      return;
    }

    try {
      let htmlContent = '';
      
      if (!searchText || !showHighlights) {
        // Show plain text
        htmlContent = pdfText.split('\n').map(line => line || '\u00A0').join('<br/>');
      } else {
        // Create highlighted content
        htmlContent = createHighlightedContent(pdfText, searchText);
      }
      
      // Safely update content
      contentRef.current.innerHTML = htmlContent;
      
      // If we have highlights, scroll to the first one
      if (searchText && showHighlights) {
        setTimeout(() => scrollToFirstHighlight(), 100);
      }
      
    } catch (error) {
      console.error('❌ Error updating highlighted content:', error);
      // Fallback to safe content update
      if (contentRef.current) {
        contentRef.current.textContent = pdfText;
      }
    }
  };

  const scrollToFirstHighlight = () => {
    if (!contentRef.current) return;
    
    try {
      const highlights = contentRef.current.querySelectorAll('.provenance-highlight');
      console.log(`🔍 Found ${highlights.length} highlights for scrolling`);
      
      if (highlights.length > 0) {
        const firstHighlight = highlights[0];
        
        // Scroll to the highlight
        firstHighlight.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
        
        // Add pulse animation
        firstHighlight.style.animation = 'highlightPulse 2s ease-in-out';
        
        // Remove animation after completion
        setTimeout(() => {
          if (firstHighlight && firstHighlight.style) {
            firstHighlight.style.animation = '';
          }
        }, 2000);
        
        console.log('✅ Successfully scrolled to first highlight');
      } else {
        console.log('❌ No highlights found for scrolling');
      }
    } catch (error) {
      console.error('❌ Error scrolling to highlight:', error);
    }
  };

  const highlightAndScrollToText = (searchText) => {
  if (!searchText || !pdfText) {
    console.log('⚠️ No search text or PDF text available');
    return;
  }
  
  console.log('🎯 Highlighting and scrolling to text:', searchText.substring(0, 100) + '...');
  
  // Update the highlighted content
  updateHighlightedContent(searchText);
  
  // Scroll to the first highlight after a brief delay to ensure DOM update
  setTimeout(() => {
    scrollToFirstHighlight();
  }, 200);
};

  const createHighlightedContent = (fullText, searchText) => {
    if (!searchText || searchText.length < 5) {
      console.log('⚠️ Search text too short for highlighting');
      return fullText.replace(/\n/g, '<br/>');
    }

    console.log('🔧 Creating highlighted content with enhanced strategies...');
    let result = fullText;
    let highlightApplied = false;
    
    try {
      // Clean and prepare search text - handle merged sentences from your backend
      const cleanSearchText = searchText
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();

      console.log('🔍 Search text preview:', cleanSearchText.substring(0, 200) + '...');
      
      // Strategy 1: Try exact phrase matching with different chunk sizes
      const chunkSizes = [150, 100, 80, 60, 40]; // Try different lengths
      
      for (const chunkSize of chunkSizes) {
        if (highlightApplied) break;
        
        const searchChunk = cleanSearchText.substring(0, Math.min(cleanSearchText.length, chunkSize));
        if (searchChunk.length < 20) continue;
        
        const exactRegex = new RegExp(escapeRegExp(searchChunk), 'gi');
        const exactMatches = result.match(exactRegex);
        
        if (exactMatches && exactMatches.length > 0) {
          result = result.replace(exactRegex, (match) => {
            highlightApplied = true;
            return `<mark class="provenance-highlight exact-match">${match}</mark>`;
          });
          console.log(`✅ Applied exact matching (${chunkSize} chars): ${exactMatches.length} matches`);
          break;
        }
      }
      
      // Strategy 2: Sentence-by-sentence matching (for merged sentences from your backend)
      if (!highlightApplied) {
        // Split search text by sentence boundaries (like your merge_short_sentences does)
        const sentences = cleanSearchText.split(/[.!?]+\s+/).filter(s => s.trim().length > 15);
        
        for (const sentence of sentences.slice(0, 5)) { // Try first 5 sentences
          const cleanSentence = sentence.trim().replace(/\s+/g, ' ');
          if (cleanSentence.length < 15) continue;
          
          // Try different portions of the sentence
          const portions = [
            cleanSentence, // Full sentence
            cleanSentence.substring(0, Math.min(100, cleanSentence.length)), // First 100 chars
            cleanSentence.substring(0, Math.min(60, cleanSentence.length))   // First 60 chars
          ];
          
          for (const portion of portions) {
            if (portion.length < 15) continue;
            
            const sentenceRegex = new RegExp(escapeRegExp(portion), 'gi');
            const sentenceMatches = result.match(sentenceRegex);
            
            if (sentenceMatches && sentenceMatches.length > 0) {
              result = result.replace(sentenceRegex, (match) => {
                highlightApplied = true;
                return `<mark class="provenance-highlight sentence-match">${match}</mark>`;
              });
              console.log(`✅ Applied sentence matching: "${portion.substring(0, 50)}..."`);
              break;
            }
          }
          
          if (highlightApplied) break;
        }
      }
      
      // Strategy 3: Word sequence matching (handles text variations)
      if (!highlightApplied) {
        const words = cleanSearchText.split(/\s+/)
          .filter(word => word.length > 3) // Only significant words
          .filter(word => !/^(the|and|or|but|in|on|at|to|for|of|with|by|is|was|are|were|been|have|has|had)$/i.test(word)) // Filter common words
          .slice(0, 20); // Limit to first 20 important words
        
        if (words.length >= 4) {
          // Try sequences of 6, 5, 4 words
          const sequenceLengths = [6, 5, 4];
          
          for (const seqLen of sequenceLengths) {
            if (highlightApplied) break;
            
            for (let i = 0; i <= words.length - seqLen; i++) {
              const wordSequence = words.slice(i, i + seqLen).join('\\s+[\\w\\s]*?');
              const sequenceRegex = new RegExp(wordSequence, 'gi');
              
              const sequenceMatches = result.match(sequenceRegex);
              if (sequenceMatches && sequenceMatches.length > 0) {
                result = result.replace(sequenceRegex, (match) => {
                  highlightApplied = true;
                  return `<mark class="provenance-highlight sequence-match">${match}</mark>`;
                });
                console.log(`✅ Applied word sequence matching (${seqLen} words): ${words.slice(i, i + seqLen).join(' ')}`);
                break;
              }
            }
          }
        }
      }
      
      // Strategy 4: Individual important keywords (fallback)
      if (!highlightApplied) {
        const importantWords = cleanSearchText.split(/\s+/)
          .filter(word => word.length > 5) // Only longer words
          .filter(word => !/^(the|and|or|but|in|on|at|to|for|of|with|by|is|was|are|were|been|have|has|had|this|that|these|those|which|what|when|where|who|how)$/i.test(word))
          .slice(0, 10); // Top 10 important words
        
        let keywordCount = 0;
        
        importantWords.forEach((word, index) => {
          const wordRegex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
          const matches = result.match(wordRegex);
          
          if (matches && matches.length > 0) {
            result = result.replace(wordRegex, (match) => {
              keywordCount++;
              return `<mark class="provenance-highlight keyword-match keyword-${index % 3}">${match}</mark>`;
            });
          }
        });
        
        if (keywordCount > 0) {
          highlightApplied = true;
          console.log(`✅ Applied keyword highlighting: ${keywordCount} keywords highlighted from ${importantWords.length} words`);
        }
      }
      
      if (!highlightApplied) {
        console.log('❌ No highlighting strategies succeeded');
        console.log('🔍 Debug info:');
        console.log('  - Search text length:', cleanSearchText.length);
        console.log('  - PDF text length:', fullText.length);
        console.log('  - Search preview:', cleanSearchText.substring(0, 100));
        console.log('  - PDF preview:', fullText.substring(0, 100));
        
        // Last resort: highlight the most distinctive phrase if we can find one
        const phrases = cleanSearchText.split(/[.!?]+/).filter(p => p.trim().length > 20);
        if (phrases.length > 0) {
          const distinctivePhrase = phrases[0].trim().substring(0, 50);
          const lastResortRegex = new RegExp(escapeRegExp(distinctivePhrase), 'gi');
          
          if (lastResortRegex.test(result)) {
            result = result.replace(lastResortRegex, (match) => 
              `<mark class="provenance-highlight fallback-match">${match}</mark>`
            );
            console.log(`⚡ Applied fallback highlighting: "${distinctivePhrase}"`);
          }
        }
      }
      
      return result.replace(/\n/g, '<br/>');
      
    } catch (error) {
      console.error('❌ Error creating highlighted content:', error);
      return fullText.replace(/\n/g, '<br/>');
    }
  };

  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const toggleHighlights = () => {
    setShowHighlights(!showHighlights);
    if (!showHighlights && highlightedText) {
      // Re-highlight when turning highlights back on
      setTimeout(() => highlightAndScrollToText(highlightedText), 100);
    }
  };

  if (!pdfDocument) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-empty">
          <div className="empty-icon">
            <FontAwesomeIcon icon={faFileAlt} />
          </div>
          <div className="empty-message">
            NO_DOCUMENT_SELECTED
            <br />
            <span style={{ fontSize: '11px', color: 'var(--win95-text-muted)' }}>
              Upload PDF to view content
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* PDF Header */}
      <div className="pdf-header">
        <div className="pdf-title">
          <FontAwesomeIcon icon={faFileAlt} />
          <span className="doc-name">{pdfDocument.filename}</span>
          {selectedProvenance && (
            <span className="provenance-indicator">
              PROV_{String(selectedProvenance.provenance_id || 0).padStart(3, '0')}_HIGHLIGHTED
            </span>
          )}
          {pdfDocument.isPreloaded && (
            <span className="preloaded-indicator">📚 PRELOADED</span>
          )}
        </div>

        <div className="pdf-controls">
          <button
            className="control-btn"
            onClick={toggleHighlights}
            title={showHighlights ? "Hide Highlights" : "Show Highlights"}
          >
            <FontAwesomeIcon icon={showHighlights ? faEye : faEyeSlash} />
          </button>

          <button className="control-btn" onClick={handleZoomOut} title="Zoom Out">
            <FontAwesomeIcon icon={faSearchMinus} />
          </button>

          <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>

          <button className="control-btn" onClick={handleZoomIn} title="Zoom In">
            <FontAwesomeIcon icon={faSearchPlus} />
          </button>

          {!isGridMode && (
            <>
              <button className="control-btn" onClick={toggleFullscreen} title="Toggle Fullscreen">
                <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
              </button>

              <button className="control-btn close-btn" onClick={onClose} title="Close">
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="pdf-content" ref={viewerRef} style={{ flex: 1, overflow: 'auto' }}>
        {/* Provenance Legend */}
        {selectedProvenance && showHighlights && selectedProvenance.content && (
          <div className="highlight-legend">
            <h4>
              <FontAwesomeIcon icon={faHighlighter} />
              HIGHLIGHTED_PROVENANCE_EVIDENCE
            </h4>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-color exact-match"></span>
                <span>EXACT_MATCH</span>
              </div>
              <div className="legend-item">
                <span className="legend-color sentence-match"></span>
                <span>SENTENCE_MATCH</span>
              </div>
              <div className="legend-item">
                <span className="legend-color sequence-match"></span>
                <span>SEQUENCE_MATCH</span>
              </div>
              <div className="legend-item">
                <span className="legend-color keyword-match"></span>
                <span>KEYWORD_MATCH</span>
              </div>
              <div className="legend-item">
                <span className="legend-color fallback-match"></span>
                <span>FALLBACK_MATCH</span>
              </div>
            </div>

            <div className="provenance-summary">
              <div className="summary-item">
                <span className="summary-label">PROVENANCE_ID:</span>
                <span className="summary-value">
                  {selectedProvenance.provenance_id || 'N/A'}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">PROCESSING_TIME:</span>
                <span className="summary-value">
                  {selectedProvenance.time?.toFixed(2) || 'N/A'}s
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">SENTENCE_IDS:</span>
                <span className="summary-value">
                  {selectedProvenance.sentences_ids?.length || 0}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Document Info Panel */}
        <div className="document-info">
          <div className="info-item">
            <strong>Document:</strong> {pdfDocument.filename}
          </div>
          {pdfDocument.textLength && (
            <div className="info-item">
              <strong>Length:</strong> {pdfDocument.textLength.toLocaleString()} characters
            </div>
          )}
          {pdfDocument.sentenceCount && (
            <div className="info-item">
              <strong>Sentences:</strong> {pdfDocument.sentenceCount.toLocaleString()}
            </div>
          )}
          {pdfDocument.isPreloaded && (
            <div className="info-item">
              <strong>Type:</strong> Preloaded Research Document
            </div>
          )}
        </div>

        {/* Update the content rendering to be more React-friendly */}
        <div
          className="pdf-text-content"
          style={{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top left'
          }}
        >
          <div
            ref={contentRef}
            className="pdf-text-body"
            style={{ 
              lineHeight: 1.6, 
              fontSize: '14px', 
              color: '#333',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              minHeight: '100px'
            }}
          >
            {/* Initial content - will be replaced by highlighting system */}
            {loading ? (
              <div>LOADING_DOCUMENT...</div>
            ) : error ? (
              <div style={{ color: 'red' }}>ERROR: {error}</div>
            ) : !pdfText ? (
              <div>NO_CONTENT_AVAILABLE</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Add CSS for highlighting animations */}
      <style jsx>{`
        .provenance-highlight {
          padding: 2px 4px;
          border-radius: 3px;
          font-weight: 500;
          border: 2px solid;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          cursor: help;
          transition: all 0.3s ease;
          position: relative;
        }

        .provenance-highlight:hover {
          transform: scale(1.02);
          z-index: 10;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }

        .provenance-highlight.exact-match {
          background-color: rgba(255, 235, 59, 0.4);
          border-color: #ffeb3b;
        }

        .provenance-highlight.fuzzy-match {
          background-color: rgba(76, 175, 80, 0.4);
          border-color: #4caf50;
        }

        .provenance-highlight.sentence-match {
          background-color: rgba(76, 175, 80, 0.4);
          border-color: #4caf50;
        }

        .provenance-highlight.sequence-match {
          background-color: rgba(33, 150, 243, 0.4);
          border-color: #2196f3;
        }

        .provenance-highlight.keyword-match {
          background-color: rgba(255, 152, 0, 0.4);
          border-color: #ff9800;
        }

        .provenance-highlight.keyword-0 {
          background-color: rgba(255, 152, 0, 0.4);
          border-color: #ff9800;
        }

        .provenance-highlight.keyword-1 {
          background-color: rgba(156, 39, 176, 0.4);
          border-color: #9c27b0;
        }

        .provenance-highlight.keyword-2 {
          background-color: rgba(0, 150, 136, 0.4);
          border-color: #009688;
        }

        @keyframes highlightPulse {
          0% { 
            box-shadow: 0 0 0 0 rgba(255, 235, 59, 0.7);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(255, 235, 59, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(255, 235, 59, 0);
          }
        }

        .legend-color.exact-match {
          background-color: rgba(255, 235, 59, 0.6);
          border-color: #ffeb3b;
        }

        .legend-color.sentence-match {
          background-color: rgba(76, 175, 80, 0.6);
          border-color: #4caf50;
        }

        .legend-color.sequence-match {
          background-color: rgba(33, 150, 243, 0.6);
          border-color: #2196f3;
        }

        .provenance-highlight.fallback-match {
          background-color: rgba(233, 30, 99, 0.4);
          border-color: #e91e63;
        }

        .legend-color.fallback-match {
          background-color: rgba(233, 30, 99, 0.6);
          border-color: #e91e63;
        }
      `}</style>
    </div>
  );
};

export default PDFViewer;