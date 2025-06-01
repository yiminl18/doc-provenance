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

  faSpinner,
  faChevronLeft,
  faChevronRight,
  faAlignLeft,
  faMapMarkedAlt
} from '@fortawesome/free-solid-svg-icons';
import '../styles/pdf-viewer.css'
import {PDFHighlightingDebugger} from './PDFHighlightingDebugger';
import { SentencePDFMapper } from '../utils/SentencePDFMapper';

const HybridPDFViewer = ({ pdfDocument, selectedProvenance, onClose, navigationTrigger }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isCreatingHighlights, setisCreatingHighlights] = useState(false);

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

  useEffect(() => {
  if (!highlightLayerRef.current) return;
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        if (mutation.removedNodes.length > 0) {
          console.log('🚨 HIGHLIGHT LAYER CHILDREN REMOVED:');
          mutation.removedNodes.forEach((node, index) => {
            console.log(`  Removed node ${index}:`, node);
          });
          console.trace(); // Show what caused the removal
        }
      }
    });
  });
  
  observer.observe(highlightLayerRef.current, {
    childList: true,
    subtree: true
  });
  
  return () => {
    observer.disconnect();
  };
}, []);

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
  
  // Add this debugging code to your HybridPDFViewer.js
// Place it in the loadSentenceMapping function

