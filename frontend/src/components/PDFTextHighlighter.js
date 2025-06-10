// PDFTextHighlighter.js - Text search-based highlighting for PDF.js
import React, { useState, useEffect, useRef } from 'react';

/**
 * PDFTextHighlighter component that uses PDF.js text layer for accurate highlighting
 * Integrates with LayoutBasedPDFViewer
 */
export function PDFTextHighlighter({ 
  documentId, 
  currentPage, 
  provenanceData,
  textLayerRef, // Reference to the PDF.js text layer
  highlightLayerRef, // Reference to highlight overlay layer
  currentViewport, // Current PDF.js viewport
  onHighlightClick = null,
  isRendering = false
}) {
  const [activeHighlights, setActiveHighlights] = useState([]);
  const [highlightsPersisted, setHighlightsPersisted] = useState(false);
  const [currentProvenanceId, setCurrentProvenanceId] = useState(null);
  const highlightElementsRef = useRef(new Map());
  const searchTimeoutRef = useRef(null);

  // Extract provenance text from the provenance data
  const getProvenanceText = () => {
    if (!provenanceData) return '';
    
    // Try different possible text sources
    return provenanceData.provenance || 
           provenanceData.content?.join(' ') || 
           provenanceData.text || 
           '';
  };

  // Main effect: highlight text when provenance changes
  useEffect(() => {
    const provenanceText = getProvenanceText();
    const provenanceId = provenanceData?.provenance_id;

    if (!provenanceText || !textLayerRef?.current || !highlightLayerRef?.current || isRendering) {
      clearHighlights();
      return;
    }

    // Check if we need to create new highlights
    if (provenanceId !== currentProvenanceId || !highlightsPersisted) {
      console.log('🎯 PDFTextHighlighter: Creating highlights for provenance:', provenanceId);
      setCurrentProvenanceId(provenanceId);
      
      // Debounce the highlighting to avoid rapid re-renders
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      
      searchTimeoutRef.current = setTimeout(() => {
        highlightProvenanceText(provenanceText, provenanceId);
      }, 100);
    }
  }, [provenanceData, currentPage, currentViewport, isRendering, currentProvenanceId, highlightsPersisted]);

  const highlightProvenanceText = async (searchText, highlightId) => {
    if (!searchText || searchText.length < 5) {
      console.log('⚠️ PDFTextHighlighter: Search text too short, skipping');
      return;
    }

    clearHighlights();
    console.log(`🔍 PDFTextHighlighter: Searching for text: "${searchText.substring(0, 100)}..."`);

    try {
      // Wait for text layer to be ready
      await waitForTextLayer();

      // Get all text elements from PDF.js text layer - try multiple selectors
      let textDivs = textLayerRef.current.querySelectorAll('span[dir="ltr"]');
      
      if (textDivs.length === 0) {
        // Try alternative selectors
        textDivs = textLayerRef.current.querySelectorAll('span');
        console.log(`📄 DEBUG: Trying alternative selector, found ${textDivs.length} span elements`);
      }
      
      if (textDivs.length === 0) {
        // Try even more generic selector
        textDivs = textLayerRef.current.querySelectorAll('div');
        console.log(`📄 DEBUG: Trying div selector, found ${textDivs.length} div elements`);
      }
      
      console.log(`📄 Found ${textDivs.length} text elements in text layer`);
      
      // Log the HTML structure for debugging
      console.log(`🏗️ DEBUG: Text layer HTML structure:`, textLayerRef.current.innerHTML.substring(0, 500));

      if (textDivs.length === 0) {
        console.warn('⚠️ No text elements found in text layer');
        createFallbackHighlight(searchText, highlightId);
        return;
      }

      const highlights = [];
      
     // Method 1: Try exact phrase matches first
      const exactMatches = findExactMatches(textDivs, searchText);
      highlights.push(...exactMatches);

      // Method 2: If no exact matches, try word-based matching
      if (exactMatches.length === 0) {
        console.log(`🔄 DEBUG: No exact matches, trying word matching...`);
        const wordMatches = findWordMatches(textDivs, searchText);
        
        if (wordMatches.length > 0) {
          // Find the best cluster of matches
          const clusteredMatches = findBestMatchCluster(wordMatches, searchText);
          highlights.push(...clusteredMatches);
        }
      }

      // Method 3: If still no matches, try fuzzy matching
      if (highlights.length === 0) {
        console.log(`🔄 DEBUG: No word matches, trying fuzzy matching...`);
        const fuzzyMatches = findFuzzyMatches(textDivs, searchText);
        highlights.push(...fuzzyMatches);
      }

      if (highlights.length > 0) {
        console.log(`✅ PDFTextHighlighter: Found ${highlights.length} text matches`);
        createHighlightElements(highlights, highlightId);
        setActiveHighlights(highlights);
        setHighlightsPersisted(true);
      } else {
        console.log('⚠️ PDFTextHighlighter: No matches found, creating fallback');
        createFallbackHighlight(searchText, highlightId);
      }

    } catch (error) {
      console.error('❌ PDFTextHighlighter: Error in highlighting:', error);
      createFallbackHighlight(searchText, highlightId);
    }
  };

  const waitForTextLayer = async (maxWait = 3000) => {
    const startTime = Date.now();
    
    while ((!textLayerRef.current || textLayerRef.current.children.length === 0) && 
           (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!textLayerRef.current || textLayerRef.current.children.length === 0) {
      throw new Error('Text layer not ready after waiting');
    }
  };

  const findExactMatches = (textDivs, searchText) => {
    const matches = [];
    const searchLower = searchText.toLowerCase().trim();
    
    console.log(`🔍 DEBUG: Searching for exact matches of: "${searchLower.substring(0, 100)}..."`);
    console.log(`📊 DEBUG: Found ${textDivs.length} text elements to search`);
    
    // Filter out whitespace-only elements and log what we're working with
    const validTextDivs = Array.from(textDivs).filter(element => {
      const text = element.textContent.trim();
      const isValid = text.length > 0 && !/^\s*$/.test(text);
      if (!isValid) {
        console.log(`⚠️ DEBUG: Skipping whitespace element: "${element.textContent}"`);
      }
      return isValid;
    });
    
    console.log(`✅ DEBUG: ${validTextDivs.length} valid text elements after filtering whitespace`);
    
    // Log first few elements for debugging
    validTextDivs.slice(0, 5).forEach((element, index) => {
      console.log(`📝 DEBUG: Element ${index}: "${element.textContent.substring(0, 50)}..."`);
    });
    
    // Try to find exact phrase matches
    for (let i = 0; i < validTextDivs.length; i++) {
      const element = validTextDivs[i];
      const elementText = element.textContent.toLowerCase().trim();
      
      // Skip very short elements (likely whitespace or punctuation)
      //if (elementText.length < 3) {
      //  continue;
      //}
      
      // Check for exact substring match
      if (elementText.includes(searchLower)) {
        console.log(`🎯 DEBUG: Found exact match in element: "${elementText}"`);
        matches.push({
          element,
          confidence: 1.0,
          matchType: 'exact_phrase',
          matchText: element.textContent,
          searchText: searchText.substring(0, 50)
        });
        continue;
      }
      
      // Check for partial phrase matches (at least 70% of the search text)
      if (searchLower.length > 20) {
        const partialLength = Math.floor(searchLower.length * 0.7);
        for (let start = 0; start <= searchLower.length - partialLength; start += 10) {
          const partial = searchLower.substring(start, start + partialLength);
          if (partial.length > 15 && elementText.includes(partial)) {
            console.log(`🎯 DEBUG: Found partial match in element: "${elementText}" for partial: "${partial}"`);
            matches.push({
              element,
              confidence: 0.8,
              matchType: 'partial_phrase',
              matchText: element.textContent,
              searchText: partial
            });
            break;
          }
        }
      }
    }
    
    console.log(`✅ DEBUG: Found ${matches.length} exact/partial matches`);
    return matches;
  };

  const findWordMatches = (textDivs, searchText) => {
    const matches = [];
    const searchWords = searchText.toLowerCase()
      .split(/\s+/)
      //.filter(word => word.length > 2) // Skip very short words
      //.slice(0, 15); // Limit to first 15 words
    
    if (searchWords.length === 0) return matches;
    
    console.log(`🔤 DEBUG: Searching for word matches with words: [${searchWords.slice(0, 5).join(', ')}...]`);
    
    // Filter out whitespace-only elements
    const validTextDivs = Array.from(textDivs).filter(element => {
      const text = element.textContent.trim();
      return !/^\s*$/.test(text);
    });
    
    for (const element of validTextDivs) {
      const elementText = element.textContent.toLowerCase();
      const elementWords = elementText.split(/\s+/);
      
      // Count matching words
      const matchingWords = searchWords.filter(searchWord => 
        elementWords.some(elementWord => 
          elementWord.includes(searchWord) || searchWord.includes(elementWord)
        )
      );
      
      if (matchingWords.length > 0) {
        const confidence = matchingWords.length / searchWords.length;
        
        console.log(`🎯 DEBUG: Found word match in "${elementText.substring(0, 50)}..." with ${matchingWords.length}/${searchWords.length} words (${(confidence * 100).toFixed(0)}%)`);
        
        // Only include matches with reasonable confidence
        if (confidence >= 0.3) {
          matches.push({
            element,
            confidence,
            matchType: 'word_match',
            matchText: element.textContent,
            matchingWords: matchingWords,
            totalWords: searchWords.length
          });
        }
      }
    }
    
    // Sort by confidence, take top matches
    const sortedMatches = matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10); // Limit to top 10 matches
      
    console.log(`✅ DEBUG: Found ${sortedMatches.length} word matches`);
    return sortedMatches;
  };

  

  const findFuzzyMatches = (textDivs, searchText) => {
    const matches = [];
    const searchChunks = createSearchChunks(searchText);
    
    for (const element of textDivs) {
      const elementText = element.textContent;
      
      for (const chunk of searchChunks) {
        const similarity = calculateStringSimilarity(
          elementText.toLowerCase(), 
          chunk.toLowerCase()
        );
        
        if (similarity > 0.6) { // 60% similarity threshold
          matches.push({
            element,
            confidence: similarity,
            matchType: 'fuzzy_match',
            matchText: elementText,
            searchChunk: chunk
          });
          break; // Don't double-match the same element
        }
      }
    }
    
    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8); // Limit to top 8 fuzzy matches
  };

    const findBestMatchCluster = (matches, originalProvenanceText) => {
    if (matches.length === 0) return [];
    
    console.log(`🎯 DEBUG: Clustering ${matches.length} matches to find best group`);
    
    // Add position information to each match
    const matchesWithPosition = matches.map(match => {
      const rect = match.element.getBoundingClientRect();
      const style = window.getComputedStyle(match.element);
      
      // Try to extract position from PDF.js inline styles (left: X%, top: Y%)
      const leftMatch = match.element.style.left.match(/(\d+\.?\d*)%/);
      const topMatch = match.element.style.top.match(/(\d+\.?\d*)%/);
      
      const left = leftMatch ? parseFloat(leftMatch[1]) : (rect.left / window.innerWidth) * 100;
      const top = topMatch ? parseFloat(topMatch[1]) : (rect.top / window.innerHeight) * 100;
      
      return {
        ...match,
        position: { left, top },
        rect: rect
      };
    })
    ;
    // Log positions for debugging
    matchesWithPosition.forEach((match, i) => {
      console.log(`📍 Match ${i}: "${match.matchText.substring(0, 30)}..." at (${match.position.left.toFixed(1)}%, ${match.position.top.toFixed(1)}%) confidence: ${(match.confidence * 100).toFixed(0)}%`);
    });
    
    // Sort by confidence first, then try to find spatial clusters
    const sortedByConfidence = matchesWithPosition.sort((a, b) => b.confidence - a.confidence);
    
    // Find clusters of matches that are close together
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < sortedByConfidence.length; i++) {
      if (used.has(i)) continue;
      
      const baseMatch = sortedByConfidence[i];
      const cluster = [baseMatch];
      used.add(i);
      
      // Find other matches close to this one
      for (let j = i + 1; j < sortedByConfidence.length; j++) {
        if (used.has(j)) continue;
        
        const candidate = sortedByConfidence[j];
        
        // Check if candidate is close to any match in the current cluster
        const isCloseToCluster = cluster.some(clusterMatch => {
          const topDistance = Math.abs(clusterMatch.position.top - candidate.position.top);
          const leftDistance = Math.abs(clusterMatch.position.left - candidate.position.left);
          
          // Matches are "close" if they're within ~3% vertically and ~50% horizontally
          // (allowing for text that spans across the page)
          return topDistance <= 3 && leftDistance <= 50;
        });
        
        if (isCloseToCluster) {
          cluster.push(candidate);
          used.add(j);
        }
      }
      
      clusters.push(cluster);
    }

     // Score each cluster by reconstructing text and comparing to original
    const scoredClusters = clusters.map((cluster, clusterIndex) => {
      // Sort cluster elements by position (reading order: top to bottom, left to right)
      const sortedCluster = cluster.sort((a, b) => {
        if (Math.abs(a.position.top - b.position.top) < 1) {
          // Same line, sort left to right
          return a.position.left - b.position.left;
        }
        // Different lines, sort top to bottom
        return a.position.top - b.position.top;
      });
      
      // Reconstruct the text from this cluster
      const reconstructedText = sortedCluster
        .map(match => match.matchText.trim())
        .join(' ')
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      console.log(`📊 Cluster ${clusterIndex}: ${cluster.length} elements`);
      console.log(`   📝 Reconstructed: "${reconstructedText}"`);
      
      // Calculate similarity between reconstructed text and original provenance
      const similarity = calculateTextSimilarity(reconstructedText, originalProvenanceText);
      
      // Calculate coverage - how much of the original text is covered
      const coverage = calculateTextCoverage(reconstructedText, originalProvenanceText);
      
      // Calculate length ratio - prefer clusters that cover a significant portion
      const lengthRatio = Math.min(reconstructedText.length / originalProvenanceText.length, 1);
      
      // Calculate position consistency - prefer clusters where elements are in logical reading order
      const positionConsistency = calculatePositionConsistency(sortedCluster);
      
      // Combined score: similarity is most important, then coverage, length, and consistency
      const score = similarity * 0.5 + coverage * 0.3 + lengthRatio * 0.1 + positionConsistency * 0.1;
      
      console.log(`   📊 Similarity: ${(similarity * 100).toFixed(1)}%, Coverage: ${(coverage * 100).toFixed(1)}%, Length ratio: ${(lengthRatio * 100).toFixed(1)}%, Position: ${(positionConsistency * 100).toFixed(1)}%`);
      console.log(`   🎯 Final score: ${score.toFixed(3)}`);
      
      return { 
        cluster: sortedCluster, 
        score, 
        similarity,
        coverage,
        lengthRatio,
        positionConsistency,
        reconstructedText,
        clusterSize: cluster.length 
      };
    });
    
    // Sort clusters by score and take the best one
    scoredClusters.sort((a, b) => b.score - a.score);
    
    const bestCluster = scoredClusters[0];
    console.log(`🏆 Selected best cluster:`);
    console.log(`   📝 Reconstructed: "${bestCluster.reconstructedText}"`);
    console.log(`   📊 Score: ${bestCluster.score.toFixed(3)} (similarity: ${(bestCluster.similarity * 100).toFixed(1)}%, coverage: ${(bestCluster.coverage * 100).toFixed(1)}%)`);
    console.log(`   🔢 Elements: ${bestCluster.clusterSize}`);
    
    return bestCluster.cluster;
  };

   const calculateTextSimilarity = (text1, text2) => {
    // Normalize both texts for comparison
    const normalize = (text) => text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();
    
    const normalized1 = normalize(text1);
    const normalized2 = normalize(text2);
    
    // Use a combination of approaches for similarity
    
    // 1. Direct string similarity (Levenshtein-based)
    const directSimilarity = calculateStringSimilarity(normalized1, normalized2);
    
    // 2. Word overlap similarity
    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 1));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 1));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const wordSimilarity = union.size > 0 ? intersection.size / union.size : 0;
    
    // 3. Substring similarity - check if one is largely contained in the other
    const containsSimilarity = Math.max(
      normalized1.includes(normalized2) ? 1 : 0,
      normalized2.includes(normalized1) ? 1 : 0,
      // Check for substantial overlap
      normalized1.length > 20 && normalized2.includes(normalized1.substring(0, Math.min(normalized1.length, 50))) ? 0.8 : 0,
      normalized2.length > 20 && normalized1.includes(normalized2.substring(0, Math.min(normalized2.length, 50))) ? 0.8 : 0
    );
    
    // Combine similarities with weights favoring word overlap and containment
    return directSimilarity * 0.3 + wordSimilarity * 0.4 + containsSimilarity * 0.3;
  };

  const calculateTextCoverage = (reconstructedText, originalText) => {
    // Calculate how much of the original text is covered by the reconstructed text
    const normalizeForCoverage = (text) => text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const normalizedReconstructed = normalizeForCoverage(reconstructedText);
    const normalizedOriginal = normalizeForCoverage(originalText);
    
    const originalWords = normalizedOriginal.split(/\s+/).filter(w => w.length > 1);
    const reconstructedWords = normalizedReconstructed.split(/\s+/).filter(w => w.length > 1);
    
    if (originalWords.length === 0) return 0;
    
    // Count how many original words appear in the reconstructed text
    const coveredWords = originalWords.filter(word => 
      reconstructedWords.some(rWord => rWord.includes(word) || word.includes(rWord))
    );
    
    return coveredWords.length / originalWords.length;
  };

  const calculatePositionConsistency = (sortedCluster) => {
    if (sortedCluster.length <= 1) return 1.0;
    
    // Check if the elements follow a logical reading order
    let consistencyScore = 1.0;
    
    for (let i = 1; i < sortedCluster.length; i++) {
      const prev = sortedCluster[i - 1];
      const curr = sortedCluster[i];
      
      // Elements should either be on the same line (similar top) or curr should be below prev
      const topDiff = curr.position.top - prev.position.top;
      const leftDiff = curr.position.left - prev.position.left;
      
      if (Math.abs(topDiff) < 1) {
        // Same line - current should be to the right of previous
        if (leftDiff < 0) {
          consistencyScore -= 0.2; // Penalty for going backwards on same line
        }
      } else if (topDiff < 0) {
        // Current is above previous - this is usually wrong
        consistencyScore -= 0.3;
      }
      // topDiff > 1 means current is below previous, which is generally good
    }
    
    return Math.max(0, consistencyScore);
  };
   


   

 


  const createSearchChunks = (text) => {
    const chunks = [];
    
    // Split by sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      chunks.push(trimmed);
      
      // For long sentences, create overlapping word chunks
      if (trimmed.length > 80) {
        const words = trimmed.split(/\s+/);
        for (let i = 0; i < words.length - 4; i += 3) {
          const chunk = words.slice(i, i + 8).join(' ');
          if (chunk.length > 20) {
            chunks.push(chunk);
          }
        }
      }
    }
    
    return chunks.slice(0, 20); // Limit chunks to avoid performance issues
  };

  const calculateStringSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  };

  const levenshteinDistance = (str1, str2) => {
    const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  };

  const createHighlightElements = (highlights, highlightId) => {
    if (!highlightLayerRef?.current) return;

    let highlightsCreated = 0;
    const newHighlights = new Map();

    highlights.forEach((highlight, index) => {
      const highlightElement = createHighlightFromTextElement(highlight, index, highlightId);
      
      if (highlightElement) {
        newHighlights.set(`${highlightId}_${index}`, highlightElement);
        highlightsCreated++;
      }
    });

    highlightElementsRef.current = newHighlights;
    console.log(`✅ PDFTextHighlighter: Created ${highlightsCreated} highlight elements`);
  };

  const createHighlightFromTextElement = (highlight, index, highlightId) => {
    if (!highlight.element || !highlightLayerRef?.current) return null;

    const textElement = highlight.element;
    const rect = textElement.getBoundingClientRect();
    const highlightLayer = highlightLayerRef.current;
    const layerRect = highlightLayer.getBoundingClientRect();
    
    // Calculate position relative to highlight layer
    const left = rect.left - layerRect.left;
    const top = rect.top - layerRect.top;
    const width = rect.width;
    const height = rect.height;
    
    // Skip invalid dimensions
    if (width <= 0 || height <= 0) {
      console.warn(`⚠️ PDFTextHighlighter: Invalid dimensions: ${width}x${height}`);
      return null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'pdf-text-highlighter-overlay';
    overlay.setAttribute('data-highlight-id', highlightId);
    overlay.setAttribute('data-index', index);
    overlay.setAttribute('data-confidence', highlight.confidence.toFixed(2));
    overlay.setAttribute('data-match-type', highlight.matchType);

    // Color coding based on match type and confidence
    let backgroundColor, borderColor;
    if (highlight.matchType === 'exact_phrase') {
      backgroundColor = 'rgba(76, 175, 80, 0.4)'; // Green for exact matches
      borderColor = 'rgba(76, 175, 80, 0.8)';
    } else if (highlight.matchType === 'partial_phrase') {
      backgroundColor = 'rgba(33, 150, 243, 0.4)'; // Blue for partial matches
      borderColor = 'rgba(33, 150, 243, 0.8)';
    } else if (highlight.matchType === 'word_match') {
      backgroundColor = 'rgba(255, 193, 7, 0.4)'; // Yellow for word matches
      borderColor = 'rgba(255, 193, 7, 0.8)';
    } else {
      backgroundColor = 'rgba(156, 39, 176, 0.4)'; // Purple for fuzzy matches
      borderColor = 'rgba(156, 39, 176, 0.8)';
    }

    overlay.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${width}px;
      height: ${height}px;
      background-color: ${backgroundColor};
      border: 2px solid ${borderColor};
      border-radius: 3px;
      z-index: 100;
      pointer-events: auto;
      cursor: pointer;
      opacity: ${Math.max(0.6, highlight.confidence)};
      transition: all 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    `;

    // Create tooltip
    const getMatchDescription = () => {
      switch (highlight.matchType) {
        case 'exact_phrase': return 'Exact phrase match';
        case 'partial_phrase': return 'Partial phrase match';
        case 'word_match': 
          return `Word match (${highlight.matchingWords?.length || 0}/${highlight.totalWords || 0} words)`;
        case 'fuzzy_match': return 'Fuzzy text match';
        default: return 'Text match';
      }
    };

    overlay.title = `${getMatchDescription()}\nConfidence: ${(highlight.confidence * 100).toFixed(0)}%\nText: "${highlight.matchText.substring(0, 100)}${highlight.matchText.length > 100 ? '...' : ''}"`;

    // Click handler
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log(`📍 PDFTextHighlighter: Clicked highlight ${index}:`, highlight.matchType);

      // Visual feedback
      overlay.style.transform = 'scale(1.05)';
      overlay.style.borderWidth = '3px';
      overlay.style.zIndex = '200';
      
      setTimeout(() => {
        overlay.style.transform = 'scale(1)';
        overlay.style.borderWidth = '2px';
        overlay.style.zIndex = '100';
      }, 300);

      if (onHighlightClick) {
        onHighlightClick({
          index,
          text: highlight.matchText,
          confidence: highlight.confidence,
          matchType: highlight.matchType,
          searchText: highlight.searchText || highlight.searchChunk,
          page: currentPage
        });
      }
    });

    // Hover effects
    overlay.addEventListener('mouseenter', () => {
      overlay.style.transform = 'scale(1.02)';
      overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
      overlay.style.zIndex = '150';
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.style.transform = 'scale(1)';
      overlay.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
      overlay.style.zIndex = '100';
    });

    highlightLayer.appendChild(overlay);
    return overlay;
  };

  const createFallbackHighlight = (searchText, highlightId) => {
    if (!highlightLayerRef?.current) return;

    console.log('🆘 PDFTextHighlighter: Creating fallback highlight');

    const overlay = document.createElement('div');
    overlay.className = 'pdf-text-highlighter-fallback';
    overlay.setAttribute('data-highlight-id', highlightId);

    overlay.style.cssText = `
      position: absolute;
      left: 20px;
      top: 20px;
      width: 300px;
      height: 40px;
      background-color: rgba(244, 67, 54, 0.9);
      border: 2px solid rgba(244, 67, 54, 1);
      border-radius: 6px;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    overlay.innerHTML = `🔍 No text matches found`;
    overlay.title = `Could not find text matches for: "${searchText.substring(0, 100)}${searchText.length > 100 ? '...' : ''}"`;

    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      
      if (onHighlightClick) {
        onHighlightClick({
          index: 0,
          text: searchText,
          confidence: 0.0,
          matchType: 'fallback',
          searchText: searchText,
          page: currentPage
        });
      }
    });

    highlightLayerRef.current.appendChild(overlay);
    
    // Auto-remove fallback after 5 seconds
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 5000);

    setHighlightsPersisted(true);
  };

  const clearHighlights = () => {
    if (!highlightLayerRef?.current) return;

    const overlays = highlightLayerRef.current.querySelectorAll(
      '.pdf-text-highlighter-overlay, .pdf-text-highlighter-fallback'
    );
    
    console.log(`🧹 PDFTextHighlighter: Clearing ${overlays.length} highlights`);

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
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      clearHighlights();
    };
  }, []);

  // This component manages DOM elements directly, no JSX render
  return null;
}

