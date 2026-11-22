import {describe,it,expect} from 'vitest';
import {freshTask,boundedFollowup,numberWritingPlan,specialistHint,isExplicitSend,isPrivateFollowup} from '../src/brain-context';
import {validatePlanShape} from '../src/operator';
import {parseCommand,routeIntent} from '../../../packages/command-protocol/src/index';

describe('Step 9 bounded conversational planning',()=>{
  it('compiles exact limited Notepad number ranges without Gemini',()=>{
    const plan=numberWritingPlan('Notepad kholo aur us mein 1 se 9 tak likho');
    expect(validatePlanShape(plan).steps).toEqual([
      {action:'app.open',args:{app:'notepad'}},
      {action:'notepad.type',args:{text:'1\n2\n3\n4\n5\n6\n7\n8\n9'}}
    ]);
    expect(numberWritingPlan('notepad kholo aur 1 se 999 tak likho')).toBeNull();
    expect(numberWritingPlan('notepad kholo aur 9 se 1 tak likho')).toBeNull();
  });
  it('keeps the newest answer intact when dialogue grows',()=>{
    const answer='x'.repeat(1199)+'Z';
    const request=boundedFollowup('original goal '+ 'a'.repeat(2000),'question',answer);
    expect(request.length).toBeLessThanOrEqual(1800);
    expect(request.startsWith('original goal')).toBe(true);
    expect(request.endsWith(answer)).toBe(true);
  });
  it('recognizes clear task switches, not a recipient answer',()=>{
    expect(freshTask('Chrome kholo')).toBe(true);
    expect(freshTask('note pad band kro')).toBe(true);
    expect(freshTask('Ali')).toBe(false);
  });
  it('uses fixed relevant routing guidance and keeps ordinary explanations in chat',()=>{
    expect(specialistHint('WhatsApp message bhejo')).toContain('Personal WhatsApp');
    expect(specialistHint('Downloads se PDF kholo')).toContain('Files:');
    expect(routeIntent('What is WhatsApp Web?',parseCommand('What is WhatsApp Web?'))).toBe('chat');
  });
  it('does not treat a casual yes as reviewed Send or share private follow-up state',()=>{
    for(const a of ['haan','yes','ok','reply karo'])expect(isExplicitSend(a)).toBe(false);
    expect(isExplicitSend('Haan bhej do')).toBe(true);
    expect(isPrivateFollowup('HUKM_APPROVED_WHATSAPP_DRAFT:{"contact":"test","message":"private"}')).toBe(true);
    expect(isPrivateFollowup('HUKM_VERIFIED_WHATSAPP_CONTACT:Test')).toBe(true);
    expect(isPrivateFollowup('ordinary request')).toBe(false);
  });
});
