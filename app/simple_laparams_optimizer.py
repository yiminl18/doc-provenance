"""
Simple Per-PDF LAParams Optimizer and Cache
Finds and saves the best LAParams for each individual PDF
"""

import os
import json
import time
import hashlib
from pathlib import Path
from typing import Dict, Tuple, Optional
from dataclasses import dataclass, asdict

from pdfminer.layout import LAParams
from werkzeug.utils import secure_filename

# Import from our previous optimizer (assuming it's available)
from laparams_optimizer import LAParamsConfig, LAParamsOptimizer

class SimplePDFLAParamsCache:
    """Simple cache for per-PDF optimized LAParams"""
    
    def __init__(self, cache_file: str = "pdf_laparams_cache.json", verbose: bool = False):
        self.cache_file = cache_file
        self.verbose = verbose
        self.optimizer = LAParamsOptimizer(verbose=verbose)
        self.cache = self._load_cache()
        
    def log(self, message: str):
        if self.verbose:
            print(f"🗃️ {message}")
    
    def _get_pdf_hash(self, pdf_path: str) -> str:
        """Generate a hash for the PDF file to detect changes"""
        try:
            # Use file size and modification time for a quick hash
            stat = os.stat(pdf_path)
            content = f"{pdf_path}_{stat.st_size}_{stat.st_mtime}"
            return hashlib.md5(content.encode()).hexdigest()[:12]
        except:
            # Fallback to just filename
            return hashlib.md5(os.path.basename(pdf_path).encode()).hexdigest()[:12]
    
    def _load_cache(self) -> Dict:
        """Load existing cache from file"""
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                    self.log(f"Loaded cache with {len(cache_data.get('pdfs', {}))} PDFs")
                    return cache_data
            except Exception as e:
                self.log(f"❌ Error loading cache: {e}")
        
        return {'pdfs': {}, 'metadata': {'version': '1.0', 'created': time.time()}}
    
    def _save_cache(self):
        """Save cache to file"""
        self.cache['metadata']['last_updated'] = time.time()
        
        os.makedirs(os.path.dirname(self.cache_file) if os.path.dirname(self.cache_file) else '.', exist_ok=True)
        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(self.cache, f, indent=2, ensure_ascii=False)
        
        self.log(f"💾 Saved cache to {self.cache_file}")
    
    def get_optimal_laparams(self, pdf_path: str, force_reoptimize: bool = False) -> Tuple[LAParams, float, Dict]:
        """
        Get optimal LAParams for a PDF, optimizing if necessary
        
        Returns:
            (LAParams object, quality_score, optimization_report)
        """
        pdf_path = os.path.abspath(pdf_path)
        pdf_hash = self._get_pdf_hash(pdf_path)
        cache_key = os.path.basename(pdf_path)
        
        # Check cache first
        if not force_reoptimize and cache_key in self.cache['pdfs']:
            cached_entry = self.cache['pdfs'][cache_key]
            
            # Verify the file hasn't changed
            if cached_entry.get('pdf_hash') == pdf_hash:
                self.log(f"📋 Using cached LAParams for {cache_key}")
                
                # Reconstruct LAParamsConfig from cache
                config_dict = cached_entry['optimal_config']
                config = LAParamsConfig(**config_dict)
                
                return config.to_laparams(), cached_entry['quality_score'], cached_entry.get('optimization_report', {})
            else:
                self.log(f"🔄 PDF {cache_key} has changed, re-optimizing...")
        
        # Need to optimize
        self.log(f"🔧 Optimizing LAParams for {cache_key}")
        
        try:
            optimal_config, quality_score, optimization_report = self.optimizer.optimize_for_pdf(pdf_path)
            
            # Cache the results
            self.cache['pdfs'][cache_key] = {
                'pdf_path': pdf_path,
                'pdf_hash': pdf_hash,
                'optimal_config': asdict(optimal_config),
                'quality_score': quality_score,
                'optimization_report': optimization_report,
                'optimized_at': time.time(),
                'file_size': os.path.getsize(pdf_path)
            }
            
            self._save_cache()
            
            self.log(f"✅ Optimized {cache_key} (quality score: {quality_score:.3f})")
            return optimal_config.to_laparams(), quality_score, optimization_report
            
        except Exception as e:
            self.log(f"❌ Optimization failed for {cache_key}: {e}")
            # Fall back to default parameters
            default_config = LAParamsConfig()
            return default_config.to_laparams(), 0.0, {'error': str(e)}
    
    def has_cached_params(self, pdf_path: str) -> bool:
        """Check if we have cached parameters for a PDF"""
        cache_key = os.path.basename(pdf_path)
        if cache_key not in self.cache['pdfs']:
            return False
        
        # Verify file hasn't changed
        pdf_hash = self._get_pdf_hash(pdf_path)
        cached_entry = self.cache['pdfs'][cache_key]
        return cached_entry.get('pdf_hash') == pdf_hash
    
    def remove_from_cache(self, pdf_path: str):
        """Remove a PDF from cache (useful if file is deleted or you want to re-optimize)"""
        cache_key = os.path.basename(pdf_path)
        if cache_key in self.cache['pdfs']:
            del self.cache['pdfs'][cache_key]
            self._save_cache()
            self.log(f"🗑️ Removed {cache_key} from cache")
    
    def get_cache_statistics(self) -> Dict:
        """Get statistics about the cache"""
        pdfs = self.cache.get('pdfs', {})
        
        if not pdfs:
            return {'total_pdfs': 0}
        
        quality_scores = [entry['quality_score'] for entry in pdfs.values() if 'quality_score' in entry]
        optimization_times = []
        
        for entry in pdfs.values():
            report = entry.get('optimization_report', {})
            if 'time' in report:
                optimization_times.append(report['time'])
        
        stats = {
            'total_pdfs': len(pdfs),
            'cache_file': self.cache_file,
            'cache_size_mb': os.path.getsize(self.cache_file) / 1024 / 1024 if os.path.exists(self.cache_file) else 0,
            'quality_scores': {
                'mean': sum(quality_scores) / len(quality_scores) if quality_scores else 0,
                'min': min(quality_scores) if quality_scores else 0,
                'max': max(quality_scores) if quality_scores else 0
            },
            'avg_optimization_time': sum(optimization_times) / len(optimization_times) if optimization_times else 0,
            'pdfs': [
                {
                    'filename': filename,
                    'quality_score': entry.get('quality_score', 0),
                    'optimized_at': entry.get('optimized_at', 0),
                    'file_size_mb': entry.get('file_size', 0) / 1024 / 1024
                }
                for filename, entry in pdfs.items()
            ]
        }
        
        return stats
    
    def preoptimize_directory(self, pdf_directory: str, file_pattern: str = "*.pdf"):
        """Pre-optimize all PDFs in a directory"""
        pdf_files = list(Path(pdf_directory).glob(file_pattern))
        
        self.log(f"Pre-optimizing {len(pdf_files)} PDFs in {pdf_directory}")
        
        for i, pdf_path in enumerate(pdf_files, 1):
            self.log(f"Processing {i}/{len(pdf_files)}: {pdf_path.name}")
            try:
                self.get_optimal_laparams(str(pdf_path))
            except Exception as e:
                self.log(f"❌ Failed to optimize {pdf_path.name}: {e}")
        
        self.log(f"🎉 Pre-optimization complete")