// Export utility functions
export const PDFTextHighlightingUtils = {
  /**
   * Scroll to the first highlight
   */
  scrollToFirstHighlight: (highlightLayerRef) => {
    if (!highlightLayerRef?.current) return false;
    
    const firstHighlight = highlightLayerRef.current.querySelector('.pdf-text-highlighter-overlay');
    if (firstHighlight) {
      firstHighlight.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      
      // Flash effect
      firstHighlight.style.animation = 'highlight-flash 1.5s ease-in-out';
      return true;
    }
    
    return false;
  },

  /**
   * Get highlight statistics
   */
  getHighlightStats: (highlightLayerRef) => {
    if (!highlightLayerRef?.current) return null;
    
    const highlights = highlightLayerRef.current.querySelectorAll('.pdf-text-highlighter-overlay');
    const matchTypes = {};
    let totalConfidence = 0;
    
    highlights.forEach(highlight => {
      const matchType = highlight.getAttribute('data-match-type');
      const confidence = parseFloat(highlight.getAttribute('data-confidence'));
      
      matchTypes[matchType] = (matchTypes[matchType] || 0) + 1;
      totalConfidence += confidence;
    });
    
    return {
      totalHighlights: highlights.length,
      averageConfidence: highlights.length > 0 ? totalConfidence / highlights.length : 0,
      matchTypes
    };
  },

  /**
   * Debug function to inspect text layer structure
   */
  debugTextLayer: (textLayerRef) => {
    if (!textLayerRef?.current) {
      console.log('❌ DEBUG: No text layer reference');
      return;
    }

    const textLayer = textLayerRef.current;
    console.log('🔍 DEBUG: Text Layer Analysis');
    console.log('📄 Text layer HTML:', textLayer.outerHTML.substring(0, 1000));
    
    // Try different selectors
    const selectors = [
      'span[dir="ltr"]',
      'span',
      'div',
      '*'
    ];
    
    selectors.forEach(selector => {
      const elements = textLayer.querySelectorAll(selector);
      console.log(`📊 ${selector}: ${elements.length} elements`);
      
      if (elements.length > 0) {
        console.log(`   First 3 elements:`);
        Array.from(elements).slice(0, 3).forEach((el, i) => {
          console.log(`   ${i}: "${el.textContent}" (${el.tagName})`);
        });
      }
    });
    
    // Check for text content
    const allText = textLayer.textContent;
    console.log(`📝 Total text content length: ${allText.length}`);
    console.log(`📝 First 200 chars: "${allText.substring(0, 200)}"`);
  },

  /**
   * Test search with a simple word
   */
  testSearch: (textLayerRef, searchWord = 'the') => {
    if (!textLayerRef?.current) {
      console.log('❌ DEBUG: No text layer reference for test');
      return;
    }

    const textLayer = textLayerRef.current;
    const allElements = textLayer.querySelectorAll('*');
    
    console.log(`🧪 Testing search for "${searchWord}"`);
    
    let matchCount = 0;
    Array.from(allElements).forEach((element, index) => {
      const text = element.textContent.toLowerCase();
      if (text.includes(searchWord.toLowerCase())) {
        matchCount++;
        if (matchCount <= 5) { // Log first 5 matches
          console.log(`✅ Match ${matchCount}: "${text}" in ${element.tagName}`);
          console.log(`   Element rect:`, element.getBoundingClientRect());
        }
      }
    });
    
    console.log(`🎯 Total matches for "${searchWord}": ${matchCount}`);
  }
};

export default PDFTextHighlighter;