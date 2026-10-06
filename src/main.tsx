import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-sans-tamil/400.css';
import './styles.css';
import './polish.css';
import { App, AppErrorBoundary } from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>);
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
