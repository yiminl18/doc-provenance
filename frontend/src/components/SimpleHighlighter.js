// SimpleHighlighter.js - Modular PDF text highlighting component
import React, { useEffect, useRef } from 'react';
import { getSentenceItemMappings } from '../services/api';

const SimpleHighlighter = ({
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
        yTolerance: 3,
        xGap: 10,
        minOverlap: .5
    },
    className = 'provenance-highlight',
    verbose = false
}) => {
    const highlightRefsRef = useRef(new Map()); // highlightElement -> sourceTextElement

    // Debug logging helper
    const log = (message, ...args) => {
        if (verbose) {
            console.log(`[SimpleHighlighter] ${message}`, ...args);
        }
    };

    useEffect(() => {
        // Clear highlights immediately when question changes (even before new provenance arrives)
        if (activeQuestionId) {
            log(`🧹 Question changed to ${activeQuestionId}, clearing highlights`);
            clearHighlights();
        }
    }, [activeQuestionId]);

    useEffect(() => {
        // Skip if missing required props
        if (!provenanceData?.provenance || !textLayerRef?.current || !highlightLayerRef?.current || !documentFilename) {
            log('⏸️ Skipping highlight - missing required props:', {
                hasProvenance: !!provenanceData?.provenance,
                hasTextLayer: !!textLayerRef?.current,
                hasHighlightLayer: !!highlightLayerRef?.current,
                hasFilename: !!documentFilename
            });
            return;
        }

        const highlightLayer = highlightLayerRef.current;

        const handleHighlight = async () => {
            try {
                const sentenceIds = provenanceData.provenance_ids || [];

                if (sentenceIds.length === 0) {
                    log('⚠️ No sentence IDs found in provenance data');
                    clearHighlights();
                    return;
                }

                log(`🔍 Fetching mappings for sentences:`, sentenceIds);
                const mappingsData = await getSentenceItemMappings(documentFilename, sentenceIds);

                if (!mappingsData || !mappingsData.sentence_mappings) {
                    log('⚠️ No stable mappings available');
                    clearHighlights();
                    return;
                }

                // Check if there's content on the current page
                const hasContentOnCurrentPage = checkPrimaryPage(mappingsData, currentPage);

                if (!hasContentOnCurrentPage) {
                    log(`📄 No provenance content on page ${currentPage} - clearing highlights`);
                    clearHighlights();
                    return;
                }

                log(`✅ Found provenance content on page ${currentPage} - proceeding with highlighting`);

                // Clear existing highlights before adding new ones
                clearHighlights();

                // Collect all stable indices for highlighting
                const sentenceSpans = collectStableIndices(mappingsData, currentPage);

                if (sentenceSpans.size === 0) {
                    log(`📄 No stable indices found for page ${currentPage}`);
                    return;
                }

                // Create individual highlight boxes first
                const individualHighlights = [];
                sentenceSpans.forEach((index) => {
                    const element = findTextElement(index, currentPage);
                    if (element) {
                        const highlightBox = createHighlightBox(element);
                        if (highlightBox) {
                            individualHighlights.push({
                                element: element,
                                box: highlightBox
                            });
                        }
                    }
                });

                log(`📦 Created ${individualHighlights.length} individual highlight boxes`);

                // Merge adjacent highlights into continuous lines
                const mergedHighlights = mergeAdjacentHighlights(individualHighlights);

                log(`🔗 Merged into ${mergedHighlights.length} continuous highlight regions`);

                // Add merged highlights to the DOM
                let totalHighlightCount = 0;
                mergedHighlights.forEach(highlight => {
                    highlightLayer.appendChild(highlight.element);
                    // Store reference to first source element for each merged highlight
                    if (highlight.sourceElements.length > 0) {
                        highlightRefsRef.current.set(highlight.element, highlight.sourceElements[0]);
                    }
                    totalHighlightCount++;
                });

                log(`✅ Added ${totalHighlightCount} merged highlights to page ${currentPage}`);

            } catch (error) {
                console.error('[SimpleHighlighter] Error during highlighting:', error);
                clearHighlights();
            }
        };

        // Small delay to ensure text layer is ready
        const timeoutId = setTimeout(handleHighlight, 100);

        return () => clearTimeout(timeoutId);

    }, [provenanceData?.provenance_id, currentPage, currentZoom, documentFilename]);
    // Helper function to check if mappings have content on current page
    const checkPrimaryPage = (mappingsData, currentPage) => {
        return Object.values(mappingsData.sentence_mappings).some(mapping =>
            mapping.primary_page === currentPage
        );
    };

    // Helper function to collect stable indices for the current page
    const collectStableIndices = (mappingsData, currentPage) => {
        const sentenceSpans = new Set();

        Object.entries(mappingsData.sentence_mappings).forEach(([sentenceId, mapping]) => {
            if (mapping.stable_matches && mapping.stable_matches.length > 0) {
                const pageMatches = mapping.stable_matches.filter(match => match.page === currentPage);
                pageMatches.forEach(match => {
                    const spanElements = match.item_span || [];
                    spanElements.forEach(spanIndex => {
                        sentenceSpans.add(spanIndex);
                    });
                });
            }
        });

        return sentenceSpans;
    };

    // Helper function to find text element by stable index
    const findTextElement = (stableIndex, pageNumber) => {
        if (!textLayerRef?.current) return null;

        return textLayerRef.current.querySelector(
            `[data-stable-index="${stableIndex}"][data-page-number="${pageNumber}"]`
        );
    };

    // Function to create a highlight box data structure (not DOM element yet)
    const createHighlightBox = (sourceElement) => {
        if (!containerRef?.current) {
            log('⚠️ Container ref not available for highlight positioning');
            return null;
        }

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) {
            log('⚠️ PDF page container not found');
            return null;
        }

        try {
            // Get bounding rects for positioning
            const elementRect = sourceElement.getBoundingClientRect();
            const pageContainerRect = pageContainer.getBoundingClientRect();

            // Calculate position relative to the page container
            const left = elementRect.left - pageContainerRect.left;
            const top = elementRect.top - pageContainerRect.top;
            const width = elementRect.width;
            const height = elementRect.height;

            return {
                left: left,
                top: top,
                right: left + width,
                bottom: top + height,
                width: width,
                height: height,
                sourceElement: sourceElement
            };

        } catch (error) {
            log('❌ Error creating highlight box:', error);
            return null;
        }
    };

    // NEW: Function to merge adjacent highlight boxes into continuous lines
    const mergeAdjacentHighlights = (individualHighlights) => {
        if (individualHighlights.length === 0) return [];

        // Sort highlights by vertical position (top), then horizontal position (left)
        const sortedHighlights = [...individualHighlights].sort((a, b) => {
            const topDiff = a.box.top - b.box.top;
            if (Math.abs(topDiff) > mergeThreshold.yTolerance) {
                return topDiff;
            }
            return a.box.left - b.box.left;
        });

        log(`📊 Sorting ${sortedHighlights.length} highlights for merging`);

        const mergedRegions = [];
        let currentRegion = null;

        sortedHighlights.forEach((highlight, index) => {
            const box = highlight.box;

            if (!currentRegion) {
                // Start first region
                currentRegion = {
                    left: box.left,
                    top: box.top,
                    right: box.right,
                    bottom: box.bottom,
                    height: box.height,
                    sourceElements: [highlight.element]
                };
                log(`🆕 Started new region at (${box.left}, ${box.top})`);
            } else {
                // Check if this highlight should be merged with current region
                const canMerge = shouldMergeHighlights(currentRegion, box);

                if (canMerge) {
                    // Merge into current region
                    currentRegion.left = Math.min(currentRegion.left, box.left);
                    currentRegion.right = Math.max(currentRegion.right, box.right);
                    currentRegion.top = Math.min(currentRegion.top, box.top);
                    currentRegion.bottom = Math.max(currentRegion.bottom, box.bottom);
                    currentRegion.height = Math.max(currentRegion.height, box.height);
                    currentRegion.sourceElements.push(highlight.element);

                    log(`🔗 Merged highlight into current region. New bounds: (${currentRegion.left}, ${currentRegion.top}) to (${currentRegion.right}, ${currentRegion.bottom})`);
                } else {
                    // Finish current region and start new one
                    mergedRegions.push(createMergedHighlightElement(currentRegion));

                    currentRegion = {
                        left: box.left,
                        top: box.top,
                        right: box.right,
                        bottom: box.bottom,
                        height: box.height,
                        sourceElements: [highlight.element]
                    };

                    log(`➡️ Started new region at (${box.left}, ${box.top}) - couldn't merge with previous`);
                }
            }
        });

        // Don't forget the last region
        if (currentRegion) {
            mergedRegions.push(createMergedHighlightElement(currentRegion));
        }

        log(`✅ Created ${mergedRegions.length} merged regions from ${individualHighlights.length} individual highlights`);
        return mergedRegions;
    };

    // Helper function to determine if two highlights should be merged
    const shouldMergeHighlights = (region, box) => {
        // Check vertical alignment (same line)
        const verticalOverlap = Math.min(region.bottom, box.bottom) - Math.max(region.top, box.top);
        const minHeight = Math.min(region.height, box.height);
        const overlapRatio = verticalOverlap / minHeight;

        const isOnSameLine = overlapRatio >= mergeThreshold.minOverlap;

        if (!isOnSameLine) {
            log(`❌ Not same line - overlap ratio: ${overlapRatio.toFixed(2)} (threshold: ${mergeThreshold.minOverlap})`);
            return false;
        }

        // Check horizontal proximity
        const horizontalGap = Math.max(0, box.left - region.right);
        const isCloseHorizontally = horizontalGap <= mergeThreshold.xGap;

        if (!isCloseHorizontally) {
            log(`❌ Too far horizontally - gap: ${horizontalGap}px (threshold: ${mergeThreshold.xGap}px)`);
            return false;
        }

        log(`✅ Can merge - vertical overlap: ${overlapRatio.toFixed(2)}, horizontal gap: ${horizontalGap}px`);
        return true;
    };

    // Function to create DOM element for merged highlight region
    const createMergedHighlightElement = (region) => {
        const highlightElement = document.createElement('div');
        highlightElement.className = className;

        // Calculate merged dimensions
        const width = region.right - region.left;
        const height = region.bottom - region.top;

        // Apply styles
        const styles = {
            position: 'absolute',
            left: `${region.left}px`,
            top: `${region.top}px`,
            width: `${width}px`,
            height: `${height}px`,
            background: highlightStyle.background,
            border: highlightStyle.border,
            borderRadius: highlightStyle.borderRadius,
            pointerEvents: 'none',
            zIndex: '100',
            transform: 'none !important'
        };

        // Apply styles to element
        Object.assign(highlightElement.style, styles);

        log(`🎨 Created merged highlight: ${width.toFixed(1)}x${height.toFixed(1)} at (${region.left.toFixed(1)}, ${region.top.toFixed(1)}) from ${region.sourceElements.length} source elements`);

        return {
            element: highlightElement,
            sourceElements: region.sourceElements,
            bounds: region
        };
    };


    // Function to create a single highlight element
    const createHighlightElement = (sourceElement) => {
        if (!containerRef?.current) {
            log('⚠️ Container ref not available for highlight positioning');
            return null;
        }

        const pageContainer = containerRef.current.querySelector('.pdf-page-container');
        if (!pageContainer) {
            log('⚠️ PDF page container not found');
            return null;
        }

        try {
            // Get bounding rects for positioning
            const elementRect = sourceElement.getBoundingClientRect();
            const pageContainerRect = pageContainer.getBoundingClientRect();

            // Calculate position relative to the page container
            const left = elementRect.left - pageContainerRect.left;
            const top = elementRect.top - pageContainerRect.top;
            const width = elementRect.width;
            const height = elementRect.height;

            // Create highlight element
            const highlightBox = document.createElement('div');
            highlightBox.className = className;

            // Apply styles
            const styles = {
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                background: highlightStyle.background,
                border: highlightStyle.border,
                borderRadius: highlightStyle.borderRadius,
                pointerEvents: 'none',
                zIndex: '100',
                transform: 'none !important'
            };

            // Apply styles to element
            Object.assign(highlightBox.style, styles);

            return highlightBox;

        } catch (error) {
            log('❌ Error creating highlight element:', error);
            return null;
        }
    };

    // Function to clear all highlights
    const clearHighlights = () => {
        if (!highlightLayerRef?.current) return;

        const existingHighlights = highlightLayerRef.current.querySelectorAll(`.${className}`);
        existingHighlights.forEach(el => el.remove());

        highlightRefsRef.current.clear();
        log('🧹 Cleared all highlights');
    };

    // Clear highlights when component unmounts
    useEffect(() => {
        return () => {
            clearHighlights();
        };
    }, []);

    // This component only manages highlights, doesn't render anything visible
    return null;
};

export default SimpleHighlighter;