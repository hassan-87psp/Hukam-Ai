import type { ActionName, WhatsAppContact } from '../../shared-types/src/index';
import { normalize } from './normalize';
import { parseCommand, parseWhatsAppChoice, type ParseResult } from './parser';

/** A time-limited conversational slot stored in relay memory, scoped to account.
 * No user text or contacts are persisted as a new conversation database. */
export type DialogueTopic =
  | 'whatsapp-choice' | 'youtube-choice' | 'youtube-query'
  | 'which-file' | 'which-folder' | 'which-app' | 'which-website'
  | 'search-what' | 'message-contact' | 'message-body';

export interface DialogueState {
  topic: DialogueTopic;
  expiresAt: number;
  intent?: 'file.open' | 'file.search' | 'youtube.play' | 'youtube.search';
  contact?: string;
}

export type DialogueResolution =
  | { handled: false }
  | { handled: true; result: ParseResult; next?: Omit<DialogueState, 'expiresAt'> };

const command = (action: ActionName, args: Record<string, unknown>, normalized: string): ParseResult =>
  ({ kind: 'command', action, args, normalized, matchedRule: 'dialogue-followup' });
const question = (topic: string, normalized: string): ParseResult =>
  ({ kind: 'clarify', topic, normalized });
const isCancel = (t: string): boolean =>
  /^(?:cancel|rehne do|rehnay do|choro|chor do|chhod do|nahi|nahin|no|never mind|stop|bas|skip|forget it)$/.test(t);
const isShort = (t: string) => t.trim().length <= 90;

const bodyPrefix = /^(?:(?:message|msg|text)\s+)?(?:likho|likh do|keh do|ke|that|saying|:)\s+/i;
const textOnly = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 450);

export function findSavedContact(value: string, contacts: readonly WhatsAppContact[]): WhatsAppContact | null {
  const name = normalize(value)
    .replace(/^(?:whatsapp\s+)?(?:contact\s+)?/, '')
    .replace(/\s+(?:ko|wala|wali)$/, '').trim();
  return contacts.find((c) => normalize(c.name) === name) ?? null;
}

/** For "Ali ko message bhejo", keep the recipient and ask only for content. */
function recipientFromInitial(text: string): string | null {
  const t = normalize(text);
  const a = t.match(/^(?:whatsapp\s+)?(.{1,45}?)\s+ko\s+(?:whatsapp\s+)?(?:message|msg|text|reply)\s+(?:bhejo|likho|send|karo|kar do|do|karna|bhejna)$/);
  const b = t.match(/^(?:send|write|draft)\s+(?:a\s+)?(?:whatsapp\s+)?(?:message|msg|text)\s+to\s+(.{1,45})$/);
  const value = (a?.[1] ?? b?.[1] ?? '').trim();
  return value && value.split(' ').length <= 4 ? value : null;
}

export function beginDialogue(topic: string, input: string, contacts: readonly WhatsAppContact[], now = Date.now()):
  { state: DialogueState | null; clarification?: Extract<ParseResult, { kind: 'clarify' }> } {
  const expiry = now + 2 * 60_000;
  const allowed: DialogueTopic[] = [
    'whatsapp-choice', 'youtube-choice', 'youtube-query', 'which-file', 'which-folder',
    'which-app', 'which-website', 'search-what', 'message-contact', 'message-body',
  ];
  if (!allowed.includes(topic as DialogueTopic)) return { state: null };
  const result: DialogueState = { topic: topic as DialogueTopic, expiresAt: expiry };
  if (topic === 'which-file')
    result.intent = /\b(kholo|khol|open|launch)\b/.test(normalize(input)) ? 'file.open' : 'file.search';
  if (topic === 'youtube-query')
    result.intent = /\b(play|chalao|lagao|bajao)\b/.test(normalize(input)) ? 'youtube.play' : 'youtube.search';
  if (topic === 'message-body') {
    const wanted = recipientFromInitial(input);
    const saved = wanted && findSavedContact(wanted, contacts);
    if (!saved) return {
      state: null,
      clarification: { kind: 'clarify', topic: 'contact-unknown', normalized: normalize(input) },
    };
    result.contact = saved.name;
  }
  return { state: result };
}

