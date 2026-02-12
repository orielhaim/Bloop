import { useEffect, useState } from 'react';
import { getStoredNumber, getStoredKeys, getVaultMode } from '../services/crypto';
import { useNavigate } from 'react-router-dom';
import { getKeys as fetchKeys } from '../services/api';
import { useCallStore } from '../store/callStore';
import { initNostrService, cleanupNostrService } from '../services/nostr';
import { IoKeypad, IoSettingsSharp } from "react-icons/io5";

import Dialer from '../components/phone/Dialer';
import IncomingCall from '../components/phone/IncomingCall';
import InCall from '../components/phone/InCall';
import Settings from '../components/phone/Settings';

export default function Home() {
  const [number, setNumber] = useState('');
  const [myKeys, setMyKeys] = useState(null);
  const [serverKeys, setServerKeys] = useState(null);
  const [currentMode, setCurrentMode] = useState('');
  const [activeTab, setActiveTab] = useState('dialer'); // 'dialer' | 'settings'
  
  const callState = useCallStore(state => state.callState);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const num = await getStoredNumber();
      if (!num) {
        navigate('/');
        return;
      }
      setNumber(num);
      
      const keys = await getStoredKeys();
      setMyKeys(keys);
      
      const mode = await getVaultMode();
      setCurrentMode(mode);

      fetchKeys(num).then(setServerKeys).catch(console.error);
    } catch (e) {
      console.error(e);
      navigate('/');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (number && myKeys) {
      initNostrService(number, myKeys);
    }
    return () => cleanupNostrService();
  }, [number, myKeys]);

  // Full Screen Call Overlays
  if (callState === 'incoming') {
    return <IncomingCall />;
  }

  if (callState === 'calling' || callState === 'in-call') {
    return <InCall />;
  }

  return (
    <div className="flex flex-col h-screen bg-base-100 overflow-hidden relative">
      
      {/* Desktop Header */}
      <div className="hidden md:flex justify-between items-center p-4 bg-base-200 border-b border-base-300 shadow-sm">
        <h1 className="text-xl font-bold">P2P Phone</h1>
        <div className="flex items-center gap-4">
          <span className="badge badge-lg badge-outline font-mono">{number}</span>
          <button 
            className={`btn btn-sm ${activeTab === 'settings' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(activeTab === 'settings' ? 'dialer' : 'settings')}
          >
            {activeTab === 'settings' ? 'Back to Dialer' : 'Settings'}
          </button>
        </div>
      </div>

      {/* Mobile Header (User number in top corner) */}
      <div className="md:hidden absolute top-4 right-4 z-10">
        <div className="badge badge-neutral shadow-sm opacity-90 text-xs font-mono py-3">
          {number}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative bg-base-100">
        {activeTab === 'dialer' && (
          <div className="h-full flex flex-col justify-center items-center p-4">
            <Dialer />
          </div>
        )}
        
        {activeTab === 'settings' && (
           <Settings 
             currentMode={currentMode} 
             setCurrentMode={setCurrentMode}
             myKeys={myKeys}
             serverKeys={serverKeys}
             number={number}
           />
        )}
      </div>

      <div className="md:hidden">
        <div className="mx-4 mb-4 rounded-3xl bg-base-100/95 backdrop-blur-xl border border-base-200/80 pb-safe shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] relative z-20">
          <div className="grid grid-cols-2 items-center gap-2 p-2">
            <button 
              className={`group flex items-center justify-center gap-3 rounded-2xl px-4 py-3 transition-all ${activeTab === 'dialer' ? 'bg-primary text-primary-content shadow-[0_10px_18px_-12px_rgba(0,0,0,0.7)]' : 'bg-base-200/60 text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
              onClick={() => setActiveTab('dialer')}
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${activeTab === 'dialer' ? 'bg-primary-content/15' : 'bg-base-100/70'}`}>
                <IoKeypad className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">Keypad</span>
            </button>
            
            <button 
              className={`group flex items-center justify-center gap-3 rounded-2xl px-4 py-3 transition-all ${activeTab === 'settings' ? 'bg-primary text-primary-content shadow-[0_10px_18px_-12px_rgba(0,0,0,0.7)]' : 'bg-base-200/60 text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
              onClick={() => setActiveTab('settings')}
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${activeTab === 'settings' ? 'bg-primary-content/15' : 'bg-base-100/70'}`}>
                <IoSettingsSharp className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
