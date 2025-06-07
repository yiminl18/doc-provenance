// PDF Text Highlighting Algorithm

class PDFTextMatcher {
  constructor() {
    this.textCache = new Map();
    this.coordinateCache = new Map();
  }

  /**
   * Main function to highlight provenance text in PDF.js
   * @param {Array} sentenceIds - Array of sentence IDs to highlight
   * @param {Object} sentencesData - Your sentences with layout data
   * @param {Object} pdfPage - PDF.js page object
   * @param {number} pageNumber - Current page number
   */
  async highlightProvenanceText(sentenceIds, sentencesData, pdfPage, pageNumber) {
    const highlights = [];
    
    for (const sentenceId of sentenceIds) {
      const sentence = sentencesData.sentences.find(s => s.sentence_id === sentenceId);
      if (!sentence) continue;

      // Check if this sentence appears on the current page
      if (!sentence.page_spans.includes(pageNumber)) continue;

      const sentenceHighlights = await this.highlightSentence(sentence, pdfPage, pageNumber);
      highlights.push(...sentenceHighlights);
    }

    return highlights;
  }

  /**
   * Highlight a single sentence using multiple strategies
   */
  async highlightSentence(sentence, pdfPage, pageNumber) {
    const strategies = [
      () => this.highlightUsingBoundingBoxes(sentence, pdfPage, pageNumber),
      () => this.highlightUsingTextMatching(sentence, pdfPage, pageNumber),
      () => this.highlightUsingHybridApproach(sentence, pdfPage, pageNumber)
    ];

    // Try strategies in order of reliability
    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.length > 0) {
          return result;
        }
      } catch (error) {
        console.warn('Highlighting strategy failed:', error);
      }
    }

    return [];
  }

  /**
   * Strategy 1: Use your existing bounding box coordinates directly
   */
  async highlightUsingBoundingBoxes(sentence, pdfPage, pageNumber) {
    const highlights = [];
    
    // Get bounding boxes for this page
    const pageBounds = sentence.bounding_boxes.filter(box => box.page === pageNumber);
    
    for (const bound of pageBounds) {
      // Convert your coordinates to PDF.js viewport coordinates
      const viewport = pdfPage.getViewport({ scale: 1.0 });
      const highlight = this.convertBoundingBox(bound, viewport);
      
      if (highlight) {
        highlights.push({
          type: 'bounding_box',
          coordinates: highlight,
          confidence: bound.confidence || 1.0,
          text: sentence.text
        });
      }
    }

    return highlights;
  }

  /**
   * Strategy 2: Pure text matching with PDF.js text content
   */
  async highlightUsingTextMatching(sentence, pdfPage, pageNumber) {
    const textContent = await pdfPage.getTextContent();
    const highlights = [];

    // Clean and normalize sentence text
    const targetText = this.normalizeText(sentence.text);
    const words = targetText.split(/\s+/).filter(w => w.length > 0);

    // Find matching text sequences
    const matches = this.findTextMatches(words, textContent.items);
    
    for (const match of matches) {
      const highlight = this.createHighlightFromTextMatch(match, textContent.items);
      if (highlight) {
        highlights.push({
          type: 'text_match',
          coordinates: highlight,
          confidence: match.confidence,
          text: sentence.text
        });
      }
    }

    return highlights;
  }

  /**
   * Strategy 3: Hybrid approach - use text matching with coordinate validation
   */
  async highlightUsingHybridApproach(sentence, pdfPage, pageNumber) {
    const textContent = await pdfPage.getTextContent();
    const pageBounds = sentence.bounding_boxes.filter(box => box.page === pageNumber);
    
    if (pageBounds.length === 0) {
      return this.highlightUsingTextMatching(sentence, pdfPage, pageNumber);
    }

    const highlights = [];
    const targetText = this.normalizeText(sentence.text);
    
    // Find text matches within expected coordinate ranges
    const textMatches = await this.highlightUsingTextMatching(sentence, pdfPage, pageNumber);
    
    for (const textMatch of textMatches) {
      // Validate text match against known bounding boxes
      const isValid = this.validateMatchAgainstBounds(textMatch, pageBounds);
      
      if (isValid) {
        highlights.push({
          ...textMatch,
          type: 'hybrid_validated',
          confidence: Math.min(textMatch.confidence * 1.2, 1.0) // Boost confidence
        });
      }
    }

    // If no validated matches, fall back to bounding boxes
    if (highlights.length === 0) {
      return this.highlightUsingBoundingBoxes(sentence, pdfPage, pageNumber);
    }

    return highlights;
  }

  /**
   * Convert your bounding box format to PDF.js coordinates
   */
  convertBoundingBox(boundingBox, viewport) {
    // Your coordinates: { x0, y0, x1, y1, page }
    // PDF.js expects: { left, top, width, height } in viewport coordinates
    
    try {
      // Convert PDF coordinates to viewport coordinates
      const [x0, y0, x1, y1] = viewport.convertToViewportRectangle([
        boundingBox.x0,
        boundingBox.y0,
        boundingBox.x1,
        boundingBox.y1
      ]);

      return {
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0)
      };
    } catch (error) {
      console.warn('Failed to convert bounding box:', error);
      return null;
    }
  }

  /**
   * Normalize text for matching (handle spacing, punctuation differences)
   */
  normalizeText(text) {
    return text
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/[^\w\s]/g, '') // Remove punctuation for matching
      .toLowerCase()
      .trim();
  }

  /**
   * Find text sequences in PDF.js text items
   */
  findTextMatches(targetWords, textItems) {
    const matches = [];
    const normalizedItems = textItems.map(item => ({
      ...item,
      normalizedStr: this.normalizeText(item.str)
    }));

    // Sliding window approach to find word sequences
    for (let i = 0; i < normalizedItems.length; i++) {
      const match = this.findSequenceStartingAt(targetWords, normalizedItems, i);
      if (match && match.confidence > 0.6) { // Threshold for match quality
        matches.push(match);
      }
    }

    // Remove overlapping matches, keep best ones
    return this.deduplicateMatches(matches);
  }

  /**
   * Find word sequence starting at a specific position
   */
  findSequenceStartingAt(targetWords, textItems, startIndex) {
    let wordIndex = 0;
    let itemIndex = startIndex;
    const matchedItems = [];
    let totalConfidence = 0;

    while (wordIndex < targetWords.length && itemIndex < textItems.length) {
      const item = textItems[itemIndex];
      const itemWords = item.normalizedStr.split(/\s+/).filter(w => w.length > 0);

      let foundInItem = false;
      for (const itemWord of itemWords) {
        if (wordIndex < targetWords.length && 
            this.wordsMatch(targetWords[wordIndex], itemWord)) {
          matchedItems.push({ item, wordIndex, itemWord });
          totalConfidence += this.calculateWordMatchConfidence(targetWords[wordIndex], itemWord);
          wordIndex++;
          foundInItem = true;
        }
      }

      if (!foundInItem) {
        // Allow skipping some items (for formatting differences)
        const skipPenalty = 0.1;
        totalConfidence -= skipPenalty;
      }

      itemIndex++;

      // Early termination if confidence drops too low
      if (totalConfidence < wordIndex * 0.5) {
        break;
      }
    }

    if (wordIndex >= targetWords.length * 0.8) { // Found at least 80% of words
      return {
        matchedItems,
        confidence: totalConfidence / targetWords.length,
        startItem: startIndex,
        endItem: itemIndex - 1
      };
    }

    return null;
  }

  /**
   * Check if two words match (with fuzzy matching)
   */
  wordsMatch(word1, word2) {
    if (word1 === word2) return true;
    
    // Handle common OCR/extraction differences
    const similarity = this.calculateStringSimilarity(word1, word2);
    return similarity > 0.8; // 80% similarity threshold
  }

  /**
   * Calculate string similarity (simple Levenshtein-based)
   */
  calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Simple Levenshtein distance calculation
   */
  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => 
      Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // insertion
          matrix[j - 1][i] + 1, // deletion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate confidence for word match
   */
  calculateWordMatchConfidence(target, matched) {
    return this.calculateStringSimilarity(target, matched);
  }

  /**
   * Create highlight coordinates from text match
   */
  createHighlightFromTextMatch(match, textItems) {
    if (!match.matchedItems.length) return null;

    // Get bounding boxes of matched text items
    const bounds = match.matchedItems.map(({ item }) => ({
      left: item.transform[4],
      top: item.transform[5],
      width: item.width,
      height: item.height
    }));

    // Merge overlapping/adjacent bounds
    return this.mergeBounds(bounds);
  }

  /**
   * Merge multiple bounding boxes into highlighting regions
   */
  mergeBounds(bounds) {
    if (!bounds.length) return null;
    if (bounds.length === 1) return bounds[0];

    // Sort by top, then left
    bounds.sort((a, b) => (a.top - b.top) || (a.left - b.left));

    const merged = [];
    let current = { ...bounds[0] };

    for (let i = 1; i < bounds.length; i++) {
      const next = bounds[i];

      // Check if bounds should be merged (same line, adjacent)
      if (this.shouldMergeBounds(current, next)) {
        current = this.mergeTwoBounds(current, next);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged.length === 1 ? merged[0] : merged;
  }

  /**
   * Check if two bounds should be merged
   */
  shouldMergeBounds(bound1, bound2) {
    const verticalOverlap = Math.max(0, 
      Math.min(bound1.top + bound1.height, bound2.top + bound2.height) - 
      Math.max(bound1.top, bound2.top)
    );
    
    const minHeight = Math.min(bound1.height, bound2.height);
    const overlapRatio = verticalOverlap / minHeight;

    // Merge if significant vertical overlap and horizontally adjacent/close
    const horizontalGap = Math.abs((bound1.left + bound1.width) - bound2.left);
    
    return overlapRatio > 0.5 && horizontalGap < bound1.height; // Gap less than line height
  }

  /**
   * Merge two bounding boxes
   */
  mergeTwoBounds(bound1, bound2) {
    const left = Math.min(bound1.left, bound2.left);
    const top = Math.min(bound1.top, bound2.top);
    const right = Math.max(bound1.left + bound1.width, bound2.left + bound2.width);
    const bottom = Math.max(bound1.top + bound1.height, bound2.top + bound2.height);

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  /**
   * Validate text match against known bounding boxes
   */
  validateMatchAgainstBounds(textMatch, expectedBounds) {
    if (!expectedBounds.length) return true;

    // Check if text match coordinates are reasonably close to expected bounds
    for (const expectedBound of expectedBounds) {
      const distance = this.calculateBoundDistance(textMatch.coordinates, expectedBound);
      if (distance < 50) { // Within 50 pixels - adjust threshold as needed
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate distance between two bounding boxes
   */
  calculateBoundDistance(bound1, bound2) {
    const center1 = {
      x: bound1.left + bound1.width / 2,
      y: bound1.top + bound1.height / 2
    };
    const center2 = {
      x: bound2.x0 + (bound2.x1 - bound2.x0) / 2,
      y: bound2.y0 + (bound2.y1 - bound2.y0) / 2
    };

    return Math.sqrt(
      Math.pow(center1.x - center2.x, 2) + 
      Math.pow(center1.y - center2.y, 2)
    );
  }

  /**
   * Remove overlapping matches, keep highest confidence
   */
  deduplicateMatches(matches) {
    if (matches.length <= 1) return matches;

    matches.sort((a, b) => b.confidence - a.confidence);
    const filtered = [];

    for (const match of matches) {
      const overlaps = filtered.some(existing => 
        this.matchesOverlap(match, existing)
      );
      
      if (!overlaps) {
        filtered.push(match);
      }
    }

    return filtered;
  }

  /**
   * Check if two matches overlap significantly
   */
  matchesOverlap(match1, match2) {
    const overlap = Math.max(0, 
      Math.min(match1.endItem, match2.endItem) - 
      Math.max(match1.startItem, match2.startItem)
    );
    
    const minLength = Math.min(
      match1.endItem - match1.startItem,
      match2.endItem - match2.startItem
    );

    return overlap / minLength > 0.5; // 50% overlap threshold
  }
}

// Usage example for your React component
export function usePDFHighlighting() {
  const matcher = new PDFTextMatcher();

  const highlightProvenance = async (sentenceIds, sentencesData, pdfPage, pageNumber) => {
    try {
      const highlights = await matcher.highlightProvenanceText(
        sentenceIds, 
        sentencesData, 
        pdfPage, 
        pageNumber
      );
      
      return highlights;
    } catch (error) {
      console.error('Failed to highlight provenance:', error);
      return [];
    }
  };

  return { highlightProvenance };
}