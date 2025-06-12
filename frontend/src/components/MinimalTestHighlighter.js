// MinimalTestHighlighter.js - Absolute minimum to test interference
import React, { useEffect } from 'react';

export function MinimalTestHighlighter({
    documentId,
    currentPage,
    provenanceData,
    isRendering
}) {
    // ONLY log when provenance changes - do absolutely nothing else
    useEffect(() => {
        if (provenanceData) {
            console.log('📍 MinimalTestHighlighter: Provenance received', {
                provenanceId: provenanceData.provenance_id,
                currentPage,
                isRendering,
                text: provenanceData.provenance?.substring(0, 50) + '...'
            });
        }
    }, [provenanceData?.provenance_id, currentPage, isRendering]);

    // Do absolutely nothing else - no DOM manipulation, no API calls, no highlighting
    console.log('📍 MinimalTestHighlighter: Rendered');
    
    return null;
}

export default MinimalTestHighlighter;