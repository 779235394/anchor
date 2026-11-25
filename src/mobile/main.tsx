import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/global.css';
import './mobile.css';
import { MobileApp } from './MobileApp';

ReactDOM.createRoot(document.getElementById('mobile-root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
);
