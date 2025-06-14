#!/usr/bin/env python3
"""
PDF Mapping Debugger - Debug why sentences aren't mapping between PDFMiner and PDF.js
"""

import json
import os
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import difflib
import re
from pdfminer.high_level import extract_text
import nltk

class PDFMappingDebugger:
    """Debug tool for PDF sentence mapping issues"""
    
    def __init__(self, verbose: bool = True):
        self.logger = self._setup_logging(verbose)
        self.debug_output = []
        
    def _setup_logging(self, verbose: bool) -> logging.Logger:
        logger = logging.getLogger('PDFMappingDebugger')
        logger.setLevel(logging.DEBUG if verbose else logging.INFO)
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            
        return logger
    
    def debug_sentence_mapping(self, pdf_path: str, sentences_file: str, failed_sentence_ids: List[int] = None) -> Dict:
        """
        Debug why specific sentences failed to map
        
        Args:
            pdf_path: Path to the PDF file
            sentences_file: Path to the sentences JSON file
            failed_sentence_ids: List of sentence IDs that failed (if None, will identify them)
        """
        
        self.logger.info(f"Starting debug analysis for {pdf_path}")
        
        # Load the sentences
        with open(sentences_file, 'r', encoding='utf-8') as f:
            sentences_data = json.load(f)
        
        if isinstance(sentences_data, list):
            sentences = sentences_data
        else:
            sentences = sentences_data.get('sentences', [])
        
        # Extract PDF.js content 
        from pdf_mapping_generator import FixedPDFMappingGenerator
        generator = FixedPDFMappingGenerator(verbose=True)
        pdfjs_data = generator.extract_pdfjs_content(pdf_path)
        
        if not pdfjs_data:
            self.logger.error("Failed to extract PDF.js content")
            return {}
        
        # Extract PDFMiner content for comparison
        pdfminer_text = extract_text(pdf_path)
        
        # Build full PDF.js text
        full_pdfjs_text = self._build_full_pdfjs_text(pdfjs_data)
        
        # Identify failed sentences if not provided
        if failed_sentence_ids is None:
            failed_sentence_ids = self._identify_failed_sentences(sentences, full_pdfjs_text)
        
        # Debug each failed sentence
        debug_results = {}
        
        for sent_id in failed_sentence_ids:
            if sent_id < len(sentences):
                sentence_text = sentences[sent_id]
                debug_info = self._debug_single_sentence(
                    sent_id, 
                    sentence_text, 
                    pdfminer_text, 
                    full_pdfjs_text,
                    pdfjs_data
                )
                debug_results[sent_id] = debug_info
                
                self.logger.info(f"Debug results for sentence {sent_id}:")
                for key, value in debug_info.items():
                    if key != 'comparison_details':
                        self.logger.info(f"  {key}: {value}")
        
        # Generate comprehensive report
        report = self._generate_debug_report(debug_results, sentences, pdfminer_text, full_pdfjs_text)
        
        return {
            'failed_sentences': debug_results,
            'report': report,
            'statistics': self._calculate_debug_statistics(debug_results)
        }
    
    def _build_full_pdfjs_text(self, pdfjs_data: List[Dict]) -> str:
        """Build the full text from PDF.js data"""
        full_text = ""
        
        for page_data in pdfjs_data:
            items = page_data.get('items', [])
            for item in items:
                text = item.get('str', '')
                full_text += text
                
                # Add space if not end of line
                if not item.get('hasEOL', False) and text and not text.endswith(' '):
                    full_text += ' '
        
        return full_text
    
    def _identify_failed_sentences(self, sentences: List[str], full_pdfjs_text: str) -> List[int]:
        """Identify which sentences failed to map"""
        failed_ids = []
        
        for i, sentence in enumerate(sentences):
            # Try simple text search
            clean_sentence = sentence.strip()
            normalized_sentence = self._normalize_text(clean_sentence)
            normalized_pdfjs = self._normalize_text(full_pdfjs_text)
            
            if (clean_sentence not in full_pdfjs_text and 
                normalized_sentence not in normalized_pdfjs):
                failed_ids.append(i)
        
        return failed_ids
    
    def _debug_single_sentence(self, sent_id: int, sentence_text: str, pdfminer_text: str, 
                              pdfjs_text: str, pdfjs_data: List[Dict]) -> Dict:
        """Debug a single sentence mapping failure"""
        
        debug_info = {
            'sentence_id': sent_id,
            'sentence_text': sentence_text,
            'sentence_length': len(sentence_text),
            'issues_found': [],
            'suggestions': [],
            'comparison_details': {}
        }
        
        # Check 1: Basic text presence
        if sentence_text.strip() in pdfjs_text:
            debug_info['issues_found'].append("UNEXPECTED: Sentence found in PDF.js text but mapping failed")
            debug_info['suggestions'].append("Check mapping algorithm implementation")
        else:
            debug_info['issues_found'].append("Sentence not found exactly in PDF.js text")
        
        # Check 2: Normalized text comparison
        norm_sentence = self._normalize_text(sentence_text)
        norm_pdfjs = self._normalize_text(pdfjs_text)
        
        if norm_sentence in norm_pdfjs:
            debug_info['issues_found'].append("Sentence found after normalization - whitespace/case issue")
            debug_info['suggestions'].append("Improve text normalization in mapping")
        
        # Check 3: Fuzzy matching analysis
        similarity = difflib.SequenceMatcher(None, norm_sentence, norm_pdfjs).ratio()
        debug_info['comparison_details']['overall_similarity'] = similarity
        
        # Check 4: Word-level analysis
        sentence_words = self._extract_words(sentence_text)
        found_words = 0
        missing_words = []
        
        for word in sentence_words:
            if word.lower() in pdfjs_text.lower():
                found_words += 1
            else:
                missing_words.append(word)
        
        word_coverage = found_words / len(sentence_words) if sentence_words else 0
        debug_info['comparison_details']['word_coverage'] = word_coverage
        debug_info['comparison_details']['missing_words'] = missing_words
        
        if word_coverage < 0.7:
            debug_info['issues_found'].append(f"Low word coverage: {word_coverage:.2%}")
            debug_info['suggestions'].append("Sentence may be from different document or extraction error")
        
        # Check 5: Character encoding issues
        encoding_issues = self._check_encoding_issues(sentence_text, pdfjs_text)
        if encoding_issues:
            debug_info['issues_found'].extend(encoding_issues)
            debug_info['suggestions'].append("Check for character encoding differences")
        
        # Check 6: Partial matches
        partial_matches = self._find_partial_matches(sentence_text, pdfjs_text)
        debug_info['comparison_details']['partial_matches'] = partial_matches
        
        if partial_matches:
            debug_info['suggestions'].append(f"Found {len(partial_matches)} partial matches - sentence may be split")
        
        # Check 7: Page boundary issues
        page_boundary_analysis = self._analyze_page_boundaries(sentence_text, pdfjs_data)
        debug_info['comparison_details']['page_analysis'] = page_boundary_analysis
        
        return debug_info
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison"""
        # Handle encoding issues
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='ignore')
        
        # Basic normalization
        normalized = text.lower().strip()
        normalized = re.sub(r'\s+', ' ', normalized)
        normalized = normalized.replace('\n', ' ').replace('\r', ' ')
        
        return normalized
    
    def _extract_words(self, text: str) -> List[str]:
        """Extract meaningful words from text"""
        words = re.findall(r'\b\w{3,}\b', text.lower())
        
        # Filter out common stop words
        stop_words = {'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'has', 'use'}
        meaningful_words = [w for w in words if w not in stop_words]
        
        return meaningful_words
    
    def _check_encoding_issues(self, sentence: str, pdfjs_text: str) -> List[str]:
        """Check for character encoding issues"""
        issues = []
        
        # Check for common problematic characters
        problematic_chars = ['—', '–', '"', '"', ''', ''', '…']
        
        for char in problematic_chars:
            if char in sentence:
                issues.append(f"Contains special character: {char}")
        
        # Check for non-ASCII characters
        non_ascii = [c for c in sentence if ord(c) > 127]
        if non_ascii:
            issues.append(f"Contains non-ASCII characters: {set(non_ascii)}")
        
        return issues
    
    def _find_partial_matches(self, sentence: str, pdfjs_text: str, min_length: int = 20) -> List[Dict]:
        """Find partial matches of the sentence in the text"""
        matches = []
        
        # Try different chunks of the sentence
        words = sentence.split()
        
        for start in range(len(words)):
            for end in range(start + 3, len(words) + 1):  # At least 3 words
                chunk = ' '.join(words[start:end])
                
                if len(chunk) >= min_length:
                    pos = pdfjs_text.find(chunk)
                    if pos >= 0:
                        matches.append({
                            'text': chunk,
                            'position': pos,
                            'word_range': (start, end),
                            'coverage': (end - start) / len(words)
                        })
        
        return matches
    
    def _analyze_page_boundaries(self, sentence: str, pdfjs_data: List[Dict]) -> Dict:
        """Analyze if sentence might span page boundaries"""
        sentence_words = sentence.split()
        analysis = {
            'sentence_word_count': len(sentence_words),
            'pages_with_words': [],
            'potential_split': False
        }
        
        # Check each page for words from the sentence
        for page_num, page_data in enumerate(pdfjs_data, 1):
            page_text = ""
            for item in page_data.get('items', []):
                page_text += item.get('str', '') + " "
            
            words_found = []
            for word in sentence_words[:5]:  # Check first 5 words
                if word.lower() in page_text.lower():
                    words_found.append(word)
            
            if words_found:
                analysis['pages_with_words'].append({
                    'page': page_num,
                    'words_found': words_found,
                    'word_count': len(words_found)
                })
        
        # If words are found on multiple pages, it might be a split sentence
        if len(analysis['pages_with_words']) > 1:
            analysis['potential_split'] = True
        
        return analysis
    
    def _generate_debug_report(self, debug_results: Dict, sentences: List[str], 
                              pdfminer_text: str, pdfjs_text: str) -> Dict:
        """Generate a comprehensive debug report"""
        
        total_sentences = len(sentences)
        failed_count = len(debug_results)
        success_rate = (total_sentences - failed_count) / total_sentences if total_sentences > 0 else 0
        
        # Categorize issues
        issue_categories = {}
        
        for sent_id, debug_info in debug_results.items():
            for issue in debug_info['issues_found']:
                category = issue.split(':')[0]  # Use first part as category
                if category not in issue_categories:
                    issue_categories[category] = []
                issue_categories[category].append(sent_id)
        
        # Text comparison stats
        pdfminer_length = len(pdfminer_text)
        pdfjs_length = len(pdfjs_text)
        text_similarity = difflib.SequenceMatcher(None, pdfminer_text, pdfjs_text).ratio()
        
        return {
            'summary': {
                'total_sentences': total_sentences,
                'failed_mappings': failed_count,
                'success_rate': success_rate,
                'overall_text_similarity': text_similarity
            },
            'text_extraction_comparison': {
                'pdfminer_length': pdfminer_length,
                'pdfjs_length': pdfjs_length,
                'length_difference': abs(pdfminer_length - pdfjs_length),
                'length_ratio': pdfjs_length / pdfminer_length if pdfminer_length > 0 else 0
            },
            'issue_categories': issue_categories,
            'recommendations': self._generate_recommendations(issue_categories, text_similarity)
        }
    
    def _generate_recommendations(self, issue_categories: Dict, text_similarity: float) -> List[str]:
        """Generate recommendations based on identified issues"""
        recommendations = []
        
        if text_similarity < 0.8:
            recommendations.append("Low text similarity between PDFMiner and PDF.js - consider preprocessing")
        
        if 'Low word coverage' in issue_categories:
            recommendations.append("Multiple sentences have low word coverage - check extraction methods")
        
        if 'Contains special character' in issue_categories:
            recommendations.append("Character encoding issues detected - improve text normalization")
        
        if 'Sentence not found exactly' in issue_categories:
            recommendations.append("Many exact matches failing - implement fuzzy matching")
        
        recommendations.append("Consider lowering confidence thresholds for mapping")
        recommendations.append("Implement fallback mapping strategies for failed sentences")
        
        return recommendations
    
    def _calculate_debug_statistics(self, debug_results: Dict) -> Dict:
        """Calculate statistics from debug results"""
        if not debug_results:
            return {}
        
        word_coverages = []
        similarities = []
        
        for debug_info in debug_results.values():
            details = debug_info.get('comparison_details', {})
            if 'word_coverage' in details:
                word_coverages.append(details['word_coverage'])
            if 'overall_similarity' in details:
                similarities.append(details['overall_similarity'])
        
        stats = {
            'failed_sentence_count': len(debug_results),
            'average_word_coverage': sum(word_coverages) / len(word_coverages) if word_coverages else 0,
            'average_similarity': sum(similarities) / len(similarities) if similarities else 0
        }
        
        return stats
    
    def save_debug_report(self, debug_results: Dict, output_file: str):
        """Save debug results to a JSON file"""
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(debug_results, f, indent=2, ensure_ascii=False)
        
        self.logger.info(f"Debug report saved to {output_file}")


def debug_mapping_pipeline(pdf_path: str, sentences_file: str, output_dir: str = "debug_output"):
    """
    Main function to debug mapping pipeline issues
    """
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Initialize debugger
    debugger = PDFMappingDebugger(verbose=True)
    
    # Run debug analysis
    print(f"Debugging PDF mapping for: {pdf_path}")
    print(f"Using sentences from: {sentences_file}")
    
    debug_results = debugger.debug_sentence_mapping(pdf_path, sentences_file)
    
    # Save results
    pdf_name = Path(pdf_path).stem
    debug_file = os.path.join(output_dir, f"{pdf_name}_debug_report.json")
    debugger.save_debug_report(debug_results, debug_file)
    
    # Print summary
    report = debug_results.get('report', {})
    summary = report.get('summary', {})
    
    print("\n" + "="*50)
    print("DEBUG SUMMARY")
    print("="*50)
    print(f"Total sentences: {summary.get('total_sentences', 'N/A')}")
    print(f"Failed mappings: {summary.get('failed_mappings', 'N/A')}")
    print(f"Success rate: {summary.get('success_rate', 0):.1%}")
    print(f"Text similarity: {summary.get('overall_text_similarity', 0):.3f}")
    
    # Print recommendations
    recommendations = report.get('recommendations', [])
    if recommendations:
        print(f"\nRECOMMENDATIONS:")
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec}")
    
    print(f"\nFull debug report saved to: {debug_file}")
    
    return debug_results


if __name__ == "__main__":

    pdf_path = Path(os.path.join(os.getcwd(), "gdrive_downloads", "batch_1749077216", "12000010_3_NCSO_Redacted-jw.pdf"))

    sentences_file = Path(os.path.join(os.getcwd(), "sentences", "12000010_3_NCSO_Redacted-jw_sentences.json"))
    
    debug_mapping_pipeline(pdf_path, sentences_file, 'debug_output')