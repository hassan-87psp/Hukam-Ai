import { Clock, Download, ExternalLink, FileText, FolderOpen, Monitor, RefreshCw, Search, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActionName, Command } from '../../../../packages/shared-types/src/index';
import { Badge, Card, cx, EmptyState, PageHeader, Segmented, Skeleton } from '../components/ui';
import { PageFrame } from '../layouts/AppShell';
import { bytes, dateTime } from '../lib/format';
import { useStore } from '../services/store';

type Tab = 'recent' | 'downloads' | 'documents' | 'desktop' | 'search';
const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'downloads', label: 'Downloads', icon: Download },
  { value: 'documents', label: 'Documents', icon: FileText },
  { value: 'desktop', label: 'Desktop', icon: Monitor },
  { value: 'search', label: 'Search', icon: Search },
];
const TYPES: { value: string; label: string; ext: string[] }[] = [
  { value: 'any', label: 'Any type', ext: [] },
  { value: 'pdf', label: 'PDF', ext: ['pdf'] },
  { value: 'excel', label: 'Excel / CSV', ext: ['xlsx', 'xls', 'csv'] },
  { value: 'word', label: 'Word', ext: ['docx', 'doc'] },
  { value: 'image', label: 'Images', ext: ['jpg', 'jpeg', 'png', 'webp'] },
  { value: 'video', label: 'Videos', ext: ['mp4', 'mkv', 'mov'] },
  { value: 'zip', label: 'Archives', ext: ['zip', 'rar', '7z'] },
  { value: 'mql', label: 'MQL', ext: ['mq5', 'mq4', 'ex5', 'ex4', 'set'] },
];

function useRemote() {
  const { runAction, commandMap } = useStore();
  const [id, setId] = useState<string | null>(null);
  const c: Command | null = id ? commandMap.get(id) ?? null : null;
  const run = async (action: ActionName, args: Record<string, unknown>) => {
    const r = await runAction(action, args, { silent: true });
    setId(r?.id ?? null);
  };
  return { c, run, loading: !!c && ['pending', 'running', 'awaiting_approval'].includes(c.status) };
}

