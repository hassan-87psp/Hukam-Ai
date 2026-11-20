import { parseCommand, type ParseResult } from './parser';

/**
 * AIProvider boundary. Version 1 ships only the deterministic local engine.
 * Future providers (self-hosted model, an officially supported ChatGPT/OpenAI
 * connection, or a paid API) must return the same ParseResult shape, and their
 * output is still validated by validateCommand() — a provider can never
 * produce an action outside the ACTIONS allowlist.
 */
export interface AIProvider {
  id: string;
  label: string;
  available(): Promise<boolean>;
  interpret(text: string, context?: { lang?: string }): Promise<ParseResult>;
}

export const deterministicProvider: AIProvider = {
  id: 'deterministic',
  label: 'Local rule-based engine (no AI model)',
  available: async () => true,
  interpret: async (text) => parseCommand(text),
};

export const PROVIDER_STATUS = [
  { id: 'deterministic', label: 'Local rule-based engine', status: 'active' },
  { id: 'chatgpt-official', label: 'ChatGPT subscription (official connection)', status: 'not_connected' },
  { id: 'self-hosted', label: 'Self-hosted model', status: 'not_connected' },
  { id: 'paid-api', label: 'Paid AI API', status: 'not_connected' },
] as const;
