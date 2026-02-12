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
      navigate('/home');
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
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <span className="loading loading-spinner loading-lg"></span>
        <p className="mt-4 text-opacity-60">Initializing secure vault...</p>
      </div>
    );
  }

  const handleReset = async () => {
    await clearVault();
    window.location.reload();
  };

  if (error) {
    return (
      <div className="flex flex-col gap-4 max-w-md mx-auto mt-10">
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
        <div className="flex justify-center gap-4">
          <button className="btn btn-outline" onClick={() => window.location.reload()}>Retry</button>
          <button className="btn btn-error btn-outline" onClick={handleReset}>Reset Vault</button>
        </div>
      </div>
    );
  }

  if (vaultState === 'none') {
    return <Setup onComplete={() => navigate('/home')} />;
  }

  if (vaultState === 'password') {
    return <Unlock mode="password" onUnlock={() => navigate('/home')} />;
  }

  return null;
}
