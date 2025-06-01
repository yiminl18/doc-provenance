// src/services/userStudyLogger.js
// Comprehensive user study event logging service

class UserStudyLogger {
  constructor() {
    this.userSessionId = this.initializeUserSession();
    this.sessionStartTime = Date.now();
    this.eventQueue = [];
    this.isOnline = navigator.onLine;
    
    // Listen for online/offline events to batch send when connection returns
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.flushEventQueue();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  initializeUserSession() {
    // Generate or retrieve user session ID
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
    return Date.now() / 1000; // Unix timestamp in seconds
  }

  getISOTimestamp() {
    return new Date().toISOString();
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

    console.log(`📊 Logging event: ${eventType}`, event);

    // Add to queue for potential retry
    this.eventQueue.push(event);

    try {
      // Attempt to send immediately if online
      if (this.isOnline) {
        await this.sendEvent(event);
        // Remove from queue if successful
        this.eventQueue = this.eventQueue.filter(e => e !== event);
      }
    } catch (error) {
      console.warn('⚠️ Failed to send event, keeping in queue:', error);
    }

    return event;
  }

  async sendEvent(event) {
    try {
      const response = await fetch('/api/user-study/log-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('❌ Error sending event to server:', error);
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
      } catch (error) {
        // Put failed events back in queue
        this.eventQueue.push(event);
      }
    }
  }

  // ===== SESSION EVENTS =====
  
  async logSessionStart() {
    return await this.logEvent('session_start', {
      ip_address: '127.0.0.1' // Backend should detect this
    });
  }

  async logSessionCreated(sessionId, documentId = null) {
    return await this.logEvent('session_created', {
      session_id: sessionId,
      document_id: documentId
    });
  }

  // ===== DOCUMENT EVENTS =====
  
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

  // ===== QUESTION PROCESSING EVENTS =====
  
  async logTextProcessingStarted(sessionId, questionId, documentId, processingSessionId, questionText) {
    return await this.logEvent('text_processing_started', {
      session_id: sessionId,
      question_id: questionId,
      document_id: documentId,
      processing_session_id: processingSessionId,
      question_text: questionText
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

  // ===== PROVENANCE EVENTS =====
  
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

  // ===== USER INTERACTION EVENTS =====
  
  async logUserInteraction(interactionType, targetElement, details = {}) {
    return await this.logEvent('user_interaction', {
      interaction_type: interactionType, // click, scroll, hover, keypress
      target_element: targetElement,
      ...details
    });
  }

  async logPageNavigation(fromPage, toPage, navigationMethod = 'click') {
    return await this.logEvent('page_navigation', {
      from_page: fromPage,
      to_page: toPage,
      navigation_method: navigationMethod
    });
  }

  // ===== FEEDBACK EVENTS =====
  
  async logFeedbackModalOpened(questionId, provenanceCount, processingTime) {
    return await this.logEvent('feedback_modal_opened', {
      question_id: questionId,
      provenance_count: provenanceCount,
      processing_time: processingTime
    });
  }

  async logFeedbackSubmitted(questionId, documentId, feedbackData) {
    // Extract and flatten the complex feedback structure
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
      specific_issues: issues, // Array of issue IDs
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
      submission_status: submissionStatus, // 'submitted' | 'cancelled'
      time_spent: timeSpent
    });
  }

  // ===== LIBRARY EVENTS =====
  
  async logQuestionLibraryOpened() {
    return await this.logEvent('question_library_opened');
  }

  async logQuestionAddedToLibrary(questionText, category, source = 'manual') {
    return await this.logEvent('question_added_to_library', {
      question_text: questionText,
      category: category,
      source: source, // 'manual' | 'from_history' | 'auto'
      character_count: questionText.length
    });
  }

  async logQuestionSelectedFromLibrary(questionId, questionText) {
    return await this.logEvent('question_selected_from_library', {
      library_question_id: questionId,
      question_text: questionText
    });
  }

  // ===== ERROR EVENTS =====
  
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

  // ===== TIMING EVENTS =====
  
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

  // ===== UTILITY METHODS =====
  
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

export default userStudyLogger;