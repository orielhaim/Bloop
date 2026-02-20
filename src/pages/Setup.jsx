import { useState, useTransition } from 'react';
import { issueNumber, activateNumber } from '../services/api';
import { generateKeys, setupVault, importVaultExport } from '../services/crypto';
import { useNavigate } from 'react-router-dom';

export default function Setup({ onComplete }) {
  const [step, setStep] = useState('input'); // input, mode, processing
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('silent'); // silent, password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [importData, setImportData] = useState(null);
  const [importPassword, setImportPassword] = useState('');
  const [importError, setImportError] = useState(null);
  const [importFileName, setImportFileName] = useState('');
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

  const handleImportFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setImportData(data);
      setImportPassword('');
      setImportError(null);
      setImportFileName(file.name);
      setStep('import');
    } catch {
      setError("Invalid connection file");
    }
  };

  const handleImport = () => {
    if (!importData) return;
    const requiresPassword = importData?.mode === 'password' || importData?.encrypted;
    if (requiresPassword && !importPassword) {
      setImportError("Password is required");
      return;
    }

    startTransition(async () => {
      setImportError(null);
      try {
        await importVaultExport(importData, requiresPassword ? importPassword : null);
        if (onComplete) onComplete();
        else navigate('/home');
      } catch (e) {
        console.error(e);
        setImportError(e.message || "Import failed");
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
            <div className="divider">Or</div>
            <div className="grid gap-3">
              <div className="text-sm text-base-content/60">
                Import a connection file to restore an existing number.
              </div>
              <label className="btn btn-outline w-full">
                Import Connection File
                <input
                  type="file"
                  accept=".bloop,application/json"
                  className="hidden"
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                />
              </label>
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

  if (step === 'import') {
    const requiresPassword = importData?.mode === 'password' || importData?.encrypted;
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100 px-4">
        <div className="card bg-base-100 border border-base-200 shadow-md w-full max-w-lg">
          <div className="card-body gap-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-primary text-primary-content flex items-center justify-center text-lg font-semibold">B</div>
              <div>
                <div className="text-xl font-semibold">Import Connection</div>
                <div className="text-sm text-base-content/60">Restore your secure identity from a file.</div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-base-200 bg-base-200/50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-base-content/60">File</span>
                  <span className="font-medium">{importFileName || 'Selected file'}</span>
                </div>
                {importData?.number && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-base-content/60">Number</span>
                    <span className="font-mono">{importData.number}</span>
                  </div>
                )}
                {importData?.mode && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-base-content/60">Mode</span>
                    <span className="capitalize font-medium">{importData.mode}</span>
                  </div>
                )}
              </div>
              {requiresPassword && (
                <input
                  type="password"
                  className="input input-bordered w-full"
                  placeholder="Password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                />
              )}
            </div>
            <div className="card-actions justify-between">
              <button className="btn btn-ghost" onClick={() => setStep('input')}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={isPending || (requiresPassword && !importPassword)}
              >
                {isPending ? <span className="loading loading-spinner"></span> : 'Import & Connect'}
              </button>
            </div>
            {importError && <div className="alert alert-error">{importError}</div>}
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
