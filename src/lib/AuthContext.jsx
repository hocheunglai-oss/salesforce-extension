import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { APP_MODULES, FULL_ACCESS } from '@/lib/authModules';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { appClient } from '@/api/appClient';

const AuthContext = createContext();

const LOCAL_ADMIN_USER = {
  id: 'local-admin',
  full_name: 'Vincent',
  email: 'vincent@cosulich.com.hk',
  role: 'admin',
  user_type: 'administrator',
  active: true,
};

const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const REPORT_ARCHIVE_MANAGE_MODULE_ID = 'report_archive_manage';

function profileToUser(profile, authUser) {
  return {
    id: authUser.id,
    full_name: profile.full_name || authUser.user_metadata?.full_name || authUser.email,
    email: profile.email || authUser.email,
    role: profile.user_type === 'administrator' ? 'admin' : profile.user_type,
    user_type: profile.user_type,
    use_type_defaults: profile.use_type_defaults !== false,
    active: profile.active,
  };
}

function fullAccessLevels() {
  return { [REPORT_ARCHIVE_MODULE_ID]: 'full' };
}

function normalizeAccess(permissionRows = []) {
  const access = Object.fromEntries(APP_MODULES.map((module) => [module.id, false]));
  const accessLevels = { [REPORT_ARCHIVE_MODULE_ID]: 'none' };
  let hasReportArchivePermission = false;
  let hasManageArchivePermission = false;
  let canManageArchive = false;
  for (const row of permissionRows || []) {
    if (row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID) {
      hasManageArchivePermission = true;
      canManageArchive = row.can_view === true;
      continue;
    }
    access[row.module_id] = row.can_view === true;
    if (row.module_id === REPORT_ARCHIVE_MODULE_ID) {
      hasReportArchivePermission = row.can_view === true;
    }
  }
  if (hasReportArchivePermission) {
    accessLevels[REPORT_ARCHIVE_MODULE_ID] = !hasManageArchivePermission || canManageArchive ? 'full' : 'read';
  }
  return { access, accessLevels };
}

async function loadSupabaseUser() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData?.session) return { user: null, access: {}, accessLevels: {}, error: { type: 'auth_required' } };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    const message = String(userError.message || '').toLowerCase();
    if (message.includes('session missing') || message.includes('auth session missing')) {
      return { user: null, access: {}, accessLevels: {}, error: { type: 'auth_required' } };
    }
    throw userError;
  }
  const authUser = userData?.user;
  if (!authUser) return { user: null, access: {}, accessLevels: {}, error: { type: 'auth_required' } };

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id,email,full_name,user_type,active,use_type_defaults')
    .eq('id', authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { user: null, access: {}, accessLevels: {}, error: { type: 'user_not_registered' } };
  if (!profile.active) return { user: null, access: {}, accessLevels: {}, error: { type: 'user_inactive' } };

  if (profile.user_type === 'administrator') {
    return { user: profileToUser(profile, authUser), access: FULL_ACCESS, accessLevels: fullAccessLevels(), error: null };
  }

  if (profile.use_type_defaults !== false) {
    const { data: permissions, error: permissionsError } = await supabase
      .from('user_type_module_permissions')
      .select('module_id,can_view')
      .eq('user_type_id', profile.user_type);
    if (permissionsError) throw permissionsError;

    const normalized = normalizeAccess(permissions);
    return { user: profileToUser(profile, authUser), access: normalized.access, accessLevels: normalized.accessLevels, error: null };
  }

  const { data: permissions, error: permissionsError } = await supabase
    .from('user_module_permissions')
    .select('module_id,can_view')
    .eq('user_id', authUser.id);
  if (permissionsError) throw permissionsError;

  const normalized = normalizeAccess(permissions);
  return { user: profileToUser(profile, authUser), access: normalized.access, accessLevels: normalized.accessLevels, error: null };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [moduleAccess, setModuleAccess] = useState({});
  const [moduleAccessLevels, setModuleAccessLevels] = useState({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const authMode = isSupabaseConfigured ? 'supabase' : 'local';

  const applyLocalAdmin = useCallback(() => {
    setUser(LOCAL_ADMIN_USER);
    setModuleAccess(FULL_ACCESS);
    setModuleAccessLevels(fullAccessLevels());
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthChecked(true);
    setIsLoadingAuth(false);
  }, []);

  const checkUserAuth = useCallback(async ({ showLoader = true } = {}) => {
    if (showLoader) setIsLoadingAuth(true);
    setAuthError(null);
    try {
      if (!isSupabaseConfigured) {
        applyLocalAdmin();
        return;
      }
      const result = await loadSupabaseUser();
      setUser(result.user);
      setModuleAccess(result.access || {});
      setModuleAccessLevels(result.accessLevels || {});
      setIsAuthenticated(Boolean(result.user));
      setAuthError(result.error);
      setAuthChecked(true);
    } catch (error) {
      setUser(null);
      setModuleAccess({});
      setModuleAccessLevels({});
      setAuthError({ type: 'local_auth_error', message: error.message });
      setIsAuthenticated(false);
      setAuthChecked(true);
    } finally {
      if (showLoader) setIsLoadingAuth(false);
    }
  }, [applyLocalAdmin]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      appClient.functions.clearCache();
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setModuleAccess({});
        setModuleAccessLevels({});
        setIsAuthenticated(false);
        setAuthError({ type: 'auth_required' });
        setAuthChecked(true);
        setIsLoadingAuth(false);
        return;
      }
      checkUserAuth({ showLoader: false });
    });
    return () => data?.subscription?.unsubscribe();
  }, [checkUserAuth]);

  const login = async (email, password) => {
    if (!isSupabaseConfigured) {
      applyLocalAdmin();
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await checkUserAuth({ showLoader: true });
  };

  const logout = async () => {
    appClient.functions.clearCache();
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setModuleAccess({});
    setModuleAccessLevels({});
    setIsAuthenticated(false);
    setAuthChecked(true);
    if (!isSupabaseConfigured) applyLocalAdmin();
  };

  const navigateToLogin = () => checkUserAuth({ showLoader: true });
  const checkAppState = () => checkUserAuth({ showLoader: false });
  const hasModuleAccess = useCallback((moduleId) => {
    if (!moduleId) return true;
    if (user?.user_type === 'administrator') return true;
    return moduleAccess[moduleId] === true;
  }, [moduleAccess, user?.user_type]);
  const isAdministrator = user?.user_type === 'administrator';

  const value = useMemo(() => ({
    user,
    moduleAccess,
    moduleAccessLevels,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings: { id: 'fcos', public_settings: {} },
    authChecked,
    authMode,
    isSupabaseConfigured,
    isAdministrator,
    login,
    logout,
    navigateToLogin,
    checkUserAuth,
    checkAppState,
    hasModuleAccess,
  }), [
    user,
    moduleAccess,
    moduleAccessLevels,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    authChecked,
    authMode,
    isAdministrator,
    hasModuleAccess,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
