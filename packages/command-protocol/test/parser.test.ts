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

describe('approved browser control', () => {
  it('parses an explicit click', () => {
    expect(c('browser click 440 320')).toMatchObject({ action: 'browser.control', args: { kind: 'click', x: 440, y: 320 } });
  });
  it('keeps typed text intact', () => {
    expect(c('type: Sir Sajid, kal meeting 9 PM')).toMatchObject({ action: 'browser.control', args: { kind: 'type', text: 'Sir Sajid, kal meeting 9 PM' } });
  });
  it('parses scroll and browser key', () => {
    expect(c('scroll down 2').args).toEqual({ kind: 'scroll', steps: -2 });
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
    expect(c('YouTube kholo')).toMatchObject({action:'web.open',args:{url:'https://www.youtube.com/'}});
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
  it('unread', () => expect(c('WhatsApp par unread messages batao.').action).toBe('whatsapp.check'));
  it('contact unread → check', () => expect(c('Ali ke naye messages batao.').action).toBe('whatsapp.check'));
  for (const t of ['WhatsApp kholo', 'WhatsApp khol do.', 'Open WhatsApp', 'whatsapp']) {
    it('clarifies ambiguous ' + t, () => expect(parseCommand(t)).toMatchObject({ kind: 'clarify', topic: 'whatsapp-choice' }));
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
  it('screen capture default approval, user can relax', () => {
    expect(requiresApproval('screen.capture')).toBe(true);
    expect(requiresApproval('screen.capture', { 'screen.capture': false })).toBe(false);
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
