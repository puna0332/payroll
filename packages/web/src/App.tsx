import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { ToastProvider } from './components/ui/Toast';
import { Agentation } from 'agentation';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Leave = lazy(() => import('./pages/Leave'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));

function PageFallback() {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-6">
      <div className="w-full max-w-3xl space-y-5">
        <div className="h-8 w-48 animate-pulse rounded-md bg-slate-200" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 animate-pulse rounded-xl bg-white shadow-sm ring-1 ring-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-white shadow-sm ring-1 ring-slate-200" />
          <div className="h-28 animate-pulse rounded-xl bg-white shadow-sm ring-1 ring-slate-200" />
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-white shadow-sm ring-1 ring-slate-200" />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeDetail />} />
            <Route path="payroll" element={<Payroll />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="leave" element={<Leave />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit" element={<Audit />} />
          </Route>
        </Routes>
      </Suspense>
      {import.meta.env.DEV && <Agentation />}
    </ToastProvider>
  );
}
