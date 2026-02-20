import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../../store/callStore';
import { startCallSession, enableVideo, disableVideo } from '../../services/callService';
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash, FaVideo, FaVideoSlash } from "react-icons/fa6";
import { IoKeypad } from "react-icons/io5";
import { getContactByNumber, getContactDisplayName } from '../../services/contactsManager';

export default function InCall() {
  const { 
    callRoom, callPassword, callState, targetNumber, callerNumber,
    isLocalVideoEnabled, isRemoteVideoPresent, remoteVideoStream, localVideoTrack 
  } = useCallStore();
  const hangUp = useCallStore(state => state.hangUp);

  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Connecting...');
  const [isMuted, setIsMuted] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [contactName, setContactName] = useState(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  
  const localStreamRef = useRef(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const controlsTimeoutRef = useRef(null);

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
        if (remoteAudioRef.current.srcObject === stream) return;
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(e => {
          if (e.name !== 'AbortError') console.error("Auto-play failed", e);
        });
      }
    };

    startCallSession(callRoom, callPassword, handleStatusChange, handleRemoteStream)
      .then(localStream => {
        localStreamRef.current = localStream;
        if (localAudioRef.current) {
          if (localAudioRef.current.srcObject === localStream) return;
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

  useEffect(() => {
    if (remoteVideoRef.current && remoteVideoStream) {
      if (remoteVideoRef.current.srcObject === remoteVideoStream) return;
      remoteVideoRef.current.srcObject = remoteVideoStream;
      remoteVideoRef.current.play().catch(e => {
        if (e.name !== 'AbortError') console.error("Remote video play failed", e);
      });
    }
  }, [remoteVideoStream, isRemoteVideoPresent]);

  useEffect(() => {
    if (localVideoRef.current && localVideoTrack) {
      const currentStream = localVideoRef.current.srcObject;
      if (currentStream && currentStream.getVideoTracks()[0] === localVideoTrack) return;

      const stream = new MediaStream([localVideoTrack]);
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(e => {
        if (e.name !== 'AbortError') console.error("Local video play failed", e);
      });
    }
  }, [localVideoTrack, isLocalVideoEnabled]);

  useEffect(() => {
    if (!isRemoteVideoPresent) {
      setControlsVisible(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      return;
    }

    const showControls = () => {
      setControlsVisible(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    };

    window.addEventListener('mousemove', showControls);
    window.addEventListener('touchstart', showControls);
    
    // Initial timeout
    showControls();

    return () => {
      window.removeEventListener('mousemove', showControls);
      window.removeEventListener('touchstart', showControls);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isRemoteVideoPresent]);

  const toggleVideo = async () => {
    if (isLocalVideoEnabled) {
      disableVideo();
    } else {
      try {
        await enableVideo();
      } catch (err) {
        console.error("Failed to enable video", err);
        // Could add a toast here
      }
    }
  };

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
    <div className="fixed inset-0 z-50 bg-linear-to-b from-base-200 to-base-100 flex flex-col items-center justify-between overflow-hidden">
      <audio ref={localAudioRef} muted autoPlay />
      <audio ref={remoteAudioRef} autoPlay />

      {isRemoteVideoPresent && (
        <video 
          ref={remoteVideoRef} 
          className="absolute inset-0 w-full h-full object-cover z-0"
          autoPlay 
          playsInline
        />
      )}

      {!isRemoteVideoPresent && (
        <div className="flex-1 flex flex-col items-center justify-start pt-20 w-full text-center z-10">
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
      )}

      {/* Top Navbar for Video Mode */}
      <div 
        className={`z-20 w-full flex items-center justify-between px-6 pt-12 pb-6 fixed top-0 bg-linear-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          isRemoteVideoPresent 
            ? (controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none') 
            : 'hidden'
        }`}
      >
        <div className="flex flex-col">
            <span className="text-xl font-semibold text-white">{peerName}</span>
            <span className="text-xs text-white/70 font-mono">{targetNumber || callerNumber}</span>
        </div>
        <div className="text-sm font-mono bg-black/30 px-3 py-1 rounded-full text-white/90 backdrop-blur-sm">
            {formatTime(duration)}
        </div>
      </div>

      {/* Local Video PIP */}
      {isLocalVideoEnabled && (
        <div className={`absolute bottom-32 right-6 z-30 w-36 h-48 bg-black rounded-xl overflow-hidden shadow-2xl border border-white/20 transition-all duration-300 ${isRemoteVideoPresent ? '' : 'bottom-40'}`}>
           <video 
             ref={localVideoRef} 
             className="w-full h-full object-cover"
             autoPlay 
             muted 
             playsInline
           />
        </div>
      )}

      {/* Controls */}
      <div 
        className={`z-20 w-full flex flex-col items-center transition-opacity duration-300 ${
          isRemoteVideoPresent 
            ? `fixed bottom-0 pb-10 pt-20 bg-linear-to-t from-black/80 to-transparent ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
            : 'pb-10'
        }`}
      >
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

        <div className="w-full max-w-sm px-6">
            {isConnected ? (
            <div className="grid grid-cols-4 gap-4 items-center justify-items-center">
                <div className="flex flex-col items-center gap-2">
                    <button
                        className={`btn btn-circle btn-lg w-14 h-14 shadow-lg border-none ${isMuted ? 'bg-base-100 text-base-content' : 'bg-base-200 text-base-content'}`}
                        onClick={toggleMute}
                    >
                        {isMuted ? <FaMicrophoneSlash className="w-5 h-5" /> : <FaMicrophone className="w-5 h-5" />}
                    </button>
                    <span className={`text-xs font-medium ${isRemoteVideoPresent ? 'text-white/80' : 'text-base-content/70'}`}>Mute</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <button
                        className={`btn btn-circle btn-lg w-14 h-14 shadow-lg border-none ${isLocalVideoEnabled ? 'bg-base-100 text-base-content' : 'bg-base-200 text-base-content'}`}
                        onClick={toggleVideo}
                    >
                        {isLocalVideoEnabled ? <FaVideo className="w-5 h-5" /> : <FaVideoSlash className="w-5 h-5" />}
                    </button>
                    <span className={`text-xs font-medium ${isRemoteVideoPresent ? 'text-white/80' : 'text-base-content/70'}`}>Camera</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <button
                        className={`btn btn-circle btn-lg w-14 h-14 shadow-lg border-none ${showKeypad ? 'bg-base-100 text-base-content' : 'bg-base-200 text-base-content'}`}
                        onClick={() => setShowKeypad(!showKeypad)}
                    >
                        <IoKeypad className="w-5 h-5" />
                    </button>
                    <span className={`text-xs font-medium ${isRemoteVideoPresent ? 'text-white/80' : 'text-base-content/70'}`}>Keypad</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                    <button
                        className="btn btn-error btn-circle btn-lg w-16 h-16 shadow-xl"
                        onClick={hangUp}
                    >
                        <FaPhoneSlash className="w-6 h-6 text-white" />
                    </button>
                     <span className={`text-xs font-medium ${isRemoteVideoPresent ? 'text-white/80' : 'text-base-content/70'}`}>End</span>
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
                <span className={`text-xs font-medium ${isRemoteVideoPresent ? 'text-white/80' : 'text-base-content/70'}`}>End Call</span>
                </div>
            </div>
            )}
        </div>
      </div>
    </div>
  );
}
