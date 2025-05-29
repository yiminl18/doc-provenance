#!/usr/bin/env python3
"""
Script to help setup preloaded documents for testing
Place this in your project root and run it to check your setup
"""

import os
import json
import sys
from pathlib import Path

def check_upload_folder_setup():
    """Check if upload folder is properly configured"""
    
    # Try to find the Flask app config
    app_folder = Path('app')
    if not app_folder.exists():
        print("❌ Could not find 'app' folder. Are you in the project root?")
        return False
    
    # Check for upload folder configuration
    config_files = ['config.py', '__init__.py', 'routes.py']
    upload_folder = None
    
    for config_file in config_files:
        config_path = app_folder / config_file
        if config_path.exists():
            try:
                with open(config_path, 'r') as f:
                    content = f.read()
                    if 'UPLOAD_FOLDER' in content:
                        print(f"✅ Found UPLOAD_FOLDER configuration in {config_file}")
                        # Try to extract the path (basic parsing)
                        for line in content.split('\n'):
                            if 'UPLOAD_FOLDER' in line and '=' in line:
                                print(f"   Config line: {line.strip()}")
                        break
            except Exception as e:
                print(f"⚠️  Could not read {config_file}: {e}")
    
    # Common upload folder locations
    possible_folders = [
        'uploads'
    ]
    
    print("\n📁 Checking for upload folders:")
    for folder in possible_folders:
        path = Path(folder)
        if path.exists():
            files = list(path.glob('*.pdf'))
            print(f"✅ {folder} exists with {len(files)} PDF files")
            
            if files:
                print(f"   PDF files found:")
                for pdf in files[:5]:  # Show first 5
                    size = pdf.stat().st_size
                    print(f"   - {pdf.name} ({size:,} bytes)")
                if len(files) > 5:
                    print(f"   ... and {len(files) - 5} more files")
            
            return str(path)
        else:
            print(f"❌ {folder} does not exist")
    
    return None

def create_sample_upload_folder():
    """Create upload folder and add instructions"""
    upload_folder = Path('uploads')
    upload_folder.mkdir(parents=True, exist_ok=True)
    
    readme_content = """# Upload Folder for Preloaded Documents

This folder should contain your PDF research papers for preloaded document browsing.

## Setup Instructions:

1. Copy your PDF research papers into this folder
2. The system will automatically scan and process them
3. Users can then browse and select these papers through the interface

## Supported File Types:
- PDF files (.pdf extension)

## Automatic Processing:
- Text extraction using pdfminer
- Sentence segmentation for provenance analysis
- Metadata generation and caching

## File Naming Recommendations:
- Use descriptive names: `database-systems-evolution.pdf`
- Avoid special characters and spaces
- Use hyphens or underscores: `machine-learning-survey.pdf`

## Examples of Good Filenames:
- `whatgoes-around-sigmod2024.pdf`
- `distributed-systems-survey.pdf`
- `neural-networks-deep-learning.pdf`
- `data-privacy-cloud-computing.pdf`

The system will automatically generate descriptions based on filename patterns.
"""
    
    readme_path = upload_folder / 'README.md'
    with open(readme_path, 'w') as f:
        f.write(readme_content)
    
    print(f"✅ Created upload folder: {upload_folder}")
    print(f"✅ Added README with instructions")
    
    return str(upload_folder)

def check_dependencies():
    """Check if required Python packages are available"""
    required_packages = [
        'flask',
        'pdfminer.six',
        'pathlib'
    ]
    
    print("\n📦 Checking Python dependencies:")
    missing = []
    
    for package in required_packages:
        try:
            if package == 'pdfminer.six':
                import pdfminer.high_level
                print(f"✅ {package} is installed")
            elif package == 'pathlib':
                import pathlib
                print(f"✅ {package} is available")
            elif package == 'flask':
                import flask
                print(f"✅ {package} is installed")
        except ImportError:
            print(f"❌ {package} is NOT installed")
            missing.append(package)
    
    if missing:
        print(f"\n⚠️  Install missing packages with:")
        print(f"pip install {' '.join(missing)}")
        return False
    
    return True

def main():
    print("🔍 Checking Preloaded Documents Setup\n")
    
    # Check dependencies
    deps_ok = check_dependencies()
    
    # Check upload folder
    upload_folder = check_upload_folder_setup()
    
    if not upload_folder:
        print(f"\n📁 No upload folder found. Creating one...")
        upload_folder = create_sample_upload_folder()
    
    # Summary
    print(f"\n📋 Setup Summary:")
    print(f"Dependencies: {'✅ OK' if deps_ok else '❌ Missing packages'}")
    print(f"Upload Folder: {upload_folder}")
    
    if upload_folder:
        pdf_count = len(list(Path(upload_folder).glob('*.pdf')))
        print(f"PDF Files: {pdf_count} found")
        
        if pdf_count == 0:
            print(f"\n💡 Next Steps:")
            print(f"1. Add PDF files to: {upload_folder}")
            print(f"2. Start your Flask application")
            print(f"3. Visit /debug/upload-folder to verify detection")
            print(f"4. Test the 'Browse Papers' feature in your frontend")
    
    print(f"\n🚀 Ready to test preloaded documents!")

if __name__ == '__main__':
    main()