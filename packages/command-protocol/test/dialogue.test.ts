import { describe, expect, it } from 'vitest';
import {
  beginDialogue, dialogueChoices, parseCommand, resolveDialogue, type DialogueState,
} from '../src/index';

const contacts = [{ name: 'Ali', phone: '923001234567' }, { name: 'Sara', phone: '923221234567' }];
const state = (topic: DialogueState['topic'], extra: Partial<DialogueState> = {}): DialogueState =>
  ({ topic, expiresAt: Date.now() + 120_000, ...extra });
const answer = (topic: DialogueState['topic'], text: string, extra: Partial<DialogueState> = {}) => {
  const x = resolveDialogue(state(topic, extra), text, contacts);
  if (!x.handled) throw new Error('not handled: ' + topic + ' -> ' + text);
  return x;
};

describe('dialogue intents: ask only when information is missing', () => {
  for (const [text, topic] of [
    ['YouTube kholo', 'youtube-choice'],
    ['YouTube par video play karo', 'youtube-query'],
    ['App kholo', 'which-app'],
    ['Folder kholo', 'which-folder'],
    ['Website kholo', 'which-website'],
    ['File kholo', 'which-file'],
    ['File dhoondo', 'which-file'],
    ['Search karo', 'search-what'],
    ['Message bhejo', 'message-contact'],
    ['Ali ko message bhejo', 'message-body'],
  ] as const) it(text, () => expect(parseCommand(text)).toMatchObject({ kind: 'clarify', topic }));

  for (const [text, action] of [
    ['Notepad kholo', 'app.open'],
    ['Chrome kholo', 'app.open'],
    ['Downloads folder kholo', 'folder.open'],
    ['Laptop ka status batao', 'device.status'],
    ['Browser mein gold forecast search karo', 'web.search'],
    ['YouTube par gold analysis play karo', 'youtube.play'],
    ['WhatsApp Desktop kholo', 'whatsapp.open'],
    ['WhatsApp kholo', 'whatsapp.open'],
  ] as const) it('clear instruction does not ask: ' + text, () =>
    expect(parseCommand(text)).toMatchObject({ kind: 'command', action }));
});

describe('contextual follow-up', () => {
  it('opens installed WhatsApp only for the chosen option', () => {
    expect(answer('whatsapp-choice', 'Desktop wala')).toMatchObject({
      result: { kind: 'command', action: 'whatsapp.open', args: { mode: 'desktop' } },
    });
    expect(answer('whatsapp-choice', 'Web wala')).toMatchObject({
      result: { kind: 'command', action: 'web.open', args: { url: 'https://web.whatsapp.com/' } },
    });
    expect(answer('whatsapp-choice', 'dono')).toMatchObject({
      result: { kind: 'clarify', topic: 'whatsapp-choice' },
    });
  });

  it('offers YouTube home, video search, and play', () => {
    expect(answer('youtube-choice', 'Home')).toMatchObject({
      result: { action: 'web.open', args: { url: 'https://www.youtube.com/' } },
    });
    expect(answer('youtube-choice', 'Video search')).toMatchObject({
      result: { kind: 'clarify', topic: 'youtube-query' },
      next: { topic: 'youtube-query', intent: 'youtube.search' },
    });
    expect(answer('youtube-choice', 'Play video')).toMatchObject({
      next: { topic: 'youtube-query', intent: 'youtube.play' },
    });
    expect(answer('youtube-query', 'Gold analysis', { intent: 'youtube.play' })).toMatchObject({
      result: { action: 'youtube.play', args: { query: 'Gold analysis' } },
    });
    expect(answer('youtube-query', 'Gold news', { intent: 'youtube.search' })).toMatchObject({
      result: { action: 'youtube.search', args: { query: 'Gold news' } },
    });
  });

  it('resolves apps, folders and websites through the allowlisted parser', () => {
    expect(answer('which-app', 'Chrome')).toMatchObject({ result: { action: 'app.open', args: { app: 'chrome' } } });
    expect(answer('which-folder', 'Downloads')).toMatchObject({ result: { action: 'folder.open', args: { folder: 'downloads' } } });
    expect(answer('which-website', 'Google')).toMatchObject({ result: { action: 'web.open', args: { url: 'https://www.google.com/' } } });
    expect(answer('which-app', 'WhatsApp')).toMatchObject({
      result: {kind:'command',action:'whatsapp.open',args:{mode:'desktop'}},
    });
    expect(answer('which-app', 'cmd.exe')).toMatchObject({ result: { kind: 'clarify' } });
  });

  it('keeps file open/search intention across an incomplete prompt', () => {
    const open = beginDialogue('which-file', 'File kholo', contacts).state!;
    const find = beginDialogue('which-file', 'File search karo', contacts).state!;
    expect(open.intent).toBe('file.open');
    expect(find.intent).toBe('file.search');
    expect(answer('which-file', 'invoice PDF', { intent: open.intent })).toMatchObject({
      result: { action: 'file.open', args: { query: 'invoice', ext: ['pdf'] } },
    });
    expect(answer('which-file', 'invoice PDF', { intent: find.intent })).toMatchObject({
      result: { action: 'file.search', args: { query: 'invoice', ext: ['pdf'] } },
    });
  });

  it('asks what to search, and rejects a vague affirmative', () => {
    expect(answer('search-what', 'Gold price forecast')).toMatchObject({
      result: { action: 'web.search', args: { query: 'Gold price forecast' } },
    });
    expect(answer('search-what', 'haan')).toMatchObject({ result: { kind: 'clarify' } });
  });

  it('asks contact and message before an approval-required WhatsApp draft', () => {
    expect(answer('message-contact', 'Ali ko')).toMatchObject({
      result: { kind: 'clarify', topic: 'message-body' },
      next: { contact: 'Ali', topic: 'message-body' },
    });
    expect(answer('message-body', 'Main 10 minute mein call karunga', { contact: 'Ali' })).toMatchObject({
      result: { kind: 'command', action: 'whatsapp.compose', args: { contact: 'Ali', message: 'Main 10 minute mein call karunga' } },
    });
    expect(answer('message-body', 'haan', { contact: 'Ali' })).toMatchObject({ result: { kind: 'clarify' } });
    expect(beginDialogue('message-body', 'Ali ko message bhejo', contacts).state).toMatchObject({
      topic: 'message-body', contact: 'Ali',
    });
    expect(beginDialogue('message-body', 'Unknown ko message bhejo', contacts).clarification).toMatchObject({
      kind: 'clarify', topic: 'contact-unknown',
    });
  });

  it('cancels a pending task and lets a fully new request override it', () => {
    expect(answer('which-file', 'Rehne do')).toMatchObject({
      result: { kind: 'reply', topic: 'conversation-cancelled' },
    });
    expect(resolveDialogue(state('search-what'), 'message bhejo', contacts)).toMatchObject({ handled: false });
    expect(resolveDialogue(state('message-contact'), 'Chrome kholo', contacts)).toMatchObject({ handled: false });
    expect(resolveDialogue(state('whatsapp-choice'), 'Notepad kholo', contacts)).toMatchObject({ handled: false });
    expect(resolveDialogue(state('youtube-choice'), 'Whatsapp per msg dakho kis ka aya howa ha', contacts))
      .toMatchObject({ handled: false });
  });

  it('has safe quick replies without ever suggesting a Send action', () => {
    expect(dialogueChoices('youtube-choice').map((x) => x.label)).toContain('Play Video');
    expect(dialogueChoices('message-body')).toEqual([]);
  });
});
