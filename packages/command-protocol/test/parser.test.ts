import { describe, expect, it } from 'vitest';
import { parseCommand, parseWhatsAppChoice, validateCommand, requiresApproval, normalize, ackMessage, successMessage, clarifyMessage } from '../src/index';

function c(text: string) {
  const r = parseCommand(text);
  if (r.kind !== 'command') throw new Error(`expected command for "${text}", got ${r.kind} (${r.normalized})`);
  return r;
}

describe('normalisation', () => {
  it('maps Urdu script to roman tokens', () => {
    expect(normalize('کروم کھولو')).toBe('chrome kholo');
    expect(normalize('ڈاؤن لوڈز فولڈر کھولو۔')).toBe('downloads folder kholo');
  });
  it('handles roman spelling variants', () => {
    expect(normalize('Whats App check kro')).toBe('whatsapp check karo');
    expect(normalize('down loads kholain')).toBe('downloads kholo');
  });
});

describe('owner-approved Personal WhatsApp chat reading', () => {
  it('reads selected WhatsApp chat only after approval and without switching to Web',()=>{
    expect(c('WhatsApp selected chat parho')).toMatchObject({
      action:'whatsapp.read_selected',args:{}
    });
    expect(requiresApproval('whatsapp.read_selected')).toBe(true);
    expect(requiresApproval('whatsapp.select_chat')).toBe(true);
  });
});

describe('laptop diagnostics', () => {
  it('routes HUKM diagnostics to local controller, not Gemini chat',()=>{
    expect(c('HUKM diagnostics')).toMatchObject({action:'diagnostics.probe',args:{}});
    expect(requiresApproval('diagnostics.probe')).toBe(true);
  });
});

describe('approved browser control', () => {
  it('parses an explicit click', () => {
    expect(c('browser click 440 320')).toMatchObject({ action: 'browser.control', args: { kind: 'click', x: 440, y: 320 } });
  });
  it('keeps typed text intact', () => {
    expect(c('type: Sir Sajid, kal meeting 9 PM')).toMatchObject({ action: 'browser.control', args: { kind: 'type', text: 'Sir Sajid, kal meeting 9 PM' } });
  });
  it('parses scroll and browser key', () => {
    expect(c('scroll down 2')).toMatchObject({action:'ui.scroll',args:{steps:-2}});
    expect(c('scroll karo')).toMatchObject({action:'ui.scroll',args:{steps:-2}});
    expect(c('browser scroll down 2').args).toEqual({kind:'scroll',steps:-2});
    expect(requiresApproval('ui.scroll')).toBe(true);
    expect(validateCommand('ui.scroll',{steps:0}).ok).toBe(false);
    expect(validateCommand('ui.scroll',{steps:6}).ok).toBe(false);
    expect(c('press ctrl+l').args).toEqual({ kind: 'key', key: 'ctrl+l' });
  });
  it('requires approval and refuses unsafe input', () => {
    expect(requiresApproval('browser.control')).toBe(true);
    expect(validateCommand('browser.control', { kind: 'click', x: 10.5, y: 22 }).ok).toBe(false);
    expect(validateCommand('browser.control', { kind: 'key', key: 'win+r' }).ok).toBe(false);
    expect(validateCommand('browser.control', { kind: 'type', text: 'hello' }).ok).toBe(true);
    expect(validateCommand('browser.control', { kind: 'scroll', steps: 10 }).ok).toBe(false);
  });
});

describe('regression: notepad band kro must never open the app', () => {
  for(const input of ['note pad band kro','notepad band kar do','Notepad close karo',
    'close notepad','نوٹ پیڈ بند کرو','Notepad quit']){
    it(input,()=>{
      expect(c(input)).toMatchObject({action:'app.close',args:{app:'notepad'}});
      expect(requiresApproval('app.close')).toBe(true);
    });
  }
  it('never exposes a generic process-kill capability',()=>{
    expect(validateCommand('app.close',{app:'chrome'}).ok).toBe(false);
    expect(validateCommand('app.close',{app:'notepad'}).ok).toBe(true);
    expect(parseCommand('Chrome band kro')).toMatchObject({kind:'unsupported',reason:'close'});
  });
  it('explains that Save/Cancel remains a user decision',()=>{
    expect(successMessage('app.close',{app:'notepad'},{windowClosed:false,verified:false}).roman)
      .toContain('Save/Cancel');
    expect(successMessage('app.close',{app:'notepad'},{windowClosed:true,verified:true}).roman)
      .toContain('band ho gayi');
  });
});

