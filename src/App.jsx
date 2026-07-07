import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ModuleGate from '@/components/ModuleGate';
import Layout from '@/components/Layout';
import ReportBuilder from '@/pages/ReportBuilder';
import DataExplorer from '@/pages/DataExplorer';
import DashboardSettings from '@/pages/DashboardSettings';
import SettingsPage from '@/pages/Settings';
import StemPnlReport from '@/pages/StemPnlReport';
import BrokerRegister from '@/pages/BrokerRegister';
import ReportArchive from '@/pages/ReportArchive';
import ReviewQueue from '@/pages/ReviewQueue';
import BuyerInvoices from '@/pages/BuyerInvoices';
import DisputeManagement from '@/pages/DisputeManagement';
import Login from '@/pages/Login';
import AdminControl from '@/pages/AdminControl';

function AuthErrorScreen({ authError }) {
  if (authError?.type === 'user_not_registered') return <UserNotRegisteredError />;
  if (authError?.type === 'user_inactive') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">User Disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your account is disabled. Contact an administrator to restore access.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Authentication Error</h1>
        <p className="mt-2 text-sm text-muted-foreground">{authError?.message || 'Unable to verify your account.'}</p>
      </div>
    </div>
  );
}

const AuthenticatedApp = () => {
  const location = useLocation();
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();

  if (isLoadingPublicSettings || (isLoadingAuth && !isAuthenticated)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {authError?.type === 'auth_required' && (
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      )}
      {authError && authError.type !== 'auth_required' && (
        <Route path="*" element={<AuthErrorScreen authError={authError} />} />
      )}
      {!authError && !isAuthenticated && (
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      )}
      {!authError && isAuthenticated && (
        <Route element={<Layout />}>
          <Route path="/" element={<ModuleGate moduleId="dashboard"><DashboardSettings /></ModuleGate>} />
          <Route path="/reports" element={<ModuleGate moduleId="reports"><ReportBuilder /></ModuleGate>} />
          <Route path="/explorer" element={<ModuleGate moduleId="explorer"><DataExplorer /></ModuleGate>} />
          <Route path="/settings" element={<ModuleGate moduleId="settings"><SettingsPage /></ModuleGate>} />
          <Route path="/pnl" element={<ModuleGate moduleId="pnl"><StemPnlReport /></ModuleGate>} />
          <Route path="/review" element={<ModuleGate moduleId="review"><ReviewQueue /></ModuleGate>} />
          <Route path="/disputes" element={<ModuleGate moduleId="disputes"><DisputeManagement /></ModuleGate>} />
          <Route path="/buyer-invoices" element={<ModuleGate moduleId="buyer_invoices"><BuyerInvoices /></ModuleGate>} />
          <Route path="/brokers" element={<ModuleGate moduleId="brokers"><BrokerRegister /></ModuleGate>} />
          <Route path="/report-archive" element={<ModuleGate moduleId="report_archive"><ReportArchive /></ModuleGate>} />
          <Route path="/admin" element={<ModuleGate moduleId="admin"><AdminControl /></ModuleGate>} />
          <Route path="*" element={<PageNotFound />} />
        </Route>
      )}
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
          <Toaster />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
