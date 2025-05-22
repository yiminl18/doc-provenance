import React from 'react';
import '../styles/ChatContainer.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faCommentAlt, faChevronDown, faSearch } from '@fortawesome/free-solid-svg-icons';

const ChatContainer = ({ currentQuestion, answer, isProcessing, uploadStatus, provenanceSources }) => {
  return (
    <div className="chat-container">
      {currentQuestion && (
        <div className="question-display">
          <div className="card">
            <div className="card-title">
              <FontAwesomeIcon icon={faFileAlt} /> Question
            </div>
            <div className="card-content">{currentQuestion}</div>
          </div>
          
          <div className="card">
            <div className="card-title">
              <FontAwesomeIcon icon={faCommentAlt} /> Answer
            </div>
            <div className="card-content">{answer || 'Processing...'}</div>
          </div>
        </div>
      )}

      {provenanceSources.length > 0 && (
        <div className="sources-container">
          <div className="sources-heading">Sources</div>
          <div className="sources-relevance">
            <span>Most relevant</span>
            <FontAwesomeIcon icon={faChevronDown} />
          </div>
          <div className="sources-list">
            {provenanceSources.map((source, index) => (
              <div key={index} className="source-card">
                <div className="source-number">
                  {index + 1}. Top-{source.provenance_id} Provenance
                </div>
                <div className="source-ids">
                  Sentence IDs: {source.sentences_ids ? source.sentences_ids.join(', ') : 'N/A'}
                </div>
                <div className="source-time">
                  Time: {source.time ? source.time.toFixed(2) : 'N/A'}s
                </div>
                <div className="source-tokens">
                  Tokens: Input: {source.input_token_size || 'N/A'}, Output: {source.output_token_size || 'N/A'}
                </div>
                <div className="source-content">
                  {source.content ? (
                    source.content.map((sentence, idx) => (
                      <div key={idx} className="sentence">
                        {sentence}
                      </div>
                    ))
                  ) : (
                    <div className="loading">Loading sentence content...</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadStatus && (
        <div className="upload-status">
          <div className={`file-status ${uploadStatus.success ? 'success' : 'error'}`}>
            {uploadStatus.message}
          </div>
        </div>
      )}
        
      {isProcessing && (
        <div className="processing">
          <div className="processing-text">Processing</div>
          <div className="dots">
            <span className="dot"></span>
            <span className="dot"></span>
            <span className="dot"></span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatContainer; 