import { useCallStore } from '../../store/callStore';
import { FaPhone, FaPhoneSlash, FaUser } from "react-icons/fa6";

export default function IncomingCall() {
  const callerNumber = useCallStore(state => state.callerNumber);
  const answerCall = useCallStore(state => state.answerCall);
  const rejectCall = useCallStore(state => state.rejectCall);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 text-white flex flex-col items-center justify-between py-20 px-8 animate-fade-in">
      
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="flex flex-col items-center gap-4">
           <div className="avatar placeholder mb-8">
              <div className="bg-neutral-focus text-neutral-content rounded-full w-32 h-32 flex items-center justify-center">
                <FaUser className="w-16 h-16 opacity-50" />
              </div>
           </div>
           
           <h2 className="text-xl opacity-80 font-light tracking-wide">Incoming Call</h2>
           <h1 className="text-4xl font-bold tracking-wider">{callerNumber}</h1>
        </div>
      </div>

      <div className="flex w-full justify-between items-center px-8 pb-12 max-w-sm">
        <div className="flex flex-col items-center gap-2">
            <button 
                className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-2xl"
                onClick={rejectCall}
            >
                <FaPhoneSlash className="w-8 h-8 text-white" />
            </button>
            <span className="text-sm font-medium opacity-80">Decline</span>
        </div>
        
        <div className="flex flex-col items-center gap-2">
            <button 
                className="btn btn-success btn-circle btn-lg w-20 h-20 shadow-2xl animate-bounce"
                onClick={answerCall}
            >
                <FaPhone className="w-8 h-8 text-white" />
            </button>
            <span className="text-sm font-medium opacity-80">Accept</span>
        </div>
      </div>
    </div>
  );
}
