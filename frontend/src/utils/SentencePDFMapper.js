// Save this file as: src/utils/SentencePDFMapper.js

/**
 * Advanced Sentence-to-PDF Mapping Utility
 * Maps tokenized sentences to their positions in the formatted PDF
 */

export class SentencePDFMapper {
  constructor() {
    this.sentencePageMap = new Map();
    this.sentencePositionMap = new Map();
    this.pageTextCache = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the mapper with PDF document and sentences
   */
  async initialize(pdfDoc, sentences) {
    console.log('🔄 Initializing sentence-to-PDF mapper...');
    
    try {
      // Extract and cache text from all pages
      await this.extractAllPageTexts(pdfDoc);
      
      // Map sentences to pages and positions
      await this.mapSentencesToPages(sentences);
      
      this.isInitialized = true;
      console.log('✅ Sentence mapper initialized successfully');
      
      return {
        success: true,
        totalSentences: sentences.length,
        mappedSentences: this.sentencePageMap.size,
        totalPages: pdfDoc.numPages
      };
    } catch (error) {
      console.error('❌ Failed to initialize sentence mapper:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract text content from all PDF pages
   */
  async extractAllPageTexts(pdfDoc) {
    this.pageTextCache.clear();
    
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Extract text with position information
        const textItems = textContent.items.map(item => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
          fontSize: item.height
        }));
        
        // Combine into full page text while preserving structure
        const fullText = textItems.map(item => item.text).join(' ');
        
        this.pageTextCache.set(pageNum, {
          fullText: fullText.toLowerCase(),
          textItems: textItems,
          originalText: textContent.items.map(item => item.str).join(' ')
        });
        
        console.log(`📄 Extracted text from page ${pageNum}: ${fullText.length} characters`);
      } catch (error) {
        console.error(`❌ Error extracting text from page ${pageNum}:`, error);
      }
    }
  }

  /**
   * Map sentences to their most likely pages and positions
   */
  async mapSentencesToPages(sentences) {
    const mappingResults = {
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      unmapped: 0
    };

    sentences.forEach((sentence, sentenceId) => {
      const mapping = this.findBestPageMatch(sentence, sentenceId);
      
      if (mapping.confidence > 0.8) {
        mappingResults.highConfidence++;
      } else if (mapping.confidence > 0.5) {
        mappingResults.mediumConfidence++;
      } else if (mapping.confidence > 0.2) {
        mappingResults.lowConfidence++;
      } else {
        mappingResults.unmapped++;
      }
      
      this.sentencePageMap.set(sentenceId, mapping.pageNum);
      this.sentencePositionMap.set(sentenceId, mapping);
    });

    console.log('📊 Sentence mapping results:', mappingResults);
  }

  /**
   * Find the best page match for a sentence
   */
  findBestPageMatch(sentence, sentenceId) {
    const cleanSentence = this.cleanText(sentence);
    let bestMatch = {
      pageNum: 1,
      confidence: 0,
      position: 0,
      matchType: 'none',
      matchedText: ''
    };

    // Strategy 1: Exact substring match
    for (const [pageNum, pageData] of this.pageTextCache) {
      const exactMatch = this.findExactMatch(cleanSentence, pageData.fullText);
      if (exactMatch.confidence > bestMatch.confidence) {
        bestMatch = {
          pageNum,
          confidence: exactMatch.confidence,
          position: exactMatch.position,
          matchType: 'exact',
          matchedText: exactMatch.matchedText
        };
      }
    }

    // Strategy 2: Word overlap matching (if exact match not found)
    if (bestMatch.confidence < 0.7) {
      for (const [pageNum, pageData] of this.pageTextCache) {
        const wordMatch = this.findWordOverlapMatch(cleanSentence, pageData.fullText);
        if (wordMatch.confidence > bestMatch.confidence) {
          bestMatch = {
            pageNum,
            confidence: wordMatch.confidence,
            position: wordMatch.position,
            matchType: 'word_overlap',
            matchedText: wordMatch.matchedText
          };
        }
      }
    }

    // Strategy 3: Fuzzy matching for difficult cases
    if (bestMatch.confidence < 0.5) {
      for (const [pageNum, pageData] of this.pageTextCache) {
        const fuzzyMatch = this.findFuzzyMatch(cleanSentence, pageData.fullText);
        if (fuzzyMatch.confidence > bestMatch.confidence) {
          bestMatch = {
            pageNum,
            confidence: fuzzyMatch.confidence,
            position: fuzzyMatch.position,
            matchType: 'fuzzy',
            matchedText: fuzzyMatch.matchedText
          };
        }
      }
    }

    console.log(`📍 Sentence ${sentenceId} → Page ${bestMatch.pageNum} (${bestMatch.matchType}, confidence: ${bestMatch.confidence.toFixed(2)})`);
    return bestMatch;
  }

  /**
   * Find exact substring matches
   */
  findExactMatch(sentence, pageText) {
    // Try different substring lengths for matching
    const lengths = [
      Math.min(sentence.length, 100),
      Math.min(sentence.length, 50),
      Math.min(sentence.length, 30)
    ];

    for (const length of lengths) {
      const substring = sentence.substring(0, length);
      const index = pageText.indexOf(substring);
      
      if (index !== -1) {
        const confidence = length / sentence.length;
        return {
          confidence,
          position: index,
          matchedText: substring
        };
      }
    }

    return { confidence: 0, position: 0, matchedText: '' };
  }

