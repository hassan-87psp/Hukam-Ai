// Phrase normalisation: Urdu script → Roman Urdu tokens, spelling variants → canonical forms.
// Only structural words are mapped; free text (names, search terms) is left as typed.

const URDU_MAP: [string, string][] = [
  ['گوگل کروم', 'google chrome'],
  ['کروم', 'chrome'],
  ['مائیکروسافٹ ایج', 'edge'],
  ['کھول دیں', 'khol do'],
  ['کھول دو', 'khol do'],
  ['کھولیں', 'kholo'],
  ['کھولو', 'kholo'],
  ['کھول', 'khol'],
  ['اوپن', 'open'],
  ['کر دیں', 'kar do'],
  ['کر دو', 'kar do'],
  ['کریں', 'karo'],
  ['کرو', 'karo'],
  ['ڈاؤن لوڈز', 'downloads'],
  ['ڈاؤنلوڈز', 'downloads'],
  ['ڈاؤن لوڈ', 'downloads'],
  ['فولڈر', 'folder'],
  ['فائلیں', 'files'],
  ['فائلز', 'files'],
  ['فائل', 'file'],
  ['یو ٹیوب', 'youtube'],
  ['یوٹیوب', 'youtube'],
  ['پر', 'par'],
  ['پہ', 'pe'],
  ['چلا دیں', 'chala do'],
  ['چلا دو', 'chala do'],
  ['چلاؤ', 'chalao'],
  ['چلائیں', 'chalao'],
  ['لگاؤ', 'lagao'],
  ['لگا دو', 'laga do'],
  ['پلے', 'play'],
  ['تلاش کریں', 'search karo'],
  ['تلاش کرو', 'search karo'],
  ['تلاش', 'search'],
  ['ڈھونڈیں', 'dhoondo'],
  ['ڈھونڈو', 'dhoondo'],
  ['ڈھونڈ', 'dhoond'],
  ['سرچ', 'search'],
  ['واٹس ایپ', 'whatsapp'],
  ['واٹس اپ', 'whatsapp'],
  ['وٹس ایپ', 'whatsapp'],
  ['واٹسایپ', 'whatsapp'],
  ['نوٹ پیڈ', 'notepad'],
  ['کیلکولیٹر', 'calculator'],
  ['براؤزر', 'browser'],
  ['گوگل', 'google'],
  ['اسکرین شاٹ', 'screenshot'],
  ['سکرین شاٹ', 'screenshot'],
  ['اسکرین', 'screen'],
  ['سکرین', 'screen'],
  ['دکھا دیں', 'dikha do'],
  ['دکھا دو', 'dikha do'],
  ['دکھاؤ', 'dikhao'],
  ['دکھائیں', 'dikhao'],
  ['بتا دیں', 'bata do'],
  ['بتا دو', 'bata do'],
  ['بتاؤ', 'batao'],
  ['بتائیں', 'batao'],
  ['چیک', 'check'],
  ['ڈیسک ٹاپ', 'desktop'],
  ['ڈیسکٹاپ', 'desktop'],
  ['ڈاکیومنٹس', 'documents'],
  ['دستاویزات', 'documents'],
  ['تصاویر', 'pictures'],
  ['میوزک', 'music'],
  ['ویڈیوز', 'videos'],
  ['لیپ ٹاپ', 'laptop'],
  ['لیپٹاپ', 'laptop'],
  ['کمپیوٹر', 'computer'],
  ['کینسل', 'cancel'],
  ['منسوخ', 'cancel'],
  ['روکو', 'roko'],
  ['روک دو', 'rok do'],
  ['بند', 'band'],
  ['کمانڈ', 'command'],
  ['پیغامات', 'messages'],
  ['میسجز', 'messages'],
  ['پیغام', 'message'],
  ['میسج', 'message'],
  ['جواب', 'reply'],
  ['لکھو', 'likho'],
  ['لکھ دو', 'likh do'],
  ['بھیجو', 'bhejo'],
  ['بھیج دو', 'bhej do'],
  ['کو', 'ko'],
  ['کہ', 'ke'],
  ['نیوز', 'news'],
  ['خبریں', 'news'],
  ['ایکسل', 'excel'],
  ['پی ڈی ایف', 'pdf'],
  ['کون سی', 'kaunsi'],
  ['کونسی', 'kaunsi'],
  ['ایپلیکیشنز', 'applications'],
  ['ایپس', 'apps'],
  ['کھلی', 'khuli'],
  ['ہیں', 'hain'],
  ['ہے', 'hai'],
  ['کہاں', 'kahan'],
  ['میرا', 'mera'],
  ['میری', 'meri'],
  ['میرے', 'mere'],
  ['مجھے', 'mujhe'],
  ['نئے', 'naye'],
  ['نئی', 'nayi'],
  ['تازہ', 'latest'],
  ['آخری', 'latest'],
  ['جو', 'jo'],
  ['وہ', 'woh'],
  ['یہ', 'ye'],
  ['والی', 'wali'],
  ['والا', 'wala'],
  ['ویب سائٹ', 'website'],
  ['لاک', 'lock'],
  ['میں', 'mein'],
  ['کیا', 'kya'],
  ['سلام', 'salam'],
  ['السلام علیکم', 'salam'],
  ['مدد', 'help'],
];

