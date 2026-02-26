import { useEffect, useState } from 'react';
import {
  IoAdd,
  IoChevronBack,
  IoChevronForward,
  IoColorPaletteOutline,
  IoCopyOutline,
  IoGlobeOutline,
  IoKeyOutline,
  IoLogOutOutline,
  IoMoonOutline,
  IoShieldCheckmarkOutline,
  IoSunnyOutline,
  IoTrash,
} from 'react-icons/io5';
import { useNavigate } from 'react-router-dom';
import {
  clearVault,
  createVaultExport,
  getStoredNumber,
  getVaultMode,
  switchVaultMode,
} from '../services/crypto';
import { cleanupNostrService } from '../services/nostr';
import { getSettings, saveSettings } from '../services/settings';

export default function Settings() {
  const [view, setView] = useState('main'); // main, display, security, keys
  const [number, setNumber] = useState('');
  const [currentMode, setCurrentMode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const loadData = async () => {
      const num = await getStoredNumber();
      setNumber(num);
      const mode = await getVaultMode();
      setCurrentMode(mode);
    };
    loadData();
  }, []);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    // Could add a toast here
  };

  const handleLogout = async () => {
    if (
      window.confirm(
        'Are you sure you want to logout? This will clear your vault from this device.',
      )
    ) {
      await clearVault();
      cleanupNostrService();
      navigate('/entry');
    }
  };

  if (view === 'main') {
    return (
      <div className="flex flex-col h-full bg-base-100 animate-in fade-in slide-in-from-right-4 duration-200">
        <div className="flex items-center gap-2 p-4 border-b border-base-200 bg-base-100 sticky top-0 z-10">
          <button
            className="btn btn-ghost btn-sm -ml-2"
            onClick={() => navigate('/')}
          >
            <IoChevronBack className="h-5 w-5" />
            Home
          </button>
          <h2 className="text-lg font-semibold">Settings</h2>
        </div>

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

        <div className="flex-1 overflow-y-auto p-4">
          <div className="w-full max-w-xl mx-auto space-y-4">
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
                    <div className="text-xs text-base-content/60">
                      Theme, colors
                    </div>
                  </div>
                </div>
                <IoChevronForward className="text-base-content/30" />
              </button>

              <button
                className="w-full flex items-center justify-between p-4 hover:bg-base-200/50 transition-colors border-b border-base-200 last:border-0"
                onClick={() => setView('communication')}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                    <IoGlobeOutline className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Communication</div>
                    <div className="text-xs text-base-content/60">
                      Nostr, TURN servers
                    </div>
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
                    <div className="text-xs text-base-content/60">
                      Vault mode, password
                    </div>
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
                    <div className="text-xs text-base-content/60">
                      View, export keys
                    </div>
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
              Bloop v{import.meta.env.PACKAGE_VERSION}
            </div>
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
        <h2 className="text-lg font-semibold capitalize">
          {view === 'keys' ? 'Key Management' : view}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {view === 'display' && <DisplaySettings />}
        {view === 'security' && (
          <SecuritySettings
            currentMode={currentMode}
            setCurrentMode={setCurrentMode}
          />
        )}
        {view === 'keys' && (
          <KeySettings number={number} currentMode={currentMode} />
        )}
        {view === 'communication' && <CommunicationSettings />}
      </div>
    </div>
  );
}

