import { ArrowRight, CheckCircle2, Clock3, FolderOpen, FolderKanban, Globe, History, Layers, Maximize2, MessageCircle, MessageSquareReply, Mic, Monitor, MonitorSmartphone, Laptop, Square, Youtube, Zap } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LaptopArt, PhoneArt } from '../components/Illustrations';
import QuickPrompt from '../components/QuickPrompt';
import { Badge, Card, CardHeader, cx, EmptyState, Modal, StatusDot } from '../components/ui';
import { ActionIcon, CommandRow, commandTitle, StatusIcon } from '../features/command/CommandCard';
import CommandComposer from '../features/command/CommandComposer';
import Waveform from '../features/command/Waveform';
import { useMediaQuery, useReducedMotion, useVoiceInput } from '../hooks/useVoice';
import { PageFrame } from '../layouts/AppShell';
import { clock, duration, STATUS_LABEL, timeAgo } from '../lib/format';
import { useStore, type BrainState } from '../services/store';
import { get } from '../services/api';

const BrainOrb = lazy(() => import('../features/brain/BrainOrb'));

const BRAIN_CAPTION: Record<BrainState, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  processing: 'Processing command…',
  executing: 'Executing on your laptop…',
  success: 'Done',
  error: 'Needs attention',
  offline: 'Laptop offline — commands will queue',
};

function Orb({ className }: { className: string }) {
  const { brain, audioLevel } = useStore();
  const reduced = useReducedMotion();
  return (
    <div className={cx('relative', className)}>
      <Suspense fallback={<div className="h-full w-full" />}>
        <BrainOrb state={brain} level={audioLevel} reducedMotion={reduced} className="h-full w-full" />
      </Suspense>
    </div>
  );
}

function useQuickActions() {
  const { runAction } = useStore();
  const nav = useNavigate();
  const [prompt, setPrompt] = useState<null | 'youtube' | 'web'>(null);
  const actions = [
    { key: 'file', label: 'Open File', icon: FolderOpen, color: 'text-[#f5c451]', run: () => nav('/files') },
    { key: 'yt', label: 'Play YouTube', icon: Youtube, color: 'text-[#ff4e45]', run: () => setPrompt('youtube') },
    { key: 'wa', label: 'Check WhatsApp', icon: MessageCircle, color: 'text-[#25D366]', run: () => runAction('whatsapp.check', {}, { label: 'WhatsApp check karo', source: 'quick' }) },
    { key: 'reply', label: 'Reply Message', icon: MessageSquareReply, color: 'text-ice', run: () => nav('/whatsapp#compose') },
    { key: 'web', label: 'Search Browser', icon: Globe, color: 'text-blue2', run: () => setPrompt('web') },
  ];
  const modal = (
    <QuickPrompt
      open={!!prompt}
      onClose={() => setPrompt(null)}
      title={prompt === 'youtube' ? 'Play on YouTube' : 'Search the web'}
      placeholder={prompt === 'youtube' ? 'e.g. Gold analysis' : 'e.g. Forex news'}
      cta={prompt === 'youtube' ? 'Play' : 'Search'}
      onSubmit={(q) => (prompt === 'youtube' ? runAction('youtube.play', { query: q }, { label: `YouTube par ${q} play karo`, source: 'quick' }) : runAction('web.search', { query: q }, { label: `Browser mein ${q} search karo`, source: 'quick' }))}
    />
  );
  return { actions, modal };
}

