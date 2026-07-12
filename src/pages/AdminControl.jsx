import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserCog, UserPlus, Users } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { APP_CAPABILITIES, APP_MODULES, FULL_ACCESS, FULL_CAPABILITIES, USER_TYPES } from '@/lib/authModules';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';

const emptyUserForm = {
  id: null,
  email: '',
  full_name: '',
  user_type: 'viewer',
  active: true,
  password: '',
  use_type_defaults: true,
  permissions: {},
  capabilities: {},
};

const emptyTypeForm = {
  id: null,
  label: '',
  description: '',
  sort_order: 100,
  is_system: false,
  permissions: { dashboard: true },
  capabilities: {},
};

const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const REPORT_ARCHIVE_ACCESS_OPTIONS = [
  { value: 'none', label: 'No Access' },
  { value: 'read', label: 'Read Only' },
  { value: 'full', label: 'Full Access' },
];

function reportArchiveAccess(value) {
  if (value === 'full' || value === true) return 'full';
  if (value === 'read') return 'read';
  return 'none';
}

function permissionCanView(moduleId, value) {
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccess(value) !== 'none';
  return value === true;
}

function normalizedPermissions(modules, permissions = {}) {
  return Object.fromEntries(modules.map((module) => [
    module.id,
    module.id === REPORT_ARCHIVE_MODULE_ID
      ? reportArchiveAccess(permissions?.[module.id])
      : permissions?.[module.id] === true,
  ]));
}

function normalizedCapabilities(definitions, capabilities = {}) {
  return Object.fromEntries(definitions.map((capability) => [capability.id, capabilities?.[capability.id] === true]));
}

