import { useState, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestChallenge, verifyChallenge } from '../services/api';
import {
  getStoredKeys,
  getStoredNumber,
  signChallenge,
  unlockVault,
} from '../services/crypto';

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

        if (!number || !keys) throw new Error('Vault corrupted or empty');

        const { challengeId, challenge } = await requestChallenge(number);
        const signature = await signChallenge(keys.signing.private, challenge);
        await verifyChallenge(challengeId, number, signature);

        if (onUnlock) onUnlock();
        else navigate('/');
      } catch (e) {
        console.error(e);
        setError(e.message || 'Unlock failed');
        setStatus('');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
      <div className="card bg-base-100 border border-base-200 shadow-md w-full max-w-md">
        <div className="card-body gap-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary text-primary-content flex items-center justify-center text-lg font-semibold">
              B
            </div>
            <div>
              <div className="text-xl font-semibold">Welcome Back</div>
              <div className="text-sm text-base-content/60">
                Unlock your secure vault.
              </div>
            </div>
          </div>
          <input
            type="password"
            className="input input-bordered w-full"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            autoFocus
          />
          <div className="card-actions justify-end">
            <button
              className="btn btn-primary"
              onClick={handleUnlock}
              disabled={isPending || !password}
            >
              {isPending ? (
                <span className="loading loading-spinner"></span>
              ) : (
                'Unlock'
              )}
            </button>
          </div>
          {status && (
            <div className="text-info text-sm text-center">{status}</div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
