import type { ActionName, CommandStatus } from '../../../../packages/shared-types/src/index';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Historical pre-fix Controllers may have marked unread checks as Completed.
 * This UI guard prevents the green badge from lying about those old results.
 */
/** Distinguish an attempted UI action from a VERIFIED real-world result.
 * Never show green Completed just because the Controller clicked Send/Save
 * when delivery, event creation, or final file output is still unknown.
 */
export function actionResultUnverified(action: ActionName, result: unknown): boolean {
  const r = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown> : {};
  switch (action) {
    case 'screen.capture':
      return r.ocrRead===true;
    case 'controller.update':
      return !(r.verified === true && r.updateAvailable === false);
    case 'app.close':
      return !(r.windowClosed === true && r.verified === true);
    case 'whatsapp.send_reviewed':
    case 'whatsapp.send_attachment_reviewed':
      return r.deliveryVerified !== true;
    case 'calendar.save_reviewed':
      return r.eventCreatedVerified !== true;
    case 'chatgpt.submit_prompt':
      return r.responseVerified !== true;
    case 'chatgpt.read_response':
      return true; // visible-only, not guaranteed full ChatGPT answer
    case 'chatgpt.followup_draft':
      return true; // drafted only, not sent
    case 'chatgpt.download_visible':
      return !(r.downloadVerified === true && r.verified === true &&
        typeof r.fileName === 'string' && !!r.fileName &&
        typeof r.sizeBytes === 'number' && r.sizeBytes > 0);
    case 'ui.activate_observed':
    case 'ui.navigate_verified':
      return r.verified !== true;
    case 'desktop.control':
      return r.verified !== true;
    case 'email.inbox_open':
    case 'email.compose_draft':
      return r.verified !== true;
    case 'whatsapp.check':
      return !(typeof r.unreadChats === 'number' && Number.isInteger(r.unreadChats) &&
        r.unreadChats >= 0 && r.unreadChats <= 999 &&
        (r.source === 'WhatsApp Desktop Unread filter' || r.source === 'window title'));
    case 'whatsapp.unread_senders': {
      // Never show an incomplete 2/10 sender list as a verified green result.
      // A genuine, independently verified zero badge is sufficient even for
      // older Windows Controllers that predate the coverage flag.
      if (Array.isArray(r.senders) && r.senders.length===0 &&
          r.totalUnreadChats===0 && r.unreadCountVerified===true &&
          r.filterSelectedVerified===true &&
          (r.source==='Explicit WhatsApp Unread zero badge' || r.source==='Explicit WhatsApp empty Unread-filter list')) return false;
      if (!Array.isArray(r.senders) || r.filterSelectedVerified!==true ||
          r.unreadCountVerified!==true || r.allBadgeChatsMatched!==true ||
          !Number.isInteger(r.totalUnreadChats) || (r.totalUnreadChats as number)<0 ||
          r.senders.length!==r.totalUnreadChats) return true;
      const names=r.senders as unknown[];
      if(!names.every(x=>typeof x==='string' && !!x.trim()))return true;
      if(new Set(names.map(x=>(x as string).trim().toLocaleLowerCase())).size!==names.length)return true;
      return names.length===0 && r.source!=='Explicit WhatsApp Unread zero badge' &&
        r.scanStopped!=='explicit_empty';
    }
    default:
      return false;
  }
}

export const STATUS_LABEL: Record<CommandStatus, string> = {
  pending: 'Pending',
  awaiting_approval: 'Awaiting approval',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
};

export const STATUS_TONE: Record<CommandStatus, 'info' | 'ok' | 'warn' | 'bad' | 'muted'> = {
  pending: 'info',
  awaiting_approval: 'warn',
  running: 'info',
  completed: 'ok',
  failed: 'bad',
  cancelled: 'muted',
  timed_out: 'warn',
};

