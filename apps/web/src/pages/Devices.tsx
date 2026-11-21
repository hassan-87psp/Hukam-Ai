import { Copy, Download, History, KeyRound, Laptop, Pause, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ALL_CAPABILITIES, type Capability, type Device } from '../../../../packages/shared-types/src/index';
import { LaptopArt } from '../components/Illustrations';
import { Badge, Card, cx, EmptyState, Modal, PageHeader, Spinner, StatusDot, Toggle } from '../components/ui';
import { PageFrame } from '../layouts/AppShell';
import { ACTION_LABEL, dateTime, STATUS_LABEL, timeAgo } from '../lib/format';
import { metric } from '../lib/control-center';
import { del, get, patch, post, useStore } from '../services/store';

const CAP_LABEL: Record<Capability, { label: string; desc: string }> = {
  system: { label: 'System info', desc: 'Device status, open apps, active window, lock' },
  apps: { label: 'Launch apps', desc: 'Only allowlisted applications' },
  folders: { label: 'Open folders', desc: 'Downloads, Documents, Desktop…' },
  files: { label: 'Files', desc: 'Search, list and open files in allowed folders' },
  browser: { label: 'Browser', desc: 'Open websites and web searches' },
  youtube: { label: 'YouTube', desc: 'Search and open videos' },
  screen: { label: 'Screen capture', desc: 'On-demand screenshots (approval by default)' },
  input: { label: 'Window focus', desc: 'Bring a window to the front' },
  whatsapp: { label: 'WhatsApp Desktop', desc: 'Installed Personal WhatsApp Desktop; approved chat selection, visible reading, drafts and separately reviewed Send. Real-device verification pending.' },
};

function PairModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { devices, toast } = useStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const known = useRef<Set<string>>(new Set());
  const [pairedId, setPairedId] = useState<string | null>(null);
  const paired = pairedId ? devices.find((d) => d.id === pairedId) ?? null : null;

  useEffect(() => {
    if (open) {
      setCode(null);
      setPairedId(null);
      setName('');
      known.current = new Set(devices.map((d) => d.id));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!code || pairedId) return;
    const newDev = devices.find((d) => !known.current.has(d.id));
    if (newDev) setPairedId(newDev.id);
  }, [devices, code, pairedId]);
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [code]);

  const origin = location.origin;
  const cmd = code ? `hukm-controller pair --server ${origin} --code ${code.code}` : '';
  return (
    <Modal open={open} onClose={onClose} title="Pair a Windows laptop" wide>
      {paired ? (
        <div className="py-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok ring-1 ring-ok/40"><ShieldCheck className="h-7 w-7" /></div>
          <p className="font-display text-lg font-semibold">“{paired.name}” is paired</p>
          <p className="mt-1 text-sm text-ink2">{paired.online ? 'It is online and ready for commands.' : 'Start the controller on the laptop to bring it online.'}</p>
          <button className="btn-primary mt-5" onClick={onClose}>Done</button>
        </div>
      ) : !code ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink2">
            <li>Install HUKM Controller on your laptop once. The one-file Setup EXE is being prepared and tested; a direct website download is not released yet.</li>
            <li>Create a one-time code here. It expires in 10 minutes and works once.</li>
            <li>Enter this site’s address and the code in the controller window.</li>
          </ol>
          <div>
            <label className="label" htmlFor="dn">Device name (optional)</label>
            <input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="HUKM-Laptop" maxLength={60} />
          </div>
          <button className="btn-primary w-full" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              setCode(await post('/api/devices/pairing-code', { name: name.trim() || undefined }));
            } catch (e) {
              toast({ title: 'Could not create code', body: (e as Error).message, tone: 'bad' });
            } finally {
              setBusy(false);
            }
          }}>{busy ? <Spinner /> : <KeyRound className="h-4 w-4" />} Generate pairing code</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl bg-field/50 p-5 text-center ring-1 ring-ice/20">
            <p className="text-xs uppercase tracking-widest text-ink2">Pairing code</p>
            <p className="mt-2 select-all font-display text-4xl font-bold tracking-[0.2em] text-gradient">{code.code}</p>
            <p className={cx('mt-2 text-xs', left < 60 ? 'text-warn' : 'text-ink2')}>{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — generate a new one'}</p>
          </div>
          <div>
            <p className="label">Server address</p>
            <CopyLine text={origin} />
          </div>
          <div>
            <p className="label">Or run this on the laptop</p>
            <CopyLine text={cmd} mono />
          </div>
          <p className="flex items-center justify-center gap-2 text-sm text-ink2"><Spinner /> Waiting for the laptop to connect…</p>
        </div>
      )}
    </Modal>
  );
}

