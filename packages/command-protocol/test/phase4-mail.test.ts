import { describe, expect, it } from 'vitest';
import { validateCommand, requiresApproval, parseCommand, routeIntent } from '../src/index';
import {validatePlanShape} from '../../../apps/relay/src/operator';

describe('Phase 4: Gmail/Outlook draft contracts',()=>{
  const args={provider:'google',profile:'Profile 1',to:'staff@example.com',
    subject:'Meeting + Update',body:'Please review the attached note.'};
  it('always needs approval, never exposes a send action',()=>{
    expect(requiresApproval('email.inbox_open')).toBe(true);
    expect(requiresApproval('email.compose_draft')).toBe(true);
    expect(validateCommand('email.inbox_open',{provider:'google',profile:'Default'}).ok).toBe(true);
    expect(validateCommand('email.compose_draft',args).ok).toBe(true);
    expect(validateCommand('email.send',args).ok).toBe(false);
    expect(validatePlanShape({steps:[{action:'email.compose_draft',args}]}).steps).toHaveLength(1);
  });
  it('rejects forged account, recipient, newlines and control characters',()=>{
    for(const bad of [
      {...args,provider:'custom'},
      {...args,profile:'../Default'},
      {...args,to:'a@example.com,b@example.com'},
      {...args,to:'a@example.com\nBCC:secret@evil.test'},
      {...args,to:'invalid'},
      {...args,subject:''},
      {...args,body:''},
      {...args,body:'X'.repeat(1001)},
    ])expect(validateCommand('email.compose_draft',bad).ok).toBe(false);
  });
  it('routes mail tasks through the reviewed planner, rather than generic web search',()=>{
    for(const q of ['Gmail kholo','Email send karo','Outlook inbox check karo']){
      const parsed=parseCommand(q);
      expect(routeIntent(q,parsed)).toBe('plan');
    }
    expect(routeIntent('What is email?',parseCommand('What is email?'))).toBe('chat');
  });
  it('can open a saved Gmail Chrome profile, never an untrusted host',()=>{
    expect(validateCommand('browser.profile_open',{profile:'Profile 2',url:'https://mail.google.com/mail/u/0/#inbox'}).ok).toBe(true);
    expect(validateCommand('browser.profile_open',{profile:'Profile 2',url:'https://mail.google.com.evil.test/'}).ok).toBe(false);
  });
});
