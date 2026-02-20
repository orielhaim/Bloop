import { useEffect, useState, useRef } from 'react';
import { hasVault, getVaultMode, unlockVault, getStoredNumber, getStoredKeys, signChallenge, clearVault } from '../services/crypto';
import { requestChallenge, verifyChallenge } from '../services/api';
import { useNavigate } from 'react-router-dom';
import Setup from './Setup';
import Unlock from './Unlock';

export default function Entry() {
  const [loading, setLoading] = useState(true);
  const [vaultState, setVaultState] = useState(null); // 'none', 'silent', 'password'
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const effectRan = useRef(false);

  useEffect(() => {
    if (effectRan.current) return;
    effectRan.current = true;
    checkVault();
  }, []);

  const checkVault = async () => {
    try {
      const exists = await hasVault();
      if (!exists) {
        setVaultState('none');
        setLoading(false);
        return;
      }

      const mode = await getVaultMode();
      
      if (mode === 'silent') {
        // Auto unlock
        await attemptSilentUnlock();
      } else {
        setVaultState('password');
        setLoading(false);
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
      setLoading(false);
    }
  };

  const attemptSilentUnlock = async () => {
    try {
      await unlockVault();
      await performAuth();
      navigate('/');
    } catch (e) {
      console.error("Silent unlock failed", e);
      setError("Silent unlock failed: " + e.message);
      setLoading(false);
    }
  };

  const performAuth = async () => {
    const number = await getStoredNumber();
    const keys = await getStoredKeys();
    if (!number || !keys) throw new Error("Vault empty");

    const { challengeId, challenge } = await requestChallenge(number);
    const signature = await signChallenge(keys.signing.private, challenge);
    await verifyChallenge(challengeId, number, signature);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
        <div className="card bg-base-200 border border-base-300 shadow-sm w-full max-w-md">
          <div className="card-body items-center text-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-primary text-primary-content flex items-center justify-center text-xl font-semibold">B</div>
            <div className="text-lg font-semibold">Initializing Bloop</div>
            <div className="text-sm text-base-content/60">Securing your vault and preparing the call stack.</div>
            <span className="loading loading-spinner loading-md"></span>
          </div>
        </div>
      </div>
    );
  }

  const handleReset = async () => {
    await clearVault();
    window.location.reload();
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
        <div className="card bg-base-100 border border-base-200 shadow-md w-full max-w-md">
          <div className="card-body gap-4">
            <div className="text-xl font-semibold">Vault Error</div>
            <div className="alert alert-error">{error}</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-outline" onClick={() => window.location.reload()}>Retry</button>
              <button className="btn btn-error btn-outline" onClick={handleReset}>Reset Vault</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (vaultState === 'none') {
    return <Setup onComplete={() => navigate('/')} />;
  }

  if (vaultState === 'password') {
    return <Unlock mode="password" onUnlock={() => navigate('/')} />;
  }

  return null;
}
