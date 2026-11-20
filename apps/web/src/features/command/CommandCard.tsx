import {
  AppWindow, Ban, Check, CheckCircle2, Clock, ExternalLink, FileText, FolderOpen, Globe, Hourglass, Laptop, ListTree, Lock, MessageCircle,
  Monitor, Pencil, Search, ShieldAlert, Square, XCircle, Youtube,
} from 'lucide-react';
import { useState } from 'react';
import type { ActionName, Command } from '../../../../../packages/shared-types/src/index';
import { Badge, cx, Modal, Spinner } from '../../components/ui';
import { ACTION_LABEL, bytes, clock, describeArgs, duration, STATUS_LABEL, STATUS_TONE } from '../../lib/format';
import { useStore } from '../../services/store';

export const ACTION_ICON: Record<ActionName, typeof Globe> = {
  'app.open': AppWindow, 'folder.open': FolderOpen, 'folder.list': ListTree, 'file.search': Search, 'file.open': FileText,
  'file.reveal': FolderOpen, 'web.open': Globe, 'web.search': Search, 'youtube.search': Youtube, 'youtube.play': Youtube,
  'device.status': Laptop, 'apps.list': AppWindow, 'window.active': Monitor, 'window.focus': Monitor, 'screen.capture': Monitor,
  'system.lock': Lock, 'whatsapp.open': MessageCircle, 'whatsapp.check': MessageCircle, 'whatsapp.compose': MessageCircle, 'whatsapp.read_visible': MessageCircle, 'command.cancel': Ban,
};

export function ActionIcon({ action, className }: { action: ActionName; className?: string }) {
  const I = ACTION_ICON[action] ?? Globe;
  const color = action.startsWith('whatsapp') ? 'text-[#25D366] bg-[#25D366]/10 ring-[#25D366]/25'
    : action.startsWith('youtube') ? 'text-[#ff4e45] bg-[#ff4e45]/10 ring-[#ff4e45]/25'
    : action.startsWith('folder') || action.startsWith('file') ? 'text-[#f5c451] bg-[#f5c451]/10 ring-[#f5c451]/25'
    : 'text-ice bg-blue/10 ring-ice/20';
  return (
    <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1', color, className)}>
      <I className="h-[18px] w-[18px]" />
    </span>
  );
}

export function StatusChip({ c }: { c: Command }) {
  const tone = STATUS_TONE[c.status];
  return (
    <Badge tone={tone} dot>
      {c.status === 'running' && <Spinner className="h-3 w-3" />}
      {STATUS_LABEL[c.status]}
    </Badge>
  );
}

export function StatusIcon({ c }: { c: Command }) {
  switch (c.status) {
    case 'completed': return <CheckCircle2 className="h-4 w-4 text-ok" />;
    case 'failed': return <XCircle className="h-4 w-4 text-bad" />;
    case 'running': return <Spinner className="h-4 w-4 text-blue2" />;
    case 'awaiting_approval': return <ShieldAlert className="h-4 w-4 text-warn" />;
    case 'timed_out': return <Hourglass className="h-4 w-4 text-warn" />;
    case 'cancelled': return <Ban className="h-4 w-4 text-ink2" />;
    default: return <Clock className="h-4 w-4 text-blue2" />;
  }
}

export function commandTitle(c: Command) {
  return c.inputText || `${ACTION_LABEL[c.action]} ${describeArgs(c.action, c.args)}`.trim();
}

/** Compact row for timelines and recent lists. */
export function CommandRow({ c, onClick, showDevice }: { c: Command; onClick?: () => void; showDevice?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-field/50">
      <ActionIcon action={c.action} className="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink" dir="auto">{c.inputText ? `“${c.inputText}”` : commandTitle(c)}</p>
        <p className="truncate text-xs text-ink2">
          {clock(c.createdAt)} · {ACTION_LABEL[c.action]}
          {showDevice ? ` · ${showDevice}` : ''}
          {c.durationMs != null && c.status === 'completed' ? ` · ${duration(c.durationMs)}` : ''}
        </p>
      </div>
      <StatusIcon c={c} />
    </button>
  );
}

