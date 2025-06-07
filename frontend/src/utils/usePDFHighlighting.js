// usePDFHighlighting.js - React hook for PDF text highlighting
import { useState, useCallback, useRef } from 'react';

// Import your existing text matcher
class PDFTextMatcher {
  constructor() {
    this.textCache = new Map();
    this.coordinateCache = new Map();
  }

  normalizeText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .toLowerCase()
      .trim();
  }

  async highlightProvenanceText(sentenceIds, sentencesData, pdfPage, pageNumber) {
    const highlights = [];
    
    for (const sentenceId of sentenceIds) {
      const sentence = sentencesData.sentences?.find(s => s.sentence_id === sentenceId);
      if (!sentence) continue;

      // Check if this sentence appears on the current page
      if (sentence.page_spans && !sentence.page_spans.includes(pageNumber)) continue;

      const sentenceHighlights = await this.highlightSentence(sentence, pdfPage, pageNumber);
      highlights.push(...sentenceHighlights);
    }

    return highlights;
  }

  async highlightSentence(sentence, pdfPage, pageNumber) {
    // Try bounding boxes first, then text matching
    try {
      const boundingBoxHighlights = await this.highlightUsingBoundingBoxes(sentence, pdfPage, pageNumber);
      if (boundingBoxHighlights.length > 0) {
        return boundingBoxHighlights;
      }
    } catch (error) {
      console.warn('Bounding box highlighting failed:', error);
    }

    // Fallback to text matching
    try {
      return await this.highlightUsingTextMatching(sentence, pdfPage, pageNumber);
    } catch (error) {
      console.warn('Text matching highlighting failed:', error);
      return [];
    }
  }

  async highlightUsingBoundingBoxes(sentence, pdfPage, pageNumber) {
    const highlights = [];
    
    if (!sentence.bounding_boxes) return highlights;
    
    const pageBounds = sentence.bounding_boxes.filter(box => box.page === pageNumber);
    
    for (const bound of pageBounds) {
      const viewport = pdfPage.getViewport({ scale: 1.0 });
      const highlight = this.convertBoundingBox(bound, viewport);
      
      if (highlight) {
        highlights.push({
          type: 'bounding_box',
          coordinates: highlight,
          confidence: bound.confidence || 1.0,
          text: sentence.text,
          sentenceId: sentence.sentence_id
        });
      }
    }

    return highlights;
  }

  async highlightUsingTextMatching(sentence, pdfPage, pageNumber) {
    const textContent = await pdfPage.getTextContent();
    const highlights = [];

    const targetText = this.normalizeText(sentence.text);
    const words = targetText.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return highlights;

    // Simple text matching - find consecutive words in PDF text items
    const matches = this.findTextMatches(words, textContent.items);
    
    for (const match of matches) {
      const highlight = this.createHighlightFromTextMatch(match, textContent.items);
      if (highlight) {
        highlights.push({
          type: 'text_match',
          coordinates: highlight,
          confidence: match.confidence,
          text: sentence.text,
          sentenceId: sentence.sentence_id
        });
      }
    }

    return highlights;
  }

  findTextMatches(targetWords, textItems) {
    if (!targetWords.length || !textItems.length) return [];

    const matches = [];
    const normalizedItems = textItems.map((item, index) => ({
      ...item,
      index,
      normalizedStr: this.normalizeText(item.str)
    }));

    for (let i = 0; i < normalizedItems.length; i++) {
      const match = this.findSequenceStartingAt(targetWords, normalizedItems, i);
      if (match && match.confidence > 0.5) {
        matches.push(match);
      }
    }

    return this.deduplicateMatches(matches);
  }

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
        if (wordIndex < targetWords.length && this.wordsMatch(targetWords[wordIndex], itemWord)) {
          matchedItems.push({ item, wordIndex, itemWord });
          totalConfidence += this.calculateWordMatchConfidence(targetWords[wordIndex], itemWord);
          wordIndex++;
          foundInItem = true;
        }
      }

      if (!foundInItem) {
        totalConfidence -= 0.1; // Small penalty for skipped items
      }

      itemIndex++;

      if (totalConfidence < wordIndex * 0.3) break; // Early termination
    }

    if (wordIndex >= Math.max(1, targetWords.length * 0.6)) {
      return {
        matchedItems,
        confidence: totalConfidence / targetWords.length,
        startItem: startIndex,
        endItem: itemIndex - 1
      };
    }

    return null;
  }

  wordsMatch(word1, word2) {
    if (word1 === word2) return true;
    return this.calculateStringSimilarity(word1, word2) > 0.8;
  }

  calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => 
      Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + substitutionCost
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  calculateWordMatchConfidence(target, matched) {
    return this.calculateStringSimilarity(target, matched);
  }

  convertBoundingBox(boundingBox, viewport) {
    try {
      // Convert your bounding box coordinates to viewport coordinates
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

  createHighlightFromTextMatch(match, textItems) {
    if (!match.matchedItems.length) return null;

    const bounds = match.matchedItems.map(({ item }) => ({
      left: item.transform[4],
      top: item.transform[5],
      width: item.width,
      height: item.height
    }));

    return this.mergeBounds(bounds);
  }

  mergeBounds(bounds) {
    if (!bounds.length) return null;
    if (bounds.length === 1) return bounds[0];

    bounds.sort((a, b) => (a.top - b.top) || (a.left - b.left));

    const merged = [];
    let current = { ...bounds[0] };

    for (let i = 1; i < bounds.length; i++) {
      const next = bounds[i];

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

  shouldMergeBounds(bound1, bound2) {
    const verticalOverlap = Math.max(0, 
      Math.min(bound1.top + bound1.height, bound2.top + bound2.height) - 
      Math.max(bound1.top, bound2.top)
    );
    
    const minHeight = Math.min(bound1.height, bound2.height);
    const overlapRatio = verticalOverlap / minHeight;
    const horizontalGap = Math.abs((bound1.left + bound1.width) - bound2.left);
    
    return overlapRatio > 0.5 && horizontalGap < bound1.height;
  }

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

  deduplicateMatches(matches) {
    if (matches.length <= 1) return matches;

    matches.sort((a, b) => b.confidence - a.confidence);
    const filtered = [];

    for (const match of matches) {
      const overlaps = filtered.some(existing => this.matchesOverlap(match, existing));
      if (!overlaps) {
        filtered.push(match);
      }
    }

    return filtered;
  }

  matchesOverlap(match1, match2) {
    const overlap = Math.max(0, 
      Math.min(match1.endItem, match2.endItem) - 
      Math.max(match1.startItem, match2.startItem)
    );
    
    const minLength = Math.min(
      match1.endItem - match1.startItem,
      match2.endItem - match2.startItem
    );

    return overlap / minLength > 0.5;
  }
}

// React Hook for PDF Highlighting
export function usePDFHighlighting() {
  const [highlights, setHighlights] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const textMatcherRef = useRef(new PDFTextMatcher());

  const highlightProvenance = useCallback(async (sentenceIds, sentencesData, pdfPage, pageNumber) => {
    if (!sentenceIds || !sentenceIds.length || !pdfPage) {
      setHighlights([]);
      return [];
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🎯 Highlighting ${sentenceIds.length} sentences on page ${pageNumber}`);
      
      const newHighlights = await textMatcherRef.current.highlightProvenanceText(
        sentenceIds, 
        sentencesData, 
        pdfPage, 
        pageNumber
      );
      
      console.log(`✅ Created ${newHighlights.length} highlights`);
      setHighlights(newHighlights);
      return newHighlights;
    } catch (err) {
      console.error('❌ Failed to highlight provenance:', err);
      setError(err.message);
      setHighlights([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlights([]);
    setError(null);
  }, []);

  const highlightSpecificText = useCallback(async (targetText, pdfPage, pageNumber) => {
    if (!targetText || !pdfPage) {
      setHighlights([]);
      return [];
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`🔍 Highlighting specific text: "${targetText.substring(0, 50)}..."`);
      
      // Create a mock sentence object for the text matcher
      const mockSentence = {
        sentence_id: 'search',
        text: targetText,
        page_spans: [pageNumber],
        bounding_boxes: []
      };

      const mockSentencesData = {
        sentences: [mockSentence]
      };

      const newHighlights = await textMatcherRef.current.highlightProvenanceText(
        ['search'], 
        mockSentencesData, 
        pdfPage, 
        pageNumber
      );
      
      console.log(`✅ Created ${newHighlights.length} text highlights`);
      setHighlights(newHighlights);
      return newHighlights;
    } catch (err) {
      console.error('❌ Failed to highlight text:', err);
      setError(err.message);
      setHighlights([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    highlights,
    isLoading,
    error,
    highlightProvenance,
    highlightSpecificText,
    clearHighlights
  };
}