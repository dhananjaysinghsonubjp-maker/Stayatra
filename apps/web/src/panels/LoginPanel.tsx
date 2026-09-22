import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';

type Mode = 'login' | 'signup' | 'pin';

export function LoginPanel() {
  const { setToken } = useAuth();
  const [mode, setMode] = useState<Mode>('signup');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [organizationName, setOrganizationName] = useState('Test Hotels Pvt Ltd');
  const [ownerName, setOwnerName] = useState('Asha Verma');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [pin, setPin] = useState('');
  const [deviceId, setDeviceId] = useState('simulator-device-1');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const result = await mutate<{ session: { token: string } }>('auth.signup', {
          organizationName,
          ownerName,
          email,
          password,
        });
        setToken(result.session.token);
      } else if (mode === 'login') {
        const result = await mutate<{ session: { token: string } }>('auth.login', { email, password });
        setToken(result.session.token);
      } else {
        const result = await mutate<{ session: { token: string } }>('auth.pinLogin', { shortCode, pin, deviceId });
        setToken(result.session.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h2>Hotel Platform Simulator</h2>
      <div className="tabs">
        <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
          Owner Signup
        </button>
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Owner Login
        </button>
        <button className={mode === 'pin' ? 'active' : ''} onClick={() => setMode('pin')}>
          Staff PIN Login
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <>
            <label>
              Organization name
              <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required />
            </label>
            <label>
              Owner name
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
            </label>
          </>
        )}
        {mode !== 'pin' && (
          <>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </label>
          </>
        )}
        {mode === 'pin' && (
          <>
            <label>
              Hotel ID (short code)
              <input value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} required />
            </label>
            <label>
              PIN
              <input value={pin} onChange={(e) => setPin(e.target.value)} required minLength={4} maxLength={6} />
            </label>
            <label>
              Device ID
              <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required />
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Log in with PIN'}
        </button>
      </form>
    </div>
  );
}
