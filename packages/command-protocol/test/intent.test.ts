import { describe, expect, it } from 'vitest';
import { parseCommand, routeIntent } from '../src/index';

describe('one HUKM command brain with explicit owner-selected desktop preferences',()=>{
  const cases: Array<[string, 'plan'|'command'|'chat']> = [
    ['WhatsApp kholo', 'command'],
    ['WhatsApp Desktop kholo', 'command'],
    ['WhatsApp par check karo kitne unread hain', 'command'],
    ['Whatsapp par kis kis ka unread msg aya', 'command'],
    ['WhatsApp Web kholo', 'command'],
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
