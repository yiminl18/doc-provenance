// enhanced_text_matcher.js - Simplified approach for highlighting provenance text in PDFs

/**
 * Enhanced text matcher that finds provenance text within PDF.js text items
 * This approach focuses on finding the actual provenance text, not just sentence boundaries
 */
export class EnhancedTextMatcher {
    constructor(pdfDocument, textLayerRef, highlightLayerRef) {
        this.pdfDocument = pdfDocument;
        this.textLayerRef = textLayerRef;
        this.highlightLayerRef = highlightLayerRef;
        this.currentHighlights = [];
    }

    /**
     * Main highlighting function - finds and highlights provenance text
     * @param {string} provenanceText - The actual text to highlight
     * @param {Array} sentenceIds - Sentence IDs to constrain search (optional)
     * @param {number} currentPage - Current PDF page
     * @param {Object} viewport - PDF.js viewport for coordinate conversion
     */
    async highlightProvenanceText(provenanceText, sentenceIds = [], currentPage, viewport) {
        if (!provenanceText || provenanceText.length < 10) {
            console.warn('Provenance text too short or missing');
            return [];
        }

        console.log('🎯 Highlighting provenance text:', provenanceText.substring(0, 100) + '...');
        
        // Clear existing highlights
        this.clearHighlights();

        // Get text content from current page
        const textContent = await this.extractPageTextContent(currentPage);
        if (!textContent) {
            console.warn('No text content available for highlighting');
            return [];
        }

        // Find matches using multiple strategies
        const matches = this.findTextMatches(provenanceText, textContent, viewport);
        
        if (matches.length === 0) {
            console.warn('No text matches found for provenance');
            return [];
        }

        // Create highlight elements
        const highlights = this.createHighlightElements(matches, provenanceText);
        
        console.log(`✅ Created ${highlights.length} highlights for provenance text`);
        return highlights;
    }

    /**
     * Extract text content and positions from current PDF page
     */
    async extractPageTextContent(pageNum) {
        try {
            const page = await this.pdfDocument.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Build text items with positions
            const textItems = textContent.items.map((item, index) => ({
                text: item.str || '',
                transform: item.transform || [1, 0, 0, 1, 0, 0],
                width: item.width || 0,
                height: item.height || 0,
                fontName: item.fontName || 'default',
                hasEOL: item.hasEOL || false,
                index: index
            }));

            console.log(`📄 Extracted ${textItems.length} text items from page ${pageNum}`);
            return textItems;
            
        } catch (error) {
            console.error('Error extracting text content:', error);
            return null;
        }
    }

    /**
     * Find text matches using multiple strategies
     */
    findTextMatches(provenanceText, textItems, viewport) {
        const cleanProvenance = this.cleanText(provenanceText);
        const provenanceWords = cleanProvenance.split(/\s+/).filter(word => word.length > 2);
        
        if (provenanceWords.length < 3) {
            console.warn('Not enough meaningful words in provenance text');
            return [];
        }

        console.log(`🔍 Searching for ${provenanceWords.length} words in ${textItems.length} text items`);

        // Strategy 1: Direct substring search
        let matches = this.findDirectSubstringMatches(cleanProvenance, textItems, viewport);
        if (matches.length > 0) {
            console.log('✅ Found direct substring matches');
            return matches;
        }

        // Strategy 2: Word sequence matching
        matches = this.findWordSequenceMatches(provenanceWords, textItems, viewport);
        if (matches.length > 0) {
            console.log('✅ Found word sequence matches');
            return matches;
        }

        // Strategy 3: Fuzzy word matching
        matches = this.findFuzzyWordMatches(provenanceWords, textItems, viewport);
        if (matches.length > 0) {
            console.log('✅ Found fuzzy word matches');
            return matches;
        }

        console.warn('❌ No matches found with any strategy');
        return [];
    }

