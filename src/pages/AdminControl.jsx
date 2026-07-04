import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save, ShieldCheck, UserPlus } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { APP_MODULES, FULL_ACCESS, USER_TYPES } from '@/lib/authModules';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';

const emptyForm = {
  id: null,
  email: '',
  full_name: '',
  user_type: 'viewer',
  active: true,
  password: '',
  permissions: {},
};

function defaultPermissionsForType(userType) {
  if (userType === 'administrator') return FULL_ACCESS;
  return {};
}

export default function AdminControl() {
  const { authMode, isSupabaseConfigured } = useAuth();
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedUser = useMemo(() => users.find((user) => user.id === form.id) || null, [users, form.id]);

  const load = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    const [usersRes, logsRes] = await Promise.all([
      appClient.functions.invoke('adminUsersList', {}),
      appClient.functions.invoke('adminAuditLogs', {}),
    ]);
    if (usersRes.data?.error) setError(usersRes.data.error);
    else setUsers(usersRes.data.users || []);
    if (!logsRes.data?.error) setAuditLogs(logsRes.data.logs || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [isSupabaseConfigured]);

  const selectUser = (user) => {
    setMessage('');
    setError('');
    setForm({
      id: user.id,
      email: user.email || '',
      full_name: user.full_name || '',
      user_type: user.user_type || 'viewer',
      active: user.active !== false,
      password: '',
      permissions: { ...(user.permissions || {}) },
    });
  };

  const newUser = () => {
    setMessage('');
    setError('');
    setForm(emptyForm);
  };

  const setUserType = (userType) => {
    setForm((prev) => ({
      ...prev,
      user_type: userType,
      permissions: userType === 'administrator' ? FULL_ACCESS : prev.permissions,
    }));
  };

  const toggleModule = (moduleId) => {
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions?.[moduleId],
      },
    }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    const payload = {
      id: form.id,
      email: form.email.trim().toLowerCase(),
      full_name: form.full_name.trim(),
      user_type: form.user_type,
      active: form.active,
      password: form.password,
      permissions: form.user_type === 'administrator' ? FULL_ACCESS : form.permissions,
    };
    const res = await appClient.functions.invoke('adminUserSave', payload);
    setSaving(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User saved.');
    setForm((prev) => ({ ...prev, id: res.data.user?.id || prev.id, password: '' }));
    await load();
  };

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="Admin Control"
        description="Create users, assign user type, and control access to each module."
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading || !isSupabaseConfigured}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        }
      />

      {!isSupabaseConfigured && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <div className="font-semibold">Supabase is not configured yet.</div>
          <div className="mt-1">
            Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel, then run the Supabase migration included in this repo.
            Until then, the app remains in local administrator mode and users cannot be persisted securely.
          </div>
        </div>
      )}

      {authMode === 'local' && isSupabaseConfigured && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          Local administrator mode is active. Sign in with Supabase to enforce production access control.
        </div>
      )}

      {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Users</h2>
            <button type="button" onClick={newUser} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-primary">
              <UserPlus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          {loading ? (
            <StateBlock icon={Loader2} title="Loading users..." description="Fetching access control users." />
          ) : users.length ? (
            <div className="max-h-[620px] divide-y divide-border overflow-auto rounded-lg border border-border">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => selectUser(user)}
                  className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-muted/30 ${selectedUser?.id === user.id ? 'bg-primary/10' : 'bg-background/40'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{user.full_name || user.email}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${user.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {user.active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</div>
                  <div className="mt-1 text-[11px] font-medium capitalize text-muted-foreground">{String(user.user_type || '').replaceAll('_', ' ')}</div>
                </button>
              ))}
            </div>
          ) : (
            <StateBlock title="No users found" description="Create the first administrator after Supabase is configured." />
          )}
        </div>

        <form onSubmit={save} className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-foreground">{form.id ? 'Edit User' : 'Create User'}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Only administrators can change these records.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
                disabled={Boolean(form.id)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full Name</span>
              <input
                value={form.full_name}
                onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">User Type</span>
              <select
                value={form.user_type}
                onChange={(event) => setUserType(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {USER_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{form.id ? 'New Password' : 'Password'}</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required={!form.id}
                minLength={8}
                placeholder={form.id ? 'Leave blank to keep current password' : ''}
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
              />
              Active user
            </label>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Module Access</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {APP_MODULES.map((module) => {
                const checked = form.user_type === 'administrator' || form.permissions?.[module.id] === true;
                return (
                  <label key={module.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{module.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={form.user_type === 'administrator'}
                      onChange={() => toggleModule(module.id)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving || !isSupabaseConfigured}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save User
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Audit Log</h2>
        {auditLogs.length ? (
          <div className="max-h-[300px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Time</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Action</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Target</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Actor</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-t border-border/50">
                    <td className="px-3 py-2 text-muted-foreground">{log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{log.action}</td>
                    <td className="px-3 py-2 text-muted-foreground">{log.target_email || log.target_user_id || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{log.actor_email || log.actor_user_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock title="No audit logs" description="Admin changes will appear here." />
        )}
      </div>
    </div>
  );
}