const loadSentenceMapping = async (pdf) => {
  try {
    //console.log('🔄 Starting sentence mapping...');
    //console.log('📄 PDF Document:', pdfDocument);
    //console.log('📋 Current sentences state:', sentences);
    //console.log('📋 Sentences length:', sentences?.length || 'undefined');
    //console.log('📋 Sentences type:', typeof sentences);
    
    // Use the backend filename to construct sentences filename
    const backendFilename = pdfDocument.filename;
    //console.log('📄 Backend filename:', backendFilename);
    
    const baseFilename = backendFilename.replace('.pdf', '');
    const sentencesFilename = `${baseFilename}_sentences.json`;
    
    //console.log('📝 Base filename:', baseFilename);
    //console.log('📋 Sentences filename:', sentencesFilename);
    
    // Use your existing file serving endpoint
    const sentencesResponse = await fetch(`/api/documents/${backendFilename}/sentences`);
    
    console.log('🌐 Sentences response status:', sentencesResponse.status);
    console.log('🌐 Sentences response ok:', sentencesResponse.ok);
    
    if (!sentencesResponse.ok) {
      throw new Error(`Sentences file not found: ${sentencesResponse.status}`);
    }
    
    const sentencesData = await sentencesResponse.json();
    //console.log('📄 Raw sentences response:', sentencesData);
    //console.log('📄 Response type:', typeof sentencesData);
    //console.log('📄 Response keys:', Object.keys(sentencesData || {}));
    
    // Check different possible structures
    let actualSentences = null;
    
    if (Array.isArray(sentencesData)) {
      console.log('📋 Sentences data is direct array');
      actualSentences = sentencesData;
    } else if (sentencesData.sentences && Array.isArray(sentencesData.sentences)) {
      console.log('📋 Sentences found in .sentences property');
      actualSentences = sentencesData.sentences;
    } else if (sentencesData.data && Array.isArray(sentencesData.data)) {
      console.log('📋 Sentences found in .data property');
      actualSentences = sentencesData.data;
    } else {
      console.error('❌ Could not find sentences array in response:', sentencesData);
      throw new Error('Invalid sentences data format - no array found');
    }
    
    console.log('✅ Found sentences:', actualSentences?.length || 0);
    if (actualSentences && actualSentences.length > 0) {
      console.log('📝 First few sentences:');
      actualSentences.slice(0, 3).forEach((sentence, i) => {
        console.log(`  ${i}: "${sentence?.substring(0, 80)}..."`);
      });
    }
    
    // Update the sentences state
    setSentences(actualSentences || []);
    console.log('🔄 Updated sentences state');
    
    // Initialize the sentence mapper with the actual sentences
    const mapper = new SentencePDFMapper();
    const result = await mapper.initialize(pdf, actualSentences || []);

    if (result.success) {
      setSentenceMapper(mapper);
      setMappingStats(mapper.getStatistics());
      console.log('✅ Sentence mapping completed:', result);
    } else {
      console.warn('⚠️ Sentence mapping failed:', result);
    }

  } catch (error) {
    console.error('❌ Complete sentence mapping error:', error);
    console.log('📄 PDF will work without sentence highlighting');
  }
};

  // Add effect to handle navigation triggers
  useEffect(() => {
    if (navigationTrigger && sentenceMapper && navigationTrigger.sentenceId) {
      console.log(`🎯 PDF Viewer: Handling navigation trigger: ${navigationTrigger}`);

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
    if (pdfDoc && !loading && !isCreatingHighlights) {
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
  }, [pdfDoc, loading, currentPage, zoomLevel]);

useEffect(() => {
  if (selectedProvenance && textLayerRef.current && highlightLayerRef.current && !isCreatingHighlights) {
    console.log('🔄 Provenance changed, updating highlights after delay...');
    
    // Add delay to ensure PDF text layer is ready
    const highlightTimeout = setTimeout(() => {
      console.log('✨ Adding provenance highlights...');
      setisCreatingHighlights(true);
      addProvenanceOverlays();
      
      // Reset highlighting flag after completion
      setTimeout(() => {
        setisCreatingHighlights(false);
      }, 2000);
    }, 1200);
    
    return () => {
      clearTimeout(highlightTimeout);
    };
  }
}, [selectedProvenance, currentPage]); // Only trigger on provenance changes

// Enhanced highlighting that responds to zoom changes and follows text structure
// Add these to your HybridPDFViewer.js

// Add this useEffect to re-highlight when zoom changes
useEffect(() => {
  if (selectedProvenance && textLayerRef.current && highlightLayerRef.current && !isCreatingHighlights) {
    console.log('🔍 Zoom changed, re-highlighting at new scale...');
    
    // Add delay to ensure text layer has re-rendered at new zoom
    const zoomTimeout = setTimeout(() => {
      setisCreatingHighlights(true);
      addProvenanceOverlays();
      
      setTimeout(() => {
        setisCreatingHighlights(false);
      }, 1500);
    }, 800); // Wait for text layer to settle
    
    return () => {
      clearTimeout(zoomTimeout);
    };
  }
}, [zoomLevel]); // React to zoom level changes

/**
 * Sequential highlighting that finds text in reading order
 */
const createSequentialHighlight = (sentenceText, sentenceId, index) => {
  console.log(`📖 Creating sequential highlight for: "${sentenceText.substring(0, 50)}..."`);
  
  const textSpans = textLayerRef.current.querySelectorAll('span, div');
  const cleanSentence = cleanTextForMatching(sentenceText);
  const words = cleanSentence.split(/\s+/).filter(word => word.length > 2);
  
  console.log(`🔍 Looking for ${words.length} words in ${textSpans.length} spans`);
  
  // Strategy 1: Find consecutive word sequences
  const wordSequences = findConsecutiveWordSequences(words, textSpans);
  
  if (wordSequences.length > 0) {
    console.log(`✅ Found ${wordSequences.length} word sequences`);
    wordSequences.forEach((sequence, seqIndex) => {
      createZoomResponsiveHighlight(sequence.spans, sentenceId, index, seqIndex, sequence.confidence);
    });
    return;
  }
  
  // Strategy 2: Find word clusters in reading order
  const wordClusters = findSequentialWordClusters(words, textSpans);
  
  if (wordClusters.length > 0) {
    console.log(`✅ Found ${wordClusters.length} word clusters`);
    wordClusters.forEach((cluster, clusterIndex) => {
      createZoomResponsiveHighlight(cluster.spans, sentenceId, index, clusterIndex, cluster.confidence);
    });
    return;
  }
  
  // Strategy 3: Fallback to individual important words
  console.log(`⚠️ Using fallback highlighting for sentence ${sentenceId}`);
  createFallbackSequentialHighlight(words.slice(0, 3), textSpans, sentenceId, index);
};

/**
 * Find consecutive sequences of words in the PDF
 */
const findConsecutiveWordSequences = (words, textSpans) => {
  const sequences = [];
  const spansArray = Array.from(textSpans);
  
  // For each possible starting word
  for (let wordStart = 0; wordStart < words.length - 1; wordStart++) {
    for (let wordEnd = wordStart + 2; wordEnd <= Math.min(wordStart + 8, words.length); wordEnd++) {
      const wordSequence = words.slice(wordStart, wordEnd);
      
      // Try to find this sequence in consecutive spans
      const sequenceSpans = findSpansForWordSequence(wordSequence, spansArray);
      
      if (sequenceSpans.length > 0) {
        sequences.push({
          spans: sequenceSpans,
          words: wordSequence,
          confidence: wordSequence.length / words.length,
          startWord: wordStart,
          endWord: wordEnd
        });
      }
    }
  }
  
  // Sort by confidence and remove overlaps
  const sortedSequences = sequences.sort((a, b) => b.confidence - a.confidence);
  return removeOverlappingSequences(sortedSequences).slice(0, 3); // Max 3 sequences
};

/**
 * Find spans that contain a sequence of words in order
 */
const findSpansForWordSequence = (wordSequence, spansArray) => {
  const sequenceSpans = [];
  
  for (let startSpanIndex = 0; startSpanIndex < spansArray.length - wordSequence.length + 1; startSpanIndex++) {
    const candidateSpans = [];
    let wordIndex = 0;
    let spanIndex = startSpanIndex;
    
    // Try to match words in sequence
    while (wordIndex < wordSequence.length && spanIndex < spansArray.length) {
      const span = spansArray[spanIndex];
      const spanText = cleanTextForMatching(span.textContent);
      const currentWord = wordSequence[wordIndex];
      
      if (spanText.includes(currentWord)) {
        candidateSpans.push(span);
        wordIndex++;
        
        // If we found all words in sequence
        if (wordIndex === wordSequence.length) {
          return candidateSpans;
        }
      } else if (candidateSpans.length > 0) {
        // Break sequence if we can't find the next word nearby
        if (spanIndex - startSpanIndex > 10) { // Don't search too far
          break;
        }
      }
      
      spanIndex++;
    }
  }
  
  return [];
};

/**
 * Find word clusters that maintain reading order
 */
const findSequentialWordClusters = (words, textSpans) => {
  const clusters = [];
  const spansArray = Array.from(textSpans);
  
  // Sort spans by position (top to bottom, left to right)
  const sortedSpans = spansArray.sort((a, b) => {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    
    // First sort by Y (top to bottom)
    const yDiff = rectA.top - rectB.top;
    if (Math.abs(yDiff) > 10) { // Different lines
      return yDiff;
    }
    
    // Then sort by X (left to right)
    return rectA.left - rectB.left;
  });
  
  // Find clusters of nearby spans that contain our words
  let currentCluster = [];
  let wordsFound = new Set();
  
  for (const span of sortedSpans) {
    const spanText = cleanTextForMatching(span.textContent);
    const matchingWords = words.filter(word => spanText.includes(word) && !wordsFound.has(word));
    
    if (matchingWords.length > 0) {
      currentCluster.push(span);
      matchingWords.forEach(word => wordsFound.add(word));
      
      // If cluster gets too spread out, start a new one
      if (currentCluster.length > 1) {
        const clusterSpread = calculateClusterSpread(currentCluster);
        if (clusterSpread > 200) { // pixels
          // Finish current cluster if it has enough words
          if (wordsFound.size >= 2) {
            clusters.push({
              spans: [...currentCluster.slice(0, -1)], // Exclude the span that made it too spread
              confidence: wordsFound.size / words.length,
              wordsFound: wordsFound.size
            });
          }
          
          // Start new cluster
          currentCluster = [span];
          wordsFound = new Set(matchingWords);
        }
      }
    }
    
    // If we found most words, finish the cluster
    if (wordsFound.size >= Math.min(words.length * 0.6, 5)) {
      clusters.push({
        spans: [...currentCluster],
        confidence: wordsFound.size / words.length,
        wordsFound: wordsFound.size
      });
      break;
    }
  }
  
  // Add final cluster if it has enough words
  if (currentCluster.length > 0 && wordsFound.size >= 2) {
    clusters.push({
      spans: [...currentCluster],
      confidence: wordsFound.size / words.length,
      wordsFound: wordsFound.size
    });
  }
  
  return clusters.sort((a, b) => b.confidence - a.confidence);
};

/**
 * Calculate how spread out a cluster of spans is
 */
const calculateClusterSpread = (spans) => {
  if (spans.length <= 1) return 0;
  
  const rects = spans.map(span => span.getBoundingClientRect());
  const minX = Math.min(...rects.map(r => r.left));
  const maxX = Math.max(...rects.map(r => r.right));
  const minY = Math.min(...rects.map(r => r.top));
  const maxY = Math.max(...rects.map(r => r.bottom));
  
  return Math.max(maxX - minX, maxY - minY);
};

/**
 * Remove overlapping sequences to avoid duplicate highlights
 */
const removeOverlappingSequences = (sequences) => {
  const nonOverlapping = [];
  const usedSpans = new Set();
  
  for (const sequence of sequences) {
    const hasOverlap = sequence.spans.some(span => usedSpans.has(span));
    
    if (!hasOverlap) {
      nonOverlapping.push(sequence);
      sequence.spans.forEach(span => usedSpans.add(span));
    }
  }
  
  return nonOverlapping;
};

/**
 * Create zoom-responsive highlight that scales with PDF
 */
const createZoomResponsiveHighlight = (spans, sentenceId, index, subIndex = 0, confidence = 1.0) => {
  if (!spans || spans.length === 0) return;
  
  console.log(`🎨 Creating zoom-responsive highlight for ${spans.length} spans (confidence: ${confidence.toFixed(2)})`);
  
  // Calculate bounding box
  const boundingBox = calculateTightBoundingBox(spans);
  if (!boundingBox) {
    console.warn('⚠️ Could not calculate bounding box');
    return;
  }
  
  // Validate size
  if (boundingBox.width < 5 || boundingBox.height < 5) {
    console.log('⚠️ Bounding box too small, skipping');
    return;
  }
  
  if (boundingBox.width > 600 || boundingBox.height > 100) {
    console.log('⚠️ Bounding box too large, trying to split');
    // Try to split large highlights
    if (spans.length > 2) {
      const midPoint = Math.floor(spans.length / 2);
      createZoomResponsiveHighlight(spans.slice(0, midPoint), sentenceId, index, subIndex, confidence);
      createZoomResponsiveHighlight(spans.slice(midPoint), sentenceId, index, subIndex + 0.5, confidence);
      return;
    }
  }
  
  const overlay = document.createElement('div');
  overlay.className = 'provenance-overlay zoom-responsive-overlay';
  overlay.setAttribute('data-sentence-id', sentenceId);
  overlay.setAttribute('data-index', index);
  overlay.setAttribute('data-sub-index', subIndex);
  overlay.setAttribute('data-confidence', confidence.toFixed(2));
  
  // Choose color based on confidence
  const colors = [
    { bg: 'rgba(255, 193, 7, 0.4)', border: 'rgba(255, 193, 7, 0.9)' },    // High confidence - Yellow
    { bg: 'rgba(40, 167, 69, 0.4)', border: 'rgba(40, 167, 69, 0.9)' },    // Medium-high - Green
    { bg: 'rgba(0, 123, 255, 0.4)', border: 'rgba(0, 123, 255, 0.9)' },    // Medium - Blue
    { bg: 'rgba(255, 102, 0, 0.4)', border: 'rgba(255, 102, 0, 0.9)' },    // Low-medium - Orange
    { bg: 'rgba(111, 66, 193, 0.4)', border: 'rgba(111, 66, 193, 0.9)' }   // Low - Purple
  ];
  
  const colorIndex = Math.min(Math.floor((1 - confidence) * colors.length), colors.length - 1);
  const color = colors[colorIndex];
  
  // Adjust opacity based on confidence
  const opacity = Math.max(0.3, confidence);
  const adjustedBg = color.bg.replace(/[\d.]+\)$/, `${opacity * 0.4})`);
  const adjustedBorder = color.border.replace(/[\d.]+\)$/, `${opacity})`);
  
  overlay.style.cssText = `
    position: absolute;
    left: ${boundingBox.left}px;
    top: ${boundingBox.top}px;
    width: ${boundingBox.width}px;
    height: ${boundingBox.height}px;
    background-color: ${adjustedBg};
    border: 2px solid ${adjustedBorder};
    border-radius: 3px;
    z-index: 500;
    pointer-events: auto;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    opacity: 0;
  `;
  
  // Add confidence indicator in tooltip
  overlay.title = `Evidence ${index + 1}${subIndex ? ` (part ${Math.floor(subIndex) + 1})` : ''} - Sentence ${sentenceId}\nConfidence: ${(confidence * 100).toFixed(0)}%\nClick to focus`;
  
  // Enhanced click handler
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 Clicked zoom-responsive evidence overlay for sentence ${sentenceId}`);
    
    // Visual feedback
    overlay.style.transform = 'scale(1.05)';
    overlay.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3)';
    setTimeout(() => {
      overlay.style.transform = 'scale(1)';
      overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    }, 200);
  });
  
  // Enhanced hover effects
  overlay.addEventListener('mouseenter', () => {
    overlay.style.transform = 'scale(1.02)';
    overlay.style.zIndex = '600';
    overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
  });

  overlay.addEventListener('mouseleave', () => {
    overlay.style.transform = 'scale(1)';
    overlay.style.zIndex = '500';
    overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
  });
  
  // Add to highlight layer
  highlightLayerRef.current.appendChild(overlay);
  
  // Animate in with stagger based on confidence
  const animationDelay = 50 + (index * 100) + (subIndex * 50) + ((1 - confidence) * 200);
  setTimeout(() => {
    overlay.style.opacity = '1';
    
    // Subtle entrance animation
    setTimeout(() => {
      overlay.style.transform = 'scale(1.03)';
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
      }, 150);
    }, 100);
  }, animationDelay);
  
  console.log(`✅ Zoom-responsive overlay created: ${boundingBox.width}x${boundingBox.height} at (${boundingBox.left}, ${boundingBox.top})`);
};

/**
 * Fallback highlighting for individual words
 */
const createFallbackSequentialHighlight = (importantWords, textSpans, sentenceId, index) => {
  console.log(`🆘 Creating fallback sequential highlights for ${importantWords.length} words`);
  
  let wordIndex = 0;
  for (const word of importantWords) {
    for (const span of textSpans) {
      const spanText = cleanTextForMatching(span.textContent);
      if (spanText.includes(word)) {
        createZoomResponsiveHighlight([span], sentenceId, index, wordIndex, 0.3);
        wordIndex++;
        break; // Only highlight first occurrence of each word
      }
    }
  }
};



  const renderPageWithProvenance = async (pageNum) => {
    if (!pdfDoc || !canvasRef.current) return;

    try {
      console.log(`🔄 Rendering page ${pageNum} with provenance overlay...`);

      const page = await pdfDoc.getPage(pageNum);
      // ENHANCEMENT 1: Use device pixel ratio for crisp rendering
      const devicePixelRatio = window.devicePixelRatio || 1;
      const scaleFactor = zoomLevel * devicePixelRatio;
      
      const viewport = page.getViewport({ scale: scaleFactor });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      // ENHANCEMENT 2: Set canvas size properly for high DPI
      //canvas.style.width = `${viewport.width / devicePixelRatio}px`;
      //canvas.style.height = `${viewport.height / devicePixelRatio}px`;
      //canvas.width = viewport.width;
      //canvas.height = viewport.height;

      // ENHANCEMENT 3: Disable image smoothing for crisp text
      //context.imageSmoothingEnabled = false;
      //context.webkitImageSmoothingEnabled = false;
      //context.mozImageSmoothingEnabled = false;
      //context.msImageSmoothingEnabled = false;

      // ENHANCEMENT 4: Scale context for device pixel ratio
      //context.scale(devicePixelRatio, devicePixelRatio);

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



      console.log(`✅ Page ${pageNum} rendered`);

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

const addProvenanceOverlays = () => {
  console.log('🎯 Starting enhanced overlay creation...');
  
  if (!selectedProvenance || !textLayerRef.current || !highlightLayerRef.current) {
    console.warn('⚠️ Missing required refs for highlighting');
    return;
  }

  // Clear existing overlays
  clearHighlights();

  const highlightSentenceIds = selectedProvenance.sentences_ids || selectedProvenance.provenance_ids || [];
  
  console.log('🔍 Sentence IDs to highlight:', highlightSentenceIds);

  if (highlightSentenceIds.length === 0) {
    console.warn('⚠️ No sentence IDs found for highlighting');
    return;
  }

  // Wait for clearing animation to complete
  setTimeout(() => {
    console.log('🎨 Adding enhanced overlays...');
    
    // Create highlights for each sentence
    highlightSentenceIds.forEach((sentenceId, index) => {
      console.log(`🔍 Processing sentence ID ${sentenceId} (index ${index})`);
      
      let sentenceText = null;
      
      if (selectedProvenance.content && selectedProvenance.content[index]) {
        sentenceText = selectedProvenance.content[index];
      } else if (sentences && sentences[sentenceId]) {
        sentenceText = sentences[sentenceId];
      }
      
      if (sentenceText) {
        createSequentialHighlight(sentenceText, sentenceId, index);
      } else {
        console.warn(`⚠️ No text found for sentence ${sentenceId}`);
        createFallbackSequentialHighlight(sentenceId, index);
      }
    });
    
  }, 400);
};

/**
 * Create a test overlay to verify the highlighting system works at all
 */
const createTestOverlay = () => {
  console.log('🧪 Creating truly persistent test overlay...');
  
  const testOverlay = document.createElement('div');
  testOverlay.className = 'persistent-test-overlay';
  testOverlay.style.cssText = `
    position: absolute;
    top: 20px;
    left: 20px;
    width: 280px;
    height: 40px;
    background-color: rgba(0, 200, 0, 0.8);
    border: 3px solid lime;
    z-index: 1500;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    font-size: 14px;
    pointer-events: none;
    border-radius: 5px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  testOverlay.innerHTML = '🟢 TRULY PERSISTENT TEST OVERLAY';
  
  highlightLayerRef.current.appendChild(testOverlay);
  console.log('✅ Truly persistent test overlay added');
  
  // Add click handler to manually remove it
  testOverlay.addEventListener('click', () => {
    testOverlay.remove();
    console.log('🗑️ Test overlay manually removed');
  });
};

