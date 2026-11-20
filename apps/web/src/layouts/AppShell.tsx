import {
  Bell, ChevronDown, ChevronsLeft, ChevronsRight, FolderOpen, Globe, History, Home, LayoutDashboard, LogOut, Menu, MessageCircle,
  MessagesSquare, Mic, Monitor, MoreHorizontal, OctagonX, Settings, ShieldAlert, User, X, Zap, FolderKanban,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import Toasts from '../components/Toasts';
import { cx, StatusDot } from '../components/ui';
import { commandTitle } from '../features/command/CommandCard';
import { clock, timeAgo } from '../lib/format';
import { post, useStore } from '../services/store';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'AI Chat', icon: MessagesSquare },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/voice', label: 'Voice', icon: Mic },
  { to: '/devices', label: 'Devices', icon: Monitor },
  { to: '/automations', label: 'Automations', icon: Zap },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { to: '/browser', label: 'Browser', icon: Globe },
  { to: '/history', label: 'Activity History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function DevicePill() {
  const { devices, realtime } = useStore();
  const d = devices.find((x) => x.online) ?? devices[0];
  const nav = useNavigate();
  let label = 'No device';
  let tone = 'text-ink2 ring-line/20 bg-field/50';
  if (realtime !== 'open') {
    label = realtime === 'connecting' ? 'Connecting…' : 'Reconnecting…';
    tone = 'text-warn ring-warn/30 bg-warn/10';
  } else if (d?.online && d.paused) {
    label = 'Paused';
    tone = 'text-warn ring-warn/30 bg-warn/10';
  } else if (d?.online) {
    label = 'Online';
    tone = 'text-ok ring-ok/35 bg-ok/10';
  } else if (d) {
    label = 'Offline';
    tone = 'text-ink2 ring-line/20 bg-field/50';
  }
  return (
    <button onClick={() => nav('/devices')} className={cx('chip px-3 py-1.5 ring-1 transition hover:brightness-110', tone)} title={d ? `${d.name} — ${d.online ? 'online' : `last seen ${timeAgo(d.lastSeen)}`}` : 'Pair a laptop'}>
      <StatusDot online={!!d?.online && !d.paused && realtime === 'open'} />
      <span className="text-[13px]">{label}</span>
    </button>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, close]);
  return ref;
}