/** Resolve only the missing slots. Complete new commands override old questions.
 * Arbitrary speech cannot become a shell command, an arbitrary app or a sent message.
 * Message bodies prepare a DRAFT and retain the existing explicit approval gate. */
export function resolveDialogue(
  state: DialogueState,
  raw: string,
  contacts: readonly WhatsAppContact[],
): DialogueResolution {
  const text = textOnly(raw);
  const t = normalize(text);
  if (!t) return { handled: true, result: question(state.topic, t), next: state };
  if (isCancel(t)) return {
    handled: true,
    result: { kind: 'reply', topic: state.topic === 'whatsapp-choice' ? 'whatsapp-cancelled' : 'conversation-cancelled', normalized: t },
  };
  const parsed = parseCommand(text);
  // A fresh incomplete question also supersedes the older conversation.
  // Example: after "search karo", "message bhejo" must ask who, not
  // accidentally search the phrase "message bhejo".
  if (parsed.kind === 'clarify' && parsed.topic !== state.topic &&
      !(state.topic === 'which-app' && parsed.topic === 'whatsapp-choice') &&
      parsed.topic !== 'empty' && parsed.topic !== 'contact-unknown')
    return { handled: false };
  const fullNewAction = parsed.kind === 'command'
    && /\b(kholo|khol|open|launch|search|dhoondo|find|play|chalao|lock|check|band|send|bhejo|likho)\b/.test(t);

  if (state.topic === 'whatsapp-choice') {
    const choice = parseWhatsAppChoice(text);
    const shortChoice = /^(?:(?:whatsapp\s+)?(?:desktop|web|browser|chrome|app|installed|online|laptop|pc)(?:\s+(?:wala|wali|wale))?|[12]|(?:pehla|pahla|first|doosra|dosra|dusra|second)(?:\s+wala)?)$/.test(t);
    if (choice && choice !== 'cancel' && (shortChoice || !fullNewAction)) {
      return { handled: true, result: choice === 'web'
        ? command('web.open', { url: 'https://web.whatsapp.com/' }, t)
        : command('whatsapp.open', { mode: 'desktop' }, t) };
    }
    if (fullNewAction) return { handled: false };
    return { handled: true, result: question('whatsapp-choice', t), next: state };
  }

  if (state.topic === 'youtube-choice') {
    if (/^(home|homepage|home page|main|main page|sirf youtube|youtube home|1|pehla|pahla|first)$/.test(t))
      return { handled: true, result: command('web.open', { url: 'https://www.youtube.com/' }, t) };
    if (/^(?:search|search video|video search|videos search|video dhoondo|koi video|video|2|doosra|dusra|second)$/.test(t))
      return { handled: true, result: question('youtube-query', t),
        next: { topic: 'youtube-query', intent: 'youtube.search' } };
    if (/^(?:play|video play|play video|video chalao|gaana chalao|song play|3|teesra|third)$/.test(t))
      return { handled: true, result: question('youtube-query', t),
        next: { topic: 'youtube-query', intent: 'youtube.play' } };
    // A fresh recognised command must supersede this old YouTube question.
    // Otherwise phrases such as 'WhatsApp per msg dakho' repeat the YouTube prompt.
    if (parsed.kind === 'command' && parsed.action !== 'youtube.play' && parsed.action !== 'youtube.search')
      return { handled: false };
    if (fullNewAction) return { handled: false };
    return { handled: true, result: question('youtube-choice', t), next: state };
  }

  if (state.topic === 'which-app') {
    if (parsed.kind === 'command' && parsed.action === 'app.open')
      return { handled: true, result: parsed };
    if (parsed.kind === 'clarify' && parsed.topic === 'whatsapp-choice')
      return { handled: true, result: parsed, next: { topic: 'whatsapp-choice' } };
    if (fullNewAction) return { handled: false };
    return { handled: true, result: question('which-app', t), next: state };
  }

  if (state.topic === 'which-folder') {
    if (parsed.kind === 'command' && parsed.action === 'folder.open')
      return { handled: true, result: parsed };
    const asFolder = parseCommand('folder kholo ' + text);
    if (asFolder.kind === 'command' && asFolder.action === 'folder.open')
      return { handled: true, result: asFolder };
    if (fullNewAction) return { handled: false };
    return { handled: true, result: question('which-folder', t), next: state };
  }

  if (state.topic === 'which-website') {
    if (parsed.kind === 'command' && parsed.action === 'web.open')
      return { handled: true, result: parsed };
    if (parsed.kind === 'clarify' && parsed.topic === 'youtube-choice')
      return { handled: true, result: parsed, next: { topic: 'youtube-choice' } };
    const site = parseCommand(text + ' kholo');
    if (site.kind === 'command' && site.action === 'web.open')
      return { handled: true, result: site };
    if (fullNewAction) return { handled: false };
    return { handled: true, result: question('which-website', t), next: state };
  }

  if (state.topic === 'message-contact') {
    const contact = findSavedContact(text, contacts);
    if (contact)
      return { handled: true, result: question('message-body', t),
        next: { topic: 'message-body', contact: contact.name } };
    if (fullNewAction) return { handled: false };
    if (isShort(t)) return { handled: true, result: {
      kind: 'clarify', topic: 'contact-unknown', normalized: t,
    }, next: state };
    return { handled: true, result: question('message-contact', t), next: state };
  }

  if (state.topic === 'message-body') {
    if (fullNewAction && !bodyPrefix.test(text)) return { handled: false };
    const message = text.replace(bodyPrefix, '').trim();
    if (!message || message.length > 900 || /^(?:haan|yes|ok|okay|theek|theek hai)$/.test(t))
      return { handled: true, result: question('message-body', t), next: state };
    if (!state.contact || !findSavedContact(state.contact, contacts))
      return { handled: true, result: question('contact-unknown', t) };
    return { handled: true,
      result: command('whatsapp.compose', { contact: state.contact, message }, t) };
  }

  if (state.topic === 'which-file') {
    if (fullNewAction && !(parsed.kind === 'command' && (parsed.action === 'file.open' || parsed.action === 'file.search')))
      return { handled: false };
    const verb = state.intent === 'file.open' ? 'file kholo ' : 'file dhoondo ';
    const candidate = parseCommand(verb + text);
    if (candidate.kind === 'command' && (candidate.action === 'file.open' || candidate.action === 'file.search')) {
      return { handled: true, result: { ...candidate, action: state.intent === 'file.open' ? 'file.open' : 'file.search' } };
    }
    return { handled: true, result: question('which-file', t), next: state };
  }

  if (state.topic === 'search-what') {
    if (fullNewAction) return { handled: false };
    if (text.length < 2 || text.length > 200 || /^(?:haan|yes|okay|ok)$/.test(t))
      return { handled: true, result: question('search-what', t), next: state };
    return { handled: true, result: command('web.search', { query: text }, t) };
  }

  if (state.topic === 'youtube-query') {
    if (fullNewAction && parsed.kind === 'command' && parsed.action !== 'youtube.play' && parsed.action !== 'youtube.search')
      return { handled: false };
    const q = parseCommand('YouTube par ' + text);
    if (q.kind === 'command' && (q.action === 'youtube.play' || q.action === 'youtube.search')) {
      const intent = /\b(play|chalao|lagao|bajao)\b/.test(t) ? 'youtube.play' : (state.intent ?? 'youtube.search');
      return { handled: true, result: { ...q, action: intent } };
    }
    return { handled: true, result: question('youtube-query', t), next: state };
  }

  return { handled: false };
}

/** Safe quick-response suggestions rendered only while a question is pending. */
export function dialogueChoices(topic: string): { label: string; value: string }[] {
  switch (topic) {
    case 'whatsapp-choice': return [{ label: 'Desktop App', value: 'Desktop wala' }, { label: 'WhatsApp Web', value: 'Web wala' }];
    case 'youtube-choice': return [
      { label: 'YouTube Home', value: 'Home' }, { label: 'Search Video', value: 'Video search' }, { label: 'Play Video', value: 'Play video' }];
    case 'which-app': return [{ label: 'Chrome', value: 'Chrome' }, { label: 'Notepad', value: 'Notepad' }];
    case 'which-folder': return [{ label: 'Downloads', value: 'Downloads' }, { label: 'Desktop', value: 'Desktop' }, { label: 'Documents', value: 'Documents' }];
    default: return [];
  }
}