  /**
   * Find matches based on word overlap
   */
  findWordOverlapMatch(sentence, pageText) {
    const sentenceWords = this.extractSignificantWords(sentence);
    const pageWords = pageText.split(/\s+/);
    
    let bestMatch = { confidence: 0, position: 0, matchedText: '' };
    
    // Look for sequences of words
    for (let i = 0; i < pageWords.length - sentenceWords.length + 1; i++) {
      const pageSequence = pageWords.slice(i, i + sentenceWords.length);
      const matchingWords = sentenceWords.filter(word => 
        pageSequence.some(pageWord => pageWord.includes(word) || word.includes(pageWord))
      );
      
      const confidence = matchingWords.length / sentenceWords.length;
      
      if (confidence > bestMatch.confidence) {
        bestMatch = {
          confidence,
          position: i,
          matchedText: pageSequence.join(' ')
        };
      }
    }

    return bestMatch;
  }

  /**
   * Fuzzy matching for difficult cases
   */
  findFuzzyMatch(sentence, pageText) {
    const sentenceWords = this.extractSignificantWords(sentence);
    const chunks = this.chunkText(pageText, 200); // 200-character chunks
    
    let bestMatch = { confidence: 0, position: 0, matchedText: '' };
    
    chunks.forEach((chunk, index) => {
      const chunkWords = this.extractSignificantWords(chunk.text);
      const commonWords = sentenceWords.filter(word => 
        chunkWords.some(chunkWord => 
          this.calculateSimilarity(word, chunkWord) > 0.8
        )
      );
      
      const confidence = commonWords.length / Math.max(sentenceWords.length, 1);
      
      if (confidence > bestMatch.confidence) {
        bestMatch = {
          confidence,
          position: chunk.position,
          matchedText: chunk.text.substring(0, 100)
        };
      }
    });

    return bestMatch;
  }

  /**
   * Extract significant words (filter out common words)
   */
  extractSignificantWords(text) {
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall'
    ]);

    return text.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word))
      .slice(0, 20); // Limit to most important words
  }

  /**
   * Chunk text into overlapping segments
   */
  chunkText(text, chunkSize) {
    const chunks = [];
    const overlap = Math.floor(chunkSize * 0.2); // 20% overlap
    
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.substring(i, i + chunkSize);
      chunks.push({
        text: chunk,
        position: i
      });
      
      if (i + chunkSize >= text.length) break;
    }
    
    return chunks;
  }

  /**
   * Calculate similarity between two words
   */
  calculateSimilarity(word1, word2) {
    if (word1 === word2) return 1.0;
    if (word1.length === 0 || word2.length === 0) return 0.0;
    
    // Simple edit distance approximation
    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length > word2.length ? word2 : word1;
    
    if (longer.includes(shorter) || shorter.includes(longer)) {
      return shorter.length / longer.length;
    }
    
    // Character overlap
    const chars1 = new Set(word1);
    const chars2 = new Set(word2);
    const intersection = new Set([...chars1].filter(x => chars2.has(x)));
    const union = new Set([...chars1, ...chars2]);
    
    return intersection.size / union.size;
  }

  /**
   * Clean and normalize text for comparison
   */
  cleanText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get page number for a sentence
   */
  getPageForSentence(sentenceId) {
    return this.sentencePageMap.get(sentenceId) || 1;
  }

  /**
   * Get detailed mapping info for a sentence
   */
  getMappingInfo(sentenceId) {
    return this.sentencePositionMap.get(sentenceId) || {
      pageNum: 1,
      confidence: 0,
      position: 0,
      matchType: 'unmapped'
    };
  }

  /**
   * Get all sentences on a specific page
   */
  getSentencesOnPage(pageNum) {
    const sentences = [];
    for (const [sentenceId, mappedPage] of this.sentencePageMap) {
      if (mappedPage === pageNum) {
        sentences.push({
          sentenceId,
          mappingInfo: this.sentencePositionMap.get(sentenceId)
        });
      }
    }
    return sentences.sort((a, b) => a.mappingInfo.position - b.mappingInfo.position);
  }

  /**
   * Get mapping statistics
   */
  getStatistics() {
    if (!this.isInitialized) {
      return { error: 'Mapper not initialized' };
    }

    const confidenceStats = {
      high: 0,    // > 0.8
      medium: 0,  // 0.5 - 0.8
      low: 0,     // 0.2 - 0.5
      poor: 0     // < 0.2
    };

    const matchTypeStats = {};

    for (const mapping of this.sentencePositionMap.values()) {
      // Confidence distribution
      if (mapping.confidence > 0.8) confidenceStats.high++;
      else if (mapping.confidence > 0.5) confidenceStats.medium++;
      else if (mapping.confidence > 0.2) confidenceStats.low++;
      else confidenceStats.poor++;

      // Match type distribution
      matchTypeStats[mapping.matchType] = (matchTypeStats[mapping.matchType] || 0) + 1;
    }

    return {
      totalSentences: this.sentencePageMap.size,
      totalPages: this.pageTextCache.size,
      confidenceDistribution: confidenceStats,
      matchTypeDistribution: matchTypeStats,
      averageConfidence: Array.from(this.sentencePositionMap.values())
        .reduce((sum, mapping) => sum + mapping.confidence, 0) / this.sentencePositionMap.size
    };
  }
}

export default SentencePDFMapper;