/**
 * Calculate a simple bounding box from spans
 */
const calculateSimpleBoundingBox = (spans) => {
  if (spans.length === 0) return null;
  
  try {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    spans.forEach(span => {
      const rect = span.getBoundingClientRect();
      const containerRect = textLayerRef.current.getBoundingClientRect();
      
      // Convert to container-relative coordinates
      const left = rect.left - containerRect.left;
      const top = rect.top - containerRect.top;
      const right = left + rect.width;
      const bottom = top + rect.height;
      
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
    });
    
    // Add some padding
    const padding = 5;
    
    return {
      left: Math.max(0, minX - padding),
      top: Math.max(0, minY - padding),
      width: (maxX - minX) + (padding * 2),
      height: (maxY - minY) + (padding * 2)
    };
  } catch (error) {
    console.error('❌ Error calculating bounding box:', error);
    return null;
  }
};

const createEnhancedHighlight = (sentenceText, sentenceId, index) => {
  console.log(`🎨 Creating enhanced highlight for: "${sentenceText.substring(0, 50)}..."`);
  
  const textSpans = textLayerRef.current.querySelectorAll('span, div');
  const cleanSentence = cleanTextForMatching(sentenceText);
  
  // Strategy 1: Look for exact phrase matches first
  const phraseMatches = findExactPhraseMatches(cleanSentence, textSpans);
  
  if (phraseMatches.length > 0) {
    console.log(`✅ Found ${phraseMatches.length} phrase matches`);
    phraseMatches.forEach((match, matchIndex) => {
      createTightHighlightOverlay(match.spans, sentenceId, index, matchIndex);
    });
    return;
  }
  
  // Strategy 2: Word cluster matching
  const wordClusters = findWordClusters(cleanSentence, textSpans);
  
  if (wordClusters.length > 0) {
    console.log(`✅ Found ${wordClusters.length} word clusters`);
    wordClusters.forEach((cluster, clusterIndex) => {
      createTightHighlightOverlay(cluster.spans, sentenceId, index, clusterIndex);
    });
    return;
  }
  
  // Strategy 3: Fallback to individual word highlights
  console.log(`⚠️ Using individual word highlights for sentence ${sentenceId}`);
  createIndividualWordHighlights(cleanSentence, textSpans, sentenceId, index);
};