function CommunicationSettings() {
  const [settings, setSettings] = useState(null);
  const [newRelay, setNewRelay] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const handleSave = async (newSettings) => {
    try {
      setSettings(newSettings);
      await saveSettings(newSettings);
    } catch (e) {
      console.error('Failed to save settings', e);
      alert('Failed to save settings');
    }
  };

  const addRelay = () => {
    if (!newRelay) return;
    if (settings.nostrRelays.includes(newRelay)) return;
    handleSave({
      ...settings,
      nostrRelays: [...settings.nostrRelays, newRelay],
    });
    setNewRelay('');
  };

  const removeRelay = (relay) => {
    handleSave({
      ...settings,
      nostrRelays: settings.nostrRelays.filter((r) => r !== relay),
    });
  };

  const updateTurnServer = (field, value) => {
    handleSave({
      ...settings,
      turnServer: {
        ...settings.turnServer,
        [field]: value,
      },
    });
  };

  if (!settings)
    return <div className="p-4 text-center">Loading settings...</div>;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Nostr Relays */}
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div>
            <div className="font-semibold">Nostr Relays</div>
            <div className="text-sm text-base-content/60">
              Servers used for signaling calls.
            </div>
          </div>

          <div className="space-y-2">
            {settings.nostrRelays.map((relay) => (
              <div
                key={relay}
                className="flex items-center justify-between p-2 bg-base-200/50 rounded-lg text-sm"
              >
                <span className="truncate flex-1 mr-2">{relay}</span>
                <button
                  onClick={() => removeRelay(relay)}
                  className="btn btn-ghost btn-xs text-error"
                >
                  <IoTrash />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="wss://relay.example.com"
              className="input input-bordered input-sm flex-1"
              value={newRelay}
              onChange={(e) => setNewRelay(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRelay()}
            />
            <button className="btn btn-sm btn-primary" onClick={addRelay}>
              <IoAdd />
            </button>
          </div>
        </div>
      </div>

      {/* TURN Server */}
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">TURN Server</div>
              <div className="text-sm text-base-content/60">
                Required for some restricted networks.
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={settings.turnServer.enabled}
              onChange={(e) => updateTurnServer('enabled', e.target.checked)}
            />
          </div>

          {settings.turnServer.enabled && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">TURN URL</span>
                </label>
                <input
                  type="text"
                  placeholder="turn:your-server.com:3478"
                  className="input input-bordered w-full"
                  value={settings.turnServer.urls}
                  onChange={(e) => updateTurnServer('urls', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Username</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={settings.turnServer.username}
                    onChange={(e) =>
                      updateTurnServer('username', e.target.value)
                    }
                  />
                </div>
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Password</span>
                  </label>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    value={settings.turnServer.credential}
                    onChange={(e) =>
                      updateTurnServer('credential', e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DisplaySettings() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('theme') || 'system',
  );

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
    <div className="space-y-6 max-w-xl mx-auto">
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
              {theme === 'light' && (
                <div className="h-2 w-2 rounded-full bg-primary"></div>
              )}
            </button>
            <button
              className={`flex items-center justify-between p-3 rounded-xl border ${theme === 'dark' ? 'border-primary bg-primary/5' : 'border-base-200'}`}
              onClick={() => setTheme('dark')}
            >
              <div className="flex items-center gap-3">
                <IoMoonOutline className="h-5 w-5" />
                <span>Dark</span>
              </div>
              {theme === 'dark' && (
                <div className="h-2 w-2 rounded-full bg-primary"></div>
              )}
            </button>
            <button
              className={`flex items-center justify-between p-3 rounded-xl border ${theme === 'system' ? 'border-primary bg-primary/5' : 'border-base-200'}`}
              onClick={() => setTheme('system')}
            >
              <div className="flex items-center gap-3">
                <IoColorPaletteOutline className="h-5 w-5" />
                <span>System Default</span>
              </div>
              {theme === 'system' && (
                <div className="h-2 w-2 rounded-full bg-primary"></div>
              )}
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
        if (!newPassword) throw new Error('Password required');
        if (newPassword !== confirmPassword)
          throw new Error('Passwords do not match');
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
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Security Mode</div>
              <div className="text-sm text-base-content/60">
                Current:{' '}
                <span className="capitalize font-medium">{currentMode}</span>
              </div>
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
                Switching to{' '}
                <span className="font-semibold uppercase">
                  {currentMode === 'silent' ? 'password' : 'silent'}
                </span>{' '}
                mode.
              </div>

              {currentMode === 'silent' && (
                <div className="grid gap-2">
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New Password"
                  />
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm Password"
                  />
                </div>
              )}

              {currentMode === 'password' && (
                <div className="alert alert-warning text-sm py-2">
                  Removing password protection allows anyone with access to this
                  device to open your vault.
                </div>
              )}

              <button
                className="btn btn-primary w-full"
                onClick={handleSwitchMode}
              >
                Confirm Switch
              </button>
              {switchError && (
                <div className="text-error text-sm text-center">
                  {switchError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 text-xs text-base-content/50">
        Silent mode stores keys locally without a password. Password mode
        encrypts your keys with a password you must enter on startup.
      </div>
    </div>
  );
}

function KeySettings({ number, currentMode }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportPasswordEnabled, setExportPasswordEnabled] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [confirmExportPassword, setConfirmExportPassword] = useState('');
  const [exportContacts, setExportContacts] = useState(false);
  const [exportHistory, setExportHistory] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [exportError, setExportError] = useState('');

  const handleExportFile = async () => {
    setExportError('');
    if (currentMode === 'silent' && exportPasswordEnabled) {
      if (!exportPassword) {
        setExportError('Password is required');
        return;
      }
      if (exportPassword !== confirmExportPassword) {
        setExportError('Passwords do not match');
        return;
      }
    }

    setProcessing(true);
    try {
      const options = {
        oneTimePassword: exportPasswordEnabled ? exportPassword : null,
        includeContacts: exportContacts,
        includeHistory: exportHistory,
      };

      const { filename, data } = await createVaultExport(options);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || `${number || 'bloop'}.bloop`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setExportPassword('');
      setConfirmExportPassword('');
      setExportPasswordEnabled(false);
      setIsExporting(false);
    } catch (e) {
      setExportError(e.message || 'Export failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-4 gap-4">
          <div>
            <div className="font-semibold">Your Identity</div>
            <div className="text-sm text-base-content/60">
              Manage your secure identity and backups.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-primary flex-1"
              onClick={() => setIsExporting(true)}
            >
              Export Backup
            </button>
          </div>

          {isExporting && (
            <div className="modal modal-open">
              <div className="modal-box">
                <h3 className="font-bold text-lg">Export Backup</h3>
                <div className="py-4 space-y-4">
                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-4">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={exportContacts}
                        onChange={(e) => setExportContacts(e.target.checked)}
                      />
                      <span className="label-text">Include Contacts</span>
                    </label>
                  </div>
                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-4">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={exportHistory}
                        onChange={(e) => setExportHistory(e.target.checked)}
                      />
                      <span className="label-text">Include Call History</span>
                    </label>
                  </div>

                  {currentMode === 'silent' && (
                    <div className="border-t border-base-200 pt-4 mt-4">
                      <div className="form-control">
                        <label className="label cursor-pointer justify-start gap-4">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={exportPasswordEnabled}
                            onChange={(e) =>
                              setExportPasswordEnabled(e.target.checked)
                            }
                          />
                          <span className="label-text font-medium">
                            Encrypt with one-time password
                          </span>
                        </label>
                      </div>
                      {exportPasswordEnabled && (
                        <div className="space-y-2 mt-2 pl-8">
                          <input
                            type="password"
                            placeholder="Password"
                            className="input input-bordered w-full input-sm"
                            value={exportPassword}
                            onChange={(e) => setExportPassword(e.target.value)}
                          />
                          <input
                            type="password"
                            placeholder="Confirm Password"
                            className="input input-bordered w-full input-sm"
                            value={confirmExportPassword}
                            onChange={(e) =>
                              setConfirmExportPassword(e.target.value)
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {currentMode === 'password' && (
                    <div className="alert alert-info text-xs">
                      Your export will be encrypted with your current vault
                      password.
                    </div>
                  )}
                </div>

                {exportError && (
                  <div className="alert alert-error text-sm mt-2">
                    {exportError}
                  </div>
                )}

                <div className="modal-action">
                  <button
                    className="btn"
                    onClick={() => setIsExporting(false)}
                    disabled={processing}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleExportFile}
                    disabled={processing}
                  >
                    {processing ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      'Export'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
