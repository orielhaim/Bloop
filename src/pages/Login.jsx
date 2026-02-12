import { useState, useTransition, useEffect } from 'react';
import { requestChallenge, verifyChallenge } from '../services/api';
import { signChallenge, getStoredKeys, getStoredNumber } from '../services/crypto';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  useEffect(() => {
    const storedNum = getStoredNumber();
    if (storedNum) setNumber(storedNum);
  }, []);

  const handleLogin = () => {
    startTransition(async () => {
      setError(null);
      setStatus('Requesting challenge...');
      
      try {
        const keys = getStoredKeys();
        if (!keys) throw new Error("No keys found. Please register first.");
        if (getStoredNumber() !== number) throw new Error("Stored keys do not match the entered number.");

        // 1. Request challenge
        const { challengeId, challenge } = await requestChallenge(number);
        
        setStatus('Signing challenge...');
        // 2. Sign challenge
        const signature = await signChallenge(keys.signing.private, challenge);
        
        setStatus('Verifying...');
        // 3. Verify
        await verifyChallenge(challengeId, number, signature);
        
        setStatus('Success!');
        navigate('/home');
      } catch (e) {
        setError(e.message);
        setStatus('');
      }
    });
  };

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-6">Login</h1>
      
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Phone Number</span>
            </label>
            <input 
              type="text" 
              placeholder="1001" 
              className="input input-bordered" 
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          
          <button 
            className="btn btn-primary mt-6" 
            onClick={handleLogin}
            disabled={isPending || !number}
          >
            {isPending ? <span className="loading loading-spinner"></span> : 'Authenticate'}
          </button>
          
          {status && <div className="mt-4 text-info">{status}</div>}
          {error && <div className="alert alert-error mt-4">{error}</div>}
        </div>
      </div>
    </div>
  );
}
