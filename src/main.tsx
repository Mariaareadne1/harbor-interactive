import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/fraunces';
import './app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
if (new URLSearchParams(location.search).has('raw')) {
  const { rawScene } = await import('./dev/raw');
  rawScene(root);
} else {
  const { App } = await import('./app/App');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
