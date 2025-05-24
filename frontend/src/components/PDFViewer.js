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
  const viewerRef = useRef(null);

  // Add this useEffect to debug provenance selection
  useEffect(() => {
    console.log('🎯 PDFViewer received selectedProvenance:', {
      selectedProvenance: selectedProvenance,
      hasContent: selectedProvenance?.content?.length > 0,
      content: selectedProvenance?.content?.[0]?.substring(0, 100) + '...',
      sentenceIds: selectedProvenance?.sentences_ids
    });

    if (selectedProvenance && selectedProvenance.content) {
      highlightTextInPDF(selectedProvenance.content[0]);
    }
  }, [selectedProvenance]);

  // Load actual PDF text when document changes
  useEffect(() => {
    if (pdfDocument) {
      loadPDFText();
    } else {
      setPdfText('');
      setError(null);
    }
  }, [pdfDocument]);

  const loadPDFText = async () => {
    if (!pdfDocument) return;

    setLoading(true);
    setError(null);

    try {
      // First, try to get the backend document ID
      const backendDocumentId = pdfDocument.backendDocumentId || pdfDocument.id;

      if (backendDocumentId) {
        // Try to fetch the PDF text from backend
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

      // Fallback: If we have stored text, use it
      if (pdfDocument.fullText) {
        setPdfText(pdfDocument.fullText);
        return;
      }

      // Final fallback: Generate placeholder text
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
    // For preloaded documents, show sample content
    if (filename.toLowerCase().includes('database')) {
      return generateDatabasePaperText();
    } else if (filename.toLowerCase().includes('machine') || filename.toLowerCase().includes('learning')) {
      return generateMLPaperText();
    } else {
      return generateGenericPaperText(filename);
    }
  } else {
    // For uploaded documents, show actual metadata
    return `
Document: ${filename}

📄 DOCUMENT SUCCESSFULLY UPLOADED AND PROCESSED

Document Statistics:
- Filename: ${filename}
- Text Length: ${textLength} characters
- Sentences: ${sentenceCount} sentences
- Status: Ready for Analysis

🔍 HOW TO USE:
1. Ask questions about this document using the question panel on the right
2. The system will analyze the document and provide provenance-based answers
3. Evidence from the document will be highlighted in this viewer
4. Click through different provenance sources to see supporting evidence

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

  const generateDatabasePaperText = () => {
    return `
Research Paper: What Goes Around Comes Around... And Around...

ABSTRACT
Two decades ago, one of us co-authored a paper commenting on the previous 40 years of data modelling research and development. That paper demonstrated that the relational model (RM) and SQL are the prevailing choice for database management systems (DBMSs), despite efforts to replace either them.

INTRODUCTION
In 2005, one of the authors participated in writing a chapter for the Red Book titled "What Goes Around Comes Around". That paper examined the major data modelling movements since the 1960s including Hierarchical, Network, Relational, Entity-Relationship, Extended Relational, Semantic, Object-Oriented, Object-Relational, and Semi-structured systems.

BACKGROUND
The database field has witnessed numerous attempts to replace the relational model. Each new approach claimed to solve fundamental problems with existing systems, yet most eventually converged back to relational principles.

MAPREDUCE SYSTEMS
Google constructed their MapReduce (MR) framework in 2003 as a 'point solution' for processing its periodic crawl of the internet. At the time, Google had little expertise in DBMS technology, and they built MR to meet their crawl needs. In database terms, Map is a user-defined function (UDF) that performs computation and/or filtering while Reduce is a GROUP BY operation.

The MapReduce programming model became popular for processing large datasets across distributed computing clusters. However, it lacked many features that database users had come to expect, such as schema management, indexing, and declarative query languages.

NOSQL MOVEMENT  
The inability of OLTP RDBMSs to scale in the 2000s ushered in dozens of document DBMSs that marketed themselves using the catchphrase NoSQL. There were two marketing messages for such systems that resonated with developers. First, SQL and joins are slow, and one should use a "faster" lower-level, record-at-a-time interface. Second, ACID transactions are unnecessary for modern applications.

Many NoSQL systems initially rejected SQL entirely, promoting simpler key-value or document-based interfaces. However, over time, most NoSQL systems have gradually added SQL-like query languages and ACID transaction support.

COLUMNAR SYSTEMS
Over the last two decades, all vendors active in the data warehouse market have converted their offerings from a row store to a column store. This transition brought about significant changes in the design of DBMSs. Column stores are new DBMS implementations with specialized optimizers, executors, and storage formats.

Columnar storage provides significant advantages for analytical workloads, particularly those involving aggregations over large datasets. The compression ratios achievable with columnar storage often exceed those possible with row-oriented systems.

CONCLUSION
We predict that what goes around with databases will continue to come around in upcoming decades. Another wave of developers will claim that SQL and the RM are insufficient for emerging application domains. However, we do not expect these new data models to supplant the RM.

The pattern of innovation, differentiation, and eventual convergence appears to be a fundamental characteristic of the database field. New systems often start by rejecting established principles, but gradually adopt them as they mature.
    `;
  };

  const generateMLPaperText = () => {
    return `
Research Paper: Machine Learning Systems Architecture

ABSTRACT
This paper presents a comprehensive survey of modern machine learning system architectures, focusing on distributed training, inference optimization, and deployment strategies. We examine the evolution from single-node systems to large-scale distributed platforms.

INTRODUCTION
Machine learning systems have evolved significantly over the past decade. Early ML frameworks were designed for single-node execution, but the increasing scale of data and model complexity has driven the development of distributed systems.

DISTRIBUTED TRAINING
Modern deep learning models often require distributed training across multiple GPUs and nodes. Parameter servers and all-reduce architectures represent two dominant approaches to distributed training.

The parameter server architecture separates computation and storage, with dedicated parameter servers maintaining model state while worker nodes perform computation. This approach provides flexibility but can create communication bottlenecks.

All-reduce architectures, popularized by frameworks like Horovod, treat all nodes equally and use efficient reduction algorithms to synchronize gradients. This approach often provides better scaling characteristics for synchronous training.

INFERENCE OPTIMIZATION
Production ML systems must optimize for low latency and high throughput inference. Model optimization techniques include quantization, pruning, and knowledge distillation.

Quantization reduces model precision, typically from 32-bit floats to 8-bit integers, significantly reducing memory usage and computational requirements while maintaining acceptable accuracy.

DEPLOYMENT STRATEGIES
ML model deployment has evolved from simple batch processing to real-time serving systems. Container-based deployment using Docker and Kubernetes has become standard practice.

Model serving frameworks like TensorFlow Serving and TorchServe provide standardized APIs for model deployment, handling versioning, A/B testing, and monitoring.

CONCLUSION
The field of ML systems continues to evolve rapidly. Future systems will need to address challenges around model interpretability, fairness, and edge deployment while maintaining the scalability and performance requirements of modern applications.
    `;
  };

  const generateGenericPaperText = (filename) => {
    const title = filename.replace(/[-_]/g, ' ').replace('.pdf', '');
    return `
Research Paper: ${title}

ABSTRACT
This document represents an academic or research paper that has been uploaded to the provenance analysis system. The system will extract relevant text passages to answer questions about the content.

INTRODUCTION
This paper discusses various aspects of ${title.toLowerCase()}. The research methodology and findings are presented in the following sections.

METHODOLOGY
The research approach used in this study combines theoretical analysis with empirical evaluation. Data collection and analysis procedures are described in detail.

RESULTS
The key findings of this research are presented with supporting evidence and statistical analysis where appropriate.

DISCUSSION
The implications of these findings are discussed in the context of existing literature and future research directions.

CONCLUSION
This research contributes to the understanding of ${title.toLowerCase()} and provides insights for both academic researchers and practitioners in the field.

REFERENCES
[References would be listed here in a real academic paper]

Note: This is a placeholder text for demonstration purposes. In a production system, the actual PDF content would be displayed here with proper text extraction and formatting.
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

  const toggleHighlights = () => {
    setShowHighlights(!showHighlights);
  };

  

  const renderHighlightedText = () => {
    if (loading) return "LOADING_DOCUMENT...";
    if (error) return `ERROR: ${error}`;
    if (!pdfText) return "NO_CONTENT_AVAILABLE";

    // If no provenance selected or highlights disabled, return plain text
    if (!selectedProvenance || !selectedProvenance.content || !showHighlights) {
      return pdfText;
    }

    // Highlight the provenance content in the PDF text
    let result = pdfText;

    selectedProvenance.content.forEach((sentence, index) => {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence.length > 10) { // Only highlight substantial content
        try {
          // Create a more flexible regex that handles word boundaries and minor variations
          const words = trimmedSentence.split(/\s+/);
          if (words.length >= 3) {
            // For longer sentences, match the first few and last few words
            const firstWords = words.slice(0, 3).join('\\s+');
            const lastWords = words.slice(-3).join('\\s+');
            const pattern = `${escapeRegExp(firstWords)}[\\s\\S]*?${escapeRegExp(lastWords)}`;
            const regex = new RegExp(pattern, 'gi');

            result = result.replace(regex, (match) => {
              return `<mark class="pdf-highlight highlight-${index % 3}" title="Provenance Evidence ${index + 1}">${match}</mark>`;
            });
          } else {
            // For shorter sentences, match exactly
            const regex = new RegExp(escapeRegExp(trimmedSentence), 'gi');
            result = result.replace(regex, `<mark class="pdf-highlight highlight-${index % 3}" title="Provenance Evidence ${index + 1}">${trimmedSentence}</mark>`);
          }
        } catch (regexError) {
          console.warn('Regex error highlighting sentence:', regexError);
          // Fallback to simple text replacement
          const simpleRegex = new RegExp(escapeRegExp(trimmedSentence.substring(0, 50)), 'gi');
          result = result.replace(simpleRegex, `<mark class="pdf-highlight highlight-${index % 3}">${trimmedSentence.substring(0, 50)}</mark>`);
        }
      }
    });

    return result;
  };

  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const highlightTextInPDF = (searchText) => {
    if (!searchText) return;

    console.log('🔍 Attempting to highlight text:', searchText.substring(0, 100));

    // Clear existing highlights
    const existingHighlights = window.document.querySelectorAll('.provenance-highlight');
    existingHighlights.forEach(el => {
      el.classList.remove('provenance-highlight');
      el.style.backgroundColor = '';
      el.style.border = '';
    });

    // Clean the search text
    const cleanSearchText = searchText
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Try different selectors for PDF text
    const possibleSelectors = [
      '.textLayer span',           // PDF.js standard
      '.pdf-text-layer span',      // Custom PDF viewer
      '[data-pdf-text]',           // Custom attribute
      '.pdf-content p',            // Paragraph elements
      '.pdf-content div',          // Div elements
      'span',                      // All spans
      'p'                          // All paragraphs
    ];

    let foundMatch = false;

    for (const selector of possibleSelectors) {
      const elements = window.document.querySelectorAll(selector);
      console.log(`🔍 Checking ${elements.length} elements with selector: ${selector}`);

      elements.forEach((element, index) => {
        const elementText = element.textContent?.trim();
        if (elementText && cleanSearchText.includes(elementText) && elementText.length > 10) {
          element.style.backgroundColor = 'rgba(255, 255, 0, 0.6)';
          element.style.border = '2px solid #ffcc00';
          element.style.boxShadow = '0 0 4px rgba(255, 204, 0, 0.8)';
          element.classList.add('provenance-highlight');
          foundMatch = true;
          console.log('✅ Highlighted element:', elementText.substring(0, 50));
          
          // Scroll to the first match
          if (index === 0) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      });

      if (foundMatch) break;
    }

    if (!foundMatch) {
      console.log('❌ No matching text found in PDF for highlighting');
      
      // Debug: log what text we can find
      const allText = Array.from(window.document.querySelectorAll('span, p, div'))
        .map(el => el.textContent?.trim())
        .filter(text => text && text.length > 20)
        .slice(0, 10);
      
      console.log('🔍 Available text in PDF (first 10):', allText);
    }
  };

  return (
    <div className={"pdf-viewer"}>
      {/* Add debug info */}
      {selectedProvenance && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'yellow',
          padding: '5px',
          fontSize: '12px',
          zIndex: 1000,
          maxWidth: '200px'
        }}>
          🎯 Highlighting: {selectedProvenance.content?.[0]?.substring(0, 50)}...
        </div>
      )}
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

      <div className="pdf-content" ref={viewerRef}>
        {/* Provenance Legend */}
        {selectedProvenance && showHighlights && selectedProvenance.content && (
          <div className="highlight-legend">
            <h4>
              <FontAwesomeIcon icon={faHighlighter} />
              HIGHLIGHTED_PROVENANCE_EVIDENCE
            </h4>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-color highlight-0"></span>
                <span>PRIMARY_EVIDENCE</span>
              </div>
              <div className="legend-item">
                <span className="legend-color highlight-1"></span>
                <span>SUPPORTING_CONTEXT</span>
              </div>
              <div className="legend-item">
                <span className="legend-color highlight-2"></span>
                <span>RELATED_INFORMATION</span>
              </div>
            </div>

            <div className="provenance-summary">
              <div className="summary-item">
                <span className="summary-label">EVIDENCE_SEGMENTS:</span>
                <span className="summary-value">
                  {selectedProvenance.content.length}
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
      </div>
    </div>
  );
};

export default PDFViewer;