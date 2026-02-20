import { useEffect, useState } from 'react';
import { getStoredNumber, getStoredKeys } from '../services/crypto';
import { useNavigate } from 'react-router-dom';
import { useCallStore } from '../store/callStore';
import { initNostrService, cleanupNostrService } from '../services/nostr';
import { IoKeypad, IoSettingsSharp, IoTimeOutline, IoPeopleOutline } from "react-icons/io5";

import Dialer from '../components/phone/Dialer';
import IncomingCall from '../components/phone/IncomingCall';
import InCall from '../components/phone/InCall';
import CallHistory from './CallHistory';
import Contacts from './Contacts';

export default function Home() {
  const [number, setNumber] = useState('');
  const [myKeys, setMyKeys] = useState(null);
  const [activeTab, setActiveTab] = useState('dialer'); // 'dialer' | 'history' | 'contacts'
  const [rightPanelTab, setRightPanelTab] = useState('history'); // 'history' | 'contacts'
  const [focusContactNumber, setFocusContactNumber] = useState(null);
  
  const callState = useCallStore(state => state.callState);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const num = await getStoredNumber();
      if (!num) {
        navigate('/entry');
        return;
      }
      setNumber(num);
      
      const keys = await getStoredKeys();
      setMyKeys(keys);
    } catch (e) {
      console.error(e);
      navigate('/entry');
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

  const handleViewContact = (number) => {
    setFocusContactNumber(number);
    setRightPanelTab('contacts');
    if (!window.matchMedia('(min-width: 768px)').matches) {
      setActiveTab('contacts');
    }
  };

  return (
    <div className="h-dvh bg-base-100 flex flex-col overflow-hidden relative">
      <div className="hidden md:flex items-center justify-between px-6 py-4 border-b border-base-200 bg-base-200/60 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <img src="./icon.png" alt="Bloop" className="h-9 w-9 rounded-2xl" loading="lazy" />
          <div>
            <div className="text-lg font-semibold">Bloop</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-outline font-mono">{number}</span>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate('/settings')}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="md:hidden px-4 pt-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <img src="./icon.png" alt="Bloop" className="h-9 w-9 rounded-2xl" loading="lazy" />
          <div>
            <div className="text-base font-semibold">Bloop</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-outline font-mono text-xs">{number}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/settings')}>
            <IoSettingsSharp className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative bg-base-100">
          <div className="h-full flex flex-col md:flex-row overflow-hidden">
            <div className={`flex-1 flex flex-col justify-center items-center p-4 pb-24 md:p-4 overflow-y-auto ${activeTab !== 'dialer' ? 'hidden md:flex' : ''}`}>
              <Dialer />
            </div>
            <div className="hidden md:flex md:w-[360px] lg:w-[420px] border-l border-base-200 bg-base-100 flex-col h-full overflow-hidden">
              <div className="p-3 border-b border-base-200 flex items-center justify-between shrink-0">
                <div className="text-sm font-semibold tracking-widest text-base-content/50 uppercase">
                  Activity
                </div>
                <div className="join">
                  <button
                    className={`btn btn-xs join-item ${rightPanelTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setRightPanelTab('history')}
                  >
                    History
                  </button>
                  <button
                    className={`btn btn-xs join-item ${rightPanelTab === 'contacts' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setRightPanelTab('contacts')}
                  >
                    Contacts
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                {rightPanelTab === 'history' ? (
                  <CallHistory compact onViewContact={handleViewContact} />
                ) : (
                  <Contacts compact focusNumber={focusContactNumber} />
                )}
              </div>
            </div>
            <div className={`md:hidden flex-1 overflow-hidden ${activeTab === 'history' ? 'flex' : 'hidden'}`}>
              <CallHistory onViewContact={handleViewContact} />
            </div>
            <div className={`md:hidden flex-1 overflow-hidden ${activeTab === 'contacts' ? 'flex' : 'hidden'}`}>
              <Contacts focusNumber={focusContactNumber} />
            </div>
          </div>
      </div>

      <div className="md:hidden absolute bottom-0 left-0 right-0 pointer-events-none z-50">
        <div className="mx-4 mb-4 rounded-3xl bg-base-100/95 backdrop-blur-xl border border-base-200/80 pb-safe shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] relative pointer-events-auto">
          <div className="grid grid-cols-3 items-center gap-2 p-2">
            <button 
              className={`group flex items-center justify-center gap-3 rounded-2xl p-2 transition-all ${activeTab === 'dialer' ? 'bg-primary text-primary-content shadow-[0_10px_18px_-12px_rgba(0,0,0,0.7)]' : 'bg-base-200/60 text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
              onClick={() => setActiveTab('dialer')}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${activeTab === 'dialer' ? 'bg-primary-content/15' : 'bg-base-100/70'}`}>
                <IoKeypad className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">Keypad</span>
            </button>

            <button 
              className={`group flex items-center justify-center gap-3 rounded-2xl p-2 transition-all ${activeTab === 'history' ? 'bg-primary text-primary-content shadow-[0_10px_18px_-12px_rgba(0,0,0,0.7)]' : 'bg-base-200/60 text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
              onClick={() => setActiveTab('history')}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${activeTab === 'history' ? 'bg-primary-content/15' : 'bg-base-100/70'}`}>
                <IoTimeOutline className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">History</span>
            </button>
            
            <button 
              className={`group flex items-center justify-center gap-3 rounded-2xl p-2 transition-all ${activeTab === 'contacts' ? 'bg-primary text-primary-content shadow-[0_10px_18px_-12px_rgba(0,0,0,0.7)]' : 'bg-base-200/60 text-base-content/70 hover:bg-base-200 hover:text-base-content'}`}
              onClick={() => setActiveTab('contacts')}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${activeTab === 'contacts' ? 'bg-primary-content/15' : 'bg-base-100/70'}`}>
                <IoPeopleOutline className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">Contacts</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
