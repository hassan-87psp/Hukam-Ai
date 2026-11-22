/** Original, no-model fast paths and bounded conversational context.
 * Specialists are fixed routing hints, not additional autonomous agents.
 * No user/project text is executable policy. */
import { normalize, parseCommand, routeIntent } from '../../../packages/command-protocol/src/index';

export function freshTask(answer:string):boolean {
  const t=normalize(answer);
  if (/^(?:new task|naya task)\b/.test(t))return true;
  const parsed=parseCommand(answer);
  return parsed.kind==='command' && (
    parsed.action==='app.close' ||
    /^(?:(?:please|hukm)\s+)?(?:whatsapp|chrome|notepad|youtube|calendar|google|outlook|browser|gmail|downloads|desktop|documents|folder|open|khol)\b.*\b(?:kholo|open|start|check|karo|band|close|quit|dikhao)$/.test(t)
  ) && routeIntent(answer,parsed)!=='chat';
}

export function boundedFollowup(previous:string,question:string,answer:string):string {
  // Preserve the newest answer and original goal; never cut the answer's tail.
  const tail='\nHUKM asked: '+question.slice(0,250)+'\nUser replied: '+answer;
  const remaining=Math.max(0,1800-tail.length);
  return previous.slice(0,remaining)+tail;
}

export function numberWritingPlan(request:string): {summary:string;steps:{action:string;args:Record<string,unknown>}[]}|null {
  const t=normalize(request);
  const match=t.match(/^(?:please\s+)?notepad\s+(?:kholo|open)\s+(?:aur|phir|and then)\s+(?:(?:usmein|us mein|us me|ismein|is me)\s+)?(\d{1,3})\s+(?:se|to)\s+(\d{1,3})\s+(?:tak\s+)?(?:likho|type|likh do)$/);
  if(!match)return null;
  const first=Number(match[1]),last=Number(match[2]);
  if(last<first || last-first>99)return null;
  return {summary:'Open Notepad and write the exact requested number sequence',steps:[
    {action:'app.open',args:{app:'notepad'}},
    {action:'notepad.type',args:{text:Array.from({length:last-first+1},(_,i)=>String(first+i)).join('\n')}}
  ]};
}

export function specialistHint(request:string):string {
  const t=normalize(request);
  const sections:string[]=[];
  if(/\bwhatsapp\b/.test(t))sections.push('Personal WhatsApp: exact target, selected chat or reviewed attachment, separate Send approval.');
  if(/\b(?:calendar|meeting|outlook|gmail|email)\b/.test(t))sections.push('Calendar/mail: retain explicit time and account identity. Never guess a profile, recipient or date.');
  if(/\b(?:file|files|folder|downloads|pdf|xlsx)\b/.test(t))sections.push('Files: search within allowed folders; never invent paths or choose an ambiguous result.');
  if(/\b(?:chatgpt|banner|image|poster|script)\b/.test(t))sections.push('Content: saved Project URL and profile required for ChatGPT actions; proposal is not generation or download proof.');
  if(/\b(?:chrome|browser|notepad|screen|laptop|window)\b/.test(t))sections.push('Desktop/browser: deterministic verified target, no guessed coordinates or account identity.');
  return sections.length?sections.join(' '):'General command: propose only supported actions; ask for essential missing information.';
}

export function isExplicitSend(answer:string):boolean {
  return /^(?:(?:haan|han|yes|ok|okay)[, ]+)?(?:bhej\s+do|send\s+(?:karo|now)|send)$/i.test(answer.trim());
}

export function isPrivateFollowup(request:string):boolean {
  return request.startsWith('HUKM_APPROVED_WHATSAPP_DRAFT:') ||
    request.startsWith('HUKM_VERIFIED_WHATSAPP_CONTACT:') ||
    request.startsWith('The owner opened Personal WhatsApp Desktop and reviewed visible unread chat names.') ||
    request.startsWith('HUKM_CHATGPT_') ||
    request.startsWith('HUKM_REVIEWED_CHATGPT_DRAFT:');
}
