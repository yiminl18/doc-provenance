import React, { useState, useEffect } from 'react';
import './styles/App.css';
import Sidebar from './components/Sidebar';
import ChatContainer from './components/ChatContainer';
import Header from './components/Header';
import InputArea from './components/InputArea';

function App() {
  const [currentFile, setCurrentFile] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentQuestionId, setCurrentQuestionId] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [provenanceSources, setProvenanceSources] = useState([]);
  const [logs, setLogs] = useState([]);
  const [theme, setTheme] = useState('dark');
  
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

  return (
    <div className="container">
      <Sidebar 
        onNewQuestion={() => {
          setCurrentQuestion(null);
          setAnswer(null);
          setProvenanceSources([]);
          setLogs([]);
        }} 
        theme={theme}
        toggleTheme={toggleTheme}
      />
      
      <div className="main-content">
        <Header theme={theme} />
        
        <ChatContainer 
          currentQuestion={currentQuestion}
          answer={answer}
          isProcessing={isProcessing}
          uploadStatus={uploadStatus}
          provenanceSources={provenanceSources}
        />
        
        <InputArea
          currentFile={currentFile}
          setCurrentFile={setCurrentFile}
          setUploadStatus={setUploadStatus}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          setCurrentQuestion={setCurrentQuestion}
          setCurrentQuestionId={setCurrentQuestionId}
          setProvenanceSources={setProvenanceSources}
          setAnswer={setAnswer}
          setLogs={setLogs}
        />
      </div>
    </div>
  );
}

export default App; 