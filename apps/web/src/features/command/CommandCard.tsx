import {
  AppWindow, Ban, Check, CheckCircle2, Clock, ExternalLink, FileText, FolderOpen, Globe, Hourglass, Laptop, ListTree, Lock, MessageCircle,
  Monitor, Pencil, Search, ShieldAlert, Square, XCircle, Youtube,
} from 'lucide-react';
import { useState } from 'react';
import type { ActionName, Command } from '../../../../../packages/shared-types/src/index';
import { Badge, cx, Modal, Spinner } from '../../components/ui';
import { ACTION_LABEL, bytes, clock, describeArgs, duration, STATUS_LABEL, STATUS_TONE, actionResultUnverified } from '../../lib/format';
import { useStore } from '../../services/store';
import { post } from '../../services/api';

function unverifiedReason(action: ActionName): string {
  switch(action) {
    case 'controller.update':
      return 'HUKM installer may have launched, but the update is NOT complete until the Windows device reconnects with the new version. No silent install.';
    case 'app.close':
      return 'Notepad close requested, but the actual window was not verified closed. If Save/Cancel is visible, decide on the laptop.';
    case 'whatsapp.send_reviewed':
    case 'whatsapp.send_attachment_reviewed':
      return 'WhatsApp Send may have happened, but delivery was NOT verified. Check the correct chat before doing anything else. Never retry automatically.';
    case 'calendar.save_reviewed':
      return 'Calendar Save may have happened, but event creation and invitations were NOT verified. Check the calendar first. Never retry automatically.';
    case 'chatgpt.submit_prompt':
      return 'ChatGPT prompt was submitted or attempted, but a generated response has not been verified. Check the selected Project tab.';
    case 'chatgpt.download_visible':
      return 'A complete new ChatGPT file was NOT verified in Downloads. Check Chrome downloads and the saved Project tab.';
    default:
      return 'WhatsApp unread count or sender names could not be verified. This does NOT mean zero unread.';
  }
}

export const ACTION_ICON: Record<ActionName, typeof Globe> = {
  'app.open': AppWindow, 'app.close': AppWindow, 'controller.update': Laptop, 'folder.open': FolderOpen, 'folder.list': ListTree, 'file.search': Search, 'file.open': FileText,
  'file.reveal': FolderOpen, 'web.open': Globe, 'web.search': Search, 'youtube.search': Youtube, 'youtube.play': Youtube,
  'device.status': Laptop, 'apps.list': AppWindow, 'window.active': Monitor, 'window.focus': Monitor, 'screen.capture': Monitor,
  'diagnostics.probe': Monitor, 'ui.inspect': Monitor, 'ui.activate': Monitor, 'ui.activate_observed': Monitor, 'ui.scroll': Monitor, 'desktop.control': Monitor, 'email.inbox_open': Globe, 'email.compose_draft': Pencil, 'calendar.event_draft': Globe, 'calendar.save_reviewed': Globe,
  'chatgpt.prompt_draft': Pencil, 'chatgpt.submit_prompt': Pencil, 'chatgpt.download_visible': FileText,
  'whatsapp.select_chat': MessageCircle, 'whatsapp.read_selected': MessageCircle, 'whatsapp.draft_reply': MessageCircle, 'whatsapp.send_reviewed': MessageCircle, 'whatsapp.attach_preview': FileText, 'whatsapp.send_attachment_reviewed': FileText,
  'browser.control': Monitor, 'browser.profile_open': Globe, 'notepad.type': Pencil, 'system.lock': Lock, 'whatsapp.open': MessageCircle, 'whatsapp.check': MessageCircle, 'whatsapp.unread_senders': MessageCircle, 'whatsapp.compose': MessageCircle, 'whatsapp.read_visible': MessageCircle, 'command.cancel': Ban,
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
  const unknown = c.status === 'completed' && actionResultUnverified(c.action,c.result);
  const tone = unknown ? 'warn' : STATUS_TONE[c.status];
  return (
    <Badge tone={tone} dot>
      {c.status === 'running' && <Spinner className="h-3 w-3" />}
      {unknown ? 'Not verified' : STATUS_LABEL[c.status]}
    </Badge>
  );
}

