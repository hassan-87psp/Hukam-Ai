import { Bell, Brain, Database, FolderLock, Image as ImageIcon, KeyRound, Languages, Lock, Monitor, Palette, ShieldCheck, Trash2, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ACTIONS } from '../../../../packages/command-protocol/src/index';
import type { ActionName } from '../../../../packages/shared-types/src/index';
import { Badge, Card, PageHeader, Segmented, Toggle } from '../components/ui';
import { PageFrame } from '../layouts/AppShell';
import { ACTION_LABEL, bytes, dateTime, timeAgo } from '../lib/format';
import { del, get, patch, post, useStore } from '../services/store';
import { Slider } from './Voice';

function Section({ id, icon, title, children, desc }: { id: string; icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24 p-5">
      <div className="mb-3 flex items-center gap-2.5"><span className="text-ice">{icon}</span><h2 className="font-display text-lg font-semibold">{title}</h2></div>
      {desc && <p className="-mt-1 mb-3 text-sm text-ink2">{desc}</p>}
      {children}
    </Card>
  );
}

const SECTIONS = [
  ['profile', 'Profile'], ['appearance', 'Theme'], ['language', 'Language & voice'], ['notifications', 'Notifications'], ['devices', 'Pairing & permissions'],
  ['files', 'File access'], ['screens', 'Screenshot sharing'], ['confirm', 'Confirmation rules'], ['history', 'Command history'], ['security', 'Security'],
  ['ai', 'AI engine'], ['privacy', 'Privacy & retention'],
];

const OPTIONAL_APPROVAL: ActionName[] = ['screen.capture', 'file.open', 'app.open', 'web.open', 'folder.open', 'youtube.play', 'whatsapp.open', 'whatsapp.check'];

