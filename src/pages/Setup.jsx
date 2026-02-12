import { useState, useTransition } from 'react';
import { issueNumber, activateNumber } from '../services/api';
import { generateKeys, setupVault } from '../services/crypto';
import { useNavigate } from 'react-router-dom';

export default function Setup({ onComplete }) {
  const [step, setStep] = useState('input'); // input, mode, processing
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('silent'); // silent, password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  const handleIssue = async () => {
    try {
      setError(null);
      const data = await issueNumber();
      setNumber(data.number);
      setCode(data.activationCode);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleActivateAndSetup = () => {
    if (mode === 'password' && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (mode === 'password' && !password) {
      setError("Password is required");
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const keys = await generateKeys();

        await activateNumber(code, keys.signing.public, keys.encryption.public);

        await setupVault(number, mode, password, keys);

        if (onComplete) onComplete();
        else navigate('/home');
        
      } catch (e) {
        console.error(e);
        setError(e.message || "Setup failed");
      }
    });
  };

  if (step === 'input') {
    return (
      <div className="card bg-base-200 shadow-xl max-w-md mx-auto">
        <div className="card-body">
          <h2 className="card-title text-2xl mb-4">Device Setup</h2>
          
          <div className="form-control">
            <label className="label">
              <span className="label-text">Phone Number</span>
            </label>
            <div className="flex gap-2">
              <input 
                type="text" 
                className="input input-bordered flex-1" 
                value={number}
                onChange={e => setNumber(e.target.value)}
                placeholder="Number"
              />
              <button className="btn btn-outline" onClick={handleIssue} type="button">
                Get New
              </button>
            </div>
          </div>

          <div className="form-control mt-4">
            <label className="label">
              <span className="label-text">Activation Code</span>
            </label>
            <input 
              type="text" 
              className="input input-bordered" 
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Code"
            />
          </div>

          <div className="card-actions justify-end mt-6">
            <button 
              className="btn btn-primary" 
              disabled={!number || !code}
              onClick={() => setStep('mode')}
            >
              Next
            </button>
          </div>
          {error && <div className="alert alert-error mt-4">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200 shadow-xl max-w-md mx-auto">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-4">Security Mode</h2>
        
        <div className="form-control">
          <label className="label cursor-pointer justify-start gap-4">
            <input 
              type="radio" 
              name="mode" 
              className="radio radio-primary" 
              checked={mode === 'silent'} 
              onChange={() => setMode('silent')} 
            />
            <span className="label-text font-bold">Silent Mode</span>
          </label>
          <p className="text-xs opacity-70 ml-10 mb-4">
            Keys are stored on device. Unlocks automatically. Convenient but less secure if device is stolen.
          </p>
        </div>

        <div className="form-control">
          <label className="label cursor-pointer justify-start gap-4">
            <input 
              type="radio" 
              name="mode" 
              className="radio radio-primary" 
              checked={mode === 'password'} 
              onChange={() => setMode('password')} 
            />
            <span className="label-text font-bold">Password Mode</span>
          </label>
          <p className="text-xs opacity-70 ml-10 mb-4">
            Keys encrypted with password. Must enter password to unlock. High security.
          </p>
        </div>

        {mode === 'password' && (
          <div className="ml-10 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <input 
              type="password" 
              className="input input-bordered w-full" 
              placeholder="Create Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <input 
              type="password" 
              className="input input-bordered w-full" 
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
        )}

        <div className="card-actions justify-between mt-8">
          <button className="btn btn-ghost" onClick={() => setStep('input')}>
            Back
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleActivateAndSetup}
            disabled={isPending}
          >
            {isPending ? <span className="loading loading-spinner"></span> : 'Activate & Setup'}
          </button>
        </div>
        {error && <div className="alert alert-error mt-4">{error}</div>}
      </div>
    </div>
  );
}