const ROMAN_VARIANTS: [RegExp, string][] = [
  [/\bwhats\s*app\b/g, 'whatsapp'],
  [/\bwatsapp\b|\bwhatsap\b|\bwatsap\b|\bwhtsapp\b/g, 'whatsapp'],
  [/\byou\s*tube\b|\byoutub\b|\butube\b/g, 'youtube'],
  [/\bdown\s*loads?\b|\bdownlods?\b|\bdonloads?\b/g, 'downloads'],
  [/\bdesk\s*top\b/g, 'desktop'],
  [/\bscreen\s*shot\b|\bskreen\s*shot\b/g, 'screenshot'],
  [/\bskreen\b|\bskrin\b/g, 'screen'],
  [/\bnote\s*pad\b/g, 'notepad'],
  [/\bcrome\b|\bkroom\b/g, 'chrome'],
  [/\bplz\b|\bpls\b|\bplease\b|\bplease\s+\b/g, 'please'],
  [/\bmsg\b|\bmassage\b|\bmesage\b|\bmessge\b/g, 'message'],
  [/\bmsgs\b|\bmassages\b/g, 'messages'],
  [/\bopen\s*kr(o|do)?\b/g, 'open karo'],
  [/\bkr\s*do\b/g, 'kar do'],
  [/\bkro\b/g, 'karo'],
  [/\bkr\b/g, 'kar'],
  [/\bdhund(o|ho|do)?\b|\bdhoondh(o)?\b|\bdhondo\b/g, 'dhoondo'],
  [/\bkhol(o|ain|ein|en|iye|iyay)\b/g, 'kholo'],
  [/\bdikha(o|en|ein|iye)\b/g, 'dikhao'],
  [/\bbata(o|en|ein|iye)\b/g, 'batao'],
  [/\bchala(o|en|ein|iye)\b/g, 'chalao'],
  [/\bkonsi\b|\bkon si\b|\bkaun si\b|\bkonsy\b/g, 'kaunsi'],
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const URDU_RE = URDU_MAP.slice()
  .sort((a, b) => b[0].length - a[0].length)
  .map(([k, v]) => [new RegExp(`(^|\\s)${escapeRe(k)}(?=\\s|$)`, 'g'), v] as const);

export function hasUrduScript(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

/** Strip punctuation that never carries meaning for commands. Keeps . : / for URLs. */
export function cleanText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[‌‍‎‏]/g, '')
    .replace(/[“”"«»]/g, '')
    .replace(/[!?؟،,۔]+/g, ' ')
    .replace(/\.(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalize(input: string): string {
  let t = ` ${cleanText(input)} `;
  if (hasUrduScript(t)) {
    // apply repeatedly so adjacent tokens are all caught
    for (let i = 0; i < 2; i++) {
      for (const [re, v] of URDU_RE) t = t.replace(re, (_m, pre) => `${pre}${v}`);
    }
  }
  t = t.toLowerCase();
  for (const [re, v] of ROMAN_VARIANTS) t = t.replace(re, v);
  return t.replace(/\s+/g, ' ').trim();
}
