import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Check, ExternalLink, FolderKanban, MessageSquare, Plus, Save, Send, Trash2 } from 'lucide-react';
import { get, post, patch, del } from '../services/api';

type Project = {
  id:string; name:string; description:string; instructions:string;
  chromeProfile:string; chatgptProjectUrl:string; assetFolder:string;
  preferredDeviceId:string|null; createdAt:string; updatedAt:string;
};
type Note = {id:string;title:string;content:string;createdAt:string;updatedAt:string};
type Message = {id:string;role:'user'|'assistant';content:string;createdAt:string};
const empty = {name:'',description:'',instructions:'',chromeProfile:'',chatgptProjectUrl:'',assetFolder:''};
type Tab = 'chat'|'instructions'|'memory';
function errMsg(e:unknown) { return e instanceof Error ? e.message : String(e); }

export default function Projects(){
  const [items,setItems]=useState<Project[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [edit,setEdit]=useState({...empty});
  const [notes,setNotes]=useState<Note[]>([]);
  const [messages,setMessages]=useState<Message[]>([]);
  const [tab,setTab]=useState<Tab>('chat');
  const [draft,setDraft]=useState('');
  const [noteTitle,setNoteTitle]=useState('');
  const [noteContent,setNoteContent]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const project=items.find(p=>p.id===selected)??null;
  useEffect(()=>{ void get<Project[]>('/api/projects').then(data=>setItems(data)).catch(e=>setError(errMsg(e)));},[]);
  useEffect(()=>{
    if (!project){setEdit({...empty});setMessages([]);setNotes([]);return;}
    setEdit({name:project.name,description:project.description,instructions:project.instructions,
      chromeProfile:project.chromeProfile,chatgptProjectUrl:project.chatgptProjectUrl,
      assetFolder:project.assetFolder});
    setError('');
    let live=true;
    void Promise.all([get<Message[]>('/api/projects/'+project.id+'/messages'),
      get<Note[]>('/api/projects/'+project.id+'/notes')]).then(([m,n])=>{
      if(live){setMessages(m);setNotes(n);}
    }).catch(e=>{if(live)setError(errMsg(e));});
    return ()=>{live=false;};
  },[selected,project?.updatedAt]);

  async function create(){
    setSaving(true);setError('');
    try{
      const p=await post<Project>('/api/projects',{name:'New Project',description:'',instructions:''});
      setItems(v=>[p,...v]);setSelected(p.id);setTab('instructions');
    }catch(e){setError(errMsg(e));}
    finally{setSaving(false);}
  }
  async function save(){
    if(!project)return;
    setSaving(true);setError('');
    try{
      const p=await patch<Project>('/api/projects/'+project.id,edit);
      setItems(v=>v.map(x=>x.id===p.id?p:x));
    }catch(e){setError(errMsg(e));}
    finally{setSaving(false);}
  }
  async function remove(){
    if(!project||!confirm('Delete this project, its instructions, notes and chat history permanently?'))return;
    setSaving(true);setError('');
    try{
      await del('/api/projects/'+project.id);
      setItems(v=>v.filter(x=>x.id!==project.id));setSelected(null);
    }catch(e){setError(errMsg(e));}
    finally{setSaving(false);}
  }
  async function send(e:FormEvent){
    e.preventDefault();
    if(!project||!draft.trim()||busy)return;
    setBusy(true);setError('');
    const message=draft.trim();setDraft('');
    const optimistic:Message={id:'sending',role:'user',content:message,createdAt:new Date().toISOString()};
    setMessages(v=>[...v,optimistic]);
    try{
      const ai=await post<{reply:string}>('/api/projects/'+project.id+'/chat',{message});
      const saved=await get<Message[]>('/api/projects/'+project.id+'/messages');
      setMessages(saved);
      if(!ai.reply)setError('No AI response received');
    }catch(ex){
      setMessages(v=>v.filter(x=>x.id!=='sending'));setDraft(message);setError(errMsg(ex));
    }finally{setBusy(false);}
  }
  async function saveNote(e:FormEvent){
    e.preventDefault();if(!project||!noteTitle.trim())return;
    setSaving(true);setError('');
    try{
      const note=await post<Note>('/api/projects/'+project.id+'/notes',{title:noteTitle,content:noteContent});
      setNotes(v=>[note,...v]);setNoteTitle('');setNoteContent('');
    }catch(ex){setError(errMsg(ex));}
    finally{setSaving(false);}
  }
  async function deleteNote(id:string){
    if(!project||!confirm('Delete this saved note?'))return;
    try{await del('/api/projects/'+project.id+'/notes/'+id);setNotes(v=>v.filter(n=>n.id!==id));}
    catch(e){setError(errMsg(e));}
  }
  return <div className="mx-auto w-full max-w-7xl px-4 pb-32 pt-4 sm:px-6 lg:pb-12">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="font-display text-2xl font-bold">HUKM Projects</h1>
      <p className="text-sm text-ink2">Separate instructions, memory and conversations for each project. Saved securely on your relay.</p></div>
      <button className="btn-primary" onClick={()=>void create()} disabled={saving}><Plus size={17}/> New Project</button>
    </div>
    {error&&<div role="alert" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</div>}
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="glass rounded-2xl p-3">
        <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-ink2">Your Projects · {items.length}</p>
        {items.length===0&&<p className="px-2 py-5 text-sm text-ink2">Create your first project to save instructions and AI conversations.</p>}
        <div className="space-y-1">
          {items.map(p=><button key={p.id} type="button" onClick={()=>setSelected(p.id)}
            className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selected===p.id?'bg-blue/20 text-ink ring-1 ring-ice/40':'hover:bg-field/60'}`}>
            <FolderKanban className="h-5 w-5 shrink-0 text-ice"/>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-ink2">{p.description||'No description'}</span></span>
          </button>)}
        </div>
      </aside>
      {!project?<div className="glass flex min-h-[430px] flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center">
        <FolderKanban className="h-12 w-12 text-ice"/><h2 className="font-display text-xl font-bold">Select a Project</h2>
        <p className="max-w-md text-sm text-ink2">Project settings stay separate. Chat histories and notes are stored in your account and restored after a server restart.</p>
      </div>:
      <main className="glass min-w-0 rounded-2xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-display text-xl font-bold">{project.name}</h2><p className="text-xs text-ink2">Project-specific AI context and saved history</p></div>
          <div className="flex gap-2">
            {project.chatgptProjectUrl&&<a href={project.chatgptProjectUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-2 text-xs"><ExternalLink size={15}/> Open ChatGPT Project</a>}
            <button className="btn-ghost px-3 py-2 text-xs text-bad" onClick={()=>void remove()} disabled={saving} title="Delete Project"><Trash2 size={16}/></button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 border-b border-line/20 pb-3" role="tablist">
          {(['chat','instructions','memory'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t}
            onClick={()=>setTab(t)} className={`rounded-xl px-3 py-2 text-sm capitalize transition ${tab===t?'bg-blue text-white':'bg-field/60 text-ink2 hover:text-ink'}`}>
              {t==='chat'?<MessageSquare className="mr-1 inline h-4 w-4"/>:t==='memory'?<BookOpen className="mr-1 inline h-4 w-4"/>:<Save className="mr-1 inline h-4 w-4"/>}{t}
          </button>)}
        </div>
        {tab==='chat'&&<div>
          <p className="mb-3 text-xs text-ink2">Gemini uses this project's saved instructions and notes for conversation. This chat does not directly execute laptop actions.</p>
          <div className="scroll-thin mb-3 flex max-h-[55vh] min-h-[270px] flex-col gap-3 overflow-y-auto rounded-xl bg-field/30 p-3">
            {messages.length===0&&<p className="py-14 text-center text-sm text-ink2">Start a conversation in this Project. Messages will be saved here.</p>}
            {messages.map(m=><div key={m.id} className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.role==='user'?'self-end bg-blue text-white':'self-start bg-field ring-1 ring-line/15'}`}>{m.content}</div>)}
            {busy&&<span className="text-xs text-ink2">Gemini is responding…</span>}
          </div>
          <form onSubmit={e=>void send(e)} className="flex gap-2">
            <input className="field min-w-0 flex-1" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={1800} placeholder="Ask within this Project…" aria-label="Project message"/>
            <button type="submit" className="btn-primary" disabled={busy||!draft.trim()}><Send size={17}/> Send</button>
          </form>
        </div>}
        {tab==='instructions'&&<div className="space-y-4">
          <label className="block text-sm">Project name<input className="field mt-1 w-full" value={edit.name} maxLength={80} onChange={e=>setEdit(v=>({...v,name:e.target.value}))}/></label>
          <label className="block text-sm">Description<input className="field mt-1 w-full" value={edit.description} maxLength={400} onChange={e=>setEdit(v=>({...v,description:e.target.value}))}/></label>
          <label className="block text-sm">Permanent project instructions<textarea className="field mt-1 min-h-[160px] w-full" value={edit.instructions} maxLength={6000}
            onChange={e=>setEdit(v=>({...v,instructions:e.target.value}))} placeholder="Always use the selected brand guidelines, templates, content style…"/></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Chrome profile label<input className="field mt-1 w-full" value={edit.chromeProfile} maxLength={100}
              onChange={e=>setEdit(v=>({...v,chromeProfile:e.target.value}))} placeholder="PipSePaisa Chrome"/></label>
            <label className="block text-sm">Asset folder label<input className="field mt-1 w-full" value={edit.assetFolder} maxLength={350}
              onChange={e=>setEdit(v=>({...v,assetFolder:e.target.value}))} placeholder="Designs / PipSePaisa"/></label>
          </div>
          <label className="block text-sm">ChatGPT Project URL<input className="field mt-1 w-full" value={edit.chatgptProjectUrl} maxLength={500}
            onChange={e=>setEdit(v=>({...v,chatgptProjectUrl:e.target.value}))} placeholder="https://chatgpt.com/..."/></label>
          <p className="text-xs text-warn">Profile and folder labels are saved preferences, not yet automatic Chrome profile selection or local file access. Never save passwords or API keys here.</p>
          <button className="btn-primary" onClick={()=>void save()} disabled={saving||!edit.name.trim()}><Check size={16}/> Save instructions</button>
        </div>}
        {tab==='memory'&&<div>
          <p className="mb-3 text-xs text-ink2">Saved reference notes are reused as context for future Project conversations. Delete any note at any time.</p>
          <form onSubmit={e=>void saveNote(e)} className="mb-4 space-y-3 rounded-xl bg-field/40 p-3">
            <input className="field w-full" placeholder="Memory title, e.g. Brand palette" aria-label="Memory title" maxLength={120} value={noteTitle} onChange={e=>setNoteTitle(e.target.value)}/>
            <textarea className="field min-h-[100px] w-full" placeholder="Project reference or instruction…" aria-label="Memory content" maxLength={3500} value={noteContent} onChange={e=>setNoteContent(e.target.value)}/>
            <button className="btn-primary" type="submit" disabled={!noteTitle.trim()||saving}><Plus size={16}/> Save memory</button>
          </form>
          <div className="space-y-2">{notes.length===0&&<p className="py-4 text-sm text-ink2">No saved notes yet.</p>}
            {notes.map(n=><div key={n.id} className="rounded-xl bg-field/30 p-3 ring-1 ring-line/10">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{n.title}</strong>
                <button className="text-bad" title="Delete note" onClick={()=>void deleteNote(n.id)}><Trash2 size={15}/></button></div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink2">{n.content}</p>
            </div>)}
          </div>
        </div>}
      </main>}
    </div>
  </div>;
}