function ConnectedLaptop() {
  const { devices } = useStore();
  const d = devices.find((x) => x.online) ?? devices[0];
  return (
    <Card className="p-0">
      <CardHeader icon={<Laptop className="h-5 w-5" />} title="Connected Laptop" action={<Link to="/devices" className="text-ink2 hover:text-ink" aria-label="Devices"><ArrowRight className="h-4 w-4" /></Link>} />
      {d ? (
        <div className="flex items-center gap-4 px-5 pb-5 pt-3">
          <LaptopArt className="h-20 w-28 shrink-0" on={d.online} />
          <div className="min-w-0">
            <p className={cx('flex items-center gap-2 text-sm font-medium', d.online ? 'text-ok' : 'text-ink2')}>
              <StatusDot online={d.online && !d.paused} /> {d.online ? (d.paused ? 'Paused' : 'Online') : 'Offline'}
            </p>
            <p className="mt-1 truncate font-display text-lg font-semibold">{d.name}</p>
            <p className="truncate text-xs text-ink2">
              {d.os ?? 'Windows'} {d.osVersion?.split(' ')[0]} · {d.online ? 'Active now' : `Last seen ${timeAgo(d.lastSeen)}`}
            </p>
            {d.online && d.stats && (
              <p className="mt-1 text-[11px] text-ink2">CPU {Math.round(d.stats.cpu ?? 0)}% · RAM {Math.round(d.stats.memory ?? 0)}%{d.stats.battery != null ? ` · 🔋 ${d.stats.battery}%` : ''}</p>
            )}
          </div>
        </div>
      ) : (
        <EmptyState icon={<Laptop className="h-5 w-5" />} title="No laptop paired" body="Pair your Windows laptop to start sending commands." action={<Link to="/devices" className="btn-primary">Pair laptop</Link>} />
      )}
    </Card>
  );
}

function ThisSession() {
  const { realtime } = useStore();
  const mobile = useMediaQuery('(max-width: 1023px)');
  const online = realtime === 'open';
  const pwa = window.matchMedia('(display-mode: standalone)').matches;
  return (
    <Card className="p-0">
      <CardHeader icon={<MonitorSmartphone className="h-5 w-5" />} title={mobile ? 'Mobile Web App' : 'This Web Session'} />
      <div className="flex items-center gap-4 px-5 pb-5 pt-3">
        <PhoneArt className="h-20 w-12 shrink-0" on={online} />
        <div className="min-w-0">
          <p className={cx('flex items-center gap-2 text-sm font-medium', online ? 'text-ok' : 'text-warn')}><StatusDot online={online} /> {online ? 'Online' : 'Reconnecting'}</p>
          <p className="mt-1 font-display text-lg font-semibold">HUKM AI {mobile ? 'Mobile' : 'Web'}</p>
          <p className="text-xs text-ink2">{pwa ? 'Installed app' : 'Web app'} · {online ? 'Live sync' : 'Sync paused'}</p>
        </div>
      </div>
    </Card>
  );
}

function ScreenPreview() {
  const { commands, runAction, activeDevice } = useStore();
  const [zoom, setZoom] = useState(false);
  const last = commands.find((c) => c.action === 'screen.capture' && c.status === 'completed' && c.screenshotId);
  const pending = commands.find((c) => c.action === 'screen.capture' && ['pending', 'running', 'awaiting_approval'].includes(c.status));
  return (
    <Card className="p-0">
      <CardHeader
        icon={<Monitor className="h-5 w-5" />}
        title="Screen Preview"
        action={last ? <Badge tone="muted">Snapshot · {clock(last.finishedAt ?? last.createdAt)}</Badge> : <Badge tone="muted">On request</Badge>}
      />
      <div className="px-5 pb-5 pt-3">
        {last ? (
          <button onClick={() => setZoom(true)} className="group relative block w-full overflow-hidden rounded-xl ring-1 ring-line/15">
            <img src={`/api/screenshots/${last.screenshotId}`} alt="Latest authorised screenshot" className="aspect-video w-full object-cover" loading="lazy" />
            <span className="absolute bottom-2 right-2 rounded-lg bg-bg/70 p-1.5 opacity-80 group-hover:opacity-100"><Maximize2 className="h-4 w-4" /></span>
          </button>
        ) : (
          <div className="grid h-[132px] place-items-center rounded-xl bg-field/40 text-center ring-1 ring-line/10">
            <p className="px-4 text-xs text-ink2">No screenshot yet. Captures happen only when you ask — and need your approval.</p>
          </div>
        )}
        <button
          className="btn-ghost mt-3 w-full py-2"
          disabled={!activeDevice?.online || !!pending}
          onClick={() => runAction('screen.capture', {}, { label: 'Laptop ki screen dikhao', source: 'quick' })}
        >
          <Monitor className="h-4 w-4" /> {pending ? STATUS_LABEL[pending.status] : 'Capture screen'}
        </button>
      </div>
      {last && (
        <Modal open={zoom} onClose={() => setZoom(false)} title={`Screenshot · ${clock(last.finishedAt ?? last.createdAt)}`} wide>
          <img src={`/api/screenshots/${last.screenshotId}`} alt="Screenshot full size" className="w-full rounded-xl" />
        </Modal>
      )}
    </Card>
  );
}

