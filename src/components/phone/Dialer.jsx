import { useState } from 'react';
import { useCallStore } from '../../store/callStore';
import { getKeys as fetchKeys } from '../../services/api';
import { sendCallSignal } from '../../services/nostr';
import { getStoredNumber, getStoredKeys } from '../../services/crypto';
import { FaPhone, FaDeleteLeft } from "react-icons/fa6";

export default function Dialer() {
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const startCalling = useCallStore(state => state.startCalling);

  const handleDigit = (digit) => {
    setTarget(prev => prev + digit);
  };

  const handleBackspace = () => {
    setTarget(prev => prev.slice(0, -1));
  };

  const handleCall = async () => {
    if (!target) return;
    setLoading(true);

    try {
      const targetKeys = await fetchKeys(target);
      if (!targetKeys) throw new Error("Number not found");

      const callRoom = crypto.randomUUID();
      const callPassword = crypto.randomUUID();

      const myNumber = await getStoredNumber();
      const myKeys = await getStoredKeys();

      await sendCallSignal(target, targetKeys, myNumber, myKeys, callRoom, callPassword);

      startCalling(target, callRoom, callPassword);
    } catch (e) {
      console.error(e);
      alert(e.message || "Call failed");
    } finally {
      setLoading(false);
    }
  };

  const keys = [
    { label: '1', sub: '' },
    { label: '2', sub: 'ABC' },
    { label: '3', sub: 'DEF' },
    { label: '4', sub: 'GHI' },
    { label: '5', sub: 'JKL' },
    { label: '6', sub: 'MNO' },
    { label: '7', sub: 'PQRS' },
    { label: '8', sub: 'TUV' },
    { label: '9', sub: 'WXYZ' },
    { label: '*', sub: '' },
    { label: '0', sub: '+' },
    { label: '#', sub: '' },
  ];

  return (
    <div className="flex flex-col h-full w-full max-w-sm mx-auto pb-8">

      <div className="flex-1 flex flex-col justify-end items-center mb-8 px-4">

        {target.length === 0 ? <span className="text-sm opacity-50 mt-2">Enter number</span> :
        <input
          type="text"
          readOnly
          value={target}
          className="bg-transparent text-center text-4xl font-light w-full focus:outline-none"
          placeholder=""
        />}
      </div>

      <div className="grid grid-cols-3 gap-4 px-8 mb-8">
        {keys.map((key) => (
          <button
            key={key.label}
            onClick={() => handleDigit(key.label)}
            className="btn btn-circle btn-lg h-20 w-20 flex flex-col items-center justify-center bg-base-200 border-none hover:bg-base-300 active:scale-95 transition-all"
          >
            <span className="text-2xl font-medium leading-none">{key.label}</span>
            {key.sub && <span className="text-[10px] opacity-50 font-bold tracking-widest">{key.sub}</span>}
          </button>
        ))}
      </div>

      <div className="flex justify-center items-center gap-8 px-8 h-20">
        <div className="w-16">
        </div>

        <button
          onClick={handleCall}
          disabled={loading || !target}
          className="btn btn-circle btn-success btn-lg h-20 w-20 shadow-lg hover:shadow-xl hover:scale-105 transition-all border-none"
        >
          {loading ? (
            <span className="loading loading-spinner"></span>
          ) : (
            <FaPhone className="w-8 h-8 text-white" />
          )}
        </button>

        <div className="w-18 flex justify-center">
          {target.length > 0 && (
            <button
              onClick={handleBackspace}
              className="btn btn-ghost btn-circle h-15 w-15"
            >
              <FaDeleteLeft className="w-8 h-8 opacity-70" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
