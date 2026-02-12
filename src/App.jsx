import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Registration from './pages/Registration';
import Login from './pages/Login';
import Home from './pages/Home';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-base-100 text-base-content">
        <div className="navbar bg-base-300">
          <div className="flex-1">
            <a className="btn btn-ghost text-xl">P2P Phone</a>
          </div>
          <div className="flex-none">
            <ul className="menu menu-horizontal px-1">
              <li><a href="/register">Register</a></li>
              <li><a href="/login">Login</a></li>
              <li><a href="/home">Home</a></li>
            </ul>
          </div>
        </div>
        
        <div className="container mx-auto py-8">
          <Routes>
            <Route path="/register" element={<Registration />} />
            <Route path="/login" element={<Login />} />
            <Route path="/home" element={<Home />} />
            <Route path="/" element={<Navigate to="/register" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
