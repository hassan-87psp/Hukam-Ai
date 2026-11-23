import {describe,expect,it} from 'vitest';
import {showCommandResult} from '../../web/src/lib/command-result-visibility';

describe('HUKM command cards preserve honest WhatsApp partial scan evidence',()=>{
  it('shows verified partial sender names despite Failed status (owner 2/4 screenshot)',()=>{
    expect(showCommandResult({
      status:'failed',action:'whatsapp.unread_senders',
      result:{senders:['Contact One','Contact Two'],totalUnreadChats:4,
        allBadgeChatsMatched:false,scanStopped:'end_of_list'},
    })).toBe(true);
  });
  it('does not expose failed outcomes with no independently known sender names',()=>{
    expect(showCommandResult({status:'failed',action:'whatsapp.unread_senders',
      result:{senders:[],totalUnreadChats:4}})).toBe(false);
    expect(showCommandResult({status:'failed',action:'web.search',
      result:{senders:['Unrelated private value']}})).toBe(false);
    expect(showCommandResult({status:'failed',action:'whatsapp.unread_senders',
      result:{senders:['']}})).toBe(false);
  });
  it('keeps normal completed result and unfinished command boundaries intact',()=>{
    expect(showCommandResult({status:'completed',action:'whatsapp.unread_senders',
      result:{senders:['Alice']}})).toBe(true);
    expect(showCommandResult({status:'running',action:'whatsapp.unread_senders',
      result:{senders:['Alice']}})).toBe(false);
  });
});
