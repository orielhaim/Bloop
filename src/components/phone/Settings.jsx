import { useState, useEffect } from 'react';
import { switchVaultMode, clearVault } from '../../services/crypto';
import { cleanupNostrService } from '../../services/nostr';
import { useNavigate } from 'react-router-dom';
import { 
  IoChevronBack, 
  IoCopyOutline, 
  IoMoonOutline, 
  IoShieldCheckmarkOutline, 
  IoKeyOutline, 
  IoLogOutOutline, 
  IoChevronForward,
  IoColorPaletteOutline,
  IoSunnyOutline
} from 'react-icons/io5';

export default function Settings({ currentMode, setCurrentMode, myKeys, number }) {
  const [view, setView] = useState('main'); // main, display, security, keys
  const navigate = useNavigate();
  
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    // Could add a toast here
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to logout? This will clear your vault from this device.")) {
      await clearVault();
      cleanupNostrService();
      navigate('/');
    }
  };

  if (view === 'main') {
    return (
      <div className="flex flex-col h-full bg-base-100 animate-in fade-in slide-in-from-right-4 duration-200">
        <div className="p-6 bg-base-200/50 flex flex-col items-center justify-center gap-2 border-b border-base-200">
          <div className="h-20 w-20 rounded-full bg-primary text-primary-content flex items-center justify-center text-3xl font-bold shadow-lg">
            B
          </div>
          <button 
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-base-100 border border-base-200 shadow-sm active:scale-95 transition-transform"
            onClick={() => copyToClipboard(number)}
          >
            <span className="font-mono font-medium text-lg">{number}</span>
            <IoCopyOutline className="text-base-content/50" />
          </button>
          <div className="text-xs text-base-content/50">Tap number to copy</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-base-100 rounded-2xl border border-base-200 shadow-sm overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-base-200/50 transition-colors border-b border-base-200 last:border-0"
              onClick={() => setView('display')}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <IoColorPaletteOutline className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Display</div>
                  <div className="text-xs text-base-content/60">Theme, colors</div>
                </div>
              </div>
              <IoChevronForward className="text-base-content/30" />
            </button>

            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-base-200/50 transition-colors border-b border-base-200 last:border-0"
              onClick={() => setView('security')}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                  <IoShieldCheckmarkOutline className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Security</div>
                  <div className="text-xs text-base-content/60">Vault mode, password</div>
                </div>
              </div>
              <IoChevronForward className="text-base-content/30" />
            </button>

            <button 
              className="w-full flex items-center justify-between p-4 hover:bg-base-200/50 transition-colors"
              onClick={() => setView('keys')}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                  <IoKeyOutline className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Key Management</div>
                  <div className="text-xs text-base-content/60">View, export keys</div>
                </div>
              </div>
              <IoChevronForward className="text-base-content/30" />
            </button>
          </div>

          <div className="bg-base-100 rounded-2xl border border-base-200 shadow-sm overflow-hidden">
            <button 
              className="w-full flex items-center gap-3 p-4 hover:bg-error/10 transition-colors text-error"
              onClick={handleLogout}
            >
              <div className="p-2 rounded-lg bg-error/10">
                <IoLogOutOutline className="h-5 w-5" />
              </div>
              <span className="font-medium">Logout / Reset</span>
            </button>
          </div>
          
          <div className="text-center text-xs text-base-content/30 py-4">
            Bloop v0.1.0
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-base-100 animate-in slide-in-from-right-8 duration-200">
      <div className="flex items-center gap-2 p-4 border-b border-base-200">
        <button 
          className="btn btn-ghost btn-sm -ml-2"
          onClick={() => setView('main')}
        >
          <IoChevronBack className="h-5 w-5" />
          Back
        </button>
        <h2 className="text-lg font-semibold capitalize">{view === 'keys' ? 'Key Management' : view}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {view === 'display' && <DisplaySettings />}
        {view === 'security' && <SecuritySettings currentMode={currentMode} setCurrentMode={setCurrentMode} />}
        {view === 'keys' && <KeySettings myKeys={myKeys} />}
      </div>
    </div>
  );
}