export function StatusIcon({ c }: { c: Command }) {
  if (c.status === 'completed' && actionResultUnverified(c.action,c.result))
    return <ShieldAlert className="h-4 w-4 text-warn" />;
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
  const { runAction } = useStore();
  const r = (c.result ?? {}) as Record<string, any>;
  const [zoom, setZoom] = useState(false);
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionResult, setVisionResult] = useState('');
  const [visionError, setVisionError] = useState('');
  async function analyzeApprovedScreenshot() {
    if(!c.screenshotId || visionBusy) return;
    const approved = window.confirm('Send this entire approved screenshot to Google Gemini for AI visual analysis? It may contain private on-screen information. This is separate from the original screen capture approval.');
    if(!approved)return;
    setVisionBusy(true);setVisionError('');
    try {
      const r=await post<{analysis:string}>('/api/vision/analyze',{
        screenshotId:c.screenshotId,
        question:'Identify the visible application and actionable buttons on screen. Explain what can be verified, what is unknown, and suggest safe next steps.',
        consent:true,
      });
      setVisionResult(r.analysis);
    }catch(e){setVisionError(e instanceof Error?e.message:String(e));}
    finally{setVisionBusy(false);}
  }
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
          <div className="mt-2 rounded-xl bg-field/40 p-3 text-sm">
            <p className="mb-2 text-xs text-warn">Optional: AI analysis shares the entire screenshot with Google Gemini. No automatic computer actions follow.</p>
            <button type="button" disabled={visionBusy} onClick={()=>void analyzeApprovedScreenshot()} className="btn-ghost px-3 py-2 text-xs">
              {visionBusy?'Analyzing…':'Analyze screenshot with AI (requires consent)'}
            </button>
            {visionError&&<p className="mt-2 text-xs text-bad">{visionError}</p>}
            {visionResult&&<p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink2">{visionResult}</p>}
          </div>
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
    case 'browser.profile_open':
      return <p className="text-xs text-ink2">{r.note ?? 'Chrome profile launched, page unverified.'}</p>;
    case 'diagnostics.probe':
      return <div className="space-y-2 text-xs text-ink2">
        <p className={r.whatsappDesktopWindow ? 'font-semibold text-ok' : 'font-semibold text-warn'}>
          WhatsApp Desktop: {r.whatsappDesktopWindow
            ? 'window detected' : r.whatsappProcessRunning
              ? 'process running, but window inaccessible' : 'NOT detected'}
        </p>
        <p>WhatsApp windows: {String(r.whatsappWindowCount ?? 'unknown')}
          · WhatsApp foreground: {r.whatsappForeground ? 'Yes' : 'No'}
        </p>
        {r.whatsappChromeTabDetected && <p className="rounded-lg bg-warn/10 p-2 text-warn">
          WhatsApp Web is open in Chrome. This is NOT the installed Personal WhatsApp Desktop app.
          HUKM will not silently use this browser tab for Desktop commands.
        </p>}
        {r.whatsappDiagnosis && <p className="rounded-lg bg-field/50 p-2 text-ink">{String(r.whatsappDiagnosis)}</p>}
        {r.whatsappForeground !== true && <button className="btn-ghost px-3 py-2 text-xs"
          onClick={()=>void runAction('whatsapp.open',{mode:'desktop'},{label:'Open installed WhatsApp Desktop on laptop'})}>
          Open / Focus WhatsApp Desktop
        </button>}
        <p>Windows UI Automation: {r.uiautomationInstalled ? 'available' : 'unavailable'}</p>
        <p>Chrome profiles: {Array.isArray(r.chromeProfileDirectories) ? r.chromeProfileDirectories.join(', ') : 'unknown'}</p>
        <p>Monitors: {String(r.monitorCount ?? 'unknown')} · Foreground: {String(r.activeApp ?? 'none')}</p>
        <p>Private messages and screenshots were not collected.</p>
      </div>;
    case 'ui.inspect':
      return <div className="space-y-2 text-xs text-ink2">
        <p className="font-semibold text-ink">{String(r.window??'Unknown window')} · {String(r.process??'')} · {Array.isArray(r.controls) ? r.controls.length : 0} interactive controls</p>
        <p>Inspect first, then select exactly one safe button below. HUKM will check the same window and controls again before clicking, and ask for separate approval.</p>
        {Array.isArray(r.controls) && r.controls.slice(0,30).map((x:any,i:number)=>
          <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-field/40 px-2 py-2">
            <span className="min-w-0 break-words">{String(x.role)}: {String(x.label)}</span>
            {x.canActivate===true && typeof r.snapshot==='string' && /^[a-f0-9]{64}$/.test(r.snapshot) && c.deviceId
              ? <button className="btn-ghost shrink-0 px-3 py-1 text-xs" type="button"
                  onClick={()=>void runAction('ui.activate_observed',
                    {label:String(x.label),role:String(x.role),snapshot:r.snapshot},
                    {deviceId:c.deviceId!,label:'Click inspected '+String(x.label)+' on '+String(r.window)})}>
                  Select &amp; request approval
                </button>
              : <span className="text-[11px] text-warn">Protected / use dedicated workflow</span>}
          </div>)}
        <p>Only foreground control names were read—not text fields or private message contents. If the screen changes, inspect again.</p>
      </div>;
    case 'ui.activate':
    case 'ui.activate_observed':
      return <p className="text-xs text-warn">{r.note ?? 'Click attempted only on the verified inspected control; app outcome unverified.'}</p>;
    case 'calendar.event_draft':
      return <p className="text-xs text-warn">{r.note ?? 'Calendar composer opened; event NOT saved.'}</p>;
    case 'calendar.save_reviewed':
      return <div className="space-y-1 text-xs text-warn">
        <p>{r.note ?? 'Calendar Save may have been clicked; event ID not verified.'}</p>
        <p>Event ID verified: No · Attendee invites verified: No · Do not retry without checking Calendar first.</p>
      </div>;
    case 'chatgpt.prompt_draft':
    case 'chatgpt.submit_prompt':
      return <p className="text-xs text-warn">{r.note ?? 'ChatGPT input attempted; output not independently verified.'}</p>;
    case 'chatgpt.download_visible':
      return <div className="text-xs text-ink2"><p>{r.note ?? 'Download checked.'}</p>
        {r.fileName && <p>File: {String(r.fileName)}</p>}</div>;
    case 'whatsapp.read_selected':
      return <div className="space-y-2 text-sm">
        <p className="text-xs text-warn">Visible on-screen text, saved to your private HUKM command history after approval. Not forwarded to Gemini.</p>
        {Array.isArray(r.visibleMessages) && r.visibleMessages.slice(0,8).map((message:string,i:number)=>
          <p key={i} className="whitespace-pre-wrap break-words rounded-lg bg-field/40 p-2">{message}</p>)}
      </div>;
    case 'whatsapp.send_attachment_reviewed':
    case 'whatsapp.send_reviewed':
      return <div className="space-y-1 text-xs text-warn">
        <p>{r.note ?? 'Send was attempted, but delivery is not verified. Check the intended WhatsApp chat manually.'}</p>
        <p>Send attempted: {r.sendAttempted ? 'Yes' : 'No'} · Delivery verified: No · Never retry automatically.</p>
      </div>;
    case 'whatsapp.draft_reply':
    case 'whatsapp.attach_preview':
      return <p className="text-xs text-warn">{r.note ?? 'Draft/attachment prepared, not sent.'}</p>;
    case 'notepad.type':
      return <p className="text-xs text-ink2">{r.note ?? 'Notepad input sent; result not verified.'}</p>;
    case 'browser.control':
      return <p className="text-xs text-ink2">{r.note ?? 'Browser input attempted. Verify the website result before continuing.'}</p>;
    case 'whatsapp.unread_senders':
      return <div className="space-y-2 text-sm">
        <p className="text-xs text-ink2">{r.note || 'Visible unread sender names (not messages)'}</p>
        {Array.isArray(r.senders) && r.senders.length > 0
          ? <ul className="space-y-1">{r.senders.slice(0, 12).map((name: string, i: number) => <li key={i} className="rounded-lg bg-field/40 px-2 py-1">{name}</li>)}</ul>
          : <p className="text-warn">No sender names could be verified.</p>}
      </div>;
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
        {c.action === 'whatsapp.read_selected' && (<>
          <dt className="text-ink2">Privacy</dt><dd>Visible messages from selected chat will be transferred to and stored in your private HUKM history. No automatic Gemini sharing.</dd>
        </>)}
        {c.action === 'whatsapp.draft_reply' && (<>
          <dt className="text-ink2">Verified contact</dt><dd>{String(a.contact)}</dd>
          <dt className="text-ink2">Reply</dt><dd className="whitespace-pre-wrap break-words">{String(a.message)}</dd>
          <dt className="text-ink2">Effect</dt><dd>Types draft in selected WhatsApp Desktop chat, never sends.</dd>
        </>)}
        {c.action === 'whatsapp.send_reviewed' && (<>
          <dt className="text-ink2">FINAL SEND APPROVAL — Exact recipient</dt><dd>{String(a.contact)}</dd>
          <dt className="text-ink2">Exact message</dt><dd className="whitespace-pre-wrap break-words">{String(a.message)}</dd>
          <dt className="text-ink2">Effect</dt><dd>
            Will click Send only if the foreground WhatsApp Desktop chat header and existing draft
            match exactly. This may deliver a message immediately. Never automatically retry.
          </dd>
        </>)}
        {c.action === 'whatsapp.attach_preview' && (<>
          <dt className="text-ink2">Verified contact</dt><dd>{String(a.contact)}</dd>
          <dt className="text-ink2">Local file</dt><dd className="break-all">{String(a.path)}</dd>
          <dt className="text-ink2">Effect</dt><dd>Opens attachment preview only. Sending requires separate manual confirmation.</dd>
        </>)}
        {c.action === 'calendar.save_reviewed' && (<>
          <dt className="text-ink2">FINAL CALENDAR SAVE APPROVAL</dt><dd>{String(a.provider)}</dd>
          <dt className="text-ink2">Exact title</dt><dd>{String(a.title)}</dd>
          <dt className="text-ink2">Time</dt><dd>{String(a.startUtc)} – {String(a.endUtc)} ({String(a.timeZone)})</dd>
          <dt className="text-ink2">Chrome profile</dt><dd>{String(a.profile)}</dd>
          <dt className="text-ink2">Effect</dt><dd>
            May create a real event. Opens/clicks Save only if the visible editor URL and title match. Invitations and event ID cannot be guaranteed. Never retry automatically.
          </dd>
        </>)}
        {c.action === 'calendar.event_draft' && (<>
          <dt className="text-ink2">Calendar</dt><dd>{String(a.provider)}</dd>
          <dt className="text-ink2">Title</dt><dd>{String(a.title)}</dd>
          <dt className="text-ink2">Time</dt><dd>{String(a.startUtc)} – {String(a.endUtc)} · {String(a.timeZone)}</dd>
          <dt className="text-ink2">Chrome</dt><dd>{String(a.profile)}</dd>
          <dt className="text-ink2">Effect</dt><dd>Opens a pre-filled event editor, not a saved meeting.</dd>
        </>)}
        {['chatgpt.prompt_draft','chatgpt.submit_prompt','chatgpt.download_visible'].includes(c.action) && (<>
          <dt className="text-ink2">ChatGPT Project</dt><dd className="break-all">{String(a.projectUrl)}</dd>
          {typeof a.prompt === 'string' && <><dt className="text-ink2">Exact prompt</dt><dd className="whitespace-pre-wrap break-words">{a.prompt}</dd></>}
          <dt className="text-ink2">Effect</dt><dd>Only the reviewed action will run in the verified Chrome tab.</dd>
        </>)}
        {c.action === 'ui.inspect' && (<><dt className="text-ink2">Privacy</dt><dd>Foreground interactive button labels only; no text fields or hidden apps.</dd></>)}
        {c.action === 'ui.activate' && (<><dt className="text-ink2">Exact visible label</dt><dd>{String(a.label)}</dd></>)}
        {c.action === 'screen.capture' && (<><dt className="text-ink2">Effect</dt><dd className="text-ink2">One screenshot of the main screen is sent to your account and auto-deleted per retention settings.</dd></>)}
        {c.action === 'whatsapp.unread_senders' && (<>
          <dt className="text-ink2">Data</dt><dd>Only sender names in the visible Unread chat list, not message bodies</dd>
          <dt className="text-ink2">Privacy</dt><dd>Visible names will be transmitted to your authenticated HUKM web account and saved in command history.</dd>
        </>)}
        {c.action === 'browser.profile_open' && (<>
          <dt className="text-ink2">Chrome profile</dt><dd>{String(a.profile)}</dd>
          <dt className="text-ink2">Website</dt><dd className="break-words">{String(a.url)}</dd>
          <dt className="text-ink2">Effect</dt><dd>Launches existing local profile; never reads session cookies or signs in.</dd>
        </>)}
        {c.action === 'notepad.type' && (<>
          <dt className="text-ink2">Target</dt><dd>Currently focused Notepad window only</dd>
          <dt className="text-ink2">Exact text</dt><dd className="whitespace-pre-wrap break-words">{String(a.text ?? '')}</dd>
        </>)}
        {c.action === 'browser.control' && (<>
          <dt className="text-ink2">Browser</dt><dd>Foreground Chrome / Edge / Firefox only</dd>
          <dt className="text-ink2">Input</dt><dd>{a.kind === 'type' ? 'Type text into the selected field' : a.kind === 'click' ? `Click at ${a.x}, ${a.y}` : a.kind === 'scroll' ? `Scroll ${a.steps} steps` : `Press ${a.key}`}</dd>
          {a.kind === 'type' && <><dt className="text-ink2">Text</dt><dd className="whitespace-pre-wrap break-words">{String(a.text ?? '')}</dd></>}
          <dt className="text-ink2">Warning</dt><dd>Browser input may submit a form or change data. HUKM cannot independently verify the final website result.</dd>
        </>)}
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
      {c.status === 'completed' && actionResultUnverified(c.action,c.result) &&
        <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          {unverifiedReason(c.action)}
        </p>}
      {c.status === 'completed' && <div className="mt-3"><CommandResult c={c} /></div>}
    </div>
  );
}

