// EnhancedBlockFiltering.js - Advanced filtering logic for Phase 2

/**
 * Enhanced filter blocks for a sentence with custom logic for your research paper case
 */
export function filterBlocksForSentenceEnhanced(sentenceBlocks, config) {
    if (sentenceBlocks.length === 0) return [];
    if (sentenceBlocks.length === 1) return sentenceBlocks;

    console.log(`🔍 Enhanced filtering: ${sentenceBlocks.length} blocks for sentence`);

    let filteredBlocks = [...sentenceBlocks];

    // Sort by reading order first (Y position)
    filteredBlocks.sort((a, b) => a.averageY - b.averageY);

    // 1. Early Block Priority Filter (NEW)
    if (config.enableEarlyBlockPriority) {
        filteredBlocks = applyEarlyBlockPriorityFilter(filteredBlocks, config);
    }

    // 2. High Consumption Gating Filter (NEW) - Your green block scenario
    if (config.enableHighConsumptionGating) {
        filteredBlocks = applyHighConsumptionGatingFilter(filteredBlocks, config);
    }

    // 3. Coverage Filter
    if (config.enableCoverageFilter) {
        filteredBlocks = applyCoverageFilter(filteredBlocks, config);
    }

    // 4. Redundancy Filter
    if (config.enableRedundancyFilter && filteredBlocks.length > 1) {
        filteredBlocks = applyRedundancyFilter(filteredBlocks, config);
    }

    // 5. Calculate final scores with enhanced logic
    filteredBlocks.forEach(block => {
        block.finalScore = calculateEnhancedFinalScore(block, config, filteredBlocks);
    });

    // 6. Select top blocks
    filteredBlocks.sort((a, b) => b.finalScore - a.finalScore);
    const topBlocks = filteredBlocks.slice(0, config.maxBlocksPerSentence);

    // Log detailed reasoning
    logFilteringDecisions(sentenceBlocks, topBlocks, config);

    return topBlocks;
}

/**
 * NEW: Apply early block priority - blocks that appear earlier in reading order get boost
 */
function applyEarlyBlockPriorityFilter(blocks, config) {
    if (blocks.length === 0) return blocks;

    // Calculate page height range to determine "early" blocks
    const minY = Math.min(...blocks.map(b => b.averageY));
    const maxY = Math.max(...blocks.map(b => b.averageY));
    const pageHeight = maxY - minY;
    const earlyThreshold = minY + (pageHeight * 0.3); // First 30% of content

    blocks.forEach(block => {
        if (block.averageY <= earlyThreshold) {
            block.earlyBlockBonus = config.earlyBlockBias || 0.2;
            console.log(`📍 Early block bonus: ${block.blockId} at Y=${block.averageY.toFixed(1)}`);
        } else {
            block.earlyBlockBonus = 0;
        }
    });

    return blocks;
}

/**
 * NEW: High consumption gating - if first block has great coverage, be very strict with others
 */
function applyHighConsumptionGatingFilter(blocks, config) {
    if (blocks.length === 0) return blocks;

    // Check if the first (earliest) block has high coverage
    const firstBlock = blocks[0]; // Already sorted by Y position
    const gateThreshold = config.highCoverageGateThreshold || 0.6;

    if (firstBlock.wordCoverage >= gateThreshold && firstBlock.avgConsumption >= 0.5) {
        console.log(`🚪 High consumption gating triggered by block ${firstBlock.blockId}`);
        console.log(`   Coverage: ${(firstBlock.wordCoverage * 100).toFixed(1)}%, Consumption: ${(firstBlock.avgConsumption * 100).toFixed(1)}%`);

        // Apply strict filtering to remaining blocks
        const otherBlocks = blocks.slice(1);
        const strictlyFilteredOthers = otherBlocks.filter(block => {
            // Other blocks must have:
            // 1. Significantly different content (low word overlap)
            // 2. Good consumption quality
            // 3. Cover meaningful missing words

            const wordOverlap = calculateWordOverlap(firstBlock, block);
            const hasUniqueContent = wordOverlap < 0.4; // Less than 40% overlap
            const goodQuality = block.avgConsumption >= 0.3;
            const meaningfulSize = block.totalWords >= 2;

            const passes = hasUniqueContent && goodQuality && meaningfulSize;

            if (!passes) {
                console.log(`❌ Gating filter: Block ${block.blockId} rejected`);
                console.log(`   Overlap: ${(wordOverlap * 100).toFixed(1)}%, Quality: ${(block.avgConsumption * 100).toFixed(1)}%, Words: ${block.totalWords}`);
            }

            return passes;
        });

        // Mark the first block as the gate-keeper
        firstBlock.isGateKeeper = true;

        return [firstBlock, ...strictlyFilteredOthers];
    }

    // No gating applied
    return blocks;
}

/**
 * Apply coverage filter
 */
function applyCoverageFilter(blocks, config) {
    const minCoverage = config.minBlockCoverage;
    
    return blocks.filter(block => {
        const passes = block.wordCoverage >= minCoverage;
        if (!passes) {
            console.log(`❌ Coverage filter: Block ${block.blockId} coverage ${(block.wordCoverage * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(1)}%`);
        }
        return passes;
    });
}

