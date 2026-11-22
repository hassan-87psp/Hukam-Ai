import { describe, expect, it } from 'vitest';
import { parseCommand, routeIntent, desktopWhatsAppWorkflow, namedWhatsAppRead, validateCommand, requiresApproval } from '../src/index';

describe('one HUKM command brain with explicit owner-selected desktop preferences',()=>{
  const cases: Array<[string, 'plan'|'command'|'chat']> = [
    ['WhatsApp kholo', 'command'],
    ['WhatsApp Desktop kholo', 'command'],
    ['WhatsApp par check karo kitne unread hain', 'command'],
    ['Whatsapp par kis kis ka unread msg aya', 'command'],
    ['WhatsApp Web kholo', 'command'],
    ['WhatsApp Desktop on laptop and check msg', 'plan'],
    ['WhatsApp check karo', 'command'],
    ['Whatsapp dekho', 'command'],
    ['WhatsApp kholo aur msg check kro', 'plan'],
    ['WhatsApp Desktop open and check how many unread', 'plan'],
    ['WhatsApp kholo aur messages parho', 'plan'],
    ['Chrome kholo', 'command'],
    ['Notepad kholo aur usmein 1 se 9 tak likho', 'plan'],
    ['Note pad jo abhi open kiya us me 1 se 9 tak likho', 'plan'],
    ['WhatsApp par Ali ko reply likho ke kal 3 baje milte hain', 'plan'],
    ['WhatsApp ke messages parho', 'plan'],
    ['Ali ke WhatsApp message parho', 'plan'],
    ['WhatsApp par Ali ka message batao', 'plan'],
    ['Google Calendar mein kal 3 PM meeting add kardo', 'plan'],
    ['ChatGPT Project mein gold banner banao aur download karo', 'plan'],
    ['Screen par buttons dekho', 'plan'],
    ['scroll kro', 'command'],
    ['Kya tum laptop control kar sakte ho?', 'chat'],
    ['Forex trading mein VSA kya hai?', 'chat'],
    ['Hello HUKM', 'chat'],
  ];
  for(const [input,intent] of cases){
    it(input,()=>expect(routeIntent(input,parseCommand(input))).toBe(intent));
  }
  it('ambiguous task answer stays with the pending planner, not Google search',()=>{
    expect(routeIntent('Ali',parseCommand('Ali'),true)).toBe('plan');
    expect(routeIntent('Kal 3 PM',parseCommand('Kal 3 PM'),true)).toBe('plan');
    expect(routeIntent('Rehne do',parseCommand('Rehne do'),true)).toBe('plan');
    expect(routeIntent('Hello HUKM',parseCommand('Hello HUKM'),true)).toBe('chat');
    expect(routeIntent('What is a pip?',parseCommand('What is a pip?'),true)).toBe('chat');
  });
  it('compound Desktop WhatsApp tasks preserve both actions and explicit count semantics',()=>{
    expect(desktopWhatsAppWorkflow('WhatsApp Desktop on laptop and check msg')).toBe('senders');
    expect(desktopWhatsAppWorkflow('WhatsApp check karo')).toBe('senders');
    expect(desktopWhatsAppWorkflow('Whatsapp dekho')).toBe('senders');
    expect(desktopWhatsAppWorkflow('WhatsApp kholo aur msg check kro')).toBe('senders');
    expect(desktopWhatsAppWorkflow('WhatsApp Desktop open and check how many unread')).toBe('count');
    expect(desktopWhatsAppWorkflow('WhatsApp Web kholo')).toBe(null);
    expect(desktopWhatsAppWorkflow('Ali ke WhatsApp message parho')).toBe(null);
  });
  it('named WhatsApp message reads create exact-contact reviewed workflows independent of Gemini',()=>{
    expect(namedWhatsAppRead('Ali ke WhatsApp messages parho')).toBe('Ali');
    expect(namedWhatsAppRead('WhatsApp par Ali ka msg read karo')).toBe('Ali');
    expect(namedWhatsAppRead('Sara Khan ke WhatsApp messages parho')).toBe('Sara Khan');
    expect(namedWhatsAppRead('WhatsApp unread kitne hain')).toBe(null);
    expect(namedWhatsAppRead('WhatsApp selected chat parho')).toBe(null);
    expect(routeIntent('Ali ke WhatsApp messages parho',parseCommand('Ali ke WhatsApp messages parho')))
      .toBe('plan');
  });
  it('approved visual WhatsApp sender scan has an OCR-aware deadline',()=>{
    const result=validateCommand('whatsapp.unread_senders',{});
    expect(result.ok).toBe(true);
    expect(result.def?.timeoutMs).toBe(180000);
    expect(requiresApproval('whatsapp.unread_senders')).toBe(true);
  });
  it('website update is approved, fixed-source and never accepts arbitrary command arguments',()=>{
    expect(requiresApproval('controller.update')).toBe(true);
    expect(validateCommand('controller.update',{}).ok).toBe(true);
    expect(validateCommand('controller.update',{url:'https://evil.example/bad.exe'}).ok).toBe(false);
  });
  it('default Personal WhatsApp, no accidental browser/profile selection',()=>{
    const a=parseCommand('WhatsApp kholo');
    expect(a).toMatchObject({kind:'command',action:'whatsapp.open',args:{mode:'desktop'}});
    expect(parseCommand('desktop web WhatsApp kholo')).toMatchObject({
      kind:'command',action:'whatsapp.open',args:{mode:'desktop'}});
    expect(parseCommand('WhatsApp chrome par check karo')).toMatchObject({
      kind:'command',action:'whatsapp.check',args:{mode:'desktop'}});
    expect(parseCommand('WhatsApp Web kholo')).toMatchObject({
      kind:'command',action:'web.open',args:{url:'https://web.whatsapp.com/'}});
    expect(parseCommand('Whatsapp unread kitne hain')).toMatchObject({
      kind:'command',action:'whatsapp.check',args:{mode:'desktop'}});
  });
});
