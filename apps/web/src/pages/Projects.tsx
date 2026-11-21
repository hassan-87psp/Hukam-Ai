import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Check, ExternalLink, FolderKanban, Laptop, ListTodo, MessageSquare, Pencil, Plus, RefreshCw, Save, Search, Send, Trash2, X } from 'lucide-react';
import { get, post, patch, del } from '../services/api';
import { useStore } from '../services/store';

type Project = {
  id:string; name:string; description:string; instructions:string;
  chromeProfile:string; chatgptProjectUrl:string; assetFolder:string;
  preferredDeviceId:string|null; createdAt:string; updatedAt:string;
};
type Note = {id:string;title:string;content:string;createdAt:string;updatedAt:string};
type Message = {id:string;role:'user'|'assistant';content:string;createdAt:string};
type Task = {id:string;planId:string|null;summary:string;deviceId:string|null;status:string;
  currentStep:number;totalSteps:number;createdAt:string;updatedAt:string;error:string|null};
const empty = {name:'',description:'',instructions:'',chromeProfile:'',chatgptProjectUrl:'',assetFolder:'',preferredDeviceId:null as string|null};
type Tab = 'chat'|'instructions'|'memory'|'tasks';
function errMsg(e:unknown) { return e instanceof Error ? e.message : String(e); }

