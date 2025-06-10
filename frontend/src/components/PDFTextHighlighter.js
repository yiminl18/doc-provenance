// PDFTextHighlighter.js - Text search-based highlighting for PDF.js
import React, { useState, useEffect, useRef } from 'react';
import { findTextMatches, findHighConfidenceMatches, testTextMatching } from './PDFTextMatcher';
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
            //console.log('🎯 PDFTextHighlighter: Creating highlights for provenance:', provenanceId);
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

// 1. Replace your highlightProvenanceText function with this:
const highlightProvenanceText = async (searchText, highlightId) => {
  // Use the enhanced version
  return await highlightProvenanceTextEnhanced(searchText, highlightId);
};


// 3. Add confidence threshold filtering to your continuous line highlighting:
const createHighlightElements = (highlights, highlightId) => {
  if (!highlightLayerRef?.current) return;

  // Filter out highlights with very low confidence before creating visual elements
  const qualityHighlights = highlights.filter(h => {
    if (h.confidence >= 0.5) return true; // Always keep high confidence

    
    //console.log(`❌ Filtering low confidence match: "${h.matchText.substring(0, 30)}..." (conf: ${h.confidence.toFixed(2)})`);
    return false;
  });

  console.log(`📊 Quality filter: ${highlights.length} → ${qualityHighlights.length} highlights`);

  // Use the enhanced continuous line highlighting
  createContinuousLineHighlights(qualityHighlights, highlightId);
};


    const highlightProvenanceTextWithGapFilling = async (searchText, highlightId) => {
        if (!searchText || searchText.length < 5) {
            console.log('⚠️ Search text too short, skipping');
            return;
        }

        clearHighlights();
        console.log(`🔍 Enhanced search with gap filling for: "${searchText.substring(0, 100)}..."`);

        try {
            await waitForTextLayer();

            // Get all text elements and index them
            const textDivs = getValidTextElements();
            console.log(`📄 Found ${textDivs.length} valid text elements`);

            if (textDivs.length === 0) {
                console.warn('⚠️ No text elements found');
                createFallbackHighlight(searchText, highlightId);
                return;
            }

            // Create indexed text elements for gap filling
            const indexedTextDivs = textDivs.map((element, index) => ({
                element,
                index,
                text: element.textContent.trim(),
                position: getElementPosition(element),
                matched: false // Track which elements we've matched
            }));

            console.log(`📊 Created ${indexedTextDivs.length} indexed text elements`);

            const highlights = [];

            // Phase 1: Initial matching (exact, partial, word-based)
            const initialMatches = findInitialMatches(indexedTextDivs, searchText);
            highlights.push(...initialMatches);

            // Mark initial matches as used
            initialMatches.forEach(match => {
                if (match.elementIndex !== undefined) {
                    indexedTextDivs[match.elementIndex].matched = true;
                }
            });

            console.log(`✅ Phase 1: Found ${initialMatches.length} initial matches`);

            // Phase 2: Gap filling - find the best cluster and fill gaps
            if (initialMatches.length > 0) {
                const clusteredMatches = findBestMatchClusterWithGaps(indexedTextDivs, initialMatches, searchText);

                if (clusteredMatches.length > initialMatches.length) {
                    console.log(`🔄 Phase 2: Gap filling added ${clusteredMatches.length - initialMatches.length} additional matches`);

                    // Replace highlights with gap-filled version
                    highlights.length = 0;
                    highlights.push(...clusteredMatches);
                }
            }

            // Phase 3: Final fallback if still no good matches
            if (highlights.length === 0) {
                console.log(`🔄 Phase 3: No matches found, trying fuzzy matching...`);
                const fuzzyMatches = findFuzzyMatches(indexedTextDivs, searchText);
                highlights.push(...fuzzyMatches);
            }

            if (highlights.length > 0) {
                console.log(`✅ Final result: ${highlights.length} highlights created`);
                createHighlightElements(highlights, highlightId);
                setActiveHighlights(highlights);
                setHighlightsPersisted(true);
            } else {
                console.log('⚠️ No matches found, creating fallback');
                createFallbackHighlight(searchText, highlightId);
            }

        } catch (error) {
            console.error('❌ Error in enhanced highlighting:', error);
            createFallbackHighlight(searchText, highlightId);
        }
    };

    const getValidTextElements = () => {
        const selectors = ['span[dir="ltr"]', 'span', 'div'];
        let textDivs = [];

        for (const selector of selectors) {
            textDivs = Array.from(textLayerRef.current.querySelectorAll(selector));
            if (textDivs.length > 0) break;
        }

        // Filter out whitespace-only elements
        return textDivs.filter(element => {
            const text = element.textContent.trim();
            return text.length > 0 && !/^\s*$/.test(text);
        });
    };

    const getElementPosition = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        // Try to extract position from PDF.js inline styles
        const leftMatch = element.style.left.match(/(\d+\.?\d*)%/);
        const topMatch = element.style.top.match(/(\d+\.?\d*)%/);

        const left = leftMatch ? parseFloat(leftMatch[1]) : (rect.left / window.innerWidth) * 100;
        const top = topMatch ? parseFloat(topMatch[1]) : (rect.top / window.innerHeight) * 100;

        return { left, top, rect };
    };

    const findInitialMatches = (indexedTextDivs, searchText) => {
        const matches = [];
        const searchLower = searchText.toLowerCase().trim();

        console.log(`🔍 Phase 1: Initial matching for "${searchLower.substring(0, 50)}..."`);

        // Exact and partial phrase matches
        indexedTextDivs.forEach((indexedDiv) => {
            const elementText = indexedDiv.text.toLowerCase();

            // Exact match
            if (elementText.includes(searchLower)) {
                matches.push({
                    ...indexedDiv,
                    elementIndex: indexedDiv.index,
                    confidence: 1.0,
                    matchType: 'exact_phrase',
                    matchText: indexedDiv.text,
                    searchText: searchText.substring(0, 50)
                });
                return;
            }

            // Partial phrase match (for longer text)
            if (searchLower.length > 20) {
                const partialLength = Math.floor(searchLower.length * 0.7);
                for (let start = 0; start <= searchLower.length - partialLength; start += 10) {
                    const partial = searchLower.substring(start, start + partialLength);
                    if (partial.length > 15 && elementText.includes(partial)) {
                        matches.push({
                            ...indexedDiv,
                            elementIndex: indexedDiv.index,
                            confidence: 0.8,
                            matchType: 'partial_phrase',
                            matchText: indexedDiv.text,
                            searchText: partial
                        });
                        return;
                    }
                }
            }
        });

        // Word-based matching if no phrase matches
        if (matches.length === 0) {
            const searchWords = searchText.toLowerCase().split(/\b/).filter(w => /\w+/.test(w));

            indexedTextDivs.forEach((indexedDiv) => {
                const elementText = indexedDiv.text.toLowerCase();
                const elementWords = elementText.split(/\b/).filter(w => /\w+/.test(w));

                const matchingWords = searchWords.filter(searchWord =>
                    elementWords.some(elementWord =>
                        elementWord.includes(searchWord) || searchWord.includes(elementWord)
                    )
                );

                if (matchingWords.length > 0) {
                    const confidence = matchingWords.length / searchWords.length;

                    if (confidence >= 0.3) {
                        matches.push({
                            ...indexedDiv,
                            elementIndex: indexedDiv.index,
                            confidence,
                            matchType: 'word_match',
                            matchText: indexedDiv.text,
                            matchingWords: matchingWords,
                            totalWords: searchWords.length
                        });
                    }
                }
            });
        }

        console.log(`📊 Phase 1 complete: ${matches.length} initial matches found`);
        return matches.sort((a, b) => b.confidence - a.confidence);
    };

    const findBestMatchClusterWithGaps = (indexedTextDivs, initialMatches, originalProvenanceText) => {
        if (initialMatches.length === 0) return [];

        console.log(`🔄 Gap filling: Starting with ${initialMatches.length} initial matches`);

        // Sort initial matches by position (reading order)
        const sortedMatches = initialMatches.sort((a, b) => {
            if (Math.abs(a.position.top - b.position.top) < 1) {
                return a.position.left - b.position.left;
            }
            return a.position.top - b.position.top;
        });

        console.log(`📍 Sorted matches by position:`);
        sortedMatches.forEach((match, i) => {
            console.log(`   ${i}: "${match.matchText.substring(0, 30)}..." at (${match.position.left.toFixed(1)}%, ${match.position.top.toFixed(1)}%)`);
        });

        // Find gaps between consecutive matches
        const gaps = findGapsBetweenMatches(sortedMatches, indexedTextDivs);
        console.log(`🕳️ Found ${gaps.length} gaps to potentially fill`);

        // Test gap elements against the provenance text
        const gapMatches = testGapElements(gaps, originalProvenanceText, indexedTextDivs);
        console.log(`✅ Gap testing found ${gapMatches.length} additional matches`);

        // Combine initial matches with gap matches
        const allMatches = [...sortedMatches, ...gapMatches];

        // Re-sort by position
        const finalMatches = allMatches.sort((a, b) => {
            if (Math.abs(a.position.top - b.position.top) < 1) {
                return a.position.left - b.position.left;
            }
            return a.position.top - b.position.top;
        });

        // Validate the final sequence makes sense
        const validatedMatches = validateMatchSequence(finalMatches, originalProvenanceText);

        console.log(`🏆 Gap filling complete: ${initialMatches.length} → ${validatedMatches.length} matches`);

        return validatedMatches;
    };

    const findGapsBetweenMatches = (sortedMatches, indexedTextDivs) => {
        const gaps = [];

        for (let i = 0; i < sortedMatches.length - 1; i++) {
            const currentMatch = sortedMatches[i];
            const nextMatch = sortedMatches[i + 1];

            const currentIndex = currentMatch.elementIndex;
            const nextIndex = nextMatch.elementIndex;

            // If there's a gap in indices, collect the unmatched elements in between
            if (nextIndex - currentIndex > 1) {
                const gapElements = [];

                for (let j = currentIndex + 1; j < nextIndex; j++) {
                    const gapElement = indexedTextDivs[j];
                    if (gapElement && !gapElement.matched && gapElement.text.length > 0) {
                        gapElements.push(gapElement);
                    }
                }

                if (gapElements.length > 0) {
                    gaps.push({
                        startMatch: currentMatch,
                        endMatch: nextMatch,
                        gapElements,
                        gapSize: gapElements.length
                    });

                    console.log(`🕳️ Gap ${gaps.length}: ${gapElements.length} elements between "${currentMatch.matchText.substring(0, 20)}..." and "${nextMatch.matchText.substring(0, 20)}..."`);
                }
            }
        }

        return gaps;
    };

    const testGapElements = (gaps, originalProvenanceText, indexedTextDivs) => {
        const gapMatches = [];
        const searchLower = originalProvenanceText.toLowerCase().trim();

        gaps.forEach((gap, gapIndex) => {
            console.log(`🧪 Testing gap ${gapIndex + 1}: ${gap.gapElements.length} elements`);

            gap.gapElements.forEach((gapElement) => {
                const elementText = gapElement.text.toLowerCase();

                // Test using same matching logic as initial search
                let match = null;

                // 1. Exact substring match
                if (elementText.length > 2 && searchLower.includes(elementText)) {
                    match = {
                        ...gapElement,
                        elementIndex: gapElement.index,
                        confidence: 0.9,
                        matchType: 'gap_exact',
                        matchText: gapElement.text,
                        searchText: elementText,
                        gapInfo: { gapIndex, reason: 'exact_substring' }
                    };
                }
                // 2. Partial word match
                else if (elementText.length > 3) {
                    const elementWords = elementText.split(/\b/).filter(w => /\w+/.test(w));
                    const searchWords = searchLower.split(/\b/).filter(w => /\w+/.test(w));

                    const matchingWords = elementWords.filter(elementWord =>
                        searchWords.some(searchWord =>
                            searchWord.includes(elementWord) || elementWord.includes(searchWord)
                        )
                    );

                    if (matchingWords.length > 0) {
                        const confidence = Math.min(0.7, (matchingWords.length / elementWords.length) * 0.8);

                        if (confidence >= 0.4) {
                            match = {
                                ...gapElement,
                                elementIndex: gapElement.index,
                                confidence,
                                matchType: 'gap_word',
                                matchText: gapElement.text,
                                matchingWords,
                                gapInfo: { gapIndex, reason: 'word_match' }
                            };
                        }
                    }
                }

                if (match) {
                    console.log(`   ✅ Gap match: "${match.matchText}" (${match.matchType}, conf: ${match.confidence.toFixed(2)})`);
                    gapMatches.push(match);
                    gapElement.matched = true; // Mark as matched
                }
            });
        });

        return gapMatches;
    };

    const validateMatchSequence = (matches, originalProvenanceText) => {
        // Reconstruct text from matches to validate coherence
        const reconstructedText = matches
            .map(match => match.matchText.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        const similarity = calculateTextSimilarity(reconstructedText, originalProvenanceText);

        console.log(`🔍 Sequence validation:`);
        console.log(`   📝 Reconstructed: "${reconstructedText.substring(0, 100)}..."`);
        console.log(`   📊 Similarity: ${(similarity * 100).toFixed(1)}%`);

        // Filter out matches that seem out of place if similarity is low
        if (similarity < 0.3) {
            console.log(`⚠️ Low similarity, filtering unreliable matches`);

            // Keep only high-confidence matches
            const filteredMatches = matches.filter(match =>
                match.confidence > 0.7 ||
                match.matchType.includes('exact') ||
                match.matchType.includes('partial')
            );

            console.log(`   🧹 Filtered: ${matches.length} → ${filteredMatches.length} matches`);
            return filteredMatches;
        }

        return matches;
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

    // Enhanced cluster selection with iterative merging
// Replace your findBestMatchCluster function with this enhanced version

const findBestMatchCluster = (matches, originalProvenanceText) => {
  if (matches.length === 0) return [];
  
  console.log(`🎯 DEBUG: Enhanced clustering for ${matches.length} matches`);
  
  // Add position information to each match
  const matchesWithPosition = matches.map(match => {
    const rect = match.element.getBoundingClientRect();
    const leftMatch = match.element.style.left.match(/(\d+\.?\d*)%/);
    const topMatch = match.element.style.top.match(/(\d+\.?\d*)%/);
    
    const left = leftMatch ? parseFloat(leftMatch[1]) : (rect.left / window.innerWidth) * 100;
    const top = topMatch ? parseFloat(topMatch[1]) : (rect.top / window.innerHeight) * 100;
    
    return {
      ...match,
      position: { left, top },
      rect: rect
    };
  });

  // Initial clustering by spatial proximity
  const initialClusters = createSpatialClusters(matchesWithPosition);
  console.log(`📊 Created ${initialClusters.length} initial spatial clusters`);
  
  // Score each initial cluster
  const scoredClusters = initialClusters.map((cluster, index) => {
    const sortedCluster = sortClusterByReadingOrder(cluster);
    const reconstructedText = reconstructTextFromCluster(sortedCluster);
    const metrics = calculateClusterMetrics(reconstructedText, originalProvenanceText, sortedCluster);
    
    console.log(`📊 Initial Cluster ${index}: ${cluster.length} elements`);
    console.log(`   📝 Reconstructed: "${reconstructedText.substring(0, 100)}..."`);
    console.log(`   📊 Coverage: ${(metrics.coverage * 100).toFixed(1)}%, Similarity: ${(metrics.similarity * 100).toFixed(1)}%`);
    
    return {
      cluster: sortedCluster,
      reconstructedText,
      ...metrics,
      clusterIndex: index
    };
  });

  // Sort by initial score
  scoredClusters.sort((a, b) => b.score - a.score);
  
  // Iteratively merge clusters to improve coverage
  const finalCluster = iterativelyMergeClusters(scoredClusters, originalProvenanceText);
  
  return finalCluster;
};

// 1. Enhanced confidence calculation that rewards actual provenance text
const calculateEnhancedConfidence = (match, originalProvenanceText) => {
  const matchText = match.matchText.toLowerCase().trim();
  const provenanceText = originalProvenanceText.toLowerCase().trim();
  
  let baseConfidence = match.confidence || 0;
  let bonuses = 0;
  
  // MAJOR BONUS: If the match text is substantially contained in provenance
  const containmentRatio = calculateContainmentRatio(matchText, provenanceText);
  if (containmentRatio > 0.8) {
    bonuses += 0.4; // Huge bonus for high containment
    console.log(`🎯 High containment bonus: ${containmentRatio.toFixed(2)} for "${matchText.substring(0, 30)}..."`);
  } else if (containmentRatio > 0.5) {
    bonuses += 0.2; // Good bonus for medium containment
    console.log(`🎯 Medium containment bonus: ${containmentRatio.toFixed(2)} for "${matchText.substring(0, 30)}..."`);
  }
  
  // MAJOR BONUS: If provenance text is substantially contained in match
  const reverseContainmentRatio = calculateContainmentRatio(provenanceText, matchText);
  if (reverseContainmentRatio > 0.7) {
    bonuses += 0.3; // Big bonus if match contains most of provenance
    console.log(`🎯 Reverse containment bonus: ${reverseContainmentRatio.toFixed(2)} for "${matchText.substring(0, 30)}..."`);
  }
  
  // BONUS: Exact substring matches
  if (provenanceText.includes(matchText) && matchText.length > 10) {
    bonuses += 0.3;
    console.log(`🎯 Exact substring bonus for "${matchText.substring(0, 30)}..."`);
  }
  
  // BONUS: Key phrase detection (for your specific case)
  const keyPhrases = [
    'ecce 2019',
    'september 10-13, 2019',
    'belfast',
    'united kingdom',
    'association for computing machinery',
    '© 2019'
  ];
  
  const foundKeyPhrases = keyPhrases.filter(phrase => matchText.includes(phrase));
  if (foundKeyPhrases.length > 0) {
    bonuses += foundKeyPhrases.length * 0.1;
    console.log(`🎯 Key phrase bonus: +${foundKeyPhrases.length * 0.1} for phrases: ${foundKeyPhrases.join(', ')}`);
  }
  
  // PENALTY: Very short matches with low word overlap
  if (matchText.length < 15 && calculateWordOverlap(matchText, provenanceText) < 0.3) {
    bonuses -= 0.2;
    console.log(`⚠️ Short match penalty for "${matchText}"`);
  }
  
  const finalConfidence = Math.min(1.0, baseConfidence + bonuses);
  
  if (bonuses > 0.1) {
    console.log(`📊 Enhanced confidence: ${baseConfidence.toFixed(2)} + ${bonuses.toFixed(2)} = ${finalConfidence.toFixed(2)} for "${matchText.substring(0, 50)}..."`);
  }
  
  return finalConfidence;
};

const calculateContainmentRatio = (text1, text2) => {
  // Calculate what percentage of text1's words are found in text2
  const words1 = text1.split(/\b/).filter(w => /\w+/.test(w) && w.length > 1);
  const words2 = text2.split(/\b/).filter(w => /\w+/.test(w) && w.length > 1);
  
  if (words1.length === 0) return 0;
  
  const foundWords = words1.filter(word1 => 
    words2.some(word2 => 
      word2.includes(word1) || word1.includes(word2) || word1 === word2
    )
  );
  
  return foundWords.length / words1.length;
};

const calculateWordOverlap = (text1, text2) => {
  const words1 = new Set(text1.split(/\b/).filter(w => /\w+/.test(w) && w.length > 1));
  const words2 = new Set(text2.split(/\b/).filter(w => /\w+/.test(w) && w.length > 1));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
};

// 2. Enhanced filtering to remove poor matches
const filterAndEnhanceMatches = (matches, originalProvenanceText) => {
  console.log(`🔍 Filtering and enhancing ${matches.length} matches`);
  
  // First pass: enhance all confidences
  const enhancedMatches = matches.map(match => ({
    ...match,
    originalConfidence: match.confidence,
    confidence: calculateEnhancedConfidence(match, originalProvenanceText)
  }));
  
  // Sort by enhanced confidence
  enhancedMatches.sort((a, b) => b.confidence - a.confidence);
  
  // Second pass: filter out poor matches
  const filteredMatches = enhancedMatches.filter(match => {
    const matchText = match.matchText.toLowerCase().trim();
    
    // Keep if confidence is good after enhancement
    if (match.confidence >= 0.6) {
      console.log(`✅ Keeping high confidence match: "${matchText.substring(0, 30)}..." (conf: ${match.confidence.toFixed(2)})`);
      return true;
    }
    
    // Keep if it's a substantial piece of the provenance text
    const containment = calculateContainmentRatio(matchText, originalProvenanceText.toLowerCase());
    if (containment > 0.4 && matchText.length > 10) {
      console.log(`✅ Keeping substantial match: "${matchText.substring(0, 30)}..." (containment: ${containment.toFixed(2)})`);
      return true;
    }
    
    // Keep if it's an exact phrase from provenance
    if (originalProvenanceText.toLowerCase().includes(matchText) && matchText.length > 8) {
      console.log(`✅ Keeping exact phrase: "${matchText.substring(0, 30)}..."`);
      return true;
    }
    
    // Filter out low-quality matches
    //console.log(`❌ Filtering out poor match: "${matchText.substring(0, 30)}..." (conf: ${match.confidence.toFixed(2)}, containment: ${calculateContainmentRatio(matchText, originalProvenanceText.toLowerCase()).toFixed(2)})`);
    return false;
  });
  
  console.log(`📊 Filtered: ${matches.length} → ${filteredMatches.length} matches`);
  
  // Sort final matches by enhanced confidence
  return filteredMatches.sort((a, b) => b.confidence - a.confidence);
};

// 3. Updated word matching function with better filtering
const findWordMatchesEnhanced = (textDivs, searchText) => {
  const matches = [];
  const searchWords = searchText.toLowerCase()
    .split(/\b/).filter(w => /\w+/.test(w));

  if (searchWords.length === 0) return matches;

  console.log(`🔤 Enhanced word matching for: "${searchText.substring(0, 50)}..."`);
  console.log(`🔤 Search words: [${searchWords.slice(0, 10).join(', ')}...]`);

  // Filter out whitespace-only elements
  const validTextDivs = Array.from(textDivs).filter(element => {
    const text = element.textContent.trim();
    return !/^\s*$/.test(text) && text.length > 0;
  });

  for (const element of validTextDivs) {
    const elementText = element.textContent.toLowerCase();
    const elementWords = elementText.split(/\b/).filter(w => /\w+/.test(w));

    // Count matching words with fuzzy matching
    const matchingWords = searchWords.filter(searchWord =>
      elementWords.some(elementWord => {
        // Exact match
        if (elementWord === searchWord) return true;
        // Substring match (either direction)
        if (elementWord.length > 3 && searchWord.includes(elementWord)) return true;
        if (searchWord.length > 3 && elementWord.includes(searchWord)) return true;
        return false;
      })
    );

    if (matchingWords.length > 0) {
      const baseConfidence = matchingWords.length / searchWords.length;
      
      // Only include matches with reasonable base confidence OR exact text similarity
      const textSimilarity = calculateStringSimilarity(elementText, searchText.toLowerCase());
      
      if (baseConfidence >= 0.25 || textSimilarity > 0.6) {
        matches.push({
          element,
          confidence: baseConfidence,
          matchType: 'word_match',
          matchText: element.textContent,
          matchingWords: matchingWords,
          totalWords: searchWords.length,
          textSimilarity: textSimilarity
        });
        
        console.log(`🎯 Word match: "${elementText.substring(0, 50)}..." - ${matchingWords.length}/${searchWords.length} words (${(baseConfidence * 100).toFixed(0)}%), similarity: ${(textSimilarity * 100).toFixed(0)}%`);
      }
    }
  }

  // Apply enhanced filtering and confidence calculation
  const enhancedMatches = filterAndEnhanceMatches(matches, searchText);
  
  console.log(`✅ Enhanced word matching complete: ${enhancedMatches.length} quality matches`);
  return enhancedMatches.slice(0, 15); // Limit to top 15 matches
};



// 4. Update your main highlighting function to use enhanced matching
const highlightProvenanceTextEnhanced = async (searchText, highlightId) => {
  if (!searchText || searchText.length < 3) {
    console.log('⚠️ Search text too short, skipping');
    return;
  }

  clearHighlights();
  console.log(`🔍 Enhanced highlighting for: "${searchText.substring(0, 100)}..."`);

  try {
    await waitForTextLayer();
    const textDivs = getValidTextElements(); // in this component
    
    if (textDivs.length === 0) {
      console.warn('⚠️ No text elements found');
      createFallbackHighlight(searchText, highlightId);
      return;
    }

    let highlights = [];
    
    // Method 1: Exact phrase matches (unchanged)
    const exactMatches = findExactMatches(textDivs, searchText);
    if (exactMatches.length > 0) {
      highlights.push(...exactMatches);
      console.log(`✅ Found ${exactMatches.length} exact matches`);
    }
    
    // Method 2: Enhanced word matching
    if (highlights.length < 3) { // Only if we don't have enough exact matches
      const wordMatches = findWordMatchesEnhanced(textDivs, searchText);
      
      if (wordMatches.length > 0) {
        // Merge with exact matches and re-sort by enhanced confidence
        const allMatches = [...highlights, ...wordMatches];
        const enhancedAll = filterAndEnhanceMatches(allMatches, searchText);
        
        // Use cluster algorithm only if we have many scattered matches
        if (enhancedAll.length > 5) {
          const clusteredMatches = findBestMatchCluster(enhancedAll, searchText);
          highlights = clusteredMatches;
        } else {
          highlights = enhancedAll;
        }
      }
    }

    // Method 3: Fuzzy matching only as last resort
    if (highlights.length === 0) {
      console.log(`🔄 Trying fuzzy matching as last resort...`);
      const fuzzyMatches = findFuzzyMatches(textDivs, searchText);
      highlights.push(...fuzzyMatches);
    }

    if (highlights.length > 0) {
      console.log(`✅ Final highlighting: ${highlights.length} matches`);
      
      // Log top matches for debugging
      highlights.slice(0, 3).forEach((h, i) => {
        console.log(`   ${i + 1}. "${h.matchText.substring(0, 50)}..." (conf: ${h.confidence.toFixed(2)}, type: ${h.matchType})`);
      });
      
      createHighlightElements(highlights, highlightId);
      setActiveHighlights(highlights);
      setHighlightsPersisted(true);
    } else {
      console.log('⚠️ No matches found, creating fallback');
      createFallbackHighlight(searchText, highlightId);
    }

  } catch (error) {
    console.error('❌ Error in enhanced highlighting:', error);
    createFallbackHighlight(searchText, highlightId);
  }
};

// 5. Enhanced string similarity function
const calculateStringSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1.0;
  
  // Check for one being contained in the other
  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.max(s2.length / s1.length, s1.length / s2.length) * 0.9;
  }
  
  // Levenshtein distance
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
};