function Notifications() {
  const { approvals, commands, approve, reject } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const failures = commands.filter((c) => (c.status === 'failed' || c.status === 'timed_out') && Date.now() - Date.parse(c.createdAt) < 86400_000).slice(0, 5);
  const count = approvals.length;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative grid h-10 w-10 place-items-center rounded-xl text-ink2 ring-1 ring-line/15 transition hover:text-ink" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-[11px] font-bold text-bg">{count}</span>}
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-12 z-50 w-[min(92vw,360px)] animate-fade-up rounded-2xl p-3">
          <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-ink2">Needs your approval</p>
          {approvals.length === 0 && <p className="px-1 pb-3 text-sm text-ink2">Nothing waiting.</p>}
          {approvals.map((c) => (
            <div key={c.id} className="mb-2 rounded-xl bg-warn/[0.07] p-3 ring-1 ring-warn/25">
              <p className="flex items-center gap-2 text-sm font-medium"><ShieldAlert className="h-4 w-4 text-warn" /> <span className="truncate" dir="auto">{commandTitle(c)}</span></p>
              <div className="mt-2 flex gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => approve(c.id)}>Approve</button>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => reject(c.id)}>Cancel</button>
              </div>
            </div>
          ))}
          {failures.length > 0 && <p className="px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-ink2">Recent problems</p>}
          {failures.map((c) => (
            <div key={c.id} className="rounded-lg px-2 py-1.5 text-sm">
              <p className="truncate" dir="auto">{commandTitle(c)}</p>
              <p className="truncate text-xs text-bad">{clock(c.createdAt)} · {c.error?.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const { user, logout } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const nav = useNavigate();
  const initial = (user?.name ?? 'U').slice(0, 1).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-xl p-1 pr-2 transition hover:bg-field/50" aria-label="Account">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-blue2 to-blue font-display font-bold text-white ring-2 ring-ice/30">{initial}</span>
        <ChevronDown className="hidden h-4 w-4 text-ink2 sm:block" />
      </button>
      {open && (
        <div className="glass-strong absolute right-0 top-12 z-50 w-60 animate-fade-up rounded-2xl p-2">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-ink2">{user?.email}</p>
          </div>
          <button className="nav-item w-full" onClick={() => { setOpen(false); nav('/settings'); }}><User className="h-4 w-4" /> Profile & settings</button>
          <button className="nav-item w-full text-bad" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      )}
    </div>
  );
}

function EmergencyStop({ compact }: { compact?: boolean }) {
  const { devices, toast, refresh } = useStore();
  if (!devices.length) return null;
  const allPaused = devices.every((d) => d.paused);
  return (
    <button
      onClick={async () => {
        if (allPaused) return;
        const r = await post<{ paused: number }>('/api/emergency-stop');
        toast({ title: 'Emergency stop', body: `${r.paused} device(s) paused and all running commands cancelled. Resume from Devices.`, tone: 'warn' });
        refresh();
      }}
      disabled={allPaused}
      title="Emergency stop: pause all devices and cancel running commands"
      className={cx('flex items-center gap-1.5 rounded-xl font-semibold ring-1 transition', allPaused ? 'text-ink2 ring-line/15' : 'text-bad ring-bad/40 hover:bg-bad/10', compact ? 'h-10 w-10 justify-center' : 'h-10 px-3 text-sm')}
    >
      <OctagonX className="h-[18px] w-[18px]" />
      {!compact && (allPaused ? 'Paused' : 'Stop')}
    </button>
  );
}

function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const { devices, user } = useStore();
  const d = devices.find((x) => x.online) ?? devices[0];
  return (
    <aside className={cx('glass sticky top-0 hidden h-screen shrink-0 flex-col border-y-0 border-l-0 px-3 py-5 transition-[width] duration-300 lg:flex', collapsed ? 'w-[84px]' : 'w-[268px]')}>
      <div className={cx('mb-7 flex items-center', collapsed ? 'justify-center' : 'justify-between px-2')}>
        <Logo collapsed={collapsed} />
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto scroll-thin" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('nav-item', isActive && 'active', collapsed && 'justify-center px-0')} title={collapsed ? n.label : undefined}>
            <n.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{n.label}</span>}
          </NavLink>
        ))}
      </nav>
      {!collapsed && (
        <div className="relative mt-4 overflow-hidden rounded-2xl p-4 ring-1 ring-ice/15" style={{ background: 'linear-gradient(160deg, rgb(var(--surface)/.9), rgb(var(--bg2)/.9))' }}>
          <svg className="pointer-events-none absolute -bottom-1 left-0 h-12 w-full opacity-60" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden>
            <path d="M0 50 C40 50 50 20 90 28 S150 55 200 10" fill="none" stroke="rgb(var(--blue2))" strokeWidth="2" />
            <path d="M0 56 C50 54 70 34 110 38 S160 50 200 24" fill="none" stroke="rgb(var(--ice))" strokeOpacity=".5" strokeWidth="1.2" />
          </svg>
          <p className="font-display text-lg font-bold">HUKM <span className="text-gradient">AI</span></p>
          <p className="mb-6 mt-1 text-xs leading-relaxed text-ink2">Control your devices, apps and work — with natural language.</p>
        </div>
      )}
      <div className={cx('mt-4 flex items-center gap-3 rounded-xl p-2', collapsed && 'justify-center')}>
        <StatusDot online={!!d?.online} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{d ? d.name : 'No laptop paired'}</p>
            <p className="truncate text-xs text-ink2">{d ? (d.online ? (d.paused ? 'Paused' : 'Connected') : `Last seen ${timeAgo(d.lastSeen)}`) : 'Go to Devices'}</p>
          </div>
        )}
      </div>
      <div className={cx('mt-1 flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between px-2')}>
        {!collapsed && <p className="truncate text-xs text-ink2">{user?.email}</p>}
        <button onClick={() => setCollapsed(!collapsed)} className="rounded-lg p-1.5 text-ink2 hover:bg-field hover:text-ink" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-strong safe-top absolute inset-y-0 left-0 flex w-[82%] max-w-xs animate-fade-up flex-col p-4">
        <div className="mb-6 flex items-center justify-between">
          <Logo small />
          <button onClick={onClose} className="rounded-lg p-2 text-ink2" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose} className={({ isActive }) => cx('nav-item', isActive && 'active')}>
              <n.icon className="h-5 w-5" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-4"><EmergencyStop /></div>
      </div>
    </div>
  );
}

