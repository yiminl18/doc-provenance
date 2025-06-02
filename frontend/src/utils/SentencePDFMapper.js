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

    this.provenanceSentences = new Set(); // Set of sentence IDs that are part of provenances
    this.activeProvenanceId = null; // Currently highlighted provenance
    this.provenanceMap = new Map(); // Maps provenance ID to sentence IDs
    this.sentenceProvenanceMap = new Map(); // Maps sentence ID to provenance IDs
    this.provenanceMetadata = new Map(); // Store provenance metadata
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
   * Register a provenance with its sentence IDs
   * @param {string|number} provenanceId - Unique provenance identifier
   * @param {Array<number>} sentenceIds - Array of sentence IDs in this provenance
   * @param {Object} metadata - Optional metadata (confidence, type, etc.)
   */
  registerProvenance(provenanceId, sentenceIds, metadata = {}) {
    console.log(`🏷️ Registering provenance ${provenanceId} with ${sentenceIds.length} sentences`);

    // Store provenance mapping
    this.provenanceMap.set(provenanceId, sentenceIds);
    this.provenanceMetadata.set(provenanceId, {
      ...metadata,
      registeredAt: Date.now(),
      sentenceCount: sentenceIds.length
    });

    // Add all sentences to the provenance sentences set
    sentenceIds.forEach(sentenceId => {
      this.provenanceSentences.add(sentenceId);

      // Track which provenances each sentence belongs to
      if (!this.sentenceProvenanceMap.has(sentenceId)) {
        this.sentenceProvenanceMap.set(sentenceId, new Set());
      }
      this.sentenceProvenanceMap.get(sentenceId).add(provenanceId);
    });

    console.log(`✅ Provenance ${provenanceId} registered successfully`);
    console.log(`📊 Total provenance sentences: ${this.provenanceSentences.size}`);
  }

  /**
   * Set the active provenance for highlighting
   * @param {string|number} provenanceId - Provenance to highlight
   */
  setActiveProvenance(provenanceId) {
    if (provenanceId && !this.provenanceMap.has(provenanceId)) {
      console.warn(`⚠️ Provenance ${provenanceId} not found in registered provenances`);
      return false;
    }

    this.activeProvenanceId = provenanceId;
    console.log(`🎯 Active provenance set to: ${provenanceId}`);
    return true;
  }

  /**
   * Clear the active provenance
   */
  clearActiveProvenance() {
    this.activeProvenanceId = null;
    console.log('🔄 Active provenance cleared');
  }

  /**
   * Check if a sentence is part of any provenance
   * @param {number} sentenceId - Sentence ID to check
   * @returns {boolean}
   */
  isProvenanceSentence(sentenceId) {
    return this.provenanceSentences.has(sentenceId);
  }

  /**
   * Check if a sentence is part of the active provenance
   * @param {number} sentenceId - Sentence ID to check
   * @returns {boolean}
   */
  isActiveProvenanceSentence(sentenceId) {
    if (!this.activeProvenanceId) return false;
    const activeSentences = this.provenanceMap.get(this.activeProvenanceId) || [];
    return activeSentences.includes(sentenceId);
  }

  /**
   * Get all provenances that contain a specific sentence
   * @param {number} sentenceId - Sentence ID
   * @returns {Array} Array of provenance IDs
   */
  getProvenancesForSentence(sentenceId) {
    const provenances = this.sentenceProvenanceMap.get(sentenceId);
    return provenances ? Array.from(provenances) : [];
  }

  /**
   * Get the primary page for a provenance (page with most sentences)
   * @param {string|number} provenanceId - Provenance ID
   * @returns {number} Page number
   */
  getPrimaryPageForProvenance(provenanceId) {
    const sentenceIds = this.provenanceMap.get(provenanceId);
    if (!sentenceIds || sentenceIds.length === 0) return 1;

    // Count sentences per page
    const pageCount = new Map();
    sentenceIds.forEach(sentenceId => {
      const pageNum = this.getPageForSentence(sentenceId);
      pageCount.set(pageNum, (pageCount.get(pageNum) || 0) + 1);
    });

    // Find page with most sentences
    let maxCount = 0;
    let primaryPage = 1;
    for (const [pageNum, count] of pageCount) {
      if (count > maxCount) {
        maxCount = count;
        primaryPage = pageNum;
      }
    }

    console.log(`📄 Primary page for provenance ${provenanceId}: ${primaryPage} (${maxCount}/${sentenceIds.length} sentences)`);
    return primaryPage;
  }

  /**
   * Get all pages that contain sentences from a provenance
   * @param {string|number} provenanceId - Provenance ID
   * @returns {Array} Array of page numbers with sentence counts
   */
  getPagesForProvenance(provenanceId) {
    const sentenceIds = this.provenanceMap.get(provenanceId);
    if (!sentenceIds || sentenceIds.length === 0) return [];

    const pageData = new Map();
    sentenceIds.forEach(sentenceId => {
      const pageNum = this.getPageForSentence(sentenceId);
      if (!pageData.has(pageNum)) {
        pageData.set(pageNum, {
          pageNum,
          sentenceIds: [],
          count: 0
        });
      }
      pageData.get(pageNum).sentenceIds.push(sentenceId);
      pageData.get(pageNum).count++;
    });

    return Array.from(pageData.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Get provenance statistics
   * @returns {Object} Statistics about provenances
   */
  getProvenanceStatistics() {
    const stats = {
      totalProvenances: this.provenanceMap.size,
      totalProvenanceSentences: this.provenanceSentences.size,
      activeProvenance: this.activeProvenanceId,
      provenanceDetails: []
    };

    for (const [provenanceId, sentenceIds] of this.provenanceMap) {
      const pages = this.getPagesForProvenance(provenanceId);
      const metadata = this.provenanceMetadata.get(provenanceId) || {};

      stats.provenanceDetails.push({
        provenanceId,
        sentenceCount: sentenceIds.length,
        pageCount: pages.length,
        primaryPage: pages[0]?.pageNum || 1,
        pageDistribution: pages.map(p => ({ page: p.pageNum, sentences: p.count })),
        metadata
      });
    }

    return stats;
  }

  /**
   * Get sentences on a page with provenance information
   * @param {number} pageNum - Page number
   * @returns {Array} Array of sentences with provenance flags
   */
  getSentencesOnPageWithProvenance(pageNum) {
    const sentences = [];
    for (const [sentenceId, mappedPage] of this.sentencePageMap) {
      if (mappedPage === pageNum) {
        const mappingInfo = this.sentencePositionMap.get(sentenceId);
        const isProvenance = this.isProvenanceSentence(sentenceId);
        const isActive = this.isActiveProvenanceSentence(sentenceId);
        const provenances = this.getProvenancesForSentence(sentenceId);

        sentences.push({
          sentenceId,
          mappingInfo,
          isProvenanceSentence: isProvenance,
          isActiveProvenanceSentence: isActive,
          provenanceIds: provenances,
          provenanceCount: provenances.length
        });
      }
    }
    return sentences.sort((a, b) => a.mappingInfo.position - b.mappingInfo.position);
  }

  /**
   * Bulk register multiple provenances
   * @param {Array} provenances - Array of {id, sentenceIds, metadata} objects
   */
  registerMultipleProvenances(provenances) {
    console.log(`🏷️ Bulk registering ${provenances.length} provenances`);

    provenances.forEach((provenance, index) => {
      const { id, sentenceIds, metadata = {} } = provenance;
      this.registerProvenance(id, sentenceIds, {
        ...metadata,
        bulkIndex: index
      });
    });

    console.log(`✅ Bulk registration complete: ${this.provenanceMap.size} total provenances`);
  }

  /**
   * Clear all provenance data
   */
  clearAllProvenances() {
    this.provenanceSentences.clear();
    this.activeProvenanceId = null;
    this.provenanceMap.clear();
    this.sentenceProvenanceMap.clear();
    this.provenanceMetadata.clear();
    console.log('🧹 All provenance data cleared');
  }

  /**
   * Export provenance mappings for debugging
   * @returns {Object} Exportable provenance data
   */
  exportProvenanceMappings() {
    return {
      provenances: Object.fromEntries(this.provenanceMap),
      sentenceToProvenance: Object.fromEntries(
        Array.from(this.sentenceProvenanceMap.entries()).map(
          ([sentenceId, provenanceSet]) => [sentenceId, Array.from(provenanceSet)]
        )
      ),
      metadata: Object.fromEntries(this.provenanceMetadata),
      activeProvenance: this.activeProvenanceId,
      statistics: this.getProvenanceStatistics()
    };
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
 * Map sentences to pages while preserving reading order
 */
async mapSentencesToPages(sentences) {
  console.log('🗺️ Starting reading-order-aware sentence mapping...');
  
  if (!sentences || sentences.length === 0) {
    console.warn('⚠️ No sentences provided for mapping');
    return;
  }

  // First pass: establish page boundaries based on content flow
  const pageStartSentences = this.findPageBoundaries(sentences);
  
  // Second pass: map sentences with reading order constraints
  let currentExpectedPage = 1;
  let sentencesOnCurrentPage = 0;
  const maxSentencesPerPage = Math.ceil(sentences.length / this.pageTextCache.size) * 1.5;

  sentences.forEach((sentence, sentenceId) => {
    if (!sentence || typeof sentence !== 'string') {
      console.warn(`⚠️ Invalid sentence at index ${sentenceId}`);
      this.sentencePageMap.set(sentenceId, currentExpectedPage);
      return;
    }

    // Find best match with reading order constraints
    const mapping = this.findBestPageMatchWithOrder(
      sentence, 
      sentenceId, 
      currentExpectedPage,
      pageStartSentences
    );

    // Update expected page based on content density
    if (sentencesOnCurrentPage > maxSentencesPerPage) {
      currentExpectedPage = Math.min(currentExpectedPage + 1, this.pageTextCache.size);
      sentencesOnCurrentPage = 0;
    }

    // Don't allow backwards page jumps (preserve reading order)
    const finalPage = Math.max(mapping.pageNum, currentExpectedPage);
    
    this.sentencePageMap.set(sentenceId, finalPage);
    this.sentencePositionMap.set(sentenceId, {
      ...mapping,
      pageNum: finalPage,
      originalPageNum: mapping.pageNum,
      orderCorrected: finalPage !== mapping.pageNum
    });

    if (finalPage === currentExpectedPage) {
      sentencesOnCurrentPage++;
    } else {
      currentExpectedPage = finalPage;
      sentencesOnCurrentPage = 1;
    }
  });

  //this.logMappingStatistics(sentences.length);
}

/**
 * Find page boundaries by detecting content transitions
 */
findPageBoundaries(sentences) {
  const boundaries = new Set([0]); // First sentence always starts a page
  
  // Look for sentences that likely start new pages
  sentences.forEach((sentence, index) => {
    if (this.isLikelyPageStart(sentence, sentences[index - 1])) {
      boundaries.add(index);
    }
  });

  return boundaries;
}

/**
 * Check if a sentence likely starts a new page
 */
isLikelyPageStart(sentence, prevSentence) {
  if (!sentence || !prevSentence) return false;
  
  const currentWords = sentence.toLowerCase().split(/\s+/);
  const prevWords = prevSentence.toLowerCase().split(/\s+/);
  
  // Heuristics for page starts:
  // 1. Very different vocabulary (topic change)
  const commonWords = currentWords.filter(word => prevWords.includes(word));
  const vocabularyOverlap = commonWords.length / Math.max(currentWords.length, 1);
  
  // 2. Starts with section headers or common page-start patterns
  const pageStartPatterns = [
    /^(abstract|introduction|methodology|results|conclusion|references)/i,
    /^(chapter|section|appendix|\d+\.)/i,
    /^(table|figure|\[)/i
  ];
  
  const hasPageStartPattern = pageStartPatterns.some(pattern => 
    pattern.test(sentence.trim())
  );
  
  return vocabularyOverlap < 0.3 || hasPageStartPattern;
}

/**
 * Find best page match while respecting reading order
 */
findBestPageMatchWithOrder(sentence, sentenceId, expectedPage, pageStartSentences) {
  const cleanSentence = this.cleanText(sentence);
  
  // Search pages in order: expected, expected+1, expected-1, etc.
  const searchOrder = this.generateSearchOrder(expectedPage, this.pageTextCache.size);
  
  let bestMatch = {
    pageNum: expectedPage,
    confidence: 0,
    position: 0,
    matchType: 'order_fallback'
  };

  for (const pageNum of searchOrder) {
    const pageData = this.pageTextCache.get(pageNum);
    if (!pageData) continue;

    // Try exact match first
    const exactMatch = this.findExactMatch(cleanSentence, pageData.fullText);
    if (exactMatch.confidence > 0.8) {
      return {
        pageNum,
        confidence: exactMatch.confidence,
        position: exactMatch.position,
        matchType: 'exact',
        searchRank: searchOrder.indexOf(pageNum)
      };
    }

    // Keep track of best match found so far
    if (exactMatch.confidence > bestMatch.confidence) {
      bestMatch = {
        pageNum,
        confidence: exactMatch.confidence,
        position: exactMatch.position,
        matchType: 'partial',
        searchRank: searchOrder.indexOf(pageNum)
      };
    }
  }

  // If no good match found, try word overlap on expected page
  if (bestMatch.confidence < 0.5) {
    const pageData = this.pageTextCache.get(expectedPage);
    if (pageData) {
      const wordMatch = this.findWordOverlapMatch(cleanSentence, pageData.fullText);
      if (wordMatch.confidence > bestMatch.confidence) {
        bestMatch = {
          pageNum: expectedPage,
          confidence: wordMatch.confidence,
          position: wordMatch.position,
          matchType: 'word_overlap_expected'
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Generate page search order (expected page first, then nearby pages)
 */
generateSearchOrder(expectedPage, totalPages) {
  const order = [expectedPage];
  
  for (let offset = 1; offset <= totalPages; offset++) {
    // Add pages after expected page
    if (expectedPage + offset <= totalPages) {
      order.push(expectedPage + offset);
    }
    // Add pages before expected page (but don't go backwards too far)
    if (expectedPage - offset >= 1 && offset <= 2) {
      order.push(expectedPage - offset);
    }
    
    if (order.length >= totalPages) break;
  }
  
  return order;
}

/**
 * Enhanced method to prevent duplicate mappings to headers
 */
findExactMatch(sentence, pageText) {
  // Skip very short sentences that are likely headers/footers
  if (sentence.length < 20) {
    const headerPatterns = [
      /^(page|\d+|chapter|section|table|figure)/i,
      /^\d+$/,
      /^[a-z\s]{1,15}$/i
    ];
    
    if (headerPatterns.some(pattern => pattern.test(sentence.trim()))) {
      return { 
        confidence: 0.3, // Lower confidence for likely headers
        position: 0, 
        matchedText: sentence.substring(0, 20),
        isLikelyHeader: true
      };
    }
  }

  // Regular exact matching logic
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
        matchedText: substring,
        isLikelyHeader: false
      };
    }
  }

  return { confidence: 0, position: 0, matchedText: '', isLikelyHeader: false };
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