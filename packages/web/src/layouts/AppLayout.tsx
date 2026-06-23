import { Outlet, NavLink, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Clock,
  Users,
  Wallet,
  ClipboardCheck,
  CalendarDays,
  Settings,
  FileText,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/attendance', label: 'Chấm công', icon: Clock },
  { to: '/employees', label: 'Nhân sự', icon: Users },
  { to: '/payroll', label: 'Bảng lương', icon: Wallet },
  { to: '/approvals', label: 'Phê duyệt', icon: ClipboardCheck },
  { to: '/leave', label: 'Nghỉ phép', icon: CalendarDays },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
  { to: '/audit', label: 'Audit Log', icon: FileText },
] as const;

const sidebarVariants = {
  expanded: { width: 240 },
  collapsed: { width: 64 },
};

const springTransition = {
  type: 'spring' as const,
  damping: 25,
  stiffness: 300,
};

export function AppLayout() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <motion.aside
        className="flex flex-col border-r border-border bg-card"
        variants={sidebarVariants}
        animate={sidebarCollapsed ? 'collapsed' : 'expanded'}
        transition={springTransition}
        initial={false}
      >
        {/* Sidebar Header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            A
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                className="flex flex-col overflow-hidden"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={springTransition}
              >
                <span className="text-sm font-bold text-foreground whitespace-nowrap">
                  ASNOVA
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Payroll
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={`
                      group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-colors duration-150
                      ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }
                    `}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <AnimatePresence>
                      {!sidebarCollapsed && (
                        <motion.span
                          className="overflow-hidden whitespace-nowrap"
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={springTransition}
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse Toggle */}
        <div className="border-t border-border p-2">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center rounded-lg p-2.5 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            title={sidebarCollapsed ? 'Mở rộng' : 'Thu gọn'}
          >
            {sidebarCollapsed ? (
              <ChevronsRight className="h-5 w-5" />
            ) : (
              <ChevronsLeft className="h-5 w-5" />
            )}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
