/** Show already-verified partial WhatsApp sender names even when full coverage fails.
 * Never turn a failed 2/4 scan into a completed status. Other failed commands
 * remain hidden because their results may be incomplete or unsafe. */
export function showCommandResult(c: {
  status: string;
  action: string;
  result?: unknown;
}): boolean {
  if (c.status === 'completed') return true;
  if (c.status !== 'failed' || c.action !== 'whatsapp.unread_senders') return false;
  if (!c.result || typeof c.result !== 'object' || Array.isArray(c.result)) return false;
  const senders = (c.result as { senders?: unknown }).senders;
  return Array.isArray(senders) && senders.some((name) =>
    typeof name === 'string' && name.trim().length > 0 && name.length <= 100);
}
