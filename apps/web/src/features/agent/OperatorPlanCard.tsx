import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ListChecks, Play, Square, ShieldAlert } from 'lucide-react';
import { get, post } from '../../services/api';
import { useStore, type OperatorPlan } from '../../services/store';
import CommandCard from '../command/CommandCard';

type TaskRun = {
  id:string;planId:string|null;deviceId:string|null;status:string;
  currentStep:number;totalSteps:number;commandIds:string[];error:string|null;
};

const finished=new Set(['completed','unverified','failed','cancelled','interrupted']);

export default function OperatorPlanCard({plan}:{plan:OperatorPlan}){
  const [running,setRunning]=useState<TaskRun|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const {commandMap,activeDevice}=useStore();
  useEffect(()=>{
    if(!running||finished.has(running.status))return;
    let on=true;
    const timer=setInterval(()=>{
      void get<TaskRun>('/api/operator/runs/'+running.id)
        .then(next=>{if(on)setRunning(next);})
        .catch(e=>{if(on)setError(e instanceof Error?e.message:String(e));});
    },1100);
    return ()=>{on=false;clearInterval(timer);};
  },[running?.id,running?.status]);
  async function start(){
    setBusy(true);setError('');
    try{
      const out=await post<TaskRun>('/api/operator/plans/'+plan.id+'/run',
        {deviceId:activeDevice?.id??undefined});
      setRunning(out);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function cancel(){
    if(!running)return;
    setBusy(true);
    try{setRunning(await post<TaskRun>('/api/operator/runs/'+running.id+'/cancel'));}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  const cmdId=running?.commandIds.at(-1);
  const command=cmdId?commandMap.get(cmdId):undefined;
  return <div className="max-w-[92%] rounded-2xl border border-ice/20 bg-field/40 p-4 pl-4 ring-1 ring-line/10">
    <div className="mb-2 flex items-center gap-2 font-semibold"><ListChecks size={18} className="text-ice"/> Proposed computer task</div>
    <p className="mb-3 text-sm">{plan.summary}</p>
    <ol className="mb-3 list-inside list-decimal space-y-2 text-sm text-ink2">
      {plan.steps.map((s,i)=><li key={i}><span className="font-medium text-ink">{s.action}</span>
        <span className="ml-1 break-words text-xs">{
          s.action==='notepad.type'?String(s.args.text??'') :
          s.action==='browser.control'?JSON.stringify(s.args) :
          s.action==='app.open'?String(s.args.app??'') :
          s.action==='web.open'?String(s.args.url??'') :
          s.action==='web.search'?String(s.args.query??'') :
          JSON.stringify(s.args)
        }</span>
      </li>)}
    </ol>
    <p className="mb-3 flex items-start gap-2 text-xs text-warn"><ShieldAlert size={15} className="shrink-0"/>
      AI only suggested these steps. HUKM validates them and asks separate approval for keyboard input and sensitive actions. Website results may remain unverified.
    </p>
    {!running?<button disabled={busy||Date.parse(plan.expiresAt)<Date.now()} onClick={()=>void start()} className="btn-primary text-sm">
      <Play size={16}/> {busy?'Starting…':'Review accepted — Run on laptop'}
    </button>:
    <div className="space-y-2">
      <p className="text-sm font-medium">Status: <span className={finished.has(running.status)?'text-ice':'text-warn'}>{running.status.replaceAll('_',' ')}</span>
        <span className="ml-2 text-xs text-ink2">{running.currentStep}/{running.totalSteps} steps</span>
      </p>
      {running.error&&<p role="status" className="text-xs text-warn">{running.error}</p>}
      {running.status==='awaiting_approval'&&<p className="flex items-center gap-2 text-xs text-warn">
        <ShieldAlert size={15}/> Review and approve the exact action below (or in Notifications).</p>}
      {command&&<div className="my-2"><CommandCard c={command}/></div>}
      {!finished.has(running.status)?<button disabled={busy} onClick={()=>void cancel()} className="btn-ghost text-sm">
        <Square size={15}/> Stop task</button>:
        <p className="flex items-center gap-2 text-xs text-ink2">{running.status==='completed'?<CheckCircle2 size={15}/>:<CircleAlert size={15}/>}
        {running.status==='unverified'?'Inputs completed, but the actual on-screen result still needs verification.':
          running.status==='completed'?'Task actions reported verified success.':'Task ended without a verified completion.'}</p>}
    </div>}
    {error&&<p className="mt-3 text-xs text-bad">{error}</p>}
  </div>;
}
