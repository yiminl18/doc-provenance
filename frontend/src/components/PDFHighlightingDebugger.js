// PDFHighlightingDebugger.js - Debug component to identify highlighting issues

import React, { useState, useEffect } from 'react';

const PDFHighlightingDebugger = ({ 
  pdfDocument, 
  sentences, 
  selectedProvenance, 
  textLayerRef, 
  highlightLayerRef, 
  currentPage 
}) => {
  const [debugInfo, setDebugInfo] = useState({});
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Debug function to test basic overlay creation
  const testBasicOverlay = () => {
    if (!highlightLayerRef.current) {
      console.error('❌ highlightLayerRef.current is null');
      return;
    }

    console.log('🔧 Testing basic overlay creation...');
    
    // Clear existing overlays
    highlightLayerRef.current.innerHTML = '';
    
    // Create a simple test overlay
    const testOverlay = document.createElement('div');
    testOverlay.style.position = 'absolute';
    testOverlay.style.left = '100px';
    testOverlay.style.top = '100px';
    testOverlay.style.width = '200px';
    testOverlay.style.height = '50px';
    testOverlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
    testOverlay.style.border = '2px solid red';
    testOverlay.style.zIndex = '999';
    testOverlay.style.pointerEvents = 'none';
    testOverlay.innerHTML = '<span style="color: white; font-weight: bold; padding: 5px;">TEST OVERLAY</span>';
    
    highlightLayerRef.current.appendChild(testOverlay);
    console.log('✅ Test overlay added');
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (testOverlay.parentNode) {
        testOverlay.parentNode.removeChild(testOverlay);
        console.log('🗑️ Test overlay removed');
      }
    }, 3000);
  };

  // Debug text layer structure
  const analyzeTextLayer = () => {
    if (!textLayerRef.current) {
      console.error('❌ textLayerRef.current is null');
      return;
    }

    const textSpans = textLayerRef.current.querySelectorAll('span, div');
    console.log(`🔍 Found ${textSpans.length} text elements in PDF`);
    
    const analysis = {
      totalSpans: textSpans.length,
      withText: 0,
      positions: [],
      sampleTexts: []
    };

    textSpans.forEach((span, index) => {
      if (span.textContent.trim().length > 0) {
        analysis.withText++;
        
        if (index < 5) { // Sample first 5
          const rect = span.getBoundingClientRect();
          const containerRect = textLayerRef.current.getBoundingClientRect();
          
          analysis.positions.push({
            index,
            text: span.textContent.trim(),
            relativePos: {
              left: rect.left - containerRect.left,
              top: rect.top - containerRect.top,
              width: rect.width,
              height: rect.height
            }
          });
          analysis.sampleTexts.push(span.textContent.trim());
        }
      }
    });

    console.log('📊 Text Layer Analysis:', analysis);
    setDebugInfo(prev => ({ ...prev, textAnalysis: analysis }));
    return analysis;
  };

  // Test provenance matching
  const testProvenanceMatching = () => {
    if (!selectedProvenance) {
      console.warn('⚠️ No selectedProvenance available for testing');
      return;
    }

    console.log('🎯 Testing provenance matching...');
    console.log('Selected provenance:', selectedProvenance);
    
    const sentenceIds = selectedProvenance.sentences_ids || selectedProvenance.provenance_ids || [];
    console.log('Sentence IDs to highlight:', sentenceIds);
    
    if (sentenceIds.length === 0) {
      console.warn('⚠️ No sentence IDs found in provenance');
      return;
    }

    // Test sentence content availability
    sentenceIds.forEach((sentenceId, index) => {
      let sentenceText = null;
      
      if (selectedProvenance.content && selectedProvenance.content[index]) {
        sentenceText = selectedProvenance.content[index];
        console.log(`📝 Content[${index}] for sentence ${sentenceId}:`, sentenceText.substring(0, 50) + '...');
      } else if (sentences && sentences[sentenceId]) {
        sentenceText = sentences[sentenceId];
        console.log(`📝 Sentences[${sentenceId}]:`, sentenceText.substring(0, 50) + '...');
      } else {
        console.warn(`⚠️ No text found for sentence ID ${sentenceId}`);
      }
    });
  };

  // Test highlight layer setup
  const testHighlightLayer = () => {
    if (!highlightLayerRef.current) {
      console.error('❌ highlightLayerRef.current is null');
      return;
    }

    const layer = highlightLayerRef.current;
    const styles = window.getComputedStyle(layer);
    
    const layerInfo = {
      position: styles.position,
      zIndex: styles.zIndex,
      width: styles.width,
      height: styles.height,
      top: styles.top,
      left: styles.left,
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity
    };

    console.log('🎨 Highlight Layer Styles:', layerInfo);
    setDebugInfo(prev => ({ ...prev, layerStyles: layerInfo }));
    
    // Test if we can add elements
    const testElement = document.createElement('div');
    testElement.innerHTML = 'DEBUG TEST';
    testElement.style.cssText = `
      position: absolute;
      top: 50px;
      left: 50px;
      background: lime;
      padding: 10px;
      z-index: 1000;
      color: black;
      font-weight: bold;
    `;
    
    layer.appendChild(testElement);
    console.log('✅ Test element added to highlight layer');
    
    setTimeout(() => {
      if (testElement.parentNode) {
        testElement.parentNode.removeChild(testElement);
      }
    }, 2000);
  };

  // Check container positioning
  const checkContainerSetup = () => {
    const elements = {
      textLayer: textLayerRef.current,
      highlightLayer: highlightLayerRef.current
    };

    Object.entries(elements).forEach(([name, element]) => {
      if (element) {
        const rect = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        
        console.log(`📐 ${name} info:`, {
          position: styles.position,
          dimensions: { width: rect.width, height: rect.height },
          offset: { top: rect.top, left: rect.left },
          zIndex: styles.zIndex,
          overflow: styles.overflow
        });
      } else {
        console.error(`❌ ${name} ref is null`);
      }
    });
  };

  // Main debug run
  const runFullDebug = () => {
    console.log('\n🔧 ===== STARTING FULL DEBUG =====');
    checkContainerSetup();
    analyzeTextLayer();
    testHighlightLayer();
    testProvenanceMatching();
    testBasicOverlay();
    console.log('🔧 ===== DEBUG COMPLETE =====\n');
  };

  // Auto-run debug when provenance changes
  //useEffect(() => {
  //  if (selectedProvenance && textLayerRef.current && highlightLayerRef.current) {
  //    setTimeout(() => {
  //      console.log('🔄 Auto-running debug due to provenance change...');
  //      runFullDebug();
  //    }, 1000); // Give PDF time to render
  //  }
  //}, [selectedProvenance, currentPage]);

  if (process.env.NODE_ENV !== 'development') {
    return null; // Only show in development
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '12px',
      zIndex: 10000,
      minWidth: '200px'
    }}>
      <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
        PDF Debug Tools
      </div>
      
      <button 
        onClick={() => setShowDebugPanel(!showDebugPanel)}
        style={{
          background: 'blue',
          color: 'white',
          border: 'none',
          padding: '5px 10px',
          margin: '2px',
          borderRadius: '3px',
          fontSize: '11px'
        }}
      >
        {showDebugPanel ? 'Hide' : 'Show'} Panel
      </button>

      {showDebugPanel && (
        <div style={{ marginTop: '10px' }}>
          <button 
            onClick={runFullDebug}
            style={{
              background: 'green',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              margin: '2px',
              borderRadius: '3px',
              fontSize: '11px',
              display: 'block',
              width: '100%'
            }}
          >
            Run Full Debug
          </button>
          
          <button 
            onClick={testBasicOverlay}
            style={{
              background: 'orange',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              margin: '2px',
              borderRadius: '3px',
              fontSize: '11px',
              display: 'block',
              width: '100%'
            }}
          >
            Test Basic Overlay
          </button>
          
          <button 
            onClick={analyzeTextLayer}
            style={{
              background: 'purple',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              margin: '2px',
              borderRadius: '3px',
              fontSize: '11px',
              display: 'block',
              width: '100%'
            }}
          >
            Analyze Text Layer
          </button>

          {debugInfo.textAnalysis && (
            <div style={{ marginTop: '5px', fontSize: '10px' }}>
              <div>Spans: {debugInfo.textAnalysis.totalSpans}</div>
              <div>With Text: {debugInfo.textAnalysis.withText}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PDFHighlightingDebugger;