function DisplaySettings() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem('theme', theme);
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4">
          <h3 className="font-medium mb-3">App Theme</h3>
          <div className="grid grid-cols-1 gap-2">
            <button 
              className={`flex items-center justify-between p-3 rounded-xl border ${theme === 'light' ? 'border-primary bg-primary/5' : 'border-base-200'}`}
              onClick={() => setTheme('light')}
            >
              <div className="flex items-center gap-3">
                <IoSunnyOutline className="h-5 w-5" />
                <span>Light</span>
              </div>
              {theme === 'light' && <div className="h-2 w-2 rounded-full bg-primary"></div>}
            </button>
            <button 
              className={`flex items-center justify-between p-3 rounded-xl border ${theme === 'dark' ? 'border-primary bg-primary/5' : 'border-base-200'}`}
              onClick={() => setTheme('dark')}
            >
              <div className="flex items-center gap-3">
                <IoMoonOutline className="h-5 w-5" />
                <span>Dark</span>
              </div>
              {theme === 'dark' && <div className="h-2 w-2 rounded-full bg-primary"></div>}
            </button>
            <button 
              className={`flex items-center justify-between p-3 rounded-xl border ${theme === 'system' ? 'border-primary bg-primary/5' : 'border-base-200'}`}
              onClick={() => setTheme('system')}
            >
              <div className="flex items-center gap-3">
                <IoColorPaletteOutline className="h-5 w-5" />
                <span>System Default</span>
              </div>
              {theme === 'system' && <div className="h-2 w-2 rounded-full bg-primary"></div>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecuritySettings({ currentMode, setCurrentMode }) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [switchError, setSwitchError] = useState('');

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
    } catch (e) {
      setSwitchError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Security Mode</div>
              <div className="text-sm text-base-content/60">Current: <span className="capitalize font-medium">{currentMode}</span></div>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setIsSwitching(!isSwitching)}
            >
              {isSwitching ? 'Cancel' : 'Change'}
            </button>
          </div>

          {isSwitching && (
            <div className="border-t border-base-200 pt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="text-sm">
                Switching to <span className="font-semibold uppercase">{currentMode === 'silent' ? 'password' : 'silent'}</span> mode.
              </div>

              {currentMode === 'silent' && (
                <div className="grid gap-2">
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="New Password"
                  />
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                  />
                </div>
              )}

              {currentMode === 'password' && (
                <div className="alert alert-warning text-sm py-2">
                  Removing password protection allows anyone with access to this device to open your vault.
                </div>
              )}

              <button className="btn btn-primary w-full" onClick={handleSwitchMode}>
                Confirm Switch
              </button>
              {switchError && <div className="text-error text-sm text-center">{switchError}</div>}
            </div>
          )}
        </div>
      </div>
      
      <div className="px-4 text-xs text-base-content/50">
        Silent mode stores keys locally without a password. Password mode encrypts your keys with a password you must enter on startup.
      </div>
    </div>
  );
}

function KeySettings({ myKeys }) {
  const [showKeys, setShowKeys] = useState(false);

  const handleExport = () => {
    if (!myKeys) return;
    const exportData = JSON.stringify(myKeys, null, 2);
    navigator.clipboard.writeText(exportData);
    alert("Keys copied to clipboard!");
  };

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div>
            <div className="font-semibold">Your Keys</div>
            <div className="text-sm text-base-content/60">These are your identity. Never share your private keys.</div>
          </div>

          <div className="flex gap-2">
             <button 
              className="btn btn-sm flex-1"
              onClick={() => setShowKeys(!showKeys)}
            >
              {showKeys ? 'Hide Keys' : 'Show Keys'}
            </button>
            <button 
              className="btn btn-sm btn-outline flex-1"
              onClick={handleExport}
            >
              Export (Copy)
            </button>
          </div>

          {showKeys && (
            <div className="mockup-code bg-neutral text-neutral-content text-xs">
              <pre className="p-4"><code>{myKeys ? JSON.stringify(myKeys, null, 2) : 'Loading...'}</code></pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
