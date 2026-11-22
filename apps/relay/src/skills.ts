/** Curated recipes, not executable plugins. All plans revalidated by Operator. */
import type {ActionName} from '../../../packages/shared-types/src/index';
import {all,one,run,type DB,type Row} from './db';
import {HttpError} from './core';
import {newId,nowIso,parseJson} from './util';
import {validateCommand} from '../../../packages/command-protocol/src/index';
import {rejectCredentialText} from './memory-records';

type Step={action:ActionName;args:Record<string,unknown>};
export type Recipe={id:string;title:string;category:string;steps:Step[]};
const step=(action:ActionName,args:Record<string,unknown>={}):Step=>({action,args});
const recipe=(id:string,title:string,category:string,...steps:Step[]):Recipe=>({id,title,category,steps});

const apps=['chrome','edge','notepad','calculator','explorer','vscode','word','excel','powerpoint','paint'];
const folders=['downloads','documents','desktop','pictures','music','videos','home'];
const RECIPES:Recipe[]=[
  ...apps.map(app=>recipe('open-'+app,'Open '+app,'Applications',step('app.open',{app}))),
  ...folders.map(folder=>recipe('folder-'+folder,'Open '+folder+' folder','Folders',step('folder.open',{folder}))),
  ...['downloads','documents','desktop'].map(folder=>recipe('list-'+folder,'List '+folder,'Files',step('folder.list',{folder,limit:30}))),
  recipe('device-status','Check laptop status','System',step('device.status')),
  recipe('open-apps','List open applications','System',step('apps.list')),
  recipe('active-window','Identify active window','System',step('window.active')),
  recipe('find-pdfs','Find latest PDFs in Downloads','Files',step('file.search',{location:'downloads',ext:['pdf'],sort:'latest',limit:10})),
  recipe('find-spreadsheets','Find latest spreadsheets on Desktop','Files',step('file.search',{location:'desktop',ext:['xlsx','xls','csv'],sort:'latest',limit:10})),
  recipe('whatsapp-desktop','Open Personal WhatsApp Desktop','WhatsApp',step('whatsapp.open',{mode:'desktop'})),
  recipe('whatsapp-count','Open Personal WhatsApp and check unread count','WhatsApp',step('whatsapp.open',{mode:'desktop'}),step('whatsapp.check',{mode:'desktop'})),
  recipe('whatsapp-senders','Open Personal WhatsApp and review visible unread senders','WhatsApp',step('whatsapp.open',{mode:'desktop'}),step('whatsapp.unread_senders')),
  recipe('google-calendar-home','Open Google Calendar in browser','Calendar',step('web.open',{url:'https://calendar.google.com/calendar/u/0/r'})),
  recipe('chatgpt-home','Open ChatGPT in browser','AI Assistant',step('web.open',{url:'https://chatgpt.com/'})),
  recipe('gmail-home','Open Gmail in browser','Communications',step('web.open',{url:'https://mail.google.com/mail/u/0/'})),
  recipe('google-drive-home','Open Google Drive in browser','Files',step('web.open',{url:'https://drive.google.com/drive/u/0/my-drive'})),
  recipe('youtube-home','Open YouTube homepage','Browser',step('web.open',{url:'https://www.youtube.com/'})),
  recipe('notepad-numbers','Open Notepad and write numbers 1–9','Applications',step('app.open',{app:'notepad'}),step('notepad.type',{text:'1\n2\n3\n4\n5\n6\n7\n8\n9'})),
];
export function starterSkills():Recipe[]{return structuredClone(RECIPES);}
export function getRecipe(id:unknown):Recipe{
  const r=RECIPES.find(r=>r.id===id);
  if(!r)throw new HttpError(404,'SKILL_NOT_FOUND','Unknown starter skill');
  return structuredClone(r);
}
function projectScope(db:DB,userId:string,p:unknown):string|null{
  if(p==null)return null;
  if(typeof p!=='string'||!p||p.length>120)throw new HttpError(400,'SKILL_SCOPE','Invalid project');
  if(!one(db,'SELECT 1 FROM projects WHERE id=? AND user_id=?',p,userId))
    throw new HttpError(404,'PROJECT_NOT_FOUND','Project not found');
  return p;
}
function aliasText(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||value.length>80||/[\u0000-\u001f]/.test(value))throw new HttpError(400,'SKILL_ALIAS','Enter one short skill name');
  const alias=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!/^[\p{L}\p{M}\d][\p{L}\p{M}\d _-]{0,79}$/u.test(alias))throw new HttpError(400,'SKILL_ALIAS','Use only words, numbers, spaces or hyphens');
  rejectCredentialText(alias);
  return alias;
}
export function reusableSteps(value:unknown):Step[]{
  if(!Array.isArray(value)||value.length<1||value.length>5)
    throw new HttpError(422,'TEACH_UNSAFE','Choose a workflow with 1–5 supported steps');
  return value.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))
      throw new HttpError(422,'TEACH_UNSAFE','Invalid demonstrated step');
    const {action,args}=raw as Step;
    if(!args||typeof args!=='object'||Array.isArray(args))
      throw new HttpError(422,'TEACH_UNSAFE','Invalid demonstrated parameters');
    // No private query, path, prompt, contact, arbitrary URL, typed text,
    // mouse/keyboard replay, screenshot or irreversible action.
    const allowed=['app.open','folder.open','folder.list','device.status','apps.list','window.active','whatsapp.open','whatsapp.check'];
    if(!allowed.includes(action))
      throw new HttpError(422,'TEACH_UNSAFE','This workflow contains a step not eligible for reusable learning');
    const checked=validateCommand(action,args);
    if(!checked.ok)throw new HttpError(422,'TEACH_UNSAFE','Invalid saved action');
    if((action==='whatsapp.open'||action==='whatsapp.check')&&checked.args.mode!=='desktop')
      throw new HttpError(422,'TEACH_UNSAFE','Only Personal WhatsApp Desktop is supported');
    if(Object.keys(args).some(k=>!(k in checked.args)))
      throw new HttpError(422,'TEACH_UNSAFE','Unexpected demonstrated parameters');
    return {action,args:checked.args};
  });
}
const map=(r:Row)=>({id:String(r.id),alias:String(r.alias),skillId:String(r.skill_id),projectId:r.project_id??null,createdAt:String(r.created_at),workflow:r.workflow_steps!=null});
export class Skills{
  constructor(private db:DB){}
  list(userId:string,projectId:unknown){
    const p=projectScope(this.db,userId,projectId);
    return {starter:starterSkills(),taught:all(this.db,'SELECT * FROM taught_skills WHERE user_id=? AND project_id IS ? ORDER BY alias LIMIT 40',userId,p).map(map)};
  }
  demonstrations(userId:string,projectId:unknown){
    const p=projectScope(this.db,userId,projectId);
    const rows=all(this.db,`SELECT r.id,r.updated_at FROM operator_runs r JOIN operator_plans p ON p.id=r.plan_id
      WHERE r.user_id=? AND p.user_id=? AND p.project_id IS ? AND r.status = 'completed'
      ORDER BY r.updated_at DESC LIMIT 40`,userId,userId,p);
    const output:{id:string;updatedAt:string;steps:Step[]}[]=[];
    for(const row of rows){
      try{output.push({id:row.id,updatedAt:row.updated_at,steps:this.reviewedRun(userId,p,row.id)});}catch{}
      if(output.length>=15)break;
    }
    return output;
  }
  private reviewedRun(userId:string,p:string|null,id:unknown):Step[]{
    if(typeof id!=='string'||id.length>120)throw new HttpError(400,'TEACH_RUN','Select a demonstrated task');
    const row=one(this.db,`SELECT r.*,p.steps FROM operator_runs r JOIN operator_plans p ON p.id=r.plan_id
      WHERE r.id=? AND r.user_id=? AND p.user_id=? AND p.project_id IS ?`,id,userId,userId,p);
    if(!row||row.status!=='completed')
      throw new HttpError(422,'TEACH_RUN','Only verified completed tasks in the selected workspace are eligible');
    const steps=reusableSteps(parseJson(row.steps,null));
    const ids=parseJson<unknown>(row.command_ids,null);
    if(!Array.isArray(ids)||ids.length!==steps.length||row.current_step!==steps.length||row.total_steps!==steps.length||new Set(ids).size!==ids.length)
      throw new HttpError(422,'TEACH_RUN','Task evidence is incomplete');
    for(let i=0;i<steps.length;i++){
      const cmd=one(this.db,'SELECT * FROM commands WHERE id=? AND user_id=? AND client_request_id=?',ids[i],userId,id+'-'+i);
      if(!cmd||cmd.status!=='completed'||!cmd.dispatched_at||(cmd.requires_approval&&!cmd.approved_at)||cmd.action!==steps[i].action)
        throw new HttpError(422,'TEACH_RUN','A demonstrated step did not complete');
      const evidence=parseJson<Record<string,unknown>>(cmd.result,{});
      if(!cmd.result||!evidence||evidence.simulated===true||evidence.truncated===true)
        throw new HttpError(422,'TEACH_RUN','Simulated or incomplete results cannot be taught');
      const actual=reusableSteps([{action:cmd.action,args:parseJson(cmd.args,null)}])[0];
      if(JSON.stringify(actual.args)!==JSON.stringify(steps[i].args))
        throw new HttpError(422,'TEACH_RUN','Demonstrated action parameters changed');
    }
    return steps;
  }
  teachWorkflow(userId:string,projectId:unknown,body:unknown){
    const p=projectScope(this.db,userId,projectId);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'TEACH_RUN','Invalid workflow request');
    const b=body as Record<string,unknown>;
    if(Object.keys(b).some(k=>!['alias','runId','reviewed'].includes(k))||b.reviewed!==true)
      throw new HttpError(400,'TEACH_REVIEW','Review the demonstrated steps and confirm the actual outcome first');
    const steps=this.reviewedRun(userId,p,b.runId);
    const alias=aliasText(b.alias),key=alias.toLowerCase();
    this.checkNewAlias(userId,p,key);
    const id=newId('skill_');
    run(this.db,'INSERT INTO taught_skills(id,user_id,project_id,alias,alias_key,skill_id,created_at,workflow_steps) VALUES(?,?,?,?,?,?,?,?)',
      id,userId,p,alias,key,'workflow',nowIso(),JSON.stringify(steps));
    return map(one(this.db,'SELECT * FROM taught_skills WHERE id=? AND user_id=?',id,userId)!);
  }
  private checkNewAlias(userId:string,p:string|null,key:string){
    if(RECIPES.some(x=>x.id===key))throw new HttpError(409,'SKILL_ALIAS','Name conflicts with a starter skill ID');
    if(one(this.db,'SELECT 1 FROM taught_skills WHERE user_id=? AND project_id IS ? AND alias_key=?',userId,p,key))
      throw new HttpError(409,'SKILL_ALIAS','Name already exists in this workspace; remove it before teaching a replacement');
    if(this.list(userId,p).taught.length>=40)throw new HttpError(400,'SKILL_LIMIT','Maximum 40 taught names per workspace');
  }
  teach(userId:string,projectId:unknown,body:unknown){
    const p=projectScope(this.db,userId,projectId);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'SKILL_BODY','Invalid skill');
    const b=body as Record<string,unknown>;
    if(Object.keys(b).some(k=>!['alias','skillId'].includes(k)))throw new HttpError(400,'SKILL_BODY','Teach Mode accepts a name and a known recipe only');
    const r=getRecipe(b.skillId),alias=aliasText(b.alias),key=alias.toLowerCase();
    this.checkNewAlias(userId,p,key);
    const id=newId('skill_');
    run(this.db,'INSERT INTO taught_skills(id,user_id,project_id,alias,alias_key,skill_id,created_at) VALUES(?,?,?,?,?,?,?)',id,userId,p,alias,key,r.id,nowIso());
    return map(one(this.db,'SELECT * FROM taught_skills WHERE id=? AND user_id=?',id,userId)!);
  }
  remove(userId:string,projectId:unknown,id:string){
    const p=projectScope(this.db,userId,projectId);
    if(!run(this.db,'DELETE FROM taught_skills WHERE id=? AND user_id=? AND project_id IS ?',id,userId,p).changes)
      throw new HttpError(404,'SKILL_NOT_FOUND','Taught skill not found');
    return {ok:true};
  }
  resolve(userId:string,projectId:unknown,name:unknown):Recipe{
    const p=projectScope(this.db,userId,projectId),key=aliasText(name).toLowerCase();
    if(RECIPES.some(x=>x.id===key))return getRecipe(key);
    const row=one(this.db,'SELECT * FROM taught_skills WHERE user_id=? AND project_id IS ? AND alias_key=?',userId,p,key);
    if(!row)throw new HttpError(404,'SKILL_NOT_FOUND','No matching skill in this workspace');
    if(row.workflow_steps!=null)return recipe(row.id,'Taught workflow: '+row.alias,'Owner-reviewed workflow',...reusableSteps(parseJson(row.workflow_steps,null)));
    return getRecipe(row.skill_id);
  }
}
