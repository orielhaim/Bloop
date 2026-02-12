import { useState, useTransition } from 'react';
import { unlockVault, getStoredKeys, getStoredNumber, signChallenge } from '../services/crypto';
import { requestChallenge, verifyChallenge } from '../services/api';
import { useNavigate } from 'react-router-dom';

export default function Unlock({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  const handleUnlock = () => {
    startTransition(async () => {
      setError(null);
      setStatus('Unlocking vault...');
      try {
        await unlockVault(password);
        
        setStatus('Authenticating...');
        const number = await getStoredNumber();
        const keys = await getStoredKeys();
        
        if (!number || !keys) throw new Error("Vault corrupted or empty");

        const { challengeId, challenge } = await requestChallenge(number);
        const signature = await signChallenge(keys.signing.private, challenge);
        await verifyChallenge(challengeId, number, signature);

        if (onUnlock) onUnlock();
        else navigate('/home');

      } catch (e) {
        console.error(e);
        setError(e.message || "Unlock failed");
        setStatus('');
      }
    });
  };

  return (
    <div className="card bg-base-200 shadow-xl max-w-md mx-auto">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-4">Welcome Back</h2>
        <p className="mb-4">Enter your password to unlock your vault.</p>
        
        <input 
          type="password" 
          className="input input-bordered w-full" 
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUnlock()}
          autoFocus
        />

        <div className="card-actions justify-end mt-6">
          <button 
            className="btn btn-primary" 
            onClick={handleUnlock}
            disabled={isPending || !password}
          >
            {isPending ? <span className="loading loading-spinner"></span> : 'Unlock'}
          </button>
        </div>
        
        {status && <div className="text-info mt-4 text-center">{status}</div>}
        {error && <div className="alert alert-error mt-4">{error}</div>}
      </div>
    </div>
  );
}
