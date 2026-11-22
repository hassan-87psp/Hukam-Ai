/** Owner-scoped ChatGPT browser target and pending intent, never a credential.
 * Only a validated Chrome profile and fixed chatgpt.com URL are actionable.
 */
import {all,one,type DB} from './db';
import {chromeProfile} from '../../../packages/command-protocol/src/chatgpt-intent';

export const CHATGPT_ASK_PREFIX='HUKM_CHATGPT_ASK:';
export const CHATGPT_REVIEWED_PREFIX='HUKM_REVIEWED_CHATGPT_DRAFT:';
export const CHATGPT_SENDING_PREFIX='HUKM_CHATGPT_SENDING:';
export const CHATGPT_SUBMITTED_PREFIX='HUKM_CHATGPT_SUBMITTED:';
export const CHATGPT_VISIBLE_PREFIX='HUKM_CHATGPT_VISIBLE:';
export type ChatGPTRecent={prompt:string;profile:string;projectUrl:string;baseProjectUrl?:string;threadUrl?:string;};
function decodeContext(raw:unknown,prefix:string,requireThread=false):ChatGPTRecent|null{
  if(typeof raw!=='string'||!raw.startsWith(prefix))return null;
  try{
    const v=JSON.parse(raw.slice(prefix.length)) as ChatGPTRecent;
    if(!v || typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>1800 ||
       typeof v.profile!=='string'||chromeProfile(v.profile)!==v.profile ||
       !validChatGPTUrl(v.projectUrl) ||
       (v.baseProjectUrl!==undefined&&!validChatGPTUrl(v.baseProjectUrl)) ||
       (requireThread && (!v.threadUrl || !validChatGPTUrl(v.threadUrl))) ||
       (v.threadUrl!==undefined&&!validChatGPTUrl(v.threadUrl)))return null;
    return v;
  }catch{return null;}
}
export const decodeChatGPTSending=(raw:unknown)=>decodeContext(raw,CHATGPT_SENDING_PREFIX);
export const decodeChatGPTSubmitted=(raw:unknown)=>decodeContext(raw,CHATGPT_SUBMITTED_PREFIX);
export const decodeChatGPTVisible=(raw:unknown)=>decodeContext(raw,CHATGPT_VISIBLE_PREFIX,true);
export function isChatGPTReadIntent(input:string):boolean{
  return /^(?:(?:haan|han|yes)\s*[.!]?|(?:(?:uska|iska|chatgpt\s+ka|ai\s+ka)\s+)?(?:jawab|answer|response|reply|result)\s+(?:batao|dikhao|parho|read|check|sunao|do)|(?:read|show|check|batao|parho)\s+(?:the\s+)?(?:chatgpt\s+)?(?:answer|response|jawab)|(?:usne|chatgpt\s+ne|ai\s+ne)\s+(?:kya\s+)?(?:kaha|bola|jawab\s+diya).*)$/i.test(input.trim());
}
export function isChatGPTContextFollowup(input:string):boolean{
  const t=input.trim();
  return t.length>=8&&t.length<=1200&&
    /\b(?:usko|isko|iske|uske|wahi|same|pichla|pichle|previous|last|answer|reply|jawab|explain|detail|short|simple|summarize|summarise|english|roman\s+urdu)\b/i.test(t)&&
    /\b(?:samjhao|samjha|batao|banao|likho|rewrite|summarize|summarise|explain|detail|short|simple|english|translate|convert|expand|elaborate|kar\s+do|karo)\b/i.test(t)&&
    !/\b(?:whatsapp|send|bhejo|delete|remove|publish|payment|pay|transfer|password)\b/i.test(t);
}


export type ChatGPTAskState={question:string|null;profile:string|null;projectUrl:string};
export type ReviewedChatGPT={prompt:string;profile:string;projectUrl:string;baseProjectUrl?:string};

export function validChatGPTUrl(value:string):boolean{
  try{
    const u=new URL(value);
    return u.protocol==='https:' && u.hostname==='chatgpt.com' &&
      !u.username&&!u.password&&!u.hash && u.port==='' &&
      value.length<=500;
  }catch{return false;}
}

export function decodeChatGPTAsk(request:unknown):ChatGPTAskState|null{
  if(typeof request!=='string'||!request.startsWith(CHATGPT_ASK_PREFIX))return null;
  try{
    const v=JSON.parse(request.slice(CHATGPT_ASK_PREFIX.length)) as ChatGPTAskState;
    if(!v||!validChatGPTUrl(v.projectUrl) ||
       (v.profile!==null&&(!chromeProfile(v.profile)||chromeProfile(v.profile)!==v.profile)) ||
       (v.question!==null&&(typeof v.question!=='string'||!v.question.trim()||v.question.length>1800)))
      return null;
    return v;
  }catch{return null;}
}
export function decodeReviewedChatGPT(request:unknown):ReviewedChatGPT|null{
  if(typeof request!=='string'||!request.startsWith(CHATGPT_REVIEWED_PREFIX))return null;
  try{
    const v=JSON.parse(request.slice(CHATGPT_REVIEWED_PREFIX.length)) as ReviewedChatGPT;
    if(!v||!validChatGPTUrl(v.projectUrl) ||
      (v.baseProjectUrl!==undefined&&!validChatGPTUrl(v.baseProjectUrl)) ||
      !chromeProfile(v.profile)||v.profile!==chromeProfile(v.profile) ||
      typeof v.prompt!=='string'||!v.prompt.trim()||v.prompt.length>1800)return null;
    return v;
  }catch{return null;}
}

/** Profile memory is opt-in: it must be a validated owner-entered "computer"
 * Memory item. Never parse model-generated prose or infer browser passwords.
 */
export function savedChatGPTProfile(db:DB,userId:string):string|null{
  const entry=one(db,
    "SELECT content FROM memory_records WHERE user_id=? AND project_id IS NULL AND category='computer' AND use_in_ai=1 AND lower(title) IN ('chatgpt chrome profile','default chatgpt profile') ORDER BY updated_at DESC LIMIT 1",
    userId);
  return entry?chromeProfile(String(entry.content)):null;
}

/** An actual owner-requested Chrome open is a bounded profile preference.
 * No Project history can be reused in the General workspace.
 * This does not attest that the user remains logged in to ChatGPT.
 */
export function recentlyUsedChatGPTProfile(db:DB,userId:string,now=Date.now()):string|null{
  const cutoff=new Date(now-24*60*60_000).toISOString();
  const rows=all(db,
    "SELECT args,result FROM commands c WHERE c.user_id=? AND c.action='browser.profile_open' AND c.status='completed' AND c.created_at>=? AND (c.client_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM operator_runs r JOIN operator_plans p ON p.id=r.plan_id WHERE r.user_id=c.user_id AND p.user_id=c.user_id AND substr(c.client_request_id,1,length(r.id)+1)=r.id||'-' AND p.project_id IS NOT NULL)) ORDER BY c.created_at DESC,c.rowid DESC LIMIT 12",
    userId,cutoff);
  for(const row of rows){
    try{
      const args=JSON.parse(String(row.args));
      const result=row.result?JSON.parse(String(row.result)):{};
      if(result.simulated===true || !validChatGPTUrl(args.url))continue;
      const profile=chromeProfile(args.profile);
      if(profile)return profile;
    }catch{continue;}
  }
  return null;
}
