import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserCog, UserPlus } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { APP_MODULES, FULL_ACCESS, USER_TYPES } from '@/lib/authModules';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';

const emptyUserForm = {
  id: null,
  email: '',
  full_name: '',
  user_type: 'viewer',
  active: true,
  password: '',
  use_type_defaults: true,
  permissions: {},
};

const emptyTypeForm = {
  id: null,
  label: '',
  description: '',
  sort_order: 100,
  is_system: false,
  permissions: { dashboard: true },
};

function normalizedPermissions(modules, permissions = {}) {
  return Object.fromEntries(modules.map((module) => [module.id, permissions?.[module.id] === true]));
}

function typeLabel(type) {
  return String(type?.label || type?.id || '').replaceAll('_', ' ');
}

function permissionSummary(modules, permissions = {}) {
  const count = modules.filter((module) => permissions?.[module.id] === true).length;
  if (count === modules.length) return 'All modules';
  if (count === 0) return 'No modules';
  return `${count} modules`;
}

export default function AdminControl() {
  const { authMode, isSupabaseConfigured, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState(APP_MODULES);
  const [userTypes, setUserTypes] = useState(USER_TYPES);
  const [typePermissions, setTypePermissions] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [loading, setLoading] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deletingType, setDeletingType] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const sortedModules = useMemo(
    () => modules.slice().sort((a, b) => Number(a.sortOrder || a.sort_order || 0) - Number(b.sortOrder || b.sort_order || 0)),
    [modules]
  );
  const selectedUser = useMemo(() => users.find((item) => item.id === userForm.id) || null, [users, userForm.id]);
  const selectedType = useMemo(() => userTypes.find((item) => item.id === typeForm.id) || null, [userTypes, typeForm.id]);
  const userTypeMap = useMemo(() => Object.fromEntries(userTypes.map((item) => [item.id, item])), [userTypes]);
  const selectedTypePermissions = useMemo(
    () => normalizedPermissions(sortedModules, typePermissions[userForm.user_type] || {}),
    [sortedModules, typePermissions, userForm.user_type]
  );
  const effectiveUserPermissions = userForm.user_type === 'administrator'
    ? FULL_ACCESS
    : userForm.use_type_defaults
      ? selectedTypePermissions
      : normalizedPermissions(sortedModules, userForm.permissions);

  const load = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [usersRes, logsRes] = await Promise.all([
        appClient.functions.invoke('adminUsersList', {}),
        appClient.functions.invoke('adminAuditLogs', {}),
      ]);
      if (usersRes.data?.error) {
        setError(usersRes.data.error);
      } else {
        const nextModules = usersRes.data.modules?.length ? usersRes.data.modules : APP_MODULES;
        const nextUserTypes = usersRes.data.userTypes?.length ? usersRes.data.userTypes : USER_TYPES;
        setModules(nextModules);
        setUsers(usersRes.data.users || []);
        setUserTypes(nextUserTypes);
        setTypePermissions(usersRes.data.typePermissions || {});
      }
      if (!logsRes.data?.error) setAuditLogs(logsRes.data.logs || []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [isSupabaseConfigured]);

  const resetAlerts = () => {
    setMessage('');
    setError('');
  };

  const selectUser = (item) => {
    resetAlerts();
    const useTypeDefaults = item.user_type === 'administrator' ? true : item.use_type_defaults !== false;
    const sourcePermissions = useTypeDefaults
      ? typePermissions[item.user_type] || item.permissions || {}
      : item.permissions || {};
    setUserForm({
      id: item.id,
      email: item.email || '',
      full_name: item.full_name || '',
      user_type: item.user_type || 'viewer',
      active: item.active !== false,
      password: '',
      use_type_defaults: useTypeDefaults,
      permissions: normalizedPermissions(sortedModules, sourcePermissions),
    });
  };

  const newUser = () => {
    resetAlerts();
    setUserForm({
      ...emptyUserForm,
      permissions: normalizedPermissions(sortedModules, typePermissions.viewer || {}),
    });
  };

  const setUserType = (userType) => {
    setUserForm((prev) => {
      const useTypeDefaults = userType === 'administrator' ? true : prev.use_type_defaults;
      const typeDefaults = normalizedPermissions(sortedModules, typePermissions[userType] || {});
      return {
        ...prev,
        user_type: userType,
        use_type_defaults: useTypeDefaults,
        permissions: useTypeDefaults ? typeDefaults : normalizedPermissions(sortedModules, prev.permissions),
      };
    });
  };

  const setUseTypeDefaults = (checked) => {
    setUserForm((prev) => ({
      ...prev,
      use_type_defaults: checked,
      permissions: checked
        ? normalizedPermissions(sortedModules, typePermissions[prev.user_type] || {})
        : normalizedPermissions(sortedModules, effectiveUserPermissions),
    }));
  };

  const toggleUserModule = (moduleId) => {
    setUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions?.[moduleId],
      },
    }));
  };

  const saveUser = async (event) => {
    event.preventDefault();
    setSavingUser(true);
    setError('');
    setMessage('');
    const payload = {
      id: userForm.id,
      email: userForm.email.trim().toLowerCase(),
      full_name: userForm.full_name.trim(),
      user_type: userForm.user_type,
      active: userForm.active,
      password: userForm.password,
      use_type_defaults: userForm.user_type === 'administrator' ? true : userForm.use_type_defaults,
      permissions: userForm.user_type === 'administrator' ? FULL_ACCESS : normalizedPermissions(sortedModules, userForm.permissions),
    };
    const res = await appClient.functions.invoke('adminUserSave', payload);
    setSavingUser(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User saved.');
    setUserForm((prev) => ({ ...prev, id: res.data.user?.id || prev.id, password: '' }));
    await load();
  };

  const deleteUser = async () => {
    if (!userForm.id || userForm.id === currentUser?.id) return;
    const confirmed = window.confirm(`Delete ${userForm.email}? This removes the Supabase login and access profile.`);
    if (!confirmed) return;
    setDeletingUser(true);
    setError('');
    setMessage('');
    const res = await appClient.functions.invoke('adminUserDelete', { id: userForm.id });
    setDeletingUser(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User deleted.');
    setUserForm(emptyUserForm);
    await load();
  };

  const selectUserType = (item) => {
    resetAlerts();
    setTypeForm({
      id: item.id,
      label: item.label || item.id,
      description: item.description || '',
      sort_order: item.sort_order ?? item.sortOrder ?? 100,
      is_system: item.is_system === true,
      permissions: normalizedPermissions(sortedModules, typePermissions[item.id] || {}),
    });
  };

  const newUserType = () => {
    resetAlerts();
    setTypeForm({
      ...emptyTypeForm,
      permissions: normalizedPermissions(sortedModules, { dashboard: true }),
    });
  };

  const toggleTypeModule = (moduleId) => {
    setTypeForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions?.[moduleId],
      },
    }));
  };

  const saveUserType = async (event) => {
    event.preventDefault();
    setSavingType(true);
    setError('');
    setMessage('');
    const payload = {
      id: typeForm.id,
      label: typeForm.label.trim(),
      description: typeForm.description.trim(),
      sort_order: typeForm.sort_order,
      permissions: typeForm.id === 'administrator' ? FULL_ACCESS : normalizedPermissions(sortedModules, typeForm.permissions),
    };
    const res = await appClient.functions.invoke('adminUserTypeSave', payload);
    setSavingType(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User type saved.');
    setTypeForm((prev) => ({
      ...prev,
      id: res.data.userType?.id || prev.id,
      is_system: res.data.userType?.is_system === true,
      permissions: normalizedPermissions(sortedModules, res.data.userType?.permissions || prev.permissions),
    }));
    await load();
  };

  const deleteUserType = async () => {
    if (!typeForm.id || typeForm.is_system) return;
    const assignedCount = users.filter((item) => item.user_type === typeForm.id).length;
    if (assignedCount > 0) {
      setError('This user type is assigned to users. Reassign those users before deleting it.');
      return;
    }
    const confirmed = window.confirm(`Delete user type ${typeForm.label}?`);
    if (!confirmed) return;
    setDeletingType(true);
    setError('');
    setMessage('');
    const res = await appClient.functions.invoke('adminUserTypeDelete', { id: typeForm.id });
    setDeletingType(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    setMessage('User type deleted.');
    setTypeForm(emptyTypeForm);
    await load();
  };

  const activeTypePermissions = typeForm.id === 'administrator'
    ? FULL_ACCESS
    : normalizedPermissions(sortedModules, typeForm.permissions);

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="Admin Control"
        description="Manage users, reusable user types, and page-level access rights."
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
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Supabase is not configured yet.</div>
          <div className="mt-1">
            Add the Supabase URL, anon key, and service-role key in Vercel, then run the Supabase migration in this repo.
          </div>
        </div>
      )}

      {authMode === 'local' && isSupabaseConfigured && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Local administrator mode is active. Sign in with Supabase to enforce production access control.
        </div>
      )}

      {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Users</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{users.length} account{users.length === 1 ? '' : 's'}</p>
            </div>
            <button
              type="button"
              onClick={newUser}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-primary"
            >
              <UserPlus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          {loading ? (
            <StateBlock icon={Loader2} title="Loading users..." description="Fetching access-control users." />
          ) : users.length ? (
            <div className="max-h-[560px] divide-y divide-border overflow-auto rounded-lg border border-border">
              {users.map((item) => {
                const permissions = item.use_type_defaults !== false
                  ? typePermissions[item.user_type] || item.permissions || {}
                  : item.permissions || {};
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectUser(item)}
                    className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-muted/30 ${selectedUser?.id === item.id ? 'bg-primary/10' : 'bg-background/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">{item.full_name || item.email}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${item.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {item.active ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.email}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                      <span>{typeLabel(userTypeMap[item.user_type] || { id: item.user_type })}</span>
                      <span>{item.use_type_defaults !== false ? 'Type default' : permissionSummary(sortedModules, permissions)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <StateBlock title="No users found" description="Create the first administrator after Supabase is configured." />
          )}
        </div>

        <form onSubmit={saveUser} className="rounded-lg border border-border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{userForm.id ? 'Edit User' : 'Create User'}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Assign a user type, then inherit its access rights or set custom access.</p>
            </div>
            {userForm.id && userForm.id !== currentUser?.id && (
              <button
                type="button"
                onClick={deleteUser}
                disabled={deletingUser || !isSupabaseConfigured}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-60"
              >
                {deletingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input
                type="email"
                value={userForm.email}
                onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
                disabled={Boolean(userForm.id)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full Name</span>
              <input
                value={userForm.full_name}
                onChange={(event) => setUserForm((prev) => ({ ...prev, full_name: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">User Type</span>
              <select
                value={userForm.user_type}
                onChange={(event) => setUserType(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {userTypes.map((item) => <option key={item.id} value={item.id}>{typeLabel(item)}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{userForm.id ? 'New Password' : 'Password'}</span>
              <input
                type="password"
                value={userForm.password}
                onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required={!userForm.id}
                minLength={8}
                placeholder={userForm.id ? 'Leave blank to keep current password' : ''}
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={userForm.active}
                onChange={(event) => setUserForm((prev) => ({ ...prev, active: event.target.checked }))}
              />
              Active user
            </label>
            <label className={`flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-medium text-foreground ${userForm.user_type === 'administrator' ? 'opacity-60' : ''}`}>
              <input
                type="checkbox"
                checked={userForm.user_type === 'administrator' || userForm.use_type_defaults}
                disabled={userForm.user_type === 'administrator'}
                onChange={(event) => setUseTypeDefaults(event.target.checked)}
              />
              Use user type defaults
            </label>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Module Access</div>
              <div className="text-xs text-muted-foreground">
                {userForm.use_type_defaults || userForm.user_type === 'administrator' ? 'Inherited' : 'Custom'}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sortedModules.map((module) => {
                const checked = effectiveUserPermissions?.[module.id] === true;
                const locked = userForm.user_type === 'administrator' || userForm.use_type_defaults;
                return (
                  <label key={module.id} className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm ${locked ? 'opacity-75' : ''}`}>
                    <span className="font-medium text-foreground">{module.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => toggleUserModule(module.id)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={savingUser || !isSupabaseConfigured}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {savingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save User
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">User Types</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Permission templates for users</p>
            </div>
            <button
              type="button"
              onClick={newUserType}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          {loading ? (
            <StateBlock icon={Loader2} title="Loading user types..." description="Fetching access templates." />
          ) : userTypes.length ? (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {userTypes.map((item) => {
                const assignedCount = users.filter((userItem) => userItem.user_type === item.id).length;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectUserType(item)}
                    className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-muted/30 ${selectedType?.id === item.id ? 'bg-primary/10' : 'bg-background/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">{typeLabel(item)}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        {item.is_system ? 'System' : 'Custom'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.description || 'No description'}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                      <span>{permissionSummary(sortedModules, typePermissions[item.id])}</span>
                      <span>{assignedCount} user{assignedCount === 1 ? '' : 's'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <StateBlock title="No user types found" description="Create a user type to define reusable access rights." />
          )}
        </div>

        <form onSubmit={saveUserType} className="rounded-lg border border-border bg-card p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <UserCog className="h-4 w-4 text-primary" />
                {typeForm.id ? 'Edit User Type' : 'Create User Type'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Design the access rights inherited by users of this type.</p>
            </div>
            {typeForm.id && !typeForm.is_system && (
              <button
                type="button"
                onClick={deleteUserType}
                disabled={deletingType || !isSupabaseConfigured}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 disabled:opacity-60"
              >
                {deletingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_140px]">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type Name</span>
              <input
                value={typeForm.label}
                onChange={(event) => setTypeForm((prev) => ({ ...prev, label: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                required
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sort Order</span>
              <input
                type="number"
                value={typeForm.sort_order}
                onChange={(event) => setTypeForm((prev) => ({ ...prev, sort_order: Number(event.target.value) || 100 }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</span>
              <input
                value={typeForm.description}
                onChange={(event) => setTypeForm((prev) => ({ ...prev, description: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Module Access</div>
              {typeForm.id === 'administrator' && (
                <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" /> Always full access
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sortedModules.map((module) => {
                const checked = typeForm.id === 'administrator' || activeTypePermissions?.[module.id] === true;
                return (
                  <label key={module.id} className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm ${typeForm.id === 'administrator' ? 'opacity-75' : ''}`}>
                    <span className="font-medium text-foreground">{module.label}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={typeForm.id === 'administrator'}
                      onChange={() => toggleTypeModule(module.id)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={savingType || !isSupabaseConfigured}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {savingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save User Type
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Audit Log</h2>
        {auditLogs.length ? (
          <div className="max-h-[300px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
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
                    <td className="px-3 py-2 text-muted-foreground">{log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{log.action}</td>
                    <td className="px-3 py-2 text-muted-foreground">{log.target_email || log.target_user_id || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{log.actor_email || log.actor_user_id || '-'}</td>
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
