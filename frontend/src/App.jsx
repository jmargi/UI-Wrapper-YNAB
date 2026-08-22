import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { YNABProvider } from './context/YNABContext';
import AppShellLayout from './components/Layout/AppShellLayout';
import Dashboard from './pages/Dashboard';
import TransactionsPage from './pages/TransactionsPage';
import CategoriesPage from './pages/CategoriesPage';
import RulesPage from './pages/RulesPage';
import BudgetPage from './pages/BudgetPage';
import ReportsPage from './pages/ReportsPage';
import AgentPage from './pages/AgentPage';

// iOS kills the backgrounded PWA, and relaunch always lands on "/". Remember
// the last page visited so the "/" redirect resumes where the user left off.
function RememberLastPage() {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== '/') localStorage.setItem('last-page', location.pathname);
  }, [location.pathname]);
  return null;
}

// "/" → last visited page (or the dashboard on a truly fresh start)
function HomeRedirect() {
  const last = localStorage.getItem('last-page');
  return <Navigate to={last && last !== '/' ? last : '/dashboard'} replace />;
}

export default function App() {
  return (
    <YNABProvider>
      <BrowserRouter>
        <RememberLastPage />
        <AppShellLayout>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/income" element={<RulesPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            {/* legacy path — keep old bookmarks working */}
            <Route path="/rules" element={<Navigate to="/income" replace />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </AppShellLayout>
      </BrowserRouter>
    </YNABProvider>
  );
}
