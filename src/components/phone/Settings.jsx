import { useState } from 'react';
import { switchVaultMode, clearVault } from '../../services/crypto';
import { cleanupNostrService } from '../../services/nostr';
import { useNavigate } from 'react-router-dom';

export default function Settings({ currentMode, setCurrentMode, myKeys, number }) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [switchError, setSwitchError] = useState('');
  const navigate = useNavigate();

  const handleLogout = async () => {
    await clearVault();
    cleanupNostrService();
    navigate('/');
  };

  const handleSwitchMode = async () => {
    setSwitchError('');
    try {
      const targetMode = currentMode === 'silent' ? 'password' : 'silent';
      
      if (targetMode === 'password') {
        if (!newPassword) throw new Error("Password required");
        if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      }

      await switchVaultMode(targetMode, newPassword);
      setCurrentMode(targetMode);
      setIsSwitching(false);
      setNewPassword('');
      setConfirmPassword('');
      // alert(`Switched to ${targetMode} mode!`);
    } catch (e) {
      setSwitchError(e.message);
    }
  };

  return (
    <div className="flex flex-col h-full p-6 bg-base-100 overflow-y-auto">
      <h2 className="text-3xl font-bold mb-8">Settings</h2>

      <div className="card bg-base-200 shadow-sm mb-6">
        <div className="card-body p-4">
          <h3 className="card-title text-lg">My Number</h3>
          <p className="text-2xl font-mono">{number}</p>
        </div>
      </div>

      <div className="card bg-base-200 shadow-sm mb-6">
        <div className="card-body p-4">
          <h3 className="card-title text-lg">Security Mode</h3>
          <div className="flex justify-between items-center">
            <span className="badge badge-lg badge-primary capitalize">{currentMode}</span>
            <button 
              className="btn btn-sm btn-outline"
              onClick={() => setIsSwitching(!isSwitching)}
            >
              Change
            </button>
          </div>

          {isSwitching && (
            <div className="mt-4 pt-4 border-t border-base-300">
              <p className="text-sm mb-4">
                Switching to <span className="font-bold uppercase">{currentMode === 'silent' ? 'password' : 'silent'}</span> mode.
              </p>
              
              {currentMode === 'silent' && (
                <div className="form-control w-full">
                  <input 
                    type="password" 
                    className="input input-bordered w-full mb-2" 
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="New Password"
                  />
                  <input 
                    type="password" 
                    className="input input-bordered w-full mb-2" 
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                  />
                </div>
              )}
              
              {currentMode === 'password' && (
                <p className="text-xs text-warning mb-4">
                  Warning: Removing password protection allows anyone with access to this device to open your vault.
                </p>
              )}

              <div className="flex gap-2 mt-2">
                <button className="btn btn-primary btn-sm" onClick={handleSwitchMode}>
                  Confirm
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setIsSwitching(false)}>
                  Cancel
                </button>
              </div>
              {switchError && <p className="text-error text-sm mt-2">{switchError}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-200 shadow-sm mb-6">
        <div className="card-body p-4">
          <h3 className="card-title text-lg">Keys</h3>
           <div className="collapse collapse-arrow border border-base-300 bg-base-100 rounded-box">
            <input type="checkbox" /> 
            <div className="collapse-title text-sm font-medium">
              Show Private Keys
            </div>
            <div className="collapse-content"> 
              <pre className="text-xs overflow-x-auto p-2 bg-black text-green-400 rounded">
                {myKeys ? JSON.stringify(myKeys, null, 2) : 'Loading...'}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto">
        <button className="btn btn-error btn-outline w-full" onClick={handleLogout}>
          Logout / Reset
        </button>
      </div>
    </div>
  );
}