/**
 * Find exact phrase matches in the PDF text
 */
const findExactPhraseMatches = (cleanSentence, textSpans) => {
  const matches = [];
  const words = cleanSentence.split(/\s+/).filter(word => word.length > 2);
  
  // Try different phrase lengths
  for (let phraseLength = Math.min(8, words.length); phraseLength >= 4; phraseLength--) {
    for (let i = 0; i <= words.length - phraseLength; i++) {
      const phrase = words.slice(i, i + phraseLength).join(' ');
      const matchingSpans = findConsecutiveSpansForPhrase(phrase, textSpans);
      
      if (matchingSpans.length > 0) {
        matches.push({
          phrase: phrase,
          spans: matchingSpans,
          confidence: phraseLength / words.length
        });
      }
    }
  }
  
  // Return best matches (highest confidence)
  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
};

/**
 * Find consecutive spans that match a phrase
 */
const findConsecutiveSpansForPhrase = (phrase, textSpans) => {
  const phraseWords = phrase.split(/\s+/);
  const matchingSpans = [];
  
  for (let startIdx = 0; startIdx < textSpans.length - phraseWords.length + 1; startIdx++) {
    const candidateSpans = [];
    let wordIndex = 0;
    
    // Check if consecutive spans contain our phrase words
    for (let spanIdx = startIdx; spanIdx < textSpans.length && wordIndex < phraseWords.length; spanIdx++) {
      const span = textSpans[spanIdx];
      const spanText = cleanTextForMatching(span.textContent);
      
      if (spanText.includes(phraseWords[wordIndex])) {
        candidateSpans.push(span);
        wordIndex++;
        
        // If we found all words in consecutive spans
        if (wordIndex === phraseWords.length) {
          return candidateSpans;
        }
      } else if (candidateSpans.length > 0) {
        // Break the sequence if we don't find the next word
        break;
      }
    }
  }
  
  return [];
};

