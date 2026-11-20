import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ackMessage,
  clarifyMessage,
  failureMessage,
  parseCommand,
  pick,
  replyMessage,
  STATUS_MESSAGES,
  successMessage,
  unsupportedMessage,
} from '../../../../packages/command-protocol/src/index';
import {
  DEFAULT_SETTINGS,
  FINAL_STATUSES,
  type ActionName,
  type Automation,
  type Command,
  type CommandSource,
  type Device,
  type Localized,
  type UserSettings,
} from '../../../../packages/shared-types/src/index';
import { api, ApiError, del, get, patch, post, put, uid } from './api';
import { Realtime, type RealtimeState } from './realtime';
import { listVoices, pickVoice, speak, stopSpeaking, textForVoice } from './voice';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export type ChatMessage =
  | { id: string; kind: 'user'; text: string; source: CommandSource; at: string; aiChat?: boolean }
  | { id: string; kind: 'agent'; msg: Localized; at: string; tone?: 'info' | 'ok' | 'warn' | 'bad'; provider?: 'gemini' }
  | { id: string; kind: 'command'; commandId: string; at: string };

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: 'info' | 'ok' | 'warn' | 'bad';
}

export type BrainState = 'idle' | 'listening' | 'processing' | 'executing' | 'success' | 'error' | 'offline';

type AuthState = 'loading' | 'setup' | 'login' | 'ready';

