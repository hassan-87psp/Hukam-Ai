import type { ActionName, Capability } from '../../shared-types/src/index';

export const KNOWN_FOLDERS = ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos', 'home'] as const;
export type KnownFolder = (typeof KNOWN_FOLDERS)[number];

export const KNOWN_APPS = [
  'chrome',
  'edge',
  'notepad',
  'calculator',
  'explorer',
  'vscode',
  'word',
  'excel',
  'powerpoint',
  'paint',
  'settings',
  'taskmgr',
] as const;
export type KnownApp = (typeof KNOWN_APPS)[number];

export const APP_LABELS: Record<KnownApp, string> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  notepad: 'Notepad',
  calculator: 'Calculator',
  explorer: 'File Explorer',
  vscode: 'VS Code',
  word: 'Microsoft Word',
  excel: 'Microsoft Excel',
  powerpoint: 'PowerPoint',
  paint: 'Paint',
  settings: 'Windows Settings',
  taskmgr: 'Task Manager',
};

export const FOLDER_LABELS: Record<KnownFolder, string> = {
  downloads: 'Downloads',
  documents: 'Documents',
  desktop: 'Desktop',
  pictures: 'Pictures',
  music: 'Music',
  videos: 'Videos',
  home: 'Home',
};

// Only these extensions may be used as filters; also keeps the controller away from executables.
export const ALLOWED_FILTER_EXTS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'rtf',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mkv', 'avi', 'mov', 'mp3', 'wav', 'm4a',
  'zip', 'rar', '7z', 'json', 'html', 'mq4', 'mq5', 'ex4', 'ex5', 'set',
];

export interface ActionDef {
  name: ActionName;
  capability: Capability | null; // null = handled by relay only
  label: string;
  timeoutMs: number;
  /** Always requires explicit approval, regardless of user settings. */
  alwaysApprove?: boolean;
  /** Requires approval by default (user may relax in settings). */
  defaultApprove?: boolean;
  validate(args: Record<string, unknown>): ValidationResult;
}

export type ValidationResult = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

const ok = (args: Record<string, unknown>): ValidationResult => ({ ok: true, args });
const fail = (error: string): ValidationResult => ({ ok: false, error });

function str(v: unknown, field: string, max: number, required = true): string | ValidationResult {
  if (v === undefined || v === null || v === '') {
    return required ? fail(`${field} is required`) : '';
  }
  if (typeof v !== 'string') return fail(`${field} must be a string`);
  const s = v.trim();
  if (required && !s) return fail(`${field} is required`);
  if (s.length > max) return fail(`${field} is too long (max ${max})`);
  if (/[\u0000-\u001f]/.test(s)) return fail(`${field} contains control characters`);
  return s;
}
const isErr = (v: unknown): v is ValidationResult => typeof v === 'object' && v !== null && 'ok' in v;

function exts(v: unknown): string[] | ValidationResult {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return fail('ext must be an array');
  if (v.length > 10) return fail('too many extensions');
  const out: string[] = [];
  for (const e of v) {
    if (typeof e !== 'string') return fail('ext entries must be strings');
    const x = e.toLowerCase().replace(/^\./, '');
    if (!ALLOWED_FILTER_EXTS.includes(x)) return fail(`extension .${x} is not allowed`);
    out.push(x);
  }
  return out;
}

function folder(v: unknown, required: boolean): string | ValidationResult {
  if (v === undefined || v === null || v === '') return required ? fail('folder is required') : '';
  if (typeof v !== 'string' || !(KNOWN_FOLDERS as readonly string[]).includes(v)) return fail('unknown folder');
  return v;
}

