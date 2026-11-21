/** HUKM user's actual instruction decides routing, not which hard-coded
 * keyword happened to match first. This is a security boundary:
 * compound/sensitive tasks reach a REVIEWED plan, never a Google search
 * or an unreviewed browser click.
 */
import type { ParseResult } from './parser';

export type IntentRoute = 'command' | 'plan' | 'chat';

/** Strict Personal WhatsApp multi-step intent, independent of Gemini.

    "WhatsApp Desktop on laptop and check msg" must not collapse into one
    unread-count command; it means open the installed app and check the
    visible Unread conversations with separate owner approval.
    A numeric-count request is kept distinct from reading chat text.
    Never silently target WhatsApp Web.
*/
export type DesktopWhatsAppWorkflow = 'count' | 'senders' | null;

export function desktopWhatsAppWorkflow(text: string): DesktopWhatsAppWorkflow {
  const t = text.trim().toLowerCase();
  if (!/\b(?:whats\s?app|wa)\b/.test(t)) return null;
  const explicitWeb = /\b(?:whatsapp\s+web|web\s+whatsapp)\b/.test(t);
  if (explicitWeb && !/\b(?:personal|desktop|installed|windows\s+app)\b/.test(t)) return null;
  const opening = /\b(?:open|kholo|khol|kholen|start|launch|chalao)\b/.test(t) ||
    /\bdesktop\s+(?:on|in)\s+(?:my\s+)?laptop\b/.test(t) ||
    (/\bdesktop\b/.test(t) && /\b(?:check|dekho|dekh|dakho)\b/.test(t));
  const reviewing = /\b(?:check|dekho|dekh|dakho|parho|read|batao|dikhao)\b/.test(t);
  const messages = /\b(?:msgs?|messages?|chats?|unread)\b/.test(t);
  if (!opening || !reviewing || !messages) return null;
  if (/\b(?:kitne|kitni|count|how\s+many|number|total)\b/.test(t)) return 'count';
  return 'senders';
}


/** Parse an explicitly requested *named* WhatsApp message read.

    This is deliberately narrower than a generic "check WhatsApp" request.
    Names are exact, never guessed from message contents or conversations.
    It works without Gemini; execution still needs owner approval per step.
*/
export function namedWhatsAppRead(input:string):string|null {
  const t=input.trim().replace(/\s+/g,' ');
  if(!/\bwhats\s?app\b/i.test(t) ||
      !/\b(?:read|parho|parh|padho|sunao|dikhao|show)\b/i.test(t) ||
      !/\b(?:msg|msgs|messages?|chats?)\b/i.test(t))return null;
  const patterns=[
    /^(?:please\s+)?([\p{L}\p{M}][\p{L}\p{M}0-9 .'+-]{0,59})\s+(?:ka|ke|ki|se|from)\s+whats\s?app\s+(?:ke\s+)?(?:msg|msgs|messages?|chats?)\s+(?:read|parho|parh|padho|sunao|dikhao|show)(?:\s+karo)?$/iu,
    /^whats\s?app\s+(?:par|pe|mein|me)\s+([\p{L}\p{M}][\p{L}\p{M}0-9 .'+-]{0,59})\s+(?:ka|ke|ki)\s+(?:msg|msgs|messages?|chats?)\s+(?:read|parho|parh|padho|sunao|dikhao|show)(?:\s+karo)?$/iu,
  ];
  for(const re of patterns){
    const match=t.match(re);
    if(match){
      const contact=match[1].trim();
      if(contact && !/^(?:selected|current|all|sab|koi|kis|whatsapp|web)$/i.test(contact))
        return contact;
    }
  }
  return null;
}

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
  if(desktopWhatsAppWorkflow(t))return 'plan';
  if(namedWhatsAppRead(t))return 'plan';
  // Mailboxes have account-specific identities: don't silently treat "send
  // email" as a harmless web.open or guess which Chrome profile is logged in.
  if(/\b(?:gmail|email|e-mail|inbox|outlook mail|mailbox)\b/i.test(t) &&
     /\b(?:draft|compose|likho|send|bhejo|reply|check|read|parho|khol|kholo|open)\b/i.test(t))
    return 'plan';
  if(WORKFLOWS.test(t))return 'plan';
  // A named WhatsApp chat requires verified selection BEFORE reading.
  // Generic "message" parsing must not downgrade this to unread-count check.
  if(/\b(?:whatsapp|wa|msgs?|messages?|chats?)\b/i.test(t) &&
      /\b(?:read|parho|parh|padho|batao|dikhao|sunao)\b/i.test(t) &&
      /\b(?:ka|ki|ke|from|of)\b/i.test(t) &&
      !/\b(?:kitne|count|number|unread count)\b/i.test(t))return 'plan';
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
