import { Navigate } from 'react-router-dom';
import { isVaultUnlocked } from '../services/crypto';

export default function ProtectedRoute({ children }) {
  if (!isVaultUnlocked()) {
    return <Navigate to="/entry" replace />;
  }
  return children;
}
