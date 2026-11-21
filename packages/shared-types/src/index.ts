// Shared types used by the web app, the relay server and (mirrored in Python) the Windows controller.

export type CommandStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export const FINAL_STATUSES: CommandStatus[] = ['completed', 'failed', 'cancelled', 'timed_out'];

export type CommandSource = 'text' | 'voice' | 'quick' | 'automation' | 'ui';

export type Capability =
  | 'system'
  | 'apps'
  | 'folders'
  | 'files'
  | 'browser'
  | 'youtube'
  | 'screen'
  | 'input'
  | 'whatsapp';

export const ALL_CAPABILITIES: Capability[] = [
  'system',
  'apps',
  'folders',
  'files',
  'browser',
  'youtube',
  'screen',
  'input',
  'whatsapp',
];

export type ActionName =
  | 'app.open'
  | 'folder.open'
  | 'folder.list'
  | 'file.search'
  | 'file.open'
  | 'file.reveal'
  | 'web.open'
  | 'web.search'
  | 'youtube.search'
  | 'youtube.play'
  | 'device.status'
  | 'apps.list'
  | 'window.active'
  | 'window.focus'
  | 'screen.capture'
  | 'ui.inspect'
  | 'ui.activate'
  | 'calendar.event_draft'
  | 'chatgpt.prompt_draft'
  | 'chatgpt.submit_prompt'
  | 'chatgpt.download_visible'
  | 'whatsapp.read_selected'
  | 'whatsapp.draft_reply'
  | 'whatsapp.attach_preview'
  | 'browser.control'
  | 'browser.profile_open'
  | 'notepad.type'
  | 'system.lock'
  | 'whatsapp.open'
  | 'whatsapp.check'
  | 'whatsapp.unread_senders'
  | 'whatsapp.compose'
  | 'whatsapp.read_visible'
  | 'command.cancel';

export type Lang = 'roman' | 'ur' | 'en';

export interface Localized {
  roman: string;
  ur: string;
  en: string;
}

export interface CommandError {
  code: string;
  message: string;
}

export interface Command {
  id: string;
  deviceId: string | null;
  source: CommandSource;
  inputText: string | null;
  action: ActionName;
  args: Record<string, unknown>;
  requiresApproval: boolean;
  status: CommandStatus;
  createdAt: string;
  approvedAt: string | null;
  dispatchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  result: Record<string, unknown> | null;
  error: CommandError | null;
  automationRunId: string | null;
  screenshotId: string | null;
}

export interface Device {
  id: string;
  name: string;
  os: string | null;
  osVersion: string | null;
  hostname: string | null;
  controllerVersion: string | null;
  online: boolean;
  paused: boolean;
  status: 'paired' | 'revoked';
  lastSeen: string | null;
  createdAt: string;
  capabilitiesReported: Capability[];
  capabilitiesEnabled: Capability[];
  controllerConfig: ControllerConfigSummary | null;
  lastCommand: { action: ActionName; status: CommandStatus; at: string } | null;
  stats: { cpu?: number; memory?: number; battery?: number | null; plugged?: boolean | null } | null;
}

export interface ControllerConfigSummary {
  allowedDirs: { key: string; path: string }[];
  apps: string[];
  screenCapture: boolean;
  browser: string;
}

export interface AutomationSchedule {
  enabled: boolean;
  time: string | null; // local wall-clock HH:mm
  timezone: string; // valid IANA timezone, e.g. Asia/Kuala_Lumpur
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  steps: string[];
  enabled: boolean;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  schedule?: AutomationSchedule;
}

export interface WhatsAppContact {
  name: string;
  phone: string; // international format digits, e.g. 923001234567
}

export interface UserSettings {
  theme: 'dark' | 'light';
  responseLang: Lang;
  recognitionLang: string; // BCP-47, e.g. ur-PK
  voiceURI: string | null;
  speechRate: number;
  speechVolume: number;
  speechMuted: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  audioReactiveOrb: boolean;
  notifications: { toasts: boolean; browser: boolean };
  approvalRequired: Partial<Record<ActionName, boolean>>;
  screenshotRetentionHours: number;
  historyRetentionDays: number;
  whatsappContacts: WhatsAppContact[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  responseLang: 'roman',
  recognitionLang: 'en-PK',
  voiceURI: null,
  speechRate: 1,
  speechVolume: 1,
  speechMuted: false,
  reducedMotion: 'system',
  audioReactiveOrb: false,
  notifications: { toasts: true, browser: false },
  approvalRequired: {
    'screen.capture': true,
    'system.lock': true,
    'whatsapp.compose': true,
  },
  screenshotRetentionHours: 24,
  historyRetentionDays: 90,
  whatsappContacts: [],
};

export interface AuditEntry {
  id: string;
  actor: 'user' | 'device' | 'system';
  event: string;
  deviceId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  at: string;
}

// ---- WebSocket messages -------------------------------------------------

export type DeviceToServer =
  | {
      type: 'hello';
      controllerVersion: string;
      os: string;
      osVersion: string;
      hostname: string;
      capabilities: Capability[];
      config: ControllerConfigSummary;
    }
  | { type: 'heartbeat'; stats?: Device['stats'] }
  | { type: 'ack'; commandId: string }
  | { type: 'started'; commandId: string }
  | {
      type: 'result';
      commandId: string;
      ok: boolean;
      result?: Record<string, unknown>;
      error?: CommandError;
      durationMs?: number;
      screenshot?: { mime: string; dataBase64: string; width: number; height: number };
    };

export type ServerToDevice =
  | { type: 'welcome'; deviceId: string; paused: boolean; enabledCapabilities: Capability[] }
  | {
      type: 'command';
      command: { id: string; action: ActionName; args: Record<string, unknown>; createdAt: string; timeoutMs: number };
    }
  | { type: 'cancel'; commandId: string }
  | { type: 'result_ack'; commandId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'capabilities'; enabledCapabilities: Capability[] }
  | { type: 'revoked' }
  | { type: 'error'; code: string; message: string };

export type ServerToClient =
  | { type: 'hello'; userId: string }
  | { type: 'command.updated'; command: Command }
  | { type: 'device.updated'; device: Device }
  | { type: 'device.removed'; deviceId: string }
  | { type: 'automation.updated'; automation: Automation }
  | { type: 'settings.updated'; settings: UserSettings };
