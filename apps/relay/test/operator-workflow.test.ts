import {describe,it,expect} from 'vitest';
import {validatePlanShape} from '../src/operator';
import {ACTIONS, requiresApproval, validateCommand} from '../../../packages/command-protocol/src/index';

const future = new Date(Date.now()+2*86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
const futureEnd = new Date(Date.now()+2*86400000+3600000).toISOString().replace(/\.\d{3}Z$/,'Z');

describe('approved Personal WhatsApp + screen + Calendar + ChatGPT workflow contracts',()=>{
  it('all high-impact actions require a second explicit approval',()=>{
    for(const action of ['ui.inspect','ui.activate','calendar.event_draft','calendar.save_reviewed',
      'chatgpt.prompt_draft','chatgpt.submit_prompt','chatgpt.download_visible',
      'whatsapp.read_selected','whatsapp.draft_reply','whatsapp.send_reviewed','whatsapp.attach_preview','whatsapp.send_attachment_reviewed'] as const){
      expect(requiresApproval(action)).toBe(true);
    }
  });
  it('safe screen reading excludes arbitrary shell and unsafe clicks',()=>{
    expect(validatePlanShape({summary:'inspect',steps:[{action:'ui.inspect',args:{}}]}).steps).toHaveLength(1);
    expect(validateCommand('ui.activate',{label:'Search'}).ok).toBe(true);
    expect(validateCommand('ui.activate',{label:'Send message'}).ok).toBe(false);
    expect(()=>validatePlanShape({steps:[{action:'browser.control',args:{kind:'click',x:40,y:60}}]})).toThrow();
    expect(()=>validatePlanShape({steps:[{action:'shell.exec',args:{cmd:'whoami'}}]})).toThrow();
  });
  it('calendar only creates validated, draft-only action plans',()=>{
    const args={provider:'google',title:'Test',profile:'Profile 1',startUtc:future,
      endUtc:futureEnd,timeZone:'Asia/Kuala_Lumpur',details:'',location:''};
    expect(validatePlanShape({summary:'Open event draft',steps:[{action:'calendar.event_draft',args}]}).steps).toHaveLength(1);
    expect(validateCommand('calendar.event_draft',{...args,startUtc:'2020-01-01T00:00:00Z'}).ok).toBe(false);
    expect(validateCommand('calendar.event_draft',{...args,profile:'../Default'}).ok).toBe(false);
    expect(validatePlanShape({steps:[{action:'calendar.save_reviewed',args}]}).steps).toHaveLength(1);
    expect(validateCommand('calendar.save_reviewed',{...args,profile:'../Default'}).ok).toBe(false);
  });
  it('Personal WhatsApp send requires separate explicit owner approval and exact args',()=>{
    expect(validatePlanShape({steps:[{action:'whatsapp.draft_reply',args:{contact:'Ali',message:'Kal milte hain'}}]}).steps).toHaveLength(1);
    expect(validateCommand('whatsapp.attach_preview',{contact:'Ali',path:'C:\\Users\\Test\\Downloads\\file.pdf'}).ok).toBe(true);
    expect(()=>validatePlanShape({steps:[{action:'whatsapp.send',args:{contact:'Ali',message:'hi'}}]})).toThrow();
    expect(validatePlanShape({steps:[{action:'whatsapp.send_reviewed',args:{contact:'Ali',message:'hi'}}]}).steps).toHaveLength(1);
    expect(validateCommand('whatsapp.send_reviewed',{contact:'Ali',message:''}).ok).toBe(false);
  });
  it('irreversible WhatsApp Send and Calendar Save actions must be the FINAL task step',()=>{
    const msg={contact:'Ali',message:'Kal 3 PM milte hain'};
    const event={provider:'google',title:'Meeting',profile:'Profile 1',
      startUtc:future,endUtc:futureEnd,timeZone:'Asia/Kuala_Lumpur',details:'',location:''};
    const send={action:'whatsapp.send_reviewed',args:msg};
    const save={action:'calendar.save_reviewed',args:event};
    const file={action:'whatsapp.send_attachment_reviewed',
      args:{contact:'Ali',path:'C:\\Users\\Test\\Downloads\\report.pdf'}};
    expect(validatePlanShape({steps:[{action:'whatsapp.draft_reply',args:msg},send]}).steps).toHaveLength(2);
    expect(validatePlanShape({steps:[{action:'calendar.event_draft',args:event},save]}).steps).toHaveLength(2);
    expect(validatePlanShape({steps:[file]}).steps).toHaveLength(1);
    for(const first of [send,save,file]){
      expect(()=>validatePlanShape({steps:[first,{action:'device.status',args:{}}]})).toThrow();
      for(const second of [send,save,file]){
        expect(()=>validatePlanShape({steps:[first,second]})).toThrow();
      }
    }
  });
  it('ChatGPT restricts the exact configured host, not arbitrary sites',()=>{
    const valid={projectUrl:'https://chatgpt.com/g/g-p-demo',prompt:'Make an orange trading banner'};
    expect(validateCommand('chatgpt.prompt_draft',valid).ok).toBe(true);
    expect(validateCommand('chatgpt.prompt_draft',{...valid,projectUrl:'https://chatgpt.com.evil.test/'}).ok).toBe(false);
    expect(validatePlanShape({steps:[{action:'chatgpt.submit_prompt',args:valid}]}).steps).toHaveLength(1);
    expect(ACTIONS['chatgpt.download_visible'].timeoutMs).toBeGreaterThan(90_000);
  });
});
