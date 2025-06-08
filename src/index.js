import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ProductionApp from './App'; // This is the corrected import
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ProductionApp />
  </React.StrictMode>
);

reportWebVitals();