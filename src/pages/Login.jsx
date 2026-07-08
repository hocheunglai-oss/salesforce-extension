import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function Login() {
  const location = useLocation();
  const { isAuthenticated, login, isSupabaseConfigured: supabaseReady, authMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Login · Salesforce Analytics Hub';
  }, []);

  if (isAuthenticated) {
    const from = location.state?.from;
    const returnTo = from
      ? `${from.pathname || '/'}${from.search || ''}${from.hash || ''}`
      : '/';
    return <Navigate to={returnTo} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Salesforce Analytics Hub</p>
        </div>

        {!supabaseReady && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            Supabase is not configured yet. The app is currently running in local administrator mode.
          </div>
        )}

        {authMode === 'local' ? (
          <Navigate to="/" replace />
        ) : (
          <>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                autoComplete="email"
                required
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                autoComplete="current-password"
                required
              />
            </label>

            {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
