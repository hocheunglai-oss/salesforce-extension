import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import ReportBuilder from '@/pages/ReportBuilder';
import DataExplorer from '@/pages/DataExplorer';
import DashboardSettings from '@/pages/DashboardSettings';
import SettingsPage from '@/pages/Settings';
import StemPnlReport from '@/pages/StemPnlReport';
import BrokerRegister from '@/pages/BrokerRegister';
import ReviewQueue from '@/pages/ReviewQueue';
import BuyerInvoices from '@/pages/BuyerInvoices';
import DisputeManagement from '@/pages/DisputeManagement';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardSettings />} />
        <Route path="/reports" element={<ReportBuilder />} />
        <Route path="/explorer" element={<DataExplorer />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/pnl" element={<StemPnlReport />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/disputes" element={<DisputeManagement />} />
        <Route path="/buyer-invoices" element={<BuyerInvoices />} />
        <Route path="/brokers" element={<BrokerRegister />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
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
