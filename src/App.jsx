import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Entry from './pages/Entry';
import Home from './pages/Home';
import Settings from './pages/Settings';
import ProtectedRoute from './components/ProtectedRoute';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-base-100 text-base-content overflow-hidden">
        <Routes>
          <Route path="/entry" element={<Entry />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