function RecentCommands({ limit = 4 }: { limit?: number }) {
  const { commands } = useStore();
  const nav = useNavigate();
  const list = commands.filter((c) => c.action !== 'command.cancel').slice(0, limit);
  return (
    <Card className="p-0">
      <CardHeader icon={<History className="h-5 w-5" />} title="Recent Commands" action={<Link to="/history" className="flex items-center gap-1 text-xs font-semibold text-blue2">View All <ArrowRight className="h-3.5 w-3.5" /></Link>} />
      <div className="px-3 pb-3 pt-2">
        {list.length ? list.map((c) => <CommandRow key={c.id} c={c} onClick={() => nav('/history?id=' + c.id)} />) : <p className="px-2 py-6 text-center text-sm text-ink2">No commands yet. Try “Downloads folder kholo”.</p>}
      </div>
    </Card>
  );
}

function CommandStatusCard() {
  const { commands, cancel } = useStore();
  const c = commands.find((x) => x.action !== 'command.cancel');
  return (
    <Card className="p-0">
      <CardHeader icon={<Layers className="h-5 w-5" />} title="Command Status" />
      {c ? (
        <div className="flex items-center gap-4 px-5 pb-5 pt-4">
          <div className={cx('grid h-16 w-16 shrink-0 place-items-center rounded-full ring-2', c.status === 'completed' ? 'text-ok ring-ok/40 shadow-[0_0_30px_-6px_rgb(var(--ok))]' : c.status === 'failed' ? 'text-bad ring-bad/40' : 'text-blue2 ring-blue2/40 shadow-[0_0_30px_-6px_rgb(var(--blue))]')}>
            {c.status === 'completed' ? <CheckCircle2 className="h-8 w-8" /> : <span className="scale-[1.8]"><StatusIcon c={c} /></span>}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-ink2">{['pending', 'running', 'awaiting_approval'].includes(c.status) ? 'Current command' : 'Last command'}</p>
            <p className="font-display text-lg font-semibold">{STATUS_LABEL[c.status]}</p>
            <p className="truncate text-xs text-ink2" dir="auto">“{commandTitle(c)}” {c.durationMs != null ? `· ${duration(c.durationMs)}` : ''}</p>
            {['pending', 'running'].includes(c.status) && (
              <button onClick={() => cancel(c.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-bad"><Square className="h-3 w-3" /> Cancel</button>
            )}
          </div>
        </div>
      ) : (
        <div className="px-5 pb-6 pt-4 text-sm text-ink2">Nothing has run yet.</div>
      )}
    </Card>
  );
}

function QuickActionsCard() {
  const { actions, modal } = useQuickActions();
  return (
    <Card className="p-0">
      <CardHeader icon={<Zap className="h-5 w-5" />} title="Quick Actions" />
      <div className="grid grid-cols-2 gap-2.5 px-5 pb-5 pt-3">
        {actions.map((a, i) => (
          <button key={a.key} onClick={a.run} className={cx('btn-ghost justify-start px-3 py-2.5 text-[13px] font-medium', i === actions.length - 1 && 'col-span-2')}>
            <a.icon className={cx('h-[18px] w-[18px]', a.color)} /> {a.label}
          </button>
        ))}
      </div>
      {modal}
    </Card>
  );
}

function Timeline() {
  const { commands, devices } = useStore();
  const list = commands.filter((c) => c.action !== 'command.cancel').slice(0, 7);
  const nav = useNavigate();
  const name = (id: string | null) => devices.find((d) => d.id === id)?.name;
  return (
    <Card className="flex h-full flex-col p-0">
      <CardHeader icon={<Clock3 className="h-5 w-5" />} title="Command Timeline" action={<Link to="/history" className="flex items-center gap-1 text-xs font-semibold text-blue2">View All <ArrowRight className="h-3.5 w-3.5" /></Link>} />
      <ol className="relative flex-1 px-5 pb-4 pt-4">
        {list.length > 1 && <span className="absolute bottom-8 left-[39px] top-8 w-px bg-gradient-to-b from-blue2/60 via-blue2/25 to-transparent" aria-hidden />}
        {list.map((c) => (
          <li key={c.id}>
            <button onClick={() => nav('/history?id=' + c.id)} className="group relative flex w-full items-start gap-3 rounded-xl py-2 text-left">
              <ActionIcon action={c.action} className="relative z-10 h-8 w-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:text-ice" dir="auto">{c.inputText ? `“${c.inputText}”` : commandTitle(c)}</p>
                <p className="truncate text-[11px] text-ink2">{clock(c.createdAt)}{name(c.deviceId) ? ` · ${name(c.deviceId)}` : ''}{c.durationMs != null && c.status === 'completed' ? ` · ${duration(c.durationMs)}` : ''}</p>
                {c.error && <p className="truncate text-[11px] text-bad">{c.error.message}</p>}
              </div>
              <span className="pt-1"><StatusIcon c={c} /></span>
            </button>
          </li>
        ))}
        {!list.length && <p className="py-8 text-center text-sm text-ink2">Your commands will appear here with their real status.</p>}
      </ol>
    </Card>
  );
}

function MobileMic() {
  const voice = useVoiceInput();
  const { audioLevel, submitting } = useStore();
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center justify-center gap-3">
        <Waveform active={voice.listening} level={audioLevel} bars={11} mirror reduced={reduced} className="h-10" />
        <button
          onClick={voice.toggle}
          aria-label={voice.listening ? 'Stop listening' : 'Tap to speak'}
          className={cx('relative grid h-20 w-20 place-items-center rounded-full text-white transition active:scale-95', voice.listening ? 'glow-ring' : '')}
          style={{ background: 'radial-gradient(circle at 35% 30%, rgb(var(--blue2)), rgb(var(--blue)) 55%, rgb(12 60 140))', boxShadow: '0 0 0 6px rgb(var(--blue)/0.15), 0 0 0 1px rgb(var(--ice)/.5), 0 12px 40px -6px rgb(var(--blue))' }}
        >
          {voice.listening && <span className="absolute inset-0 animate-pulse-ring rounded-full ring-4 ring-ice/50" />}
          <Mic className="h-8 w-8" />
        </button>
        <Waveform active={voice.listening} level={audioLevel} bars={11} mirror reduced={reduced} className="h-10" />
      </div>
      <p className="mt-2 min-h-5 max-w-xs text-center text-sm text-ink2" dir="auto">
        {voice.listening ? voice.transcript || 'Listening… bolein' : submitting ? 'Sending…' : voice.supported ? 'Tap to speak' : 'Voice not supported here — type below'}
      </p>
      {voice.error && <p className="mt-1 max-w-xs text-center text-xs text-warn">{voice.error}</p>}
    </div>
  );
}

function MobileQuick() {
  const { actions, modal } = useQuickActions();
  const four = actions.filter((a) => a.key !== 'reply');
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {four.map((a) => (
        <button key={a.key} onClick={a.run} className="glass flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-[11px] font-medium text-ink active:scale-95">
          <a.icon className={cx('h-5 w-5', a.color)} />
          <span className="leading-tight">{a.label}</span>
        </button>
      ))}
      {modal}
    </div>
  );
}

