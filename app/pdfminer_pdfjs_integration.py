#!/usr/bin/env python3
"""
Integration Guide and Setup Script
Sets up the coordinate-based highlighting system and provides integration examples
"""

import os
import sys
import json
from pathlib import Path

def setup_coordinate_highlighting_system():
    """
    Set up the coordinate highlighting system
    """
    print("🚀 Setting up Coordinate-Based Highlighting System")
    print("=" * 60)
    
    # Create necessary directories
    directories = [
        'coordinate_regions',
        'stable_mappings', 
        'processed_pdfs',
        'pdfjs_cache'
    ]
    
    created_dirs = []
    for dir_name in directories:
        dir_path = os.path.join(os.getcwd(), dir_name)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path)
            created_dirs.append(dir_path)
            print(f"✅ Created directory: {dir_path}")
        else:
            print(f"📁 Directory exists: {dir_path}")
    
    print(f"\n📁 Directory setup complete! Created {len(created_dirs)} new directories.")
    
    # Check for existing PDFs
    uploads_dir = os.path.join(os.getcwd(), 'uploads')
    pdf_files = []
    
    if os.path.exists(uploads_dir):
        pdf_files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
        print(f"\n📄 Found {len(pdf_files)} PDF files in uploads:")
        for pdf_file in pdf_files[:5]:  # Show first 5
            print(f"   - {pdf_file}")
        if len(pdf_files) > 5:
            print(f"   ... and {len(pdf_files) - 5} more")
    else:
        print(f"\n⚠️ Uploads directory not found: {uploads_dir}")
        print("   Please ensure your PDFs are in the uploads directory")
    
    return {
        'directories_created': created_dirs,
        'pdfs_found': pdf_files,
        'setup_complete': True
    }


def test_single_pdf(pdf_path: str):
    """
    Test the complete pipeline with a single PDF
    """
    print(f"\n🧪 Testing pipeline with: {os.path.basename(pdf_path)}")
    print("-" * 40)
    
    try:
        # Import our processing pipeline
        from complete_processing_pipeline import CompletePDFProcessor
        
        processor = CompletePDFProcessor()
        result = processor.process_pdf_complete(pdf_path, force_reprocess=False)
        
        if result['success']:
            print("✅ Pipeline test successful!")
            print(f"   Steps completed: {', '.join(result['steps_completed'])}")
            print(f"   Files created: {len(result['files_created'])}")
            
            # Test highlight data retrieval
            pdf_basename = Path(pdf_path).stem
            test_sentence_ids = [0, 1, 2]  # Test first 3 sentences
            
            highlight_data = processor.get_highlight_data_for_sentence_ids(pdf_basename, test_sentence_ids)
            
            if highlight_data:
                print(f"   Highlight test: ✅ Found data for {highlight_data['sentence_count']} sentences")
                print(f"   Stable elements: {len(highlight_data['stable_elements'])}")
                print(f"   Pages covered: {len(highlight_data['highlights_by_page'])}")
            else:
                print("   Highlight test: ⚠️ No highlight data (may need PDF.js cache)")
            
            return True
        else:
            print("❌ Pipeline test failed!")
            print(f"   Errors: {result['errors']}")
            return False
            
    except Exception as e:
        print(f"❌ Pipeline test error: {e}")
        return False


def create_frontend_integration_example():
    """
    Create example code for frontend integration
    """
    frontend_example = """
// Frontend Integration Example
// Add this to your React component for PDF highlighting

class PDFViewer extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            highlightData: null,
            currentProvenance: null
        };
    }

    // Call this when user clicks "next provenance"
    async handleNextProvenance(questionId, currentCount) {
        try {
            const response = await fetch(`/api/get-next-provenance/${questionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_count: currentCount })
            });
            
            const provenanceData = await response.json();
            
            if (provenanceData.success && provenanceData.provenance.highlight_data) {
                this.setState({
                    currentProvenance: provenanceData.provenance,
                    highlightData: provenanceData.provenance.highlight_data
                });
                
                // Highlight the PDF
                this.highlightPDFElements(provenanceData.provenance.highlight_data);
            }
        } catch (error) {
            console.error('Error getting provenance:', error);
        }
    }

    // Highlight PDF.js elements using stable indices
    highlightPDFElements(highlightData) {
        // Clear previous highlights
        this.clearHighlights();
        
        // Apply new highlights by page
        Object.entries(highlightData.highlights_by_page).forEach(([pageNum, highlights]) => {
            highlights.forEach(highlight => {
                const element = document.querySelector(
                    `[data-stable-index="${highlight.stable_index}"]`
                );
                
                if (element) {
                    element.classList.add('provenance-highlight');
                    element.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
                    element.style.border = '2px solid #ff6b35';
                }
            });
        });
        
        // Scroll to first highlight
        if (highlightData.bounding_boxes.length > 0) {
            this.scrollToHighlight(highlightData.bounding_boxes[0]);
        }
    }

    clearHighlights() {
        document.querySelectorAll('.provenance-highlight').forEach(element => {
            element.classList.remove('provenance-highlight');
            element.style.backgroundColor = '';
            element.style.border = '';
        });
    }

    scrollToHighlight(boundingBox) {
        // Scroll to the highlighted region
        const pageElement = document.querySelector(`[data-page-number="${boundingBox.page}"]`);
        if (pageElement) {
            pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    render() {
        return (
            <div className="pdf-viewer-container">
                {/* Your PDF.js viewer */}
                <div id="pdf-viewer"></div>
                
                {/* Provenance controls */}
                {this.state.currentProvenance && (
                    <div className="provenance-panel">
                        <h3>Provenance {this.state.currentProvenance.provenance_id}</h3>
                        <p>{this.state.currentProvenance.provenance}</p>
                        
                        {this.state.highlightData && (
                            <div className="highlight-info">
                                <p>Highlighting {this.state.highlightData.sentence_count} sentences 
                                   across {Object.keys(this.state.highlightData.highlights_by_page).length} pages</p>
                            </div>
                        )}
                        
                        <button onClick={() => this.handleNextProvenance(this.props.questionId, this.state.currentCount + 1)}>
                            Next Provenance
                        </button>
                    </div>
                )}
            </div>
        );
    }
}

// CSS for highlighting
const highlightStyles = `
    .provenance-highlight {
        background-color: rgba(255, 255, 0, 0.3) !important;
        border: 2px solid #ff6b35 !important;
        border-radius: 2px;
        transition: all 0.3s ease;
    }
    
    .provenance-highlight:hover {
        background-color: rgba(255, 255, 0, 0.5) !important;
    }
`;
"""
    
    with open('frontend_integration_example.js', 'w') as f:
        f.write(frontend_example)
    
    print("📝 Created frontend_integration_example.js")