/**
 * Find clusters of spans that contain many words from our sentence
 */
const findWordClusters = (cleanSentence, textSpans) => {
  const words = cleanSentence.split(/\s+/).filter(word => word.length > 2);
  const spanWordMap = new Map();
  
  // Map each span to the words it contains
  textSpans.forEach((span, spanIndex) => {
    const spanText = cleanTextForMatching(span.textContent);
    const matchingWords = words.filter(word => spanText.includes(word));
    
    if (matchingWords.length > 0) {
      spanWordMap.set(span, {
        words: matchingWords,
        index: spanIndex,
        text: spanText
      });
    }
  });
  
  // Find clusters of nearby spans
  const clusters = [];
  const usedSpans = new Set();
  
  for (const [span, spanInfo] of spanWordMap) {
    if (usedSpans.has(span)) continue;
    
    const cluster = findNearbySpans(span, spanWordMap, usedSpans);
    
    if (cluster.spans.length > 0 && cluster.totalWords > words.length * 0.3) {
      clusters.push(cluster);
    }
  }
  
  return clusters.sort((a, b) => b.totalWords - a.totalWords);
};

/**
 * Find spans that are spatially close to a given span
 */
const findNearbySpans = (centerSpan, spanWordMap, usedSpans) => {
  const centerRect = centerSpan.getBoundingClientRect();
  const containerRect = textLayerRef.current.getBoundingClientRect();
  
  const nearbySpans = [centerSpan];
  let totalWords = spanWordMap.get(centerSpan).words.length;
  usedSpans.add(centerSpan);
  
  const maxDistance = 100; // pixels
  
  for (const [span, spanInfo] of spanWordMap) {
    if (usedSpans.has(span)) continue;
    
    const spanRect = span.getBoundingClientRect();
    
    // Calculate distance between centers
    const centerX = centerRect.left + centerRect.width / 2 - containerRect.left;
    const centerY = centerRect.top + centerRect.height / 2 - containerRect.top;
    const spanX = spanRect.left + spanRect.width / 2 - containerRect.left;
    const spanY = spanRect.top + spanRect.height / 2 - containerRect.top;
    
    const distance = Math.sqrt(Math.pow(centerX - spanX, 2) + Math.pow(centerY - spanY, 2));
    
    if (distance <= maxDistance) {
      nearbySpans.push(span);
      totalWords += spanInfo.words.length;
      usedSpans.add(span);
    }
  }
  
  return {
    spans: nearbySpans,
    totalWords: totalWords
  };
};

/**
 * Create individual highlights for important words when phrases don't work
 */
const createIndividualWordHighlights = (cleanSentence, textSpans, sentenceId, index) => {
  const importantWords = cleanSentence.split(/\s+/)
    .filter(word => word.length > 4) // Only longer words
    .slice(0, 5); // Limit to first 5 important words
  
  importantWords.forEach((word, wordIndex) => {
    textSpans.forEach(span => {
      const spanText = cleanTextForMatching(span.textContent);
      if (spanText.includes(word)) {
        createTightHighlightOverlay([span], sentenceId, index, wordIndex, true);
      }
    });
  });
};

/**
 * Create a tight highlight overlay for a group of spans
 */