describe('app intents — same intent for different phrasing', () => {
  for (const t of ['Chrome kholo', 'Chrome open karo', 'Open Google Chrome', 'کروم کھولو', 'chrome', 'Chrome chalao']) {
    it(t, () => {
      const r = c(t);
      expect(r.action).toBe('app.open');
      expect(r.args).toEqual({ app: 'chrome' });
    });
  }
  it('notepad', () => expect(c('Notepad kholo').args).toEqual({ app: 'notepad' }));
  it('excel app (not a file)', () => expect(c('Excel kholo').args).toEqual({ app: 'excel' }));
});

describe('real-user screenshot regressions', () => {
  it('YouTube open mro is a homepage, not a search for mro', () => {
    expect(c('YouTube open mro')).toMatchObject({action:'web.open',args:{url:'https://www.youtube.com/'}});
    expect(parseCommand('YouTube kholo')).toMatchObject({kind:'clarify',topic:'youtube-choice'});
  });
  it('allows multiline Notepad typing but rejects control characters', () => {
    expect(validateCommand('notepad.type',{text:'1'+String.fromCharCode(10)+'2'}).ok).toBe(true);
    expect(validateCommand('notepad.type',{text:'bad'+String.fromCharCode(0)}).ok).toBe(false);
  });
  it('refuses Chrome profile traversal, allows only supported destinations', () => {
    expect(validateCommand('browser.profile_open',{profile:'Default',url:'https://chatgpt.com/'}).ok).toBe(true);
    expect(validateCommand('browser.profile_open',{profile:'../Default',url:'https://chatgpt.com/'}).ok).toBe(false);
    expect(validateCommand('browser.profile_open',{profile:'Default',url:'https://evil.example/'}).ok).toBe(false);
    expect(requiresApproval('browser.profile_open')).toBe(true);
  });
});

describe('operator website shortcuts', () => {
  it('opens Google Calendar in the browser', () => {
    expect(c('Google Calendar kholo')).toMatchObject({ action: 'web.open', args: { url: 'https://calendar.google.com/calendar/u/0/r' } });
  });
  it('opens Outlook Calendar in the browser', () => {
    expect(c('Outlook Calendar kholo')).toMatchObject({ action: 'web.open', args: { url: 'https://outlook.office.com/calendar/' } });
  });
});

describe('WhatsApp unread sender intents', () => {
  it('asks for names, not just a count', () => {
    expect(c('whatsapp open ker ke msg dakho kis kis ka ya a')).toMatchObject({
      action: 'whatsapp.unread_senders', args: {},
    });
    expect(c('whatsapp par kis ka message aaya hai')).toMatchObject({
      action: 'whatsapp.unread_senders',
    });
    expect(c('whatsapp unread kitne hain')).toMatchObject({ action: 'whatsapp.check' });
  });
  it('always requires approval and validates empty args', () => {
    expect(requiresApproval('whatsapp.unread_senders')).toBe(true);
    expect(validateCommand('whatsapp.unread_senders', {}).ok).toBe(true);
  });
});

describe('folders', () => {
  it('Downloads folder kholo', () => expect(c('Downloads folder kholo.')).toMatchObject({ action: 'folder.open', args: { folder: 'downloads' } }));
  it('polite mixed', () => expect(c('Please mera downloads folder open kar do')).toMatchObject({ action: 'folder.open', args: { folder: 'downloads' } }));
  it('Urdu script', () => expect(c('ڈاؤن لوڈز فولڈر کھولو')).toMatchObject({ action: 'folder.open', args: { folder: 'downloads' } }));
  it('list contents', () => expect(c('Downloads mein kya hai')).toMatchObject({ action: 'folder.list', args: { folder: 'downloads' } }));
});

