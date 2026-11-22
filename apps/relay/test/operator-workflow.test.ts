import {describe,it,expect} from 'vitest';
import {validatePlanShape,exactWhatsAppReply,navigationAllowsNextStep} from '../src/operator';
import {ACTIONS, requiresApproval, validateCommand} from '../../../packages/command-protocol/src/index';

const future = new Date(Date.now()+2*86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
const futureEnd = new Date(Date.now()+2*86400000+3600000).toISOString().replace(/\.\d{3}Z$/,'Z');

describe('approved Personal WhatsApp + screen + Calendar + ChatGPT workflow contracts',()=>{
  it('stops a multi-step computer plan after unverified navigation, including simulation',()=>{
    expect(navigationAllowsNextStep('ui.navigate_verified',{
      inputDelivered:true,navigationVerified:true,verified:true})).toBe(true);
    for(const result of [
      {inputDelivered:true,navigationVerified:false,verified:false},
      {inputDelivered:true,navigationVerified:true,verified:false},
      {inputDelivered:true,navigationVerified:true,verified:true,simulated:true},
      {},
    ])expect(navigationAllowsNextStep('ui.navigate_verified',result)).toBe(false);
    expect(navigationAllowsNextStep('device.status',{})).toBe(true);
  });
  it('all high-impact actions require a second explicit approval',()=>{
    for(const action of ['ui.inspect','ui.activate','calendar.event_draft','calendar.save_reviewed',
      'chatgpt.prompt_draft','chatgpt.submit_prompt','chatgpt.download_visible',
      'whatsapp.read_selected','whatsapp.draft_reply','whatsapp.send_reviewed','whatsapp.attach_preview','whatsapp.send_attachment_reviewed'] as const){
      expect(requiresApproval(action)).toBe(true);
    }
  });
  it('safe screen reading excludes arbitrary shell and unsafe clicks',()=>{
    expect(validatePlanShape({summary:'inspect',steps:[{action:'ui.inspect',args:{}}]}).steps).toHaveLength(1);
    expect(validateCommand('ui.activate',{label:'Search'}).ok).toBe(false);
    expect(validateCommand('ui.activate_observed',{label:'Search',role:'ButtonControl',snapshot:'a'.repeat(64)}).ok).toBe(true);
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
  it('named Personal WhatsApp chat selection is exact and separately approved',()=>{
    expect(requiresApproval('whatsapp.select_chat')).toBe(true);
    expect(validateCommand('whatsapp.select_chat',{contact:'Ali'}).ok).toBe(true);
    expect(validateCommand('whatsapp.select_chat',{contact:''}).ok).toBe(false);
    expect(validateCommand('whatsapp.read_selected',{contact:'Ali'}).ok).toBe(true);
    expect(validateCommand('whatsapp.read_selected',{}).ok).toBe(true);
    expect(validatePlanShape({steps:[
      {action:'whatsapp.select_chat',args:{contact:'Ali'}},
      {action:'whatsapp.read_selected',args:{contact:'Ali'}}
    ]}).steps).toHaveLength(2);
    expect(()=>validatePlanShape({steps:[
      {action:'whatsapp.select_chat',args:{contact:'Ali'}},
      {action:'whatsapp.read_selected',args:{contact:'Ahmed'}}
    ]})).toThrow();
    expect(()=>validatePlanShape({steps:[
      {action:'whatsapp.read_selected',args:{contact:'Ali'}},
      {action:'whatsapp.select_chat',args:{contact:'Ali'}}
    ]})).toThrow();
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


describe('deterministic owner-reviewed WhatsApp reply drafting',()=>{
  it('extracts full recipient name and message, drafting without Send',()=>{
    expect(exactWhatsAppReply('Adnan Agent Visa Bina Forever ko reply likho: Kal milte hain'))
      .toEqual({contact:'Adnan Agent Visa Bina Forever',message:'Kal milte hain'});
    const p=exactWhatsAppReply('Ashfaq Boss Bina Forever ko message bhejo: Shukriya');
    expect(p).toEqual({contact:'Ashfaq Boss Bina Forever',message:'Shukriya'});
    expect(validatePlanShape({steps:[
      {action:'whatsapp.select_chat',args:{contact:p!.contact}},
      {action:'whatsapp.draft_reply',args:p}
    ]}).steps.map(x=>x.action)).toEqual(['whatsapp.select_chat','whatsapp.draft_reply']);
  });
  it('never treats missing text or control characters as a Send request',()=>{
    expect(exactWhatsAppReply('Ali ko reply kar do')).toBeNull();
    expect(exactWhatsAppReply('Ali ko message bhejo: send')).toBeNull();
    expect(exactWhatsAppReply('Ali ko message likho: hi\nSend')).toBeNull();
  });
});
