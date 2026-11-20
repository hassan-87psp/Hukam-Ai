import { BookUser, Inbox, MessageCircle, MessageSquareReply, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Card, CardHeader, NotConnected, PageHeader, Spinner } from '../components/ui';
import CommandCard, { CommandRow } from '../features/command/CommandCard';
import { PageFrame } from '../layouts/AppShell';
import { timeAgo } from '../lib/format';
import { useStore } from '../services/store';

export default function WhatsApp() {
  const { commands, runAction, settings, saveSettings, activeDevice, commandMap } = useStore();
  const [contact, setContact] = useState('');
  const [msg, setMsg] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const composeRef = useRef<HTMLDivElement>(null);
  const waCmds = commands.filter((c) => c.action.startsWith('whatsapp'));
  const lastCheck = waCmds.find((c) => c.action === 'whatsapp.check');
  const checking = lastCheck && ['pending', 'running'].includes(lastCheck.status);
  const capOn = activeDevice?.capabilitiesEnabled.includes('whatsapp');
  const draft = draftId ? commandMap.get(draftId) : null;

  useEffect(() => {
    if (location.hash === '#compose') composeRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => {
    if (!contact && settings.whatsappContacts[0]) setContact(settings.whatsappContacts[0].name);
  }, [settings.whatsappContacts, contact]);

  return (
    <PageFrame>
      <PageHeader title="WhatsApp Control" subtitle="What works today, clearly labelled — and what still needs an authorised integration." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-1">
          <CardHeader icon={<MessageCircle className="h-5 w-5 text-[#25D366]" />} title="Connection status" />
          <div className="space-y-3 px-5 pb-5 pt-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-ink2">Laptop</span>{activeDevice?.online ? <Badge tone="ok" dot>Online</Badge> : <Badge tone="muted" dot>Offline</Badge>}</div>
            <div className="flex items-center justify-between"><span className="text-ink2">WhatsApp capability</span>{capOn ? <Badge tone="ok" dot>Enabled</Badge> : <Badge tone="warn" dot>Disabled</Badge>}</div>
            <div className="flex items-center justify-between"><span className="text-ink2">Official WhatsApp API</span><Badge tone="muted">Not connected</Badge></div>
            <p className="rounded-xl bg-field/40 p-3 text-xs leading-relaxed text-ink2 ring-1 ring-line/10">
              HUKM uses your own WhatsApp Web / Desktop on the laptop. It can open WhatsApp, read the <b className="text-ink">unread count</b> shown in the window title, and open a chat with a <b className="text-ink">pre-typed draft</b>. It never reads messages, never presses Send, and never sends in bulk.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" disabled={!activeDevice?.online} onClick={() => runAction('whatsapp.open', {}, { label: 'WhatsApp kholo' })}>Open WhatsApp</button>
              <button className="btn-primary flex-1" disabled={!activeDevice?.online || !!checking} onClick={() => runAction('whatsapp.check', {}, { label: 'WhatsApp check karo' })}>
                {checking ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Check
              </button>
            </div>
          </div>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <CardHeader icon={<Inbox className="h-5 w-5" />} title="Unread messages" action={lastCheck ? <span className="text-xs text-ink2">checked {timeAgo(lastCheck.createdAt)}</span> : null} />
          <div className="space-y-4 px-5 pb-5 pt-3">
            {lastCheck?.status === 'completed' ? (
              typeof lastCheck.result?.unreadChats === 'number' ? (
                <div className="flex items-center gap-4 rounded-2xl bg-[#25D366]/10 p-4 ring-1 ring-[#25D366]/25">
                  <span className="font-display text-4xl font-bold text-[#25D366]">{String(lastCheck.result.unreadChats)}</span>
                  <div><p className="font-semibold">unread chats</p><p className="text-xs text-ink2">From the WhatsApp window title on the laptop</p></div>
                </div>
              ) : <p className="text-sm text-ink2">{String(lastCheck.result?.note ?? '')}</p>
            ) : lastCheck && lastCheck.error ? <p className="text-sm text-bad">{lastCheck.error.message}</p> : <p className="text-sm text-ink2">Tap “Check” to read the unread count.</p>}
            <NotConnected title="Recent chats & message reader" body="Listing chats and reading message text needs an authorised integration (e.g. the official WhatsApp Business Platform). Automating the personal WhatsApp interface is fragile and can put your account at risk, so V1 doesn’t do it. No messages are shown here because none are read." />
          </div>
        </Card>

        <Card className="p-0 lg:col-span-2" >
          <div ref={composeRef} id="compose" />
          <CardHeader icon={<MessageSquareReply className="h-5 w-5" />} title="Reply composer" />
          <div className="space-y-3 px-5 pb-5 pt-3">
            {settings.whatsappContacts.length === 0 ? (
              <p className="text-sm text-ink2">Add a contact first (right). HUKM only messages people you saved, by exact name.</p>
            ) : (
              <form className="space-y-3" onSubmit={async (e) => {
                e.preventDefault();
                const c = await runAction('whatsapp.compose', { contact, message: msg.trim() }, { label: `${contact} ko message: ${msg.trim()}` });
                if (c) { setDraftId(c.id); setMsg(''); }
              }}>
                <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                  <select className="input" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Recipient">
                    {settings.whatsappContacts.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <textarea className="input" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Main 10 minute mein call karta hoon." dir="auto" maxLength={1000} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-ink2"><ShieldCheck className="h-4 w-4 text-ok" /> You’ll review and approve before anything opens. You press Send on the laptop.</p>
                  <button className="btn-primary" disabled={!msg.trim() || !activeDevice?.online}><Send className="h-4 w-4" /> Prepare message</button>
                </div>
              </form>
            )}
            {draft && <CommandCard c={draft} />}
            <p className="text-xs text-ink2">Voice works too: “Ali ko message likho ke main 10 minute mein call karunga.”</p>
          </div>
        </Card>

        <Card className="p-0">
          <CardHeader icon={<BookUser className="h-5 w-5" />} title="Saved contacts" />
          <div className="px-5 pb-5 pt-3">
            <ul className="mb-3 space-y-1.5">
              {settings.whatsappContacts.map((c) => (
                <li key={c.name} className="flex items-center justify-between rounded-xl bg-field/40 px-3 py-2 text-sm">
                  <span>{c.name} <span className="text-xs text-ink2">+{c.phone}</span></span>
                  <button className="text-ink2 hover:text-bad" onClick={() => saveSettings({ whatsappContacts: settings.whatsappContacts.filter((x) => x.name !== c.name) })} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
              {!settings.whatsappContacts.length && <li className="text-sm text-ink2">No contacts yet.</li>}
            </ul>
            <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault();
              const phone = newPhone.replace(/\D/g, '');
              if (!newName.trim() || phone.length < 8) return;
              saveSettings({ whatsappContacts: [...settings.whatsappContacts.filter((x) => x.name.toLowerCase() !== newName.trim().toLowerCase()), { name: newName.trim(), phone }] });
              setNewName(''); setNewPhone('');
            }}>
              <input className="input" placeholder="Name (as you’ll say it), e.g. Ali" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
              <input className="input" placeholder="Phone with country code, e.g. 923001234567" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" />
              <button className="btn-ghost w-full"><Plus className="h-4 w-4" /> Add contact</button>
            </form>
          </div>
        </Card>

        <Card className="p-0 lg:col-span-3">
          <CardHeader title="WhatsApp activity" />
          <div className="grid gap-1 px-3 pb-3 pt-2 md:grid-cols-2">
            {waCmds.slice(0, 10).map((c) => <CommandRow key={c.id} c={c} />)}
            {!waCmds.length && <p className="px-2 py-4 text-sm text-ink2">No WhatsApp activity yet.</p>}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