/** Owner-scoped shortcuts for persistent project memory and tasks.
 * The server owns the data; empty while loading is not confused with no projects.
 */
type RelayReadinessData = {
  relay:{reachable:boolean;version:string};
  gemini:{configured:boolean;reachable:boolean|null};
  controller:{paired:number;connected:number;paused:number};
  tasks:{awaitingApproval:number;activeRuns:number};
};

/** A static GitHub Pages page is not proof that the HUKM relay is online.
 * Readiness is the authenticated relay's own status, not a guessed badge.
 */
function RelayReadiness(){
  const [data,setData]=useState<RelayReadinessData|null>(null);
  const [state,setState]=useState<'checking'|'ready'|'unavailable'>('checking');
  useEffect(()=>{
    let active=true;
    const refresh=()=>{
      void get<RelayReadinessData>('/api/runtime/status')
        .then(status=>{if(active){setData(status);setState('ready');}})
        .catch(()=>{if(active){setData(null);setState('unavailable');}});
    };
    refresh();
    const interval=window.setInterval(refresh,30_000);
    return ()=>{active=false;window.clearInterval(interval);};
  },[]);
  return <Card className="p-0">
    <CardHeader icon={<Zap className="h-5 w-5"/>} title="HUKM Service Status"
      action={<Link to="/devices" className="text-xs text-ice hover:underline">Devices</Link>}/>
    <div className="space-y-2 px-5 pb-5 pt-2 text-sm">
      {state==='checking'&&<p className="text-ink2">Checking authenticated HUKM relay…</p>}
      {state==='unavailable'&&<div className="rounded-xl bg-warn/10 p-3 text-warn">
        Relay connection could not be verified. A static website alone cannot control the laptop.
      </div>}
      {state==='ready'&&data&&<>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink2">Backend relay</span>
          <span className={data.relay.reachable?'text-ok':'text-warn'}>
            {data.relay.reachable?'Reachable':'Unavailable'} · v{data.relay.version}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink2">Windows Controllers</span>
          <span>{data.controller.connected} online / {data.controller.paired} paired</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink2">Gemini setup</span>
          <span className={data.gemini.configured?'text-ok':'text-warn'}>
            {data.gemini.configured?'Configured':'Not configured'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink2">Pending approvals</span>
          <span>{data.tasks.awaitingApproval}</span>
        </div>
        <p className="border-t border-line/15 pt-2 text-[11px] text-ink2">
          Backend-reported status only. Gemini reachability and real Windows operation are not verified by this panel.
        </p>
      </>}
    </div>
  </Card>;
}

function ProjectWorkspaces(){
  const [projects,setProjects]=useState<{id:string;name:string;description:string;updatedAt:string}[]>([]);
  const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  useEffect(()=>{
    let live=true;
    void get<{id:string;name:string;description:string;updatedAt:string}[]>('/api/projects')
      .then(rows=>{if(live){setProjects(rows);setStatus('ready');}})
      .catch(()=>{if(live)setStatus('error');});
    return ()=>{live=false;};
  },[]);
  return <div className="glass mt-5 rounded-3xl p-4 sm:p-5" aria-label="Your HUKM project workspaces">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue/15 text-ice">
          <FolderKanban size={20}/>
        </span>
        <div>
          <h2 className="font-display text-base font-bold">Your Projects</h2>
          <p className="text-xs text-ink2">Separate memory, instructions and reviewed laptop tasks</p>
        </div>
      </div>
      <Link to="/projects" className="btn-ghost px-3 py-2 text-xs">
        Manage Projects <ArrowRight size={15}/>
      </Link>
    </div>
    {status==='loading'&&<p className="text-sm text-ink2">Loading your workspaces…</p>}
    {status==='error'&&<p className="text-sm text-warn">Workspaces unavailable right now. Open Projects to retry.</p>}
    {status==='ready'&&projects.length===0&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-field/40 p-3">
      <p className="text-sm text-ink2">No projects yet. Create one to keep each workflow separate.</p>
      <Link to="/projects" className="btn-primary px-3 py-2 text-xs">Create Project</Link>
    </div>}
    {status==='ready'&&projects.length>0&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.slice(0,3).map(p=><Link key={p.id} to={'/chat?projectId='+encodeURIComponent(p.id)}
        className="group min-w-0 rounded-2xl bg-field/50 p-4 ring-1 ring-line/15 transition hover:bg-blue/10 hover:ring-ice/40">
        <div className="flex items-center justify-between gap-2">
          <FolderKanban size={18} className="shrink-0 text-ice"/>
          <ArrowRight size={15} className="shrink-0 text-ink2 transition group-hover:translate-x-1"/>
        </div>
        <p className="mt-2 truncate text-sm font-semibold">{p.name}</p>
        <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-ink2">{p.description||'Open your dedicated project chat and task workspace'}</p>
        <p className="mt-2 text-[11px] text-ink2">Updated {timeAgo(p.updatedAt)}</p>
      </Link>)}
    </div>}
  </div>;
}

