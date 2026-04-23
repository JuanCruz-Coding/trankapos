import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { seedIfEmpty } from './data/local/seed';
import './index.css';

async function bootstrap() {
  const mode = (import.meta.env.VITE_DATA_DRIVER as string | undefined) ?? 'local';
  if (mode === 'local') {
    try {
      await seedIfEmpty();
    } catch (e) {
      console.error('Seed failed', e);
    }
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
