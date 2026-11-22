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
  'controller.update': {
    name: 'controller.update', capability: 'system',
    label: 'Install verified HUKM update on paired Windows device',
    timeoutMs: 120000, alwaysApprove: true,
    validate(a) {
      return Object.keys(a).length === 0 ? ok({}) :
        fail('HUKM update accepts no user-supplied URL, executable or arguments');
    },
  },
  'app.close': {
    name: 'app.close', capability: 'apps', label: 'Close a verified Notepad window',
    timeoutMs: 12000, alwaysApprove: true,
    validate(a) {
      // Do not expose an arbitrary process-kill mechanism to AI planning.
      // Future apps require separate reviewed window-close adapters.
      return a.app === 'notepad' ? ok({ app: 'notepad' }) :
        fail('Only a verified Notepad window can be closed by this action');
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
  'diagnostics.probe': {
    name:'diagnostics.probe', capability:'system', label:'Safe laptop diagnostics',
    timeoutMs:20000, alwaysApprove:true, validate:()=>ok({}),
  },
  'ui.inspect': {
    name: 'ui.inspect', capability: 'screen', label: 'Inspect visible app controls',
    timeoutMs: 25000, alwaysApprove: true, validate: () => ok({}),
  },
  'ui.scroll': {
    name:'ui.scroll',capability:'input',label:'Scroll active Windows application',
    timeoutMs:15000,alwaysApprove:true,
    validate(a){
      const steps=a.steps;
      if(typeof steps!=='number'||!Number.isInteger(steps)||steps===0||Math.abs(steps)>5)
        return fail('scroll steps must be a nonzero integer between -5 and 5');
      return ok({steps});
    },
  },
  'ui.activate': {
    name: 'ui.activate', capability: 'input', label: 'Legacy UI click (requires a new inspection)',
    timeoutMs: 25000, alwaysApprove: true,
    validate: () => fail('Inspect visible controls first; use the observed-control approval instead.'),
  },
  'ui.activate_observed': {
    name: 'ui.activate_observed', capability: 'input',
    label: 'Activate a verified, inspected on-screen button',
    timeoutMs: 25000, alwaysApprove: true,
    validate(a) {
      const label = str(a.label,'label',100);
      if(isErr(label))return label;
      const role = a.role;
      const snapshot = a.snapshot;
      const allowedRoles=['ButtonControl','TabItemControl','HyperlinkControl','MenuItemControl',
        'CheckBoxControl','RadioButtonControl','ComboBoxControl'];
      if(typeof role!=='string'||!allowedRoles.includes(role))return fail('control role must match the inspection');
      if(typeof snapshot!=='string'||!/^[a-f0-9]{64}$/.test(snapshot))
        return fail('recent exact window inspection fingerprint is required');
      const words=label.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];
      const banned=new Set(['send','sending','delete','remove','pay','payment','purchase','buy',
        'checkout','submit','confirm','approve','authorize','publish','share','transfer',
        'withdraw','deposit','invite','report','block','unblock','call','join',
        'upload','install','execute','run','post','book','order','save','accept',
        'apply','logout','signin','signout','login','erase','clear','reset']);
      if(words.some(word=>banned.has(word)))return fail('sensitive control needs a dedicated reviewed workflow');
      const phrase=' '+words.join(' ')+' ';
      if(['log out','sign out','sign in','place order','check out','video call',
        'voice call','add payment','make payment'].some(x=>phrase.includes(' '+x+' ')))
        return fail('sensitive control needs a dedicated reviewed workflow');
      return ok({label,role,snapshot});
    },
  },
  'ui.navigate_verified': {
    name:'ui.navigate_verified',capability:'input',
    label:'Navigate a verified visible control and verify expected UI',
    timeoutMs:30000,alwaysApprove:true,
    validate(a) {
      const processes=['chrome.exe','msedge.exe','firefox.exe','notepad.exe','explorer.exe'];
      if(typeof a.process!=='string'||!processes.includes(a.process))
        return fail('Choose an exact supported foreground process');
      const label=str(a.label,'label',100);
      if(isErr(label))return label;
      const roles=['ButtonControl','TabItemControl','HyperlinkControl','MenuItemControl',
        'CheckBoxControl','RadioButtonControl','ComboBoxControl'];
      if(typeof a.role!=='string'||!roles.includes(a.role))
        return fail('Select an exact visible control role');
      const safe=(value:string)=>{
        const words=value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];
        const banned=new Set(['send','sending','delete','remove','pay','payment','purchase','buy',
          'checkout','submit','confirm','approve','authorize','publish','share','transfer',
          'withdraw','deposit','invite','report','block','unblock','call','join','upload',
          'install','execute','run','post','book','order','save','accept','apply',
          'logout','signin','signout','login','erase','clear','reset']);
        const phrase=' '+words.join(' ')+' ';
        return words.length>0&&!words.some(w=>banned.has(w))&&
          !['log out','sign out','sign in','place order','check out',
            'video call','voice call','add payment','make payment']
            .some(x=>phrase.includes(' '+x+' '));
      };
      if(!safe(label))return fail('Sensitive controls require a dedicated reviewed workflow');
      if(a.expectLabel===undefined&&a.expectRole!==undefined)
        return fail('Expected role requires an expected label');
      let expectLabel: string|undefined;
      if(a.expectLabel!==undefined){
        const value=str(a.expectLabel,'expectLabel',100);
        if(isErr(value))return value;
        if(!safe(value))return fail('Expected control contains a sensitive label');
        if(typeof a.expectRole!=='string'||!roles.includes(a.expectRole))
          return fail('Expected role must match an accessible control');
        expectLabel=value;
      }
      return ok({process:a.process,label,role:a.role,
        ...(expectLabel?{expectLabel,expectRole:a.expectRole}:{})});
    },
  },
  'desktop.control': {
    name: 'desktop.control', capability: 'input', label: 'Approved foreground laptop mouse/keyboard',
    timeoutMs: 25000, alwaysApprove: true,
    validate(a) {
      const kind = a.kind;
      if (!['click', 'double_click', 'right_click', 'drag', 'scroll', 'type', 'key'].includes(String(kind ?? '')))
        return fail('unsupported desktop input kind');
      const coordinate = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= -32000 && v <= 32000;
      if (['click', 'double_click', 'right_click', 'drag'].includes(String(kind))) {
        if (!coordinate(a.x) || !coordinate(a.y))
          return fail('mouse coordinates must be absolute integer pixels from -32000 to 32000');
        if (kind === 'drag') {
          if (!coordinate(a.toX) || !coordinate(a.toY))
            return fail('drag destination coordinates must be absolute integer pixels');
          return ok({kind, x:a.x, y:a.y, toX:a.toX, toY:a.toY});
        }
        return ok({kind, x:a.x, y:a.y});
      }
      if (kind === 'type') {
        const text = str(a.text, 'text', 1000);
        if (isErr(text)) return text;
        return ok({kind, text});
      }
      if (kind === 'scroll') {
        if (typeof a.steps !== 'number' || !Number.isInteger(a.steps) ||
            a.steps === 0 || Math.abs(a.steps) > 5)
          return fail('scroll steps must be a nonzero integer from -5 to 5');
        return ok({kind, steps:a.steps});
      }
      const keys = ['enter','tab','shift+tab','escape','backspace','home','end',
        'arrowdown','arrowup','arrowleft','arrowright','ctrl+a','ctrl+c','ctrl+v','ctrl+z','ctrl+s'];
      if (!keys.includes(String(a.key ?? ''))) return fail('desktop keyboard shortcut not allowed');
      return ok({kind,key:a.key});
    },
  },
  'email.inbox_open': {
    name:'email.inbox_open', capability:'browser', label:'Open selected Gmail/Outlook inbox',
    timeoutMs:20000, alwaysApprove:true,
    validate(a) {
      if (a.provider !== 'google' && a.provider !== 'outlook')
        return fail('Email provider must be google or outlook');
      const profile=str(a.profile,'profile',80);
      if(isErr(profile))return profile;
      if(!/^(?:Default|Profile [1-9][0-9]?)$/.test(profile))
        return fail('Choose an existing Chrome profile directory');
      return ok({provider:a.provider,profile});
    },
  },
  'email.compose_draft': {
    name:'email.compose_draft', capability:'browser', label:'Prepare Gmail/Outlook email draft',
    timeoutMs:25000, alwaysApprove:true,
    validate(a) {
      const checked=ACTIONS['email.inbox_open'].validate(a);
      if(!checked.ok)return checked;
      const to=str(a.to,'to',254),subject=str(a.subject,'subject',120);
      const body=str(a.body,'body',1000);
      if(isErr(to))return to;
      if(isErr(subject))return subject;
      if(isErr(body))return body;
      if(!/^[A-Za-z0-9.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(to))
        return fail('Enter one valid recipient email address');
      return ok({...checked.args,to,subject,body});
    },
  },
  'calendar.event_draft': {
    name: 'calendar.event_draft', capability: 'browser', label: 'Prepare Calendar event draft',
    timeoutMs: 25000, alwaysApprove: true,
    validate(a) {
      if (a.provider !== 'google' && a.provider !== 'outlook') return fail('Calendar must be google or outlook');
      const title = str(a.title, 'title', 100);
      if (isErr(title)) return title;
      const profile = str(a.profile, 'profile', 80);
      if (isErr(profile)) return profile;
      if (!/^(?:Default|Profile [1-9][0-9]?)$/.test(profile)) return fail('Invalid Chrome profile directory');
      const startUtc = a.startUtc, endUtc = a.endUtc;
      const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
      if (typeof startUtc !== 'string' || typeof endUtc !== 'string' ||
          !iso.test(startUtc) || !iso.test(endUtc)) return fail('Calendar times must be UTC ISO seconds');
      const begin = Date.parse(startUtc), finish = Date.parse(endUtc);
      if (!Number.isFinite(begin) || !Number.isFinite(finish) ||
          finish <= begin || finish - begin > 86400000 ||
          begin < Date.now() - 300000 || begin > Date.now() + 366*86400000)
        return fail('Calendar event date or duration invalid');
      const timeZone = str(a.timeZone, 'timeZone', 70);
      if (isErr(timeZone)) return timeZone;
      if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(timeZone))
        return fail('Use IANA time zone, such as Asia/Kuala_Lumpur');
      const details = str(a.details ?? '', 'details', 500, false);
      if (isErr(details)) return details;
      const location = str(a.location ?? '', 'location', 120, false);
      if (isErr(location)) return location;
      return ok({provider:a.provider, title, profile, startUtc, endUtc, timeZone, details, location});
    },
  },
  'calendar.save_reviewed': {
    name:'calendar.save_reviewed', capability:'browser', label:'Save reviewed Calendar event (final approval)',
    timeoutMs:30000, alwaysApprove:true,
    validate(a){
      const v = ACTIONS['calendar.event_draft'].validate(a);
      return v.ok ? ok(v.args) : v;
    },
  },
  'chatgpt.prompt_draft': {
    name:'chatgpt.prompt_draft', capability:'browser', label:'Draft prompt in ChatGPT Project',
    timeoutMs:25000, alwaysApprove:true,
    validate(a) {
      const url = str(a.projectUrl, 'projectUrl', 500);
      if (isErr(url)) return url;
      let u: URL;
      try { u = new URL(url); } catch { return fail('invalid ChatGPT Project URL'); }
      if(u.protocol !== 'https:' || u.hostname !== 'chatgpt.com' || u.username || u.password || u.hash)
        return fail('ChatGPT Project URL must be https://chatgpt.com');
      const prompt = a.prompt;
      if(typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1800 ||
          /[\u0000-\u0008\u000b-\u001f]/.test(prompt)) return fail('invalid ChatGPT prompt');
      return ok({projectUrl:u.toString(),prompt});
    },
  },
  'chatgpt.submit_prompt': {
    name:'chatgpt.submit_prompt', capability:'browser', label:'Send reviewed ChatGPT prompt',
    timeoutMs:25000, alwaysApprove:true,
    validate(a) {
      const draft = ACTIONS['chatgpt.prompt_draft'].validate(a);
      return draft.ok ? ok({projectUrl:draft.args.projectUrl, prompt:draft.args.prompt}) : draft;
    },
  },
  'chatgpt.read_response': {
    name:'chatgpt.read_response', capability:'browser',
    label:'Read visible ChatGPT response (owner-approved)',
    timeoutMs:55000, alwaysApprove:true,
    validate(a) {
      const draft=ACTIONS['chatgpt.prompt_draft'].validate(a);
      return draft.ok?ok({projectUrl:draft.args.projectUrl,prompt:draft.args.prompt}):draft;
    },
  },
  'chatgpt.followup_draft': {
    name:'chatgpt.followup_draft', capability:'browser',
    label:'Draft a follow-up in the verified ChatGPT conversation',
    timeoutMs:30000, alwaysApprove:true,
    validate(a){
      const draft=ACTIONS['chatgpt.prompt_draft'].validate(a);
      if(!draft.ok)return draft;
      const prior=a.previousPrompt;
      if(typeof prior!=='string'||!prior.trim()||prior.length>1800||
         /[\u0000-\u0008\u000b-\u001f]/.test(prior))
        return fail('Exact previous ChatGPT question is required');
      return ok({projectUrl:draft.args.projectUrl,prompt:draft.args.prompt,previousPrompt:prior});
    },
  },
  'chatgpt.download_visible': {
    name:'chatgpt.download_visible', capability:'browser', label:'Wait for and download ChatGPT result',
    timeoutMs:150000, alwaysApprove:true,
    validate(a) {
      if(typeof a.projectUrl!=='string' || a.projectUrl.length>500) return fail('invalid project URL');
      let u: URL;
      try {u = new URL(a.projectUrl);}catch{return fail('invalid project URL');}
      if(u.protocol!=='https:' || u.hostname!=='chatgpt.com' || u.username||u.password||u.hash)
        return fail('ChatGPT Project URL must be https://chatgpt.com');
      if(a.assetFolder!==undefined){
        if(typeof a.assetFolder!=='string'||a.assetFolder.length>350||
          !/^[A-Za-z]:[\\/][^\x00-\x1f<>:"|?*]+$/.test(a.assetFolder)||
          a.assetFolder.slice(3).split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||/[ .]$/.test(p)))
          return fail('Asset folder must be an existing absolute Windows directory');
        return ok({projectUrl:u.toString(),assetFolder:a.assetFolder});
      }
      return ok({projectUrl:u.toString()});
    },
  },
  'whatsapp.select_chat': {
    name:'whatsapp.select_chat', capability:'whatsapp',
    label:'Select exact visible contact in Personal WhatsApp Desktop',
    timeoutMs:30000, alwaysApprove:true,
    validate(a) {
      const contact=str(a.contact,'contact',80);
      return isErr(contact) ? contact : ok({contact});
    },
  },
  'whatsapp.read_selected': {
    name:'whatsapp.read_selected', capability:'whatsapp',
    label:'Read selected visible WhatsApp chat (optional exact contact check)',
    timeoutMs:30000, alwaysApprove:true,
    validate(a) {
      if(a.contact===undefined)return ok({});
      const contact=str(a.contact,'contact',80);
      return isErr(contact) ? contact : ok({contact});
    },
  },
  'whatsapp.draft_reply': {
    name:'whatsapp.draft_reply', capability:'whatsapp', label:'Draft reply in selected WhatsApp chat',
    timeoutMs:30000, alwaysApprove:true,
    validate(a) {
      const contact = str(a.contact,'contact',80);
      if(isErr(contact)) return contact;
      const message=a.message;
      if(typeof message!=='string'||!message.trim()||message.length>1000||
         /[\u0000-\u0008\u000b-\u001f]/.test(message))return fail('invalid WhatsApp message');
      return ok({contact,message});
    },
  },
  'whatsapp.send_reviewed': {
    name:'whatsapp.send_reviewed',capability:'whatsapp',
    label:'Send reviewed WhatsApp message (final approval)',
    timeoutMs:30000,alwaysApprove:true,
    validate(a){
      const contact=str(a.contact,'contact',80);
      if(isErr(contact))return contact;
      const message=a.message;
      if(typeof message!=='string'||!message.trim()||message.length>1000||
         /[\u0000-\u0008\u000b-\u001f]/.test(message))return fail('invalid WhatsApp message');
      return ok({contact,message});
    },
  },
  'whatsapp.attach_preview': {
    name:'whatsapp.attach_preview', capability:'whatsapp', label:'Prepare WhatsApp attachment preview',
    timeoutMs:30000, alwaysApprove:true,
    validate(a) {
      const contact=str(a.contact,'contact',80);
      if(isErr(contact)) return contact;
      const path=windowsPath(a.path);
      if(isErr(path)) return path;
      return ok({contact,path});
    },
  },
  'whatsapp.send_attachment_reviewed': {
    name:'whatsapp.send_attachment_reviewed', capability:'whatsapp',
    label:'Send reviewed WhatsApp file (final approval)',
    timeoutMs:35000, alwaysApprove:true,
    validate(a){
      const v=ACTIONS['whatsapp.attach_preview'].validate(a);
      return v.ok ? ok(v.args) : v;
    },
  },
  'screen.capture': {
    name: 'screen.capture', capability: 'screen', label: 'Capture screen or read visible text', timeoutMs: 40000, defaultApprove: true, alwaysApprove: true,
    validate(a) {
      if (!Object.keys(a).length) return ok({});
      if (Object.keys(a).some(k=>!['monitor','textOnly'].includes(k)) || !Number.isInteger(a.monitor) ||
          (a.monitor as number) < 1 || (a.monitor as number) > 16 ||
          ('textOnly' in a && a.textOnly!==true))
        return fail('Select one physical monitor numbered 1–16; optional textOnly must be true');
      return ok({monitor:a.monitor,...(a.textOnly===true?{textOnly:true}:{})});
    },
  },
  'browser.control': {
    name: 'browser.control', capability: 'input', label: 'Approved browser input',
    timeoutMs: 20000, alwaysApprove: true,
    validate(a) {
      if (!['click', 'type', 'scroll', 'key'].includes(String(a.kind ?? '')))
        return fail('browser action must be click, type, scroll or key');
      const kind = String(a.kind);
      if (kind === 'click') {
        if (!Number.isInteger(a.x) || !Number.isInteger(a.y) ||
            (a.x as number) < 0 || (a.y as number) < 0 ||
            (a.x as number) > 9999 || (a.y as number) > 9999)
          return fail('click coordinates must be integer pixels from 0 to 9999');
        return ok({ kind, x: a.x, y: a.y });
      }
      if (kind === 'type') {
        const text = str(a.text, 'text', 1000);
        if (isErr(text)) return text;
        return ok({ kind, text });
      }
      if (kind === 'scroll') {
        if (!Number.isInteger(a.steps) || (a.steps as number) < -5 ||
            (a.steps as number) > 5 || a.steps === 0)
          return fail('scroll steps must be a non-zero integer from -5 to 5');
        return ok({ kind, steps: a.steps });
      }
      const allowedKeys = ['enter', 'tab', 'escape', 'backspace', 'home', 'end',
        'arrowdown', 'arrowup', 'ctrl+l', 'ctrl+a', 'ctrl+t', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+j'];
      if (!allowedKeys.includes(String(a.key ?? ''))) return fail('key is not in the browser allowlist');
      return ok({ kind, key: a.key });
    },
  },
  'browser.profile_open': {
    name:'browser.profile_open',capability:'browser',label:'Open saved Chrome profile',
    timeoutMs:20000,alwaysApprove:true,
    validate(a) {
      if(typeof a.profile!=='string'||! /^(?:Default|Profile [1-9][0-9]?)$/.test(a.profile))
        return fail('profile must be Default or Profile 1–99');
      if(typeof a.url!=='string'||a.url.length>500) return fail('invalid project URL');
      let url:URL;
      try {url=new URL(a.url);} catch {return fail('invalid project URL');}
      if(url.protocol!=='https:' || !['chatgpt.com','calendar.google.com','mail.google.com','outlook.office.com'].includes(url.hostname)
        ||url.username||url.password)return fail('unsupported Chrome profile destination');
      return ok({profile:a.profile,url:url.toString()});
    },
  },
  'notepad.type': {
    name: 'notepad.type', capability: 'input', label: 'Type into active Notepad',
    timeoutMs: 20000, alwaysApprove: true,
    validate(a) {
      // Notepad supports multi-line text; unlike URLs, typing permits CR/LF/TAB.
      if(typeof a.text!=='string'||!a.text.trim()||a.text.length>1200||
         /[\u0000-\u0008\u000b-\u001f]/.test(a.text)) return fail('invalid Notepad text');
      return ok({ text: a.text });
    },
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
  'whatsapp.unread_senders': {
    name: 'whatsapp.unread_senders', capability: 'whatsapp',
    // Two bounded local OCR passes (first screen + post-click) plus Windows
    // foreground acquisition may exceed the old 30s deadline on cold start.
    label: 'Scan verified WhatsApp Unread chat list', timeoutMs: 180000, alwaysApprove: true,
    validate: () => ok({}),
  },
  'whatsapp.read_visible': {
    name: 'whatsapp.read_visible', capability: 'whatsapp', label: 'Read visible WhatsApp chat aloud (locally only)',
    timeoutMs: 60000, alwaysApprove: true,
    validate: () => ok({}),
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
