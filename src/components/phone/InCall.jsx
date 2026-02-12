import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../../store/callStore';
import { startCallSession } from '../../services/callService';
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash } from "react-icons/fa6";
import { IoKeypad } from "react-icons/io5";

export default function InCall() {
  const { callRoom, callPassword, callState, targetNumber, callerNumber } = useCallStore();
  const hangUp = useCallStore(state => state.hangUp);

  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Connecting...');
  const [isMuted, setIsMuted] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  
  const localStreamRef = useRef(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const peerName = targetNumber || callerNumber;
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
    <div className="fixed inset-0 z-50 bg-linear-to-b from-base-100 to-base-200 flex flex-col items-center justify-between py-12 px-8">
      
      {/* Hidden Audio Elements */}
      <audio ref={localAudioRef} muted autoPlay />
      <audio ref={remoteAudioRef} autoPlay />

      {/* Header Info */}
      <div className="flex-1 flex flex-col items-center justify-start pt-12 w-full">
         <div className="flex flex-col items-center gap-4">
           <div className="avatar placeholder">
              <div className="bg-neutral-focus text-neutral-content rounded-full w-24 h-24 flex items-center justify-center shadow-lg">
                <span className="text-3xl font-bold">{peerName?.[0] || '#'}</span>
              </div>
           </div>
           
           <h1 className="text-4xl font-bold tracking-wider">{peerName}</h1>
           <p className="text-lg opacity-70 font-mono">
             {isConnected ? formatTime(duration) : (callState === 'calling' ? 'Calling...' : status)}
           </p>
         </div>

         {/* Optional Keypad Overlay */}
         {showKeypad && (
            <div className="mt-8 grid grid-cols-3 gap-4 animate-fade-in bg-base-100 p-4 rounded-3xl shadow-2xl z-10 absolute bottom-32">
              {keys.map(key => (
                <button 
                  key={key} 
                  className="btn btn-circle btn-lg bg-base-200 border-none text-2xl font-medium hover:bg-base-300"
                >
                  {key}
                </button>
              ))}
              <div className="col-span-3 flex justify-center mt-2">
                 <button className="btn btn-ghost btn-sm" onClick={() => setShowKeypad(false)}>Hide</button>
              </div>
            </div>
         )}
      </div>

      {/* Controls */}
      <div className="w-full max-w-sm mb-12">
        {isConnected ? (
           <div className="grid grid-cols-3 gap-8 items-center">
              {/* Mute Button */}
              <div className="flex flex-col items-center gap-2">
                <button 
                  className={`btn btn-circle btn-lg w-16 h-16 shadow-lg border-none ${isMuted ? 'bg-white text-black hover:bg-gray-200' : 'bg-base-300 text-base-content hover:bg-base-content/20'}`}
                  onClick={toggleMute}
                >
                  {isMuted ? <FaMicrophoneSlash className="w-6 h-6" /> : <FaMicrophone className="w-6 h-6" />}
                </button>
                <span className="text-xs opacity-70 font-medium">Mute</span>
              </div>

              {/* Hangup Button */}
              <div className="flex flex-col items-center gap-2">
                 <button 
                  className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-xl border-4 border-base-100 scale-110 hover:scale-125 transition-transform"
                  onClick={hangUp}
                >
                   <FaPhoneSlash className="w-8 h-8 text-white" />
                </button>
              </div>

              {/* Keypad Toggle */}
              <div className="flex flex-col items-center gap-2">
                 <button 
                  className={`btn btn-circle btn-lg w-16 h-16 shadow-lg border-none ${showKeypad ? 'bg-white text-black hover:bg-gray-200' : 'bg-base-300 text-base-content hover:bg-base-content/20'}`}
                  onClick={() => setShowKeypad(!showKeypad)}
                >
                   <IoKeypad className="w-6 h-6" />
                </button>
                <span className="text-xs opacity-70 font-medium">Keypad</span>
              </div>
           </div>
        ) : (
           <div className="flex justify-center items-center">
              {/* Centered Hangup Button when not connected */}
              <div className="flex flex-col items-center gap-2">
                 <button 
                  className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-xl border-4 border-base-100 hover:scale-110 transition-transform"
                  onClick={hangUp}
                >
                   <FaPhoneSlash className="w-8 h-8 text-white" />
                </button>
                 <span className="text-xs opacity-70 font-medium">End Call</span>
              </div>
           </div>
        )}
      </div>

    </div>
  );
}