def create_flask_integration_guide():
    """
    Create Flask integration guide
    """
    flask_guide = """
# Flask Integration Guide

## 1. Add to your existing Flask app

```python
# Add these imports to your Flask app
from complete_processing_pipeline import CompletePDFProcessor

# Initialize the processor (do this once)
pdf_processor = CompletePDFProcessor()

# Import the helper function
from flask_highlight_api import get_provenance_highlight_data
```

## 2. Modify your existing provenance endpoint

```python
@app.route('/api/get-next-provenance/<questionId>', methods=['POST'])
def get_next_provenance(questionId):
    # Your existing logic
    current_count = request.json.get('current_count', 0)
    
    # ... your existing provenance retrieval ...
    
    provenance_response = {
        'success': True,
        'has_more': True,
        'remaining': remaining_count,
        'provenance': {
            'provenance_id': provenance_id,
            'sentences_ids': sentence_ids,
            'provenance_ids': sentence_ids,
            'provenance': provenance_text,
            # ... other fields ...
        }
    }
    
    # ADD THIS: Include highlight data
    pdf_basename = get_pdf_basename_from_question(questionId)  # Your function
    highlight_data = get_provenance_highlight_data(pdf_basename, {
        'sentence_ids': sentence_ids
    })
    
    if highlight_data:
        provenance_response['provenance']['highlight_data'] = highlight_data
    
    return jsonify(provenance_response)
```

## 3. Add document processing endpoint

```python
@app.route('/api/documents/<filename>/process', methods=['POST'])
def process_document_for_highlighting(filename):
    try:
        pdf_basename = filename.replace('.pdf', '')
        pdf_path = os.path.join('uploads', filename)
        
        if not os.path.exists(pdf_path):
            return jsonify({'success': False, 'error': 'PDF not found'}), 404
        
        result = pdf_processor.process_pdf_complete(pdf_path)
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
```

## 4. Testing your integration

1. Process a document:
   ```bash
   curl -X POST http://localhost:5000/api/documents/your_document.pdf/process
   ```

2. Test highlight data:
   ```bash
   curl -X POST http://localhost:5000/api/documents/your_document.pdf/highlight-data \\
        -H "Content-Type: application/json" \\
        -d '{"sentence_ids": [0, 1, 2]}'
   ```

3. Check processing status:
   ```bash
   curl http://localhost:5000/api/documents/your_document.pdf/processing-status
   ```
"""
    
    with open('flask_integration_guide.md', 'w') as f:
        f.write(flask_guide)
    
    print("📝 Created flask_integration_guide.md")


def main():
    """
    Main setup and testing function
    """
    print("🎯 Coordinate-Based PDF Highlighting Setup")
    print("=========================================")
    
    # Step 1: Setup directories
    setup_result = setup_coordinate_highlighting_system()
    
    # Step 2: Create integration examples
    print("\n📚 Creating integration guides...")
    create_frontend_integration_example()
    create_flask_integration_guide()
    
    # Step 3: Test with first available PDF
    uploads_dir = os.path.join(os.getcwd(), 'uploads')
    if os.path.exists(uploads_dir):
        pdf_files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
        
        if pdf_files:
            test_pdf = os.path.join(uploads_dir, pdf_files[0])
            if test_single_pdf(test_pdf):
                print("\n🎉 Setup and testing complete!")
            else:
                print("\n⚠️ Setup complete but testing failed")
                print("   This is normal if PDF.js cache is not available yet")
        else:
            print("\n✅ Setup complete!")
            print("   No PDFs found for testing - add PDFs to uploads/ directory")
    
    # Step 4: Next steps
    print("\n📋 Next Steps:")
    print("1. Add PDFs to the uploads/ directory")
    print("2. Run PDF.js extraction to create cache (for stable element mapping)")
    print("3. Process documents with: python complete_processing_pipeline.py")
    print("4. Integrate the Flask endpoints into your app")
    print("5. Add the frontend highlighting code to your React components")
    
    print("\n🔗 Integration files created:")
    print("   - frontend_integration_example.js")
    print("   - flask_integration_guide.md")
    
    return setup_result


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == '--test-pdf':
        # Test specific PDF
        if len(sys.argv) > 2:
            pdf_path = sys.argv[2]
            if os.path.exists(pdf_path):
                test_single_pdf(pdf_path)
            else:
                print(f"PDF not found: {pdf_path}")
        else:
            print("Usage: python integration_guide.py --test-pdf <path_to_pdf>")
    else:
        # Full setup
        main()