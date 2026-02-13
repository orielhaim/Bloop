import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../../store/callStore';
import { startCallSession } from '../../services/callService';
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash } from "react-icons/fa6";
import { IoKeypad } from "react-icons/io5";
import { getContactByNumber, getContactDisplayName } from '../../services/contactsManager';

export default function InCall() {
  const { callRoom, callPassword, callState, targetNumber, callerNumber } = useCallStore();
  const hangUp = useCallStore(state => state.hangUp);

  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Connecting...');
  const [isMuted, setIsMuted] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [contactName, setContactName] = useState(null);
  
  const localStreamRef = useRef(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const peerName = contactName || targetNumber || callerNumber;
  const isConnected = status === 'Connected';

  useEffect(() => {
    let timer;
    if (isConnected) {
      timer = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [isConnected]);

  useEffect(() => {
    if (!callRoom || !callPassword) return;

    const handleStatusChange = (newStatus) => {
      setStatus(newStatus);
    };

    const handleRemoteStream = (stream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(e => console.error("Auto-play failed", e));
      }
    };

    startCallSession(callRoom, callPassword, handleStatusChange, handleRemoteStream)
      .then(localStream => {
        localStreamRef.current = localStream;
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = localStream;
        }
      })
      .catch(err => {
        console.error("Failed to start call session", err);
      });
  }, [callRoom, callPassword]);

  useEffect(() => {
    let active = true;
    const number = targetNumber || callerNumber;
    if (!number) {
      setContactName(null);
      return;
    }
    getContactByNumber(number)
      .then((contact) => {
        if (active) setContactName(contact ? getContactDisplayName(contact) : null);
      })
      .catch(() => {
        if (active) setContactName(null);
      });
    return () => {
      active = false;
    };
  }, [targetNumber, callerNumber]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div className="fixed inset-0 z-50 bg-linear-to-b from-base-200 to-base-100 flex flex-col items-center justify-between py-12 px-6">
      <audio ref={localAudioRef} muted autoPlay />
      <audio ref={remoteAudioRef} autoPlay />

      <div className="flex-1 flex flex-col items-center justify-start pt-10 w-full text-center">
        <div className="avatar placeholder">
          <div className="bg-base-200 text-base-content rounded-full w-24 h-24 flex items-center justify-center shadow-lg">
            <span className="text-3xl font-semibold">{peerName?.[0] || '#'}</span>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <div className="text-3xl font-semibold">{peerName}</div>
          {contactName && <div className="text-xs text-base-content/60 font-mono">{targetNumber || callerNumber}</div>}
          <div className="text-sm text-base-content/70 font-mono">
            {isConnected ? formatTime(duration) : (callState === 'calling' ? 'Calling...' : status)}
          </div>
        </div>
      </div>

      {showKeypad && (
        <div className="grid grid-cols-3 gap-3 bg-base-100 p-4 rounded-3xl shadow-2xl absolute bottom-32">
          {keys.map(key => (
            <button
              key={key}
              className="btn btn-circle btn-lg bg-base-200 border-none text-2xl font-medium hover:bg-base-300"
            >
              {key}
            </button>
          ))}
          <div className="col-span-3 flex justify-center">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowKeypad(false)}>Hide</button>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm pb-10">
        {isConnected ? (
          <div className="grid grid-cols-3 gap-6 items-center">
            <div className="flex flex-col items-center gap-2">
              <button
                className={`btn btn-circle btn-lg w-16 h-16 shadow-lg border-none ${isMuted ? 'bg-base-100 text-base-content' : 'bg-base-200 text-base-content'}`}
                onClick={toggleMute}
              >
                {isMuted ? <FaMicrophoneSlash className="w-6 h-6" /> : <FaMicrophone className="w-6 h-6" />}
              </button>
              <span className="text-xs text-base-content/70 font-medium">Mute</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-xl"
                onClick={hangUp}
              >
                <FaPhoneSlash className="w-8 h-8 text-white" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                className={`btn btn-circle btn-lg w-16 h-16 shadow-lg border-none ${showKeypad ? 'bg-base-100 text-base-content' : 'bg-base-200 text-base-content'}`}
                onClick={() => setShowKeypad(!showKeypad)}
              >
                <IoKeypad className="w-6 h-6" />
              </button>
              <span className="text-xs text-base-content/70 font-medium">Keypad</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center">
            <div className="flex flex-col items-center gap-2">
              <button
                className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-xl"
                onClick={hangUp}
              >
                <FaPhoneSlash className="w-8 h-8 text-white" />
              </button>
              <span className="text-xs text-base-content/70 font-medium">End Call</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
