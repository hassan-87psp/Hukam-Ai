import { CalendarClock, CheckCircle2, Pencil, Play, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseCommand } from '../../../../packages/command-protocol/src/index';
import type { Automation } from '../../../../packages/shared-types/src/index';
import { Badge, Card, EmptyState, Modal, PageHeader, Spinner, Toggle } from '../components/ui';
import { PageFrame } from '../layouts/AppShell';
import { ACTION_LABEL, describeArgs, timeAgo } from '../lib/format';
import { del, patch, post, useStore } from '../services/store';

const TEMPLATES = [
  { name: 'Morning Browser Setup', description: 'Chrome, TradingView and Forex Factory', steps: ['Chrome kholo', 'TradingView kholo', 'Forex Factory kholo'] },
  { name: 'Open Trading Websites', description: 'Charts, calendar and news', steps: ['TradingView kholo', 'Forex Factory kholo', 'Browser mein gold news search karo'] },
  { name: 'Open My Work Folders', description: 'Downloads, Documents and Desktop', steps: ['Downloads folder kholo', 'Documents folder kholo', 'Desktop folder kholo'] },
  { name: 'Check Connected Laptop', description: 'Status and open applications', steps: ['laptop ka status batao', 'kaunsi applications open hain'] },
];

function Editor({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Partial<Automation> | null }) {
  const { toast } = useStore();
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState((initial?.steps ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(initial?.schedule?.enabled ?? false);
  const [scheduleTime, setScheduleTime] = useState(initial?.schedule?.time ?? '09:00');
  const [timezone, setTimezone] = useState(initial?.schedule?.timezone ?? 'Asia/Kuala_Lumpur');
  const lines = steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const parsed = useMemo(() => lines.map((l) => ({ l, p: parseCommand(l) })), [steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = name.trim() && lines.length > 0 && lines.length <= 15 &&
    parsed.every((x) => x.p.kind === 'command' && x.p.action !== 'whatsapp.compose' && x.p.action !== 'system.lock') &&
    (!scheduleOn || /^([01]\\d|2[0-3]):[0-5]\\d$/.test(scheduleTime));
  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Edit automation' : 'New automation'} wide
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!valid || busy} onClick={async () => {
          setBusy(true);
          try {
            const body = {
              name: name.trim(), description: desc.trim(), steps: lines,
              schedule: { enabled: scheduleOn, time: scheduleTime, timezone },
            };
            if (initial?.id) await patch(`/api/automations/${initial.id}`, body);
            else await post('/api/automations', body);
            toast({ title: 'Automation saved', tone: 'ok' });
            onClose();
          } catch (e) {
            toast({ title: 'Not saved', body: (e as Error).message, tone: 'bad' });
          } finally {
            setBusy(false);
          }
        }}>{busy && <Spinner />} Save</button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="an">Name</label><input id="an" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div><label className="label" htmlFor="ad">Description</label><input id="ad" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></div>
        </div>
        <div>
          <label className="label" htmlFor="as">Steps — one command per line (same language as chat)</label>
          <textarea id="as" className="input font-mono text-[13px]" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Chrome kholo\nTradingView kholo\nDownloads folder kholo'} dir="auto" />
        </div>
        {parsed.length > 0 && (
          <ul className="space-y-1.5">
            {parsed.map(({ l, p }, i) => {
              const ok = p.kind === 'command' && p.action !== 'whatsapp.compose' && p.action !== 'system.lock';
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <XCircle className="h-4 w-4 shrink-0 text-bad" />}
                  <span className="truncate" dir="auto">{l}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink2">{p.kind === 'command' ? (ok ? `${ACTION_LABEL[p.action]} ${describeArgs(p.action, p.args)}` : 'not allowed in automations') : 'not understood'}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="rounded-xl border border-line/20 bg-field/30 p-4">
          <Toggle checked={scheduleOn} onChange={setScheduleOn} label="Daily schedule (optional)" description="Off by default. Only enable when you want HUKM to run these commands each day." />
          {scheduleOn && <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="auto-time" className="label">Daily time</label>
              <input id="auto-time" type="time" className="input" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
            </div>
            <div><label htmlFor="auto-zone" className="label">Timezone</label>
              <select id="auto-zone" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {['Asia/Kuala_Lumpur', 'Asia/Karachi', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'].map((tz) => <option value={tz} key={tz}>{tz}</option>)}
              </select>
            </div>
          </div>}
          <p className="mt-2 text-xs text-ink2">Free Render can sleep; this is best-effort only, not guaranteed to run at the exact minute. If an action requires approval, it still waits for your approval.</p>
        </div>
        <p className="text-xs text-ink2">Steps run one after another and stop at the first failure. Messaging and locking are not allowed in automations; steps that need approval wait for it.</p>
      </div>
    </Modal>
  );
}

export default function Automations() {
  const { automations, toast, devices, commands, setAutomations } = useStore();
  const [edit, setEdit] = useState<Partial<Automation> | null>(null);
  const [del_, setDel] = useState<Automation | null>(null);
  const online = devices.some((d) => d.online);

  return (
    <PageFrame>
      <PageHeader title="Automations" subtitle="Saved command sequences you can run with one tap." actions={<button className="btn-primary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> New automation</button>} />
      <div className="grid gap-5 lg:grid-cols-2">
        {automations.map((a) => {
          const running = a.lastRunStatus === 'running';
          return (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue/15 text-ice ring-1 ring-ice/25"><Zap className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="font-display font-semibold">{a.name}</p>
                    {a.description && <p className="text-sm text-ink2">{a.description}</p>}
                    {a.schedule?.enabled && a.schedule.time && <p className="mt-1 flex items-center gap-1 text-xs text-blue2"><CalendarClock className="h-3.5 w-3.5" /> Daily {a.schedule.time} · {a.schedule.timezone}</p>}
                  </div>
                </div>
                <Toggle checked={a.enabled} onChange={async (v) => { await patch(`/api/automations/${a.id}`, { enabled: v }); }} />
              </div>
              <ol className="mt-4 space-y-1.5">
                {a.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm"><span className="grid h-5 w-5 place-items-center rounded-full bg-field text-[11px] text-ink2">{i + 1}</span><span dir="auto">{s}</span></li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line/10 pt-4">
                <p className="text-xs text-ink2">
                  {a.lastRunAt ? <>Last run {timeAgo(a.lastRunAt)} · <Badge tone={a.lastRunStatus === 'completed' ? 'ok' : running ? 'info' : 'bad'}>{a.lastRunStatus}</Badge></> : 'Never run'}
                </p>
                <div className="flex gap-2">
                  <button className="btn-ghost px-3 py-2" onClick={() => setEdit(a)} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  <button className="btn-ghost px-3 py-2 text-bad" onClick={() => setDel(a)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                  <button className="btn-primary px-4 py-2" disabled={!a.enabled || running || !online} title={!online ? 'Laptop is offline' : undefined}
                    onClick={async () => {
                      try {
                        await post(`/api/automations/${a.id}/run`, {});
                        toast({ title: `Running “${a.name}”`, tone: 'info' });
                      } catch (e) {
                        toast({ title: 'Could not run', body: (e as Error).message, tone: 'bad' });
                      }
                    }}>{running ? <Spinner /> : <Play className="h-4 w-4" />} Run</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {!automations.length && (
        <Card className="mb-5">
          <EmptyState icon={<Zap className="h-5 w-5" />} title="No automations yet" body="Start from a template below or create your own." />
        </Card>
      )}
      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Templates</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TEMPLATES.map((t) => (
          <button key={t.name} onClick={() => setEdit(t)} className="glass rounded-2xl p-4 text-left transition hover:ring-1 hover:ring-ice/30">
            <p className="font-display font-semibold">{t.name}</p>
            <p className="mt-1 text-xs text-ink2">{t.description}</p>
            <p className="mt-3 text-xs font-semibold text-blue2">Use template →</p>
          </button>
        ))}
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 font-display font-semibold"><CalendarClock className="h-5 w-5 text-ice" /> Daily schedules</p>
          <p className="mt-2 text-sm text-ink2">Open any automation and enable its Daily schedule to select a local time and timezone. Existing automations remain unscheduled unless you opt in. Free hosting can sleep, so missed times are not replayed.</p>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 font-display font-semibold"><CalendarClock className="h-5 w-5 text-ice" /> Automation history</p>
          <ul className="mt-3 space-y-1 text-sm">
            {commands.filter((c) => c.source === 'automation').slice(0, 6).map((c) => (
              <li key={c.id} className="flex justify-between gap-3"><span className="truncate" dir="auto">{c.inputText}</span><span className="shrink-0 text-xs text-ink2">{c.status} · {timeAgo(c.createdAt)}</span></li>
            ))}
            {!commands.some((c) => c.source === 'automation') && <li className="text-ink2">No automation steps have run yet.</li>}
          </ul>
        </Card>
      </div>
      {edit && <Editor open={!!edit} initial={edit} onClose={() => setEdit(null)} />}
      <Modal open={!!del_} onClose={() => setDel(null)} title={`Delete “${del_?.name}”?`}
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>Keep</button><button className="btn-danger" onClick={async () => { if (del_) { await del(`/api/automations/${del_.id}`); setAutomations(automations.filter((x) => x.id !== del_.id)); } setDel(null); }}>Delete</button></>}>
        <p className="text-sm text-ink2">This removes the saved sequence. Past command history stays.</p>
      </Modal>
    </PageFrame>
  );
}
