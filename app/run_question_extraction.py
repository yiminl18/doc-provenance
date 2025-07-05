#!/usr/bin/env python3
"""
Simple runner script for extracting question components from stable mapping files.

Usage:
    python run_extraction.py

This will:
1. Process all *_mappings.json files in the stable_mappings/ folder
2. Extract sentence texts using ['sentence_to_items'][sentence_id]['text']
3. Extract linguistic components (subjects, verbs, objects, etc.)
4. Save individual document components and aggregated results
5. Generate a summary report

Output files will be saved to question_components/ folder.
"""

import sys
import os
from pathlib import Path

# Add current directory to Python path
sys.path.append(str(Path(__file__).parent))

try:
    from batch_component_extractor import BatchComponentExtractor
except ImportError:
    print("❌ Error: Could not import BatchComponentExtractor")
    print("Make sure both question_component_extractor.py and batch_component_extractor.py are in the current directory")
    sys.exit(1)

def main():
    print("=" * 60)
    print("🔍 QUESTION COMPONENT EXTRACTION")
    print("=" * 60)
    print("Processing stable mapping files to extract question components...")
    
    # Check if stable_mappings directory exists
    stable_mappings_dir = Path("stable_mappings")
    if not stable_mappings_dir.exists():
        print(f"❌ Error: {stable_mappings_dir} directory not found!")
        print("Make sure you have stable mapping files in the stable_mappings/ folder")
        return False
    
    # Count mapping files
    mapping_files = list(stable_mappings_dir.glob("*_mappings.json"))
    if not mapping_files:
        print(f"❌ Error: No *_mappings.json files found in {stable_mappings_dir}")
        return False
    
    print(f"📄 Found {len(mapping_files)} mapping files to process")
    
    # Initialize and run extractor
    try:
        extractor = BatchComponentExtractor(
            stable_mappings_dir="stable_mappings",
            output_dir="question_components"
        )
        
        print("\n🚀 Starting extraction...")
        
        # Process with reasonable settings
        components = extractor.process_all_mappings(
            min_frequency=1,      # Lower threshold to catch more components
            save_individual=True  # Save per-document results
        )
        
        if components:
            print("\n✅ SUCCESS!")
            
            # Show quick results preview
            if 'aggregated_statistics' in components:
                stats = components['aggregated_statistics']
                print(f"\n📊 RESULTS PREVIEW:")
                for comp_type, count in stats['component_counts'].items():
                    if count > 0:
                        print(f"  {comp_type}: {count} unique items")
                
                print(f"\n🎯 Top subjects:")
                if 'subjects' in components:
                    for item in components['subjects'][:3]:
                        print(f"  - {item['text']} (appears {item['frequency']} times)")
                
                print(f"\n🎯 Top verbs:")
                if 'verbs' in components:
                    for item in components['verbs'][:3]:
                        print(f"  - {item['text']} (appears {item['frequency']} times)")
            
            print(f"\n📁 Output files saved to: question_components/")
            print(f"   - aggregated_components.json (all components combined)")
            print(f"   - individual document files (*_components.json)")
            print(f"   - extraction_summary.txt (detailed report)")
            
            print(f"\n🔮 Ready for question generation!")
            return True
            
        else:
            print("❌ No components extracted")
            return False
            
    except Exception as e:
        print(f"❌ Extraction failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("🎉 Component extraction complete!")
    print("Next steps:")
    print("1. Review the aggregated_components.json file")
    print("2. Check the extraction_summary.txt for details")
    print("3. Use components for question generation")
    print("=" * 60)