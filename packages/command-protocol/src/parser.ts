import type { ActionName } from '../../shared-types/src/index';
import { KNOWN_APPS, type KnownApp, type KnownFolder } from './actions';
import { cleanText, normalize } from './normalize';

export type ParseResult =
  | { kind: 'command'; action: ActionName; args: Record<string, unknown>; normalized: string; matchedRule: string }
  | { kind: 'reply'; topic: 'greeting' | 'help' | 'whatsapp-cancelled' | 'conversation-cancelled'; normalized: string }
  | { kind: 'clarify'; topic: string; normalized: string }
  | { kind: 'unsupported'; reason: string; normalized: string };

// ---- vocabulary ---------------------------------------------------------

const OPEN = /\b(khol(o|do)?|khol do|open|launch|start|chalao|chala do|chala)\b/;
const PLAY = /\b(play|chalao|chala do|chala|lagao|laga do|sunao|suna do|bajao|baja do)\b/;
const SEARCH = /\b(search|dhoondo|dhoond|talash|find|look up|lookup|google karo|khoj)\b/;
const SHOW = /\b(dikhao|dikha do|show|batao|bata do|tell|list|display)\b/;
const CHECK = /\b(check|dekho|dekh lo|dekh)\b/;
const CANCEL = /\b(cancel|roko|rok do|ruk jao|abort|khatam karo)\b/;
const CLOSE = /\b(band karo|band kar do|close|quit|exit|kill)\b/;
const LATEST = /\b(latest|newest|recent|naya|nayi|naye|akhri|aakhri|last|tazaa|taza)\b/;

const FILE_WORD = /\b(file|files)\b/;

