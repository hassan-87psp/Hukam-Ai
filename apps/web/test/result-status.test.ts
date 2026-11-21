import {describe,expect,it} from 'vitest';
import {actionResultUnverified} from '../src/lib/format';

describe('HUKM never marks unproven external side effects green',()=>{
  it('WhatsApp delivery is unknown after a Send click, including files',()=>{
    for(const action of ['whatsapp.send_reviewed','whatsapp.send_attachment_reviewed'] as const){
      expect(actionResultUnverified(action,{sendAttempted:true,deliveryVerified:false})).toBe(true);
      expect(actionResultUnverified(action,{sendAttempted:'unknown',verified:false})).toBe(true);
    }
  });
  it('Calendar Save click cannot prove event creation or invitations',()=>{
    expect(actionResultUnverified('calendar.save_reviewed',{saveAttempted:true,eventCreatedVerified:false})).toBe(true);
    expect(actionResultUnverified('calendar.save_reviewed',{saveAttempted:'unknown'})).toBe(true);
  });
  it('ChatGPT prompt submit is not a verified generated response',()=>{
    expect(actionResultUnverified('chatgpt.submit_prompt',{submitted:true,responseVerified:false})).toBe(true);
  });
  it('ChatGPT output only counts when a completed new file is verified',()=>{
    expect(actionResultUnverified('chatgpt.download_visible',{downloadVerified:true,simulated:true})).toBe(true);
    expect(actionResultUnverified('chatgpt.download_visible',{downloadVerified:true,verified:true,fileName:'banner.png',sizeBytes:1448})).toBe(false);
    expect(actionResultUnverified('chatgpt.download_visible',{downloadVerified:true,verified:true,fileName:'banner.png',sizeBytes:0})).toBe(true);
  });
  it('Confirmed zero unread is not an unknown count',()=>{
    expect(actionResultUnverified('whatsapp.check',{unreadChats:0,source:'WhatsApp Desktop Unread filter'})).toBe(false);
    expect(actionResultUnverified('whatsapp.check',{unreadChats:null,source:'unavailable'})).toBe(true);
  });
  it('Routine app open is not reclassified as external delivery',()=>{
    expect(actionResultUnverified('app.open',{opened:true})).toBe(false);
  });
});
