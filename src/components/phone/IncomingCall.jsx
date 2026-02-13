import { useEffect, useState } from 'react';
import { useCallStore } from '../../store/callStore';
import { getContactByNumber, getContactDisplayName } from '../../services/contactsManager';
import { FaPhone, FaPhoneSlash, FaUser } from "react-icons/fa6";

export default function IncomingCall() {
  const callerNumber = useCallStore(state => state.callerNumber);
  const answerCall = useCallStore(state => state.answerCall);
  const rejectCall = useCallStore(state => state.rejectCall);
  const ignoreCall = useCallStore(state => state.ignoreCall);
  const callState = useCallStore(state => state.callState);
  const [contactName, setContactName] = useState(null);

  useEffect(() => {
    if (callState !== 'incoming') return;
    const timeout = setTimeout(() => {
      ignoreCall();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [callState, ignoreCall]);

  useEffect(() => {
    let active = true;
    if (!callerNumber) {
      setContactName(null);
      return;
    }
    getContactByNumber(callerNumber)
      .then((contact) => {
        if (active) setContactName(contact ? getContactDisplayName(contact) : null);
      })
      .catch(() => {
        if (active) setContactName(null);
      });
    return () => {
      active = false;
    };
  }, [callerNumber]);

  return (
    <div className="fixed inset-0 z-50 bg-linear-to-b from-base-300 to-base-100 text-base-content flex flex-col items-center justify-between py-16 px-6">
      <div className="flex-1 flex flex-col items-center justify-center w-full text-center">
        <div className="avatar placeholder mb-8">
          <div className="bg-base-200 text-base-content rounded-full w-32 h-32 flex items-center justify-center shadow-xl">
            <FaUser className="w-16 h-16 opacity-60" />
          </div>
        </div>
        <div className="text-xs font-semibold tracking-widest text-base-content/50 uppercase">Incoming Call</div>
        <div className="text-4xl font-semibold mt-3">{contactName || callerNumber}</div>
        {contactName && <div className="text-sm text-base-content/60 font-mono mt-1">{callerNumber}</div>}
      </div>

      <div className="flex w-full max-w-sm justify-between pb-8">
        <div className="flex flex-col items-center gap-2">
          <button
            className="btn btn-error btn-circle btn-lg w-20 h-20 shadow-xl"
            onClick={rejectCall}
          >
            <FaPhoneSlash className="w-8 h-8 text-white" />
          </button>
          <span className="text-sm font-medium text-base-content/70">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            className="btn btn-success btn-circle btn-lg w-20 h-20 shadow-xl"
            onClick={answerCall}
          >
            <FaPhone className="w-8 h-8 text-white" />
          </button>
          <span className="text-sm font-medium text-base-content/70">Accept</span>
        </div>
      </div>
    </div>
  );
}
