/** Curated recipes, not executable plugins. All plans revalidated by Operator. */
import type {ActionName} from '../../../packages/shared-types/src/index';
import {all,one,run,type DB,type Row} from './db';
import {HttpError} from './core';
import {newId,nowIso} from './util';
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
const map=(r:Row)=>({id:String(r.id),alias:String(r.alias),skillId:String(r.skill_id),projectId:r.project_id??null,createdAt:String(r.created_at)});
export class Skills{
  constructor(private db:DB){}
  list(userId:string,projectId:unknown){
    const p=projectScope(this.db,userId,projectId);
    return {starter:starterSkills(),taught:all(this.db,'SELECT * FROM taught_skills WHERE user_id=? AND project_id IS ? ORDER BY alias LIMIT 40',userId,p).map(map)};
  }
  teach(userId:string,projectId:unknown,body:unknown){
    const p=projectScope(this.db,userId,projectId);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'SKILL_BODY','Invalid skill');
    const b=body as Record<string,unknown>;
    if(Object.keys(b).some(k=>!['alias','skillId'].includes(k)))throw new HttpError(400,'SKILL_BODY','Teach Mode accepts a name and a known recipe only');
    const r=getRecipe(b.skillId),alias=aliasText(b.alias),key=alias.toLowerCase();
    if(RECIPES.some(x=>x.id===key))throw new HttpError(409,'SKILL_ALIAS','Name conflicts with a starter skill ID');
    if(one(this.db,'SELECT 1 FROM taught_skills WHERE user_id=? AND project_id IS ? AND alias_key=?',userId,p,key))
      throw new HttpError(409,'SKILL_ALIAS','Name already exists in this workspace; remove it before teaching a replacement');
    if(this.list(userId,p).taught.length>=40)throw new HttpError(400,'SKILL_LIMIT','Maximum 40 taught names per workspace');
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
    const row=one(this.db,'SELECT skill_id FROM taught_skills WHERE user_id=? AND project_id IS ? AND alias_key=?',userId,p,key);
    if(!row)throw new HttpError(404,'SKILL_NOT_FOUND','No matching skill in this workspace');
    return getRecipe(row.skill_id);
  }
}