const BOTTOM = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/chat', label: 'Chat', icon: MessagesSquare },
  { to: '/voice', label: 'Voice', icon: Mic },
  { to: '/devices', label: 'Devices', icon: Monitor },
];

function BottomNav({ onMore }: { onMore: () => void }) {
  const loc = useLocation();
  const moreActive = !BOTTOM.some((b) => (b.end ? loc.pathname === b.to : loc.pathname.startsWith(b.to)));
  return (
    <nav className="glass-strong safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 lg:hidden" aria-label="Bottom">
      <div className="mx-auto grid max-w-lg grid-cols-5 px-2 pt-1.5">
        {BOTTOM.map((b) => (
          <NavLink key={b.to} to={b.to} end={b.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition', isActive ? 'text-white' : 'text-ink2')}>
            {({ isActive }) => (
              <>
                <span className={cx('grid h-8 w-12 place-items-center rounded-xl transition', isActive && 'bg-blue shadow-[0_6px_20px_-6px_rgb(var(--blue))]')}>
                  <b.icon className="h-[19px] w-[19px]" />
                </span>
                <span className={isActive ? 'text-ink' : ''}>{b.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button onClick={onMore} className={cx('flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium', moreActive ? 'text-ink' : 'text-ink2')}>
          <span className={cx('grid h-8 w-12 place-items-center rounded-xl', moreActive && 'bg-blue text-white')}><MoreHorizontal className="h-[19px] w-[19px]" /></span>
          More
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const items = NAV.filter((n) => !['/', '/chat', '/voice', '/devices'].includes(n.to));
  return (
    <div className="fixed inset-0 z-[70] lg:hidden">
      <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-strong safe-bottom absolute inset-x-0 bottom-0 animate-fade-up rounded-t-3xl p-4 pb-6">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink2/30" />
        <div className="grid grid-cols-3 gap-3">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={onClose} className={({ isActive }) => cx('flex flex-col items-center gap-2 rounded-2xl p-3 text-center text-xs font-medium ring-1 transition', isActive ? 'bg-blue/20 text-ink ring-ice/40' : 'bg-field/40 text-ink2 ring-line/10')}>
              <n.icon className="h-6 w-6 text-ice" /> {n.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1440px] px-4 pb-28 pt-4 sm:px-6 lg:px-8 lg:pb-10', className)}>{children}</div>;
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hukm.sidebar') === '1');
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const title = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ?? 'HUKM AI';
  useEffect(() => localStorage.setItem('hukm.sidebar', collapsed ? '1' : '0'), [collapsed]);
  useEffect(() => {
    document.title = `${title} · HUKM AI`;
  }, [title]);

  return (
    <div className="neural-bg relative flex min-h-screen">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* desktop top bar */}
        <header className="sticky top-0 z-30 hidden items-center justify-between gap-4 px-8 py-4 backdrop-blur-md lg:flex" style={{ background: 'linear-gradient(180deg, rgb(var(--bg)/.85), rgb(var(--bg)/.0))' }}>
          <h2 className="font-display text-lg font-semibold text-ink2">{title}</h2>
          <div className="flex items-center gap-3">
            <DevicePill />
            <EmergencyStop />
            <Notifications />
            <AccountMenu />
          </div>
        </header>
        {/* mobile header */}
        <header className="safe-top sticky top-0 z-30 flex items-center justify-between gap-2 px-4 py-3 backdrop-blur-md lg:hidden" style={{ background: 'linear-gradient(180deg, rgb(var(--bg)/.92), rgb(var(--bg)/.55))' }}>
          <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-xl text-ink2" aria-label="Open menu"><Menu className="h-6 w-6" /></button>
          <Logo small />
          <div className="flex items-center gap-2">
            <DevicePill />
            <Notifications />
          </div>
        </header>
        <main className="relative flex-1">
          <Outlet />
        </main>
      </div>
      <BottomNav onMore={() => setMore(true)} />
      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
      <Toasts />
    </div>
  );
}

export { EmergencyStop };