const sortClusterByReadingOrder = (cluster) => {
  return cluster.sort((a, b) => {
    if (Math.abs(a.position.top - b.position.top) < 2) {
      return a.position.left - b.position.left; // Same line, left to right
    }
    return a.position.top - b.position.top; // Top to bottom
  });
};

const reconstructTextFromCluster = (sortedCluster) => {
  return sortedCluster
    .map(match => match.matchText.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const calculateSpatialCoherence = (cluster) => {
  if (cluster.length <= 1) return 1.0;
  
  // Sort by position for analysis
  const sortedCluster = cluster.sort((a, b) => {
    if (Math.abs(a.position.top - b.position.top) < 2) {
      return a.position.left - b.position.left;
    }
    return a.position.top - b.position.top;
  });
  
  let coherenceScore = 1.0;
  let totalDistance = 0;
  let lineChanges = 0;
  
  for (let i = 1; i < sortedCluster.length; i++) {
    const prev = sortedCluster[i - 1];
    const curr = sortedCluster[i];
    
    const topDistance = Math.abs(curr.position.top - prev.position.top);
    const leftDistance = Math.abs(curr.position.left - prev.position.left);
    
    // Calculate spatial distance
    const spatialDistance = Math.sqrt(topDistance * topDistance + leftDistance * leftDistance);
    totalDistance += spatialDistance;
    
    // Check for line changes
    if (topDistance > 2) {
      lineChanges++;
      
      // Penalty for big jumps between lines
      if (topDistance > 10) {
        coherenceScore -= 0.2;
        console.log(`⚠️ Large vertical gap: ${topDistance.toFixed(1)}% between elements`);
      }
    }
    
    // Penalty for elements that are very far apart horizontally on same line
    if (topDistance <= 2 && leftDistance > 50) {
      coherenceScore -= 0.15;
      console.log(`⚠️ Large horizontal gap: ${leftDistance.toFixed(1)}% on same line`);
    }
  }
  
  // Calculate average distance between consecutive elements
  const avgDistance = totalDistance / (sortedCluster.length - 1);
  
  // Penalty for high average distance (scattered elements)
  if (avgDistance > 30) {
    const distancePenalty = Math.min(0.3, (avgDistance - 30) / 100);
    coherenceScore -= distancePenalty;
    console.log(`⚠️ High average distance penalty: ${distancePenalty.toFixed(2)} (avg dist: ${avgDistance.toFixed(1)})`);
  }
  
  // Bonus for elements that are close together
  if (avgDistance < 15 && cluster.length > 2) {
    coherenceScore += 0.1;
    console.log(`✅ Spatial coherence bonus: elements are close together (avg dist: ${avgDistance.toFixed(1)})`);
  }
  
  // Penalty for too many line changes relative to cluster size
  const lineChangeRatio = lineChanges / cluster.length;
  if (lineChangeRatio > 0.5) {
    coherenceScore -= 0.2;
    console.log(`⚠️ Too many line changes: ${lineChanges}/${cluster.length}`);
  }
  
  return Math.max(0, coherenceScore);
};

const calculateClusterMetrics = (reconstructedText, originalText, cluster) => {
  const similarity = calculateTextSimilarity(reconstructedText, originalText);
  const coverage = calculateTextCoverage(reconstructedText, originalText);
  const lengthRatio = Math.min(reconstructedText.length / originalText.length, 1);
  const positionConsistency = calculatePositionConsistency(cluster);
  
  // NEW: Add spatial coherence
  const spatialCoherence = calculateSpatialCoherence(cluster);
  
  // Enhanced scoring that heavily weights coverage and spatial coherence
  const score = coverage * 0.5 + similarity * 0.25 + spatialCoherence * 0.2 + lengthRatio * 0.03 + positionConsistency * 0.02;
  
  console.log(`📊 Cluster metrics:`);
  console.log(`   Coverage: ${(coverage * 100).toFixed(1)}%`);
  console.log(`   Similarity: ${(similarity * 100).toFixed(1)}%`);
  console.log(`   Spatial coherence: ${(spatialCoherence * 100).toFixed(1)}%`);
  console.log(`   Final score: ${score.toFixed(3)}`);
  
  return { similarity, coverage, lengthRatio, positionConsistency, spatialCoherence, score };
};

// 3. Enhanced spatial clustering that prioritizes nearby elements
const createSpatialClusters = (matchesWithPosition) => {
  const clusters = [];
  const used = new Set();
  
  // Sort by confidence first, but also consider spatial density
  const sortedMatches = matchesWithPosition.sort((a, b) => b.confidence - a.confidence);
  
  for (let i = 0; i < sortedMatches.length; i++) {
    if (used.has(i)) continue;
    
    const baseMatch = sortedMatches[i];
    const cluster = [baseMatch];
    used.add(i);
    
    console.log(`🎯 Starting new cluster with: "${baseMatch.matchText.substring(0, 30)}..." at (${baseMatch.position.left.toFixed(1)}%, ${baseMatch.position.top.toFixed(1)}%)`);
    
    // Find nearby matches with stricter spatial requirements
    for (let j = i + 1; j < sortedMatches.length; j++) {
      if (used.has(j)) continue;
      
      const candidate = sortedMatches[j];
      
      // Calculate distance to closest element in current cluster
      const minDistanceToCluster = Math.min(...cluster.map(clusterMatch => {
        const topDistance = Math.abs(clusterMatch.position.top - candidate.position.top);
        const leftDistance = Math.abs(clusterMatch.position.left - candidate.position.left);
        
        // Use stricter thresholds for spatial coherence
        if (topDistance <= 3) {
          // Same line - allow reasonable horizontal distance
          return leftDistance <= 40 ? 0 : leftDistance;
        } else if (topDistance <= 8) {
          // Close lines - require closer horizontal alignment
          return leftDistance <= 25 ? topDistance : topDistance + leftDistance;
        } else {
          // Far lines - only if very close horizontally
          return leftDistance <= 15 ? topDistance : 100; // High penalty
        }
      }));
      
      if (minDistanceToCluster <= 8) { // Stricter distance threshold
        cluster.push(candidate);
        used.add(j);
        console.log(`   ✅ Added to cluster: "${candidate.matchText.substring(0, 30)}..." (distance: ${minDistanceToCluster.toFixed(1)})`);
      }
    }
    
    // Only keep clusters with good spatial coherence or high individual confidence
    const clusterCoherence = calculateSpatialCoherence(cluster);
    const avgConfidence = cluster.reduce((sum, m) => sum + m.confidence, 0) / cluster.length;
    
    if (clusterCoherence >= 0.6 || avgConfidence >= 0.7 || cluster.length === 1) {
      clusters.push(cluster);
      console.log(`✅ Keeping cluster: ${cluster.length} elements, coherence: ${(clusterCoherence * 100).toFixed(1)}%, avg conf: ${(avgConfidence * 100).toFixed(1)}%`);
    } else {
      console.log(`❌ Rejecting cluster: poor coherence ${(clusterCoherence * 100).toFixed(1)}%`);
      // Mark as unused so elements can be reconsidered
      cluster.forEach((_, idx) => used.delete(i + idx));
    }
  }
  
  return clusters;
};

// 4. Enhanced iterative merging with spatial awareness
const iterativelyMergeClusters = (scoredClusters, originalProvenanceText) => {
  console.log(`🔄 Starting spatially-aware iterative merging with ${scoredClusters.length} clusters`);
  
  if (scoredClusters.length === 0) return [];
  
  // Start with the best cluster
  let bestCombination = {
    clusters: [scoredClusters[0]],
    combinedCluster: scoredClusters[0].cluster,
    combinedText: scoredClusters[0].reconstructedText,
    ...calculateClusterMetrics(scoredClusters[0].reconstructedText, originalProvenanceText, scoredClusters[0].cluster)
  };
  
  console.log(`🚀 Starting with cluster ${scoredClusters[0].clusterIndex}: coverage ${(bestCombination.coverage * 100).toFixed(1)}%, spatial coherence ${(bestCombination.spatialCoherence * 100).toFixed(1)}%`);
  
  const targetCoverage = 0.7;
  const maxClusters = Math.min(4, scoredClusters.length); // Reduced from 5 to encourage spatial coherence
  
  for (let iteration = 1; iteration < maxClusters && bestCombination.coverage < targetCoverage; iteration++) {
    let bestAddition = null;
    
    for (let i = 1; i < scoredClusters.length; i++) {
      const candidateCluster = scoredClusters[i];
      
      if (bestCombination.clusters.some(c => c.clusterIndex === candidateCluster.clusterIndex)) {
        continue;
      }
      
      // Calculate spatial compatibility before merging
      const spatialCompatibility = calculateSpatialCompatibility(
        bestCombination.combinedCluster, 
        candidateCluster.cluster
      );
      
      if (spatialCompatibility < 0.3) {
        console.log(`   ❌ Rejecting cluster ${candidateCluster.clusterIndex}: poor spatial compatibility (${(spatialCompatibility * 100).toFixed(1)}%)`);
        continue;
      }
      
      const mergedCluster = [...bestCombination.combinedCluster, ...candidateCluster.cluster];
      const sortedMerged = sortClusterByReadingOrder(mergedCluster);
      const mergedText = reconstructTextFromCluster(sortedMerged);
      const mergedMetrics = calculateClusterMetrics(mergedText, originalProvenanceText, sortedMerged);
      
      const coverageImprovement = mergedMetrics.coverage - bestCombination.coverage;
      const spatialDegradation = bestCombination.spatialCoherence - mergedMetrics.spatialCoherence;
      const scoreImprovement = mergedMetrics.score - bestCombination.score;
      
      console.log(`   🧪 Testing merger with cluster ${candidateCluster.clusterIndex}:`);
      console.log(`      Coverage: ${(bestCombination.coverage * 100).toFixed(1)}% → ${(mergedMetrics.coverage * 100).toFixed(1)}% (+${(coverageImprovement * 100).toFixed(1)}%)`);
      console.log(`      Spatial coherence: ${(bestCombination.spatialCoherence * 100).toFixed(1)}% → ${(mergedMetrics.spatialCoherence * 100).toFixed(1)}% (${spatialDegradation > 0 ? '-' : '+'}${(Math.abs(spatialDegradation) * 100).toFixed(1)}%)`);
      console.log(`      Spatial compatibility: ${(spatialCompatibility * 100).toFixed(1)}%`);
      
      // Accept merger if coverage improves significantly AND spatial coherence doesn't degrade too much
      const worthMerging = (
        coverageImprovement > 0.1 || // Significant coverage improvement
        (coverageImprovement > 0.05 && spatialDegradation < 0.1) || // Good coverage + spatial preservation
        (scoreImprovement > 0.1 && spatialDegradation < 0.15) // Overall score improvement
      );
      
      if (worthMerging) {
        if (!bestAddition || mergedMetrics.score > bestAddition.score) {
          bestAddition = {
            cluster: candidateCluster,
            mergedCluster: sortedMerged,
            mergedText,
            spatialCompatibility,
            ...mergedMetrics
          };
        }
      }
    }
    
    if (bestAddition) {
      bestCombination = {
        clusters: [...bestCombination.clusters, bestAddition.cluster],
        combinedCluster: bestAddition.mergedCluster,
        combinedText: bestAddition.mergedText,
        ...bestAddition
      };
      
      console.log(`✅ Iteration ${iteration}: Added cluster ${bestAddition.cluster.clusterIndex}`);
      console.log(`   📊 New coverage: ${(bestCombination.coverage * 100).toFixed(1)}%, spatial coherence: ${(bestCombination.spatialCoherence * 100).toFixed(1)}%`);
      
      if (bestCombination.coverage >= targetCoverage) {
        console.log(`🎯 Reached target coverage, stopping early`);
        break;
      }
    } else {
      console.log(`⛔ Iteration ${iteration}: No spatially compatible mergers found, stopping`);
      break;
    }
  }
  
  console.log(`🏆 Final spatially-aware result:`);
  console.log(`   📊 Used ${bestCombination.clusters.length} clusters`);
  console.log(`   📊 Coverage: ${(bestCombination.coverage * 100).toFixed(1)}%, Spatial coherence: ${(bestCombination.spatialCoherence * 100).toFixed(1)}%`);
  console.log(`   🔢 Total elements: ${bestCombination.combinedCluster.length}`);
  
  return bestCombination.combinedCluster;
};

// 5. Calculate spatial compatibility between two clusters
const calculateSpatialCompatibility = (cluster1, cluster2) => {
  if (!cluster1.length || !cluster2.length) return 0;
  
  // Find the closest elements between the two clusters
  let minDistance = Infinity;
  let avgDistance = 0;
  let distanceCount = 0;
  
  cluster1.forEach(elem1 => {
    cluster2.forEach(elem2 => {
      const topDistance = Math.abs(elem1.position.top - elem2.position.top);
      const leftDistance = Math.abs(elem1.position.left - elem2.position.left);
      const distance = Math.sqrt(topDistance * topDistance + leftDistance * leftDistance);
      
      minDistance = Math.min(minDistance, distance);
      avgDistance += distance;
      distanceCount++;
    });
  });
  
  avgDistance /= distanceCount;
  
  // High compatibility if clusters are close
  if (minDistance < 10) return 1.0;
  if (minDistance < 20) return 0.8;
  if (minDistance < 35) return 0.5;
  if (avgDistance < 50) return 0.3;
  
  return 0.1; // Low compatibility for distant clusters
};



// Enhanced coverage calculation that handles the specific case better
const calculateTextCoverage = (reconstructedText, originalText) => {
  const normalizeForCoverage = (text) => text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const normalizedReconstructed = normalizeForCoverage(reconstructedText);
  const normalizedOriginal = normalizeForCoverage(originalText);
  
  // Extract meaningful words (length > 2)
  const originalWords = normalizedOriginal.split(/\b/).filter(w => /\w+/.test(w));
  const reconstructedWords = normalizedReconstructed.split(/\b/).filter(w => /\w+/.test(w));
  
  if (originalWords.length === 0) return 0;
  
  // Count covered words with fuzzy matching
  const coveredWords = originalWords.filter(originalWord => 
    reconstructedWords.some(reconstructedWord => {
      // Exact match
      if (reconstructedWord === originalWord) return true;
      
      // Substring match (either direction)
      if (originalWord.length > 4 && reconstructedWord.includes(originalWord)) return true;
      if (reconstructedWord.length > 4 && originalWord.includes(reconstructedWord)) return true;
      
      // Fuzzy match for longer words
      if (originalWord.length > 5 && reconstructedWord.length > 5) {
        const similarity = calculateStringSimilarity(originalWord, reconstructedWord);
        return similarity > 0.8;
      }
      
      return false;
    })
  );
  
  const coverage = coveredWords.length / originalWords.length;
  
  // Bonus for phrase continuity
  const phraseContinuityBonus = calculatePhraseContinuity(normalizedReconstructed, normalizedOriginal);
  
  return Math.min(1.0, coverage + phraseContinuityBonus * 0.1);
};

const calculatePhraseContinuity = (reconstructed, original) => {
  // Look for longer continuous phrases that match
  const minPhraseLength = 15; // Minimum phrase length to consider
  let maxContinuousMatch = 0;
  
  for (let i = 0; i <= original.length - minPhraseLength; i++) {
    for (let j = minPhraseLength; j <= original.length - i; j++) {
      const phrase = original.substring(i, i + j);
      if (reconstructed.includes(phrase)) {
        maxContinuousMatch = Math.max(maxContinuousMatch, phrase.length);
      }
    }
  }
  
  return maxContinuousMatch / original.length;
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
        const words1 = new Set(normalized1.split(/\b/).filter(w => /\w+/.test(w)));
        const words2 = new Set(normalized2.split(/\b/).filter(w => /\w+/.test(w)));
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
                const words = trimmed.split(/\b/).filter(w => /\w+/.test(w));
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




    const createContinuousLineHighlights = (highlights, highlightId) => {
        if (!highlightLayerRef?.current) return;

        // Group highlights by line (same top position, within tolerance)
        const lineGroups = groupHighlightsByLine(highlights);

        let highlightsCreated = 0;
        const newHighlights = new Map();

        lineGroups.forEach((lineHighlights, lineIndex) => {
            if (lineHighlights.length === 1) {
                // Single highlight on line - create normally
                const highlightElement = createHighlightFromTextElement(lineHighlights[0], highlightsCreated, highlightId);
                if (highlightElement) {
                    newHighlights.set(`${highlightId}_${highlightsCreated}`, highlightElement);
                    highlightsCreated++;
                }
            } else {
                // Multiple highlights on same line - create continuous span
                const continuousHighlight = createContinuousLineHighlight(lineHighlights, highlightsCreated, highlightId);
                if (continuousHighlight) {
                    newHighlights.set(`${highlightId}_${highlightsCreated}`, continuousHighlight);
                    highlightsCreated++;
                }
            }
        });

        highlightElementsRef.current = newHighlights;
        console.log(`✅ PDFTextHighlighter: Created ${highlightsCreated} continuous highlight elements`);
    };

    const groupHighlightsByLine = (highlights) => {
        const lineGroups = [];
        const lineThreshold = 2; // pixels tolerance for "same line"

        highlights.forEach(highlight => {
            const rect = highlight.element.getBoundingClientRect();
            const top = rect.top;

            // Find existing line group or create new one
            let lineGroup = lineGroups.find(group => {
                const groupTop = group[0].element.getBoundingClientRect().top;
                return Math.abs(top - groupTop) <= lineThreshold;
            });

            if (!lineGroup) {
                lineGroup = [];
                lineGroups.push(lineGroup);
            }

            lineGroup.push(highlight);
        });

        // Sort each line group by left position
        lineGroups.forEach(group => {
            group.sort((a, b) => {
                const rectA = a.element.getBoundingClientRect();
                const rectB = b.element.getBoundingClientRect();
                return rectA.left - rectB.left;
            });
        });

        // Sort line groups by top position
        lineGroups.sort((a, b) => {
            const topA = a[0].element.getBoundingClientRect().top;
            const topB = b[0].element.getBoundingClientRect().top;
            return topA - topB;
        });

        console.log(`📏 Grouped ${highlights.length} highlights into ${lineGroups.length} line groups`);

        return lineGroups;
    };

    const createContinuousLineHighlight = (lineHighlights, index, highlightId) => {
        if (!lineHighlights.length || !highlightLayerRef?.current) return null;

        // Calculate bounding box for the entire line span
        const rects = lineHighlights.map(h => h.element.getBoundingClientRect());
        const highlightLayer = highlightLayerRef.current;
        const layerRect = highlightLayer.getBoundingClientRect();

        // Find leftmost and rightmost positions
        const leftmost = Math.min(...rects.map(r => r.left));
        const rightmost = Math.max(...rects.map(r => r.right));
        const top = rects[0].top; // All should have same top
        const height = Math.max(...rects.map(r => r.height));

        // Calculate position relative to highlight layer
        const left = leftmost - layerRect.left;
        const relativeTop = top - layerRect.top;
        const width = rightmost - leftmost;

        if (width <= 0 || height <= 0) {
            console.warn(`⚠️ Invalid continuous highlight dimensions: ${width}x${height}`);
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'pdf-text-highlighter-overlay';
        overlay.setAttribute('data-highlight-id', highlightId);
        overlay.setAttribute('data-index', index);
        overlay.setAttribute('data-span-count', lineHighlights.length);

        // Use average confidence and best match type
        const avgConfidence = lineHighlights.reduce((sum, h) => sum + h.confidence, 0) / lineHighlights.length;
        const bestMatchType = lineHighlights.reduce((best, h) =>
            h.confidence > best.confidence ? h : best
        ).matchType;

        overlay.setAttribute('data-confidence', avgConfidence.toFixed(2));
        overlay.setAttribute('data-match-type', bestMatchType);

        // Color based on best match type
        let backgroundColor, borderColor;
        if (bestMatchType === 'exact_phrase') {
            backgroundColor = 'rgba(76, 175, 80, 0.3)';
            borderColor = 'rgba(76, 175, 80, 0.7)';
        } else if (bestMatchType === 'partial_phrase') {
            backgroundColor = 'rgba(33, 150, 243, 0.3)';
            borderColor = 'rgba(33, 150, 243, 0.7)';
        } else if (bestMatchType === 'word_match') {
            backgroundColor = 'rgba(255, 193, 7, 0.3)';
            borderColor = 'rgba(255, 193, 7, 0.7)';
        } else {
            backgroundColor = 'rgba(156, 39, 176, 0.3)';
            borderColor = 'rgba(156, 39, 176, 0.7)';
        }

        overlay.style.cssText = `
    position: absolute;
    left: ${left}px;
    top: ${relativeTop}px;
    width: ${width}px;
    height: ${height}px;
    background-color: ${backgroundColor};
    border: 2px solid ${borderColor};
    border-radius: 4px;
    z-index: 100;
    pointer-events: auto;
    cursor: pointer;
    opacity: ${Math.max(0.7, avgConfidence)};
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  `;

        // Combine text from all highlights in the line
        const combinedText = lineHighlights.map(h => h.matchText).join(' ');

        overlay.title = `Continuous line highlight (${lineHighlights.length} spans)\nAvg Confidence: ${(avgConfidence * 100).toFixed(0)}%\nText: "${combinedText.substring(0, 150)}${combinedText.length > 150 ? '...' : ''}"`;

        // Click handler
        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(`📍 Clicked continuous highlight spanning ${lineHighlights.length} elements`);

            // Visual feedback
            overlay.style.transform = 'scale(1.02)';
            overlay.style.borderWidth = '3px';

            setTimeout(() => {
                overlay.style.transform = 'scale(1)';
                overlay.style.borderWidth = '2px';
            }, 300);

            if (onHighlightClick) {
                onHighlightClick({
                    index,
                    text: combinedText,
                    confidence: avgConfidence,
                    matchType: `continuous_${bestMatchType}`,
                    searchText: combinedText,
                    page: currentPage,
                    spanCount: lineHighlights.length
                });
            }
        });

        // Hover effects
        overlay.addEventListener('mouseenter', () => {
            overlay.style.transform = 'scale(1.01)';
            overlay.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
            overlay.style.zIndex = '150';
        });

        overlay.addEventListener('mouseleave', () => {
            overlay.style.transform = 'scale(1)';
            overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
            overlay.style.zIndex = '100';
        });

        highlightLayerRef.current.appendChild(overlay);
        return overlay;
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