import React, { createContext, useContext, useReducer } from 'react';

const AppStateContext = createContext();

const initialState = {
  questionsHistory: new Map(),
  activeQuestionId: null,
  selectedProvenance: null,
  navigationTrigger: null,
};

const appStateReducer = (state, action) => {
  switch (action.type) {
    case 'DOCUMENT_CHANGED':
      console.log('🧹 Context: Document changed - clearing all question state');
      return {
        ...state,
        questionsHistory: new Map(),
        activeQuestionId: null,
        selectedProvenance: null,
        navigationTrigger: null,
      };
    
    case 'ADD_QUESTION':
      console.log('➕ Context: Adding question:', action.payload.id);
      const newHistory = new Map(state.questionsHistory);
      newHistory.set(action.payload.id, action.payload);
      return {
        ...state,
        questionsHistory: newHistory,
        activeQuestionId: action.payload.id,
      };
    
    case 'UPDATE_QUESTION':
      console.log('🔄 Context: Updating question:', action.payload.questionId);
      const updatedHistory = new Map(state.questionsHistory);
      const existing = updatedHistory.get(action.payload.questionId);
      if (existing) {
        updatedHistory.set(action.payload.questionId, { 
          ...existing, 
          ...action.payload.updates 
        });
      }
      return { ...state, questionsHistory: updatedHistory };
    
    case 'SET_ACTIVE_QUESTION':
      // Only log if it's actually changing
      if (state.activeQuestionId !== action.payload) {
        console.log('🎯 Context: Active question changed to:', action.payload);
      } else {
        return state;
      }
      return { ...state, activeQuestionId: action.payload };
    
    case 'SET_SELECTED_PROVENANCE':
      console.log('🔍 Context: Selected provenance changed to:', action.payload?.provenance_id || null);
      return { ...state, selectedProvenance: action.payload };
    
    case 'SET_NAVIGATION_TRIGGER':
      return { ...state, navigationTrigger: action.payload };
    
    default:
      return state;
  }
};

export const AppStateProvider = ({ children }) => {
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  
  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
};