const EXT_STRONG: [RegExp, string[]][] = [
  [/\bpdfs?\b/, ['pdf']],
  [/\bxlsx?\b|\bcsv\b|\bspreadsheets?\b/, ['xlsx', 'xls', 'csv']],
  [/\bdocx?\b/, ['docx', 'doc']],
  [/\bpptx?\b|\bpresentations?\b/, ['pptx', 'ppt']],
  [/\bjpe?g\b|\bpng\b|\bimages?\b|\bphotos?\b|\btasveer(ein|en)?\b/, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']],
  [/\bmp4\b|\bvideo\b/, ['mp4', 'mkv', 'mov', 'avi']],
  [/\bmp3\b|\baudio\b|\bsongs?\b|\bgaana\b/, ['mp3', 'wav', 'm4a']],
  [/\bzip\b|\brar\b/, ['zip', 'rar', '7z']],
  [/\btxt\b|\btext file\b/, ['txt', 'md']],
  [/\bmq5\b|\bmq4\b/, ['mq5', 'mq4']],
];
// Only treated as a file type when "file"/"sheet"/"document" is also present (else "excel kholo" = app).
const EXT_WEAK: [RegExp, string[]][] = [
  [/\bexcel\b/, ['xlsx', 'xls', 'csv']],
  [/\bword\b/, ['docx', 'doc']],
  [/\bpowerpoint\b|\bpower point\b/, ['pptx', 'ppt']],
];

const LOCATIONS: [RegExp, KnownFolder][] = [
  [/\bdownloads?\b/, 'downloads'],
  [/\b(my )?documents\b|\bdocs\b/, 'documents'],
  [/\bdesktop\b/, 'desktop'],
  [/\bpictures\b|\bphotos folder\b/, 'pictures'],
  [/\bmusic\b/, 'music'],
  [/\bvideos\b/, 'videos'],
  [/\bhome folder\b|\buser folder\b/, 'home'],
];

const APP_ALIASES: [RegExp, KnownApp][] = [
  [/\bgoogle chrome\b|\bchrome\b/, 'chrome'],
  [/\bmicrosoft edge\b|\bedge\b/, 'edge'],
  [/\bnotepad\b/, 'notepad'],
  [/\bcalculator\b|\bcalc\b|\bcalculater\b/, 'calculator'],
  [/\bfile explorer\b|\bexplorer\b|\bthis pc\b|\bmy computer\b/, 'explorer'],
  [/\bvs ?code\b|\bvisual studio code\b/, 'vscode'],
  [/\bms word\b|\bmicrosoft word\b|\bword\b/, 'word'],
  [/\bms excel\b|\bmicrosoft excel\b|\bexcel\b/, 'excel'],
  [/\bpower ?point\b/, 'powerpoint'],
  [/\bms paint\b|\bpaint\b/, 'paint'],
  [/\bwindows settings\b|\bsettings\b|\bsetting\b/, 'settings'],
  [/\btask manager\b/, 'taskmgr'],
];

const SITES: [RegExp, string][] = [
  [/\bgoogle\s+calendar\b|\bgcal\b/, 'https://calendar.google.com/calendar/u/0/r'],
  [/\boutlook\s+calendar\b|\bmicrosoft\s+calendar\b/, 'https://outlook.office.com/calendar/'],
  [/\bgmail\b/, 'https://mail.google.com/'],
  [/\bgoogle\b/, 'https://www.google.com/'],
  [/\bfacebook\b|\bfb\b/, 'https://www.facebook.com/'],
  [/\binstagram\b|\binsta\b/, 'https://www.instagram.com/'],
  [/\blinkedin\b/, 'https://www.linkedin.com/'],
  [/\btrading ?view\b/, 'https://www.tradingview.com/'],
  [/\bforex ?factory\b/, 'https://www.forexfactory.com/'],
  [/\binvesting(\.com)?\b/, 'https://www.investing.com/'],
  [/\bmyfxbook\b/, 'https://www.myfxbook.com/'],
  [/\bchat ?gpt\b/, 'https://chatgpt.com/'],
  [/\bgithub\b/, 'https://github.com/'],
  [/\bclaude\b/, 'https://claude.ai/'],
];

const URL_RE = /\b((https?:\/\/)?([a-z0-9-]+\.)+(com|pk|net|org|io|ai|dev|app|co|uk|me|tv|info|edu|gov)(\/[^\s]*)?)\b/i;

const FILLERS = new Set([
  'please', 'zara', 'jaldi', 'jaldi se', 'mera', 'meri', 'mere', 'mujhe', 'hamein', 'humein', 'aap', 'ap', 'tum',
  'karo', 'kar', 'do', 'de', 'dein', 'dena', 'karna', 'karein', 'karen', 'kardo', 'krdo', 'ke', 'liye', 'wali', 'wala', 'wale',
  'ka', 'ki', 'par', 'pe', 'mein', 'me', 'on', 'in', 'the', 'a', 'an', 'for', 'about', 'my', 'of', 'ko', 'se', 'hai', 'hain', 'he',
  'jo', 'woh', 'wo', 'ye', 'yeh', 'is', 'us', 'koi', 'ek', 'can', 'you', 'could', 'would', 'i', 'want', 'to', 'some', 'now', 'abhi',
  'kya', 'and', 'or', 'naam', 'name', 'called', 'named', 'wali', 'saari', 'sari', 'sab', 'all', 'please', 'bhai', 'yaar', 'sir',
]);
const VERB_WORDS = new Set([
  'kholo', 'khol', 'open', 'launch', 'start', 'chalao', 'chala', 'play', 'lagao', 'laga', 'sunao', 'suna', 'bajao', 'baja',
  'search', 'dhoondo', 'dhoond', 'talash', 'find', 'look', 'up', 'lookup', 'khoj', 'dikhao', 'dikha', 'show', 'batao', 'bata',
  'tell', 'list', 'display', 'check', 'dekho', 'dekh', 'lo', 'karo', 'kar',
]);

function stripWords(text: string, extra: RegExp[] = [], keep: Set<string> = new Set()): string {
  let t = ` ${text} `;
  for (const re of extra) t = t.replace(new RegExp(re.source, 'g'), ' ');
  return t
    .split(/\s+/)
    .filter((w) => w && (keep.has(w) || (!FILLERS.has(w) && !VERB_WORDS.has(w))))
    .join(' ')
    .trim();
}

/** Recover original-case words for a normalised query where possible (roman input only). */
function restoreCase(original: string, query: string): string {
  if (!query) return query;
  const words = cleanText(original).split(' ');
  const map = new Map(words.map((w) => [w.toLowerCase(), w]));
  return query
    .split(' ')
    .map((w) => map.get(w) ?? w)
    .join(' ');
}

function detectExt(t: string): string[] {
  for (const [re, e] of EXT_STRONG) if (re.test(t)) return e;
  if (/\b(file|files|sheet|sheets|document|doc)\b/.test(t)) for (const [re, e] of EXT_WEAK) if (re.test(t)) return e;
  return [];
}
function detectLocation(t: string): KnownFolder | null {
  for (const [re, f] of LOCATIONS) if (re.test(t)) return f;
  return null;
}

// ---- WhatsApp compose (runs on the original text to keep the message verbatim) ----

const COMPOSE_WORDS = /\b(message|reply|likho|likh do|bhejo|bhej do|jawab|send|text|bol do|keh do|kaho)\b/;

function parseCompose(original: string, norm: string): { contact: string; message: string } | null {
  if (!COMPOSE_WORDS.test(norm)) return null;
  const text = cleanText(original);
  // English: "message Ali that ...", "send a message to Ali saying ...", "reply to Ali: ..."
  const en = text.match(
    /^(?:please\s+)?(?:send|write)?\s*(?:a\s+)?(?:whatsapp\s+)?(?:message|msg|text|reply)\s+(?:to\s+)?([\p{L}][\p{L}\p{M}'.-]{0,30}(?:\s[\p{L}][\p{L}\p{M}'.-]{0,30})?)\s*(?:on\s+whatsapp\s*)?(?:that|saying|:|-)\s+(.+)$/iu,
  );
  if (en) return { contact: en[1].trim(), message: en[2].trim() };
  // Roman Urdu / Urdu: "<name> ko [whatsapp par] message likho ke <msg>"
  const koMatch = text.match(/^(.*?)\s(?:ko|کو)\s(.*)$/iu);
  if (!koMatch) return null;
  let contact = koMatch[1]
    .replace(/^(whatsapp|واٹس ایپ)\s+(par|pe|mein|پر|میں)\s+/iu, '')
    .replace(/^(please|zara|plz)\s+/i, '')
    .trim();
  const rest = koMatch[2];
  const sep = rest.match(/(?:^|\s)(?:ke|keh|k|ki|that|کہ|کے|:)\s+(.+)$/iu);
  if (!sep) return null;
  const message = sep[1].trim();
  if (!contact || contact.split(/\s+/).length > 3 || !message) return null;
  contact = contact.replace(/^[\p{Ll}]/u, (c) => c.toUpperCase());
  return { contact, message: message.replace(/^[\p{Ll}]/u, (c) => c.toUpperCase()) };
}