describe('files', () => {
  it('invoice file search', () => expect(c('Meri invoice wali file search karo.')).toMatchObject({ action: 'file.search', args: { query: 'invoice' } }));
  it('desktop pdf open', () =>
    expect(c('Desktop par jo PDF hai woh kholo.')).toMatchObject({ action: 'file.open', args: { query: '', ext: ['pdf'], location: 'desktop' } }));
  it('latest excel on desktop', () =>
    expect(c('Desktop par latest Excel file dhoondo.')).toMatchObject({
      action: 'file.search',
      args: { location: 'desktop', sort: 'latest', ext: ['xlsx', 'xls', 'csv'] },
    }));
  it('invoice pdf', () => expect(c('Invoice PDF search karo')).toMatchObject({ action: 'file.search', args: { query: 'Invoice', ext: ['pdf'] } }));
  it('where is file — needs a name', () => expect(parseCommand('Ye file kahan save hai?').kind).toBe('clarify'));
  it('where is named file', () => expect(c('invoice file kahan hai')).toMatchObject({ action: 'file.search', args: { query: 'invoice' } }));
});

describe('browser & youtube', () => {
  it('youtube play', () => expect(c('YouTube par Gold analysis play karo.')).toMatchObject({ action: 'youtube.play', args: { query: 'Gold analysis' } }));
  it('youtube search', () => expect(c('YouTube par forex news search karo')).toMatchObject({ action: 'youtube.search', args: { query: 'forex news' } }));
  it('youtube home asks a choice', () => expect(parseCommand('YouTube kholo')).toMatchObject({ kind: 'clarify', topic: 'youtube-choice' }));
  it('explicit youtube home does not ask', () => expect(c('YouTube home kholo')).toMatchObject({ action: 'web.open', args: { url: 'https://www.youtube.com/' } }));
  it('browser search', () => expect(c('Browser mein Forex news search karo.')).toMatchObject({ action: 'web.search', args: { query: 'Forex news' } }));
  it('latest gold news', () => expect(c('Browser mein latest gold news search karo.')).toMatchObject({ action: 'web.search', args: { query: 'latest gold news' } }));
  it('site', () => expect(c('TradingView kholo')).toMatchObject({ action: 'web.open', args: { url: 'https://www.tradingview.com/' } }));
  it('url', () => expect(c('open forexfactory.com/calendar')).toMatchObject({ action: 'web.open' }));
});

describe('system', () => {
  it('screen', () => expect(c('Mujhe laptop ki screen dikhao.').action).toBe('screen.capture'));
  it('apps list', () => expect(c('Computer par kaunsi applications open hain?').action).toBe('apps.list'));
  it('device status', () => expect(c('laptop ka status batao').action).toBe('device.status'));
  it('battery', () => expect(c('battery batao').action).toBe('device.status'));
  it('latest file in downloads', () =>
    expect(c('downloads ki latest file kholo')).toMatchObject({ action: 'file.open', args: { location: 'downloads', sort: 'latest' } }));
  it('cancel', () => expect(c('Current command cancel karo.').action).toBe('command.cancel'));
  it('cancel urdu', () => expect(c('کمانڈ منسوخ کرو').action).toBe('command.cancel'));
  it('lock', () => expect(c('laptop lock karo').action).toBe('system.lock'));
  it('close app is unsupported', () => expect(parseCommand('Chrome band karo').kind).toBe('unsupported'));
});

