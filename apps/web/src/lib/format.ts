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
  'browser.control': 'Browser input (approval)',
  'notepad.type': 'Type into Notepad (approval)',
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
    case 'app.open': return String(a.app ?? '');
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
    case 'notepad.type': return 'text (' + String(a.text ?? '').length + ' characters)';
    case 'browser.control': return a.kind === 'click' ? `click (${a.x}, ${a.y})` : a.kind === 'scroll' ? `scroll ${a.steps}` : a.kind === 'key' ? `press ${a.key}` : 'type into browser';
    default: return '';
  }
}