const createTightHighlightOverlay = (spans, sentenceId, index, subIndex = 0, isWordHighlight = false) => {
  if (!spans || spans.length === 0) return;
  
  console.log(`🎨 Creating tight overlay for ${spans.length} spans`);
  
  // Calculate tight bounding box
  const boundingBox = calculateTightBoundingBox(spans);
  if (!boundingBox) return;
  
  // Don't create highlights that are too small or too large
  if (boundingBox.width < 10 || boundingBox.height < 10) {
    console.log('⚠️ Bounding box too small, skipping');
    return;
  }
  
  if (boundingBox.width > 800 || boundingBox.height > 200) {
    console.log('⚠️ Bounding box too large, trying to split');
    // Try to split large highlights into smaller ones
    if (spans.length > 3) {
      const midPoint = Math.floor(spans.length / 2);
      createTightHighlightOverlay(spans.slice(0, midPoint), sentenceId, index, subIndex, isWordHighlight);
      createTightHighlightOverlay(spans.slice(midPoint), sentenceId, index, subIndex + 0.5, isWordHighlight);
      return;
    }
  }
  
  const overlay = document.createElement('div');
  overlay.className = `provenance-overlay tight-overlay ${isWordHighlight ? 'word-highlight' : 'phrase-highlight'}`;
  overlay.setAttribute('data-sentence-id', sentenceId);
  overlay.setAttribute('data-index', index);
  overlay.setAttribute('data-sub-index', subIndex);
  
  // Enhanced styling
  const colors = [
    { bg: 'rgba(255, 193, 7, 0.3)', border: 'rgba(255, 193, 7, 0.8)' },    // Yellow
    { bg: 'rgba(40, 167, 69, 0.3)', border: 'rgba(40, 167, 69, 0.8)' },    // Green
    { bg: 'rgba(0, 123, 255, 0.3)', border: 'rgba(0, 123, 255, 0.8)' },    // Blue
    { bg: 'rgba(255, 102, 0, 0.3)', border: 'rgba(255, 102, 0, 0.8)' },    // Orange
    { bg: 'rgba(111, 66, 193, 0.3)', border: 'rgba(111, 66, 193, 0.8)' }   // Purple
  ];
  
  const colorIndex = index % colors.length;
  const color = colors[colorIndex];
  
  overlay.style.cssText = `
    position: absolute;
    left: ${boundingBox.left}px;
    top: ${boundingBox.top}px;
    width: ${boundingBox.width}px;
    height: ${boundingBox.height}px;
    background-color: ${color.bg};
    border: 2px solid ${color.border};
    border-radius: 3px;
    z-index: 500;
    pointer-events: auto;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    opacity: 0;
  `;
  
  // Adjust styling for word highlights
  if (isWordHighlight) {
    overlay.style.borderStyle = 'dashed';
    overlay.style.borderWidth = '1px';
    overlay.style.backgroundColor = `${color.bg.replace('0.3', '0.2')}`;
  }
  
  overlay.title = `Evidence ${index + 1}${subIndex ? ` (part ${Math.floor(subIndex) + 1})` : ''} - Sentence ${sentenceId}`;
  
  // Click handler
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 Clicked evidence overlay for sentence ${sentenceId}`);
    
    // Visual feedback
    overlay.style.transform = 'scale(1.05)';
    setTimeout(() => {
      overlay.style.transform = 'scale(1)';
    }, 200);
  });
  
  // Hover effects
  overlay.addEventListener('mouseenter', () => {
    overlay.style.transform = 'scale(1.02)';
    overlay.style.zIndex = '600';
    overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
  });

  overlay.addEventListener('mouseleave', () => {
    overlay.style.transform = 'scale(1)';
    overlay.style.zIndex = '500';
    overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
  });
  
  // Add to highlight layer
  highlightLayerRef.current.appendChild(overlay);
  
  // Animate in
  setTimeout(() => {
    overlay.style.opacity = '1';
  }, 50 + (index * 100) + (subIndex * 50));
  
  console.log(`✅ Tight overlay created for sentence ${sentenceId} (${boundingBox.width}x${boundingBox.height})`);
};

/**
 * Calculate a much tighter bounding box
 */
const calculateTightBoundingBox = (spans) => {
  if (spans.length === 0) return null;
  
  try {
    const containerRect = textLayerRef.current.getBoundingClientRect();
    const rects = [];
    
    // Get individual character rectangles when possible
    spans.forEach(span => {
      const spanRect = span.getBoundingClientRect();
      
      // Convert to container-relative coordinates
      const relativeRect = {
        left: spanRect.left - containerRect.left,
        top: spanRect.top - containerRect.top,
        right: spanRect.right - containerRect.left,
        bottom: spanRect.bottom - containerRect.top,
        width: spanRect.width,
        height: spanRect.height
      };
      
      // Only include rects that have actual content
      if (relativeRect.width > 0 && relativeRect.height > 0) {
        rects.push(relativeRect);
      }
    });
    
    if (rects.length === 0) return null;
    
    // Group rects by line (similar Y coordinates)
    const lines = groupRectsByLine(rects);
    
    // Create individual highlights for each line if there are multiple lines
    if (lines.length > 1) {
      // For now, just highlight the first line to avoid huge boxes
      const firstLine = lines[0];
      return calculateLineBox(firstLine);
    } else {
      // Single line - create tight box
      return calculateLineBox(rects);
    }
    
  } catch (error) {
    console.error('❌ Error calculating tight bounding box:', error);
    return null;
  }
};

/**
 * Group rectangles by line based on Y coordinates
 */
const groupRectsByLine = (rects) => {
  const lines = [];
  const lineThreshold = 5; // pixels - rects within this Y distance are on same line
  
  rects.forEach(rect => {
    let addedToLine = false;
    
    for (const line of lines) {
      const lineY = line[0].top;
      if (Math.abs(rect.top - lineY) <= lineThreshold) {
        line.push(rect);
        addedToLine = true;
        break;
      }
    }
    
    if (!addedToLine) {
      lines.push([rect]);
    }
  });
  
  // Sort each line by X coordinate
  lines.forEach(line => {
    line.sort((a, b) => a.left - b.left);
  });
  
  return lines;
};

/**
 * Calculate bounding box for rects on the same line
 */
const calculateLineBox = (rects) => {
  if (rects.length === 0) return null;
  
  const minLeft = Math.min(...rects.map(r => r.left));
  const maxRight = Math.max(...rects.map(r => r.right));
  const minTop = Math.min(...rects.map(r => r.top));
  const maxBottom = Math.max(...rects.map(r => r.bottom));
  
  // Add small padding
  const padding = 2;
  
  return {
    left: Math.max(0, minLeft - padding),
    top: Math.max(0, minTop - padding),
    width: (maxRight - minLeft) + (padding * 2),
    height: (maxBottom - minTop) + (padding * 2)
  };
};

/**
 * Enhanced fallback highlight
 */
const createFallbackHighlight = (sentenceId, index) => {
  console.log(`🆘 Creating enhanced fallback highlight for sentence ${sentenceId}`);
  
  const fallbackBox = {
    left: 50,
    top: 50 + (index * 50),
    width: 250,
    height: 30
  };
  
  createTightHighlightOverlay([{ getBoundingClientRect: () => ({
    left: fallbackBox.left,
    top: fallbackBox.top,
    right: fallbackBox.left + fallbackBox.width,
    bottom: fallbackBox.top + fallbackBox.height,
    width: fallbackBox.width,
    height: fallbackBox.height
  })}], sentenceId, index, 0, false);
};

// Export the improved functions for debugging
if (process.env.NODE_ENV === 'development') {
  window.debugEnhancedHighlighting = () => {
    console.log('🔧 Testing enhanced highlighting...');
    if (selectedProvenance) {
      addProvenanceOverlays();
    } else {
      console.log('❌ No selected provenance to test');
    }
  };
}

// 5. New persistent highlight function (no auto-removal)
const createPersistentHighlight = (sentenceText, sentenceId, index) => {
  console.log(`🎨 Creating persistent highlight for: "${sentenceText.substring(0, 50)}..."`);
  
  const textSpans = textLayerRef.current.querySelectorAll('span, div');
  console.log(`📄 Found ${textSpans.length} text spans to search`);
  
  const cleanSentence = sentenceText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const sentenceWords = cleanSentence.split(' ').filter(word => word.length > 2).slice(0, 10);
  
  console.log('🔍 Looking for words:', sentenceWords);
  
  let matchingSpans = [];
  
  // Look for spans containing our words
  textSpans.forEach(span => {
    const spanText = span.textContent.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (spanText.length < 3) return;
    
    const matchingWords = sentenceWords.filter(word => spanText.includes(word));
    
    if (matchingWords.length >= 2) {
      matchingSpans.push(span);
      console.log(`📍 Found matching span: "${spanText}" (${matchingWords.length} words matched)`);
    }
  });
  
  // Create overlay for matching spans
  if (matchingSpans.length > 0) {
    const boundingBox = calculateSimpleBoundingBox(matchingSpans);
    if (boundingBox) {
      createPersistentHighlightOverlay(boundingBox, sentenceId, index);
      console.log(`✅ Created persistent highlight overlay for sentence ${sentenceId}`);
    } else {
      console.warn(`⚠️ Could not calculate bounding box for sentence ${sentenceId}`);
      createPersistentFallbackHighlight(sentenceId, index);
    }
  } else {
    console.warn(`⚠️ No matching spans found for sentence ${sentenceId}`);
    createPersistentFallbackHighlight(sentenceId, index);
  }
};

// 6. Persistent highlight overlay (no timeout removal)
const createPersistentHighlightOverlay = (boundingBox, sentenceId, index) => {
  console.log(`🎨 Creating persistent overlay at:`, boundingBox);
  
  const overlay = document.createElement('div');
  overlay.className = 'provenance-overlay persistent-overlay';
  overlay.setAttribute('data-sentence-id', sentenceId);
  overlay.setAttribute('data-index', index);
  
  const colors = [
    { bg: 'rgba(255, 193, 7, 0.4)', border: 'rgba(255, 193, 7, 0.9)' },    // Yellow
    { bg: 'rgba(40, 167, 69, 0.4)', border: 'rgba(40, 167, 69, 0.9)' },    // Green
    { bg: 'rgba(0, 123, 255, 0.4)', border: 'rgba(0, 123, 255, 0.9)' },    // Blue
    { bg: 'rgba(255, 102, 0, 0.4)', border: 'rgba(255, 102, 0, 0.9)' },    // Orange
    { bg: 'rgba(111, 66, 193, 0.4)', border: 'rgba(111, 66, 193, 0.9)' }   // Purple
  ];
  
  const color = colors[index % colors.length];
  
  overlay.style.cssText = `
    position: absolute;
    left: ${boundingBox.left}px;
    top: ${boundingBox.top}px;
    width: ${boundingBox.width}px;
    height: ${boundingBox.height}px;
    background-color: ${color.bg};
    border: 3px solid ${color.border};
    border-radius: 4px;
    z-index: 500;
    pointer-events: auto;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    opacity: 0;
  `;
  
  overlay.title = `Evidence ${index + 1} - Sentence ${sentenceId}\nClick to focus this evidence`;
  
  // Click handler
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 User clicked persistent evidence overlay for sentence ${sentenceId}`);
    
    // Visual feedback
    overlay.style.transform = 'scale(1.05)';
    overlay.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3)';
    setTimeout(() => {
      overlay.style.transform = 'scale(1)';
      overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    }, 200);
  });
  
  // Enhanced hover effects
  overlay.addEventListener('mouseenter', () => {
    overlay.style.transform = 'scale(1.02)';
    overlay.style.zIndex = '600';
    overlay.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3)';
  });

  overlay.addEventListener('mouseleave', () => {
    overlay.style.transform = 'scale(1)';
    overlay.style.zIndex = '500';
    overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
  });
  
  // Add to highlight layer
  highlightLayerRef.current.appendChild(overlay);
  
  // Animate in (no auto-removal)
  setTimeout(() => {
    overlay.style.opacity = '1';
    
    // Add entrance animation
    setTimeout(() => {
      overlay.style.transform = 'scale(1.05)';
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
      }, 200);
    }, 100 + (index * 100));
  }, 50);
  
  console.log(`✅ Persistent overlay added for sentence ${sentenceId}`);
};

