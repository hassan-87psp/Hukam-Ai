/** HUKM-native, static agent tool registry. No plugin discovery, shell,
 * external executable, or model-provided code. Runtime command validation
 * and existing per-action approval remain authoritative. */
import type { ActionName } from '../../../packages/shared-types/src/index';

const FAMILIES = {
  system: ['device.status', 'apps.list', 'diagnostics.probe'],
  desktop: ['app.open', 'app.close', 'window.active', 'window.focus', 'notepad.type', 'ui.inspect', 'ui.scroll'],
  files: ['folder.open', 'folder.list', 'file.search', 'file.open', 'file.reveal'],
  browser: ['web.open', 'web.search', 'youtube.search', 'youtube.play', 'browser.control', 'browser.profile_open'],
  whatsapp: ['whatsapp.open', 'whatsapp.check', 'whatsapp.unread_senders', 'whatsapp.select_chat', 'whatsapp.read_selected', 'whatsapp.draft_reply', 'whatsapp.send_reviewed', 'whatsapp.attach_preview', 'whatsapp.send_attachment_reviewed'],
  mail: ['email.inbox_open', 'email.compose_draft'],
  calendar: ['calendar.event_draft', 'calendar.save_reviewed'],
  chatgpt: ['chatgpt.prompt_draft', 'chatgpt.submit_prompt', 'chatgpt.read_response', 'chatgpt.followup_draft', 'chatgpt.download_visible'],
} as const satisfies Record<string, readonly ActionName[]>;

const supported: readonly ActionName[] = Object.freeze(Object.values(FAMILIES).flat());
const allowlist = new Set<string>(supported);

export function isAgentTool(action: unknown): action is ActionName {
  return typeof action === 'string' && allowlist.has(action);
}

export function agentToolNames(): readonly ActionName[] {
  return supported;
}

/** Generate the model catalog from precisely the server-side allowlist.
 * Never accept a catalog or tools declared by a model or project note. */
export function agentToolInstruction(): string {
  return 'Only use these precise action names: ' + supported.join(', ') + '.';
}
