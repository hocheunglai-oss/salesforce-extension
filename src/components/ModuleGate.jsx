import { useAuth } from '@/lib/AuthContext';
import { moduleLabel } from '@/lib/authModules';
import AccessDenied from '@/components/AccessDenied';

export default function ModuleGate({ moduleId, children }) {
  const { hasModuleAccess } = useAuth();
  if (!hasModuleAccess(moduleId)) return <AccessDenied moduleName={moduleLabel(moduleId)} />;
  return children;
}
