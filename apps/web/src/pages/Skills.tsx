import {useEffect,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {get,post,del} from '../services/api';
import type {OperatorPlan} from '../services/store';
import OperatorPlanCard from '../features/agent/OperatorPlanCard';
type Recipe={id:string;title:string;category:string;steps:{action:string;args:Record<string,unknown>}[]};
type Taught={id:string;alias:string;skillId:string};
type Catalog={starter:Recipe[];taught:Taught[]};
function WorkspaceSkills({projectId}:{projectId:string}){
  const [data,setData]=useState<Catalog>({starter:[],taught:[]});
  const [query,setQuery]=useState('');
  const [alias,setAlias]=useState('');
  const [skillId,setSkillId]=useState('');
  const [correction,setCorrection]=useState('');
  const [share,setShare]=useState(false);
  const [plan,setPlan]=useState<OperatorPlan|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const scope=projectId?'?projectId='+encodeURIComponent(projectId):'';
  useEffect(()=>{let active=true;void get<Catalog>('/api/skills'+scope).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[scope]);
  async function preview(name:string){
    setBusy(true);setError('');setNotice('');
    try{setPlan(await post<OperatorPlan>('/api/skills/preview',{projectId:projectId||null,name}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function teach(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const item=await post<Taught>('/api/skills/teach'+scope,{alias,skillId});
      setData(v=>({...v,taught:[...v.taught,item]}));setAlias('');setNotice('Taught name saved. Nothing was executed.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function remove(id:string){
    if(!confirm('Remove this taught name? The original starter skill remains.'))return;
    setBusy(true);setError('');
    try{await del('/api/skills/taught/'+id+scope);setData(v=>({...v,taught:v.taught.filter(x=>x.id!==id)}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function learn(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      await post('/api/memory'+scope,{category:'experience',title:'Owner correction',content:correction,useInAI:share});
      setCorrection('');setShare(false);setNotice('Correction saved to this workspace. AI context is used only if you enabled it.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const matches=data.starter.filter(x=>(x.title+' '+x.category+' '+x.id).toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-4">
    {error&&<p className="text-sm text-bad" role="alert">{error}</p>}
    {notice&&<p className="text-sm text-ok" role="status">{notice}</p>}
    <section className="glass rounded-2xl p-4 space-y-3">
      <h2 className="font-semibold">Teach Mode</h2>
      <p className="text-xs text-ink2">Teach a short custom name for an existing safe recipe. Type "skill [your name]" in HUKM AI Chat or preview below. No recording, scripts, or extra privileges.</p>
      <form onSubmit={e=>void teach(e)} className="space-y-2">
        <input className="field w-full" required maxLength={80} placeholder="E.g. Morning inbox check" value={alias} onChange={e=>setAlias(e.target.value)} aria-label="Skill name"/>
        <select className="field w-full" required value={skillId} onChange={e=>setSkillId(e.target.value)} aria-label="Recipe"><option value="">Choose demonstrated recipe</option>{data.starter.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
        <button className="btn-primary" disabled={busy||!alias.trim()||!skillId}>Save taught name</button>
      </form>
      {data.taught.map(t=><div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-field/50 p-3"><span className="flex-1 text-sm">{t.alias}<span className="block text-xs text-ink2">{data.starter.find(s=>s.id===t.skillId)?.title??t.skillId}</span></span><button className="btn-ghost" disabled={busy} onClick={()=>void preview(t.alias)}>Review</button><button className="btn-ghost text-bad" disabled={busy} onClick={()=>void remove(t.id)}>Remove</button></div>)}
    </section>
    <section className="glass rounded-2xl p-4 space-y-3">
      <h2 className="font-semibold">Learn from a correction</h2>
      <p className="text-xs text-ink2">Save an explicit correction as experience memory for this workspace. This teaches preference context, not model retraining. No passwords, private messages or automatic recording.</p>
      <form onSubmit={e=>void learn(e)} className="space-y-2">
        <textarea className="field min-h-[100px] w-full" required maxLength={1800} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="What should HUKM do differently next time?" aria-label="Correction"/>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/> Use this correction in Gemini context</label>
        <button className="btn-primary" disabled={busy||!correction.trim()}>Save correction</button>
      </form>
      <Link className="text-xs text-ice" to="/projects">Manage and remove saved corrections in Memory</Link>
    </section>
    {plan&&<section className="glass rounded-2xl p-4"><OperatorPlanCard key={plan.id} plan={plan}/></section>}
    <section className="glass rounded-2xl p-4 space-y-3">
      <h2 className="font-semibold">Starter skills · {data.starter.length}</h2>
      <p className="text-xs text-ink2">Protocol-validated recipes. Actual results depend on your paired laptop, installed apps and approval.</p>
      <input className="field w-full" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills"/>
      <div className="grid gap-2 sm:grid-cols-2">{matches.map(r=><div key={r.id} className="rounded-xl bg-field/50 p-3 space-y-2">
        <p className="text-xs text-ink2">{r.category} · {r.steps.length} step(s)</p>
        <h3 className="text-sm font-semibold">{r.title}</h3>
        <button className="btn-ghost text-xs" disabled={busy} onClick={()=>void preview(r.id)}>Review task</button>
      </div>)}</div>
    </section>
  </div>;
}
export default function Skills(){
  const [projectId,setProjectId]=useState('');
  const [projects,setProjects]=useState<{id:string;name:string}[]>([]);
  useEffect(()=>{let active=true;void get<{id:string;name:string}[]>('/api/projects').then(p=>{if(active)setProjects(p);}).catch(()=>{});return()=>{active=false;};},[]);
  return <main className="mx-auto max-w-5xl px-4 py-4 pb-32">
    <h1 className="mb-2 font-display text-2xl font-bold">Skills & Teach Mode</h1>
    <p className="mb-4 text-sm text-ink2">Reusable, reviewed workflows and owner-controlled learning.</p>
    <label className="mb-4 block text-sm">Workspace<select className="field mt-1 w-full" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">General</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <WorkspaceSkills key={projectId||'general'} projectId={projectId}/>
  </main>;
}
