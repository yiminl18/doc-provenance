# Document Provenance Chat Interface

This is a web interface for the Document Provenance system, which allows users to upload PDF documents, ask questions about them, and see the provenance of the answers (i.e., the specific parts of the document that support the answer).

## Features

- Upload PDF documents
- Ask questions about the document
- Real-time streaming of provenance results as they are found
- View the answer and its supporting evidence

## Architecture

- **Frontend**: React.js
- **Backend**: Flask
- **Processing**: doc_provenance library

The system streams results as they become available by writing to JSON files that are polled by the frontend.

## Setup Instructions

### Backend Setup

1. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Download NLTK data (if not already installed):
   ```python
   import nltk
   nltk.download('punkt')
   ```

3. Create the necessary directories:
   ```
   mkdir -p app/uploads app/results
   ```

### Frontend Setup

1. Install Node.js dependencies:
   ```
   cd frontend
   npm install
   ```

2. Build the frontend for production (optional):
   ```
   npm run build
   ```

## Running the Application

### Development Mode

1. Start the Flask backend:
   ```
   python app.py
   ```

2. In a separate terminal, start the React development server:
   ```
   cd frontend
   npm start
   ```

3. Open your browser and go to http://localhost:3000

### Production Mode

1. Build the React app:
   ```
   cd frontend
   npm run build
   ```

2. Run the Flask app:
   ```
   python app.py
   ```

3. Open your browser and go to http://localhost:5000

## Usage

1. Upload a PDF document using the upload button in the bottom left corner
2. Type your question in the input field
3. Press Enter or click the send button
4. View the answer and provenance sources as they are found
5. Click "New question" to ask another question about the same document
