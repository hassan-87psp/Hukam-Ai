import { ScrollText, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CommandStatus } from '../../../../packages/shared-types/src/index';
import { Badge, Card, cx, EmptyState, Modal, PageHeader, Segmented } from '../components/ui';
import CommandCard, { ActionIcon, commandTitle, StatusChip } from '../features/command/CommandCard';
import { PageFrame } from '../layouts/AppShell';
import { ACTION_LABEL, dateTime, duration } from '../lib/format';
import { del, get, useStore } from '../services/store';

const FILTERS: { value: 'all' | CommandStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'awaiting_approval', label: 'Approval' },
  { value: 'timed_out', label: 'Timed out' },
  { value: 'cancelled', label: 'Cancelled' },
];

function Audit() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    get('/api/audit?limit=200').then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="p-5 text-sm text-ink2">Loading…</p>;
  return (
    <ul className="divide-y divide-line/10">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
          <Badge tone={r.actor === 'device' ? 'info' : r.actor === 'system' ? 'muted' : 'ok'}>{r.actor}</Badge>
          <span className="font-mono text-xs">{r.event}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-ink2">{r.detail ? JSON.stringify(r.detail) : ''}</span>
          <span className="text-xs text-ink2">{dateTime(r.at)}{r.ip ? ` · ${r.ip}` : ''}</span>
        </li>
      ))}
      {!rows.length && <li className="p-5 text-sm text-ink2">No audit entries.</li>}
    </ul>
  );
}

export default function History() {
  const { commands, devices, loadMoreCommands, refresh, toast } = useStore();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'commands' | 'audit'>('commands');
  const [filter, setFilter] = useState<'all' | CommandStatus>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(params.get('id'));
  const [more, setMore] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const name = (id: string | null) => devices.find((d) => d.id === id)?.name ?? '—';

  const list = useMemo(() => commands.filter((c) => (filter === 'all' || c.status === filter) && (!q || commandTitle(c).toLowerCase().includes(q.toLowerCase()))), [commands, filter, q]);

  return (
    <PageFrame>
      <PageHeader title="Activity History" subtitle="Every command with its real outcome, plus an audit trail of security-relevant events."
        actions={<>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'commands', label: 'Commands' }, { value: 'audit', label: 'Audit log' }]} />
          {tab === 'commands' && <button className="btn-ghost" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /> Clear</button>}
        </>} />
      {tab === 'audit' ? <Card className="p-0"><Audit /></Card> : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink2" />
              <input className="input pl-9" placeholder="Search commands" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="overflow-x-auto"><Segmented value={filter} onChange={setFilter} options={FILTERS} /></div>
          </div>
          <Card className="p-0">
            {list.length === 0 && <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No commands" body="Nothing matches this filter." />}
            <ul className="divide-y divide-line/10">
              {list.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setOpen(open === c.id ? null : c.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-field/30', open === c.id && 'bg-field/30')}>
                    <ActionIcon action={c.action} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto">{c.inputText ? `“${c.inputText}”` : commandTitle(c)}</p>
                      <p className="truncate text-xs text-ink2">{dateTime(c.createdAt)} · {ACTION_LABEL[c.action]} · {name(c.deviceId)} · {c.source}{c.durationMs != null ? ` · ${duration(c.durationMs)}` : ''}</p>
                    </div>
                    <StatusChip c={c} />
                  </button>
                  {open === c.id && <div className="px-4 pb-4"><CommandCard c={c} deviceName={name(c.deviceId)} /></div>}
                </li>
              ))}
            </ul>
            {more && list.length > 0 && filter === 'all' && !q && (
              <div className="border-t border-line/10 p-3 text-center">
                <button className="btn-ghost" onClick={async () => setMore(await loadMoreCommands())}>Load older</button>
              </div>
            )}
          </Card>
        </>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Clear command history?"
        footer={<><button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button><button className="btn-danger" onClick={async () => {
          setConfirm(false);
          const r = await del<{ deleted: number }>('/api/commands');
          toast({ title: `${r.deleted} finished commands deleted`, tone: 'ok' });
          location.reload();
          refresh();
        }}>Clear</button></>}>
        <p className="text-sm text-ink2">Finished commands are deleted. Running or waiting commands and the audit log are kept.</p>
      </Modal>
    </PageFrame>
  );
}
