/** HUKM user's actual instruction decides routing, not which hard-coded
 * keyword happened to match first. This is a security boundary:
 * compound/sensitive tasks reach a REVIEWED plan, never a Google search
 * or an unreviewed browser click.
 */
import type { ParseResult } from './parser';

export type IntentRoute = 'command' | 'plan' | 'chat';

const TASK_VERBS = /\b(?:karo|kro|kar do|krdo|kerdo|kholen?|kholo|open|chalao|run|perform|type|likho|likh|bhejo|send|attach|download|save|create|generate|banao|bana|add|schedule|scroll|click|press|check|dakho|dekho|parho|padho|read|reply|draft|search|dhoondo|execute|handle)\b/i;
const COMPOUND = /\b(?:aur|phir|then|after that|us\s*me|iske baad|afterwards|and then)\b|(?:notepad|note\s*pad).*?(?:likho|type)|(?:likho|type).*?(?:notepad|note\s*pad)/i;
const WORKFLOWS = /\b(?:calendar|calender|meeting)\b.*?\b(?:add|create|schedule|set|bana|invite|reschedule)|\b(?:add|create|schedule|set)\b.*?\b(?:calendar|meeting)\b|\b(?:whatsapp|chats?|messages?|msgs?)\b.*?\b(?:reply|attach|file|read|parho|padho|send|bhejo|likho|draft)|\b(?:chatgpt|banner|image|script|poster|pic)\b.*?\b(?:bana|create|generate|draft|download|save|design)|\b(?:screen|window)\b.*?\b(?:dekho|dakho|observe|inspect|button|samjho)/i;
const QUESTION = /^(?:what|why|who|when|where|which|how|kya|kyun|kiun|kaise|kese|kis|kon|kaun|kab)\b/i;
const GREETING = /^(?:hi|hello|hey|salam|assalam(?:\s*[ou]?\s*alaikum)?|aoa|good morning|good evening)(?:\s+hukm)?[!?.,\s]*$/i;
const ASIDE_QUESTION = /^(?:what (?:is|are)|who (?:is|are)|why (?:is|are)|explain|tell me about|meaning of|kya matlab|kya hota hai)\b/i;

export function routeIntent(text: string, parsed: ParseResult, awaitingOperatorReply = false): IntentRoute {
  const t=text.trim();
  if(awaitingOperatorReply) {
    // A clear unrelated question/greeting does not erase an unfinished task.
    if(GREETING.test(t) || ASIDE_QUESTION.test(t))return 'chat';
    return 'plan';
  }
  if(!t || GREETING.test(t))return 'chat';
  if(WORKFLOWS.test(t))return 'plan';
  // If this is an explicit, unambiguous single supported command, use the
  // vetted deterministic parser rather than paying for a model call.
  if(parsed.kind==='command' && !COMPOUND.test(t))return 'command';
  if(parsed.kind==='clarify' && !COMPOUND.test(t))return 'command';
  // Questions about computers are still chat, not permission to operate them.
  if(QUESTION.test(t) && !TASK_VERBS.test(t))return 'chat';
  const mentionsTarget=/\b(?:laptop|computer|pc|windows|browser|chrome|edge|notepad|note\s*pad|whatsapp|calendar|calender|chatgpt|youtube|file|folder|app|application|screen|website|monitor|tab)\b/i.test(t);
  if((COMPOUND.test(t) && mentionsTarget) ||
      (mentionsTarget && TASK_VERBS.test(t)) ||
      /^(?:scroll\s*(?:up|down)?|type|click|press)\b/i.test(t))
    return 'plan';
  return 'chat';
}
