import { Bot, Mic, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dialogueChoices, pick } from '../../../../packages/command-protocol/src/index';
import { BrainMark } from '../components/Logo';
import { cx, EmptyState } from '../components/ui';
import CommandCard from '../features/command/CommandCard';
import OperatorPlanCard from '../features/agent/OperatorPlanCard';
import { get } from '../services/api';
import CommandComposer from '../features/command/CommandComposer';
import { clock } from '../lib/format';
import { useStore, type ChatMessage } from '../services/store';

function AgentBubble({ m }: { m: Extract<ChatMessage, { kind: 'agent' }> }) {
  const { settings, say } = useStore();
  const text = pick(m.msg, settings.responseLang);
  const tone = m.tone === 'bad' ? 'ring-bad/30' : m.tone === 'warn' ? 'ring-warn/30' : m.tone === 'ok' ? 'ring-ok/30' : 'ring-line/15';
  return (
    <div className="flex animate-fade-up items-end gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue/15 ring-1 ring-ice/25"><BrainMark className="h-5 w-5" /></span>
      <div className={cx('glass max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 ring-1', tone)}>
        {m.provider === 'gemini' && <span className="mb-1 inline-block text-[10px] font-medium tracking-wide text-ice">GEMINI AI</span>}
        <p className={cx('whitespace-pre-wrap break-words text-[15px] leading-relaxed', settings.responseLang === 'ur' && 'urdu text-right')} lang={settings.responseLang === 'ur' ? 'ur' : undefined}>{text}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-[10px] text-ink2">{clock(m.at)}</span>
          <button onClick={() => say(m.msg, true)} className="text-ink2 hover:text-ice" aria-label="Speak this reply"><Volume2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ m }: { m: Extract<ChatMessage, { kind: 'user' }> }) {
  return (
    <div className="flex animate-fade-up justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-white shadow-[0_10px_30px_-12px_rgb(var(--blue))]" style={{ background: 'linear-gradient(180deg, rgb(var(--blue2)), rgb(var(--blue)))' }}>
        <p className="text-[15px] leading-relaxed" dir="auto">{m.text}</p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/70">{m.source === 'voice' && <Mic className="h-3 w-3" />}{clock(m.at)}</p>
      </div>
    </div>
  );
}

export default function Chat() {
  const { chat, commandMap, devices, clearChat, pendingDialogueTopic, restoreOperatorPending, runText } = useStore();
  const end = useRef<HTMLDivElement>(null);
  const [searchParams,setSearchParams] = useSearchParams();
  const [projects,setProjects] = useState<{id:string;name:string}[]>([]);
  const activeProject = searchParams.get('projectId') ?? '';
  const visibleChat = chat.filter(m => (m.projectId ?? null) === (activeProject || null));
  useEffect(()=>{void get<{id:string;name:string}[]>('/api/projects').then(setProjects).catch(()=>{});},[]);
  useEffect(()=>{
    let active=true;
    const query=activeProject?'?projectId='+encodeURIComponent(activeProject):'';
    void get<{question:string;topic:string}|null>('/api/operator/pending'+query)
      .then(p=>{if(active)restoreOperatorPending(!!p);})
      .catch(()=>{});
    return ()=>{active=false;};
  },[activeProject,restoreOperatorPending]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [visibleChat.length, activeProject]);
  const name = (id: string | null) => devices.find((d) => d.id === id)?.name;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-3xl flex-col px-4 sm:px-6">
      <div className="flex items-center justify-between py-3">
        <div>
          <h1 className="font-display text-xl font-bold">AI Chat</h1>
          <p className="text-xs text-ink2">Chat naturally. Compound computer requests generate a reviewed action plan; HUKM's Windows controller performs approved steps.</p>
        </div>
        {visibleChat.length > 0 && (
          <button className="btn-ghost px-3 py-2 text-xs" onClick={()=>clearChat(activeProject || null)}><Trash2 className="h-4 w-4" /> Clear</button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="project-select" className="text-ink2">Task project</label>
        <select id="project-select" className="rounded-xl bg-field px-2 py-2 text-ink ring-1 ring-line/20"
          value={activeProject} onChange={e=>setSearchParams(e.target.value?{projectId:e.target.value}:{})}>
          <option value="">General (no project)</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Link to="/projects" className="text-ice hover:underline">Manage instructions &amp; memory</Link>
      </div>
      <div className="flex-1 space-y-3 pb-4">
        {visibleChat.length === 0 && (
          <EmptyState icon={<Bot className="h-5 w-5" />} title="Ask HUKM AI anything" body="Roman Urdu mein message likhein, jaise 'Aaj kya seekhoon?' Ya laptop command: 'Notepad kholo'." />
        )}
        {visibleChat.map((m) => {
          if (m.kind === 'user') return <UserBubble key={m.id} m={m} />;
          if (m.kind === 'agent') return <AgentBubble key={m.id} m={m} />;
          if (m.kind === 'plan') return <div key={m.id} className="pl-2 sm:pl-10"><OperatorPlanCard plan={m.plan}/></div>;
          const c = commandMap.get(m.commandId);
          return c ? <div key={m.id} className="pl-10"><CommandCard c={c} deviceName={name(c.deviceId)} /></div> : null;
        })}
        <div ref={end} />
      </div>
      {pendingDialogueTopic && (
        <div className="mx-1 mb-3 rounded-2xl border border-ice/25 bg-blue/10 p-3">
          <p className="mb-2 text-sm font-medium">HUKM aapke jawab ka intezar kar raha hai. Type karein ya bolein.</p>
          <div className="flex flex-wrap gap-2">
            {dialogueChoices(pendingDialogueTopic).map((choice) => (
              <button key={choice.value} className="btn-primary" onClick={() => void runText(choice.value)}>
                {choice.label}
              </button>
            ))}
            <button className="btn-ghost" onClick={() => void runText('Rehne do')}>Cancel</button>
          </div>
        </div>
      )}
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 -mx-1 pb-3 pt-2 lg:bottom-0 lg:pb-6">
        <div className="pointer-events-none absolute inset-x-0 -top-6 bottom-0 bg-gradient-to-t from-bg via-bg/95 to-transparent" aria-hidden />
        <div className="relative rounded-3xl p-1"><CommandComposer placeholder="HUKM AI ko message likhein…" /></div>
        <p className="relative mt-1 px-3 text-center text-[10px] text-ink2">Gemini ko aapka current request bheja jata hai. Project select ho to uski saved instructions/notes bhi planner ke liye bheji ja sakti hain. Laptop files, screenshots aur WhatsApp message bodies automatically share nahi hote.</p>
      </div>
    </div>
  );
}