export default function Files() {
  const { activeDevice, runAction } = useStore();
  const [tab, setTab] = useState<Tab>('recent');
  const [q, setQ] = useState('');
  const [type, setType] = useState('any');
  const [loc, setLoc] = useState('');
  const [sel, setSel] = useState<any>(null);
  const remote = useRemote();
  const online = !!activeDevice?.online;

  const load = () => {
    setSel(null);
    if (tab === 'recent') remote.run('file.search', { query: '', ext: [], sort: 'latest', limit: 40 });
    else if (tab !== 'search') remote.run('folder.list', { folder: tab, limit: 100 });
  };
  useEffect(() => {
    if (online && tab !== 'search') load();
  }, [tab, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: any[] = remote.c?.status === 'completed' ? (remote.c.result?.items as any[]) ?? (remote.c.result?.results as any[]) ?? [] : [];

  return (
    <PageFrame>
      <PageHeader title="File Manager" subtitle={<>Browse and open files inside the folders the controller allows{activeDevice?.controllerConfig ? ` (${activeDevice.controllerConfig.allowedDirs.length} folders)` : ''}. Nothing outside them is searched.</>} />
      <div className="mb-4 overflow-x-auto">
        <Segmented value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t.value, label: <span className="flex items-center gap-1.5 whitespace-nowrap"><t.icon className="h-4 w-4" />{t.label}</span> }))} />
      </div>
      {!online && <Card className="mb-4 p-4 text-sm text-warn">The laptop is offline. File browsing needs the controller running.</Card>}

      {tab === 'search' && (
        <Card className="mb-4 p-4">
          <form className="grid gap-3 sm:grid-cols-[1fr_170px_170px_auto]" onSubmit={(e) => { e.preventDefault(); setSel(null); remote.run('file.search', { query: q.trim(), ext: TYPES.find((t) => t.value === type)!.ext, location: loc || undefined, sort: q.trim() ? 'relevance' : 'latest', limit: 50 }); }}>
            <input className="input" placeholder="File name, e.g. invoice" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">All allowed folders</option>
              {['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos'].map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
            </select>
            <button className="btn-primary" disabled={!online || (!q.trim() && type === 'any')}><Search className="h-4 w-4" /> Search</button>
          </form>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-line/10 px-5 py-3">
            <p className="truncate text-sm text-ink2">
              {remote.c?.status === 'completed' && (remote.c.result?.path ? String(remote.c.result.path) : `${remote.c.result?.count ?? 0} matches`)}
              {remote.loading && 'Loading from laptop…'}
              {!remote.c && !remote.loading && (tab === 'search' ? 'Enter a search' : '')}
            </p>
            {tab !== 'search' && <button className="text-ink2 hover:text-ink" onClick={load} disabled={!online} aria-label="Refresh"><RefreshCw className={cx('h-4 w-4', remote.loading && 'animate-spin')} /></button>}
          </div>
          {remote.loading && <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>}
          {remote.c && ['failed', 'timed_out'].includes(remote.c.status) && (
            <p className="m-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad ring-1 ring-bad/20">{remote.c.error?.code === 'NOT_ALLOWED' ? 'Permission: ' : ''}{remote.c.error?.message}</p>
          )}
          {remote.c?.status === 'completed' && !items.length && <EmptyState icon={<FolderOpen className="h-5 w-5" />} title="Nothing here" body="No matching files in the allowed folders." />}
          {!!items.length && (
            <ul className="max-h-[60vh] divide-y divide-line/10 overflow-y-auto scroll-thin">
              {items.map((f) => (
                <li key={f.path}>
                  <button onClick={() => setSel(f)} onDoubleClick={() => !f.isDir && runAction('file.open', { path: f.path }, { label: `Open ${f.name}` })}
                    className={cx('flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-field/40', sel?.path === f.path && 'bg-blue/10')}>
                    {f.isDir ? <FolderOpen className="h-5 w-5 shrink-0 text-[#f5c451]" /> : <FileText className="h-5 w-5 shrink-0 text-ice" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" dir="auto">{f.name}</span>
                      <span className="block truncate text-[11px] text-ink2">{f.folder ?? ''}</span>
                    </span>
                    {f.ext && <Badge tone="muted" className="hidden sm:inline-flex">{f.ext}</Badge>}
                    <span className="hidden w-20 shrink-0 text-right text-xs text-ink2 sm:block">{f.isDir ? '—' : bytes(f.size)}</span>
                    <span className="hidden w-36 shrink-0 text-right text-xs text-ink2 md:block">{dateTime(f.modified)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <p className="label">File details</p>
            {sel ? (
              <div className="space-y-3">
                <p className="break-words font-display font-semibold" dir="auto">{sel.name}</p>
                <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-sm">
                  <dt className="text-ink2">Type</dt><dd>{sel.isDir ? 'Folder' : (sel.ext || 'file').toUpperCase()}</dd>
                  {!sel.isDir && (<><dt className="text-ink2">Size</dt><dd>{bytes(sel.size)}</dd></>)}
                  <dt className="text-ink2">Modified</dt><dd>{dateTime(sel.modified)}</dd>
                  <dt className="text-ink2">Location</dt><dd className="break-all text-xs">{sel.path}</dd>
                </dl>
                {!sel.isDir && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={() => runAction('file.open', { path: sel.path }, { label: `Open ${sel.name}` })}><ExternalLink className="h-4 w-4" /> Open on laptop</button>
                    <button className="btn-ghost" onClick={() => runAction('file.reveal', { path: sel.path }, { label: `Show ${sel.name} in folder` })}><FolderOpen className="h-4 w-4" /> Open folder</button>
                  </div>
                )}
                <p className="text-xs text-ink2">Previews aren’t transferred to the phone in V1 — files open on the laptop.</p>
              </div>
            ) : <p className="text-sm text-ink2">Select a file to see details.</p>}
          </Card>
          <QuickOpen />
        </div>
      </div>
    </PageFrame>
  );
}

function QuickOpen() {
  const { runText, activeDevice } = useStore();
  const [v, setV] = useState('');
  return (
    <Card className="p-5">
      <p className="mb-2 flex items-center gap-2 font-display font-semibold"><Zap className="h-4 w-4 text-ice" /> Quick open</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { runText(v.trim(), 'text'); setV(''); } }}>
        <input className="input" placeholder="e.g. Desktop par jo PDF hai woh kholo" value={v} onChange={(e) => setV(e.target.value)} dir="auto" />
        <button className="btn-primary px-3" disabled={!activeDevice?.online}>Go</button>
      </form>
      <p className="mt-2 text-xs text-ink2">Opens immediately when exactly one file matches (or you ask for the latest); otherwise shows choices in Chat.</p>
    </Card>
  );
}