function FileList({ items }: { items: any[] }) {
  const { runAction } = useStore();
  if (!items.length) return <p className="text-sm text-ink2">No files.</p>;
  return (
    <ul className="divide-y divide-line/10 overflow-hidden rounded-xl ring-1 ring-line/10">
      {items.slice(0, 30).map((f) => (
        <li key={f.path} className="flex items-center gap-3 bg-field/30 px-3 py-2">
          {f.isDir ? <FolderOpen className="h-4 w-4 shrink-0 text-[#f5c451]" /> : <FileText className="h-4 w-4 shrink-0 text-ice" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" title={f.path} dir="auto">{f.name}</p>
            <p className="truncate text-[11px] text-ink2">
              {f.isDir ? 'Folder' : bytes(f.size)} · {new Date(f.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          {!f.isDir && (
            <div className="flex shrink-0 gap-1">
              <button className="rounded-lg px-2 py-1 text-xs font-semibold text-blue2 hover:bg-blue/10" onClick={() => runAction('file.open', { path: f.path }, { label: `Open ${f.name}` })}>Open</button>
              <button className="rounded-lg px-2 py-1 text-xs text-ink2 hover:bg-field" onClick={() => runAction('file.reveal', { path: f.path }, { label: `Show ${f.name} in folder` })} title="Open containing folder">Folder</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CommandResult({ c }: { c: Command }) {
  const r = (c.result ?? {}) as Record<string, any>;
  const [zoom, setZoom] = useState(false);
  if (c.status !== 'completed') return null;
  switch (c.action) {
    case 'file.search':
      return (
        <div className="space-y-2">
          <p className="text-xs text-ink2">{r.count} match{r.count === 1 ? '' : 'es'}{r.truncated ? ' (search stopped early — narrow it down)' : ''}</p>
          <FileList items={r.results ?? []} />
        </div>
      );
    case 'folder.list':
      return <div className="space-y-2"><p className="truncate text-xs text-ink2">{r.path} · {r.total} items</p><FileList items={r.items ?? []} /></div>;
    case 'file.open':
      return r.ambiguous ? <FileList items={r.candidates ?? []} /> : <p className="truncate text-xs text-ink2" title={r.path}>{r.path}{r.picked ? ` — picked ${r.picked}` : ''}</p>;
    case 'apps.list':
      return (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {(r.apps ?? []).map((a: any) => (
            <li key={a.process} className="rounded-xl bg-field/40 px-3 py-2 ring-1 ring-line/10">
              <p className="text-sm font-medium">{a.process.replace(/\.exe$/i, '')}</p>
              <p className="truncate text-[11px] text-ink2">{a.windows.join(' · ')}</p>
            </li>
          ))}
        </ul>
      );
    case 'device.status':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['CPU', `${Math.round(r.cpu)}%`], ['Memory', `${Math.round(r.memory)}% of ${r.memoryTotalGb} GB`],
            ['Battery', r.battery == null ? 'n/a' : `${r.battery}%${r.plugged ? ' ⚡' : ''}`], ['Uptime', `${r.uptimeHours} h`],
            ['OS', `${r.os} ${String(r.osVersion ?? '').split(' ')[0]}`], ['Controller RAM', `${r.controllerMemoryMb} MB`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-field/40 px-3 py-2 ring-1 ring-line/10">
              <p className="text-[11px] uppercase tracking-wider text-ink2">{k}</p>
              <p className="text-sm font-semibold">{v}</p>
            </div>
          ))}
        </div>
      );
    case 'screen.capture':
      return c.screenshotId ? (
        <>
          <button onClick={() => setZoom(true)} className="block overflow-hidden rounded-xl ring-1 ring-line/15">
            <img src={`/api/screenshots/${c.screenshotId}`} alt="Laptop screenshot" className="max-h-64 w-full object-cover" loading="lazy" />
          </button>
          <Modal open={zoom} onClose={() => setZoom(false)} title="Screenshot" wide>
            <img src={`/api/screenshots/${c.screenshotId}`} alt="Laptop screenshot full size" className="w-full rounded-xl" />
          </Modal>
        </>
      ) : <p className="text-xs text-ink2">Screenshot expired or deleted.</p>;
    case 'youtube.play':
    case 'youtube.search':
    case 'web.search':
    case 'web.open':
      return (
        <div className="space-y-1 text-xs text-ink2">
          {r.title && <p className="text-sm text-ink">{r.title}</p>}
          {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue2 hover:underline">{r.url.length > 64 ? r.url.slice(0, 64) + '…' : r.url}<ExternalLink className="h-3 w-3" /></a>}
          {r.note && <p>{r.note}</p>}
        </div>
      );
    case 'whatsapp.check':
      return (
        <div className="text-sm">
          {typeof r.unreadChats === 'number' ? <p><span className="font-display text-2xl font-bold text-[#25D366]">{r.unreadChats}</span> unread chat{r.unreadChats === 1 ? '' : 's'}{r.source ? ` (${r.source})` : ''}</p> : <p className="text-sm font-medium text-warn">Unread count could not be verified</p>}
          {r.note && <p className="mt-1 text-xs text-ink2">{r.note}</p>}
        </div>
      );
    case 'whatsapp.compose':
      return <p className="text-xs text-warn">Draft opened in WhatsApp — not sent. Press Send on the laptop.</p>;
    case 'app.open':
      return r.windowDetected === false ? <p className="text-xs text-warn">Launched, but no window was detected within 6 s.</p> : r.windowTitle ? <p className="truncate text-xs text-ink2">Window: {r.windowTitle}</p> : null;
    case 'folder.open':
      return <p className="truncate text-xs text-ink2">{r.path}</p>;
    case 'window.active':
    case 'window.focus':
      return <p className="truncate text-xs text-ink2">{r.title} — {r.process}</p>;
    default:
      return null;
  }
}

function ApprovalBox({ c }: { c: Command }) {
  const { approve, reject, runAction } = useStore();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [msg, setMsg] = useState(String(c.args.message ?? ''));
  const a = c.args as Record<string, any>;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl bg-warn/[0.07] p-3 ring-1 ring-warn/30">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-warn"><ShieldAlert className="h-4 w-4" /> Approval required</p>
      <dl className="mt-2 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink2">Action</dt><dd>{ACTION_LABEL[c.action]}</dd>
        {c.action === 'whatsapp.compose' && (<>
          <dt className="text-ink2">Recipient</dt><dd>{a.contact} <span className="text-ink2">(+{a.phone})</span></dd>
          <dt className="text-ink2">Message</dt><dd className="whitespace-pre-wrap" dir="auto">{a.message}</dd>
          <dt className="text-ink2">Effect</dt><dd className="text-ink2">Opens the chat with this text typed in. You press Send on the laptop.</dd>
        </>)}
        {c.action === 'screen.capture' && (<><dt className="text-ink2">Effect</dt><dd className="text-ink2">One screenshot of the main screen is sent to your account and auto-deleted per retention settings.</dd></>)}
        {c.action === 'system.lock' && (<><dt className="text-ink2">Effect</dt><dd className="text-ink2">Locks Windows immediately. Unsaved work stays open.</dd></>)}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy} className="btn-primary px-3 py-2" onClick={() => act(() => approve(c.id))}><Check className="h-4 w-4" /> Approve</button>
        {c.action === 'whatsapp.compose' && <button disabled={busy} className="btn-ghost px-3 py-2" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Edit</button>}
        <button disabled={busy} className="btn-ghost px-3 py-2" onClick={() => act(() => reject(c.id))}><XCircle className="h-4 w-4" /> Cancel</button>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title={`Edit message to ${a.contact}`}
        footer={<>
          <button className="btn-ghost" onClick={() => setEdit(false)}>Close</button>
          <button className="btn-primary" disabled={!msg.trim()} onClick={async () => {
            setEdit(false);
            await reject(c.id);
            await runAction('whatsapp.compose', { contact: a.contact, message: msg.trim() }, { label: `Message ${a.contact}: ${msg.trim()}` });
          }}>Use edited text</button>
        </>}>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} className="input" dir="auto" maxLength={1000} />
      </Modal>
    </div>
  );
}

export default function CommandCard({ c, deviceName }: { c: Command; deviceName?: string }) {
  const { cancel } = useStore();
  const live = c.status === 'pending' || c.status === 'running';
  return (
    <div className="card animate-fade-up overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <ActionIcon action={c.action} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold">{ACTION_LABEL[c.action]} <span className="font-normal text-ink2">{describeArgs(c.action, c.args)}</span></p>
            <StatusChip c={c} />
          </div>
          <p className="mt-0.5 text-xs text-ink2">
            {clock(c.createdAt)}{deviceName ? ` · ${deviceName}` : ''}{c.durationMs != null && c.status !== 'awaiting_approval' ? ` · ${duration(c.durationMs)}` : ''}
            {c.source === 'voice' ? ' · voice' : c.source === 'automation' ? ' · automation' : ''}
          </p>
        </div>
      </div>
      {live && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-field">
            <div className={cx('h-full rounded-full bg-[linear-gradient(90deg,transparent,rgb(var(--ice)),transparent)] bg-[length:200%_100%] animate-shimmer', c.status === 'running' ? 'w-full' : 'w-1/2')} />
          </div>
          <span className="text-[11px] text-ink2">{c.status === 'running' ? 'Running on laptop' : c.dispatchedAt ? 'Delivered' : 'Queued'}</span>
          <button className="rounded-lg p-1 text-ink2 hover:bg-field hover:text-bad" onClick={() => cancel(c.id)} aria-label="Cancel command"><Square className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {c.status === 'awaiting_approval' && <div className="mt-3"><ApprovalBox c={c} /></div>}
      {c.error && c.status !== 'cancelled' && <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad ring-1 ring-bad/20">{c.error.code}: {c.error.message}</p>}
      {c.status === 'completed' && <div className="mt-3"><CommandResult c={c} /></div>}
    </div>
  );
}

