import 'leaflet/dist/leaflet.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { DemoDataProvider, reset } from './store';

/** データの読み込みそのものが失敗したとき：初期状態に戻して読み直す */
function resetAndReload() {
  try {
    reset();
  } catch (e) {
    console.error(e);
  }
  // 保存は間引いているので、書き終わるのを少し待ってから読み直す
  setTimeout(() => location.reload(), 500);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={resetAndReload}>
      <DemoDataProvider>
        <HashRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </HashRouter>
      </DemoDataProvider>
    </ErrorBoundary>
  </StrictMode>,
);
