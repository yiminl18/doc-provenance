// Enhanced SentencePDFMapper.js - extends your existing mapper with sentence indexing

import { SentencePDFMapper } from './SentencePDFMapper.js';

/**
 * Enhanced Sentence PDF Mapper with direct indexing support
 * Extends your existing mapper to support sentence-indexed rendering
 */
export class EnhancedSentencePDFMapper extends SentencePDFMapper {
  constructor() {
    super();
    this.sentenceTextItems = new Map(); // Maps sentence ID -> PDF text items
    this.pageSentenceItems = new Map(); // Maps page -> sentence text items
  }

  /**
   * Enhanced initialization that also maps text items to sentences
   */
  async initialize(pdfDoc, sentences) {
    console.log('🔄 Initializing enhanced sentence-to-PDF mapper...');
    
    try {
      // Run the base initialization
      const baseResult = await super.initialize(pdfDoc, sentences);
      
      if (!baseResult.success) {
        return baseResult;
      }
      
      // Now add our enhanced mapping
      await this.mapSentencesToTextItems(pdfDoc, sentences);
      
      console.log('✅ Enhanced sentence mapper initialized successfully');
      
      return {
        success: true,
        totalSentences: sentences.length,
        mappedSentences: this.sentencePageMap.size,
        totalPages: pdfDoc.numPages,
        sentencesWithTextItems: this.sentenceTextItems.size
      };
    } catch (error) {
      console.error('❌ Failed to initialize enhanced sentence mapper:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Map sentences to their actual PDF text items for precise rendering
   */
  async mapSentencesToTextItems(pdfDoc, sentences) {
    console.log('🎯 Mapping sentences to PDF text items...');
    
    this.sentenceTextItems.clear();
    this.pageSentenceItems.clear();
    
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        console.log(`📄 Processing page ${pageNum} with ${textContent.items.length} text items`);
        
        // Get sentences that belong to this page
        const pageSentences = this.getSentencesOnPage(pageNum);
        
        if (pageSentences.length === 0) {
          console.log(`📄 No sentences mapped to page ${pageNum}`);
          continue;
        }
        
        console.log(`📋 Found ${pageSentences.length} sentences for page ${pageNum}`);
        
        // Map each sentence to its text items
        const pageResults = [];
        
        for (const sentenceInfo of pageSentences) {
          const sentenceId = sentenceInfo.sentenceId;
          const sentence = sentences[sentenceId];
          
          if (!sentence) {
            console.warn(`⚠️ Sentence ${sentenceId} not found in sentences array`);
            continue;
          }
          
          const textItems = this.findTextItemsForSentence(sentence, textContent.items);
          
          if (textItems.length > 0) {
            this.sentenceTextItems.set(sentenceId, textItems);
            pageResults.push({
              sentenceId,
              sentence,
              textItems,
              confidence: this.calculateTextItemConfidence(sentence, textItems)
            });
            
            console.log(`✅ Mapped sentence ${sentenceId} to ${textItems.length} text items`);
          } else {
            console.warn(`⚠️ No text items found for sentence ${sentenceId}: "${sentence.substring(0, 50)}..."`);
          }
        }
        
        this.pageSentenceItems.set(pageNum, pageResults);
        console.log(`📄 Page ${pageNum} complete: ${pageResults.length}/${pageSentences.length} sentences mapped`);
        
      } catch (error) {
        console.error(`❌ Error processing page ${pageNum}:`, error);
      }
    }
    
    console.log(`🎯 Sentence-to-text-items mapping complete: ${this.sentenceTextItems.size} sentences mapped`);
  }

  /**
   * Find PDF text items that correspond to a sentence
   */
  findTextItemsForSentence(sentence, textItems) {
    const cleanSentence = this.cleanText(sentence);
    const sentenceWords = this.extractSignificantWords(cleanSentence);
    
    if (sentenceWords.length === 0) {
      return [];
    }
    
    console.log(`🔍 Finding text items for: "${sentence.substring(0, 50)}..." (${sentenceWords.length} words)`);
    
    // Strategy 1: Sequential word matching
    const sequentialMatch = this.findSequentialTextItems(sentenceWords, textItems);
    if (sequentialMatch.length > 0) {
      console.log(`✅ Sequential match found: ${sequentialMatch.length} items`);
      return sequentialMatch;
    }
    
    // Strategy 2: Cluster-based matching
    const clusterMatch = this.findClusteredTextItems(sentenceWords, textItems);
    if (clusterMatch.length > 0) {
      console.log(`✅ Cluster match found: ${clusterMatch.length} items`);
      return clusterMatch;
    }
    
    // Strategy 3: Word density matching
    const densityMatch = this.findDensityBasedTextItems(sentenceWords, textItems);
    if (densityMatch.length > 0) {
      console.log(`✅ Density match found: ${densityMatch.length} items`);
      return densityMatch;
    }
    
    console.log(`⚠️ No good match found for sentence`);
    return [];
  }

  /**
   * Find text items using sequential word matching
   */
  findSequentialTextItems(sentenceWords, textItems) {
    const matches = [];
    
    // Try different sequence lengths
    for (let seqLength = Math.min(6, sentenceWords.length); seqLength >= 3; seqLength--) {
      for (let startWord = 0; startWord <= sentenceWords.length - seqLength; startWord++) {
        const wordSequence = sentenceWords.slice(startWord, startWord + seqLength);
        
        const sequenceItems = this.findItemSequenceForWords(wordSequence, textItems);
        
        if (sequenceItems.length > 0) {
          matches.push({
            items: sequenceItems,
            confidence: seqLength / sentenceWords.length,
            sequenceLength: seqLength
          });
        }
      }
    }
    
    // Return the best match
    if (matches.length > 0) {
      const bestMatch = matches.sort((a, b) => b.confidence - a.confidence)[0];
      return bestMatch.items;
    }
    
    return [];
  }

  /**
   * Find a sequence of text items that contains the word sequence
   */
  findItemSequenceForWords(wordSequence, textItems) {
    for (let startItem = 0; startItem < textItems.length; startItem++) {
      const matchedItems = [];
      let wordIndex = 0;
      let itemIndex = startItem;
      
      while (wordIndex < wordSequence.length && itemIndex < textItems.length) {
        const item = textItems[itemIndex];
        const itemText = this.cleanText(item.str);
        const targetWord = wordSequence[wordIndex];
        
        if (itemText.includes(targetWord)) {
          matchedItems.push(item);
          wordIndex++;
          
          if (wordIndex === wordSequence.length) {
            return matchedItems; // Found complete sequence
          }
        } else if (matchedItems.length > 0) {
          // Allow some gaps but not too many
          if (itemIndex - startItem > wordSequence.length * 3) {
            break;
          }
        }
        
        itemIndex++;
      }
    }
    
    return [];
  }

  /**
   * Find text items using spatial clustering
   */
  findClusteredTextItems(sentenceWords, textItems) {
    const wordMatches = [];
    
    // Find all items that contain any of our words
    textItems.forEach((item, index) => {
      const itemText = this.cleanText(item.str);
      const matchingWords = sentenceWords.filter(word => itemText.includes(word));
      
      if (matchingWords.length > 0) {
        wordMatches.push({
          item: item,
          index: index,
          matchingWords: matchingWords,
          x: item.transform[4],
          y: item.transform[5]
        });
      }
    });
    
    if (wordMatches.length === 0) {
      return [];
    }
    
    // Group spatially close items
    const clusters = this.clusterItemsByPosition(wordMatches);
    
    // Return the best cluster
    if (clusters.length > 0) {
      const bestCluster = clusters.sort((a, b) => b.totalWords - a.totalWords)[0];
      return bestCluster.items;
    }
    
    return [];
  }

  /**
   * Cluster text items by spatial position
   */
  clusterItemsByPosition(wordMatches) {
    const clusters = [];
    const used = new Set();
    
    wordMatches.forEach((match, index) => {
      if (used.has(index)) return;
      
      const cluster = [match];
      used.add(index);
      
      // Find nearby matches
      wordMatches.forEach((otherMatch, otherIndex) => {
        if (used.has(otherIndex)) return;
        
        const distance = Math.sqrt(
          Math.pow(match.x - otherMatch.x, 2) + 
          Math.pow(match.y - otherMatch.y, 2)
        );
        
        if (distance < 200) { // Adjust threshold as needed
          cluster.push(otherMatch);
          used.add(otherIndex);
        }
      });
      
      if (cluster.length > 0) {
        clusters.push({
          items: cluster.map(c => c.item),
          totalWords: cluster.reduce((sum, c) => sum + c.matchingWords.length, 0),
          avgX: cluster.reduce((sum, c) => sum + c.x, 0) / cluster.length,
          avgY: cluster.reduce((sum, c) => sum + c.y, 0) / cluster.length
        });
      }
    });
    
    return clusters;
  }

  /**
   * Find text items using word density
   */
  findDensityBasedTextItems(sentenceWords, textItems) {
    const densityScores = [];
    
    // Calculate density for sliding windows of text items
    const windowSize = Math.min(10, textItems.length);
    
    for (let i = 0; i <= textItems.length - windowSize; i++) {
      const windowItems = textItems.slice(i, i + windowSize);
      const windowText = windowItems.map(item => this.cleanText(item.str)).join(' ');
      
      const matchingWords = sentenceWords.filter(word => windowText.includes(word));
      const density = matchingWords.length / sentenceWords.length;
      
      if (density > 0.3) { // Minimum density threshold
        densityScores.push({
          items: windowItems,
          density: density,
          startIndex: i
        });
      }
    }
    
    // Return the highest density window
    if (densityScores.length > 0) {
      const bestWindow = densityScores.sort((a, b) => b.density - a.density)[0];
      return bestWindow.items;
    }
    
    return [];
  }

  /**
   * Calculate confidence score for text item mapping
   */
  calculateTextItemConfidence(sentence, textItems) {
    const sentenceWords = this.extractSignificantWords(this.cleanText(sentence));
    const itemsText = textItems.map(item => this.cleanText(item.str)).join(' ');
    const foundWords = sentenceWords.filter(word => itemsText.includes(word));
    
    return foundWords.length / sentenceWords.length;
  }

  /**
   * Get text items for a specific sentence
   */
  getTextItemsForSentence(sentenceId) {
    return this.sentenceTextItems.get(sentenceId) || [];
  }

  /**
   * Get all sentence mappings for a page
   */
  getPageSentenceMappings(pageNum) {
    return this.pageSentenceItems.get(pageNum) || [];
  }

  /**
   * Check if a sentence has text items mapped
   */
  hasSentenceMapping(sentenceId) {
    return this.sentenceTextItems.has(sentenceId);
  }

  /**
   * Get enhanced statistics
   */
  getEnhancedStatistics() {
    const baseStats = this.getStatistics();
    
    if (baseStats.error) {
      return baseStats;
    }
    
    const itemsMapped = this.sentenceTextItems.size;
    const averageItemsPerSentence = itemsMapped > 0 
      ? Array.from(this.sentenceTextItems.values()).reduce((sum, items) => sum + items.length, 0) / itemsMapped
      : 0;
    
    const confidenceDistribution = {
      high: 0,    // > 0.8
      medium: 0,  // 0.5 - 0.8
      low: 0,     // 0.2 - 0.5
      poor: 0     // < 0.2
    };
    
    // Calculate confidence for text item mappings
    for (const [sentenceId, textItems] of this.sentenceTextItems) {
      // Get the original sentence for confidence calculation
      // This would need to be passed in or stored separately
      const confidence = 0.8; // Placeholder - would calculate based on actual sentence
      
      if (confidence > 0.8) confidenceDistribution.high++;
      else if (confidence > 0.5) confidenceDistribution.medium++;
      else if (confidence > 0.2) confidenceDistribution.low++;
      else confidenceDistribution.poor++;
    }
    
    return {
      ...baseStats,
      sentencesWithTextItems: itemsMapped,
      averageItemsPerSentence: averageItemsPerSentence.toFixed(1),
      textItemConfidenceDistribution: confidenceDistribution
    };
  }
}

// Integration helper functions for HybridPDFViewer.js

/**
 * Create sentence divs using the enhanced mapper
 */
export const createSentenceDivsFromMapper = (mapper, pageNum, viewport, textLayerRef) => {
  console.log(`🎨 Creating sentence divs for page ${pageNum}...`);
  
  if (!textLayerRef.current) {
    console.warn('⚠️ textLayerRef not available');
    return;
  }
  
  // Clear existing content
  textLayerRef.current.innerHTML = '';
  
  // Set up text layer container
  const textLayer = textLayerRef.current;
  textLayer.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${viewport.width / (window.devicePixelRatio || 1)}px;
    height: ${viewport.height / (window.devicePixelRatio || 1)}px;
    overflow: hidden;
    pointer-events: none;
    z-index: 2;
  `;
  
  // Get sentence mappings for this page
  const sentenceMappings = mapper.getPageSentenceMappings(pageNum);
  
  console.log(`📋 Found ${sentenceMappings.length} sentence mappings for page ${pageNum}`);
  
  // Create divs for each mapped sentence
  sentenceMappings.forEach((mapping) => {
    createSentenceDiv(mapping, viewport, textLayer);
  });
  
  console.log(`✅ Created ${sentenceMappings.length} sentence divs`);
};

/**
 * Create a single sentence div with preserved formatting
 */
const createSentenceDiv = (mapping, viewport, textLayer) => {
  const { sentenceId, sentence, textItems, confidence } = mapping;
  
  if (!textItems || textItems.length === 0) {
    console.warn(`⚠️ No text items for sentence ${sentenceId}`);
    return;
  }
  
  // Calculate bounding box for all text items
  const boundingBox = calculateTextItemsBoundingBox(textItems, viewport);
  
  if (!boundingBox) {
    console.warn(`⚠️ Could not calculate bounding box for sentence ${sentenceId}`);
    return;
  }
  
  // Create sentence container div
  const sentenceDiv = document.createElement('div');
  sentenceDiv.className = 'sentence-div enhanced';
  sentenceDiv.setAttribute('data-sentence-id', sentenceId);
  sentenceDiv.setAttribute('data-sentence-index', sentenceId);
  sentenceDiv.setAttribute('data-confidence', confidence?.toFixed(2) || '0.8');
  
  // Position the sentence div
  sentenceDiv.style.cssText = `
    position: absolute;
    left: ${boundingBox.left}px;
    top: ${boundingBox.top}px;
    width: ${boundingBox.width}px;
    height: ${boundingBox.height}px;
    pointer-events: auto;
    cursor: pointer;
    z-index: 3;
    border-radius: 2px;
    transition: all 0.2s ease;
  `;
  
  // Create formatted text content
  textItems.forEach(item => {
    const span = document.createElement('span');
    span.textContent = item.str;
    span.className = 'pdf-text-item';
    
    // Calculate relative position within the sentence container
    const devicePixelRatio = window.devicePixelRatio || 1;
    const itemX = item.transform[4] * viewport.scale / devicePixelRatio;
    const itemY = (viewport.height - item.transform[5] * viewport.scale) / devicePixelRatio;
    
    const relativeX = itemX - boundingBox.left;
    const relativeY = itemY - boundingBox.top;
    
    // Apply formatting from PDF
    const fontSize = item.transform[0] || 12;
    const fontHeight = item.height || fontSize;
    
    span.style.cssText = `
      position: absolute;
      left: ${relativeX}px;
      top: ${relativeY}px;
      font-size: ${fontSize}px;
      line-height: ${fontHeight}px;
      font-family: ${item.fontName || 'serif'};
      color: #333;
      white-space: nowrap;
      font-smooth: always;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    `;
    
    sentenceDiv.appendChild(span);
  });
  
  // Add hover effects
  sentenceDiv.addEventListener('mouseenter', () => {
    sentenceDiv.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
  });
  
  sentenceDiv.addEventListener('mouseleave', () => {
    sentenceDiv.style.backgroundColor = 'transparent';
  });
  
  // Add click handler
  sentenceDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log(`📍 Clicked sentence ${sentenceId}:`, sentence.substring(0, 100));
  });
  
  textLayer.appendChild(sentenceDiv);
  
  console.log(`✅ Created sentence div ${sentenceId}: ${boundingBox.width}x${boundingBox.height} at (${boundingBox.left}, ${boundingBox.top})`);
};

/**
 * Calculate bounding box for text items
 */
const calculateTextItemsBoundingBox = (textItems, viewport) => {
  if (!textItems || textItems.length === 0) return null;
  
  const devicePixelRatio = window.devicePixelRatio || 1;
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  textItems.forEach(item => {
    const x = item.transform[4] * viewport.scale / devicePixelRatio;
    const y = (viewport.height - item.transform[5] * viewport.scale) / devicePixelRatio;
    const width = item.width * viewport.scale / devicePixelRatio;
    const height = item.height * viewport.scale / devicePixelRatio;
    
    minX = Math.min(minX, x);
    minY = Math.min(minY, y - height);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y);
  });
  
  const padding = 2;
  
  return {
    left: Math.max(0, minX - padding),
    top: Math.max(0, minY - padding),
    width: (maxX - minX) + (padding * 2),
    height: (maxY - minY) + (padding * 2)
  };
};