    /**
     * Strategy 1: Find direct substring matches
     */
    findDirectSubstringMatches(cleanProvenance, textItems, viewport) {
        const matches = [];
        
        // Build continuous text from all items
        let continuousText = '';
        let charToItemMap = [];
        
        textItems.forEach((item, itemIndex) => {
            const startPos = continuousText.length;
            const cleanItemText = this.cleanText(item.text);
            
            continuousText += cleanItemText;
            
            // Map each character to its source item
            for (let i = 0; i < cleanItemText.length; i++) {
                charToItemMap.push({
                    itemIndex,
                    charIndex: i,
                    item
                });
            }
            
            // Add space between items
            if (!item.hasEOL && cleanItemText.length > 0) {
                continuousText += ' ';
                charToItemMap.push({
                    itemIndex,
                    charIndex: -1, // Space character
                    item
                });
            }
        });

        // Find provenance text in continuous text
        const startPos = continuousText.indexOf(cleanProvenance);
        if (startPos !== -1) {
            const endPos = startPos + cleanProvenance.length;
            
            // Map back to text items
            const relevantItems = new Set();
            for (let i = startPos; i < endPos && i < charToItemMap.length; i++) {
                if (charToItemMap[i]) {
                    relevantItems.add(charToItemMap[i].itemIndex);
                }
            }

            // Create highlights for relevant items
            relevantItems.forEach(itemIndex => {
                const item = textItems[itemIndex];
                const highlight = this.createHighlightFromTextItem(item, viewport, 0.9, 'direct_substring');
                if (highlight) {
                    matches.push(highlight);
                }
            });
        }

        return matches;
    }

    /**
     * Strategy 2: Find word sequence matches
     */
    findWordSequenceMatches(provenanceWords, textItems, viewport) {
        const matches = [];
        const matchingItems = new Set();
        
        // Find items that contain provenance words
        textItems.forEach((item, itemIndex) => {
            const cleanItemText = this.cleanText(item.text);
            const itemWords = cleanItemText.split(/\s+/);
            
            // Check if this item contains any provenance words
            const hasProvenanceWords = provenanceWords.some(pWord => 
                itemWords.some(iWord => 
                    iWord.includes(pWord) || pWord.includes(iWord) || 
                    this.calculateSimilarity(pWord, iWord) > 0.8
                )
            );
            
            if (hasProvenanceWords) {
                matchingItems.add(itemIndex);
            }
        });

        // Create highlights for matching items
        matchingItems.forEach(itemIndex => {
            const item = textItems[itemIndex];
            const highlight = this.createHighlightFromTextItem(item, viewport, 0.7, 'word_sequence');
            if (highlight) {
                matches.push(highlight);
            }
        });

        return matches;
    }

    /**
     * Strategy 3: Find fuzzy word matches
     */
    findFuzzyWordMatches(provenanceWords, textItems, viewport) {
        const matches = [];
        const itemScores = new Map();
        
        // Score each text item based on word overlap
        textItems.forEach((item, itemIndex) => {
            const cleanItemText = this.cleanText(item.text);
            const itemWords = cleanItemText.split(/\s+/);
            
            let score = 0;
            let matchedWords = 0;
            
            provenanceWords.forEach(pWord => {
                const bestMatch = itemWords.reduce((best, iWord) => {
                    const similarity = this.calculateSimilarity(pWord, iWord);
                    return similarity > best ? similarity : best;
                }, 0);
                
                if (bestMatch > 0.6) {
                    score += bestMatch;
                    matchedWords++;
                }
            });
            
            // Normalize score
            const normalizedScore = matchedWords > 0 ? (score / provenanceWords.length) : 0;
            
            if (normalizedScore > 0.3) {
                itemScores.set(itemIndex, normalizedScore);
            }
        });

        // Create highlights for top scoring items
        const sortedItems = Array.from(itemScores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.min(5, itemScores.size)); // Top 5 items max

        sortedItems.forEach(([itemIndex, score]) => {
            const item = textItems[itemIndex];
            const highlight = this.createHighlightFromTextItem(item, viewport, score, 'fuzzy_word');
            if (highlight) {
                matches.push(highlight);
            }
        });

        return matches;
    }