// 7. Persistent fallback highlight
const createPersistentFallbackHighlight = (sentenceId, index) => {
  console.log(`🆘 Creating persistent fallback highlight for sentence ${sentenceId}`);
  
  const fallbackBox = {
    left: 50,
    top: 50 + (index * 50),
    width: 300,
    height: 40
  };
  
  const overlay = document.createElement('div');
  overlay.className = 'provenance-overlay persistent-fallback-overlay';
  overlay.setAttribute('data-sentence-id', sentenceId);
  
  overlay.style.cssText = `
    position: absolute;
    left: ${fallbackBox.left}px;
    top: ${fallbackBox.top}px;
    width: ${fallbackBox.width}px;
    height: ${fallbackBox.height}px;
    background-color: rgba(255, 69, 0, 0.8);
    border: 3px solid rgba(255, 69, 0, 1);
    border-radius: 6px;
    z-index: 550;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    opacity: 0;
  `;
  
  overlay.innerHTML = `📍 Evidence ${index + 1} (ID: ${sentenceId})`;
  overlay.title = `Persistent fallback highlight for sentence ${sentenceId}`;
  
  // Click handler
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 Clicked persistent fallback evidence ${index + 1}`);
  });
  
  highlightLayerRef.current.appendChild(overlay);
  
  // Animate in
  setTimeout(() => {
    overlay.style.opacity = '1';
  }, 100 + (index * 100));
  
  console.log(`✅ Persistent fallback overlay created for sentence ${sentenceId}`);
};

const clearHighlights = () => {
  if (!highlightLayerRef.current) return;
  
  console.log('🧹 clearHighlights called (should only happen once per provenance change)');
  
  const existingOverlays = highlightLayerRef.current.querySelectorAll(
    '.provenance-overlay, .test-overlay, .persistent-test-overlay'
  );
  console.log(`🗑️ Clearing ${existingOverlays.length} existing overlays`);
  
  existingOverlays.forEach(overlay => {
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(0.8)';
  });
  
  setTimeout(() => {
    if (highlightLayerRef.current) {
      highlightLayerRef.current.innerHTML = '';
      console.log('✅ Highlights cleared (final)');
    }
  }, 300); // Reduced delay
};

// Add debugging functions to window for manual testing
if (process.env.NODE_ENV === 'development') {
  window.debugHighlightLayer = () => {
    console.log('🔧 Debug: Testing highlight layer...');
    if (highlightLayerRef.current) {
      createTestOverlay();
    } else {
      console.error('❌ highlightLayerRef is null');
    }
  };
  
  window.debugClearHighlights = () => {
    console.log('🔧 Debug: Clearing highlights...');
    clearHighlights();
  };
  
  window.debugTextLayer = () => {
    console.log('🔧 Debug: Analyzing text layer...');
    if (textLayerRef.current) {
      const spans = textLayerRef.current.querySelectorAll('span, div');
      console.log(`Found ${spans.length} text elements`);
      spans.forEach((span, i) => {
        if (i < 5 && span.textContent.trim()) {
          console.log(`Span ${i}:`, span.textContent.trim());
        }
      });
    } else {
      console.error('❌ textLayerRef is null');
    }
  };
  
}



/**
 * Create fallback overlay when specific text matching fails
 */
const createFallbackOverlay = (sentenceId, index) => {
  console.log(`🆘 Creating fallback overlay for sentence ${sentenceId}`);
  
  // Create a general indicator at the top of the page
  const fallbackBox = {
    left: 20,
    top: 20 + (index * 40), // Stack multiple fallbacks
    width: 200,
    height: 30
  };
  
  const overlay = createOverlayDiv(fallbackBox, sentenceId, index);
  if (overlay) {
    overlay.classList.add('fallback-overlay');
    overlay.innerHTML = `<span>📍 Evidence ${index + 1}</span>`;
  }
  
  return overlay;
};

// ===== HELPER FUNCTIONS =====

/**
 * Clean text for more reliable matching
 */
const cleanTextForMatching = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')     // Remove punctuation
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .replace(/\n+/g, ' ')         // Replace newlines with spaces
    .trim();
};

/**
 * Extract key words, filtering out common words
 */
const extractKeyWords = (text) => {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that'
  ]);
  
  return text.split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 15); // Limit to most important words
};

/**
 * Extract meaningful phrases from text
 */
const extractPhrases = (text) => {
  const phrases = [];
  const words = text.split(/\s+/);
  
  // Extract phrases of different lengths
  for (let len = 5; len <= Math.min(10, words.length); len++) {
    for (let i = 0; i <= words.length - len; i++) {
      phrases.push(words.slice(i, i + len).join(' '));
    }
  }
  
  return phrases;
};

/**
 * Find clusters of spans that are close together
 */
const findSpanClusters = (wordSpanMap, allSpans) => {
  const candidateSpans = [];
  
  // Collect all spans that contain any of our words
  for (const spanInfos of wordSpanMap.values()) {
    candidateSpans.push(...spanInfos.map(info => info.span));
  }
  
  // Remove duplicates and sort by position
  const uniqueSpans = [...new Set(candidateSpans)];
  
  // Return spans that appear in multiple word matches
  const spanCounts = new Map();
  candidateSpans.forEach(span => {
    spanCounts.set(span, (spanCounts.get(span) || 0) + 1);
  });
  
  return uniqueSpans.filter(span => spanCounts.get(span) > 1);
};

/**
 * Calculate similarity between two text strings
 */
const calculateTextSimilarity = (text1, text2) => {
  const words1 = new Set(text1.split(/\s+/));
  const words2 = new Set(text2.split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
};

// ===== ENHANCED OVERLAY CREATION =====

/**
 * Create the actual overlay div with enhanced styling
 */
const createOverlayDiv = (boundingBox, sentenceId, index) => {
  if (!boundingBox) return null;
  
  const overlay = document.createElement('div');
  overlay.className = 'provenance-overlay enhanced-overlay';
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
  
  // Enhanced styling with better contrast
  const colors = [
    { bg: 'rgba(255, 193, 7, 0.25)', border: 'rgba(255, 193, 7, 0.8)' },    // Amber
    { bg: 'rgba(40, 167, 69, 0.25)', border: 'rgba(40, 167, 69, 0.8)' },    // Green
    { bg: 'rgba(0, 123, 255, 0.25)', border: 'rgba(0, 123, 255, 0.8)' },    // Blue
    { bg: 'rgba(255, 102, 0, 0.25)', border: 'rgba(255, 102, 0, 0.8)' },    // Orange
    { bg: 'rgba(111, 66, 193, 0.25)', border: 'rgba(111, 66, 193, 0.8)' }   // Purple
  ];
  
  const colorIndex = index % colors.length;
  const color = colors[colorIndex];
  
  overlay.style.backgroundColor = color.bg;
  overlay.style.border = `2px solid ${color.border}`;
  overlay.style.borderRadius = '3px';
  overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
  
  // Add animation
  overlay.style.transition = 'all 0.3s ease';
  overlay.style.opacity = '0';
  
  // Add tooltip
  overlay.title = `Evidence ${index + 1} - Sentence ${sentenceId}\nClick to focus this evidence`;
  
  // Enhanced click handler
  overlay.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 User clicked evidence overlay for sentence ${sentenceId}`);
    onProvenanceClick(sentenceId, index);
    
    // Visual feedback
    overlay.style.transform = 'scale(1.05)';
    setTimeout(() => {
      overlay.style.transform = 'scale(1)';
    }, 150);
  });

  // Enhanced hover effects
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
  
  // Animate in with stagger effect
  setTimeout(() => {
    overlay.style.opacity = '1';
    
    // Add pulse effect
    setTimeout(() => {
      overlay.style.transform = 'scale(1.05)';
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
      }, 200);
    }, 100 + (index * 100));
  }, 50);
  
  return overlay;
};

