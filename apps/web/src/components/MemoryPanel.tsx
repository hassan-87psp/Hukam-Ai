import {useEffect,useState,type FormEvent} from 'react';
import {get,post,patch,del} from '../services/api';

const categories=['personal','conversation','project','computer','skills','experience','contacts','routines'] as const;
const names:Record<typeof categories[number],string>={personal:'Personal preferences',conversation:'Conversation',project:'Project knowledge',computer:'Computer setup',skills:'Skills',experience:'Experience & corrections',contacts:'Contacts',routines:'Tasks & routines'};
type Entry={id:string;category:typeof categories[number];title:string;content:string;useInAI:boolean};
const blank={category:'personal' as Entry['category'],title:'',content:'',useInAI:false};

export default function MemoryPanel({projectId}:{projectId:string|null}){
  const [rows,setRows]=useState<Entry[]>([]);
  const [form,setForm]=useState({...blank});
  const [editing,setEditing]=useState<string|null>(null);
  const [filter,setFilter]=useState('');
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const base='/api/memory';
  const suffix=projectId?'?projectId='+encodeURIComponent(projectId):'';
  useEffect(()=>{let active=true;void get<Entry[]>(base+suffix).then(r=>{if(active)setRows(r);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[suffix]);
  async function save(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const item=editing?await patch<Entry>(base+'/'+editing+suffix,form):await post<Entry>(base+suffix,form);
      setRows(v=>[item,...v.filter(r=>r.id!==item.id)]);setEditing(null);setForm({...blank});
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function remove(id:string){
    if(busy||!confirm('Remove this memory from active records? Existing conversations and backups may still contain previous copies.'))return;
    setBusy(true);setError('');
    try{await del(base+'/'+id+suffix);setRows(v=>v.filter(r=>r.id!==id));if(editing===id){setEditing(null);setForm({...blank});}}catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const matches=rows.filter(r=>(!filter||r.category===filter)&& (r.title+' '+r.content).toLowerCase().includes(query.toLowerCase()));
  return <section className="mb-4 space-y-3 rounded-xl bg-field/40 p-3">
    <h3 className="font-semibold">{projectId?'Categorized project memory':'General account memory'}</h3>
    <p className="text-xs text-ink2">Eight memory categories. Saved only in this workspace. Enable AI context only for information you agree to send to Gemini. Never enter credentials or private messages.</p>
    {error&&<p role="alert" className="text-sm text-bad">{error}</p>}
    <form onSubmit={e=>void save(e)} className="space-y-2">
      <label className="block text-sm">Category<select className="field w-full" value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value as Entry['category']}))}>{categories.map(c=><option key={c} value={c}>{names[c]}</option>)}</select></label>
      <input className="field w-full" required maxLength={120} placeholder="Memory title" aria-label="Memory title" value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))}/>
      <textarea className="field w-full min-h-[90px]" required maxLength={1800} placeholder="Remember this reference or preference…" aria-label="Memory content" value={form.content} onChange={e=>setForm(v=>({...v,content:e.target.value}))}/>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.useInAI} onChange={e=>setForm(v=>({...v,useInAI:e.target.checked}))}/> Include in Gemini context for this workspace</label>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={busy} type="submit">{editing?'Update memory':'Save memory'}</button>{editing&&<button className="btn-ghost" type="button" onClick={()=>{setEditing(null);setForm({...blank});}}>Cancel</button>}</div>
    </form>
    <div className="grid gap-2 sm:grid-cols-2"><select className="field" aria-label="Filter memory category" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c} value={c}>{names[c]}</option>)}</select><input className="field" aria-label="Search memory" placeholder="Search memory" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <p className="text-xs text-ink2">{matches.length} of {rows.length} saved records</p>
    {matches.map(r=><article key={r.id} className="rounded-xl bg-field/50 p-3">
      <p className="text-xs text-ink2">{names[r.category]} · {r.useInAI?'AI context enabled':'Stored only'}</p><strong className="break-words text-sm">{r.title}</strong>
      <p className="whitespace-pre-wrap break-words text-sm">{r.content}</p>
      <div className="mt-2 flex gap-2"><button className="btn-ghost" disabled={busy} onClick={()=>{setEditing(r.id);setForm({category:r.category,title:r.title,content:r.content,useInAI:r.useInAI});}}>Edit</button><button className="btn-ghost text-bad" disabled={busy} onClick={()=>void remove(r.id)}>Remove</button></div>
    </article>)}
  </section>;
}
