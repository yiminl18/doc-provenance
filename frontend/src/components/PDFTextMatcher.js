// PDFTextMatcher.js - Modular text matching utilities for PDF.js text layers
// Separates text matching algorithms from highlighting logic

/**
 * Main PDFTextMatcher class - handles all text matching strategies
 */
export class PDFTextMatcher {
  constructor(options = {}) {
    this.options = {
      minMatchLength: options.minMatchLength || 3,
      fuzzyThreshold: options.fuzzyThreshold || 0.6,
      maxCandidates: options.maxCandidates || 20,
      debug: options.debug || false,
      ...options
    };
  }

  /**
   * Main entry point - finds all matches using multiple strategies
   * @param {NodeList|Array} textElements - PDF.js text layer elements
   * @param {string} searchText - Text to search for
   * @returns {Array} Array of match objects with confidence scores
   */
  findMatches(textElements, searchText, answerText) {
    if (!searchText || searchText.length < this.options.minMatchLength) {
      return [];
    }

    const validElements = this._getValidElements(textElements);
    if (validElements.length === 0) {
      return [];
    }

    this._log(`🔍 Finding matches for: "${searchText.substring(0, 100)}..."`);
    this._log(`📊 Searching ${validElements.length} valid text elements`);

    let allMatches = [];

    // Strategy 1: Simple exact matching (highest priority)
    const simpleMatches = this._findSimpleMatches(validElements, searchText);
    allMatches.push(...simpleMatches);

    // If we found good simple matches, we might be done
    if (simpleMatches.some(m => m.confidence > 0.9)) {
      this._log(`✅ Found high-confidence simple matches, stopping early`);
      return this._dedupAndSort(allMatches);
    }

    // Strategy 2: Answer extraction for long provenance
    if (searchText.length > 50 && allMatches.length < 3) {
      const answerMatches = this._findAnswerMatches(validElements, searchText);
      allMatches.push(...answerMatches);
    }

    // Strategy 3: Phrase matching
    if (allMatches.length < 3) {
      const phraseMatches = this._findPhraseMatches(validElements, searchText);
      allMatches.push(...phraseMatches);
    }

    // Strategy 4: Word-based matching
    if (allMatches.length < 5) {
      const wordMatches = this._findWordMatches(validElements, searchText);
      allMatches.push(...wordMatches);
    }

    // Strategy 5: Fuzzy matching (last resort)
    if (allMatches.length === 0) {
      const fuzzyMatches = this._findFuzzyMatches(validElements, searchText);
      allMatches.push(...fuzzyMatches);
    }

    return this._dedupAndSort(allMatches);
  }

  /**
   * Strategy 1: Simple exact matching
   */
  _findSimpleMatches(elements, searchText) {
    const matches = [];
    const searchLower = searchText.toLowerCase().trim();

    this._log(`🎯 Simple matching for: "${searchLower.substring(0, 50)}..."`);

    for (const element of elements) {
      const elementText = element.textContent.trim();
      const elementLower = elementText.toLowerCase();

      // Exact substring match
      if (elementLower.includes(searchLower)) {
        matches.push({
          element,
          elementText,
          matchText: elementText,
          searchText: searchText,
          confidence: 1.0,
          matchType: 'exact_substring',
          strategy: 'simple'
        });
        continue;
      }

      // Reverse match (search contains element)
      if (searchLower.includes(elementLower) && elementLower.length > 3) {
        matches.push({
          element,
          elementText,
          matchText: elementText,
          searchText: searchText,
          confidence: 0.95,
          matchType: 'reverse_contains',
          strategy: 'simple'
        });
        continue;
      }

      // Case-insensitive exact match
      if (elementLower === searchLower) {
        matches.push({
          element,
          elementText,
          matchText: elementText,
          searchText: searchText,
          confidence: 1.0,
          matchType: 'exact_match',
          strategy: 'simple'
        });
      }
    }

    this._log(`✅ Simple matching: ${matches.length} matches`);
    return matches;
  }

