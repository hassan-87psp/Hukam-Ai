import {useEffect,useState} from 'react';
import {MonitorPlay,ShieldAlert,Square} from 'lucide-react';

type Status='idle'|'connecting'|'awaiting_local_approval'|'live'|'ended'|'denied'|'error';
export function LiveScreenPanel({deviceId,monitorCount,onClose}:{
  deviceId:string;monitorCount:number;onClose:()=>void;
}){
  const available=Number.isInteger(monitorCount)?Math.max(1,Math.min(16,monitorCount)):1;
  const [monitor,setMonitor]=useState(1);
  const [started,setStarted]=useState(false);
  const [status,setStatus]=useState<Status>('idle');
  const [reason,setReason]=useState('');
  const [frame,setFrame]=useState<string|null>(null);
  const [frames,setFrames]=useState(0);
  useEffect(()=>{
    if(!started)return;
    setStatus('connecting');
    setReason('');
    setFrame(null);
    setFrames(0);
    const proto=window.location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(`${proto}//${window.location.host}/ws/client`);
    let liveSession='';
    let closed=false;
    ws.onopen=()=>ws.send(JSON.stringify({type:'live_screen.subscribe',deviceId,monitor}));
    ws.onmessage=(ev)=>{
      if(closed)return;
      try{
        const msg=JSON.parse(String(ev.data)) as Record<string,unknown>;
        if(msg.type==='live_screen.status'&&msg.deviceId===deviceId){
          const name=msg.status as Status;
          if(!['awaiting_local_approval','live','ended','denied','error'].includes(name))return;
          if(typeof msg.monitor==='number' && msg.monitor!==monitor)return;
          if(typeof msg.sessionId==='string'&&msg.sessionId)liveSession=msg.sessionId;
          setStatus(name);
          setReason(typeof msg.reason==='string'?msg.reason.slice(0,120):'');
          if(name!=='live')setFrame(null);
          if(['ended','denied','error'].includes(name))setStarted(false);
        }else if(msg.type==='live_screen.frame'&&msg.deviceId===deviceId&&
          msg.monitor===monitor&&msg.sessionId===liveSession&&liveSession&&statusIsFrame(msg)){
          setFrame('data:image/jpeg;base64,'+msg.dataBase64);
          setFrames(n=>n+1);
        }
      }catch{/* Ignore malformed websocket events. */}
    };
    ws.onerror=()=>{
      if(!closed){setStatus('error');setReason('Live view connection error');setStarted(false);}
    };
    ws.onclose=()=>{
      if(!closed){setStatus('ended');setReason('Connection closed');setFrame(null);setStarted(false);}
    };
    return ()=>{
      closed=true;
      if(ws.readyState===WebSocket.OPEN)
        ws.send(JSON.stringify({type:'live_screen.unsubscribe'}));
      ws.close();
    };
  },[deviceId,monitor,started]);

  const text={
    idle:'Choose a monitor and start a live preview.',
    connecting:'Connecting to HUKM relay…',
    awaiting_local_approval:`Approve Monitor ${monitor} in the Windows popup on your laptop.`,
    live:`LIVE · Monitor ${monitor} · up to 90 seconds`,
    ended:'Live screen stopped.',
    denied:'Windows owner did not approve live viewing.',
    error:'Live screen unavailable.'
  }[status];

  return <div className="space-y-3 rounded-xl border border-line/20 bg-field/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MonitorPlay className="h-4 w-4"/><span>{text}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink2" htmlFor={'live-monitor-'+deviceId}>Display</label>
        <select id={'live-monitor-'+deviceId} className="input w-auto min-w-32 py-2"
          aria-label="Select Windows monitor" disabled={started}
          value={monitor} onChange={e=>setMonitor(Number(e.target.value))}>
          {Array.from({length:available},(_,i)=>i+1).map(i=>
            <option key={i} value={i}>Monitor {i}</option>)}
        </select>
        <button type="button" className="btn-primary"
          onClick={()=>{
            if(started){setStarted(false);setFrame(null);setStatus('ended');}
            else{setStarted(true);}
          }}>
          {started?<><Square className="h-4 w-4"/> Stop live</>:
            <><MonitorPlay className="h-4 w-4"/> Start live</>}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
    <div className="relative grid min-h-52 place-items-center overflow-hidden rounded-lg bg-black text-white">
      {status==='live'&&frame
        ? <img src={frame} className="block max-h-[55vh] w-full object-contain"
            alt={`Live preview of Windows monitor ${monitor}`}/>
        : <p className="max-w-sm p-6 text-center text-sm text-white/70">
            {text}{reason?' '+reason:''}</p>}
      {status==='live'&&<span className="absolute left-2 top-2 rounded-md bg-red-600 px-2 py-1 text-xs font-bold">LIVE</span>}
    </div>
    <p className="flex items-start gap-2 text-xs text-ink2">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0"/>
      The selected monitor is previewed only after separate Windows approval.
      Frames are not saved or sent to Gemini. Stop or Emergency Pause revokes viewing.
      Other computer actions still require their own approval.
      {frames>0?' Frames displayed: '+frames+'.':''}
    </p>
  </div>;
}
function statusIsFrame(m:Record<string,unknown>):m is Record<string,unknown>&{dataBase64:string}{
  return m.mime==='image/jpeg'&&typeof m.dataBase64==='string'&&
    m.dataBase64.length>=100&&m.dataBase64.length<=400000&&
    /^[A-Za-z0-9+/]+={0,2}$/.test(m.dataBase64)&&
    typeof m.width==='number'&&typeof m.height==='number';
}
