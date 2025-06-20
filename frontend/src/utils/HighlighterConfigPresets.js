// HighlighterConfigPresets.js - Tunable configurations for different document types

export const HIGHLIGHTER_PRESETS = {
    // Conservative - Only highlight very confident blocks
    conservative: {
        blockIdentificationConfig: {
            highConsumptionThreshold: 0.7,
            mediumConsumptionThreshold: 0.4,
            spatialConnectionDistance: 40,
            sequenceCompletionDistance: 60,
            minWordRelevance: 0.7
        },
        blockFilteringConfig: {
            enableReadingOrderFilter: true,
            enableCoverageFilter: true,
            enableRedundancyFilter: true,
            minBlockCoverage: 0.5,
            maxOverlap: 0.6,
            readingOrderWeight: 0.5,
            coverageWeight: 0.3,
            qualityWeight: 0.2,
            maxBlocksPerSentence: 1
        }
    },

    // Balanced - Good for most academic papers (your current case)
    balanced: {
        blockIdentificationConfig: {
            highConsumptionThreshold: 0.6,
            mediumConsumptionThreshold: 0.2,
            spatialConnectionDistance: 50,
            sequenceCompletionDistance: 80,
            minWordRelevance: 0.5
        },
        blockFilteringConfig: {
            enableReadingOrderFilter: true,
            enableCoverageFilter: true,
            enableRedundancyFilter: true,
            minBlockCoverage: 0.3,
            maxOverlap: 0.7,
            readingOrderWeight: 0.4,
            coverageWeight: 0.4,
            qualityWeight: 0.2,
            maxBlocksPerSentence: 2
        }
    },

    // Aggressive - Capture more potential matches (for complex layouts)
    aggressive: {
        blockIdentificationConfig: {
            highConsumptionThreshold: 0.4,
            mediumConsumptionThreshold: 0.1,
            spatialConnectionDistance: 70,
            sequenceCompletionDistance: 100,
            minWordRelevance: 0.3
        },
        blockFilteringConfig: {
            enableReadingOrderFilter: true,
            enableCoverageFilter: false,  // More permissive
            enableRedundancyFilter: true,
            minBlockCoverage: 0.2,
            maxOverlap: 0.8,
            readingOrderWeight: 0.3,
            coverageWeight: 0.5,
            qualityWeight: 0.2,
            maxBlocksPerSentence: 3
        }
    },

    // Strict reading order - Heavily prioritize first good block (your green block scenario)
    reading_order_priority: {
        blockIdentificationConfig: {
            highConsumptionThreshold: 0.6,
            mediumConsumptionThreshold: 0.2,
            spatialConnectionDistance: 50,
            sequenceCompletionDistance: 80,
            minWordRelevance: 0.5
        },
        blockFilteringConfig: {
            enableReadingOrderFilter: true,
            enableCoverageFilter: true,
            enableRedundancyFilter: true,
            minBlockCoverage: 0.4,
            maxOverlap: 0.5,        // Stricter overlap
            readingOrderWeight: 0.6, // Higher reading order weight
            coverageWeight: 0.3,
            qualityWeight: 0.1,
            maxBlocksPerSentence: 1   // Only show the best one
        }
    },

    // Custom for your specific case - prioritize early, high-consumption blocks
    research_paper_conservative: {
        blockIdentificationConfig: {
            highConsumptionThreshold: 0.6,
            mediumConsumptionThreshold: 0.3,
            spatialConnectionDistance: 45,
            sequenceCompletionDistance: 70,
            minWordRelevance: 0.6
        },
        blockFilteringConfig: {
            enableReadingOrderFilter: true,
            enableCoverageFilter: true,
            enableRedundancyFilter: true,
            minBlockCoverage: 0.4,
            maxOverlap: 0.6,
            readingOrderWeight: 0.5,
            coverageWeight: 0.4,
            qualityWeight: 0.1,
            maxBlocksPerSentence: 1,
            
            // Custom filters for your case
            enableEarlyBlockPriority: true,    // NEW: Prioritize blocks earlier in reading order
            earlyBlockBias: 0.2,               // NEW: Boost score for blocks in first 30% of page
            enableHighConsumptionGating: true, // NEW: If first block has >60% coverage, be very strict with others
            highCoverageGateThreshold: 0.6     // NEW: Threshold for gating
        }
    }
};

// Helper function to get preset by document type or custom tuning
export function getHighlighterConfig(documentType = 'balanced', customOverrides = {}) {
    const baseConfig = HIGHLIGHTER_PRESETS[documentType] || HIGHLIGHTER_PRESETS.balanced;
    
    // Deep merge custom overrides
    return {
        blockIdentificationConfig: {
            ...baseConfig.blockIdentificationConfig,
            ...customOverrides.blockIdentificationConfig
        },
        blockFilteringConfig: {
            ...baseConfig.blockFilteringConfig,
            ...customOverrides.blockFilteringConfig
        }
    };
}

// Document-specific configurations (you can add more as you test)
export const DOCUMENT_SPECIFIC_CONFIGS = {
    'research_database.pdf': {
        preset: 'research_paper_conservative',
        customOverrides: {
            blockFilteringConfig: {
                maxBlocksPerSentence: 1,
                readingOrderWeight: 0.6,
                enableHighConsumptionGating: true
            }
        }
    },
    
    // Add more document-specific configs as needed
    'complex_layout.pdf': {
        preset: 'aggressive',
        customOverrides: {
            blockIdentificationConfig: {
                spatialConnectionDistance: 80
            }
        }
    }
};

// Usage in your PDFViewer:
export function getConfigForDocument(filename) {
    const docConfig = DOCUMENT_SPECIFIC_CONFIGS[filename];
    
    if (docConfig) {
        return getHighlighterConfig(docConfig.preset, docConfig.customOverrides);
    }
    
    // Default to balanced for unknown documents
    return getHighlighterConfig('balanced');
}