export default function Settings() {
  const { user, setUser, settings, saveSettings, devices, toast } = useStore();
  const [name, setName] = useState(user?.name ?? '');
  const [sessions, setSessions] = useState<any[]>([]);
  const [shots, setShots] = useState<any[]>([]);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [system, setSystem] = useState<any>(null);
  const loadSessions = () => get('/api/auth/sessions').then(setSessions).catch(() => {});
  const loadShots = () => get('/api/screenshots').then(setShots).catch(() => {});
  useEffect(() => {
    loadSessions();
    loadShots();
    get('/api/system').then(setSystem).catch(() => {});
  }, []);
  const notifPerm = 'Notification' in window ? Notification.permission : 'unsupported';

  return (
    <PageFrame>
      <PageHeader title="Settings" subtitle="Everything that controls what HUKM can do — and what it keeps." />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="sticky top-24 hidden h-fit flex-col gap-0.5 lg:flex" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-lg px-3 py-1.5 text-sm text-ink2 hover:bg-field/50 hover:text-ink">{label}</a>)}
        </nav>
        <div className="space-y-5">
          <Section id="profile" icon={<User className="h-5 w-5" />} title="Profile">
            <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => { e.preventDefault(); const r = await patch('/api/auth/me', { name }); setUser(r.user); toast({ title: 'Profile saved', tone: 'ok' }); }}>
              <div><label className="label" htmlFor="pn">Name</label><input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
              <div><label className="label">Email</label><input className="input opacity-70" value={user?.email ?? ''} readOnly /></div>
              <div className="flex items-end"><button className="btn-primary w-full">Save</button></div>
            </form>
          </Section>

          <Section id="appearance" icon={<Palette className="h-5 w-5" />} title="Theme & motion">
            <div className="flex flex-wrap items-center gap-6">
              <div><p className="label">Theme</p><Segmented value={settings.theme} onChange={(v) => saveSettings({ theme: v })} options={[{ value: 'dark', label: 'Midnight Navy' }, { value: 'light', label: 'Light' }]} /></div>
              <div><p className="label">Reduced motion</p><Segmented value={settings.reducedMotion} onChange={(v) => saveSettings({ reducedMotion: v })} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></div>
            </div>
            <Toggle checked={settings.audioReactiveOrb} onChange={(v) => saveSettings({ audioReactiveOrb: v })} label="Audio-reactive brain while listening" description="Uses the microphone level to animate the orb. Some phones can’t share the mic between this and speech recognition — turn off if voice input fails." />
          </Section>

          <Section id="language" icon={<Languages className="h-5 w-5" />} title="Language & voice">
            <p className="label">Reply language</p>
            <Segmented value={settings.responseLang} onChange={(v) => saveSettings({ responseLang: v })} options={[{ value: 'roman', label: 'Roman Urdu' }, { value: 'ur', label: 'اردو' }, { value: 'en', label: 'English' }]} />
            <p className="mt-2 text-xs text-ink2">Roman Urdu select karne par HUKM replies Roman letters mein likhay aur bolay ga. Browser ki voice ke hisaab se English accent ho sakta hai.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Slider label="Speech speed" min={0.5} max={2} step={0.1} value={settings.speechRate} fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => saveSettings({ speechRate: v })} />
              <Slider label="Volume" min={0} max={1} step={0.05} value={settings.speechVolume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => saveSettings({ speechVolume: v })} />
            </div>
            <Toggle checked={!settings.speechMuted} onChange={(v) => saveSettings({ speechMuted: !v })} label="Speak replies aloud" />
            <Link to="/voice" className="text-sm font-semibold text-blue2">Voice selection & recognition language →</Link>
          </Section>

          <Section id="notifications" icon={<Bell className="h-5 w-5" />} title="Notifications">
            <Toggle checked={settings.notifications.toasts} onChange={(v) => saveSettings({ notifications: { ...settings.notifications, toasts: v } })} label="In-app notifications" description="Failures are always shown." />
            <Toggle checked={settings.notifications.browser} disabled={notifPerm === 'unsupported' || notifPerm === 'denied'}
              onChange={async (v) => {
                if (v && notifPerm !== 'granted') {
                  const p = await Notification.requestPermission();
                  if (p !== 'granted') return toast({ title: 'Browser blocked notifications', tone: 'warn' });
                }
                saveSettings({ notifications: { ...settings.notifications, browser: v } });
              }}
              label="Browser notifications" description={notifPerm === 'unsupported' ? 'Not supported in this browser.' : notifPerm === 'denied' ? 'Blocked in browser settings.' : 'Shown when this tab is in the background.'} />
          </Section>

          <Section id="devices" icon={<Monitor className="h-5 w-5" />} title="Device pairing & controller permissions">
            <p className="text-sm text-ink2">{devices.length} paired device(s). Pair, pause, remove and choose capabilities per device.</p>
            <Link to="/devices" className="btn-ghost mt-3">Manage devices</Link>
          </Section>

          <Section id="files" icon={<FolderLock className="h-5 w-5" />} title="File access" desc="Which folders the controller may search and open is decided on the laptop itself, so a stolen web session can’t widen it.">
            {devices.map((d) => (
              <div key={d.id} className="mb-3 rounded-xl bg-field/40 p-3 ring-1 ring-line/10">
                <p className="text-sm font-semibold">{d.name}</p>
                {d.controllerConfig?.allowedDirs.length ? d.controllerConfig.allowedDirs.map((x) => <p key={x.path} className="truncate text-xs text-ink2">✓ {x.path}</p>) : <p className="text-xs text-ink2">Not reported yet.</p>}
              </div>
            ))}
            <p className="text-xs text-ink2">To change: on the laptop run <code className="rounded bg-field px-1">hukm-controller config</code>, edit <code className="rounded bg-field px-1">allowed_folders</code> / <code className="rounded bg-field px-1">extra_allowed_dirs</code> in the file it shows, then restart the controller. Executables and scripts (.exe, .bat, .ps1, .lnk…) are never opened.</p>
          </Section>

          <Section id="screens" icon={<ImageIcon className="h-5 w-5" />} title="Screenshot sharing">
            <Toggle checked={settings.approvalRequired['screen.capture'] !== false} onChange={(v) => saveSettings({ approvalRequired: { ...settings.approvalRequired, 'screen.capture': v } })} label="Ask before every screenshot" description="Recommended. Screenshots are only ever taken on request — never continuously." />
            <Slider label="Keep screenshots for" min={1} max={168} step={1} value={settings.screenshotRetentionHours} fmt={(v) => (v < 24 ? `${v} h` : `${Math.round(v / 24)} day(s)`)} onChange={(v) => saveSettings({ screenshotRetentionHours: v })} />
            <p className="mt-4 label">Stored screenshots ({shots.length})</p>
            <ul className="space-y-1">
              {shots.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg bg-field/30 px-3 py-1.5 text-xs">
                  <span>{dateTime(s.createdAt)} · {s.width}×{s.height} · {bytes(s.bytes)} · expires {timeAgo(s.expiresAt).replace(' ago', '')}</span>
                  <button className="text-ink2 hover:text-bad" onClick={async () => { await del(`/api/screenshots/${s.id}`); loadShots(); }} aria-label="Delete screenshot"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
              {!shots.length && <li className="text-xs text-ink2">None stored.</li>}
            </ul>
          </Section>

          <Section id="confirm" icon={<ShieldCheck className="h-5 w-5" />} title="Confirmation rules" desc="Actions that wait for your explicit approval before running.">
            <div className="divide-y divide-line/10">
              {(['whatsapp.compose', 'system.lock'] as ActionName[]).map((a) => (
                <Toggle key={a} checked disabled onChange={() => {}} label={<>{ACTION_LABEL[a]} <Badge tone="muted" className="ml-1">always</Badge></>} description="Can’t be turned off." />
              ))}
              {OPTIONAL_APPROVAL.map((a) => (
                <Toggle key={a} checked={settings.approvalRequired[a] ?? !!ACTIONS[a].defaultApprove} onChange={(v) => saveSettings({ approvalRequired: { ...settings.approvalRequired, [a]: v } })} label={ACTION_LABEL[a]} />
              ))}
            </div>
            <p className="mt-2 text-xs text-ink2">Deleting/modifying files, installing programs, shutdown and payments are not possible through HUKM V1 at all.</p>
          </Section>

          <Section id="history" icon={<Database className="h-5 w-5" />} title="Command history">
            <Slider label="Keep finished commands & audit log for" min={1} max={365} step={1} value={settings.historyRetentionDays} fmt={(v) => `${v} days`} onChange={(v) => saveSettings({ historyRetentionDays: v })} />
            <Link to="/history" className="btn-ghost mt-3">Open history</Link>
          </Section>

          <Section id="security" icon={<Lock className="h-5 w-5" />} title="Security">
            <p className="label">Signed-in sessions</p>
            <ul className="mb-3 space-y-1.5">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-field/40 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate">{s.current && <Badge tone="ok" className="mr-2">this device</Badge>}{s.userAgent?.slice(0, 70) || 'Unknown'} · {s.ip} · active {timeAgo(s.lastSeen)}</span>
                  {!s.current && <button className="text-ink2 hover:text-bad" onClick={async () => { await del(`/api/auth/sessions/${s.id}`); loadSessions(); }}>Revoke</button>}
                </li>
              ))}
            </ul>
            <button className="btn-ghost" onClick={async () => { await post('/api/auth/logout-others'); loadSessions(); toast({ title: 'Other sessions signed out', tone: 'ok' }); }}>Sign out all other sessions</button>
            <form className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post('/api/auth/password', pw);
                setPw({ current: '', next: '' });
                toast({ title: 'Password changed; other sessions signed out', tone: 'ok' });
                loadSessions();
              } catch (err) {
                toast({ title: 'Password not changed', body: (err as Error).message, tone: 'bad' });
              }
            }}>
              <div><label className="label" htmlFor="cp">Current password</label><input id="cp" type="password" className="input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></div>
              <div><label className="label" htmlFor="np">New password (10+ chars)</label><input id="np" type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={10} /></div>
              <div className="flex items-end"><button className="btn-primary w-full" disabled={!pw.current || pw.next.length < 10}><KeyRound className="h-4 w-4" /> Change</button></div>
            </form>
          </Section>

          <Section id="ai" icon={<Brain className="h-5 w-5" />} title="AI engine" desc="Version 1 needs no paid AI service. Commands are understood by a local rule-based engine.">
            <ul className="space-y-1.5">
              {(system?.providers ?? []).map((p: any) => (
                <li key={p.id} className="flex items-center justify-between rounded-xl bg-field/40 px-3 py-2 text-sm">
                  <span>{p.label}</span>
                  {p.status === 'active' ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="muted">Not connected</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink2">A ChatGPT Plus subscription is not an API for third-party apps. See docs/integration-status.md for what has (and hasn’t) been verified.</p>
          </Section>

          <Section id="privacy" icon={<ShieldCheck className="h-5 w-5" />} title="Privacy & data retention">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink2">
              <li>Data lives in your own relay’s database (data/hukm.db) — no third-party analytics.</li>
              <li>Voice is transcribed by your browser’s speech service; HUKM stores only the resulting text.</li>
              <li>No hidden capture: the controller shows a visible window while connected, and never records the webcam or microphone.</li>
              <li>Screenshots: {settings.screenshotRetentionHours} h · Commands & audit: {settings.historyRetentionDays} days · Chat transcript: this browser only.</li>
            </ul>
          </Section>
        </div>
      </div>
    </PageFrame>
  );
}