# Enhanced coordinate extractor that uses the simple cache
class LAParamsAwareCoordinateExtractor:
    """Enhanced coordinate extractor that automatically uses optimal LAParams"""
    
    def __init__(self, pdf_path: str, verbose: bool = False, 
                 cache_file: str = "pdf_laparams_cache.json",
                 auto_optimize: bool = True):
        self.pdf_path = pdf_path
        self.verbose = verbose
        self.auto_optimize = auto_optimize
        
        if auto_optimize:
            self.params_cache = SimplePDFLAParamsCache(cache_file=cache_file, verbose=verbose)
            self.laparams, self.quality_score, self.optimization_report = self.params_cache.get_optimal_laparams(pdf_path)
            self.log(f"Using LAParams with quality score: {self.quality_score:.3f}")
        else:
            self.laparams = LAParams()
            self.quality_score = 0.0
            self.optimization_report = {}
        
    def log(self, message: str):
        if self.verbose:
            print(f"📍 {message}")
    
    def extract_sentences_with_optimal_params(self):
        """Extract sentences using the optimized LAParams"""
        # Import your existing extraction logic here
        from pdfminer_coord_extraction import EnhancedCoordinateExtractor
        
        # Create extractor with custom LAParams
        extractor = EnhancedCoordinateExtractor(self.pdf_path, verbose=self.verbose)
        
        # Override the LAParams with our optimized ones
        extractor.laparams = self.laparams
        
        # Run extraction
        sentences, sentence_mappings, layout_elements = extractor.extract_sentences_with_element_mapping()
        
        return sentences, sentence_mappings, layout_elements
    
    def get_laparams_info(self) -> Dict:
        """Get information about the LAParams being used"""
        return {
            'word_margin': self.laparams.word_margin,
            'char_margin': self.laparams.char_margin,
            'line_margin': self.laparams.line_margin,
            'boxes_flow': self.laparams.boxes_flow,
            'all_texts': self.laparams.all_texts,
            'detect_vertical': self.laparams.detect_vertical,
            'quality_score': self.quality_score,
            'was_optimized': self.auto_optimize,
            'optimization_time': self.optimization_report.get('time', 0)
        }