function CopyLine({ text, mono }: { text: string; mono?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-field/60 px-3 py-2 ring-1 ring-line/15">
      <code className={cx('min-w-0 flex-1 truncate text-sm', mono && 'font-mono text-xs')}>{text}</code>
      <button className="shrink-0 text-ink2 hover:text-ice" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }} aria-label="Copy">
        {ok ? <span className="text-xs text-ok">Copied</span> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function DeviceCard({ d, latestVersion }: { d: Device;latestVersion:string|null }) {
  const { toast, setDevices, devices, runAction, commands, approve, reject } = useStore();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [updateBusy,setUpdateBusy] = useState(false);
  // Keep the approval and download status on the Devices page. Previously
  // clicking Update from website created a hidden Chat command, leaving the
  // owner with no visible indication of what required approval next.
  const lastUpdate = commands.find(c=>c.deviceId===d.id && c.action==='controller.update') ?? null;
  const updateActive = lastUpdate != null &&
    (lastUpdate.status === 'awaiting_approval' || lastUpdate.status === 'pending' ||
     lastUpdate.status === 'running');
  const requestUpdate = async () => {
    if(updateBusy || updateActive || !d.online || d.paused) return;
    setUpdateBusy(true);
    try {
      const c = await runAction('controller.update',{},
        {source:'ui',deviceId:d.id,label:'Check official HUKM Windows update (local install confirmation required)'});
      if(c?.action==='controller.update')
        toast({title:'Update request created',
          body:'Approve the request below on Devices, then look at the laptop for a separate Windows installer confirmation.',
          tone:'ok'});
    } finally {
      setUpdateBusy(false);
    }
  };
  const update = (nd: Device) => setDevices(devices.map((x) => (x.id === nd.id ? nd : x)));
  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      const r = await fn();
      if (r && r.id) update(r);
      toast({ title: ok, tone: 'ok' });
    } catch (e) {
      toast({ title: 'Action failed', body: (e as Error).message, tone: 'bad' });
    }
  };
  const status = d.online ? (d.paused ? 'Paused (emergency stop)' : 'Online') : 'Offline';
  const supportsWebUpdate = /^\d+\.\d+\.\d+$/.test(d.controllerVersion ?? '') &&
    (d.controllerVersion ?? '').split('.').map(Number).reduce(
      (v,n,i)=>v+n*[10000,100,1][i],0) >= 10800;
  const versionMismatch = Boolean(d.controllerVersion && latestVersion &&
    d.controllerVersion !== latestVersion);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-5 border-b border-line/10 p-5">
        <LaptopArt className="h-20 w-28" on={d.online} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setRenaming(false); act(() => patch(`/api/devices/${d.id}`, { name }), 'Device renamed'); }}>
              <input className="input max-w-xs py-1.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
              <button className="btn-primary px-3 py-1.5">Save</button>
            </form>
          ) : (
            <p className="flex items-center gap-2 font-display text-xl font-semibold">{d.name}
              <button className="text-ink2 hover:text-ink" onClick={() => setRenaming(true)} aria-label="Rename"><Pencil className="h-4 w-4" /></button>
            </p>
          )}
          <p className={cx('mt-1 flex items-center gap-2 text-sm', d.online && !d.paused ? 'text-ok' : d.paused ? 'text-warn' : 'text-ink2')}><StatusDot online={d.online && !d.paused} /> {status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.paused ? (
            <button className="btn-primary" onClick={() => act(() => post(`/api/devices/${d.id}/resume`), 'Device resumed')}><Play className="h-4 w-4" /> Resume control</button>
          ) : (
            <button className="btn-ghost" onClick={() => act(() => post(`/api/devices/${d.id}/pause`), 'Device paused')}><Pause className="h-4 w-4" /> Pause control</button>
          )}
          {versionMismatch && supportsWebUpdate && d.online && !d.paused &&
            <button className="btn-primary" disabled={updateBusy || updateActive}
              onClick={()=>void requestUpdate()}>
              <Download className="h-4 w-4" />
              {updateBusy ? 'Requesting…' : updateActive ? 'Update in progress' : 'Update from website'}
            </button>}
          <button className="btn-ghost text-bad" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /> Remove</button>
        </div>
      </div>
      {lastUpdate && d.controllerVersion !== latestVersion &&
        <div className="mx-5 mt-4 space-y-2 rounded-xl bg-field/60 p-4 text-sm ring-1 ring-line/25">
          <p className="font-semibold">Windows update · {STATUS_LABEL[lastUpdate.status]}</p>
          {lastUpdate.status==='awaiting_approval' &&
            <>
              <p className="text-ink2">Website permission is still required. Approve here, then confirm again in the HUKM Windows Controller popup on your laptop.</p>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={()=>void approve(lastUpdate.id)}>Approve HUKM update</button>
                <button className="btn-ghost" onClick={()=>void reject(lastUpdate.id)}>Cancel</button>
              </div>
            </>}
          {(lastUpdate.status==='pending' || lastUpdate.status==='running') &&
            <p className="text-warn">Approved. The laptop is contacting official GitHub, verifying SHA-256 and may be asking you to confirm the installer in Windows. Check the actual laptop, not only this browser. Closing the Controller or losing connection may interrupt this stage.</p>}
          {lastUpdate.status==='completed' &&
            <p className="text-warn">{lastUpdate.result?.installerLaunched === true
              ? 'The Windows installer was launched, but the update is NOT yet confirmed. Finish its installation on the laptop; restart HUKM and check the new version here.'
              : lastUpdate.result?.updateAvailable === false
                ? 'The laptop reported no newer GitHub release. If the backend version differs, check official Releases below.'
                : 'Update request finished, but a new Controller version has NOT been verified. Check the laptop installation and reconnect.'}</p>}
          {(lastUpdate.status==='failed' || lastUpdate.status==='timed_out' ||
            lastUpdate.status==='cancelled') &&
            <p className="text-bad">Updater did not finish: {lastUpdate.error?.message ?? 'Windows command failed or was interrupted'}. Do not repeatedly approve the same failed command. If the previous executable was backed up, close HUKM on the laptop and use the local Restore Previous Controller shortcut.</p>}
          {latestVersion &&
            <a className="text-ice underline" target="_blank" rel="noreferrer"
              href={`https://github.com/hassan-87psp/Hukam-Ai/releases/tag/v${encodeURIComponent(latestVersion)}`}>
              Official setup and checksum (manual recovery if the website updater cannot finish)
            </a>}
        </div>}
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.3fr]">
        <dl className="grid content-start grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-ink2">Operating system</dt><dd>{d.os ? `${d.os} ${d.osVersion ?? ''}` : '—'}</dd>
          <dt className="text-ink2">Hostname</dt><dd>{d.hostname ?? '—'}</dd>
          <dt className="text-ink2">Controller</dt><dd>{d.controllerVersion ? `v${d.controllerVersion}` : '—'}
            {d.controllerVersion && latestVersion && d.controllerVersion!==latestVersion&&
              <p className="mt-1 text-xs text-warn">
                Controller version v{d.controllerVersion} differs from backend v{latestVersion}.
                Do not delete existing pairing.
                {supportsWebUpdate
                  ? ' Use Update from website. HUKM will verify the official release, ask for owner approval and request local installer confirmation; reconnect to verify success.'
                  : ' A one-time v1.8.0 Windows Setup installation is required to enable future website-initiated updates. No automatic/unsigned silent install.'}
              </p>}
            {d.controllerVersion && latestVersion && d.controllerVersion===latestVersion&&
              <p className="mt-1 text-xs text-ok">Controller and backend version match. Real laptop operation still needs testing.</p>}
          </dd>
          <dt className="text-ink2">Last seen</dt><dd>{d.online ? 'Now' : timeAgo(d.lastSeen)}</dd>
          <dt className="text-ink2">Paired</dt><dd>{dateTime(d.createdAt)}</dd>
          <dt className="text-ink2">Last command</dt><dd>{d.lastCommand ? `${ACTION_LABEL[d.lastCommand.action]} · ${STATUS_LABEL[d.lastCommand.status]} · ${timeAgo(d.lastCommand.at)}` : '—'}</dd>
          {d.stats && d.online && (<><dt className="text-ink2">System load</dt><dd>CPU {metric(d.stats.cpu,'%',100)} · RAM {metric(d.stats.memory,'%',100)}{d.stats.battery != null ? ' · Battery '+metric(d.stats.battery,'%',100) : ''}</dd><dt className="text-ink2">HUKM process</dt><dd>CPU {metric(d.stats.controllerCpuPercent,'%')} · RAM {metric(d.stats.controllerMemoryMb,' MB')}</dd></>)}
          <dt className="text-ink2">Allowed folders</dt>
          <dd className="space-y-0.5">{d.controllerConfig?.allowedDirs?.length ? d.controllerConfig.allowedDirs.map((x) => <p key={x.path} className="truncate text-xs" title={x.path}>{x.path}</p>) : <span className="text-ink2">Reported when the controller connects</span>}</dd>
          <dt className="text-ink2">Allowed apps</dt><dd className="text-xs">{d.controllerConfig?.apps?.join(', ') || '—'}</dd>
        </dl>
        <div>
          <p className="label">Capabilities</p>
          <p className="mb-2 text-xs text-ink2">Turn off anything you don’t want controllable from the web app. The laptop’s own config can restrict further.</p>
          <div className="divide-y divide-line/10">
            {ALL_CAPABILITIES.map((c) => {
              const reported = d.capabilitiesReported.includes(c);
              const on = d.capabilitiesEnabled.includes(c);
              return (
                <Toggle key={c} checked={on && reported} disabled={!reported} label={<>{CAP_LABEL[c].label} {!reported && <Badge tone="muted" className="ml-1">not offered by laptop</Badge>}</>} description={CAP_LABEL[c].desc}
                  onChange={(v) => act(() => patch(`/api/devices/${d.id}`, { capabilitiesEnabled: v ? [...d.capabilitiesEnabled, c] : d.capabilitiesEnabled.filter((x) => x !== c) }), v ? `${CAP_LABEL[c].label} enabled` : `${CAP_LABEL[c].label} disabled`)} />
              );
            })}
          </div>
        </div>
      </div>
      <div className="border-t border-line/10 px-5 py-3">
        <button className="flex items-center gap-2 text-sm text-ink2 hover:text-ink" onClick={async () => setHistory(history ? null : await get(`/api/devices/${d.id}/connections`))}>
          <History className="h-4 w-4" /> {history ? 'Hide' : 'Show'} connection history
        </button>
        {history && (
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {history.map((h, i) => <li key={i} className="flex justify-between rounded-lg bg-field/30 px-3 py-1.5"><span className="capitalize">{h.event}</span><span className="text-ink2">{dateTime(h.at)}{h.ip ? ` · ${h.ip}` : ''}</span></li>)}
            {!history.length && <li className="text-ink2">No events.</li>}
          </ul>
        )}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Remove ${d.name}?`}
        footer={<><button className="btn-ghost" onClick={() => setConfirm(false)}>Keep</button><button className="btn-danger" onClick={() => { setConfirm(false); act(() => del(`/api/devices/${d.id}`), 'Device removed'); }}>Remove & revoke</button></>}>
        <p className="text-sm text-ink2">Its token is revoked immediately and queued commands are cancelled. The laptop must be paired again to reconnect.</p>
      </Modal>
    </Card>
  );
}

export default function Devices() {
  const { devices } = useStore();
  const [pair, setPair] = useState(false);
  const [latestVersion,setLatestVersion]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    void get<{version:string}>('/api/system').then(r=>{
      if(active&&typeof r.version==='string')setLatestVersion(r.version);
    }).catch(()=>{});
    return ()=>{active=false;};
  },[]);
  return (
    <PageFrame>
      <PageHeader title="Devices" subtitle="Laptops paired with your account. Remote access is always visible and revocable." actions={<button className="btn-primary" onClick={() => setPair(true)}><Plus className="h-4 w-4" /> Pair new device</button>} />
      <div className="space-y-5">
        {devices.map((d) => <DeviceCard key={d.id} d={d} latestVersion={latestVersion} />)}
        {!devices.length && (
          <Card><EmptyState icon={<Laptop className="h-5 w-5" />} title="No laptop paired yet" body="Install the HUKM controller on your Windows laptop and pair it with a one-time code." action={<button className="btn-primary" onClick={() => setPair(true)}><Plus className="h-4 w-4" /> Pair new device</button>} /></Card>
        )}
      </div>
      <PairModal open={pair} onClose={() => setPair(false)} />
    </PageFrame>
  );
}
