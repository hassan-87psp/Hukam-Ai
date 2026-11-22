import {useEffect,useState} from 'react';
import {MonitorPlay,ShieldAlert,Square} from 'lucide-react';

type Status='connecting'|'awaiting_local_approval'|'live'|'ended'|'denied'|'error';
export function LiveScreenPanel({deviceId,onClose}:{deviceId:string;onClose:()=>void}){
  const [status,setStatus]=useState<Status>('connecting');
  const [reason,setReason]=useState('');
  const [frame,setFrame]=useState<string|null>(null);
  const [frames,setFrames]=useState(0);
  useEffect(()=>{
    const proto=window.location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(`${proto}//${window.location.host}/ws/client`);
    let liveSession='';
    let closed=false;
    ws.onopen=()=>ws.send(JSON.stringify({type:'live_screen.subscribe',deviceId,monitor:1}));
    ws.onmessage=(ev)=>{
      if(closed)return;
      try{
        const msg=JSON.parse(String(ev.data)) as Record<string,unknown>;
        if(msg.type==='live_screen.status' && msg.deviceId===deviceId){
          // Empty sessionId is an authorization/connection error.
          const name=msg.status as Status;
          if(!['awaiting_local_approval','live','ended','denied','error'].includes(name))return;
          if(typeof msg.sessionId==='string' && msg.sessionId)liveSession=msg.sessionId;
          setStatus(name);
          setReason(typeof msg.reason==='string'?msg.reason.slice(0,120):'');
          if(name!=='live')setFrame(null);
        }else if(msg.type==='live_screen.frame' && msg.deviceId===deviceId &&
          msg.sessionId===liveSession && liveSession && statusIsFrame(msg)){
          setFrame('data:image/jpeg;base64,'+msg.dataBase64);
          setFrames(n=>n+1);
        }
      }catch{/* Ignore malformed websocket events. */}
    };
    ws.onerror=()=>{if(!closed)setStatus('error');};
    ws.onclose=()=>{
      if(!closed){setStatus('ended');setReason('Connection closed');setFrame(null);}
    };
    return ()=>{
      closed=true;
      if(ws.readyState===WebSocket.OPEN)
        ws.send(JSON.stringify({type:'live_screen.unsubscribe'}));
      ws.close();
      setFrame(null);
    };
  },[deviceId]);
  const text={
    connecting:'Connecting to HUKM relay…',
    awaiting_local_approval:'Approve live viewing in the Windows popup on your laptop.',
    live:'LIVE · Monitor 1 · up to 90 seconds',
    ended:'Live screen stopped.',
    denied:'Windows owner did not approve live viewing.',
    error:'Live screen unavailable.'
  }[status];
  return <div className="space-y-3 rounded-xl border border-line/20 bg-field/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MonitorPlay className="h-4 w-4"/>
        <span>{text}</span>
      </div>
      <button type="button" className="btn-ghost" onClick={onClose}>
        <Square className="h-4 w-4"/> Stop / Close
      </button>
    </div>
    <div className="relative grid min-h-52 place-items-center overflow-hidden rounded-lg bg-black text-white">
      {status==='live'&&frame
        ? <img src={frame} className="block max-h-[55vh] w-full object-contain" alt="Live screen preview of your selected Windows monitor"/>
        : <p className="max-w-sm p-6 text-center text-sm text-white/70">{text}{reason?' '+reason:''}</p>}
      {status==='live'&&<span className="absolute left-2 top-2 rounded-md bg-red-600 px-2 py-1 text-xs font-bold">LIVE</span>}
    </div>
    <p className="flex items-start gap-2 text-xs text-ink2">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0"/>
      Read-only preview. HUKM does not store these frames or send them to Gemini.
      Separate approvals still apply for mouse, keyboard, WhatsApp Send and Calendar Save.
      {frames>0?' Frames displayed: '+frames+'.':''}
    </p>
  </div>;
}
function statusIsFrame(m:Record<string,unknown>):m is Record<string,unknown>&{dataBase64:string}{
  return m.mime==='image/jpeg' && typeof m.dataBase64==='string' &&
    m.dataBase64.length>=100&&m.dataBase64.length<=400000 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(m.dataBase64) &&
    typeof m.width==='number' && typeof m.height==='number';
}
