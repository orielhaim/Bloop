import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Entry from './pages/Entry';
import Home from './pages/Home';
import ProtectedRoute from './components/ProtectedRoute';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-base-100 text-base-content overflow-hidden">
        <Routes>
          <Route path="/" element={<Entry />} />
          <Route 
            path="/home" 
            element={
              <ProtectedRoute>
                <Home />
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