/** Resolve a short answer to "WhatsApp Desktop ya Web?" without using
 * arbitrary strings as app names or URLs. An unclear reply is never executed. */
export type WhatsAppChoice = 'desktop' | 'web' | 'cancel' | null;
export function parseWhatsAppChoice(input: string): WhatsAppChoice {
  const t = normalize(input);
  if (/^(cancel|rehne do|rehnay do|choro|chor do|chhod do|nahi|nahin|no|never mind|stop|bas)$/i.test(t)) return 'cancel';
  const web = /\b(web|browser|chrome|online)\b/.test(t) || /^(2|second|doosra|dosra|dusra)( wala)?$/.test(t);
  const desktop = /\b(desktop|installed|install|application|laptop|pc)\b/.test(t)
    || /\bapp\b/.test(t) || /^(1|first|pehla|pahla)( wala)?$/.test(t);
  if (web && desktop) return null;
  return web ? 'web' : desktop ? 'desktop' : null;
}

// ---- main ---------------------------------------------------------------

export function parseCommand(input: string): ParseResult {
  const t = normalize(input);
  const cmd = (action: ActionName, args: Record<string, unknown>, rule: string): ParseResult => ({
    kind: 'command', action, args, normalized: t, matchedRule: rule,
  });
  if (!t) return { kind: 'clarify', topic: 'empty', normalized: t };

  // greetings / help
  if (/^(hi|hello|hey|salam|assalam ?o? ?alaikum|aoa|salaam)( hukm)?$/.test(t)) return { kind: 'reply', topic: 'greeting', normalized: t };
  if (/^(help|madad|commands|kya kar sakte ho|what can you do|tum kya kar sakte ho|aap kya kar sakte hain)$/.test(t))
    return { kind: 'reply', topic: 'help', normalized: t };

  if (/\b(hukm|laptop|controller|windows|computer)?\s*(?:diagnostics?|self test|health check|system test)\b/.test(t))
    return cmd('diagnostics.probe', {}, 'computer-diagnostics');

  // Calendar shortcuts must win over the generic "Google search" rule.
  if (/\b(?:google\s+calendar|gcal)\b/.test(t) && OPEN.test(t))
    return cmd('web.open', { url: 'https://calendar.google.com/calendar/u/0/r' }, 'google-calendar-open');
  if (/\b(?:outlook\s+calendar|microsoft\s+calendar)\b/.test(t) && OPEN.test(t))
    return cmd('web.open', { url: 'https://outlook.office.com/calendar/' }, 'outlook-calendar-open');

  // cancel current command
  if (CANCEL.test(t) && (/\b(command|kaam|task|current|yeh|ye|this|it|isay|ise)\b/.test(t) || t.split(' ').length <= 2))
    return cmd('command.cancel', {}, 'cancel');
  if (/\b(command|kaam|task)\b/.test(t) && /\b(band karo|band kar do|stop)\b/.test(t)) return cmd('command.cancel', {}, 'cancel-band');

  // Explicit close must beat app.open and all Gemini planning. The previous
  // implementation had no close action; "note pad band kro" was answered
  // by a model that incorrectly suggested app.open Notepad.
  if (CLOSE.test(t) && /\bnotepad\b/.test(t) && !OPEN.test(t))
    return cmd('app.close', { app: 'notepad' }, 'notepad-window-close');

  // The first operator foundation: explicit, one-step browser controls.
  // No model-generated coordinates and no implicit website submissions.
  // Explicit manual desktop actions; never inferred from vague model plans.
  // All input goes through the owner's normal per-command approval, and the
  // Windows controller further limits it to visible, allowed foreground apps.
  const desktopDrag = t.match(/^(?:mouse|desktop|laptop)\s+drag\s+(-?\d{1,5})[\s,]+(-?\d{1,5})\s+(?:to|se)\s+(-?\d{1,5})[\s,]+(-?\d{1,5})(?:\s+(?:karo|kar do))?$/);
  if (desktopDrag) return cmd('desktop.control', {
    kind:'drag',x:Number(desktopDrag[1]),y:Number(desktopDrag[2]),
    toX:Number(desktopDrag[3]),toY:Number(desktopDrag[4]),
  },'desktop-drag');
  const desktopClick = t.match(/^(?:mouse|desktop|laptop)\s+(?:(double|right)\s+)?click\s+(-?\d{1,5})[\s,]+(-?\d{1,5})(?:\s+(?:karo|kar do))?$/);
  if (desktopClick) return cmd('desktop.control',{
    kind:desktopClick[1]==='double'?'double_click':desktopClick[1]==='right'?'right_click':'click',
    x:Number(desktopClick[2]),y:Number(desktopClick[3]),
  },'desktop-click');
  const desktopType = input.trim().match(/^(?:keyboard|desktop|laptop)\s+(?:type|likho)(?:\s+text)?\s*:\s*(.{1,1000})$/is);
  if (desktopType) return cmd('desktop.control',{kind:'type',text:desktopType[1].trim()},'desktop-type');
  const desktopKey = t.match(/^(?:keyboard|desktop|laptop)\s+(?:press|dabao)\s+(enter|tab|shift\+tab|escape|backspace|home|end|arrowdown|arrowup|arrowleft|arrowright|ctrl\+[acvzs])$/);
  if (desktopKey) return cmd('desktop.control',{kind:'key',key:desktopKey[1]},'desktop-key');

  // The relay requires a separate owner approval for every browser input.
  const click = t.match(/^(?:browser\s+)?(?:click|tap)\s+(?:at\s+)?(\d{1,4})[\s,]+(\d{1,4})(?:\s+(?:karo|kar do))?$/);
  if (click) return cmd('browser.control', { kind: 'click', x: Number(click[1]), y: Number(click[2]) }, 'browser-click');
  const typed = input.trim().match(/^(?:browser\s+)?(?:type|likho)(?:\s+text)?\s*:\s*(.{1,1000})$/is);
  if (typed) return cmd('browser.control', { kind: 'type', text: typed[1].trim() }, 'browser-type');
  // "Scroll karo" works in the active Windows app. Only "browser scroll"
  // is routed to browser-specific input; both need separate approval.
  const scroll = t.match(/^(?:(browser|laptop|window|app|page)\s+)?scroll(?:\s+(up|down))?(?:\s+(\d))?(?:\s+(?:karo|kar do))?$/);
  if (scroll) {
    const steps = (scroll[2] === 'up' ? 1 : -1) * Number(scroll[3] ?? 2);
    return scroll[1] === 'browser'
      ? cmd('browser.control', { kind:'scroll',steps }, 'browser-scroll')
      : cmd('ui.scroll', { steps }, 'active-app-scroll');
  }
  const press = t.match(/^(?:browser\s+)?press\s+(enter|tab|escape|backspace|home|end|arrowdown|arrowup|ctrl\+l|ctrl\+a)$/);
  if (press) return cmd('browser.control', { kind: 'key', key: press[1] }, 'browser-key');

  // WhatsApp drafts are a conversation: missing recipient/content is a question.
  // Actual sending is never performed; the existing approval only prepares a draft.
  const compose = parseCompose(input, t);
  if (compose) return cmd('whatsapp.compose', compose, 'whatsapp-compose');
  if (/^(?:(?:whatsapp|wa)\s+)?(?:message|msg|text|reply)(?:\s+(?:bhejo|likho|karo|kar do|send|send karo|draft))?$/.test(t) ||
      /^(?:send|write|draft)\s+(?:a\s+)?(?:whatsapp\s+)?(?:message|msg|text)$/.test(t))
    return { kind: 'clarify', topic: 'message-contact', normalized: t };
  if (/^(?:whatsapp\s+)?[a-z\p{L}][a-z\p{L}\s'.-]{0,45}\s+ko\s+(?:whatsapp\s+)?(?:message|msg|text|reply)\s+(?:bhejo|likho|send|karo|kar do|do|karna|bhejna)$/iu.test(t) ||
      /^(?:send|write|draft)\s+(?:a\s+)?(?:whatsapp\s+)?(?:message|msg|text)\s+to\s+[a-z\p{L}][a-z\p{L}\s'.-]{0,45}$/iu.test(t))
    return { kind: 'clarify', topic: 'message-body', normalized: t };

  // Sender names need a separate, explicitly approved laptop read.
  // Do not mistake "kis ka message" for the simpler numeric unread check.
  if (/\b(whatsapp|messages?|msgs?|chats?)\b/.test(t) &&
      /\b(kis kis|kis ka|kiska|kis ke|kon|kaun|who|sender|senders|naam|name)\b/.test(t) &&
      /\b(msg|msgs|message|messages|chat|chats|unread|naye|nayi|aaya|aya)\b/.test(t))
    return cmd('whatsapp.unread_senders', {}, 'whatsapp-unread-senders');

  // Explicitly reading the selected chat into the authenticated HUKM
  // conversation is a separate, owner-approved action. Never do this from
  // an unspecified inbox or Chrome WhatsApp Web tab.
  if (/\bwhatsapp\b/.test(t) &&
      /\b(selected|current|khuli|open chat)\b/.test(t) &&
      /\b(read|parho|parh|parhke|padho|batao|dikhao)\b/.test(t))
    return cmd('whatsapp.read_selected', {}, 'whatsapp-read-selected');

  // Read only the CURRENT VISIBLE WhatsApp Desktop chat. The laptop speaks
  // offline, with no message text sent to the relay. Always requires approval.
  if (/\b(whatsapp|messages?|chats?)\b/.test(t) &&
      /\b(read|parho|parh|parhke|parhkar|padho|pad|sunao|sunana)\b/.test(t) &&
      /\b(messages?|msgs?|chats?)\b/.test(t))
    return cmd('whatsapp.read_visible', {}, 'whatsapp-read-visible');

  // "<name> ke naye messages batao" — reads unread-chat counts only.
  if (/\b(unread|naye|nayi|new) (messages|message|chats)\b/.test(t)) return cmd('whatsapp.check', {}, 'whatsapp-unread');

  // Owner preference: installed PERSONAL WhatsApp Desktop is the default.
  // "Desktop web WhatsApp" is a contradictory phrase, not authorization to
  // silently open WhatsApp Web. Desktop always wins if both are mentioned.
  // Only an explicit "WhatsApp Web kholo" request selects a browser tab.
  if (/\bwhatsapp\b/.test(t)) {
    const desktopMentioned = /\b(desktop|installed|application|laptop|pc|windows app|personal)\b/.test(t);
    const explicitWeb = /\bwhatsapp\s+web\b|\bweb\s+whatsapp\b/.test(t);
    const mode = explicitWeb && !desktopMentioned ? 'web' : 'desktop';
    if (/\b(unread|naye|nayi|messages|message|msg|msgs|check|dekho|dekh|batao|dikhao|kitne|koi)\b/.test(t))
      return cmd('whatsapp.check', { mode }, 'whatsapp-check');
    if (OPEN.test(t) || t === 'whatsapp' || t === 'whatsapp desktop' || t === 'whatsapp web') {
      if (mode === 'web') return cmd('web.open', { url: 'https://web.whatsapp.com/' }, 'explicit-whatsapp-web-open');
      return cmd('whatsapp.open', { mode: 'desktop' }, 'personal-whatsapp-desktop-default');
    }
    return cmd('whatsapp.check', { mode }, 'personal-whatsapp-default');
  }

  // YouTube homepage: treat common Roman Urdu "open kro/mro" typo as
  // an opener, never as a video title or a Google/YouTube search query.
  if (/^(?:(?:youtube|yt)\s+open|open\s+(?:youtube|yt))(?:\s+(?:kro|karo|mro|kar do))?$/.test(t))
    return cmd('web.open', { url: 'https://www.youtube.com/' }, 'youtube-home-open');

  // youtube
  if (/\b(youtube|yt)\b/.test(t)) {
    if (/\b(?:home|homepage|home page)\b/.test(t) && OPEN.test(t))
      return cmd('web.open', { url: 'https://www.youtube.com/' }, 'youtube-home-open');
    const q = stripWords(t, [/\b(youtube|yt)\b/, /\bvideos?\b/, /\b(per|pe|par|mein|on)\b/, /\b(gaana|chrome|browser|edge)\b/]);
    const query = restoreCase(input, q);
    if (!query) {
      if (/\b(play|chalao|lagao|bajao|search|dhoondo)\b/.test(t)) return { kind: 'clarify', topic: 'youtube-query', normalized: t };
      return { kind: 'clarify', topic: 'youtube-choice', normalized: t };
    }
    if (/^(home|homepage|home page|main page)$/.test(query.toLowerCase()))
      return cmd('web.open', { url: 'https://www.youtube.com/' }, 'youtube-home');
    if (PLAY.test(t)) return cmd('youtube.play', { query }, 'youtube-play');
    return cmd('youtube.search', { query }, 'youtube-search');
  }

  // screen
  if (/\b(screen|screenshot|monitor)\b/.test(t) && (SHOW.test(t) || /\b(capture|lo|le|take|grab|bhejo|send)\b/.test(t) || /^screenshot$/.test(t))) {
    // Invalid or ambiguous multi-display requests must not capture another display.
    const requested = t.match(/\b(?:monitor|screen)\s+(\d+)\b/);
    if (/\b(?:all|sab|sare|saare|every|multiple|second|third|doosra|dusra)\b/.test(t))
      return {kind:'clarify',topic:'unknown',normalized:t};
    if (requested) return cmd('screen.capture', {monitor:Number(requested[1])}, 'screen-monitor');
    return cmd('screen.capture', {}, 'screen');
  }

  // lock
  if (/\block\b/.test(t) && /\b(laptop|computer|pc|screen|system|windows)\b/.test(t)) return cmd('system.lock', {}, 'lock');

  if (/^(?:koi\s+)?(?:app|application|program|software)\s*(?:kholo|open|launch|chalao|start)?$/.test(t))
    return { kind: 'clarify', topic: 'which-app', normalized: t };

  // list applications
  if (/\b(applications|apps|programs|softwares?|windows)\b/.test(t) && /\b(open|khuli|khule|chal|chal rahi|chal rahe|running|kaunsi|which|what|list|batao|dikhao)\b/.test(t))
    return cmd('apps.list', {}, 'apps-list');

  // active window
  if (/\b(active window|current window|konsi window|kaunsi window|front window)\b/.test(t) || /\bpage (ka )?title\b/.test(t))
    return cmd('window.active', {}, 'window-active');

  // device status
  if (/\b(battery|charging|charge)\b/.test(t) && !/\b(file|files)\b/.test(t)) return cmd('device.status', {}, 'battery');
  if (/\b(laptop|computer|device|pc|system)\b/.test(t) && /\b(status|haal|online|battery|info|information|kaisa|kesa|connected|details)\b/.test(t))
    return cmd('device.status', {}, 'device-status');

  // No general-purpose process termination. Other app closings are not
  // silently reinterpreted as opening, clicking, or killing an app.
  if (CLOSE.test(t)) return { kind: 'unsupported', reason: 'close', normalized: t };

  // files
  const ext = detectExt(t);
  const loc = detectLocation(t);
  const latest = LATEST.test(t);
  const where = /\bkahan\b|\bwhere\b/.test(t);
  const fileCtx = FILE_WORD.test(t) || ext.length > 0 || where;
  if (fileCtx) {
    const q = stripWords(t, [
      /\b(file|files|document|sheet|sheets)\b/,
      ...EXT_STRONG.map((e) => e[0]),
      ...EXT_WEAK.map((e) => e[0]),
      ...LOCATIONS.map((l) => l[0]),
      /\bfolder\b/,
      LATEST,
      /\b(kahan|where|save|saved|pari|padi|rakhi|located|located at)\b/,
      /\b(per|pe|par|mein|on|in|se|from)\b/,
    ]);
    const query = restoreCase(input, q);
    const base: Record<string, unknown> = { query, ext, location: loc, sort: latest ? 'latest' : 'relevance' };
    if (where || SEARCH.test(t) || SHOW.test(t)) {
      if (!query && ext.length === 0 && !latest) return { kind: 'clarify', topic: 'which-file', normalized: t };
      return cmd('file.search', base, 'file-search');
    }
    if (OPEN.test(t)) {
      if (!query && ext.length === 0 && !latest) return { kind: 'clarify', topic: 'which-file', normalized: t };
      return cmd('file.open', base, 'file-open');
    }
    if (!query && ext.length === 0 && !latest) return { kind: 'clarify', topic: 'which-file', normalized: t };
    return cmd('file.search', base, 'file-default');
  }

  if (/^(?:koi\s+)?folder\s*(?:kholo|open|dikhao|show)?$/.test(t))
    return { kind: 'clarify', topic: 'which-folder', normalized: t };

  // folders: bare answers like "Desktop wala" are not requests to
  // open a folder. Without a pending conversation, ask for a full command.
  if (/^(desktop|downloads?|documents?|pictures?|music|videos?) (wala|wali|wale)$/.test(t))
    return { kind: 'unsupported', reason: 'unknown', normalized: t };
  if (loc) {
    if (/\b(kya hai|kya kya|what is in|what's in|contents|list|dikhao|show)\b/.test(t)) return cmd('folder.list', { folder: loc }, 'folder-list');
    return cmd('folder.open', { folder: loc }, 'folder-open');
  }

  // web search
  if (SEARCH.test(t) || /^google\s+\S/.test(t)) {
    const q = stripWords(t, [/\b(browser|google|web|internet|net|online|chrome)\b/, /\b(per|pe|par|mein|on|in)\b/]);
    const query = restoreCase(input, q);
    if (!query) return { kind: 'clarify', topic: 'search-what', normalized: t };
    return cmd('web.search', { query }, 'web-search');
  }

  // apps (checked before sites so "google chrome" wins over "google")
  for (const [re, app] of APP_ALIASES) {
    if (re.test(t)) {
      const rest = stripWords(t.replace(re, ' '), [/\b(app|application|program)\b/]);
      if (OPEN.test(t) || rest === '') {
        if (!(KNOWN_APPS as readonly string[]).includes(app)) break;
        return cmd('app.open', { app }, 'app-open');
      }
    }
  }

  if (/^(?:koi\s+)?(?:website|site|web page)\s*(?:kholo|open|dikhao|show)?$/.test(t))
    return { kind: 'clarify', topic: 'which-website', normalized: t };

  // explicit URL
  const url = t.match(URL_RE);
  if (url) return cmd('web.open', { url: url[1].startsWith('http') ? url[1] : `https://${url[1]}` }, 'url');

  // known sites
  for (const [re, site] of SITES) {
    if (re.test(t)) {
      const rest = stripWords(t.replace(re, ' '), [/\b(website|site|page|browser|mein)\b/]);
      if (OPEN.test(t) || rest === '') return cmd('web.open', { url: site }, 'site');
    }
  }

  if (/\bbrowser\b/.test(t) && OPEN.test(t)) return cmd('app.open', { app: 'chrome' }, 'browser-open');

  return { kind: 'unsupported', reason: 'unknown', normalized: t };
}
