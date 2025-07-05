// utils/filteringUtils.js
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

const enc = new Tiktoken(cl100k_base);

// Simple filtering thresholds - easy to adjust
export const DEFAULT_THRESHOLDS = {
  minTokensPerProvenance: 100,        // Minimum tokens in a provenance
  minSentencesPerProvenance: 2,       // Minimum sentences in a provenance
  minProvenancesPerQuestion: 1,       // Minimum provenances per question
  minGoodQuestionsPerDocument: 2,     // Minimum good questions per document
  minQuestionRatio: 0.3               // Minimum ratio of good questions (30%)
};

// Check if a single provenance is "good"
export const isGoodProvenance = (provenance, thresholds = DEFAULT_THRESHOLDS) => {
  if (!provenance || !provenance.provenance) return false;
  
  const tokenCount = enc.encode(provenance.provenance).length;
  const sentenceCount = provenance.provenance_ids ? provenance.provenance_ids.length : 0;
  
  return tokenCount >= thresholds.minTokensPerProvenance && 
         sentenceCount >= thresholds.minSentencesPerProvenance;
};

// Check if a question is "good"
export const isGoodQuestion = (question, thresholds = DEFAULT_THRESHOLDS) => {
  if (!question || !question.provenance_data) return false;
  
  const goodProvenances = question.provenance_data.filter(p => isGoodProvenance(p, thresholds));
  return goodProvenances.length >= thresholds.minProvenancesPerQuestion;
};

// Check if a document is "good"
export const isGoodDocument = (document, thresholds = DEFAULT_THRESHOLDS) => {
  if (!document || !document.questions) return false;
  
  const goodQuestions = document.questions.filter(q => isGoodQuestion(q, thresholds));
  const totalQuestions = document.questions.length;
  
  if (totalQuestions === 0) return false;
  
  const goodQuestionRatio = goodQuestions.length / totalQuestions;
  
  return goodQuestions.length >= thresholds.minGoodQuestionsPerDocument &&
         goodQuestionRatio >= thresholds.minQuestionRatio;
};

// Filter documents and questions
export const filterDocuments = (documents, thresholds = DEFAULT_THRESHOLDS, options = {}) => {
  const { includeAnalysis = false, onlyGoodDocuments = false } = options;
  
  return documents.map(doc => {
    // Filter questions within each document
    const filteredQuestions = doc.questions ? doc.questions.filter(q => isGoodQuestion(q, thresholds)) : [];
    
    // Calculate document quality
    const totalQuestions = doc.questions ? doc.questions.length : 0;
    const goodQuestions = filteredQuestions.length;
    const isDocGood = isGoodDocument(doc, thresholds);
    
    const result = {
      ...doc,
      questions: filteredQuestions,
      __filtering_analysis: includeAnalysis ? {
        totalQuestions,
        goodQuestions,
        goodQuestionRatio: totalQuestions > 0 ? goodQuestions / totalQuestions : 0,
        isGoodDocument: isDocGood,
        passesFilters: isDocGood
      } : undefined
    };
    
    return result;
  }).filter(doc => {
    if (onlyGoodDocuments) {
      return doc.__filtering_analysis?.isGoodDocument ?? isGoodDocument(doc, thresholds);
    }
    return true;
  });
};

// Get filtering statistics
export const getFilteringStats = (documents, thresholds = DEFAULT_THRESHOLDS) => {
  let totalDocs = documents.length;
  let goodDocs = 0;
  let totalQuestions = 0;
  let goodQuestions = 0;
  
  documents.forEach(doc => {
    if (doc.questions) {
      totalQuestions += doc.questions.length;
      const docGoodQuestions = doc.questions.filter(q => isGoodQuestion(q, thresholds));
      goodQuestions += docGoodQuestions.length;
      
      if (isGoodDocument(doc, thresholds)) {
        goodDocs++;
      }
    }
  });
  
  return {
    totalDocuments: totalDocs,
    goodDocuments: goodDocs,
    totalQuestions,
    goodQuestions,
    documentPassRate: totalDocs > 0 ? (goodDocs / totalDocs) * 100 : 0,
    questionPassRate: totalQuestions > 0 ? (goodQuestions / totalQuestions) * 100 : 0
  };
};