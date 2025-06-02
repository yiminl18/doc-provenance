// src/services/userStudyLogger.js
// Minimal changes to fix the 405 error - keep your existing structure

class UserStudyLogger {
  constructor() {
    this.userSessionId = this.initializeUserSession();
    this.sessionStartTime = Date.now();
    this.eventQueue = [];
    this.isOnline = navigator.onLine;
    this.enableRemoteLogging = true; // Set to false to disable remote logging temporarily
    this.localStorageKey = 'userStudyEvents';
    
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      if (this.enableRemoteLogging) {
        this.flushEventQueue();
      }
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });

    console.log(`📊 UserStudyLogger initialized - Session: ${this.userSessionId}`);
    console.log(`🌐 Remote logging: ${this.enableRemoteLogging ? 'ENABLED' : 'DISABLED'}`);
    
    // Test the endpoint immediately
    this.testEndpoint();
  }

  async testEndpoint() {
    try {
      console.log('🔧 Testing user study endpoint...');
      
      // Test if the endpoint exists
      const response = await fetch('/api/user-study/log-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: 'endpoint_test',
          user_session_id: this.userSessionId,
          timestamp: Date.now() / 1000,
          logged_at: Date.now() / 1000,
          iso_timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ User study endpoint is working:', result);
      } else {
        console.warn(`⚠️ Endpoint test failed: ${response.status} ${response.statusText}`);
        if (response.status === 405) {
          console.warn('💡 This is a METHOD NOT ALLOWED error. Check your Flask route configuration.');
          console.warn('💡 Make sure your route is: @main.route(\'/api/user-study/log-event\', methods=[\'POST\'])');
        }
        this.enableRemoteLogging = false; // Disable remote logging
        console.log('🔴 Remote logging disabled due to endpoint issues');
      }
    } catch (error) {
      console.warn('⚠️ Cannot reach user study endpoint:', error.message);
      console.log('💡 Continuing with local-only logging');
      this.enableRemoteLogging = false;
    }
  }

  initializeUserSession() {
    let sessionId = localStorage.getItem('user_study_session_id');
    if (!sessionId) {
      sessionId = `study_${this.generateId()}`;
      localStorage.setItem('user_study_session_id', sessionId);
    }
    return sessionId;
  }

  generateId() {
    return Math.random().toString(36).substr(2, 12);
  }

  getCurrentTimestamp() {
    return Date.now() / 1000;
  }

  getISOTimestamp() {
    return new Date().toISOString();
  }

  // Store event locally regardless of remote logging success
  storeEventLocally(event) {
    try {
      const storedEvents = JSON.parse(localStorage.getItem(this.localStorageKey) || '[]');
      storedEvents.push(event);
      
      // Keep only last 1000 events to avoid storage overflow
      if (storedEvents.length > 1000) {
        storedEvents.splice(0, storedEvents.length - 1000);
      }
      
      localStorage.setItem(this.localStorageKey, JSON.stringify(storedEvents));
      
      // Also store in window for immediate access
      if (!window.userStudyEvents) {
        window.userStudyEvents = [];
      }
      window.userStudyEvents.push(event);
      
      return true;
    } catch (error) {
      console.warn('⚠️ Failed to store event locally:', error);
      return false;
    }
  }

  async logEvent(eventType, eventData = {}) {
    const event = {
      event_type: eventType,
      user_session_id: this.userSessionId,
      timestamp: this.getCurrentTimestamp(),
      logged_at: this.getCurrentTimestamp(),
      iso_timestamp: this.getISOTimestamp(),
      user_agent: navigator.userAgent,
      ...eventData
    };

    // Always log to console and store locally first
    console.log(`📊 Logging event: ${eventType}`, event);
    this.storeEventLocally(event);

    // Try remote logging if enabled
    if (this.enableRemoteLogging && this.isOnline) {
      this.eventQueue.push(event);
      
      try {
        await this.sendEvent(event);
        // Remove from queue if successful
        this.eventQueue = this.eventQueue.filter(e => e !== event);
        console.log(`✅ Event sent to server: ${eventType}`);
      } catch (error) {
        console.warn(`⚠️ Failed to send event to server (will retry): ${eventType}`, error.message);
        // Event stays in queue for retry
      }
    }

    return event;
  }

  async sendEvent(event) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch('/api/user-study/log-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // More specific error messages
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        if (response.status === 404) {
          errorMessage = 'Logging endpoint not found - check backend configuration';
          console.warn('💡 Add this route to your Flask app: @main.route(\'/api/user-study/log-event\', methods=[\'POST\'])');
        } else if (response.status === 405) {
          errorMessage = 'Method not allowed - check route configuration';
          console.warn('💡 Make sure your Flask route allows POST method');
          console.warn('💡 Check: @main.route(\'/api/user-study/log-event\', methods=[\'POST\'])');
        } else if (response.status === 500) {
          errorMessage = 'Server error - check backend logs';
        }
        
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - server too slow');
      } else if (error.message.includes('Failed to fetch')) {
        throw new Error('Network error - server unreachable');
      }
      throw error;
    }
  }

  async flushEventQueue() {
    if (this.eventQueue.length === 0) return;

    console.log(`🔄 Flushing ${this.eventQueue.length} queued events`);
    
    const events = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of events) {
      try {
        await this.sendEvent(event);
        console.log(`✅ Queued event sent: ${event.event_type}`);
      } catch (error) {
        console.warn(`⚠️ Failed to send queued event: ${event.event_type}`, error.message);
        this.eventQueue.push(event); // Put failed events back in queue
      }
    }
  }

  // Export logged events for manual analysis
  exportLoggedEvents() {
    const events = JSON.parse(localStorage.getItem(this.localStorageKey) || '[]');
    
    if (events.length === 0) {
      console.log('📭 No events to export');
      return;
    }
    
    const dataStr = events.map(e => JSON.stringify(e)).join('\n');
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `user_study_events_${this.userSessionId}_${dateStr}.jsonl`;
    link.click();
    
    console.log(`📥 Exported ${events.length} events to file`);
    return events.length;
  }

  // Get stats about logged events
  getEventStats() {
    const events = JSON.parse(localStorage.getItem(this.localStorageKey) || '[]');
    const stats = {
      total_events: events.length,
      event_types: {},
      session_duration: (Date.now() - this.sessionStartTime) / 1000,
      queued_events: this.eventQueue.length,
      remote_logging_enabled: this.enableRemoteLogging
    };

    events.forEach(event => {
      const type = event.event_type;
      stats.event_types[type] = (stats.event_types[type] || 0) + 1;
    });

    return stats;
  }

  // Enable/disable remote logging
  setRemoteLogging(enabled) {
    this.enableRemoteLogging = enabled;
    console.log(`🌐 Remote logging ${enabled ? 'ENABLED' : 'DISABLED'}`);
    
    if (enabled && this.isOnline && this.eventQueue.length > 0) {
      this.flushEventQueue();
    }
  }

  // Clear all stored events (for testing)
  clearStoredEvents() {
    localStorage.removeItem(this.localStorageKey);
    window.userStudyEvents = [];
    this.eventQueue = [];
    console.log('🗑️ Cleared all stored events');
  }

  // Force retry sending events
  async retryFailedEvents() {
    if (this.eventQueue.length === 0) {
      console.log('📭 No events in queue to retry');
      return;
    }
    
    console.log(`🔄 Retrying ${this.eventQueue.length} failed events...`);
    await this.flushEventQueue();
  }

  // ===== ALL YOUR EXISTING LOGGING METHODS STAY THE SAME =====
  
  async logSessionStart() {
    return await this.logEvent('session_start', {
      ip_address: '127.0.0.1'
    });
  }

  async logSessionCreated(sessionId, documentId = null) {
    return await this.logEvent('session_created', {
      session_id: sessionId,
      document_id: documentId
    });
  }

  async logDocumentUploaded(documentId, filename, textLength, sentenceCount) {
    return await this.logEvent('document_uploaded', {
      document_id: documentId,
      filename: filename,
      text_length: textLength,
      sentence_count: sentenceCount
    });
  }

  async logDocumentSelected(documentId, filename, isPreloaded = false) {
    return await this.logEvent('document_selected', {
      document_id: documentId,
      filename: filename,
      is_preloaded: isPreloaded
    });
  }

  async logQuestionSubmitted(questionId, questionText, documentId, processingMethod = 'default') {
    return await this.logEvent('question_submitted', {
      question_id: questionId,
      question_text: questionText,
      document_id: documentId,
      processing_method: processingMethod,
      character_count: questionText.length,
      word_count: questionText.split(/\s+/).length
    });
  }

  async logAnswerReceived(questionId, answer, processingTime, answerLength) {
    return await this.logEvent('answer_received', {
      question_id: questionId,
      answer: answer,
      processing_time: processingTime,
      answer_length: answerLength,
      answer_word_count: answer.split(/\s+/).length
    });
  }

  async logProvenanceRequested(questionId, provenanceIndex, currentCount) {
    return await this.logEvent('provenance_requested', {
      question_id: questionId,
      provenance_index: provenanceIndex,
      current_count: currentCount
    });
  }

  async logProvenanceReceived(questionId, provenanceId, provenanceIndex, sentenceIds, content, processingTime) {
    return await this.logEvent('provenance_received', {
      question_id: questionId,
      provenance_id: provenanceId,
      provenance_index: provenanceIndex,
      sentence_ids: sentenceIds,
      sentence_count: sentenceIds ? sentenceIds.length : 0,
      content_length: Array.isArray(content) ? content.join(' ').length : (content ? content.length : 0),
      processing_time: processingTime
    });
  }

  async logProvenanceViewed(questionId, provenanceId, provenanceIndex, viewDuration = null) {
    return await this.logEvent('provenance_viewed', {
      question_id: questionId,
      provenance_id: provenanceId,
      provenance_index: provenanceIndex,
      view_duration: viewDuration
    });
  }

  async logProvenanceHighlighted(questionId, provenanceId, pdfPage, highlightMethod = 'automatic') {
    return await this.logEvent('provenance_highlighted', {
      question_id: questionId,
      provenance_id: provenanceId,
      pdf_page: pdfPage,
      highlight_method: highlightMethod
    });
  }

  async logUserInteraction(interactionType, targetElement, details = {}) {
    return await this.logEvent('user_interaction', {
      interaction_type: interactionType,
      target_element: targetElement,
      ...details
    });
  }

  async logFeedbackModalOpened(questionId, provenanceCount, processingTime) {
    return await this.logEvent('feedback_modal_opened', {
      question_id: questionId,
      provenance_count: provenanceCount,
      processing_time: processingTime
    });
  }

  async logFeedbackSubmitted(questionId, documentId, feedbackData) {
    const {
      provenanceQuality,
      overallExperience,
      issues,
      comments,
      improvements,
      contextualIssues,
      trustworthiness,
      confidenceInAnswer,
      timestamp,
      submissionTime
    } = feedbackData.feedback;

    return await this.logEvent('feedback_submitted', {
      question_id: questionId,
      document_id: documentId,
      
      // Provenance Quality Ratings
      correctness: provenanceQuality.correctness,
      relevance: provenanceQuality.relevance,
      completeness: provenanceQuality.completeness,
      contextual_appropriateness: provenanceQuality.contextual_appropriateness,
      
      // Overall Experience Ratings
      wait_time_expectation: overallExperience.waitTime,
      wait_time_perception: overallExperience.waitTimePerception,
      satisfaction: overallExperience.satisfaction,
      task_completion: overallExperience.taskCompletion,
      would_use_again: overallExperience.wouldUseAgain,
      
      // System Trust
      trustworthiness: trustworthiness,
      confidence_in_answer: confidenceInAnswer,
      
      // Issues and Comments
      specific_issues: issues,
      issues_count: issues.length,
      comments: comments,
      improvements: improvements,
      contextual_issues: contextualIssues,
      
      // Metadata
      feedback_timestamp: timestamp,
      submission_time: submissionTime,
      
      // Session Context
      provenance_count: feedbackData.provenanceCount,
      provenances_viewed: feedbackData.provenancesViewed,
      
      // Text Lengths for Analysis
      comments_length: comments ? comments.length : 0,
      improvements_length: improvements ? improvements.length : 0,
      contextual_issues_length: contextualIssues ? contextualIssues.length : 0
    });
  }

  async logFeedbackModalClosed(questionId, submissionStatus, timeSpent) {
    return await this.logEvent('feedback_modal_closed', {
      question_id: questionId,
      submission_status: submissionStatus,
      time_spent: timeSpent
    });
  }

  async logError(errorType, errorMessage, context = {}) {
    return await this.logEvent('error_occurred', {
      error_type: errorType,
      error_message: errorMessage,
      ...context
    });
  }

  async logPerformanceMetric(metricName, value, context = {}) {
    return await this.logEvent('performance_metric', {
      metric_name: metricName,
      metric_value: value,
      ...context
    });
  }

  // Timing utilities
  startTiming(timerId) {
    if (!this.timers) this.timers = {};
    this.timers[timerId] = Date.now();
  }

  async endTiming(timerId, eventType, context = {}) {
    if (!this.timers || !this.timers[timerId]) {
      console.warn(`Timer ${timerId} not found`);
      return;
    }
    
    const duration = Date.now() - this.timers[timerId];
    delete this.timers[timerId];
    
    return await this.logEvent(eventType, {
      timer_id: timerId,
      duration_ms: duration,
      duration_seconds: duration / 1000,
      ...context
    });
  }

  getUserSessionId() {
    return this.userSessionId;
  }

  getSessionDuration() {
    return (Date.now() - this.sessionStartTime) / 1000;
  }

  async logSessionEnd() {
    return await this.logEvent('session_end', {
      session_duration: this.getSessionDuration()
    });
  }
}

// Create and export singleton instance
const userStudyLogger = new UserStudyLogger();

// Log session start immediately
userStudyLogger.logSessionStart();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  userStudyLogger.logSessionEnd();
});

// Add debug methods to window for testing
window.debugUserStudy = {
  stats: () => userStudyLogger.getEventStats(),
  export: () => userStudyLogger.exportLoggedEvents(),
  enableRemote: () => userStudyLogger.setRemoteLogging(true),
  disableRemote: () => userStudyLogger.setRemoteLogging(false),
  clear: () => userStudyLogger.clearStoredEvents(),
  flush: () => userStudyLogger.flushEventQueue(),
  retry: () => userStudyLogger.retryFailedEvents(),
  test: () => userStudyLogger.testEndpoint()
};

export default userStudyLogger;