    /**
     * Create highlight element from text item
     */
    createHighlightFromTextItem(item, viewport, confidence, matchType) {
        if (!item.transform || !viewport) return null;

        // Convert PDF coordinates to viewport coordinates
        const transform = item.transform;
        const x = transform[4];
        const y = transform[5];
        
        // Calculate position in viewport
        const left = x * viewport.scale;
        const top = (viewport.height / viewport.scale - y) * viewport.scale;
        const width = (item.width || 100) * viewport.scale;
        const height = (item.height || 20) * viewport.scale;

        return {
            left,
            top,
            width,
            height,
            confidence,
            matchType,
            text: item.text,
            itemIndex: item.index
        };
    }

    /**
     * Create DOM highlight elements
     */
    createHighlightElements(matches, provenanceText) {
        if (!this.highlightLayerRef.current) {
            console.warn('Highlight layer not available');
            return [];
        }

        const highlights = [];

        matches.forEach((match, index) => {
            const overlay = document.createElement('div');
            overlay.className = 'provenance-highlight enhanced-highlight';
            overlay.setAttribute('data-match-type', match.matchType);
            overlay.setAttribute('data-confidence', match.confidence.toFixed(2));
            overlay.setAttribute('data-item-index', match.itemIndex);

            // Styling based on confidence
            const alpha = Math.max(0.3, match.confidence * 0.7);
            const borderAlpha = Math.max(0.6, match.confidence);
            
            // Color coding by match type
            let color = 'rgb(255, 193, 7)'; // Default yellow
            if (match.matchType === 'direct_substring') color = 'rgb(40, 167, 69)'; // Green
            else if (match.matchType === 'word_sequence') color = 'rgb(0, 123, 255)'; // Blue
            else if (match.matchType === 'fuzzy_word') color = 'rgb(255, 105, 180)'; // Pink

            overlay.style.cssText = `
                position: absolute;
                left: ${match.left}px;
                top: ${match.top}px;
                width: ${match.width}px;
                height: ${match.height}px;
                background-color: ${color.replace('rgb', 'rgba').replace(')', `, ${alpha})`)}; 
                border: 2px solid ${color.replace('rgb', 'rgba').replace(')', `, ${borderAlpha})`)}; 
                border-radius: 3px;
                z-index: 1000;
                pointer-events: auto;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            `;

            // Add hover effects
            overlay.addEventListener('mouseenter', () => {
                overlay.style.transform = 'scale(1.05)';
                overlay.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
            });

            overlay.addEventListener('mouseleave', () => {
                overlay.style.transform = 'scale(1)';
                overlay.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            });

            // Add click handler
            overlay.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showHighlightDetails(match, provenanceText);
            });

            // Tooltip
            overlay.title = `${match.matchType} (${(match.confidence * 100).toFixed(0)}%)\n"${match.text}"`;

            this.highlightLayerRef.current.appendChild(overlay);
            highlights.push(overlay);
        });

        this.currentHighlights = highlights;
        return highlights;
    }

    /**
     * Show details when highlight is clicked
     */
    showHighlightDetails(match, provenanceText) {
        console.log('🎯 Highlight clicked:', {
            matchType: match.matchType,
            confidence: match.confidence,
            text: match.text,
            provenanceText: provenanceText.substring(0, 100) + '...'
        });

        // You can emit an event or call a callback here
        // to show a modal or details panel
        if (this.onHighlightClick) {
            this.onHighlightClick(match, provenanceText);
        }
    }

    /**
     * Clear all highlights
     */
    clearHighlights() {
        if (this.highlightLayerRef.current) {
            this.highlightLayerRef.current.innerHTML = '';
        }
        this.currentHighlights = [];
    }

    /**
     * Utility: Clean text for matching
     */
    cleanText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Utility: Calculate string similarity
     */
    calculateSimilarity(str1, str2) {
        if (str1 === str2) return 1;
        if (str1.length === 0 || str2.length === 0) return 0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1;

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    /**
     * Utility: Calculate Levenshtein distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }
}

/**
 * Integration function for your existing LayoutBasedPDFViewer
 */
export function createEnhancedTextMatcher(pdfDocument, textLayerRef, highlightLayerRef, onHighlightClick = null) {
    const matcher = new EnhancedTextMatcher(pdfDocument, textLayerRef, highlightLayerRef);
    matcher.onHighlightClick = onHighlightClick;
    return matcher;
}