export default function Projects(){
  const {runAction,devices}=useStore();
  const navigate=useNavigate();
  const [items,setItems]=useState<Project[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [edit,setEdit]=useState({...empty});
  const [notes,setNotes]=useState<Note[]>([]);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [taskFilter,setTaskFilter]=useState<'all'|'active'|'finished'>('all');
  const [noteSearch,setNoteSearch]=useState('');
  const [projectSearch,setProjectSearch]=useState('');
  const [editingNoteId,setEditingNoteId]=useState<string|null>(null);
  const selectedRef=useRef<string|null>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [tab,setTab]=useState<Tab>('chat');
  const [draft,setDraft]=useState('');
  const [noteTitle,setNoteTitle]=useState('');
  const [noteContent,setNoteContent]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  selectedRef.current=selected;
  const project=items.find(p=>p.id===selected)??null;
  const filteredNotes=useMemo(()=>notes.filter(n=>(n.title+' '+n.content).toLowerCase().includes(noteSearch.toLowerCase().trim())),[notes,noteSearch]);
  const filteredTasks=useMemo(()=>tasks.filter(t=>taskFilter==='all'
    ||(taskFilter==='active'?['queued','running','awaiting_approval'].includes(t.status)
      :['completed','unverified','failed','cancelled','interrupted'].includes(t.status))),[tasks,taskFilter]);
  const activeTasks=tasks.filter(t=>['queued','running','awaiting_approval'].includes(t.status)).length;
  useEffect(()=>{ void get<Project[]>('/api/projects').then(data=>{
    setItems(data);
    setSelected(current=>current??data[0]?.id??null);
  }).catch(e=>setError(errMsg(e)));},[]);
  useEffect(()=>{
    if (!project){setEdit({...empty});setMessages([]);setNotes([]);setTasks([]);return;}
    // Drop the old project's visible data immediately; slow API responses
    // must never display memory, chat or tasks in another project.
    setMessages([]);setNotes([]);setTasks([]);
    setEditingNoteId(null);setNoteSearch('');setNoteTitle('');setNoteContent('');setDraft('');
    setEdit({name:project.name,description:project.description,instructions:project.instructions,
      chromeProfile:project.chromeProfile,chatgptProjectUrl:project.chatgptProjectUrl,
      assetFolder:project.assetFolder,preferredDeviceId:project.preferredDeviceId});
    setError('');
    let live=true;
    void Promise.all([get<Message[]>('/api/projects/'+project.id+'/messages'),
      get<Note[]>('/api/projects/'+project.id+'/notes'),
      get<Task[]>('/api/projects/'+project.id+'/tasks')]).then(([m,n,t])=>{
      if(live&&selectedRef.current===project.id){setMessages(m);setNotes(n);setTasks(t);}
    }).catch(e=>{if(live&&selectedRef.current===project.id)setError(errMsg(e));});
    return ()=>{live=false;};
  },[selected,project?.updatedAt]);

  useEffect(()=>{
    if(!selected||tab!=='tasks')return;
    let live=true;
    const refresh=()=>{
      void get<Task[]>('/api/projects/'+selected+'/tasks')
        .then(rows=>{if(live&&selectedRef.current===selected)setTasks(rows);})
        .catch(()=>{}); // Keep last valid task snapshot on transient network loss.
    };
    refresh();
    const timer=window.setInterval(refresh,4000);
    return ()=>{live=false;window.clearInterval(timer);};
  },[selected,tab]);

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
    const projectId=project.id;
    const message=draft.trim();setDraft('');
    const optimistic:Message={id:'sending',role:'user',content:message,createdAt:new Date().toISOString()};
    setMessages(v=>[...v,optimistic]);
    try{
      const ai=await post<{reply:string}>('/api/projects/'+projectId+'/chat',{message});
      const saved=await get<Message[]>('/api/projects/'+projectId+'/messages');
      if(selectedRef.current===projectId){
        setMessages(saved);
        if(!ai.reply)setError('No AI response received');
      }
    }catch(ex){
      if(selectedRef.current===projectId){
        setMessages(v=>v.filter(x=>x.id!=='sending'));setDraft(message);setError(errMsg(ex));
      }
    }finally{setBusy(false);}
  }
  async function saveNote(e:FormEvent){
    e.preventDefault();if(!project||!noteTitle.trim())return;
    setSaving(true);setError('');
    const projectId=project.id;
    try{
      const note=editingNoteId
        ?await patch<Note>('/api/projects/'+projectId+'/notes/'+editingNoteId,{title:noteTitle,content:noteContent})
        :await post<Note>('/api/projects/'+projectId+'/notes',{title:noteTitle,content:noteContent});
      if(selectedRef.current===projectId){
        setNotes(v=>[note,...v.filter(n=>n.id!==note.id)]);setNoteTitle('');setNoteContent('');setEditingNoteId(null);
      }
    }catch(ex){if(selectedRef.current===projectId)setError(errMsg(ex));}
    finally{setSaving(false);}
  }
  async function deleteNote(id:string){
    if(!project||!confirm('Delete this saved note?'))return;
    const projectId=project.id;
    try{await del('/api/projects/'+projectId+'/notes/'+id);
      if(selectedRef.current===projectId)setNotes(v=>v.filter(n=>n.id!==id));
    }catch(e){if(selectedRef.current===projectId)setError(errMsg(e));}
  }
  async function clearMessages(){
    if(!project||!confirm('Clear only this project conversation? Permanent notes and tasks will remain.'))return;
    const projectId=project.id;
    setSaving(true);setError('');
    try{await del('/api/projects/'+projectId+'/messages');
      if(selectedRef.current===projectId)setMessages([]);
    }catch(e){if(selectedRef.current===projectId)setError(errMsg(e));}
    finally{setSaving(false);}
  }
  async function cancelTask(id:string){
    if(!project||!confirm('Stop this project task? Already executed steps cannot be undone.'))return;
    const projectId=project.id;
    try{
      await post('/api/operator/runs/'+id+'/cancel',{});
      const rows=await get<Task[]>('/api/projects/'+projectId+'/tasks');
      if(selectedRef.current===projectId)setTasks(rows);
    }catch(e){if(selectedRef.current===projectId)setError(errMsg(e));}
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
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-field/50 px-3 ring-1 ring-line/10">
          <Search size={15} className="shrink-0 text-ink2"/>
          <input className="w-full bg-transparent py-2.5 text-sm outline-none" type="search"
            value={projectSearch} onChange={e=>setProjectSearch(e.target.value)}
            placeholder="Find a project…" aria-label="Search project workspaces"/>
        </div>
        {items.length===0&&<p className="px-2 py-5 text-sm text-ink2">Create your first project to save instructions and AI conversations.</p>}
        <div className="space-y-1">
          {items.filter(p=>(p.name+' '+p.description).toLowerCase().includes(projectSearch.toLowerCase().trim())).map(p=><button key={p.id} type="button" onClick={()=>setSelected(p.id)}
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
          <div><h2 className="font-display text-xl font-bold">{project.name}</h2><p className="text-xs text-ink2">Isolated chat · {notes.length} memory notes · {tasks.length} recent tasks</p></div>
          <div className="flex gap-2">
            <Link to={'/chat?projectId='+encodeURIComponent(project.id)} className="btn-primary px-3 py-2 text-xs">
              <MessageSquare size={15}/> Run HUKM Task
            </Link>
            {project.chatgptProjectUrl&&<button onClick={()=>void (async()=>{
                const out=await runAction('browser.profile_open',{
                  url:project.chatgptProjectUrl, profile:project.chromeProfile
                },{label:'Open '+project.name+' in Chrome profile '+project.chromeProfile});
                if(out) navigate('/chat?projectId='+encodeURIComponent(project.id));
              })()}
              disabled={!/^(?:Default|Profile [1-9][0-9]?)$/.test(project.chromeProfile)}
              title="Requires Default or Profile N configured in this Project"
              className="btn-ghost px-3 py-2 text-xs"><ExternalLink size={15}/> Open in saved Chrome profile</button>}
            <button className="btn-ghost px-3 py-2 text-xs text-bad" onClick={()=>void remove()} disabled={saving} title="Delete Project"><Trash2 size={16}/></button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 border-b border-line/20 pb-3" role="tablist">
          {(['chat','tasks','instructions','memory'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t}
            onClick={()=>setTab(t)} className={`rounded-xl px-3 py-2 text-sm capitalize transition ${tab===t?'bg-blue text-white':'bg-field/60 text-ink2 hover:text-ink'}`}>
              {t==='chat'?<MessageSquare className="mr-1 inline h-4 w-4"/>:t==='tasks'?<ListTodo className="mr-1 inline h-4 w-4"/>:t==='memory'?<BookOpen className="mr-1 inline h-4 w-4"/>:<Save className="mr-1 inline h-4 w-4"/>}{t}
          </button>)}
        </div>
        {tab==='chat'&&<div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-ink2">Isolated Gemini conversation. To operate the laptop, use Run HUKM Task.</p>
            {messages.length>0&&<button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={()=>void clearMessages()} disabled={saving}>
              <Trash2 size={13}/> Clear chat
            </button>}
          </div>
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
        {tab==='tasks'&&<div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-field/60 px-3 py-4 text-center ring-1 ring-line/10">
              <div className="text-xl font-bold">{tasks.length}</div><div className="text-xs text-ink2">Recent tasks</div>
            </div>
            <div className="rounded-2xl bg-field/60 px-3 py-4 text-center ring-1 ring-line/10">
              <div className="text-xl font-bold text-ice">{activeTasks}</div><div className="text-xs text-ink2">Active</div>
            </div>
            <div className="rounded-2xl bg-field/60 px-3 py-4 text-center ring-1 ring-line/10">
              <div className="text-xl font-bold text-ok">{tasks.filter(t=>t.status==='completed').length}</div><div className="text-xs text-ink2">Verified complete</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {(['all','active','finished'] as const).map(value=><button key={value} type="button"
                aria-pressed={taskFilter===value} onClick={()=>setTaskFilter(value)}
                className={`rounded-xl px-3 py-2 text-xs capitalize transition ${taskFilter===value?'bg-blue text-white':'bg-field/60 text-ink2 hover:text-ink'}`}>
                {value}
              </button>)}
            </div>
            <button className="btn-ghost px-3 py-2 text-xs" type="button" onClick={()=>void get<Task[]>('/api/projects/'+project.id+'/tasks')
              .then(rows=>{if(selectedRef.current===project.id)setTasks(rows);})
              .catch(e=>{if(selectedRef.current===project.id)setError(errMsg(e));})}>
              <RefreshCw size={14}/> Refresh
            </button>
          </div>
          <div className="space-y-2">
            {filteredTasks.length===0&&<div className="rounded-2xl bg-field/30 p-6 text-center text-sm text-ink2">No {taskFilter==='all'?'task runs':taskFilter} in this project yet. Use Run HUKM Task above to create a reviewed task plan.</div>}
            {filteredTasks.map(task=><div key={task.id} className="rounded-2xl bg-field/40 p-4 ring-1 ring-line/15">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">{task.summary||'Project task'}</p>
                  <p className="mt-1 text-xs text-ink2">{new Date(task.createdAt).toLocaleString()} · Step {task.currentStep}/{task.totalSteps}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${task.status==='completed'?'bg-ok/10 text-ok':task.status==='failed'?'bg-bad/10 text-bad':task.status==='unverified'?'bg-warn/10 text-warn':'bg-blue/15 text-ice'}`}>{task.status.replace(/_/g,' ')}</span>
              </div>
              {task.error&&<p className="mt-2 break-words text-xs text-warn">{task.error}</p>}
              {['queued','running','awaiting_approval'].includes(task.status)&&<button type="button"
                className="btn-ghost mt-3 px-3 py-1.5 text-xs text-bad" onClick={()=>void cancelTask(task.id)}>
                <X size={13}/> Stop task
              </button>}
            </div>)}
          </div>
          <p className="text-xs text-ink2">Tasks are scoped to this project and owner. “Unverified” means input may have occurred, but the final laptop/app outcome was not independently confirmed.</p>
        </div>}
        {tab==='instructions'&&<div className="space-y-4">
          <label className="block text-sm">Project name<input className="field mt-1 w-full" value={edit.name} maxLength={80} onChange={e=>setEdit(v=>({...v,name:e.target.value}))}/></label>
          <label className="block text-sm">Description<input className="field mt-1 w-full" value={edit.description} maxLength={400} onChange={e=>setEdit(v=>({...v,description:e.target.value}))}/></label>
          <label className="block text-sm">Permanent project instructions<textarea className="field mt-1 min-h-[160px] w-full" value={edit.instructions} maxLength={6000}
            onChange={e=>setEdit(v=>({...v,instructions:e.target.value}))} placeholder="Always use the selected brand guidelines, templates, content style…"/></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Chrome profile directory<input className="field mt-1 w-full" value={edit.chromeProfile} maxLength={100}
              onChange={e=>setEdit(v=>({...v,chromeProfile:e.target.value}))} placeholder="Profile 1 or Default"/></label>
            <label className="block text-sm">Asset folder label<input className="field mt-1 w-full" value={edit.assetFolder} maxLength={350}
              onChange={e=>setEdit(v=>({...v,assetFolder:e.target.value}))} placeholder="Designs / PipSePaisa"/></label>
          </div>
          <label className="block text-sm">Preferred Windows laptop
            <select className="field mt-1 w-full" value={edit.preferredDeviceId??''}
              onChange={e=>setEdit(v=>({...v,preferredDeviceId:e.target.value||null}))}>
              <option value="">Use available paired laptop (ask if needed)</option>
              {devices.map(d=><option key={d.id} value={d.id}>{d.name}{d.online&&!d.paused?' — online':d.paused?' — paused':' — offline'}</option>)}
            </select>
            <span className="mt-1 flex items-center gap-1 text-xs text-ink2"><Laptop size={13}/> Only paired devices are accepted by HUKM. Device permissions still apply.</span>
          </label>
          <label className="block text-sm">ChatGPT Project URL<input className="field mt-1 w-full" value={edit.chatgptProjectUrl} maxLength={500}
            onChange={e=>setEdit(v=>({...v,chatgptProjectUrl:e.target.value}))} placeholder="https://chatgpt.com/..."/></label>
          <p className="text-xs text-warn">Use the actual Chrome profile directory (Default or Profile 1–99), not the display name. Profile must exist on this Windows PC. Folder path is a saved preference, not yet authorized file access. Never save passwords or API keys here.</p>
          <button className="btn-primary" onClick={()=>void save()} disabled={saving||!edit.name.trim()}><Check size={16}/> Save instructions</button>
        </div>}
        {tab==='memory'&&<div>
          <p className="mb-3 text-xs text-ink2">Saved reference notes are reused as context for future Project conversations. Delete any note at any time.</p>
          <form onSubmit={e=>void saveNote(e)} className="mb-4 space-y-3 rounded-xl bg-field/40 p-3">
            <input className="field w-full" placeholder="Memory title, e.g. Brand palette" aria-label="Memory title" maxLength={120} value={noteTitle} onChange={e=>setNoteTitle(e.target.value)}/>
            <textarea className="field min-h-[100px] w-full" placeholder="Project reference or instruction…" aria-label="Memory content" maxLength={3500} value={noteContent} onChange={e=>setNoteContent(e.target.value)}/>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" type="submit" disabled={!noteTitle.trim()||saving}><Plus size={16}/> {editingNoteId?'Update memory':'Save memory'}</button>
              {editingNoteId&&<button className="btn-ghost" type="button" onClick={()=>{setEditingNoteId(null);setNoteTitle('');setNoteContent('');}}><X size={15}/> Cancel editing</button>}
            </div>
          </form>
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-field/40 px-3 ring-1 ring-line/10">
            <Search size={15} className="text-ink2"/><input className="w-full bg-transparent py-3 text-sm outline-none" type="search"
              value={noteSearch} onChange={e=>setNoteSearch(e.target.value)} placeholder="Search saved memory…"
              aria-label="Search project memory"/>
          </div>
          <div className="space-y-2">{notes.length===0&&<p className="py-4 text-sm text-ink2">No saved notes yet.</p>}
            {notes.length>0&&filteredNotes.length===0&&<p className="py-4 text-sm text-ink2">No notes match this search.</p>}
            {filteredNotes.map(n=><div key={n.id} className="rounded-xl bg-field/30 p-3 ring-1 ring-line/10">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{n.title}</strong>
                <div className="flex items-center gap-2">
                  <button className="text-ice" title="Edit note" aria-label={'Edit '+n.title} onClick={()=>{setEditingNoteId(n.id);setNoteTitle(n.title);setNoteContent(n.content);}}><Pencil size={15}/></button>
                  <button className="text-bad" title="Delete note" aria-label={'Delete '+n.title} onClick={()=>void deleteNote(n.id)}><Trash2 size={15}/></button>
                </div></div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink2">{n.content}</p>
            </div>)}
          </div>
        </div>}
      </main>}
    </div>
  </div>;
}