function safeUrl(v: unknown): string | ValidationResult {
  const s = str(v, 'url', 2048);
  if (isErr(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s))
    return fail('only http/https URLs are allowed');
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return fail('invalid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('only http/https URLs are allowed');
  if (u.username || u.password) return fail('URLs with credentials are not allowed');
  return u.toString();
}

function windowsPath(v: unknown): string | ValidationResult {
  const s = str(v, 'path', 1024);
  if (isErr(s)) return s;
  if (s.includes('\0')) return fail('invalid path');
  if (/^\\\\/.test(s)) return fail('network paths are not allowed');
  if (s.split(/[\\/]/).includes('..')) return fail('path traversal is not allowed');
  return s;
}

export const ACTIONS: Record<ActionName, ActionDef> = {
  'app.open': {
    name: 'app.open', capability: 'apps', label: 'Open application', timeoutMs: 20000,
    validate(a) {
      if (typeof a.app !== 'string' || !(KNOWN_APPS as readonly string[]).includes(a.app)) return fail('application is not in the allowlist');
      return ok({ app: a.app });
    },
  },
  'folder.open': {
    name: 'folder.open', capability: 'folders', label: 'Open folder', timeoutMs: 15000,
    validate(a) {
      const f = folder(a.folder, true);
      return isErr(f) ? f : ok({ folder: f });
    },
  },
  'folder.list': {
    name: 'folder.list', capability: 'files', label: 'List folder', timeoutMs: 20000,
    validate(a) {
      const f = folder(a.folder, true);
      if (isErr(f)) return f;
      const limit = typeof a.limit === 'number' ? Math.min(Math.max(1, Math.floor(a.limit)), 200) : 60;
      return ok({ folder: f, limit });
    },
  },
  'file.search': {
    name: 'file.search', capability: 'files', label: 'Search files', timeoutMs: 45000,
    validate(a) {
      const q = str(a.query, 'query', 120, false);
      if (isErr(q)) return q;
      const e = exts(a.ext);
      if (isErr(e)) return e;
      const loc = folder(a.location, false);
      if (isErr(loc)) return loc;
      const sort = a.sort === 'latest' ? 'latest' : 'relevance';
      if (!q && e.length === 0 && sort !== 'latest') return fail('give a file name, a file type, or ask for the latest files');
      const limit = typeof a.limit === 'number' ? Math.min(Math.max(1, Math.floor(a.limit)), 100) : 30;
      return ok({ query: q, ext: e, location: loc || null, sort, limit });
    },
  },
  'file.open': {
    name: 'file.open', capability: 'files', label: 'Open file', timeoutMs: 45000,
    validate(a) {
      if (a.path !== undefined) {
        const p = windowsPath(a.path);
        return isErr(p) ? p : ok({ path: p });
      }
      const q = str(a.query, 'query', 120, false);
      if (isErr(q)) return q;
      const e = exts(a.ext);
      if (isErr(e)) return e;
      const loc = folder(a.location, false);
      if (isErr(loc)) return loc;
      const sort = a.sort === 'latest' ? 'latest' : 'relevance';
      if (!q && e.length === 0 && sort !== 'latest') return fail('which file? give a name or a type');
      return ok({ query: q, ext: e, location: loc || null, sort });
    },
  },
  'file.reveal': {
    name: 'file.reveal', capability: 'files', label: 'Show file in folder', timeoutMs: 15000,
    validate(a) {
      const p = windowsPath(a.path);
      return isErr(p) ? p : ok({ path: p });
    },
  },
  'web.open': {
    name: 'web.open', capability: 'browser', label: 'Open website', timeoutMs: 15000,
    validate(a) {
      const u = safeUrl(a.url);
      return isErr(u) ? u : ok({ url: u });
    },
  },
  'web.search': {
    name: 'web.search', capability: 'browser', label: 'Web search', timeoutMs: 15000,
    validate(a) {
      const q = str(a.query, 'query', 200);
      return isErr(q) ? q : ok({ query: q });
    },
  },
  'youtube.search': {
    name: 'youtube.search', capability: 'youtube', label: 'YouTube search', timeoutMs: 15000,
    validate(a) {
      const q = str(a.query, 'query', 200);
      return isErr(q) ? q : ok({ query: q });
    },
  },
  'youtube.play': {
    name: 'youtube.play', capability: 'youtube', label: 'Play on YouTube', timeoutMs: 30000,
    validate(a) {
      const q = str(a.query, 'query', 200);
      return isErr(q) ? q : ok({ query: q });
    },
  },
  'device.status': {
    name: 'device.status', capability: 'system', label: 'Device status', timeoutMs: 15000,
    validate: () => ok({}),
  },
  'apps.list': {
    name: 'apps.list', capability: 'system', label: 'List open applications', timeoutMs: 15000,
    validate: () => ok({}),
  },
  'window.active': {
    name: 'window.active', capability: 'system', label: 'Active window', timeoutMs: 10000,
    validate: () => ok({}),
  },
  'window.focus': {
    name: 'window.focus', capability: 'input', label: 'Focus window', timeoutMs: 10000,
    validate(a) {
      const t = str(a.title, 'title', 200);
      return isErr(t) ? t : ok({ title: t });
    },
  },
  'screen.capture': {
    name: 'screen.capture', capability: 'screen', label: 'Capture screenshot', timeoutMs: 20000, defaultApprove: true,
    validate: () => ok({}),
  },
  'system.lock': {
    name: 'system.lock', capability: 'system', label: 'Lock computer', timeoutMs: 10000, alwaysApprove: true,
    validate: () => ok({}),
  },
  'whatsapp.open': {
    name: 'whatsapp.open', capability: 'whatsapp', label: 'Open WhatsApp', timeoutMs: 15000,
    validate(a) {
      if (a.mode === undefined) return ok({});
      if (a.mode !== 'desktop' && a.mode !== 'web') return fail('WhatsApp mode must be desktop or web');
      return ok({ mode: a.mode });
    },
  },
  'whatsapp.check': {
    name: 'whatsapp.check', capability: 'whatsapp', label: 'Check WhatsApp', timeoutMs: 20000,
    validate(a) {
      if (a.mode === undefined) return ok({});
      if (a.mode !== 'desktop' && a.mode !== 'web') return fail('WhatsApp mode must be desktop or web');
      return ok({ mode: a.mode });
    },
  },
  'whatsapp.compose': {
    name: 'whatsapp.compose', capability: 'whatsapp', label: 'Prepare WhatsApp message', timeoutMs: 20000, alwaysApprove: true,
    validate(a) {
      const contact = str(a.contact, 'contact', 60);
      if (isErr(contact)) return contact;
      const message = str(a.message, 'message', 1000);
      if (isErr(message)) return message;
      if (a.phone !== undefined) {
        if (typeof a.phone !== 'string' || !/^\d{8,15}$/.test(a.phone)) return fail('invalid phone number');
        return ok({ contact, message, phone: a.phone });
      }
      return ok({ contact, message });
    },
  },
  'command.cancel': {
    name: 'command.cancel', capability: null, label: 'Cancel command', timeoutMs: 5000,
    validate: () => ok({}),
  },
};

export function validateCommand(action: string, args: unknown): ValidationResult & { def?: ActionDef } {
  const def = (ACTIONS as Record<string, ActionDef>)[action];
  if (!def) return { ok: false, error: `unsupported action: ${action}` };
  const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  if (JSON.stringify(a).length > 4000) return { ok: false, error: 'arguments too large' };
  const r = def.validate(a);
  return { ...r, def };
}

export function requiresApproval(action: ActionName, userRules: Partial<Record<ActionName, boolean>> = {}): boolean {
  const def = ACTIONS[action];
  if (def.alwaysApprove) return true;
  if (action in userRules) return !!userRules[action];
  return !!def.defaultApprove;
}
