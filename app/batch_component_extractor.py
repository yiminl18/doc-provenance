import os
import json
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict, Counter
import time

# Import our component extractor
from question_component_extractor import QuestionComponentExtractor

class BatchComponentExtractor:
    """
    Batch processes stable mapping files to extract question components from sentences.
    """
    
    def __init__(self, stable_mappings_dir: str = "stable_mappings", output_dir: str = "question_components"):
        self.stable_mappings_dir = Path(stable_mappings_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Initialize the component extractor
        self.extractor = QuestionComponentExtractor(use_spacy=True)
        
        # Track processing stats
        self.processing_stats = {
            'files_processed': 0,
            'total_sentences': 0,
            'total_documents': 0,
            'errors': []
        }
    
    def process_all_mappings(self, min_frequency: int = 2, save_individual: bool = True) -> Dict:
        """
        Process all stable mapping files in the directory.
        
        Args:
            min_frequency: Minimum frequency for component inclusion
            save_individual: Whether to save individual document components
            
        Returns:
            Aggregated components across all documents
        """
        print(f"🔍 Scanning {self.stable_mappings_dir} for mapping files...")
        
        if not self.stable_mappings_dir.exists():
            raise FileNotFoundError(f"Stable mappings directory not found: {self.stable_mappings_dir}")
        
        # Find all mapping files
        mapping_files = list(self.stable_mappings_dir.glob("*_mappings.json"))
        
        if not mapping_files:
            print(f"❌ No mapping files found in {self.stable_mappings_dir}")
            return {}
        
        print(f"📄 Found {len(mapping_files)} mapping files")
        
        # Aggregate components across all documents
        aggregated_components = defaultdict(list)
        document_summaries = []
        
        for mapping_file in mapping_files:
            try:
                print(f"\n🔄 Processing: {mapping_file.name}")
                
                # Extract document name from filename
                doc_name = mapping_file.name.replace('_mappings.json', '')
                
                # Process this document
                doc_components = self.process_single_mapping(mapping_file, min_frequency)
                
                if doc_components:
                    # Store individual document results
                    if save_individual:
                        individual_output = self.output_dir / f"{doc_name}_components.json"
                        self.save_components(doc_components, individual_output)
                        print(f"  💾 Saved individual components to: {individual_output}")
                    
                    # Add to aggregated results
                    for component_type, items in doc_components.items():
                        if component_type != 'statistics' and isinstance(items, list):
                            aggregated_components[component_type].extend(items)
                    
                    # Create document summary
                    doc_summary = {
                        'document_name': doc_name,
                        'filename': mapping_file.name,
                        'sentence_count': doc_components.get('statistics', {}).get('sentences_processed', 0),
                        'component_counts': {
                            comp_type: len(items) for comp_type, items in doc_components.items()
                            if isinstance(items, list) and comp_type != 'statistics'
                        }
                    }
                    document_summaries.append(doc_summary)
                    
                    self.processing_stats['files_processed'] += 1
                    self.processing_stats['total_sentences'] += doc_summary['sentence_count']
                
            except Exception as e:
                error_msg = f"Error processing {mapping_file.name}: {str(e)}"
                print(f"  ❌ {error_msg}")
                self.processing_stats['errors'].append(error_msg)
        
        # Aggregate and deduplicate components
        final_components = self.aggregate_components(aggregated_components, min_frequency)
        
        # Add processing metadata
        final_components['processing_metadata'] = {
            'processing_stats': self.processing_stats,
            'document_summaries': document_summaries,
            'total_documents': len(document_summaries),
            'parameters': {
                'min_frequency': min_frequency,
                'stable_mappings_dir': str(self.stable_mappings_dir),
                'output_dir': str(self.output_dir)
            }
        }
        
        # Save aggregated results
        aggregated_output = self.output_dir / "aggregated_components.json"
        self.save_components(final_components, aggregated_output)
        
        print(f"\n✅ Batch processing complete!")
        print(f"📊 Processed {self.processing_stats['files_processed']} files")
        print(f"📝 Extracted from {self.processing_stats['total_sentences']} sentences")
        print(f"💾 Aggregated results saved to: {aggregated_output}")
        
        if self.processing_stats['errors']:
            print(f"⚠️ {len(self.processing_stats['errors'])} errors occurred")
        
        return final_components
    
    def process_single_mapping(self, mapping_file: Path, min_frequency: int) -> Optional[Dict]:
        """
        Process a single stable mapping file.
        
        Args:
            mapping_file: Path to the mapping file
            min_frequency: Minimum frequency for components
            
        Returns:
            Extracted components or None if failed
        """
        try:
            # Load the mapping file
            with open(mapping_file, 'r', encoding='utf-8') as f:
                mapping_data = json.load(f)
            
            # Extract sentence texts
            sentence_texts = []
            sentence_to_items = mapping_data.get('sentence_to_items', {})
            
            if not sentence_to_items:
                print(f"  ⚠️ No sentence_to_items found in {mapping_file.name}")
                return None
            
            print(f"  📝 Found {len(sentence_to_items)} sentence mappings")
            
            # Extract text from each sentence
            for sentence_id, sentence_data in sentence_to_items.items():
                if isinstance(sentence_data, dict) and 'text' in sentence_data:
                    text = sentence_data['text']
                    if text and isinstance(text, str) and len(text.strip()) > 10:
                        sentence_texts.append(text.strip())
                else:
                    print(f"  ⚠️ Invalid sentence data for ID {sentence_id}")
            
            if not sentence_texts:
                print(f"  ❌ No valid sentence texts found in {mapping_file.name}")
                return None
            
            print(f"  📄 Extracting components from {len(sentence_texts)} sentences")
            
            # Combine all sentence texts
            combined_text = ' '.join(sentence_texts)
            
            # Extract components
            components = self.extractor.extract_components(combined_text, min_frequency)
            
            # Add metadata about this specific document
            components['document_metadata'] = {
                'source_file': mapping_file.name,
                'document_name': mapping_file.name.replace('_mappings.json', ''),
                'sentences_processed': len(sentence_texts),
                'total_text_length': len(combined_text),
                'sentence_sample': sentence_texts[:3] if sentence_texts else []  # First 3 sentences as sample
            }
            
            print(f"  ✅ Extracted {sum(len(items) for items in components.values() if isinstance(items, list))} total components")
            
            return components
            
        except Exception as e:
            print(f"  ❌ Error processing {mapping_file.name}: {str(e)}")
            return None
    
    def aggregate_components(self, aggregated_components: Dict, min_frequency: int) -> Dict:
        """
        Aggregate and deduplicate components across all documents.
        
        Args:
            aggregated_components: Raw aggregated components
            min_frequency: Minimum frequency threshold
            
        Returns:
            Final aggregated and filtered components
        """
        print(f"\n🔄 Aggregating components across all documents...")
        
        final_components = {}
        
        for component_type, all_items in aggregated_components.items():
            if not all_items:
                continue
            
            print(f"  📊 Aggregating {component_type}: {len(all_items)} items")
            
            # Handle different item types
            if component_type == 'named_entities':
                # For named entities, aggregate by text
                entity_counts = Counter(item['text'] for item in all_items if isinstance(item, dict))
                final_components[component_type] = [
                    {'text': entity, 'frequency': count, 'type': 'named_entity'}
                    for entity, count in entity_counts.most_common()
                    if count >= min_frequency
                ]
            
            elif component_type == 'relationships':
                # For relationships, keep unique combinations
                unique_relationships = []
                seen_relationships = set()
                
                for rel in all_items:
                    if isinstance(rel, dict):
                        rel_key = f"{rel.get('subject', '')}-{rel.get('verb', '')}-{rel.get('object', '')}"
                        if rel_key not in seen_relationships:
                            seen_relationships.add(rel_key)
                            unique_relationships.append(rel)
                
                final_components[component_type] = unique_relationships
            
            else:
                # For other components with frequency data
                if all_items and isinstance(all_items[0], dict) and 'text' in all_items[0]:
                    # Aggregate by text and sum frequencies
                    text_counts = Counter()
                    for item in all_items:
                        if isinstance(item, dict) and 'text' in item:
                            text_counts[item['text']] += item.get('frequency', 1)
                    
                    final_components[component_type] = [
                        {'text': text, 'frequency': count}
                        for text, count in text_counts.most_common()
                        if count >= min_frequency
                    ]
                else:
                    # Simple list aggregation
                    item_counts = Counter(all_items)
                    final_components[component_type] = [
                        {'text': item, 'frequency': count}
                        for item, count in item_counts.most_common()
                        if count >= min_frequency
                    ]
        
        # Generate aggregated statistics
        final_components['aggregated_statistics'] = {
            'component_counts': {
                comp_type: len(items) for comp_type, items in final_components.items()
                if isinstance(items, list)
            },
            'total_unique_components': sum(
                len(items) for items in final_components.values()
                if isinstance(items, list)
            ),
            'most_frequent_by_type': {
                comp_type: items[0]['text'] if items and isinstance(items[0], dict) else None
                for comp_type, items in final_components.items()
                if isinstance(items, list) and items
            }
        }
        
        return final_components
    
    def save_components(self, components: Dict, filepath: Path):
        """Save components to JSON file."""
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(components, f, indent=2, ensure_ascii=False)
    
    def generate_summary_report(self, components: Dict) -> str:
        """Generate a human-readable summary report."""
        report = []
        report.append("=" * 60)
        report.append("QUESTION COMPONENT EXTRACTION SUMMARY")
        report.append("=" * 60)
        
        # Processing stats
        if 'processing_metadata' in components:
            stats = components['processing_metadata']['processing_stats']
            report.append(f"\n📊 PROCESSING STATISTICS")
            report.append(f"Documents processed: {stats['files_processed']}")
            report.append(f"Total sentences: {stats['total_sentences']}")
            report.append(f"Errors: {len(stats['errors'])}")
        
        # Component counts
        if 'aggregated_statistics' in components:
            agg_stats = components['aggregated_statistics']
            report.append(f"\n🔍 COMPONENT COUNTS")
            for comp_type, count in agg_stats['component_counts'].items():
                report.append(f"{comp_type}: {count}")
            
            report.append(f"\n🏆 MOST FREQUENT BY TYPE")
            for comp_type, most_frequent in agg_stats['most_frequent_by_type'].items():
                if most_frequent:
                    report.append(f"{comp_type}: '{most_frequent}'")
        
        # Sample components
        report.append(f"\n📝 SAMPLE COMPONENTS")
        for comp_type in ['subjects', 'verbs', 'objects', 'adjectives']:
            if comp_type in components:
                items = components[comp_type][:5]  # Top 5
                if items:
                    report.append(f"\n{comp_type.upper()}:")
                    for item in items:
                        if isinstance(item, dict):
                            report.append(f"  - {item['text']} (freq: {item['frequency']})")
        
        return "\n".join(report)


def main():
    """Main function to run batch component extraction."""
    
    # Initialize batch extractor
    extractor = BatchComponentExtractor(
        stable_mappings_dir="stable_mappings",
        output_dir="question_components"
    )
    
    print("🚀 Starting batch component extraction...")
    print("=" * 50)
    
    try:
        # Process all mapping files
        components = extractor.process_all_mappings(
            min_frequency=2,  # Require at least 2 occurrences
            save_individual=True  # Save individual document components
        )
        
        # Generate and save summary report
        summary = extractor.generate_summary_report(components)
        print(f"\n{summary}")
        
        # Save summary to file
        summary_file = extractor.output_dir / "extraction_summary.txt"
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write(summary)
        
        print(f"\n📄 Summary report saved to: {summary_file}")
        
        # Print quick overview
        if 'aggregated_statistics' in components:
            stats = components['aggregated_statistics']
            print(f"\n🎯 QUICK OVERVIEW:")
            print(f"Total unique components: {stats['total_unique_components']}")
            print(f"Ready for question generation!")
        
        return components
        
    except Exception as e:
        print(f"❌ Batch extraction failed: {str(e)}")
        raise


if __name__ == "__main__":
    components = main()