/**
 * Apply redundancy filter
 */
function applyRedundancyFilter(blocks, config) {
    const nonRedundant = [];
    const maxOverlap = config.maxOverlap;

    for (let i = 0; i < blocks.length; i++) {
        const currentBlock = blocks[i];
        let isRedundant = false;

        // Check against all existing non-redundant blocks
        for (let j = 0; j < nonRedundant.length; j++) {
            const existingBlock = nonRedundant[j];
            const overlap = calculateWordOverlap(currentBlock, existingBlock);

            if (overlap > maxOverlap) {
                // Determine which block to keep
                const currentScore = calculateQuickScore(currentBlock, config);
                const existingScore = calculateQuickScore(existingBlock, config);

                if (currentScore > existingScore) {
                    // Replace existing with current
                    console.log(`🔄 Redundancy: Replaced ${existingBlock.blockId} with better ${currentBlock.blockId}`);
                    nonRedundant[j] = currentBlock;
                } else {
                    console.log(`🔄 Redundancy: Kept ${existingBlock.blockId} over ${currentBlock.blockId}`);
                }
                isRedundant = true;
                break;
            }
        }

        if (!isRedundant) {
            nonRedundant.push(currentBlock);
        }
    }

    return nonRedundant;
}

/**
 * Calculate enhanced final score with new factors
 */
function calculateEnhancedFinalScore(block, config, allBlocks) {
    // Base components
    const readingOrderComponent = block.readingOrderScore * config.readingOrderWeight;
    const coverageComponent = block.wordCoverage * config.coverageWeight;
    const qualityComponent = block.avgConsumption * config.qualityWeight;

    // New components
    const earlyBlockComponent = (block.earlyBlockBonus || 0);
    const gateKeeperBonus = block.isGateKeeper ? 0.1 : 0;

    // Position bonus - earlier blocks get slight boost
    const positionInList = allBlocks.findIndex(b => b.blockId === block.blockId);
    const positionBonus = positionInList === 0 ? 0.05 : 0;

    const finalScore = readingOrderComponent + 
                      coverageComponent + 
                      qualityComponent + 
                      earlyBlockComponent + 
                      gateKeeperBonus + 
                      positionBonus;

    // Log score breakdown for debugging
    console.log(`📊 Score for ${block.blockId}:`);
    console.log(`   Reading: ${readingOrderComponent.toFixed(3)}, Coverage: ${coverageComponent.toFixed(3)}, Quality: ${qualityComponent.toFixed(3)}`);
    console.log(`   Early: ${earlyBlockComponent.toFixed(3)}, Gate: ${gateKeeperBonus.toFixed(3)}, Position: ${positionBonus.toFixed(3)}`);
    console.log(`   Final: ${finalScore.toFixed(3)}`);

    return finalScore;
}

/**
 * Quick score calculation for redundancy filtering
 */
function calculateQuickScore(block, config) {
    return (block.wordCoverage * 0.4) + 
           (block.avgConsumption * 0.3) + 
           (block.readingOrderScore * 0.2) + 
           ((block.earlyBlockBonus || 0) * 0.1);
}

/**
 * Calculate word overlap between two blocks
 */
function calculateWordOverlap(block1, block2) {
    const words1 = new Set(block1.coveredWords);
    const words2 = new Set(block2.coveredWords);
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    
    // Use Jaccard similarity with minimum denominator to be more sensitive to smaller blocks
    return intersection.size / Math.min(words1.size, words2.size);
}

/**
 * Log detailed filtering decisions for debugging
 */
function logFilteringDecisions(originalBlocks, finalBlocks, config) {
    console.log(`\n🎯 Filtering Summary:`);
    console.log(`   Input: ${originalBlocks.length} blocks`);
    console.log(`   Output: ${finalBlocks.length} blocks`);
    console.log(`   Config: ${config.maxBlocksPerSentence} max per sentence`);
    
    if (finalBlocks.length > 0) {
        console.log(`\n📋 Selected blocks:`);
        finalBlocks.forEach((block, index) => {
            console.log(`   ${index + 1}. ${block.blockId}: Score=${block.finalScore.toFixed(3)}, Coverage=${(block.wordCoverage * 100).toFixed(1)}%`);
            console.log(`      Words: ${block.coveredWords.slice(0, 3).join(', ')}${block.coveredWords.length > 3 ? '...' : ''}`);
        });
    }

    if (originalBlocks.length > finalBlocks.length) {
        const rejectedBlocks = originalBlocks.filter(orig => 
            !finalBlocks.some(final => final.blockId === orig.blockId)
        );
        console.log(`\n❌ Rejected blocks:`);
        rejectedBlocks.forEach(block => {
            console.log(`   ${block.blockId}: Coverage=${(block.wordCoverage * 100).toFixed(1)}%, Consumption=${(block.avgConsumption * 100).toFixed(1)}%`);
        });
    }
}

// Export the main function
export default filterBlocksForSentenceEnhanced;