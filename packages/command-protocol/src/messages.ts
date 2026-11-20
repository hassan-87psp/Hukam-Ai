import type { ActionName, CommandError, Lang, Localized } from '../../shared-types/src/index';
import { APP_LABELS, FOLDER_LABELS, type KnownApp, type KnownFolder } from './actions';

const L = (roman: string, ur: string, en: string): Localized => ({ roman, ur, en });

const FOLDER_UR: Record<KnownFolder, string> = {
  downloads: 'ڈاؤن لوڈز', documents: 'ڈاکیومنٹس', desktop: 'ڈیسک ٹاپ', pictures: 'تصاویر', music: 'میوزک', videos: 'ویڈیوز', home: 'ہوم',
};

export function pick(m: Localized, lang: Lang): string {
  return m[lang] ?? m.en;
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function ackMessage(action: ActionName, args: Record<string, unknown>): Localized {
  switch (action) {
    case 'app.open': {
      const n = APP_LABELS[args.app as KnownApp] ?? s(args.app);
      return L(`${n} open kar raha hoon.`, `${n} کھول رہا ہوں۔`, `Opening ${n}.`);
    }
    case 'folder.open': {
      const f = args.folder as KnownFolder;
      return L(`${FOLDER_LABELS[f]} folder open kar raha hoon.`, `${FOLDER_UR[f]} فولڈر کھول رہا ہوں۔`, `Opening your ${FOLDER_LABELS[f]} folder.`);
    }
    case 'folder.list': {
      const f = args.folder as KnownFolder;
      return L(`${FOLDER_LABELS[f]} folder ki files la raha hoon.`, `${FOLDER_UR[f]} فولڈر کی فائلیں لا رہا ہوں۔`, `Listing your ${FOLDER_LABELS[f]} folder.`);
    }
    case 'file.search':
      return L('Files search kar raha hoon.', 'فائلیں تلاش کر رہا ہوں۔', 'Searching your files.');
    case 'file.open':
      return args.path
        ? L('File open kar raha hoon.', 'فائل کھول رہا ہوں۔', 'Opening the file.')
        : L('File dhoond kar open kar raha hoon.', 'فائل ڈھونڈ کر کھول رہا ہوں۔', 'Finding and opening the file.');
    case 'file.reveal':
      return L('File ka folder open kar raha hoon.', 'فائل کا فولڈر کھول رہا ہوں۔', 'Showing the file in its folder.');
    case 'web.open':
      return L('Website open kar raha hoon.', 'ویب سائٹ کھول رہا ہوں۔', 'Opening the website.');
    case 'web.search':
      return L(`Browser mein "${s(args.query)}" search kar raha hoon.`, `براؤزر میں "${s(args.query)}" تلاش کر رہا ہوں۔`, `Searching the web for "${s(args.query)}".`);
    case 'youtube.search':
      return L(`YouTube par "${s(args.query)}" search kar raha hoon.`, `یوٹیوب پر "${s(args.query)}" تلاش کر رہا ہوں۔`, `Searching YouTube for "${s(args.query)}".`);
    case 'youtube.play':
      return L(`YouTube par "${s(args.query)}" play karne ki koshish kar raha hoon.`, `یوٹیوب پر "${s(args.query)}" چلانے کی کوشش کر رہا ہوں۔`, `Trying to play "${s(args.query)}" on YouTube.`);
    case 'device.status':
      return L('Laptop ka status check kar raha hoon.', 'لیپ ٹاپ کا اسٹیٹس چیک کر رہا ہوں۔', 'Checking the laptop status.');
    case 'apps.list':
      return L('Open applications check kar raha hoon.', 'کھلی ہوئی ایپلیکیشنز چیک کر رہا ہوں۔', 'Checking open applications.');
    case 'window.active':
      return L('Active window check kar raha hoon.', 'ایکٹو ونڈو چیک کر رہا ہوں۔', 'Checking the active window.');
    case 'window.focus':
      return L('Window samne la raha hoon.', 'ونڈو سامنے لا رہا ہوں۔', 'Bringing the window to the front.');
    case 'screen.capture':
      return L('Screenshot le raha hoon.', 'اسکرین شاٹ لے رہا ہوں۔', 'Capturing a screenshot.');
    case 'browser.control':
      return L('Browser input ke liye aapki approval chahiye.', 'براؤزر ان پٹ کے لیے آپ کی منظوری چاہیے۔', 'Your approval is required before browser input.');
    case 'system.lock':
      return L('Laptop lock kar raha hoon.', 'لیپ ٹاپ لاک کر رہا ہوں۔', 'Locking the laptop.');
    case 'whatsapp.open':
      return L('WhatsApp open kar raha hoon.', 'واٹس ایپ کھول رہا ہوں۔', 'Opening WhatsApp.');
    case 'whatsapp.check':
      return L('WhatsApp check kar raha hoon.', 'واٹس ایپ چیک کر رہا ہوں۔', 'Checking WhatsApp.');
    case 'whatsapp.read_visible':
      return L('Aapki approval ke baad WhatsApp ki khuli chat laptop par offline parhunga. Message text cloud par nahi bhejunga.', 'آپ کی منظوری کے بعد کھلی چیٹ لیپ ٹاپ پر آف لائن پڑھوں گا۔', 'With approval, I will read aloud the visible WhatsApp chat on your laptop only; no message contents are transferred.');
    case 'whatsapp.compose':
      return L(`${s(args.contact)} ke liye message tayyar kar raha hoon.`, `${s(args.contact)} کے لیے پیغام تیار کر رہا ہوں۔`, `Preparing a message for ${s(args.contact)}.`);
    case 'command.cancel':
      return L('Current command cancel kar raha hoon.', 'موجودہ کمانڈ منسوخ کر رہا ہوں۔', 'Cancelling the current command.');
  }
}

export function successMessage(action: ActionName, args: Record<string, unknown>, result: Record<string, unknown> | null): Localized {
  const r = result ?? {};
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  switch (action) {
    case 'app.open': {
      const name = APP_LABELS[args.app as KnownApp] ?? s(args.app);
      return r.windowDetected === false
        ? L(`${name} launch kar diya, lekin window abhi tak nazar nahi aayi.`, `${name} چلا دیا، لیکن ونڈو ابھی نظر نہیں آئی۔`, `${name} was launched, but no window was detected yet.`)
        : L(`${name} open ho gaya.`, `${name} کھل گیا۔`, `${name} is open.`);
    }
    case 'folder.open': {
      const f = args.folder as KnownFolder;
      return L(`${FOLDER_LABELS[f]} folder successfully open ho gaya.`, `${FOLDER_UR[f]} فولڈر کامیابی سے کھل گیا۔`, `${FOLDER_LABELS[f]} folder opened.`);
    }
    case 'folder.list':
      return L(`${n('total')} items mile.`, `${n('total')} آئٹمز ملے۔`, `Found ${n('total')} items.`);
    case 'file.search':
      return n('count') === 0
        ? L('Koi matching file nahi mili.', 'کوئی ملتی جلتی فائل نہیں ملی۔', 'No matching files found.')
        : L(`${n('count')} files mil gayin.`, `${n('count')} فائلیں مل گئیں۔`, `Found ${n('count')} files.`);
    case 'file.open':
      return r.ambiguous
        ? L('Kai files milti hain — kaunsi open karoon? Neeche se choose karein.', 'کئی فائلیں ملیں — کون سی کھولوں؟ نیچے سے منتخب کریں۔', 'Several files match — pick one below.')
        : L(`File open ho gayi: ${s(r.name)}`, `فائل کھل گئی: ${s(r.name)}`, `Opened ${s(r.name)}.`);
    case 'file.reveal':
      return L('File ka folder open ho gaya.', 'فائل کا فولڈر کھل گیا۔', 'Showing the file in File Explorer.');
    case 'web.open':
      return L('Website browser mein open ho gayi.', 'ویب سائٹ براؤزر میں کھل گئی۔', 'Website opened in the browser.');
    case 'web.search':
      return L('Search results browser mein open ho gaye.', 'تلاش کے نتائج براؤزر میں کھل گئے۔', 'Search results are open in the browser.');
    case 'youtube.search':
      return L('YouTube search results open ho gaye.', 'یوٹیوب کے نتائج کھل گئے۔', 'YouTube results are open.');
    case 'youtube.play':
      return r.mode === 'video'
        ? L(`YouTube par video open kar di: ${s(r.title) || s(r.videoId)}`, `یوٹیوب پر ویڈیو کھول دی: ${s(r.title) || s(r.videoId)}`, `Opened the top video: ${s(r.title) || s(r.videoId)}`)
        : L('Top video tay nahi ho saki, is liye search results open kar diye.', 'سب سے اوپر کی ویڈیو طے نہیں ہو سکی، اس لیے نتائج کھول دیے۔', "Couldn't reliably pick a video, so I opened the search results instead.");
    case 'device.status':
      return L('Laptop online hai. Details neeche hain.', 'لیپ ٹاپ آن لائن ہے۔ تفصیل نیچے ہے۔', 'The laptop is online. Details below.');
    case 'apps.list':
      return L(`${n('count')} applications open hain.`, `${n('count')} ایپلیکیشنز کھلی ہیں۔`, `${n('count')} applications are open.`);
    case 'window.active':
      return L(`Active window: ${s(r.title)}`, `ایکٹو ونڈو: ${s(r.title)}`, `Active window: ${s(r.title)}`);
    case 'window.focus':
      return L('Window samne aa gayi.', 'ونڈو سامنے آ گئی۔', 'Window brought to the front.');
    case 'screen.capture':
      return L('Screenshot aa gaya.', 'اسکرین شاٹ آ گیا۔', 'Screenshot received.');
    case 'browser.control':
      return L('Browser ko input bhej diya. Website par natija abhi verify nahi hua.', 'براؤزر کو ان پٹ بھیج دیا گیا، نتیجہ تصدیق شدہ نہیں۔', 'Input delivered to the browser; the website result is not verified.');
    case 'system.lock':
      return L('Laptop lock ho gaya.', 'لیپ ٹاپ لاک ہو گیا۔', 'The laptop is locked.');
    case 'whatsapp.open':
      if (r.needsChoice)
        return L('WhatsApp Desktop nahi khul saka. Kya WhatsApp Web kholoon? Agar haan, bolein "WhatsApp Web kholo".', 'واٹس ایپ ڈیسک ٹاپ نہیں کھل سکا۔ کیا واٹس ایپ ویب کھولوں؟', 'WhatsApp Desktop could not open. Say "Open WhatsApp Web" if you want the browser.');
      if (r.opened === 'web' && args.mode === 'desktop')
        return L('Purana laptop controller abhi Web mode mein hai. Controller ki WhatsApp setting Desktop karni hogi.', 'لیپ ٹاپ کنٹرولر ابھی ویب موڈ میں ہے۔', 'The laptop controller is still set to Web mode. Switch its WhatsApp setting to Desktop.');
      if (r.opened === 'web')
        return L('WhatsApp Web browser mein khul gaya.', 'واٹس ایپ ویب براؤزر میں کھل گیا۔', 'WhatsApp Web opened in the browser.');
      return L('WhatsApp Desktop app khul gayi.', 'واٹس ایپ ڈیسک ٹاپ ایپ کھل گئی۔', 'WhatsApp Desktop opened.');
    case 'whatsapp.check':
      if (typeof r.unreadChats === 'number')
        return r.unreadChats === 0
          ? L('WhatsApp par koi unread chat nazar nahi aa rahi.', 'واٹس ایپ پر کوئی ان ریڈ چیٹ نظر نہیں آ رہی۔', 'No unread chats are showing in WhatsApp.')
          : L(`WhatsApp par ${r.unreadChats} unread chats hain.`, `واٹس ایپ پر ${r.unreadChats} ان ریڈ چیٹس ہیں۔`, `WhatsApp shows ${r.unreadChats} unread chats.`);
      return L('WhatsApp open hai, lekin unread count parha nahi ja saka.', 'واٹس ایپ کھلا ہے، لیکن ان ریڈ تعداد نہیں پڑھی جا سکی۔', "WhatsApp is open, but the unread count couldn't be read.");
    case 'whatsapp.read_visible':
      if (r.messagesRead === true && r.spokenOnDevice === true)
        return L('Jo WhatsApp chat screen par nazar aa rahi thi, uska visible text laptop par suna diya. Message cloud par nahi bheja.', 'واٹس ایپ کی کھلی چیٹ کا متن لیپ ٹاپ پر سنا دیا، سرور کو نہیں بھیجا۔', 'Visible WhatsApp chat text was spoken locally on the laptop. Nothing was sent to the cloud.');
      return L('WhatsApp chat ka readable text nahi mila. Laptop par WhatsApp Desktop khol kar chat select karein.', 'واٹس ایپ چیٹ کا پڑھنے کے قابل متن نہیں ملا۔', 'No readable text found in the visible WhatsApp chat. Open a chat in the Desktop app.');
    case 'whatsapp.compose':
      return L(
        `Message ${s(args.contact)} ki chat mein likh diya hai — abhi bheja NAHI gaya. Laptop par Send dabayein.`,
        `پیغام ${s(args.contact)} کی چیٹ میں لکھ دیا ہے — ابھی بھیجا نہیں گیا۔ لیپ ٹاپ پر سینڈ دبائیں۔`,
        `Message drafted in ${s(args.contact)}'s chat — it has NOT been sent. Press Send on the laptop.`,
      );
    case 'command.cancel':
      return n('cancelled') > 0
        ? L('Command cancel ho gayi.', 'کمانڈ منسوخ ہو گئی۔', 'Command cancelled.')
        : L('Cancel karne ke liye koi chalti command nahi hai.', 'منسوخ کرنے کے لیے کوئی جاری کمانڈ نہیں۔', 'There is no running command to cancel.');
  }
}

export function failureMessage(error: CommandError | null): Localized {
  const msg = error?.message ?? 'unknown error';
  switch (error?.code) {
    case 'DEVICE_OFFLINE':
      return L('Laptop offline hai. Controller start karein.', 'لیپ ٹاپ آف لائن ہے۔ کنٹرولر چلائیں۔', 'The laptop is offline. Start the controller.');
    case 'NOT_ALLOWED':
      return L(`Ye ijazat ke bahar hai: ${msg}`, `یہ اجازت سے باہر ہے: ${msg}`, `Not permitted: ${msg}`);
    case 'NOT_FOUND':
      return L(`Nahi mila: ${msg}`, `نہیں ملا: ${msg}`, `Not found: ${msg}`);
    case 'CAPABILITY_DISABLED':
      return L(`Ye feature is device par band hai: ${msg}`, `یہ فیچر اس ڈیوائس پر بند ہے: ${msg}`, `This capability is disabled for the device: ${msg}`);
    case 'NOT_CONNECTED':
      return L(`Abhi connected nahi: ${msg}`, `ابھی منسلک نہیں: ${msg}`, `Not connected yet: ${msg}`);
    case 'PAUSED':
      return L('Controller paused hai (emergency stop). Devices page se resume karein.', 'کنٹرولر رکا ہوا ہے۔ ڈیوائسز صفحے سے دوبارہ شروع کریں۔', 'The controller is paused (emergency stop). Resume it from Devices.');
    default:
      return L(`Ye kaam mukammal nahi ho saka: ${msg}`, `یہ کام مکمل نہیں ہو سکا: ${msg}`, `That didn't work: ${msg}`);
  }
}

export const STATUS_MESSAGES = {
  awaitingApproval: L('Is kaam ke liye aapki approval chahiye.', 'اس کام کے لیے آپ کی منظوری چاہیے۔', 'This action needs your approval.'),
  queuedOffline: L('Laptop abhi offline hai — command queue mein hai.', 'لیپ ٹاپ آف لائن ہے — کمانڈ قطار میں ہے۔', 'The laptop is offline — the command is queued.'),
  timedOut: L('Command ka waqt khatam ho gaya, laptop ne jawab nahi diya.', 'کمانڈ کا وقت ختم ہو گیا، لیپ ٹاپ نے جواب نہیں دیا۔', 'The command timed out — no reply from the laptop.'),
  cancelled: L('Command cancel kar di gayi.', 'کمانڈ منسوخ کر دی گئی۔', 'The command was cancelled.'),
  rejected: L('Theek hai, ye kaam nahi kiya.', 'ٹھیک ہے، یہ کام نہیں کیا۔', "OK, I won't do that."),
  noDevice: L('Koi laptop connected nahi hai. Devices page se pair karein.', 'کوئی لیپ ٹاپ منسلک نہیں۔ ڈیوائسز صفحے سے جوڑیں۔', 'No laptop is paired. Pair one from Devices.'),
};

export function replyMessage(topic: 'greeting' | 'help' | 'whatsapp-cancelled' | 'conversation-cancelled'): Localized {
  if (topic === 'conversation-cancelled')
    return L('Theek hai, is kaam ko cancel kar diya. Aur kuch?', 'ٹھیک ہے، اس کام کو منسوخ کر دیا۔ اور کچھ؟', 'Okay, I cancelled that request. Anything else?');
  if (topic === 'whatsapp-cancelled')
    return L('Theek hai, WhatsApp abhi nahi kholunga. Aur kuch karna hai?', 'ٹھیک ہے، ابھی واٹس ایپ نہیں کھولوں گا۔ اور کچھ کرنا ہے؟', "Okay, I won't open WhatsApp. Anything else?");
  if (topic === 'greeting')
    return L('Assalam o Alaikum! Bataiye, laptop par kya karna hai?', 'السلام علیکم! بتائیے، لیپ ٹاپ پر کیا کرنا ہے؟', 'Hello! What should I do on your laptop?');
  return L(
    'Main apps aur folders khol sakta hoon, files dhoond sakta hoon, web aur YouTube search kar sakta hoon, screenshot le sakta hoon aur WhatsApp check kar sakta hoon. Misal: "Downloads folder kholo".',
    'میں ایپس اور فولڈرز کھول سکتا ہوں، فائلیں ڈھونڈ سکتا ہوں، ویب اور یوٹیوب پر تلاش کر سکتا ہوں، اسکرین شاٹ لے سکتا ہوں اور واٹس ایپ چیک کر سکتا ہوں۔',
    'I can open apps and folders, find files, search the web and YouTube, take a screenshot and check WhatsApp. Try "Open Downloads folder".',
  );
}

export function clarifyMessage(topic: string): Localized {
  switch (topic) {
    case 'whatsapp-choice':
      return L(
        'Ji, WhatsApp Desktop app kholoon ya WhatsApp Web browser mein? Bas Desktop ya Web bol dein.',
        'جی، واٹس ایپ ڈیسک ٹاپ ایپ کھولوں یا واٹس ایپ ویب براؤزر میں؟ ڈیسک ٹاپ یا ویب بتا دیں۔',
        'Would you like WhatsApp Desktop or WhatsApp Web? Say Desktop or Web.',
      );
    case 'youtube-choice':
      return L('Ji, YouTube ka home page kholoon, koi video search karoon ya video chalaoon?', 'جی، یوٹیوب ہوم کھولوں، ویڈیو تلاش کروں یا چلاؤں؟', 'Shall I open YouTube Home, search for a video or play one?');
    case 'youtube-query':
      return L('Theek hai, kis topic ki video chahiye? Naam bata dein.', 'ٹھیک ہے، کس موضوع کی ویڈیو چاہیے؟ نام بتائیں۔', 'Which video or topic should I look for?');
    case 'which-app':
      return L('Ji, kaunsi app kholoon? Jaise Chrome, Notepad ya Excel.', 'جی، کون سی ایپ کھولوں؟ مثلاً کروم، نوٹ پیڈ یا ایکسل۔', 'Which app should I open? For example Chrome, Notepad or Excel.');
    case 'which-folder':
      return L('Kaunsa folder kholoon? Desktop, Downloads ya Documents?', 'کون سا فولڈر کھولوں؟ ڈیسک ٹاپ، ڈاؤن لوڈز یا ڈاکیومنٹس؟', 'Which folder should I open? Desktop, Downloads or Documents?');
    case 'which-website':
      return L('Kaunsi website kholoon? Naam ya web address bata dein.', 'کون سی ویب سائٹ کھولوں؟ نام یا ایڈریس بتائیں۔', 'Which website should I open? Tell me its name or address.');
    case 'message-contact':
      return L('Ji, WhatsApp par kisko message tayyar karna hai? Saved contact ka naam batayein.', 'جی، واٹس ایپ پر کس کے لیے میسج تیار کرنا ہے؟ محفوظ کانٹیکٹ کا نام بتائیں۔', 'Who should I draft a WhatsApp message for? Say a saved contact name.');
    case 'message-body':
      return L('Aur message mein kya likhoon? Aap bolein, main draft karunga; send nahi karunga.', 'اور پیغام میں کیا لکھوں؟ آپ بتائیں، صرف ڈرافٹ بناؤں گا، بھیجوں گا نہیں۔', 'What should I write in the message? I will only draft it, not send it.');
    case 'which-file':
      return L('Kaunsi file? File ka naam ya type batayein, jaise "invoice PDF dhoondo".', 'کون سی فائل؟ فائل کا نام یا قسم بتائیں۔', 'Which file? Give a name or type, e.g. "find invoice PDF".');
    case 'search-what':
      return L('Kya search karoon?', 'کیا تلاش کروں؟', 'What should I search for?');
    case 'contact-unknown':
      return L(
        'Ye contact saved nahi hai. Settings → WhatsApp contacts mein naam aur number add karein.',
        'یہ رابطہ محفوظ نہیں۔ سیٹنگز میں واٹس ایپ کانٹیکٹس میں نام اور نمبر شامل کریں۔',
        'That contact is not saved. Add the name and number in Settings → WhatsApp contacts.',
      );
    default:
      return L('Command khaali hai. Kuch likhein ya bolein.', 'کمانڈ خالی ہے۔ کچھ لکھیں یا بولیں۔', 'The command is empty. Type or say something.');
  }
}

export function unsupportedMessage(reason: string): Localized {
  if (reason === 'whatsapp-message-read')
    return L(
      'WhatsApp ki asal messages parhne ka feature abhi connected nahi hai. Main sirf unread chats ka count check kar sakta hoon. Kisi message ka text read hone ka jhoota claim nahi karunga.',
      'واٹس ایپ کے اصل پیغامات پڑھنے کی سہولت ابھی موجود نہیں۔ صرف ان ریڈ چیٹس کی تعداد دیکھ سکتا ہوں۔',
      'Reading WhatsApp message contents is not connected. I can only check unread chat counts.',
    );
  if (reason === 'close')
    return L(
      'Apps band karna Version 1 mein supported nahi (unsaved kaam zaya ho sakta hai).',
      'ایپس بند کرنا ورژن 1 میں دستیاب نہیں۔',
      'Closing apps is not supported in Version 1 (unsaved work could be lost).',
    );
  return L(
    'Ye command abhi samajh nahi aayi. Misal: "Chrome kholo", "Downloads folder kholo", "YouTube par Gold analysis play karo".',
    'یہ کمانڈ سمجھ نہیں آئی۔ مثال: "کروم کھولو"، "ڈاؤن لوڈز فولڈر کھولو"۔',
    'I didn\'t understand that. Try "Open Chrome", "Open Downloads folder" or "Play gold analysis on YouTube".',
  );
}
