// RobustOnTheFlyHighlighter.js - Production-ready on-the-fly highlighting
import React, { useEffect, useRef } from 'react';

const RobustOnTheFlyHighlighter = ({
    provenanceData,
    activeQuestionId,
    textLayerRef,
    highlightLayerRef,
    containerRef,
    currentPage,
    currentZoom,
    documentFilename,
    highlightStyle = {
        background: 'rgba(76, 175, 80, 0.4)',
        border: '1px solid rgba(76, 175, 80, 0.8)',
        borderRadius: '2px'
    },
    mergeThreshold = {
        yTolerance: 5,
        xGap: 15,
        minOverlap: 0.4
    },
    className = 'provenance-highlight',
    verbose = false
}) => {
    const highlighterRef = useRef(null);
    const highlightRefsRef = useRef(new Map());

    // Debug logging
    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[RobustHighlighter] ${message}`, ...args);
        }
    };

    // Initialize the robust highlighter
    useEffect(() => {
        highlighterRef.current = new RobustProvenanceHighlighter({
            verbose,
            mergeThreshold,
            highlightStyle,
            className
        });
        log('🚀 Robust highlighter initialized');
    }, [verbose]);

    // Clear highlights when question changes
    useEffect(() => {
        if (activeQuestionId) {
            log(`🧹 Question changed to ${activeQuestionId}, clearing highlights`);
            clearHighlights();
        }
    }, [activeQuestionId]);

    // Main highlighting effect
    useEffect(() => {
        if (!provenanceData?.provenance || !textLayerRef?.current || !highlightLayerRef?.current) {
            log('⏸️ Skipping highlight - missing required props');
            return;
        }

        const highlightProvenance = async () => {
            try {
                log('🎯 Starting robust provenance highlighting');
                clearHighlights();

                // Handle both single strings and arrays of sentences
                const provenanceTexts = Array.isArray(provenanceData.provenance) 
                    ? provenanceData.provenance 
                    : [provenanceData.provenance];

                log(`📝 Processing ${provenanceTexts.length} provenance sentence(s)`);

                const allResults = [];
                let totalHighlights = 0;

                // Process each sentence separately
                for (let i = 0; i < provenanceTexts.length; i++) {
                    const sentence = provenanceTexts[i];
                    
                    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
                        log(`⚠️ Skipping empty/invalid sentence ${i + 1}`);
                        continue;
                    }

                    log(`🔍 Processing sentence ${i + 1}/${provenanceTexts.length}: "${sentence.substring(0, 50)}..."`);

                    const result = await highlighterRef.current.highlightProvenance(
                        sentence,
                        textLayerRef.current,
                        highlightLayerRef.current,
                        containerRef.current,
                        currentPage,
                        i // Pass sentence index for unique styling
                    );

                    if (result.success) {
                        allResults.push(result);
                        totalHighlights += result.highlightCount;

                        log(`✅ Sentence ${i + 1} highlighted:`, {
                            strategy: result.strategy,
                            confidence: result.confidence,
                            spanCount: result.spanCount,
                            spanRange: result.spanRange,
                            highlightCount: result.highlightCount
                        });

                        // Store references for cleanup
                        result.highlightElements?.forEach(el => {
                            if (el.sourceSpans && el.sourceSpans.length > 0) {
                                highlightRefsRef.current.set(el.element, el.sourceSpans[0]);
                            }
                        });
                    } else {
                        log(`❌ Sentence ${i + 1} highlighting failed: ${result.error}`);
                    }
                }

                // Log overall results
                if (allResults.length > 0) {
                    const avgConfidence = allResults.reduce((sum, r) => sum + r.confidence, 0) / allResults.length;
                    const totalSpans = allResults.reduce((sum, r) => sum + r.spanCount, 0);
                    const strategies = [...new Set(allResults.map(r => r.strategy))];

                    log(`🎉 Multi-sentence highlighting complete:`, {
                        successfulSentences: allResults.length,
                        totalSentences: provenanceTexts.length,
                        avgConfidence: avgConfidence.toFixed(2),
                        totalSpans: totalSpans,
                        totalHighlights: totalHighlights,
                        strategies: strategies
                    });
                } else {
                    log(`❌ No sentences were successfully highlighted`);
                }

            } catch (error) {
                console.error('[RobustHighlighter] Error during highlighting:', error);
                clearHighlights();
            }
        };

        const timeoutId = setTimeout(highlightProvenance, 100);
        return () => clearTimeout(timeoutId);

    }, [provenanceData?.provenance_id, currentPage, currentZoom]);

    const clearHighlights = () => {
        if (!highlightLayerRef?.current) return;
        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());
        highlightRefsRef.current.clear();
        log('🧹 Cleared all highlights');
    };

    useEffect(() => {
        return () => clearHighlights();
    }, []);

    return null;
};

// Robust highlighter implementation
class RobustProvenanceHighlighter {
    constructor(options = {}) {
        this.verbose = options.verbose || false;
        this.mergeThreshold = options.mergeThreshold || {};
        this.highlightStyle = options.highlightStyle || {};
        this.className = options.className || 'provenance-highlight';
        
        // Text processing utilities
        this.textUtils = new TextProcessingUtils(this.verbose);
        
        // Color variations for multiple sentences
        this.sentenceColors = [
            { background: 'rgba(76, 175, 80, 0.4)', border: '1px solid rgba(76, 175, 80, 0.8)' }, // Green
            { background: 'rgba(33, 150, 243, 0.4)', border: '1px solid rgba(33, 150, 243, 0.8)' }, // Blue  
            { background: 'rgba(255, 152, 0, 0.4)', border: '1px solid rgba(255, 152, 0, 0.8)' }, // Orange
            { background: 'rgba(156, 39, 176, 0.4)', border: '1px solid rgba(156, 39, 176, 0.8)' }, // Purple
            { background: 'rgba(244, 67, 54, 0.4)', border: '1px solid rgba(244, 67, 54, 0.8)' }, // Red
        ];
        
        // Matching strategies with priorities
        this.strategies = [
            { name: 'exactConsecutive', priority: 100, method: this.findExactConsecutiveMatches.bind(this) },
            { name: 'fuzzyConsecutive', priority: 95, method: this.findFuzzyConsecutiveMatches.bind(this) },
            { name: 'slidingWindow', priority: 90, method: this.findSlidingWindowMatches.bind(this) },
            { name: 'keywordDensity', priority: 85, method: this.findKeywordDensityMatches.bind(this) },
            { name: 'partialSequence', priority: 80, method: this.findPartialSequenceMatches.bind(this) },
            { name: 'individualWords', priority: 75, method: this.findIndividualWordMatches.bind(this) }
        ];
    }

    log(message, ...args) {
        if (this.verbose) {
            console.log(`[RobustHighlighter] ${message}`, ...args);
        }
    }

    async highlightProvenance(provenanceText, textLayer, highlightLayer, container, currentPage, sentenceIndex = 0) {
        this.log(`🔍 Analyzing sentence ${sentenceIndex + 1}:`, provenanceText.substring(0, 100) + '...');

        // Get all text spans on current page
        const textSpans = this.getTextSpans(textLayer, currentPage);
        if (textSpans.length === 0) {
            return { success: false, error: 'No text spans found on current page' };
        }

        this.log(`📊 Found ${textSpans.length} text spans for sentence ${sentenceIndex + 1}`);

        // Preprocess provenance text
        const provenanceTokens = this.textUtils.tokenizeText(provenanceText);
        if (provenanceTokens.length < 2) {
            return { success: false, error: 'Provenance text too short' };
        }

        this.log(`📝 Sentence ${sentenceIndex + 1} tokens (${provenanceTokens.length}):`, provenanceTokens.slice(0, 10));

        // Try each strategy in priority order
        let bestResult = null;
        for (const strategy of this.strategies) {
            this.log(`🎯 Sentence ${sentenceIndex + 1} - trying strategy: ${strategy.name}`);
            
            try {
                const result = await strategy.method(provenanceTokens, textSpans);
                
                if (result && result.matches && result.matches.length > 0) {
                    this.log(`✅ Strategy ${strategy.name} found ${result.matches.length} matches for sentence ${sentenceIndex + 1}`);
                    
                    // Calculate overall confidence
                    const avgConfidence = result.matches.reduce((sum, m) => sum + m.confidence, 0) / result.matches.length;
                    
                    if (!bestResult || avgConfidence > bestResult.confidence) {
                        bestResult = {
                            ...result,
                            strategy: strategy.name,
                            confidence: avgConfidence,
                            priority: strategy.priority
                        };
                    }
                    
                    // If we have a high-confidence result, use it
                    if (avgConfidence > 0.8) {
                        this.log(`🎯 High confidence (${avgConfidence.toFixed(2)}) for sentence ${sentenceIndex + 1} - using this result`);
                        break;
                    }
                } else {
                    this.log(`❌ Strategy ${strategy.name} found no matches for sentence ${sentenceIndex + 1}`);
                }
            } catch (error) {
                this.log(`❌ Strategy ${strategy.name} failed for sentence ${sentenceIndex + 1}:`, error.message);
                continue;
            }
        }

        if (!bestResult) {
            return { success: false, error: `No matching strategy found results for sentence ${sentenceIndex + 1}` };
        }

        // Create highlights from best result with sentence-specific styling
        const highlights = this.createHighlights(bestResult.matches, highlightLayer, container, sentenceIndex);
        
        return {
            success: true,
            strategy: bestResult.strategy,
            confidence: bestResult.confidence,
            spanCount: bestResult.matches.reduce((sum, m) => sum + m.spans.length, 0),
            spanRange: this.getSpanRange(bestResult.matches),
            highlightCount: highlights.length,
            highlightElements: highlights,
            sentenceIndex: sentenceIndex,
            debug: {
                totalMatches: bestResult.matches.length,
                tokens: provenanceTokens.length,
                spans: textSpans.length,
                sentence: provenanceText.substring(0, 50) + '...'
            }
        };
    }

    getTextSpans(textLayer, currentPage) {
        const spans = textLayer.querySelectorAll(`span[data-stable-index][data-page-number="${currentPage}"]`);
        return Array.from(spans).map((span, index) => ({
            element: span,
            stableIndex: parseInt(span.dataset.stableIndex),
            pageNumber: parseInt(span.dataset.pageNumber),
            text: span.textContent || '',
            normalizedText: this.textUtils.normalizeText(span.textContent || ''),
            tokens: this.textUtils.tokenizeText(span.textContent || ''),
            position: this.getElementPosition(span),
            isEmpty: !span.textContent || !span.textContent.trim(),
            isSignificant: /\w{2,}/.test(span.textContent || '')
        })).filter(span => span.isSignificant); // Only keep spans with meaningful content
    }

    getElementPosition(element) {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2
        };
    }

    // Strategy 1: Exact consecutive matching
    findExactConsecutiveMatches(provenanceTokens, textSpans) {
        this.log('🎯 Exact consecutive matching');
        const matches = [];
        
        // Try different consecutive span lengths
        for (let length = Math.min(textSpans.length, 20); length >= 3; length--) {
            for (let start = 0; start <= textSpans.length - length; start++) {
                const spanGroup = textSpans.slice(start, start + length);
                const combinedTokens = spanGroup.flatMap(span => span.tokens);
                
                const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, combinedTokens);
                
                if (similarity > 0.7) {
                    matches.push({
                        spans: spanGroup,
                        confidence: similarity,
                        type: 'consecutive',
                        coverage: this.calculateCoverage(provenanceTokens, combinedTokens)
                    });
                }
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Strategy 2: Fuzzy consecutive matching (allows small gaps)
    findFuzzyConsecutiveMatches(provenanceTokens, textSpans) {
        this.log('🎯 Fuzzy consecutive matching');
        const matches = [];
        
        // Group spans by approximate vertical position (same line)
        const lines = this.groupSpansByLine(textSpans);
        
        for (const line of lines) {
            if (line.length < 2) continue;
            
            // Try consecutive spans within each line
            for (let length = Math.min(line.length, 15); length >= 2; length--) {
                for (let start = 0; start <= line.length - length; start++) {
                    const spanGroup = line.slice(start, start + length);
                    const combinedTokens = spanGroup.flatMap(span => span.tokens);
                    
                    const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, combinedTokens);
                    
                    if (similarity > 0.6) {
                        matches.push({
                            spans: spanGroup,
                            confidence: similarity * 0.95, // Slightly lower than exact
                            type: 'fuzzy_consecutive',
                            coverage: this.calculateCoverage(provenanceTokens, combinedTokens)
                        });
                    }
                }
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Strategy 3: Sliding window approach
    findSlidingWindowMatches(provenanceTokens, textSpans) {
        this.log('🎯 Sliding window matching');
        const matches = [];
        const windowSizes = [5, 7, 10, 15];
        
        for (const windowSize of windowSizes) {
            for (let i = 0; i <= textSpans.length - windowSize; i++) {
                const window = textSpans.slice(i, i + windowSize);
                const windowTokens = window.flatMap(span => span.tokens);
                
                const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, windowTokens);
                
                if (similarity > 0.5) {
                    matches.push({
                        spans: window,
                        confidence: similarity * 0.9,
                        type: 'sliding_window',
                        windowSize: windowSize,
                        coverage: this.calculateCoverage(provenanceTokens, windowTokens)
                    });
                }
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Strategy 4: Keyword density matching
    findKeywordDensityMatches(provenanceTokens, textSpans) {
        this.log('🎯 Keyword density matching');
        const matches = [];
        
        // Get important keywords from provenance
        const keywords = this.textUtils.extractKeywords(provenanceTokens);
        this.log(`🔑 Keywords:`, keywords);
        
        // Score each span based on keyword density
        const scoredSpans = textSpans.map(span => {
            const keywordCount = span.tokens.filter(token => keywords.includes(token)).length;
            const density = keywordCount / Math.max(span.tokens.length, 1);
            return { ...span, keywordScore: density };
        }).filter(span => span.keywordScore > 0);
        
        // Group high-scoring spans
        scoredSpans.sort((a, b) => b.keywordScore - a.keywordScore);
        
        // Find clusters of high-scoring spans
        const clusters = this.findSpanClusters(scoredSpans.slice(0, 10));
        
        for (const cluster of clusters) {
            const combinedTokens = cluster.flatMap(span => span.tokens);
            const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, combinedTokens);
            
            if (similarity > 0.4) {
                matches.push({
                    spans: cluster,
                    confidence: similarity * 0.85,
                    type: 'keyword_density',
                    coverage: this.calculateCoverage(provenanceTokens, combinedTokens)
                });
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Strategy 5: Partial sequence matching
    findPartialSequenceMatches(provenanceTokens, textSpans) {
        this.log('🎯 Partial sequence matching');
        const matches = [];
        
        // Find spans that contain subsequences of the provenance
        const minSequenceLength = Math.max(3, Math.floor(provenanceTokens.length * 0.3));
        
        for (let seqLen = minSequenceLength; seqLen <= Math.min(provenanceTokens.length, 8); seqLen++) {
            for (let start = 0; start <= provenanceTokens.length - seqLen; start++) {
                const subsequence = provenanceTokens.slice(start, start + seqLen);
                
                // Find spans containing this subsequence
                const matchingSpans = [];
                
                for (let i = 0; i <= textSpans.length - seqLen; i++) {
                    const spanGroup = textSpans.slice(i, i + seqLen);
                    const combinedTokens = spanGroup.flatMap(span => span.tokens);
                    
                    if (this.textUtils.containsSubsequence(combinedTokens, subsequence)) {
                        matchingSpans.push(spanGroup);
                    }
                }
                
                // Score the matching spans
                for (const spans of matchingSpans) {
                    const combinedTokens = spans.flatMap(span => span.tokens);
                    const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, combinedTokens);
                    
                    if (similarity > 0.3) {
                        matches.push({
                            spans: spans,
                            confidence: similarity * 0.8,
                            type: 'partial_sequence',
                            sequenceLength: seqLen,
                            coverage: this.calculateCoverage(provenanceTokens, combinedTokens)
                        });
                    }
                }
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Strategy 6: Individual word matching (fallback)
    findIndividualWordMatches(provenanceTokens, textSpans) {
        this.log('🎯 Individual word matching');
        const matches = [];
        
        // Find spans with high individual word overlap
        const scoredSpans = textSpans.map(span => {
            const overlap = this.textUtils.calculateTokenSimilarity(provenanceTokens, span.tokens);
            return { ...span, overlap };
        }).filter(span => span.overlap > 0.2);
        
        // Group nearby high-scoring spans
        const groups = this.groupNearbySpans(scoredSpans);
        
        for (const group of groups) {
            const combinedTokens = group.flatMap(span => span.tokens);
            const similarity = this.textUtils.calculateTokenSimilarity(provenanceTokens, combinedTokens);
            
            if (similarity > 0.3) {
                matches.push({
                    spans: group,
                    confidence: similarity * 0.7,
                    type: 'individual_words',
                    coverage: this.calculateCoverage(provenanceTokens, combinedTokens)
                });
            }
        }
        
        return { matches: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3) };
    }

    // Helper methods
    groupSpansByLine(spans) {
        const lines = [];
        const tolerance = 5; // pixels
        
        for (const span of spans) {
            let foundLine = false;
            
            for (const line of lines) {
                if (Math.abs(line[0].position.centerY - span.position.centerY) <= tolerance) {
                    line.push(span);
                    foundLine = true;
                    break;
                }
            }
            
            if (!foundLine) {
                lines.push([span]);
            }
        }
        
        // Sort spans within each line by horizontal position
        lines.forEach(line => {
            line.sort((a, b) => a.position.left - b.position.left);
        });
        
        return lines;
    }

    findSpanClusters(spans) {
        const clusters = [];
        const maxDistance = 100; // pixels
        
        for (const span of spans) {
            let foundCluster = false;
            
            for (const cluster of clusters) {
                const avgX = cluster.reduce((sum, s) => sum + s.position.centerX, 0) / cluster.length;
                const avgY = cluster.reduce((sum, s) => sum + s.position.centerY, 0) / cluster.length;
                
                const distance = Math.sqrt(
                    Math.pow(span.position.centerX - avgX, 2) + 
                    Math.pow(span.position.centerY - avgY, 2)
                );
                
                if (distance <= maxDistance) {
                    cluster.push(span);
                    foundCluster = true;
                    break;
                }
            }
            
            if (!foundCluster) {
                clusters.push([span]);
            }
        }
        
        return clusters.filter(cluster => cluster.length >= 2);
    }

    groupNearbySpans(spans) {
        const groups = [];
        const maxGap = 50; // pixels
        
        spans.sort((a, b) => a.stableIndex - b.stableIndex);
        
        let currentGroup = [];
        
        for (const span of spans) {
            if (currentGroup.length === 0) {
                currentGroup.push(span);
            } else {
                const lastSpan = currentGroup[currentGroup.length - 1];
                const gap = Math.abs(span.position.left - lastSpan.position.right);
                
                if (gap <= maxGap && Math.abs(span.position.centerY - lastSpan.position.centerY) <= 10) {
                    currentGroup.push(span);
                } else {
                    if (currentGroup.length >= 2) {
                        groups.push([...currentGroup]);
                    }
                    currentGroup = [span];
                }
            }
        }
        
        if (currentGroup.length >= 2) {
            groups.push(currentGroup);
        }
        
        return groups;
    }

    calculateCoverage(provenanceTokens, spanTokens) {
        const provenanceSet = new Set(provenanceTokens);
        const spanSet = new Set(spanTokens);
        const intersection = new Set([...provenanceSet].filter(x => spanSet.has(x)));
        return intersection.size / provenanceSet.size;
    }

    getSpanRange(matches) {
        if (!matches || matches.length === 0) return 'none';
        
        const allSpans = matches.flatMap(match => match.spans);
        const indices = allSpans.map(span => span.stableIndex).sort((a, b) => a - b);
        
        return indices.length > 0 ? `${indices[0]}-${indices[indices.length - 1]}` : 'none';
    }

    createHighlights(matches, highlightLayer, container, sentenceIndex = 0) {
        const highlights = [];
        
        // Get color scheme for this sentence
        const colorScheme = this.sentenceColors[sentenceIndex % this.sentenceColors.length];
        
        for (const match of matches) {
            // Create individual highlight boxes for each span
            const boxes = match.spans.map(span => this.createHighlightBox(span, container)).filter(Boolean);
            
            if (boxes.length === 0) continue;
            
            // Merge adjacent boxes
            const mergedBoxes = this.mergeHighlightBoxes(boxes);
            
            // Create DOM elements for merged boxes with sentence-specific styling
            for (const box of mergedBoxes) {
                const element = this.createHighlightElement(box, colorScheme, sentenceIndex);
                highlightLayer.appendChild(element);
                
                highlights.push({
                    element: element,
                    sourceSpans: box.sourceSpans,
                    bounds: box,
                    sentenceIndex: sentenceIndex,
                    color: colorScheme
                });
            }
        }
        
        return highlights;
    }

    createHighlightBox(span, container) {
        const pageContainer = container.querySelector('.pdf-page-container');
        if (!pageContainer) return null;

        try {
            const spanRect = span.element.getBoundingClientRect();
            const containerRect = pageContainer.getBoundingClientRect();
            
            return {
                left: spanRect.left - containerRect.left,
                top: spanRect.top - containerRect.top,
                right: spanRect.right - containerRect.left,
                bottom: spanRect.bottom - containerRect.top,
                width: spanRect.width,
                height: spanRect.height,
                sourceSpans: [span]
            };
        } catch (error) {
            this.log('❌ Error creating highlight box:', error);
            return null;
        }
    }

    mergeHighlightBoxes(boxes) {
        if (boxes.length <= 1) return boxes;
        
        const merged = [];
        const used = new Set();
        
        for (let i = 0; i < boxes.length; i++) {
            if (used.has(i)) continue;
            
            let current = { ...boxes[i] };
            used.add(i);
            
            // Find boxes that can be merged with current
            let foundMerge = true;
            while (foundMerge) {
                foundMerge = false;
                
                for (let j = 0; j < boxes.length; j++) {
                    if (used.has(j)) continue;
                    
                    const box = boxes[j];
                    
                    // Check if boxes can be merged
                    if (this.canMergeBoxes(current, box)) {
                        // Merge the boxes
                        current = {
                            left: Math.min(current.left, box.left),
                            top: Math.min(current.top, box.top),
                            right: Math.max(current.right, box.right),
                            bottom: Math.max(current.bottom, box.bottom),
                            sourceSpans: [...current.sourceSpans, ...box.sourceSpans]
                        };
                        current.width = current.right - current.left;
                        current.height = current.bottom - current.top;
                        
                        used.add(j);
                        foundMerge = true;
                    }
                }
            }
            
            merged.push(current);
        }
        
        return merged;
    }

    canMergeBoxes(box1, box2) {
        // Check vertical alignment (same line)
        const verticalOverlap = Math.min(box1.bottom, box2.bottom) - Math.max(box1.top, box2.top);
        const minHeight = Math.min(box1.height, box2.height);
        const overlapRatio = verticalOverlap / minHeight;
        
        if (overlapRatio < this.mergeThreshold.minOverlap) return false;
        
        // Check horizontal proximity
        const horizontalGap = Math.max(0, Math.min(
            Math.abs(box1.left - box2.right),
            Math.abs(box2.left - box1.right)
        ));
        
        return horizontalGap <= this.mergeThreshold.xGap;
    }

    createHighlightElement(box, colorScheme = null, sentenceIndex = 0) {
        const element = document.createElement('div');
        element.className = `${this.className} ${this.className}-sentence-${sentenceIndex}`;
        
        // Use sentence-specific colors or default
        const style = colorScheme || this.highlightStyle;
        
        Object.assign(element.style, {
            position: 'absolute',
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            background: style.background || this.highlightStyle.background,
            border: style.border || this.highlightStyle.border,
            borderRadius: this.highlightStyle.borderRadius || '2px',
            pointerEvents: 'none',
            zIndex: `${100 + sentenceIndex}`, // Different z-index for layering
            opacity: '0.8' // Slightly transparent for overlapping
        });
        
        // Add data attributes for debugging
        element.setAttribute('data-sentence-index', sentenceIndex);
        element.setAttribute('data-span-count', box.sourceSpans.length);
        
        return element;
    }
}

// Text processing utilities
class TextProcessingUtils {
    constructor(verbose = false) {
        this.verbose = verbose;
    }

    normalizeText(text) {
        return text.toLowerCase()
                  .replace(/[^\w\s'-]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
    }

    tokenizeText(text) {
        const normalized = this.normalizeText(text);
        return normalized.split(' ')
                        .filter(token => token.length > 1)
                        .filter(token => !/^\d+$/.test(token)); // Remove pure numbers
    }

    calculateTokenSimilarity(tokens1, tokens2) {
        if (!tokens1.length || !tokens2.length) return 0;
        
        const set1 = new Set(tokens1);
        const set2 = new Set(tokens2);
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return intersection.size / union.size; // Jaccard similarity
    }

    extractKeywords(tokens) {
        // Simple keyword extraction - remove common words
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them']);
        
        return tokens.filter(token => 
            !stopWords.has(token) && 
            token.length >= 3 &&
            /[a-z]/.test(token)
        );
    }

    containsSubsequence(haystack, needle) {
        if (needle.length === 0) return true;
        if (haystack.length < needle.length) return false;
        
        let needleIndex = 0;
        
        for (const token of haystack) {
            if (token === needle[needleIndex]) {
                needleIndex++;
                if (needleIndex === needle.length) {
                    return true;
                }
            }
        }
        
        return false;
    }
}

export default RobustOnTheFlyHighlighter;