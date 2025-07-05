import nltk
import spacy
import json
from collections import defaultdict, Counter
from typing import Dict, List, Set, Tuple, Optional
import re
from nltk.corpus import stopwords
from nltk.tokenize import sent_tokenize, word_tokenize
from nltk.tag import pos_tag
from nltk.chunk import ne_chunk
from nltk.stem import WordNetLemmatizer

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')
    
try:
    nltk.data.find('taggers/averaged_perceptron_tagger')
except LookupError:
    nltk.download('averaged_perceptron_tagger')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

try:
    nltk.data.find('chunkers/maxent_ne_chunker')
except LookupError:
    nltk.download('maxent_ne_chunker')

try:
    nltk.data.find('corpora/words')
except LookupError:
    nltk.download('words')

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')

class QuestionComponentExtractor:
    """
    Extracts linguistic components from documents for question generation.
    
    Extracts:
    - Subjects (people, organizations, concepts)
    - Verbs (actions, processes)
    - Objects (things being acted upon)
    - Adjectives/Descriptors
    - Quantifiers (numbers, amounts)
    - Superlatives (best, worst, most, least)
    - Named Entities
    - Key Concepts
    """
    
    def __init__(self, use_spacy=True):
        """
        Initialize the extractor.
        
        Args:
            use_spacy: Whether to use spaCy for enhanced NLP (requires 'python -m spacy download en_core_web_sm')
        """
        self.lemmatizer = WordNetLemmatizer()
        self.stop_words = set(stopwords.words('english'))
        
        # Add custom stopwords for academic/research contexts
        self.stop_words.update([
            'study', 'research', 'paper', 'article', 'analysis', 'findings',
            'results', 'conclusion', 'discussion', 'introduction', 'method',
            'approach', 'work', 'data', 'information', 'report', 'document'
        ])
        
        self.use_spacy = use_spacy
        if use_spacy:
            try:
                self.nlp = spacy.load("en_core_web_sm")
            except OSError:
                print("spaCy model not found. Install with: python -m spacy download en_core_web_sm")
                print("Falling back to NLTK-only mode.")
                self.use_spacy = False
                self.nlp = None
        else:
            self.nlp = None
            
        # Question word patterns for filtering
        self.question_patterns = {
            'what', 'who', 'when', 'where', 'why', 'how', 'which', 'whose'
        }
        
        # Quantifier patterns
        self.quantifier_patterns = [
            r'\b\d+(?:\.\d+)?\s*(?:percent|%|million|billion|thousand|hundred)\b',
            r'\b(?:many|few|several|multiple|numerous|various|some|most|all|every)\b',
            r'\b\d+(?:\.\d+)?\s*(?:years?|months?|days?|hours?|minutes?)\b',
            r'\b(?:first|second|third|fourth|fifth|last|final|initial)\b'
        ]
        
        # Superlative patterns
        self.superlative_patterns = [
            r'\b(?:most|least|best|worst|highest|lowest|greatest|smallest|largest)\b',
            r'\b\w+(?:est)\b',  # words ending in -est
            r'\b(?:primary|main|principal|key|major|minor|critical|essential)\b'
        ]

    def extract_components(self, text: str, min_frequency: int = 2) -> Dict:
        """
        Extract all question components from text.
        
        Args:
            text: Input text to analyze
            min_frequency: Minimum frequency for a component to be included
            
        Returns:
            Dictionary containing all extracted components
        """
        components = {
            'subjects': [],
            'verbs': [],
            'objects': [],
            'adjectives': [],
            'quantifiers': [],
            'superlatives': [],
            'named_entities': [],
            'key_concepts': [],
            'relationships': [],
            'statistics': {}
        }
        
        # Clean and preprocess text
        cleaned_text = self._clean_text(text)
        
        if self.use_spacy and self.nlp:
            components.update(self._extract_with_spacy(cleaned_text, min_frequency))
        else:
            components.update(self._extract_with_nltk(cleaned_text, min_frequency))
        
        # Extract quantifiers and superlatives using regex
        components['quantifiers'] = self._extract_quantifiers(cleaned_text, min_frequency)
        components['superlatives'] = self._extract_superlatives(cleaned_text, min_frequency)
        
        # Generate statistics
        components['statistics'] = self._generate_statistics(components)
        
        return components

    def _clean_text(self, text: str) -> str:
        """Clean and preprocess text."""
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        # Remove citation markers like [1], [2, 3], etc.
        text = re.sub(r'\[\d+(?:,\s*\d+)*\]', '', text)
        # Remove URLs
        text = re.sub(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', '', text)
        # Remove email addresses
        text = re.sub(r'\S+@\S+', '', text)
        return text.strip()

    def _extract_with_spacy(self, text: str, min_frequency: int) -> Dict:
        """Extract components using spaCy."""
        doc = self.nlp(text)
        
        subjects = []
        verbs = []
        objects = []
        adjectives = []
        named_entities = []
        key_concepts = []
        relationships = []
        
        for sent in doc.sents:
            # Skip very short sentences
            if len(sent.text.split()) < 4:
                continue
                
            # Extract subjects (nsubj, nsubjpass)
            for token in sent:
                if token.dep_ in ['nsubj', 'nsubjpass'] and not token.is_stop:
                    subject = self._get_noun_phrase(token)
                    if subject and len(subject.split()) <= 4:  # Reasonable length
                        subjects.append(subject.lower())
                
                # Extract verbs (ROOT verbs that are actually verbs)
                if token.dep_ == 'ROOT' and token.pos_ in ['VERB']:
                    verb = token.lemma_.lower()
                    if verb not in self.stop_words and len(verb) > 2:
                        verbs.append(verb)
                
                # Extract objects (dobj, pobj, iobj)
                if token.dep_ in ['dobj', 'pobj', 'iobj'] and not token.is_stop:
                    obj = self._get_noun_phrase(token)
                    if obj and len(obj.split()) <= 4:
                        objects.append(obj.lower())
                
                # Extract adjectives
                if token.pos_ == 'ADJ' and not token.is_stop and len(token.text) > 2:
                    adjectives.append(token.lemma_.lower())
        
        # Extract named entities
        for ent in doc.ents:
            if ent.label_ in ['PERSON', 'ORG', 'GPE', 'PRODUCT', 'EVENT', 'LAW']:
                named_entities.append({
                    'text': ent.text,
                    'label': ent.label_,
                    'start': ent.start_char,
                    'end': ent.end_char
                })
        
        # Extract key concepts using noun chunks
        for chunk in doc.noun_chunks:
            if (len(chunk.text.split()) <= 3 and 
                chunk.root.pos_ in ['NOUN', 'PROPN'] and 
                not chunk.root.is_stop):
                key_concepts.append(chunk.text.lower())
        
        # Extract relationships (subject-verb-object)
        for sent in doc.sents:
            subj, verb, obj = None, None, None
            
            for token in sent:
                if token.dep_ in ['nsubj', 'nsubjpass']:
                    subj = self._get_noun_phrase(token)
                elif token.dep_ == 'ROOT' and token.pos_ == 'VERB':
                    verb = token.lemma_
                elif token.dep_ in ['dobj', 'pobj']:
                    obj = self._get_noun_phrase(token)
            
            if subj and verb and obj:
                relationships.append({
                    'subject': subj.lower(),
                    'verb': verb.lower(),
                    'object': obj.lower()
                })
        
        return {
            'subjects': self._filter_by_frequency(subjects, min_frequency),
            'verbs': self._filter_by_frequency(verbs, min_frequency),
            'objects': self._filter_by_frequency(objects, min_frequency),
            'adjectives': self._filter_by_frequency(adjectives, min_frequency),
            'named_entities': named_entities,
            'key_concepts': self._filter_by_frequency(key_concepts, min_frequency),
            'relationships': relationships
        }

    def _extract_with_nltk(self, text: str, min_frequency: int) -> Dict:
        """Extract components using NLTK."""
        sentences = sent_tokenize(text)
        
        subjects = []
        verbs = []
        objects = []
        adjectives = []
        named_entities = []
        key_concepts = []
        
        for sentence in sentences:
            if len(sentence.split()) < 4:
                continue
                
            tokens = word_tokenize(sentence)
            pos_tags = pos_tag(tokens)
            
            # Extract components based on POS tags
            for i, (word, pos) in enumerate(pos_tags):
                word_lower = word.lower()
                
                if word_lower in self.stop_words or len(word) < 2:
                    continue
                
                # Extract subjects (nouns at beginning of sentence or after determiners)
                if pos in ['NN', 'NNS', 'NNP', 'NNPS']:
                    if i == 0 or pos_tags[i-1][1] in ['DT', 'PRP$']:
                        noun_phrase = self._extract_noun_phrase(pos_tags, i)
                        if noun_phrase:
                            subjects.append(noun_phrase.lower())
                    key_concepts.append(word_lower)
                
                # Extract verbs
                elif pos in ['VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ']:
                    verb = self.lemmatizer.lemmatize(word_lower, 'v')
                    if len(verb) > 2:
                        verbs.append(verb)
                
                # Extract adjectives
                elif pos in ['JJ', 'JJR', 'JJS']:
                    adjectives.append(word_lower)
                
                # Extract objects (nouns following verbs)
                elif pos in ['NN', 'NNS'] and i > 0:
                    prev_pos = pos_tags[i-1][1]
                    if prev_pos in ['VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ']:
                        noun_phrase = self._extract_noun_phrase(pos_tags, i)
                        if noun_phrase:
                            objects.append(noun_phrase.lower())
            
            # Extract named entities using NLTK's NE chunker
            tree = ne_chunk(pos_tags)
            for subtree in tree:
                if hasattr(subtree, 'label'):
                    entity_text = ' '.join([token for token, pos in subtree.leaves()])
                    named_entities.append({
                        'text': entity_text,
                        'label': subtree.label(),
                        'start': 0,  # NLTK doesn't provide character positions
                        'end': 0
                    })
        
        return {
            'subjects': self._filter_by_frequency(subjects, min_frequency),
            'verbs': self._filter_by_frequency(verbs, min_frequency),
            'objects': self._filter_by_frequency(objects, min_frequency),
            'adjectives': self._filter_by_frequency(adjectives, min_frequency),
            'named_entities': named_entities,
            'key_concepts': self._filter_by_frequency(key_concepts, min_frequency),
            'relationships': []  # Not implemented for NLTK version
        }

    def _get_noun_phrase(self, token) -> Optional[str]:
        """Extract noun phrase around a token (spaCy version)."""
        if not token:
            return None
            
        # Get the full noun phrase
        phrase_tokens = []
        
        # Add left children (determiners, adjectives, etc.)
        for child in token.lefts:
            if child.dep_ in ['det', 'amod', 'compound', 'nummod']:
                phrase_tokens.append(child.text)
        
        # Add the token itself
        phrase_tokens.append(token.text)
        
        # Add right children (compounds, prepositional phrases)
        for child in token.rights:
            if child.dep_ in ['compound', 'amod']:
                phrase_tokens.append(child.text)
        
        phrase = ' '.join(phrase_tokens).strip()
        return phrase if len(phrase.split()) <= 4 else token.text

    def _extract_noun_phrase(self, pos_tags: List[Tuple[str, str]], start_idx: int) -> Optional[str]:
        """Extract noun phrase starting at index (NLTK version)."""
        phrase_tokens = []
        
        # Look backwards for determiners and adjectives
        i = start_idx - 1
        while i >= 0 and pos_tags[i][1] in ['DT', 'JJ', 'JJR', 'JJS', 'NN', 'NNS']:
            if pos_tags[i][1] in ['DT', 'JJ', 'JJR', 'JJS']:
                phrase_tokens.insert(0, pos_tags[i][0])
            i -= 1
        
        # Add the main noun
        phrase_tokens.append(pos_tags[start_idx][0])
        
        # Look forwards for compound nouns
        i = start_idx + 1
        while i < len(pos_tags) and pos_tags[i][1] in ['NN', 'NNS', 'NNP', 'NNPS']:
            phrase_tokens.append(pos_tags[i][0])
            i += 1
        
        phrase = ' '.join(phrase_tokens)
        return phrase if len(phrase.split()) <= 4 else pos_tags[start_idx][0]

    def _extract_quantifiers(self, text: str, min_frequency: int) -> List[str]:
        """Extract quantifiers using regex patterns."""
        quantifiers = []
        
        for pattern in self.quantifier_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            quantifiers.extend([match.lower() for match in matches])
        
        return self._filter_by_frequency(quantifiers, min_frequency)

    def _extract_superlatives(self, text: str, min_frequency: int) -> List[str]:
        """Extract superlatives using regex patterns."""
        superlatives = []
        
        for pattern in self.superlative_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            superlatives.extend([match.lower() for match in matches])
        
        return self._filter_by_frequency(superlatives, min_frequency)

    def _filter_by_frequency(self, items: List[str], min_frequency: int) -> List[Dict]:
        """Filter items by frequency and return sorted list."""
        counter = Counter(items)
        
        # Filter by minimum frequency
        filtered_items = [(item, count) for item, count in counter.items() 
                         if count >= min_frequency and len(item.strip()) > 1]
        
        # Sort by frequency (descending)
        filtered_items.sort(key=lambda x: x[1], reverse=True)
        
        return [{'text': item, 'frequency': count} for item, count in filtered_items]

    def _generate_statistics(self, components: Dict) -> Dict:
        """Generate statistics about extracted components."""
        stats = {}
        
        for component_type, items in components.items():
            if component_type == 'statistics':
                continue
                
            if isinstance(items, list):
                if items and isinstance(items[0], dict) and 'frequency' in items[0]:
                    # Components with frequency
                    stats[component_type] = {
                        'total_unique': len(items),
                        'total_occurrences': sum(item['frequency'] for item in items),
                        'most_frequent': items[0]['text'] if items else None,
                        'avg_frequency': sum(item['frequency'] for item in items) / len(items) if items else 0
                    }
                else:
                    # Simple lists
                    stats[component_type] = {
                        'total': len(items),
                        'sample': items[:3] if items else []
                    }
        
        return stats

    def save_components(self, components: Dict, filepath: str):
        """Save extracted components to JSON file."""
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(components, f, indent=2, ensure_ascii=False)

    def load_components(self, filepath: str) -> Dict:
        """Load components from JSON file."""
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def get_question_templates(self) -> Dict[str, List[str]]:
        """
        Get template patterns for question generation.
        These can be used with extracted components to generate questions.
        """
        return {
            'what_questions': [
                "What is {subject}?",
                "What does {subject} {verb}?",
                "What {verb} {object}?",
                "What are the {adjective} {concept}?",
            ],
            'who_questions': [
                "Who {verb} {object}?",
                "Who is responsible for {concept}?",
                "Who are the {adjective} {subjects}?",
            ],
            'when_questions': [
                "When did {subject} {verb}?",
                "When does {process} occur?",
                "When was {concept} {adjective}?",
            ],
            'where_questions': [
                "Where does {subject} {verb}?",
                "Where is {concept} {adjective}?",
                "Where can {object} be found?",
            ],
            'why_questions': [
                "Why does {subject} {verb}?",
                "Why is {concept} {adjective}?",
                "Why did {subject} {verb} {object}?",
            ],
            'how_questions': [
                "How does {subject} {verb}?",
                "How {adjective} is {concept}?",
                "How can {object} be {verb}?",
            ],
            'quantitative_questions': [
                "How many {concept} {verb}?",
                "What percentage of {subject} {verb}?",
                "How much {object} is {adjective}?",
            ],
            'comparative_questions': [
                "Which is more {adjective}: {concept1} or {concept2}?",
                "What is the {superlative} {concept}?",
                "How does {subject1} compare to {subject2}?",
            ]
        }


# Example usage
def extract_from_document(document_text: str, output_file: str = None, min_frequency: int = 2):
    """
    Extract components from a document and optionally save to file.
    
    Args:
        document_text: Text content of the document
        output_file: Optional file to save results
        min_frequency: Minimum frequency for inclusion
    """
    extractor = QuestionComponentExtractor(use_spacy=True)
    components = extractor.extract_components(document_text, min_frequency)
    
    if output_file:
        extractor.save_components(components, output_file)
    
    return components


# Example with the provided document text
if __name__ == "__main__":
    # Sample text from the document
    sample_text = """
    In the context of addressing global warming issues one of the possible approaches is to provide individuals with tools that support behavior change toward greener practices, as for example in commuting. This paper illustrates the results of a study that we conducted on the effectiveness of self-tracking of commuting data where participants received daily feedback on the financial costs and CO2 emissions associated to their mobility practices. In the results, we describe situations where users either misunderstood or did not accept the data and the models utilized to represent them, highlighting a limitation that diary instruments (and underlying models) of this type would have in supporting people to reflect upon and possibly change their mobility choices.
    
    The use of personal informatics, also referred as quantified-self or self-tracking, is today made possible by the variety of tools and connected objects that are available to individuals and has been widely analyzed in the HCI research community. One recognized use of personal informatics is to support change management. The link between self-tracking and change management is in the reflexive position that users can adopt regarding their behaviors.
    """
    
    components = extract_from_document(sample_text, min_frequency=1)
    
    print("=== EXTRACTED COMPONENTS ===")
    print(f"\nSubjects ({len(components['subjects'])}):")
    for item in components['subjects'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print(f"\nVerbs ({len(components['verbs'])}):")
    for item in components['verbs'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print(f"\nObjects ({len(components['objects'])}):")
    for item in components['objects'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print(f"\nAdjectives ({len(components['adjectives'])}):")
    for item in components['adjectives'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print(f"\nNamed Entities ({len(components['named_entities'])}):")
    for item in components['named_entities'][:5]:
        print(f"  - {item['text']} ({item['label']})")
    
    print(f"\nKey Concepts ({len(components['key_concepts'])}):")
    for item in components['key_concepts'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    if components['relationships']:
        print(f"\nRelationships ({len(components['relationships'])}):")
        for rel in components['relationships'][:3]:
            print(f"  - {rel['subject']} {rel['verb']} {rel['object']}")
    
    print(f"\nQuantifiers ({len(components['quantifiers'])}):")
    for item in components['quantifiers'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print(f"\nSuperlatives ({len(components['superlatives'])}):")
    for item in components['superlatives'][:5]:
        print(f"  - {item['text']} (freq: {item['frequency']})")
    
    print("\n=== STATISTICS ===")
    for component_type, stats in components['statistics'].items():
        if isinstance(stats, dict) and 'total_unique' in stats:
            print(f"{component_type}: {stats['total_unique']} unique, {stats['total_occurrences']} total")