function typeLabel(type) {
  return String(type?.label || type?.id || '').replaceAll('_', ' ');
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function permissionSummary(modules, permissions = {}) {
  const count = modules.filter((module) => permissionCanView(module.id, permissions?.[module.id])).length;
  if (count === modules.length) return 'All modules';
  if (count === 0) return 'No modules';
  return `${count} modules`;
}

function userDraftKey(form) {
  return form?.id ? `admin:user:${form.id}` : 'admin:user:new';
}

function userTypeDraftKey(form) {
  return form?.id ? `admin:user-type:${form.id}` : 'admin:user-type:new';
}

function safeUserDraft(form) {
  return { ...form, password: '' };
}

function SegmentButton({ active, children, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'border border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

function ModuleGrid({ modules, permissions, locked = false, onToggle, onSetAccess }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {modules.map((module) => {
        if (module.id === REPORT_ARCHIVE_MODULE_ID) {
          const currentAccess = reportArchiveAccess(permissions?.[module.id]);
          return (
            <div
              key={module.id}
              className={`min-h-10 rounded-md border border-border bg-background/60 px-3 py-2 text-sm ${locked ? 'opacity-75' : ''}`}
            >
              <div className="mb-2 font-medium text-foreground">{module.label}</div>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border">
                {REPORT_ARCHIVE_ACCESS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={locked}
                    onClick={() => onSetAccess?.(module.id, option.value)}
                    className={`h-8 px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                      currentAccess === option.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        return (
          <label
            key={module.id}
            className={`flex min-h-10 items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2 text-sm ${locked ? 'opacity-75' : ''}`}
          >
            <span className="font-medium text-foreground">{module.label}</span>
            <input
              type="checkbox"
              checked={permissions?.[module.id] === true}
              disabled={locked}
              onChange={() => onToggle?.(module.id)}
            />
          </label>
        );
      })}
    </div>
  );
}

function CapabilityGrid({ definitions, capabilities, locked = false, onToggle }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {definitions.map((capability) => (
        <label
          key={capability.id}
          className={`flex min-h-16 items-start justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2 text-sm ${locked ? 'opacity-75' : ''}`}
        >
          <span>
            <span className="block font-medium text-foreground">{capability.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{capability.description}</span>
          </span>
          <input
            type="checkbox"
            className="mt-1"
            checked={capabilities?.[capability.id] === true}
            disabled={locked}
            onChange={() => onToggle?.(capability.id)}
          />
        </label>
      ))}
    </div>
  );
}

export default function AdminControl() {
  const { authMode, isSupabaseConfigured, user: currentUser } = useAuth();
  const [activeSection, setActiveSection] = useState('users');
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState(APP_MODULES);
  const [userTypes, setUserTypes] = useState(USER_TYPES);
  const [typePermissions, setTypePermissions] = useState({});
  const [capabilityDefinitions, setCapabilityDefinitions] = useState(APP_CAPABILITIES);
  const [typeCapabilities, setTypeCapabilities] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [baseUserForm, setBaseUserForm] = useState(emptyUserForm);
  const [baseTypeForm, setBaseTypeForm] = useState(emptyTypeForm);
  const [userDraftRestoredAt, setUserDraftRestoredAt] = useState(null);
  const [typeDraftRestoredAt, setTypeDraftRestoredAt] = useState(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
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
  const sortedUserTypes = useMemo(
    () => userTypes.slice().sort((a, b) => compareText(typeLabel(a), typeLabel(b))),
    [userTypes]
  );
  const sortedUsers = useMemo(
    () => users.slice().sort((a, b) => compareText(a.full_name || a.email, b.full_name || b.email)),
    [users]
  );
  const selectedUser = useMemo(() => users.find((item) => item.id === userForm.id) || null, [users, userForm.id]);
  const selectedType = useMemo(() => userTypes.find((item) => item.id === typeForm.id) || null, [userTypes, typeForm.id]);
  const userTypeMap = useMemo(() => Object.fromEntries(userTypes.map((item) => [item.id, item])), [userTypes]);
  const selectedTypePermissions = useMemo(
    () => normalizedPermissions(sortedModules, typePermissions[userForm.user_type] || {}),
    [sortedModules, typePermissions, userForm.user_type]
  );
  const selectedTypeCapabilities = useMemo(
    () => normalizedCapabilities(capabilityDefinitions, typeCapabilities[userForm.user_type] || {}),
    [capabilityDefinitions, typeCapabilities, userForm.user_type]
  );
  const effectiveUserPermissions = userForm.user_type === 'administrator'
    ? FULL_ACCESS
    : userForm.use_type_defaults
      ? selectedTypePermissions
      : normalizedPermissions(sortedModules, userForm.permissions);
  const effectiveUserCapabilities = userForm.user_type === 'administrator'
    ? FULL_CAPABILITIES
    : userForm.use_type_defaults
      ? selectedTypeCapabilities
      : normalizedCapabilities(capabilityDefinitions, userForm.capabilities);
  const activeTypePermissions = typeForm.id === 'administrator'
    ? FULL_ACCESS
    : normalizedPermissions(sortedModules, typeForm.permissions);
  const activeTypeCapabilities = typeForm.id === 'administrator'
    ? FULL_CAPABILITIES
    : normalizedCapabilities(capabilityDefinitions, typeForm.capabilities);
  const selectedTypeAssignedCount = useMemo(
    () => users.filter((item) => item.user_type === typeForm.id).length,
    [typeForm.id, users]
  );
  const activeUserDraftKey = userDraftKey(userForm);
  const activeTypeDraftKey = userTypeDraftKey(typeForm);
  const userDraftValue = useMemo(() => safeUserDraft(userForm), [userForm]);
  const baseUserDraftValue = useMemo(() => safeUserDraft(baseUserForm), [baseUserForm]);
  const userDraftDirty = Boolean(userDialogOpen && !sameDraftValue(userDraftValue, baseUserDraftValue));
  const typeDraftDirty = Boolean(typeDialogOpen && !sameDraftValue(typeForm, baseTypeForm));
  useDraftAutosave(activeUserDraftKey, userDraftValue, {
    enabled: userDialogOpen,
    dirty: userDraftDirty,
    message: 'Autosaved admin user draft. Save or discard it before leaving.',
  });
  useDraftAutosave(activeTypeDraftKey, typeForm, {
    enabled: typeDialogOpen,
    dirty: typeDraftDirty,
    message: 'Autosaved admin user type draft. Save or discard it before leaving.',
  });

  const load = async (options = {}) => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError('');
    try {
      const [usersRes, logsRes] = await Promise.all([
        appClient.functions.invoke('adminUsersList', {}, { cache: true, force: options.force }),
        appClient.functions.invoke('adminAuditLogs', {}, { cache: true, force: options.force }),
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
        setCapabilityDefinitions(usersRes.data.capabilities?.length ? usersRes.data.capabilities : APP_CAPABILITIES);
        setTypeCapabilities(usersRes.data.typeCapabilities || {});
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

  const openUserDialog = (item) => {
    resetAlerts();
    setActiveSection('users');
    if (!item) {
      const base = {
        ...emptyUserForm,
        permissions: normalizedPermissions(sortedModules, typePermissions.viewer || {}),
        capabilities: normalizedCapabilities(capabilityDefinitions, typeCapabilities.viewer || {}),
      };
      const draft = readDraft(userDraftKey(base));
      const next = draft?.data && !sameDraftValue(draft.data, safeUserDraft(base))
        ? { ...base, ...draft.data, password: '' }
        : base;
      setBaseUserForm(base);
      setUserForm(next);
      setUserDraftRestoredAt(draft?.data && !sameDraftValue(safeUserDraft(next), safeUserDraft(base)) ? draft.updatedAt : null);
      setUserDialogOpen(true);
      return;
    }

    const useTypeDefaults = item.user_type === 'administrator' ? true : item.use_type_defaults !== false;
    const sourcePermissions = useTypeDefaults
      ? typePermissions[item.user_type] || item.permissions || {}
      : item.permissions || {};
    const sourceCapabilities = useTypeDefaults
      ? typeCapabilities[item.user_type] || item.capabilities || {}
      : item.capabilities || {};
    const base = {
      id: item.id,
      email: item.email || '',
      full_name: item.full_name || '',
      user_type: item.user_type || 'viewer',
      active: item.active !== false,
      password: '',
      use_type_defaults: useTypeDefaults,
      permissions: normalizedPermissions(sortedModules, sourcePermissions),
      capabilities: normalizedCapabilities(capabilityDefinitions, sourceCapabilities),
    };
    const draft = readDraft(userDraftKey(base));
    const next = draft?.data && !sameDraftValue(draft.data, safeUserDraft(base))
      ? { ...base, ...draft.data, password: '' }
      : base;
    setBaseUserForm(base);
    setUserForm(next);
    setUserDraftRestoredAt(draft?.data && !sameDraftValue(safeUserDraft(next), safeUserDraft(base)) ? draft.updatedAt : null);
    setUserDialogOpen(true);
  };

  const setUserType = (userType) => {
    setUserForm((prev) => {
      const useTypeDefaults = userType === 'administrator' ? true : prev.use_type_defaults;
      const typeDefaults = normalizedPermissions(sortedModules, typePermissions[userType] || {});
      const capabilityDefaults = normalizedCapabilities(capabilityDefinitions, typeCapabilities[userType] || {});
      return {
        ...prev,
        user_type: userType,
        use_type_defaults: useTypeDefaults,
        permissions: useTypeDefaults ? typeDefaults : normalizedPermissions(sortedModules, prev.permissions),
        capabilities: useTypeDefaults ? capabilityDefaults : normalizedCapabilities(capabilityDefinitions, prev.capabilities),
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
      capabilities: checked
        ? normalizedCapabilities(capabilityDefinitions, typeCapabilities[prev.user_type] || {})
        : normalizedCapabilities(capabilityDefinitions, effectiveUserCapabilities),
    }));
  };

  const toggleUserModule = (moduleId) => {
    if (moduleId === REPORT_ARCHIVE_MODULE_ID) return;
    setUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions?.[moduleId],
      },
    }));
  };

  const setUserModuleAccess = (moduleId, access) => {
    setUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: moduleId === REPORT_ARCHIVE_MODULE_ID ? reportArchiveAccess(access) : access === true,
      },
    }));
  };

  const toggleUserCapability = (capabilityId) => {
    setUserForm((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [capabilityId]: !prev.capabilities?.[capabilityId],
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
      capabilities: userForm.user_type === 'administrator' ? FULL_CAPABILITIES : normalizedCapabilities(capabilityDefinitions, userForm.capabilities),
    };
    const res = await appClient.functions.invoke('adminUserSave', payload);
    setSavingUser(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    clearDraft(activeUserDraftKey);
    setUserDraftRestoredAt(null);
    setMessage('User saved.');
    setUserDialogOpen(false);
    setUserForm((prev) => ({ ...prev, id: res.data.user?.id || prev.id, password: '' }));
    await load({ force: true });
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
    clearDraft(activeUserDraftKey);
    setUserDraftRestoredAt(null);
    setUserDialogOpen(false);
    setUserForm(emptyUserForm);
    await load({ force: true });
  };

  const openTypeDialog = (item) => {
    resetAlerts();
    setActiveSection('types');
    if (!item) {
      const base = {
        ...emptyTypeForm,
        permissions: normalizedPermissions(sortedModules, { dashboard: true }),
        capabilities: normalizedCapabilities(capabilityDefinitions, {}),
      };
      const draft = readDraft(userTypeDraftKey(base));
      const next = draft?.data && !sameDraftValue(draft.data, base)
        ? { ...base, ...draft.data }
        : base;
      setBaseTypeForm(base);
      setTypeForm(next);
      setTypeDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
      setTypeDialogOpen(true);
      return;
    }

    const base = {
      id: item.id,
      label: item.label || item.id,
      description: item.description || '',
      sort_order: item.sort_order ?? item.sortOrder ?? 100,
      is_system: item.is_system === true,
      permissions: normalizedPermissions(sortedModules, typePermissions[item.id] || {}),
      capabilities: normalizedCapabilities(capabilityDefinitions, typeCapabilities[item.id] || {}),
    };
    const draft = readDraft(userTypeDraftKey(base));
    const next = draft?.data && !sameDraftValue(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setBaseTypeForm(base);
    setTypeForm(next);
    setTypeDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
    setTypeDialogOpen(true);
  };

  const toggleTypeModule = (moduleId) => {
    if (moduleId === REPORT_ARCHIVE_MODULE_ID) return;
    setTypeForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: !prev.permissions?.[moduleId],
      },
    }));
  };

  const setTypeModuleAccess = (moduleId, access) => {
    setTypeForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [moduleId]: moduleId === REPORT_ARCHIVE_MODULE_ID ? reportArchiveAccess(access) : access === true,
      },
    }));
  };

  const toggleTypeCapability = (capabilityId) => {
    setTypeForm((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [capabilityId]: !prev.capabilities?.[capabilityId],
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
      capabilities: typeForm.id === 'administrator' ? FULL_CAPABILITIES : normalizedCapabilities(capabilityDefinitions, typeForm.capabilities),
    };
    const res = await appClient.functions.invoke('adminUserTypeSave', payload);
    setSavingType(false);
    if (res.data?.error) {
      setError(res.data.error);
      return;
    }
    clearDraft(activeTypeDraftKey);
    setTypeDraftRestoredAt(null);
    setMessage('User type saved.');
    setTypeDialogOpen(false);
    setTypeForm((prev) => ({
      ...prev,
      id: res.data.userType?.id || prev.id,
      is_system: res.data.userType?.is_system === true,
      permissions: normalizedPermissions(sortedModules, res.data.userType?.permissions || prev.permissions),
      capabilities: normalizedCapabilities(capabilityDefinitions, res.data.userType?.capabilities || prev.capabilities),
    }));
    await load({ force: true });
  };

  const deleteUserType = async () => {
    if (!typeForm.id || typeForm.id === 'administrator') return;
    if (selectedTypeAssignedCount > 0) {
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
    clearDraft(activeTypeDraftKey);
    setTypeDraftRestoredAt(null);
    setTypeDialogOpen(false);
    setTypeForm(emptyTypeForm);
    await load({ force: true });
  };

  const canDeleteSelectedType = typeForm.id && typeForm.id !== 'administrator' && selectedTypeAssignedCount === 0;
  const activeListTitle = activeSection === 'users' ? 'Users' : 'User Types';
  const newButtonLabel = activeSection === 'users' ? 'New User' : 'New Type';
  const discardUserDraft = () => {
    clearDraft(activeUserDraftKey);
    setUserForm(baseUserForm);
    setUserDraftRestoredAt(null);
  };
  const discardTypeDraft = () => {
    clearDraft(activeTypeDraftKey);
    setTypeForm(baseTypeForm);
    setTypeDraftRestoredAt(null);
  };

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="Admin Control"
        description="Manage users, user types, and page-level access rights."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (activeSection === 'users' ? openUserDialog(null) : openTypeDialog(null))}
              disabled={!isSupabaseConfigured}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {activeSection === 'users' ? <UserPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {newButtonLabel}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading || !isSupabaseConfigured}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        }
      />

      {!isSupabaseConfigured && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Supabase is not configured yet. Add the Supabase keys in Vercel and run the migration in this repo.
        </div>
      )}

      {authMode === 'local' && isSupabaseConfigured && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Local administrator mode is active. Sign in with Supabase to enforce production access control.
        </div>
      )}

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentButton active={activeSection === 'users'} icon={Users} onClick={() => setActiveSection('users')}>
              Users <span className="font-normal opacity-80">({users.length})</span>
            </SegmentButton>
            <SegmentButton active={activeSection === 'types'} icon={UserCog} onClick={() => setActiveSection('types')}>
              User Types <span className="font-normal opacity-80">({userTypes.length})</span>
            </SegmentButton>
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            {activeSection === 'users' ? 'Sorted by name.' : 'Sorted alphabetically.'}
          </div>
        </div>

        <div className="min-h-[calc(100vh-260px)]">
          <aside className="min-h-0">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{activeListTitle}</h2>
                <p className="text-xs text-muted-foreground">{activeSection === 'users' ? `${users.length} accounts` : `${userTypes.length} types`}</p>
              </div>
            </div>

            {activeSection === 'users' ? (
              loading ? (
                <StateBlock icon={Loader2} title="Loading users..." description="Fetching access-control users." />
              ) : sortedUsers.length ? (
                <div className="max-h-[calc(100vh-322px)] divide-y divide-border overflow-auto">
                  {sortedUsers.map((item) => {
                    const permissions = item.use_type_defaults !== false
                      ? typePermissions[item.user_type] || item.permissions || {}
                      : item.permissions || {};
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openUserDialog(item)}
                        className={`block w-full px-4 py-3 text-left text-sm hover:bg-muted/30 ${selectedUser?.id === item.id ? 'bg-primary/10' : 'bg-background/40'}`}
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
              )
            ) : loading ? (
              <StateBlock icon={Loader2} title="Loading user types..." description="Fetching access templates." />
            ) : sortedUserTypes.length ? (
              <div className="max-h-[calc(100vh-322px)] divide-y divide-border overflow-auto">
                {sortedUserTypes.map((item) => {
                  const assignedCount = users.filter((userItem) => userItem.user_type === item.id).length;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openTypeDialog(item)}
                      className={`block w-full px-4 py-3 text-left text-sm hover:bg-muted/30 ${selectedType?.id === item.id ? 'bg-primary/10' : 'bg-background/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">{typeLabel(item)}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {item.is_system ? 'Default' : 'Custom'}
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
          </aside>
        </div>
      </section>

      <details className="mt-4 rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">Audit Log</summary>
        {auditLogs.length ? (
          <div className="max-h-[280px] overflow-auto border-t border-border">
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
      </details>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{userForm.id ? 'Edit User' : 'Create User'}</DialogTitle>
            <DialogDescription>Assign a user type, then inherit its access rights or set custom access.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveUser} className="min-h-0">
            <div className="max-h-[calc(90vh-150px)] overflow-auto px-5 py-4">
              <DraftNotice restoredAt={userDraftRestoredAt} label="Admin user draft restored" onDiscard={discardUserDraft} className="mb-4" />
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
                    {sortedUserTypes.map((item) => <option key={item.id} value={item.id}>{typeLabel(item)}</option>)}
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
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, active: event.target.checked }))}
                  />
                  Active user
                </label>
                <label className={`flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-sm font-medium text-foreground ${userForm.user_type === 'administrator' ? 'opacity-60' : ''}`}>
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
                <ModuleGrid
                  modules={sortedModules}
                  permissions={effectiveUserPermissions}
                  locked={userForm.user_type === 'administrator' || userForm.use_type_defaults}
                  onToggle={toggleUserModule}
                  onSetAccess={setUserModuleAccess}
                />
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow & Settings Permissions</div>
                  <div className="text-xs text-muted-foreground">
                    {userForm.use_type_defaults || userForm.user_type === 'administrator' ? 'Inherited' : 'Custom'}
                  </div>
                </div>
                <CapabilityGrid
                  definitions={capabilityDefinitions}
                  capabilities={effectiveUserCapabilities}
                  locked={userForm.user_type === 'administrator' || userForm.use_type_defaults}
                  onToggle={toggleUserCapability}
                />
              </div>
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              {userForm.id && userForm.id !== currentUser?.id && (
                <button
                  type="button"
                  onClick={deleteUser}
                  disabled={deletingUser || !isSupabaseConfigured}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"
                >
                  {deletingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setUserDialogOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingUser || !isSupabaseConfigured}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {savingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save User
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>{typeForm.id ? 'Edit User Type' : 'Create User Type'}</DialogTitle>
            <DialogDescription>Design the access rights inherited by users of this type.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveUserType}>
            <div className="max-h-[calc(90vh-150px)] overflow-auto px-5 py-4">
              <DraftNotice restoredAt={typeDraftRestoredAt} label="Admin user type draft restored" onDiscard={discardTypeDraft} className="mb-4" />
              {typeForm.id === 'administrator' && (
                <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Administrator is protected and always has full access.
                </div>
              )}
              {typeForm.id && typeForm.id !== 'administrator' && selectedTypeAssignedCount > 0 && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  This type has {selectedTypeAssignedCount} assigned user{selectedTypeAssignedCount === 1 ? '' : 's'}. Reassign them before deleting it.
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type Name</span>
                  <input
                    value={typeForm.label}
                    onChange={(event) => setTypeForm((prev) => ({ ...prev, label: event.target.value }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required
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
                <ModuleGrid
                  modules={sortedModules}
                  permissions={activeTypePermissions}
                  locked={typeForm.id === 'administrator'}
                  onToggle={toggleTypeModule}
                  onSetAccess={setTypeModuleAccess}
                />
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Workflow & Settings Permissions</div>
                  {typeForm.id === 'administrator' && (
                    <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5" /> Always full access
                    </div>
                  )}
                </div>
                <CapabilityGrid
                  definitions={capabilityDefinitions}
                  capabilities={activeTypeCapabilities}
                  locked={typeForm.id === 'administrator'}
                  onToggle={toggleTypeCapability}
                />
              </div>
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              {typeForm.id && typeForm.id !== 'administrator' && (
                <button
                  type="button"
                  onClick={deleteUserType}
                  disabled={!canDeleteSelectedType || deletingType || !isSupabaseConfigured}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"
                  title={selectedTypeAssignedCount > 0 ? 'Reassign users before deleting this type.' : ''}
                >
                  {deletingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setTypeDialogOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingType || !isSupabaseConfigured}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {savingType ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save User Type
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