  /**
   * Strategy 2: Answer extraction for long provenance
   */
  _findAnswerMatches(elements, longProvenance) {
    if (longProvenance.length < 50) return [];

    this._log(`🧠 Answer extraction for ${longProvenance.length} char provenance`);

    // Extract potential answers using patterns
    const answerCandidates = this._extractAnswerCandidates(longProvenance);
    
    if (answerCandidates.length === 0) return [];

    this._log(`🎯 Found ${answerCandidates.length} answer candidates: ${answerCandidates.slice(0, 3).map(c => `"${c}"`).join(', ')}...`);

    const matches = [];

    for (const candidate of answerCandidates) {
      const candidateLower = candidate.toLowerCase().trim();
      
      if (candidateLower.length < 3) continue;

      for (const element of elements) {
        const elementText = element.textContent.trim();
        const elementLower = elementText.toLowerCase();

        // Exact match with answer candidate
        if (elementLower === candidateLower) {
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: candidate,
            confidence: 0.98,
            matchType: 'answer_exact',
            strategy: 'answer_extraction',
            answerCandidate: candidate
          });
        }
        // Element contains candidate
        else if (elementLower.includes(candidateLower) && candidateLower.length > 5) {
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: candidate,
            confidence: 0.9,
            matchType: 'answer_contains',
            strategy: 'answer_extraction',
            answerCandidate: candidate
          });
        }
        // Candidate contains element
        else if (candidateLower.includes(elementLower) && elementLower.length > 5) {
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: candidate,
            confidence: 0.85,
            matchType: 'answer_partial',
            strategy: 'answer_extraction',
            answerCandidate: candidate
          });
        }
      }
    }

    this._log(`✅ Answer extraction: ${matches.length} matches`);
    return matches;
  }

  /**
   * Strategy 3: Phrase matching (for medium-length text)
   */
  _findPhraseMatches(elements, searchText) {
    const matches = [];
    const searchLower = searchText.toLowerCase().trim();

    this._log(`📝 Phrase matching for: "${searchLower.substring(0, 50)}..."`);

    // Split search text into meaningful phrases
    const phrases = this._extractPhrases(searchText);

    for (const phrase of phrases) {
      const phraseLower = phrase.toLowerCase().trim();
      
      if (phraseLower.length < 10) continue; // Skip short phrases

      for (const element of elements) {
        const elementText = element.textContent.trim();
        const elementLower = elementText.toLowerCase();

        if (elementLower.includes(phraseLower)) {
          const confidence = Math.min(0.8, phraseLower.length / searchLower.length);
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: phrase,
            confidence,
            matchType: 'phrase_match',
            strategy: 'phrase',
            phrase: phrase
          });
        }
      }
    }

    this._log(`✅ Phrase matching: ${matches.length} matches`);
    return matches;
  }

  /**
   * Strategy 4: Word-based matching
   */
  _findWordMatches(elements, searchText) {
    const matches = [];
    const searchWords = this._extractWords(searchText);

    if (searchWords.length === 0) return [];

    this._log(`🔤 Word matching with ${searchWords.length} words: [${searchWords.slice(0, 5).join(', ')}...]`);

    for (const element of elements) {
      const elementText = element.textContent.trim();
      const elementWords = this._extractWords(elementText);

      if (elementWords.length === 0) continue;

      // Find matching words
      const matchingWords = searchWords.filter(searchWord =>
        elementWords.some(elementWord => {
          // Exact match
          if (elementWord === searchWord) return true;
          // Fuzzy word match for longer words
          if (searchWord.length > 4 && elementWord.length > 4) {
            return this._calculateSimilarity(searchWord, elementWord) > 0.8;
          }
          // Substring match
          return (searchWord.includes(elementWord) && elementWord.length > 3) ||
                 (elementWord.includes(searchWord) && searchWord.length > 3);
        })
      );

      if (matchingWords.length > 0) {
        const confidence = matchingWords.length / searchWords.length;
        
        if (confidence >= 0.3) { // Minimum threshold
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: searchText,
            confidence: Math.min(0.75, confidence), // Cap at 0.75 for word matches
            matchType: 'word_match',
            strategy: 'word',
            matchingWords,
            totalWords: searchWords.length
          });
        }
      }
    }

    this._log(`✅ Word matching: ${matches.length} matches`);
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Strategy 5: Fuzzy matching (last resort)
   */
  _findFuzzyMatches(elements, searchText) {
    const matches = [];
    const searchChunks = this._createSearchChunks(searchText);

    this._log(`🔄 Fuzzy matching with ${searchChunks.length} chunks`);

    for (const element of elements) {
      const elementText = element.textContent.trim();
      
      if (elementText.length < 5) continue;

      for (const chunk of searchChunks) {
        const similarity = this._calculateSimilarity(
          elementText.toLowerCase(),
          chunk.toLowerCase()
        );

        if (similarity > this.options.fuzzyThreshold) {
          matches.push({
            element,
            elementText,
            matchText: elementText,
            searchText: chunk,
            confidence: similarity * 0.6, // Reduce confidence for fuzzy matches
            matchType: 'fuzzy_match',
            strategy: 'fuzzy',
            similarity,
            searchChunk: chunk
          });
          break; // Don't double-match same element
        }
      }
    }

    this._log(`✅ Fuzzy matching: ${matches.length} matches`);
    return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  _getValidElements(elements) {
    return Array.from(elements).filter(element => {
      const text = element.textContent?.trim();
      return text && text.length > 0 && !/^\s*$/.test(text);
    });
  }

  _extractAnswerCandidates(text) {
    const candidates = [];

    // Common answer patterns
    const patterns = [
      // Dates and times
      /\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
      /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?\b/g,
      /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g,
      
      // Numbers with units
      /\b\d+(?:\.\d+)?\s*(?:kg|lbs|mph|%|degrees?|feet|inches|meters|miles|km)\b/gi,
      
      // Currency
      /\$\d+(?:\.\d{2})?\b/g,
      
      // IDs and codes
      /\b[A-Z]{2,}-?\d{4,}\b/g,
      /\b\d{4,}[A-Z]{1,3}\b/g,
      
      // Phone numbers
      /\b\d{3}-?\d{3}-?\d{4}\b/g
    ];

    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        candidates.push(...matches);
      }
    });

    // Key-value pairs (e.g., "Date/Time: 10/30/2022")
    const keyValueMatches = text.match(/([A-Za-z\/\s]+):\s*([^.,\n]{2,30})/g);
    if (keyValueMatches) {
      keyValueMatches.forEach(kv => {
        const match = kv.match(/([A-Za-z\/\s]+):\s*([^.,\n]{2,30})/);
        if (match && match[2]) {
          candidates.push(match[2].trim());
        }
      });
    }

    // Remove duplicates and filter
    return [...new Set(candidates)]
      .filter(c => c.trim().length > 2)
      .slice(0, this.options.maxCandidates);
  }

  _extractPhrases(text) {
    const phrases = [];

    // Split by sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    phrases.push(...sentences.map(s => s.trim()));

    // Split by semicolons and commas for longer text
    if (text.length > 100) {
      const clauses = text.split(/[;,]+/).filter(s => s.trim().length > 15);
      phrases.push(...clauses.map(s => s.trim()));
    }

    return phrases.slice(0, 10); // Limit phrases
  }

  _extractWords(text) {
    return text.toLowerCase()
      .split(/\b/)
      .filter(w => /^\w+$/.test(w) && w.length > 2) // Only alphanumeric words > 2 chars
      .slice(0, 50); // Limit words to prevent performance issues
  }

  _createSearchChunks(text) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);

    chunks.push(...sentences);

    // For long sentences, create overlapping word chunks
    sentences.forEach(sentence => {
      if (sentence.length > 80) {
        const words = this._extractWords(sentence);
        for (let i = 0; i < words.length - 4; i += 3) {
          const chunk = words.slice(i, i + 8).join(' ');
          if (chunk.length > 20) {
            chunks.push(chunk);
          }
        }
      }
    });

    return chunks.slice(0, 20); // Limit chunks
  }

  _calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    // Levenshtein distance based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    const editDistance = this._levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  _levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,     // deletion
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  _dedupAndSort(matches) {
    // Remove duplicate elements (same DOM element matched multiple times)
    const uniqueMatches = [];
    const seenElements = new Set();

    for (const match of matches) {
      const elementKey = this._getElementKey(match.element);
      if (!seenElements.has(elementKey)) {
        seenElements.add(elementKey);
        uniqueMatches.push(match);
      } else {
        // If we've seen this element, keep the match with higher confidence
        const existingIndex = uniqueMatches.findIndex(m => 
          this._getElementKey(m.element) === elementKey
        );
        if (existingIndex >= 0 && match.confidence > uniqueMatches[existingIndex].confidence) {
          uniqueMatches[existingIndex] = match;
        }
      }
    }

    // Sort by confidence descending
    return uniqueMatches.sort((a, b) => b.confidence - a.confidence);
  }

  _getElementKey(element) {
    // Create unique key for element
    return element.textContent + (element.style?.left || '') + (element.style?.top || '');
  }

  _log(message) {
    if (this.options.debug) {
      console.log(message);
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick text matching function
 * @param {NodeList|Array} textElements 
 * @param {string} searchText 
 * @param {Object} options 
 * @returns {Array} matches
 */
export function findTextMatches(textElements, searchText, options = {}) {
  const matcher = new PDFTextMatcher(options);
  return matcher.findMatches(textElements, searchText);
}

/**
 * Find only high-confidence matches
 * @param {NodeList|Array} textElements 
 * @param {string} searchText 
 * @param {number} minConfidence 
 * @returns {Array} matches
 */
export function findHighConfidenceMatches(textElements, searchText, minConfidence = 0.8) {
  const matches = findTextMatches(textElements, searchText, { debug: true });
  return matches.filter(match => match.confidence >= minConfidence);
}

/**
 * Find matches specifically for answer text (shorter, structured)
 * @param {NodeList|Array} textElements 
 * @param {string} answerText 
 * @returns {Array} matches
 */
export function findAnswerMatches(textElements, answerText) {
  const matcher = new PDFTextMatcher({ 
    debug: true,
    minMatchLength: 2, // Allow shorter matches for answers
    maxCandidates: 5   // Fewer candidates for focused search
  });
  
  // Try simple matching first
  const simpleMatches = matcher._findSimpleMatches(
    matcher._getValidElements(textElements), 
    answerText
  );
  
  if (simpleMatches.length > 0) {
    return simpleMatches;
  }
  
  // Fall back to full matching
  return matcher.findMatches(textElements, answerText);
}

/**
 * Test function for debugging specific cases
 * @param {NodeList|Array} textElements 
 * @param {Array} testCases 
 */
export function testTextMatching(textElements, testCases = []) {
  const defaultTestCases = [
    "Date/Time:",
    "10/30/2022 06:16:00",
    "Date/Time: 10/30/2022 06:16:00",
    "ECCE 2019",
    "Association for Computing Machinery"
  ];

  const cases = testCases.length > 0 ? testCases : defaultTestCases;
  
  console.log('🧪 Testing text matching with cases:', cases);

  cases.forEach((testCase, index) => {
    console.log(`\n--- Test ${index + 1}: "${testCase}" ---`);
    
    const matches = findTextMatches(textElements, testCase, { debug: true });
    
    if (matches.length > 0) {
      console.log(`✅ Found ${matches.length} matches:`);
      matches.slice(0, 3).forEach((match, i) => {
        console.log(`   ${i + 1}. "${match.elementText}" (${match.matchType}, conf: ${match.confidence.toFixed(2)})`);
      });
    } else {
      console.log(`❌ No matches found`);
    }
  });
}

export default PDFTextMatcher;