describe('whatsapp', () => {
  it('check', () => expect(c('WhatsApp check karo.').action).toBe('whatsapp.check'));
  it('unread', () => expect(c('WhatsApp par unread messages batao.').action).toBe('whatsapp.unread_senders'));
  it('contact unread → check', () => expect(c('Ali ke naye messages batao.').action).toBe('whatsapp.check'));
  for (const t of ['WhatsApp kholo', 'WhatsApp khol do.', 'Open WhatsApp', 'whatsapp']) {
    it("defaults to Personal WhatsApp Desktop: " + t, () =>
      expect(parseCommand(t)).toMatchObject({kind:'command',action:'whatsapp.open',args:{mode:'desktop'}}));
  }
  it('asks a natural bilingual question', () => expect(clarifyMessage('whatsapp-choice').roman).toContain('Desktop app kholoon ya WhatsApp Web'));
  for (const t of ['desktop', 'desktop wala', 'installed app', 'pehla wala', '1']) {
    it('understands desktop reply ' + t, () => expect(parseWhatsAppChoice(t)).toBe('desktop'));
  }
  for (const t of ['web', 'web wala', 'browser wala', 'Chrome', 'doosra wala', '2']) {
    it('understands web reply ' + t, () => expect(parseWhatsAppChoice(t)).toBe('web'));
  }
  for (const t of ['rehne do', 'cancel', 'nahi']) {
    it('can cancel the prompt ' + t, () => expect(parseWhatsAppChoice(t)).toBe('cancel'));
  }
  it('never guesses from vague words', () => {
    expect(parseWhatsAppChoice('haan')).toBeNull();
    expect(parseWhatsAppChoice('dono')).toBeNull();
    expect(parseWhatsAppChoice('desktop ya web')).toBeNull();
  });
  it('explicit web browser command', () => expect(c('WhatsApp Web kholo')).toMatchObject({ action: 'web.open', args: { url: 'https://web.whatsapp.com/' } }));
  it('explicit desktop command', () => expect(c('WhatsApp Desktop kholo')).toMatchObject({ action: 'whatsapp.open', args: { mode: 'desktop' } }));
  it('WhatsApp message reading is explicitly scoped to visible chat', () => expect(c('WhatsApp messages read karo').action).toBe('whatsapp.read_visible'));
  it('compose roman', () =>
    expect(c('Ali ko message likho ke main 10 minute mein call karunga.')).toMatchObject({
      action: 'whatsapp.compose',
      args: { contact: 'Ali', message: 'Main 10 minute mein call karunga' },
    }));
  it('compose reply', () =>
    expect(c('Ali ko reply karo ke main 10 minute mein call karta hoon')).toMatchObject({ action: 'whatsapp.compose', args: { contact: 'Ali' } }));
  it('compose english', () =>
    expect(c('Send a message to Sara saying I will be late')).toMatchObject({ action: 'whatsapp.compose', args: { contact: 'Sara', message: 'I will be late' } }));
  it('compose urdu', () =>
    expect(c('علی کو میسج لکھو کہ میں دس منٹ میں کال کروں گا')).toMatchObject({
      action: 'whatsapp.compose',
      args: { contact: 'علی', message: 'میں دس منٹ میں کال کروں گا' },
    }));
});

describe('graceful handling', () => {
  it('unknown', () => expect(parseCommand('aaj mausam kaisa hai').kind).toBe('unsupported'));
  it('greeting', () => expect(parseCommand('Salam').kind).toBe('reply'));
  it('empty', () => expect(parseCommand('   ').kind).toBe('clarify'));
});

describe('validation & approval', () => {
  it('rejects unknown action', () => expect(validateCommand('shell.exec', { cmd: 'del' }).ok).toBe(false));
  it('rejects non-allowlisted app', () => expect(validateCommand('app.open', { app: 'cmd' }).ok).toBe(false));
  it('rejects javascript: URL', () => expect(validateCommand('web.open', { url: 'javascript:alert(1)' }).ok).toBe(false));
  it('rejects file:// URL', () => expect(validateCommand('web.open', { url: 'file:///C:/Windows' }).ok).toBe(false));
  it('rejects traversal', () => expect(validateCommand('file.open', { path: 'C:\\Users\\a\\..\\..\\Windows\\x.pdf' }).ok).toBe(false));
  it('rejects UNC', () => expect(validateCommand('file.open', { path: '\\\\server\\share\\a.pdf' }).ok).toBe(false));
  it('rejects exe filter', () => expect(validateCommand('file.search', { query: 'x', ext: ['exe'] }).ok).toBe(false));
  it('normalises URL', () => expect(validateCommand('web.open', { url: 'google.com' })).toMatchObject({ ok: true, args: { url: 'https://google.com/' } }));
  it('compose always needs approval even if user disables', () => expect(requiresApproval('whatsapp.compose', { 'whatsapp.compose': false })).toBe(true));
  it('screen capture always requires approval', () => {
    expect(requiresApproval('screen.capture')).toBe(true);
    expect(requiresApproval('screen.capture', { 'screen.capture': false })).toBe(true);
  });
  it('every parsed command validates', () => {
    const samples = ['Chrome kholo', 'Downloads folder kholo', 'Invoice PDF search karo', 'YouTube par Gold analysis play karo', 'Browser mein Forex news search karo', 'Desktop par jo PDF hai woh kholo'];
    for (const s of samples) {
      const r = c(s);
      expect(validateCommand(r.action, r.args).ok, s).toBe(true);
    }
  });
});

