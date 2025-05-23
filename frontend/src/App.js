import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Sidebar from './components/Sidebar';
import ChatContainer from './components/ChatContainer';
import Header from './components/Header';
import InputArea from './components/InputArea';
import PDFViewer from './components/PDFViewer';

function App() {
  // document management
  const [documents, setDocuments] = useState(new Map());
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  // UI state
  const [theme, setTheme] = useState('dark');
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [selectedProvenance, setSelectedProvenance] = useState(null);

  // get active document
  const activeDocument = activeDocumentId ? documents.get(activeDocumentId) : null;
  const [currentFile, setCurrentFile] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [provenanceSources, setProvenanceSources] = useState([]);
  const [logs, setLogs] = useState([]);
  
  // Toggle theme between light and dark
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.body.setAttribute('data-theme', newTheme);
  };
  
  // Set initial theme
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, []);

// Create new document environment
  const createNewDocument = (filename) => {
    const docId = `doc_${Date.now()}`;
    const newDoc = {
      id: docId,
      filename,
      questions: new Map(), // questionId -> question data
      activeQuestionId: null,
      uploadStatus: { success: true, message: `${filename} uploaded successfully` },
      createdAt: new Date()
    };
    
    setDocuments(prev => new Map(prev).set(docId, newDoc));
    setActiveDocumentId(docId);
    return docId;
  };

  // Add question to active document
  const addQuestionToDocument = (questionText, questionId) => {
    if (!activeDocumentId) return;
    
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc) {
        const questionData = {
          id: questionId,
          text: questionText,
          answer: null,
          provenanceSources: [],
          isProcessing: true,
          logs: [],
          feedback: null,
          createdAt: new Date()
        };
        
        doc.questions.set(questionId, questionData);
        doc.activeQuestionId = questionId;
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });
  };

  // Update question in active document
  const updateQuestion = (questionId, updates) => {
    if (!activeDocumentId) return;
    
    setDocuments(prev => {
      const newDocs = new Map(prev);
      const doc = newDocs.get(activeDocumentId);
      if (doc && doc.questions.has(questionId)) {
        const question = { ...doc.questions.get(questionId), ...updates };
        doc.questions.set(questionId, question);
        newDocs.set(activeDocumentId, doc);
      }
      return newDocs;
    });
  };

  // Handle provenance selection
  const handleProvenanceSelect = (provenance) => {
    setSelectedProvenance(provenance);
    setShowPDFViewer(true);
  };

  // Handle feedback submission
  const handleFeedbackSubmit = (questionId, feedback) => {
    updateQuestion(questionId, { feedback });
    
    // Send feedback to backend (implement API call)
    console.log('Submitting feedback:', { questionId, feedback });
  };

  // Start new question session
  const handleNewQuestion = () => {
    if (activeDocument) {
      setDocuments(prev => {
        const newDocs = new Map(prev);
        const doc = newDocs.get(activeDocumentId);
        if (doc) {
          doc.activeQuestionId = null;
          newDocs.set(activeDocumentId, doc);
        }
        return newDocs;
      });
    }
    setShowPDFViewer(false);
    setSelectedProvenance(null);
  };

  return (
    <div className="container">
      <Sidebar 
        documents={documents}
        activeDocumentId={activeDocumentId}
        onDocumentSelect={setActiveDocumentId}
        onNewQuestion={handleNewQuestion}
        theme={theme}
        toggleTheme={toggleTheme}
      />
      
      <div className="main-content">
        <Header 
        activeDocument={activeDocument}
        theme={theme}
        />
        
         <div className="content-area">
          <ChatContainer 
            document={activeDocument}
            onProvenanceSelect={handleProvenanceSelect}
            onFeedbackSubmit={handleFeedbackSubmit}
          />
          
          {showPDFViewer && (
            <PDFViewer
              document={activeDocument}
              selectedProvenance={selectedProvenance}
              onClose={() => setShowPDFViewer(false)}
            />
          )}
        </div>
        
        <InputArea
          activeDocument={activeDocument}
          onDocumentCreate={createNewDocument}
          onQuestionAdd={addQuestionToDocument}
          onQuestionUpdate={updateQuestion}
        />
      </div>
    </div>
  );
}

export default App; 