import {useEffect,useState} from 'react';
import {Activity, ArrowRight, BookOpen, BrainCircuit, FolderKanban, Laptop, ListChecks, RefreshCw, ShieldCheck, Zap} from 'lucide-react';
import {Link} from 'react-router-dom';
import {get,post} from '../services/api';
import {useStore} from '../services/store';
import {metric,taskProgress,taskTone} from '../lib/control-center';
import {EmergencyStop} from '../layouts/AppShell';
type Run={id:string;status:string;currentStep:number;totalSteps:number;updatedAt:string;deviceId:string|null};
const activeStatuses=new Set(['queued','running','awaiting_approval']);
const links=[
  {to:'/projects',title:'Projects & memory',detail:'Workspaces and reference knowledge',icon:FolderKanban},
  {to:'/skills',title:'Skills & Teach',detail:'Reusable plans and corrections',icon:BrainCircuit},
  {to:'/devices',title:'Devices & diagnostics',detail:'Pairing, health and updates',icon:Laptop},
  {to:'/history',title:'Activity history',detail:'Review command outcomes',icon:BookOpen},
];
export default function ControlCenter(){
  const {devices,activeDevice,realtime,approvals}=useStore();
  const [runs,setRuns]=useState<Run[]|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const [checkedAt,setCheckedAt]=useState('');
  useEffect(()=>{
    let live=true,inFlight=false;
    const refresh=async()=>{
      if(!live||inFlight||document.hidden)return;
      inFlight=true;
      try{const rows=await get<Run[]>('/api/operator/runs');if(live){setRuns(rows);setError('');setCheckedAt(new Date().toLocaleTimeString());}}
      catch{if(live){setError('Task status unavailable. Last results may be stale.');}}
      finally{inFlight=false;}
    };
    void refresh();
    const timer=window.setInterval(()=>void refresh(),10000);
    document.addEventListener('visibilitychange',refresh);
    return()=>{live=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[revision]);
  async function stop(id:string){
    if(!confirm('Stop this task? Executed actions cannot be undone.'))return;
    setBusy(id);
    try{await post('/api/operator/runs/'+encodeURIComponent(id)+'/cancel',{});setRevision(v=>v+1);}
    catch(e){setError(e instanceof Error?e.message:'Unable to stop task');}
    finally{setBusy(null);}
  }
  const ready=devices.filter(d=>d.online&&!d.paused).length;
  const fresh=realtime==='open'&&activeDevice?.online===true;
  const stats=fresh?activeDevice?.stats:null;
  const n=runs?.filter(r=>activeStatuses.has(r.status)).length;
  return <section className="glass mt-4 rounded-3xl p-4 sm:p-6" aria-label="HUKM control centre">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue/15 text-ice ring-1 ring-ice/20"><Activity size={21}/></span>
        <div><p className="text-[10px] font-semibold uppercase tracking-widest text-ice">Workspace overview</p><h2 className="font-display text-xl font-bold">Control Centre</h2><p className="text-xs text-ink2">Your computer, tasks and knowledge in one place.</p></div></div>
      <EmergencyStop/>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        {name:'Relay sync',value:realtime==='open'?'Live':'Reconnecting',icon:Activity},
        {name:'Ready devices',value:realtime==='open'?ready+'/'+devices.length:'—',icon:Laptop},
        {name:'Recent active tasks',value:error?'—':n??'—',icon:ListChecks},
        {name:'Pending approvals',value:realtime==='open'?approvals.length:'—',icon:ShieldCheck},
      ].map(m=><div key={m.name} className="min-w-0 rounded-2xl bg-field/50 p-3 ring-1 ring-line/10"><m.icon size={17} className="mb-2 text-ice"/><p className="break-words font-display text-lg font-bold">{m.value}</p><p className="text-xs text-ink2">{m.name}</p></div>)}
    </div>
    <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1.3fr]">
      <div className="min-w-0 rounded-2xl bg-field/35 p-4 ring-1 ring-line/10">
        <h3 className="font-semibold">Controller health</h3>
        <p className="mt-1 break-words text-sm">{activeDevice?.name??'No paired laptop'}</p>
        <p className="mb-3 text-xs text-ink2">{fresh?(activeDevice?.paused?'Paused':'Connected'):'Live telemetry unavailable'}{activeDevice?.controllerVersion?' · v'+activeDevice.controllerVersion:''}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['System CPU',metric(stats?.cpu,'%',100)],
            ['System RAM',metric(stats?.memory,'%',100)],
            ['HUKM CPU',metric(stats?.controllerCpuPercent,'%')],
            ['HUKM memory',metric(stats?.controllerMemoryMb,' MB')],
          ].map(([label,value])=><div key={label} className="min-w-0 rounded-xl bg-field/50 p-3"><p className="font-semibold tabular-nums">{value}</p><p className="text-xs text-ink2">{label}</p></div>)}
        </div>
        <p className="mt-3 text-xs text-ink2">Reported heartbeat values, not a performance benchmark. — means unavailable.</p>
        <Link className="btn-ghost mt-3 w-full text-xs" to="/devices">Manage devices <ArrowRight size={14}/></Link>
      </div>
      <div className="min-w-0 rounded-2xl bg-field/35 p-4 ring-1 ring-line/10">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Recent task runs</h3><button className="btn-ghost p-2" aria-label="Refresh tasks" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/></button></div>
        {error&&<p className="my-2 text-xs text-warn" role="status">{error}</p>}
        {!runs&&!error&&<p className="py-4 text-sm text-ink2">Loading task runs…</p>}
        {runs?.length===0&&<p className="py-4 text-sm text-ink2">No task runs yet. Start a reviewed plan in AI Chat or Skills.</p>}
        <div className="mt-2 space-y-2">{runs?.slice(0,4).map(r=><div key={r.id} className="rounded-xl bg-field/50 p-3">
          <div className="flex items-center justify-between gap-2"><span className={'text-xs font-semibold capitalize '+({ok:'text-ok',bad:'text-bad',warn:'text-warn',muted:'text-ink2'}[taskTone(r.status)])}>{r.status.replaceAll('_',' ')}</span><span className="text-xs text-ink2">{r.currentStep}/{r.totalSteps} steps</span></div>
          <div role="progressbar" aria-label="Task step progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskProgress(r.currentStep,r.totalSteps)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/20"><div className="h-full rounded-full bg-blue2" style={{width:taskProgress(r.currentStep,r.totalSteps)+'%'}}/></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-ink2">{new Date(r.updatedAt).toLocaleString()}</span>{activeStatuses.has(r.status)&&<button className="btn-ghost px-2 py-1 text-xs text-bad" disabled={!!busy||!!error} onClick={()=>void stop(r.id)}>Stop task</button>}</div>
        </div>)}</div>
        <p className="mt-3 text-[11px] text-ink2">{checkedAt?'Last checked '+checkedAt+' · ':''}Recent 40 runs only. Step progress does not prove the final app outcome.</p>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{links.map(item=><Link key={item.to} to={item.to} className="group min-w-0 rounded-2xl bg-field/45 p-3 ring-1 ring-line/15 transition hover:ring-ice/40">
      <div className="flex items-center justify-between"><item.icon size={19} className="text-ice"/><ArrowRight size={13} className="text-ink2"/></div><p className="mt-3 text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-ink2">{item.detail}</p>
    </Link>)}</div>
  </section>;
}