def optimize_pdf_laparams(pdf_path: str, cache_file: str = "pdf_laparams_cache.json", 
                         force_reoptimize: bool = False, verbose: bool = True) -> Dict:
    """
    Convenience function to optimize LAParams for a single PDF
    
    Returns:
        Dictionary with optimization results
    """
    cache = SimplePDFLAParamsCache(cache_file=cache_file, verbose=verbose)
    laparams, quality_score, optimization_report = cache.get_optimal_laparams(
        pdf_path, force_reoptimize=force_reoptimize
    )
    
    return {
        'pdf_path': pdf_path,
        'laparams': {
            'word_margin': laparams.word_margin,
            'char_margin': laparams.char_margin,
            'line_margin': laparams.line_margin,
            'boxes_flow': laparams.boxes_flow
        },
        'quality_score': quality_score,
        'optimization_report': optimization_report,
        'cached': not force_reoptimize and cache.has_cached_params(pdf_path)
    }


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        force_reoptimize = '--force' in sys.argv
        
        if os.path.isfile(pdf_path) and pdf_path.endswith('.pdf'):
            # Single PDF optimization
            result = optimize_pdf_laparams(pdf_path, force_reoptimize=force_reoptimize)
            
            print(f"\n🎉 Optimization complete for {os.path.basename(pdf_path)}")
            print(f"📊 Quality score: {result['quality_score']:.3f}")
            print(f"📋 Cached: {result['cached']}")
            print(f"⚙️ LAParams:")
            for param, value in result['laparams'].items():
                print(f"   {param}: {value:.3f}")
                
        elif os.path.isdir(pdf_path):
            # Directory pre-optimization
            cache = SimplePDFLAParamsCache(verbose=True)
            cache.preoptimize_directory(pdf_path)
            
            # Show statistics
            stats = cache.get_cache_statistics()
            print(f"\n📊 Cache Statistics:")
            print(f"   Total PDFs: {stats['total_pdfs']}")
            print(f"   Average quality: {stats['quality_scores']['mean']:.3f}")
            print(f"   Cache size: {stats['cache_size_mb']:.2f} MB")
            
        else:
            print(f"Path not found: {pdf_path}")
    else:
        print("Usage:")
        print("  python simple_pdf_laparams_cache.py <pdf_file> [--force]")
        print("  python simple_pdf_laparams_cache.py <pdf_directory>")