describe('messages', () => {
  it('ack in three languages', () => {
    const m = ackMessage('folder.open', { folder: 'downloads' });
    expect(m.roman).toBe('Downloads folder open kar raha hoon.');
    expect(m.ur).toContain('فولڈر');
    expect(m.en).toContain('Downloads');
  });
  it('youtube fallback is honest', () => {
    expect(successMessage('youtube.play', { query: 'x' }, { mode: 'search' }).en).toContain("Couldn't");
  });
});

describe('single physical monitor capture',()=>{
  it('selects a numbered monitor without guessing',()=>{
    expect(c('monitor 2 ka screenshot lo')).toMatchObject({action:'screen.capture',args:{monitor:2}});
    expect(validateCommand('screen.capture',{monitor:2})).toMatchObject({ok:true,args:{monitor:2}});
  });
  it('rejects virtual desktop, out-of-range and non-integer selectors',()=>{
    for(const monitor of [0,17,1.5,'2',true,null])
      expect(validateCommand('screen.capture',{monitor}).ok).toBe(false);
    expect(validateCommand('screen.capture',{monitor:2,all:true}).ok).toBe(false);
  });
});

describe('explicit browser identity and navigation',()=>{
  it('routes new and previous tab and browser downloads to reviewed keys',()=>{
    for(const [input,key] of [['new tab kholo','ctrl+t'],['previous tab','ctrl+shift+tab'],['browser downloads kholo','ctrl+j']]){
      expect(c(input)).toMatchObject({action:'browser.control',args:{kind:'key',key}});
      expect(validateCommand('browser.control',{kind:'key',key}).ok).toBe(true);
    }
    expect(requiresApproval('browser.control',{'browser.control':false})).toBe(true);
  });
  it('preserves explicit Chrome profile and known site',()=>{
    expect(c('Profile 2 mein Gmail kholo')).toMatchObject({action:'browser.profile_open',args:{profile:'Profile 2',url:'https://mail.google.com/'}});
  });
});

describe('explicit single-monitor OCR',()=>{
  it('keeps text-only intent distinct from screenshot and always approved',()=>{
    expect(c('Monitor 2 ka text parho')).toMatchObject({action:'screen.capture',args:{monitor:2,textOnly:true}});
    expect(validateCommand('screen.capture',{monitor:2,textOnly:true})).toMatchObject({ok:true,args:{monitor:2,textOnly:true}});
    expect(validateCommand('screen.capture',{monitor:2,textOnly:false}).ok).toBe(false);
    expect(validateCommand('screen.capture',{textOnly:true}).ok).toBe(false);
    expect(validateCommand('screen.capture',{monitor:17,textOnly:true}).ok).toBe(false);
    expect(requiresApproval('screen.capture',{'screen.capture':false})).toBe(true);
    expect(ackMessage('screen.capture',{monitor:2,textOnly:true}).en).toContain('No screenshot upload');
  });
});

describe('owner read-only WhatsApp preference (explicit opt-in)',()=>{
  it('defaults to per-scan approval but supports saved read-only permission',()=>{
    expect(requiresApproval('whatsapp.unread_senders')).toBe(true);
    expect(requiresApproval('whatsapp.unread_senders',{'whatsapp.unread_senders':false})).toBe(false);
    expect(requiresApproval('whatsapp.compose',{'whatsapp.compose':false})).toBe(true);
  });
  for (const phrase of ['Kinke messages unread hain?', 'Who has messaged me on WhatsApp?',
    'WhatsApp par new messages batao','Check my unread WhatsApp messages'])
    it(phrase,()=>expect(c(phrase).action).toBe('whatsapp.unread_senders'));
});