interface Store {
  auth: AuthState;
  user: User | null;
  settings: UserSettings;
  devices: Device[];
  commands: Command[];
  commandMap: Map<string, Command>;
  approvals: Command[];
  automations: Automation[];
  chat: ChatMessage[];
  toasts: Toast[];
  realtime: RealtimeState;
  brain: BrainState;
  listening: boolean;
  speaking: boolean;
  audioLevel: number;
  submitting: boolean;
  pendingWhatsAppChoice: boolean;
  pendingDialogueTopic: string | null;
  activeDevice: Device | null;
  // actions
  setup(email: string, name: string, password: string, setupCode: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  runText(text: string, source?: CommandSource): Promise<void>;
  runAction(action: ActionName, args: Record<string, unknown>, opts?: { source?: CommandSource; label?: string; silent?: boolean }): Promise<Command | null>;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  saveSettings(p: Partial<UserSettings>): Promise<void>;
  setDevices(d: Device[]): void;
  setAutomations(a: Automation[]): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;
  clearChat(): void;
  setListening(v: boolean): void;
  setAudioLevel(v: number): void;
  say(m: Localized, force?: boolean): void;
  loadMoreCommands(): Promise<boolean>;
  setUser(u: User): void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
};

const CHAT_KEY = 'hukm.chat.v1';
function loadChat(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<Device[]>([]);
  const [commandMap, setCommandMap] = useState<Map<string, Command>>(new Map());
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>(loadChat);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [realtime, setRealtime] = useState<RealtimeState>('closed');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingWhatsAppChoice, setPendingWhatsAppChoice] = useState(false);
  const [pendingDialogueTopic, setPendingDialogueTopic] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ state: 'success' | 'error'; until: number } | null>(null);
  const rt = useRef<Realtime | null>(null);
  const announced = useRef<Set<string>>(new Set());
  const ownCommands = useRef<Set<string>>(new Set());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const voices = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    let active = true;
    const sync = () => { if (active && 'speechSynthesis' in window) voices.current = speechSynthesis.getVoices(); };
    void listVoices().then((v) => { if (active) voices.current = v; });
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', sync);
    return () => {
      active = false;
      if ('speechSynthesis' in window) speechSynthesis.removeEventListener('voiceschanged', sync);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-150)));
  }, [chat]);

  // theme & motion
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'light' ? '#EEF4FC' : '#081526');
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion === 'on');
  }, [settings.theme, settings.reducedMotion]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    if (!settingsRef.current.notifications.toasts && t.tone !== 'bad') return;
    const id = uid();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'bad' ? 7000 : 4500);
    if (settingsRef.current.notifications.browser && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(t.title, { body: t.body, icon: '/icons/icon-192.png' });
      } catch {
        /* some mobile browsers only allow SW notifications */
      }
    }
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  const lastVoiceWarning = useRef(0);
  const say = useCallback((m: Localized, force = false) => {
    const s = settingsRef.current;
    if (s.speechMuted && !force) return;
    const voice = pickVoice(voices.current, s.voiceURI, s.responseLang);
    // Default (Automatic) uses Pakistani Urdu female Uzma via our private relay.
    // The cloud service is free/unofficial and can be rate-limited. If it fails
    // or takes too long, the browser immediately uses an available local voice.
    // Selecting a device voice opts out of the experimental cloud synthesis.
    const cloudUrdu = !s.voiceURI && s.responseLang !== 'en' ? m.ur : undefined;
    speak(
      textForVoice(m, voice, s.responseLang), voice, s.speechRate, s.speechVolume,
      setSpeaking, cloudUrdu,
      () => {
        if (Date.now() - lastVoiceWarning.current < 60_000) return;
        lastVoiceWarning.current = Date.now();
        toast({
          title: 'Uzma online voice unavailable',
          body: 'Device ki female voice par switch kar diya hai.',
          tone: 'warn',
        });
      },
    );
  }, [toast]);

  const addChat = useCallback((m: ChatMessage) => setChat((c) => [...c, m]), []);
  const agent = useCallback(
    (msg: Localized, tone: 'info' | 'ok' | 'warn' | 'bad' = 'info', speakIt = true, provider?: 'gemini') => {
      addChat({ id: uid(), kind: 'agent', msg, at: new Date().toISOString(), tone, provider });
      if (speakIt) say(msg);
    },
    [addChat, say],
  );

  // Commands can be updated by WebSocket pushes and HTTP responses in any order (a fast laptop may finish
  // before the POST returns). Never let an older lifecycle state overwrite a newer one.
  const latest = useRef<Map<string, Command>>(new Map());
  const rank = (s: Command['status']) => (FINAL_STATUSES.includes(s) ? 2 : s === 'running' ? 1 : 0);
  const mergeOne = useCallback((c: Command): Command => {
    const prev = latest.current.get(c.id);
    if (prev && rank(prev.status) > rank(c.status)) return prev;
    latest.current.set(c.id, c);
    return c;
  }, []);
  const upsertMany = useCallback((cs: Command[]) => {
    const merged = cs.map(mergeOne);
    setCommandMap((m) => {
      const n = new Map(m);
      for (const c of merged) n.set(c.id, c);
      return n;
    });
    return merged;
  }, [mergeOne]);
  const upsertCommand = useCallback((c: Command): Command => upsertMany([c])[0], [upsertMany]);

  // announce final results of commands issued from this tab
  const announce = useCallback(
    (c: Command) => {
      if (!ownCommands.current.has(c.id) || announced.current.has(c.id)) return;
      if (!FINAL_STATUSES.includes(c.status)) return;
      announced.current.add(c.id);
      const lang = settingsRef.current.responseLang;
      if (c.status === 'completed') {
        const m = successMessage(c.action, c.args, c.result);
        agent(m, c.result?.ambiguous || c.result?.windowDetected === false || c.result?.mode === 'search' && c.action === 'youtube.play' ? 'warn' : 'ok');
        setFlash({ state: 'success', until: Date.now() + 2200 });
      } else if (c.status === 'failed') {
        const m = failureMessage(c.error);
        agent(m, 'bad');
        toast({ title: 'Command failed', body: pick(m, lang === 'ur' ? 'en' : lang), tone: 'bad' });
        setFlash({ state: 'error', until: Date.now() + 2600 });
      } else if (c.status === 'timed_out') {
        agent(c.error?.code === 'DEVICE_OFFLINE' ? failureMessage(c.error) : STATUS_MESSAGES.timedOut, 'warn');
        setFlash({ state: 'error', until: Date.now() + 2600 });
      } else if (c.status === 'cancelled') {
        agent(c.error?.code === 'REJECTED' ? STATUS_MESSAGES.rejected : STATUS_MESSAGES.cancelled, 'info');
      }
    },
    [agent, toast],
  );

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), Math.max(0, flash.until - Date.now()));
    return () => clearTimeout(t);
  }, [flash]);

  const refresh = useCallback(async () => {
    const [s, d, c, a] = await Promise.all([
      get<UserSettings>('/api/settings'),
      get<Device[]>('/api/devices'),
      get<Command[]>('/api/commands?limit=60'),
      get<Automation[]>('/api/automations'),
    ]);
    setSettings(s);
    setDevices(d);
    upsertMany(c);
    setAutomations(a);
  }, [upsertMany]);

  // bootstrap auth
  useEffect(() => {
    get<{ setupRequired: boolean; user: User | null }>('/api/auth/status')
      .then((s) => {
        if (s.setupRequired) setAuth('setup');
        else if (s.user) {
          setUser(s.user);
          setAuth('ready');
        } else setAuth('login');
      })
      .catch(() => setAuth('login'));
  }, []);

  // realtime when signed in
  useEffect(() => {
    if (auth !== 'ready') return;
    refresh().catch((e) => {
      if (e instanceof ApiError && e.status === 401) setAuth('login');
    });
    const r = new Realtime();
    rt.current = r;
    const offState = r.onState((s) => {
      setRealtime(s);
      if (s === 'open') refresh().catch(() => {});
    });
    const off = r.on((m) => {
      switch (m.type) {
        case 'command.updated':
          upsertCommand(m.command);
          announce(m.command);
          break;
        case 'device.updated':
          setDevices((ds) => {
            const i = ds.findIndex((d) => d.id === m.device.id);
            if (i < 0) return [...ds, m.device];
            const prev = ds[i];
            if (prev.online !== m.device.online)
              toast({ title: `${m.device.name} is ${m.device.online ? 'online' : 'offline'}`, tone: m.device.online ? 'ok' : 'warn' });
            const n = ds.slice();
            n[i] = m.device;
            return n;
          });
          break;
        case 'device.removed':
          setDevices((ds) => ds.filter((d) => d.id !== m.deviceId));
          break;
        case 'automation.updated':
          setAutomations((as) => {
            const i = as.findIndex((a) => a.id === m.automation.id);
            if (i < 0) return [...as, m.automation];
            const n = as.slice();
            n[i] = m.automation;
            return n;
          });
          break;
        case 'settings.updated':
          setSettings(m.settings);
          break;
      }
    });
    r.start();
    return () => {
      off();
      offState();
      r.stop();
    };
  }, [auth, refresh, upsertCommand, announce, toast]);

  const commands = useMemo(() => [...commandMap.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [commandMap]);
  const approvals = useMemo(() => commands.filter((c) => c.status === 'awaiting_approval'), [commands]);
  const activeDevice = useMemo(() => devices.find((d) => d.online) ?? devices[0] ?? null, [devices]);

  const handleCreated = useCallback(
    (out: any, opts: { silentAck?: boolean } = {}): Command | null => {
      if (out.kind === 'command') {
        setPendingDialogueTopic(null);
        setPendingWhatsAppChoice(false);
        ownCommands.current.add(out.command.id);
        const c: Command = upsertCommand(out.command);
        if (!out.duplicate) addChat({ id: uid(), kind: 'command', commandId: c.id, at: new Date().toISOString() });
        if (c.status === 'awaiting_approval') agent(STATUS_MESSAGES.awaitingApproval, 'warn');
        else if (c.status === 'pending' && c.deviceId && !devices.find((d) => d.id === c.deviceId)?.online) agent(STATUS_MESSAGES.queuedOffline, 'warn');
        else if (!opts.silentAck && c.status === 'pending' && c.action !== 'command.cancel') {
          /* ack already spoken optimistically */
        }
        announce(c);
        return c;
      }
      if (out.kind === 'reply') {
        setPendingDialogueTopic(null);
        setPendingWhatsAppChoice(false);
        agent(replyMessage(out.topic));
      } else if (out.kind === 'clarify') {
        setPendingDialogueTopic(out.topic);
        setPendingWhatsAppChoice(out.topic === 'whatsapp-choice');
        agent(clarifyMessage(out.topic), 'info');
      } else if (out.kind === 'unsupported') {
        setPendingDialogueTopic(null);
        setPendingWhatsAppChoice(false);
        agent(unsupportedMessage(out.reason), 'warn');
      }
      return null;
    },
    [addChat, agent, announce, devices, upsertCommand],
  );

  const runText = useCallback(
    async (text: string, source: CommandSource = 'text') => {
      const t = text.trim();
      if (!t || submitting) return;
      // Gemini is chat-only. A normal message does not require the laptop to
      // be connected, and no command/device data is automatically sent to Google.
      const local = parseCommand(t);
      const maybeAi = !pendingDialogueTopic && (local.kind === 'unsupported' || local.kind === 'reply');
      const history = chat
        .filter((m) => (m.kind === 'user' && m.aiChat) || (m.kind === 'agent' && m.provider === 'gemini'))
        .slice(-10)
        .map((m) => m.kind === 'user'
          ? { role: 'user' as const, text: m.text.slice(0, 700) }
          : { role: 'assistant' as const, text: pick(m.msg, 'roman').slice(0, 700) });
      addChat({ id: uid(), kind: 'user', text: t, source, at: new Date().toISOString(), aiChat: maybeAi });
      // Immediate acknowledgement only for a known laptop action.
      const hasDevice = devices.length > 0;
      // For a conversational follow-up the server may select a different
      // action than the local parser, so speak only the server's actual action.
      const inDialogue = !!pendingDialogueTopic;
      if (local.kind === 'command' && local.action !== 'command.cancel' && hasDevice && !inDialogue)
        agent(ackMessage(local.action, local.args), 'info');
      if (local.kind === 'command' && !hasDevice && local.action !== 'command.cancel' && !inDialogue) {
        agent(STATUS_MESSAGES.noDevice, 'warn');
        return;
      }
      setSubmitting(true);
      try {
        const out = await post('/api/commands', { text: t, source, clientRequestId: uid(), deviceId: activeDevice?.id });
        // A one-word follow-up ("Desktop wala") is resolved on the relay,
        // so it has no optimistic local parser acknowledgement.
        if (out.kind === 'command' && (local.kind !== 'command' || inDialogue))
          agent(ackMessage(out.command.action, out.command.args), 'info');
        if (out.kind === 'unsupported' || out.kind === 'reply') {
          // A private message-only AI call, never a tool invocation.
          // No cloud AI connection is needed for laptop actions themselves.
          try {
            const ai = await post<{ kind: 'ai'; provider: 'gemini'; reply: string }>(
              '/api/ai/chat', { message: t, history },
            );
            const msg: Localized = { roman: ai.reply, ur: ai.reply, en: ai.reply };
            agent(msg, 'info', source === 'voice', 'gemini');
          } catch (aiError) {
            if (aiError instanceof ApiError && aiError.code === 'AI_NOT_CONFIGURED') {
              // Offline or unconfigured installations keep their old reply.
              handleCreated(out, { silentAck: true });
            } else {
              const message = aiError instanceof Error ? aiError.message : 'Gemini is unavailable.';
              agent({ roman: message, ur: message, en: message }, 'warn', source === 'voice');
            }
          }
        } else {
          handleCreated(out, { silentAck: true });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        agent({ roman: `Masla: ${msg}`, ur: `مسئلہ: ${msg}`, en: `Problem: ${msg}` }, 'bad');
        setFlash({ state: 'error', until: Date.now() + 2500 });
      } finally {
        setSubmitting(false);
      }
    },
    [activeDevice, addChat, agent, chat, devices.length, handleCreated, pendingDialogueTopic, submitting],
  );

  const runAction = useCallback(
    async (action: ActionName, args: Record<string, unknown>, opts: { source?: CommandSource; label?: string; silent?: boolean } = {}) => {
      if (!opts.silent) {
        if (opts.label) addChat({ id: uid(), kind: 'user', text: opts.label, source: opts.source ?? 'ui', at: new Date().toISOString() });
        agent(ackMessage(action, args), 'info');
      }
      setSubmitting(true);
      try {
        const out = await post('/api/commands', { action, args, source: opts.source ?? 'ui', clientRequestId: uid(), deviceId: activeDevice?.id });
        if (opts.silent && out.kind === 'command') return upsertCommand(out.command);
        return handleCreated(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({ title: 'Could not send command', body: msg, tone: 'bad' });
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [activeDevice, addChat, agent, handleCreated, toast, upsertCommand],
  );

  const approve = useCallback(async (id: string) => {
    ownCommands.current.add(id);
    upsertCommand(await post<Command>(`/api/commands/${id}/approve`));
  }, [upsertCommand]);
  const reject = useCallback(async (id: string) => {
    ownCommands.current.add(id);
    upsertCommand(await post<Command>(`/api/commands/${id}/reject`));
  }, [upsertCommand]);
  const cancel = useCallback(async (id: string) => {
    upsertCommand(await post<Command>(`/api/commands/${id}/cancel`));
  }, [upsertCommand]);

  const saveSettings = useCallback(async (p: Partial<UserSettings>) => {
    setSettings((s) => ({ ...s, ...p }));
    try {
      setSettings(await put<UserSettings>('/api/settings', p));
    } catch (e) {
      toast({ title: 'Settings not saved', body: (e as Error).message, tone: 'bad' });
    }
  }, [toast]);

  const loadMoreCommands = useCallback(async () => {
    const oldest = commands[commands.length - 1];
    const more = await get<Command[]>(`/api/commands?limit=50${oldest ? `&before=${encodeURIComponent(oldest.createdAt)}` : ''}`);
    upsertMany(more);
    return more.length === 50;
  }, [commands, upsertMany]);

  const setup = useCallback(async (email: string, name: string, password: string, setupCode: string) => {
    const r = await post<{ user: User }>('/api/auth/setup', { email, name, password, setupCode });
    setUser(r.user);
    setAuth('ready');
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/login', { email, password });
    setUser(r.user);
    setAuth('ready');
  }, []);
  const logout = useCallback(async () => {
    stopSpeaking();
    try {
      await post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setUser(null);
    setPendingWhatsAppChoice(false);
    setPendingDialogueTopic(null);
    setDevices([]);
    latest.current = new Map();
    setCommandMap(new Map());
    setAuth('login');
  }, []);

  const brain: BrainState = useMemo(() => {
    if (listening) return 'listening';
    if (commands.some((c) => c.status === 'running')) return 'executing';
    if (submitting || commands.some((c) => c.status === 'pending' && c.dispatchedAt)) return 'processing';
    if (flash) return flash.state;
    if (!devices.some((d) => d.online)) return 'offline';
    return 'idle';
  }, [listening, commands, submitting, flash, devices]);

  const value: Store = {
    auth, user, settings, devices, commands, commandMap, approvals, automations, chat, toasts, realtime, brain, listening, speaking,
    audioLevel, submitting, pendingWhatsAppChoice, pendingDialogueTopic, activeDevice,
    setup, login, logout, refresh, runText, runAction, approve, reject, cancel, saveSettings, setDevices, setAutomations, toast,
    dismissToast, clearChat: () => { setChat([]); setPendingWhatsAppChoice(false); setPendingDialogueTopic(null); }, setListening, setAudioLevel, say, loadMoreCommands, setUser,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { api, del, get, patch, post, put };