export const ACTION_LABEL: Record<ActionName, string> = {
  'app.open': 'Open app',
  'app.close': 'Close Notepad (approved)',
  'controller.update': 'Update Windows Controller (owner approved)',
  'folder.open': 'Open folder',
  'folder.list': 'List folder',
  'file.search': 'Search files',
  'file.open': 'Open file',
  'file.reveal': 'Show in folder',
  'web.open': 'Open website',
  'web.search': 'Web search',
  'youtube.search': 'YouTube search',
  'youtube.play': 'YouTube play',
  'device.status': 'Device status',
  'apps.list': 'Open apps',
  'window.active': 'Active window',
  'window.focus': 'Focus window',
  'screen.capture': 'Screenshot',
  'diagnostics.probe': 'Safe laptop diagnostics',
  'ui.inspect': 'Inspect visible controls',
  'ui.activate': 'Activate visible control',
  'ui.activate_observed': 'Activate inspected button (approved)',
  'ui.navigate_verified': 'Observe → click → verify safe UI control',
  'ui.scroll': 'Scroll active app (approved)',
  'desktop.control': 'Desktop mouse/keyboard (approved)',
  'email.inbox_open': 'Open email inbox (approval)',
  'email.compose_draft': 'Prepare email draft (approval)',
  'calendar.event_draft': 'Calendar event draft',
  'calendar.save_reviewed': 'Save reviewed Calendar event',
  'chatgpt.prompt_draft': 'ChatGPT prompt draft',
  'chatgpt.submit_prompt': 'Submit ChatGPT prompt',
  'chatgpt.read_response': 'Read visible ChatGPT response',
  'chatgpt.followup_draft': 'Draft contextual ChatGPT follow-up',
  'chatgpt.download_visible': 'Download visible ChatGPT file',
  'whatsapp.select_chat': 'Select exact WhatsApp chat',
  'whatsapp.read_selected': 'Read selected WhatsApp chat',
  'whatsapp.draft_reply': 'Draft WhatsApp reply',
  'whatsapp.send_reviewed': 'Send reviewed WhatsApp message',
  'whatsapp.send_attachment_reviewed': 'Send reviewed WhatsApp attachment',
  'whatsapp.attach_preview': 'WhatsApp file preview',
  'browser.control': 'Browser input (approval)',
  'notepad.type': 'Type into Notepad (approval)',
  'browser.profile_open': 'Open saved Chrome profile',
  'system.lock': 'Lock laptop',
  'whatsapp.open': 'Open WhatsApp',
  'whatsapp.check': 'Check WhatsApp',
  'whatsapp.unread_senders': 'Unread WhatsApp senders',
  'whatsapp.compose': 'WhatsApp draft',
  'whatsapp.read_visible': 'Read visible WhatsApp chat aloud',
  'command.cancel': 'Cancel',
};

export function describeArgs(action: ActionName, args: Record<string, unknown>): string {
  const a = args as Record<string, any>;
  switch (action) {
    case 'controller.update': return 'official HUKM release';
    case 'app.open':
    case 'app.close': return String(a.app ?? '');
    case 'folder.open':
    case 'folder.list': return String(a.folder ?? '');
    case 'file.search':
    case 'file.open':
      if (a.path) return String(a.path).split(/[\\/]/).pop() ?? '';
      return [a.query, a.ext?.length ? `.${a.ext[0]}` : '', a.location ? `in ${a.location}` : '', a.sort === 'latest' ? '(latest)' : ''].filter(Boolean).join(' ');
    case 'file.reveal': return String(a.path ?? '').split(/[\\/]/).pop() ?? '';
    case 'web.open': try { return new URL(String(a.url)).host; } catch { return String(a.url); }
    case 'web.search':
    case 'youtube.search':
    case 'youtube.play': return `“${a.query}”`;
    case 'whatsapp.compose': return `to ${a.contact}`;
    case 'window.focus': return String(a.title ?? '');
    case 'browser.profile_open': return String(a.profile)+' · '+String(a.url);
    case 'notepad.type': return 'text (' + String(a.text ?? '').length + ' characters)';
    case 'ui.activate': return 'control ' + String(a.label ?? '');
    case 'email.inbox_open': return String(a.provider ?? '')+' · '+String(a.profile ?? '');
    case 'email.compose_draft': return String(a.provider ?? '')+' · to '+String(a.to ?? '')+' · '+String(a.subject ?? '')+' · body '+String(a.body ?? '').length+' chars';
    case 'calendar.event_draft': return String(a.provider ?? '') + ' · ' + String(a.title ?? '');
    case 'chatgpt.prompt_draft': return 'prompt (' + String(a.prompt ?? '').length + ' characters)';
    case 'chatgpt.submit_prompt': return 'reviewed prompt (' + String(a.prompt ?? '').length + ' characters)';
    case 'chatgpt.read_response': return 'visible reply to previous exact question';
    case 'chatgpt.followup_draft': return 'same-thread follow-up (' + String(a.prompt ?? '').length + ' characters)';
    case 'chatgpt.download_visible': return 'current ChatGPT Project';
    case 'whatsapp.select_chat': return 'exact contact: ' + String(a.contact ?? '');
    case 'whatsapp.read_selected': return a.contact ? 'verify contact: ' + String(a.contact) : 'currently selected chat';
    case 'whatsapp.draft_reply': return 'to ' + String(a.contact ?? '');
    case 'whatsapp.attach_preview': return 'file for ' + String(a.contact ?? '');
    case 'desktop.control':
      return ['click','double_click','right_click'].includes(a.kind) ? `${a.kind} (${a.x}, ${a.y})`
        : a.kind==='drag' ? `drag (${a.x}, ${a.y}) to (${a.toX}, ${a.toY})`
        : a.kind==='scroll' ? `scroll ${a.steps}`
        : a.kind==='key' ? `press ${a.key}`
        : 'type ('+String(a.text??'').length+' characters)';
    case 'ui.activate_observed': return String(a.role ?? '') + ': ' + String(a.label ?? '');
    case 'browser.control': return a.kind === 'click' ? `click (${a.x}, ${a.y})` : a.kind === 'scroll' ? `scroll ${a.steps}` : a.kind === 'key' ? `press ${a.key}` : 'type into browser';
    default: return '';
  }
}