export default function Dashboard() {
  const { brain, user } = useStore();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }, []);

  if (!desktop) {
    return (
      <PageFrame className="pt-1">
        <div className="flex flex-col items-center text-center">
          <Orb className="-mb-4 h-[230px] w-[min(100%,330px)]" />
          <h1 className="font-display text-[22px] font-bold">How can I help you today?</h1>
          <p className="mt-1 text-sm text-ink2">Speak, type, or give a command in Urdu or English.</p>
          <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-ice/80">{BRAIN_CAPTION[brain]}</p>
          <div className="mt-4 w-full"><MobileMic /></div>
          <div className="mt-4 w-full"><CommandComposer compact placeholder="Type a command…" /></div>
        </div>
        <div className="mt-5"><MobileQuick /></div>
        <ProjectWorkspaces />
        <div className="mt-4 space-y-4">
          <CommandStatusCard />
          <RecentCommands limit={4} />
          <ConnectedLaptop />
          <RelayReadiness />
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame className="pt-0">
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6">
        <section className="relative flex flex-col items-center pt-2 text-center">
          <Orb className="-mb-6 h-[350px] w-full max-w-[680px]" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-ice/80">{BRAIN_CAPTION[brain]}</p>
          <h1 className="mt-2 font-display text-[34px] font-bold tracking-tight">How can I help you today{user ? `, ${user.name.split(' ')[0]}` : ''}?</h1>
          <p className="mt-1.5 text-[15px] text-ink2">{greeting}. Give a command, ask a question, or control your devices — in Urdu or English.</p>
          <div className="mt-5 w-full max-w-[640px]"><CommandComposer autoFocus /></div>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
            {['Downloads folder kholo', 'Chrome kholo', 'YouTube par Gold analysis play karo', 'Invoice PDF search karo'].map((s) => (
              <SuggestionChip key={s} text={s} />
            ))}
          </div>
        </section>
        <aside className="pt-2"><Timeline /></aside>
      </div>
      <ProjectWorkspaces />
      <div className="mt-6 grid grid-cols-3 gap-5">
        <ConnectedLaptop />
        <RelayReadiness />
        <ThisSession />
        <ScreenPreview />
        <RecentCommands />
        <CommandStatusCard />
        <QuickActionsCard />
      </div>
    </PageFrame>
  );
}

function SuggestionChip({ text }: { text: string }) {
  const { runText } = useStore();
  return (
    <button onClick={() => runText(text, 'quick')} className="rounded-full bg-field/50 px-3 py-1.5 text-ink2 ring-1 ring-line/15 transition hover:text-ink hover:ring-ice/40">
      “{text}”
    </button>
  );
}
