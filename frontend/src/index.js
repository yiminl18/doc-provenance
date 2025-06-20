import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/brutalist-design.css';
import App from './App';
import { AppStateProvider } from './contexts/AppStateContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>
); 