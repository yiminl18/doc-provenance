document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const fileUpload = document.getElementById('file-upload');
    const uploadForm = document.getElementById('upload-form');
    const fileStatus = document.getElementById('file-status');
    const questionInput = document.getElementById('question-input');
    const sendBtn = document.getElementById('send-btn');
    const questionDisplay = document.getElementById('question-display');
    const questionText = document.getElementById('question-text');
    const answerText = document.getElementById('answer-text');
    const sourcesContainer = document.getElementById('sources-container');
    const sourcesList = document.getElementById('sources-list');
    const processingIndicator = document.getElementById('processing-indicator');
    const newQuestionBtn = document.querySelector('.new-question-btn');
    
    // State variables
    let currentFilename = null;
    let currentQuestionId = null;
    let pollingInterval = null;
    let sentences = null;
    
    // Event Listeners
    fileUpload.addEventListener('change', handleFileUpload);
    sendBtn.addEventListener('click', handleSendQuestion);
    questionInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleSendQuestion();
        }
    });
    newQuestionBtn.addEventListener('click', resetInterface);
    
    // Handle file upload
    function handleFileUpload() {
        const file = fileUpload.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        fileStatus.innerHTML = `<div>Uploading ${file.name}...</div>`;
        fileStatus.className = '';
        
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                fileStatus.innerHTML = `<div>${data.filename} uploaded successfully</div>`;
                fileStatus.className = 'success';
                currentFilename = data.filename;
                questionInput.disabled = false;
                sendBtn.disabled = false;
            } else {
                fileStatus.innerHTML = `<div>Error: ${data.error}</div>`;
                fileStatus.className = 'error';
            }
        })
        .catch(error => {
            fileStatus.innerHTML = `<div>Error: ${error.message}</div>`;
            fileStatus.className = 'error';
        });
    }
    
    // Handle sending a question
    function handleSendQuestion() {
        const question = questionInput.value.trim();
        if (!question || !currentFilename) return;
        
        // Clear previous results
        questionText.textContent = question;
        answerText.textContent = 'Processing...';
        questionDisplay.style.display = 'flex';
        sourcesContainer.style.display = 'none';
        sourcesList.innerHTML = '';
        processingIndicator.style.display = 'flex';
        
        // Disable input while processing
        questionInput.disabled = true;
        sendBtn.disabled = true;
        
        fetch('/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                filename: currentFilename
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentQuestionId = data.question_id;
                startPolling(currentQuestionId);
            } else {
                answerText.textContent = `Error: ${data.error}`;
                processingIndicator.style.display = 'none';
                questionInput.disabled = false;
                sendBtn.disabled = false;
            }
        })
        .catch(error => {
            answerText.textContent = `Error: ${error.message}`;
            processingIndicator.style.display = 'none';
            questionInput.disabled = false;
            sendBtn.disabled = false;
        });
    }
    
    // Poll for results
    function startPolling(questionId) {
        // Clear any existing polling
        if (pollingInterval) clearInterval(pollingInterval);
        
        pollingInterval = setInterval(() => {
            fetch(`/check-progress/${questionId}`)
            .then(response => response.json())
            .then(data => {
                if (data.progress > 0) {
                    // We have some data, update the UI
                    updateSourcesList(data.data);
                    
                    // If we have an answer, show it
                    getResults(questionId);
                }
                
                // If we're done, stop polling
                if (data.done) {
                    clearInterval(pollingInterval);
                    processingIndicator.style.display = 'none';
                    questionInput.disabled = false;
                    sendBtn.disabled = false;
                }
            })
            .catch(error => {
                console.error('Error checking progress:', error);
            });
        }, 1000); // Check every second
    }
    
    // Get final results
    function getResults(questionId) {
        fetch(`/results/${questionId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (data.answer) {
                    answerText.textContent = data.answer;
                }
                
                if (data.provenance && data.provenance.length > 0) {
                    updateSourcesList(data.provenance);
                    sourcesContainer.style.display = 'block';
                }
            }
        })
        .catch(error => {
            console.error('Error getting results:', error);
        });
    }
    
    // Update the sources list
    function updateSourcesList(provenance) {
        sourcesList.innerHTML = '';
        
        provenance.forEach((source, index) => {
            const sourceCard = document.createElement('div');
            sourceCard.className = 'source-card';
            
            const sourceNumber = document.createElement('div');
            sourceNumber.className = 'source-number';
            sourceNumber.textContent = `${index + 1}. Top-${source.provenance_id} Provenance`;
            
            const sourceIds = document.createElement('div');
            sourceIds.className = 'source-ids';
            sourceIds.textContent = `Sentence IDs: ${source.sentences_ids.join(', ')}`;
            
            const sourceTime = document.createElement('div');
            sourceTime.className = 'source-time';
            sourceTime.textContent = `Time: ${source.time.toFixed(2)}s`;
            
            const sourceTokens = document.createElement('div');
            sourceTokens.className = 'source-tokens';
            sourceTokens.textContent = `Tokens: Input: ${source.input_token_size}, Output: ${source.output_token_size}`;
            
            // Create the content section
            const sourceContent = document.createElement('div');
            sourceContent.className = 'source-content';
            sourceContent.innerHTML = '<div class="loading">Loading sentence content...</div>';
            
            // Append sections to card
            sourceCard.appendChild(sourceNumber);
            sourceCard.appendChild(sourceIds);
            sourceCard.appendChild(sourceTime);
            sourceCard.appendChild(sourceTokens);
            sourceCard.appendChild(sourceContent);
            
            sourcesList.appendChild(sourceCard);
            
            // Fetch the sentence content
            fetchSentenceContent(currentQuestionId, source.sentences_ids, sourceContent);
        });
    }
    
    // Fetch sentence content
    function fetchSentenceContent(questionId, sentenceIds, contentElement) {
        if (!questionId || !sentenceIds || sentenceIds.length === 0) {
            contentElement.innerHTML = '<div class="error">No sentence IDs available</div>';
            return;
        }
        
        fetch(`/sentences/${questionId}?ids=${sentenceIds.join(',')}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Clear loading message
                contentElement.innerHTML = '';
                
                // Create a text section for each sentence
                const sentences = data.sentences;
                Object.keys(sentences).forEach(id => {
                    const sentenceEl = document.createElement('div');
                    sentenceEl.className = 'sentence';
                    sentenceEl.textContent = sentences[id];
                    contentElement.appendChild(sentenceEl);
                });
            } else {
                contentElement.innerHTML = `<div class="error">Error: ${data.error}</div>`;
            }
        })
        .catch(error => {
            contentElement.innerHTML = `<div class="error">Error loading sentences: ${error.message}</div>`;
        });
    }
    
    // Reset the interface for a new question
    function resetInterface() {
        // Clear input and results
        questionInput.value = '';
        questionDisplay.style.display = 'none';
        sourcesContainer.style.display = 'none';
        processingIndicator.style.display = 'none';
        
        // Enable inputs if we have a file
        if (currentFilename) {
            questionInput.disabled = false;
            sendBtn.disabled = false;
        } else {
            questionInput.disabled = true;
            sendBtn.disabled = true;
        }
        
        // Clear polling
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        
        // Reset state
        currentQuestionId = null;
    }
}); 