// ===== DEBUG HELPERS =====

window.debugHighlightLayer = () => {
  if (highlightLayerRef.current) {
    const children = highlightLayerRef.current.children;
    console.log(`🔍 Highlight layer has ${children.length} children:`);
    Array.from(children).forEach((child, index) => {
      console.log(`  ${index}: ${child.className} - ${child.innerHTML || child.textContent}`);
    });
  } else {
    console.log('❌ highlightLayerRef.current is null');
  }
};


/**
 * Debug function to visualize all text spans on the page
 */
const debugTextSpans = () => {
  if (!textLayerRef.current) return;
  
  const spans = textLayerRef.current.querySelectorAll('span, div');
  console.log(`🔍 Found ${spans.length} text spans on page ${currentPage}`);
  
  spans.forEach((span, index) => {
    if (span.textContent.trim().length > 5) {
      span.style.border = '1px solid rgba(255, 0, 0, 0.3)';
      span.title = `Span ${index}: "${span.textContent.trim()}"`;
      console.log(`Span ${index}:`, span.textContent.trim());
    }
  });
  
  // Remove debug borders after 5 seconds
  setTimeout(() => {
    spans.forEach(span => {
      span.style.border = '';
      span.title = '';
    });
  }, 5000);
};

// Add debug button (temporary - remove in production)
if (process.env.NODE_ENV === 'development') {
  window.debugPDFTextSpans = debugTextSpans;
  console.log('🔧 Debug function available: window.debugPDFTextSpans()');
}



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

    <div className={`hybrid-pdf-viewer ${isFullscreen ? 'fullscreen' : ''}`}>
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
      <div className="hybrid-content">
        {/* Main PDF View */}
        <div className="pdf-main-view full-width">
          <div className="pdf-content" ref={containerRef}>
            <div className="pdf-page-container">
              <canvas ref={canvasRef} className="pdf-canvas" />
              <div ref={textLayerRef} className="pdf-text-layer" />
              <div ref={highlightLayerRef} className="pdf-highlight-layer" />
            </div>
          </div>
        </div>

  
      </div>



    </div>
  );
};

export default HybridPDFViewer;