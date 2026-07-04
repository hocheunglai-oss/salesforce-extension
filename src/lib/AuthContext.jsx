import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FULL_ACCESS } from '@/lib/authModules';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

const AuthContext = createContext();

const LOCAL_ADMIN_USER = {
  id: 'local-admin',
  full_name: 'Vincent',
  email: 'vincent@cosulich.com.hk',
  role: 'admin',
  user_type: 'administrator',
  active: true,
};

function profileToUser(profile, authUser) {
  return {
    id: authUser.id,
    full_name: profile.full_name || authUser.user_metadata?.full_name || authUser.email,
    email: profile.email || authUser.email,
    role: profile.user_type === 'administrator' ? 'admin' : profile.user_type,
    user_type: profile.user_type,
    active: profile.active,
  };
}

async function loadSupabaseUser() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const authUser = userData?.user;
  if (!authUser) return { user: null, access: {}, error: { type: 'auth_required' } };

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id,email,full_name,user_type,active')
    .eq('id', authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { user: null, access: {}, error: { type: 'user_not_registered' } };
  if (!profile.active) return { user: null, access: {}, error: { type: 'user_inactive' } };

  if (profile.user_type === 'administrator') {
    return { user: profileToUser(profile, authUser), access: FULL_ACCESS, error: null };
  }

  const { data: permissions, error: permissionsError } = await supabase
    .from('user_module_permissions')
    .select('module_id,can_view')
    .eq('user_id', authUser.id);
  if (permissionsError) throw permissionsError;

  const access = Object.fromEntries((permissions || []).map((row) => [row.module_id, row.can_view === true]));
  return { user: profileToUser(profile, authUser), access, error: null };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [moduleAccess, setModuleAccess] = useState({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const authMode = isSupabaseConfigured ? 'supabase' : 'local';

  const applyLocalAdmin = useCallback(() => {
    setUser(LOCAL_ADMIN_USER);
    setModuleAccess(FULL_ACCESS);
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthChecked(true);
    setIsLoadingAuth(false);
  }, []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      if (!isSupabaseConfigured) {
        applyLocalAdmin();
        return;
      }
      const result = await loadSupabaseUser();
      setUser(result.user);
      setModuleAccess(result.access || {});
      setIsAuthenticated(Boolean(result.user));
      setAuthError(result.error);
      setAuthChecked(true);
    } catch (error) {
      setUser(null);
      setModuleAccess({});
      setAuthError({ type: 'local_auth_error', message: error.message });
      setIsAuthenticated(false);
      setAuthChecked(true);
    } finally {
      setIsLoadingAuth(false);
    }
  }, [applyLocalAdmin]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const { data } = supabase.auth.onAuthStateChange(() => {
      checkUserAuth();
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
    await checkUserAuth();
  };

  const logout = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setModuleAccess({});
    setIsAuthenticated(false);
    setAuthChecked(true);
    if (!isSupabaseConfigured) applyLocalAdmin();
  };

  const navigateToLogin = () => checkUserAuth();
  const checkAppState = () => checkUserAuth();
  const hasModuleAccess = useCallback((moduleId) => {
    if (!moduleId) return true;
    if (user?.user_type === 'administrator') return true;
    return moduleAccess[moduleId] === true;
  }, [moduleAccess, user?.user_type]);
  const isAdministrator = user?.user_type === 'administrator';

  const value = useMemo(() => ({
    user,
    moduleAccess,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings: { id: 'salesforce-extension', public_settings: {} },
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
