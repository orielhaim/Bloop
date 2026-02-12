import { useState, useTransition } from 'react';
import { issueNumber, activateNumber } from '../services/api';
import { generateKeys, storeKeys } from '../services/crypto';
import { useNavigate } from 'react-router-dom';

export default function Registration() {
  const [code, setCode] = useState('');
  const [issuedInfo, setIssuedInfo] = useState(null);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const navigate = useNavigate();

  const handleIssue = async () => {
    setError(null);
    try {
      const data = await issueNumber();
      setIssuedInfo(data);
      setCode(data.activationCode);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleActivate = () => {
    startTransition(async () => {
      setError(null);
      try {
        // 1. Generate keys
        const keys = await generateKeys();
        
        // 2. Activate
        const res = await activateNumber(code, keys.signing.public, keys.encryption.public);
        
        // 3. Store keys
        storeKeys(keys, res.number);
        
        // 4. Redirect
        navigate('/home');
      } catch (e) {
        setError(e.message);
      }
    });
  };

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-6">Registration</h1>
      
      <div className="card bg-base-200 shadow-xl mb-6">
        <div className="card-body">
          <h2 className="card-title">1. Get Activation Code</h2>
          <p className="text-sm opacity-70">Simulate going to a store and buying a SIM card.</p>
          <button className="btn btn-primary" onClick={handleIssue}>
            Issue New Number
          </button>
          
          {issuedInfo && (
            <div className="mt-4 p-4 bg-base-300 rounded-lg">
              <p><strong>Number:</strong> {issuedInfo.number}</p>
              <p className="break-all"><strong>Code:</strong> {issuedInfo.activationCode}</p>
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">2. Activate SIM</h2>
          <p className="text-sm opacity-70">Enter code to generate keys and register.</p>
          
          <input 
            type="text" 
            placeholder="Activation Code" 
            className="input input-bordered w-full"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          
          <button 
            className="btn btn-success mt-4" 
            onClick={handleActivate}
            disabled={isPending || !code}
          >
            {isPending ? <span className="loading loading-spinner"></span> : 'Activate'}
          </button>
          
          {error && <div className="alert alert-error mt-4">{error}</div>}
        </div>
      </div>
    </div>
  );
}
