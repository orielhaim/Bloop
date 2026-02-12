import { useEffect, useState } from 'react';
import { getStoredNumber, clearKeys, getStoredKeys } from '../services/crypto';
import { useNavigate } from 'react-router-dom';
import { getKeys as fetchKeys } from '../services/api';

export default function Home() {
  const [number, setNumber] = useState('');
  const [myKeys, setMyKeys] = useState(null);
  const [serverKeys, setServerKeys] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const num = getStoredNumber();
    if (!num) {
      navigate('/register');
      return;
    }
    setNumber(num);
    setMyKeys(getStoredKeys());
    
    fetchKeys(num).then(setServerKeys).catch(console.error);
  }, [navigate]);

  const handleLogout = () => {
    clearKeys();
    navigate('/register');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">My Phone: {number}</h1>
        <button className="btn btn-outline btn-error" onClick={handleLogout}>
          Reset / Logout
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">My Local Keys (Private)</h2>
            <div className="mockup-code bg-base-300 text-xs">
              <pre><code>{JSON.stringify(myKeys, null, 2)}</code></pre>
            </div>
          </div>
        </div>

        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Server Public Keys</h2>
            <p className="text-sm opacity-70">Fetched from GET /keys/{number}</p>
            <div className="mockup-code bg-base-300 text-xs">
              <pre><code>{JSON.stringify(serverKeys, null, 2)}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
