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
      <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
        <div className="card bg-base-100 border border-base-200 shadow-md w-full max-w-lg">
          <div className="card-body gap-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-primary text-primary-content flex items-center justify-center text-lg font-semibold">B</div>
              <div>
                <div className="text-xl font-semibold">Device Setup</div>
                <div className="text-sm text-base-content/60">Create your secure calling identity.</div>
              </div>
            </div>
            <div className="grid gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Phone Number</span>
                </label>
                <div className="join w-full">
                  <input
                    type="text"
                    className="input input-bordered join-item w-full"
                    value={number}
                    onChange={e => setNumber(e.target.value)}
                    placeholder="Number"
                  />
                  <button className="btn btn-outline join-item" onClick={handleIssue} type="button">
                    Get New
                  </button>
                </div>
              </div>
              <div className="form-control">
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
            </div>
            <div className="card-actions justify-end">
              <button
                className="btn btn-primary"
                disabled={!number || !code}
                onClick={() => setStep('mode')}
              >
                Continue
              </button>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
      <div className="card bg-base-100 border border-base-200 shadow-md w-full max-w-lg">
        <div className="card-body gap-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary text-primary-content flex items-center justify-center text-lg font-semibold">B</div>
            <div>
              <div className="text-xl font-semibold">Security Mode</div>
              <div className="text-sm text-base-content/60">Choose how your vault unlocks.</div>
            </div>
          </div>
          <div className="grid gap-4">
            <label className={`card border ${mode === 'silent' ? 'border-primary' : 'border-base-200'} bg-base-100 shadow-sm cursor-pointer`}>
              <div className="card-body flex-row items-start gap-4">
                <input
                  type="radio"
                  name="mode"
                  className="radio radio-primary mt-1"
                  checked={mode === 'silent'}
                  onChange={() => setMode('silent')}
                />
                <div>
                  <div className="font-semibold">Silent Mode</div>
                  <div className="text-xs text-base-content/60">
                    Unlocks automatically on trusted devices. Quick access, lower protection.
                  </div>
                </div>
              </div>
            </label>

            <label className={`card border ${mode === 'password' ? 'border-primary' : 'border-base-200'} bg-base-100 shadow-sm cursor-pointer`}>
              <div className="card-body flex-row items-start gap-4">
                <input
                  type="radio"
                  name="mode"
                  className="radio radio-primary mt-1"
                  checked={mode === 'password'}
                  onChange={() => setMode('password')}
                />
                <div>
                  <div className="font-semibold">Password Mode</div>
                  <div className="text-xs text-base-content/60">
                    Requires a password to unlock your vault. Stronger protection.
                  </div>
                </div>
              </div>
            </label>
          </div>

          {mode === 'password' && (
            <div className="grid gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
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

          <div className="card-actions justify-between">
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
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
