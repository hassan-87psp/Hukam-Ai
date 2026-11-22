import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {openDb,one,run} from '../src/db';
import {Operator} from '../src/operator';
import {Projects} from '../src/projects';
import type {Relay} from '../src/core';
import {
  CHATGPT_REVIEWED_PREFIX,CHATGPT_SENDING_PREFIX,CHATGPT_SUBMITTED_PREFIX,
  CHATGPT_VISIBLE_PREFIX,isChatGPTReadIntent,isChatGPTContextFollowup,
} from '../src/chatgpt-dialogue';

const initial={prompt:'Explain VSA in Roman Urdu',profile:'Default',projectUrl:'https://chatgpt.com/'};
const threadUrl='https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2';
async function fixture<T>(f:(operator:Operator,db:ReturnType<typeof openDb>,projects:Projects)=>Promise<T>):Promise<T>{
  const dir=mkdtempSync(join(tmpdir(),'hukm-chatgpt-followup-'));
  const db=openDb(dir,resolve(process.cwd(),'database/migrations'));
  try{
    for(const id of ['owner','other']){
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,id+'@example.test',id,'dummy',new Date().toISOString());
    }
    const projects=new Projects(db);
    return await f(new Operator(db,{} as Relay,projects),db,projects);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
function pending(db:ReturnType<typeof openDb>,user:string,project:string|null,prefix:string,data:unknown){
  const now=new Date().toISOString();
  const expiry=new Date(Date.now()+10*60_000).toISOString();
  run(db,
    "INSERT INTO operator_dialogues(user_id,project_key,request,question,topic,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,project_key) DO UPDATE SET request=excluded.request,expires_at=excluded.expires_at",
    user,project??'general',prefix+JSON.stringify(data),'HUKM follow-up', 'operator-followup',
    now,now,expiry);
}

describe('HUKM natural ChatGPT response and follow-up memory',()=>{
  it('knows natural Roman Urdu reply and referential follow-ups',()=>{
    for(const q of ['Jawab batao','ChatGPT ka answer read','usne kya kaha?','haan'])
      expect(isChatGPTReadIntent(q)).toBe(true);
    for(const q of ['Usko detail mein samjhao','Isko short karo','Same answer English mein likho'])
      expect(isChatGPTContextFollowup(q)).toBe(true);
    expect(isChatGPTContextFollowup('WhatsApp ko bhejo')).toBe(false);
    expect(isChatGPTContextFollowup('PipSePaisa password delete karo')).toBe(false);
  });
  it('only a reviewed exact prior prompt may produce the separately approved Send plan',async()=>fixture(async(op,db)=>{
    pending(db,'owner',null,CHATGPT_REVIEWED_PREFIX,initial);
    const planned=await op.plan('owner','haan bhej do',null);
    if(!('steps' in planned))throw Error('expected reviewed send');
    expect(planned.steps).toEqual([{action:'chatgpt.submit_prompt',args:{
      projectUrl:initial.projectUrl,prompt:initial.prompt}}]);
    const row=one(db,'SELECT request FROM operator_dialogues WHERE user_id=?','owner');
    expect(String(row?.request)).toContain(CHATGPT_SENDING_PREFIX);
    expect(String(row?.request)).not.toContain('responseText');
    const premature=await op.plan('owner','Jawab batao',null);
    expect('question' in premature && premature.question).toContain('Task History');
  }));
  it('submitted prompt routes answer-read to same exact target but cannot read other users',async()=>fixture(async(op,db)=>{
    pending(db,'owner',null,CHATGPT_SUBMITTED_PREFIX,initial);
    const planned=await op.plan('owner','Jawab batao',null);
    if(!('steps' in planned))throw Error('expected read plan');
    expect(planned.steps).toEqual([{action:'chatgpt.read_response',args:{
      projectUrl:initial.projectUrl,prompt:initial.prompt}}]);
    expect(one(db,'SELECT request FROM operator_dialogues WHERE user_id=?','other')).toBeUndefined();
  }));
  it('visible thread metadata produces a draft-only follow-up without automatic Send',async()=>fixture(async(op,db)=>{
    pending(db,'owner',null,CHATGPT_VISIBLE_PREFIX,{...initial,threadUrl});
    const planned=await op.plan('owner','Usko detail mein samjhao',null);
    if(!('steps' in planned))throw Error('expected follow-up plan');
    expect(planned.steps).toEqual([{action:'chatgpt.followup_draft',args:{
      projectUrl:threadUrl,previousPrompt:initial.prompt,prompt:'Usko detail mein samjhao'}}]);
    const row=one(db,'SELECT request FROM operator_dialogues WHERE user_id=?','owner');
    expect(String(row?.request)).not.toContain('responseText');
  }));
  it('saved Projects do not inherit other workspace identity or Chrome profiles',async()=>fixture(async(op,db,projects)=>{
    const a=projects.save('owner',null,{name:'PipSePaisa',chromeProfile:'Profile 3',
      chatgptProjectUrl:'https://chatgpt.com/g/g-p-my-project'});
    const b=projects.save('owner',null,{name:'Other',chromeProfile:'Default',
      chatgptProjectUrl:'https://chatgpt.com/g/g-p-other'});
    const meta={prompt:'VSA analysis',profile:'Profile 3',
      projectUrl:'https://chatgpt.com/g/g-p-my-project',
      baseProjectUrl:'https://chatgpt.com/g/g-p-my-project',
      threadUrl:'https://chatgpt.com/g/g-p-my-project'};
    pending(db,'owner',a.id,CHATGPT_VISIBLE_PREFIX,meta);
    const plan=await op.plan('owner','Isko short karo',a.id);
    expect('steps' in plan).toBe(true);
    const unrelated=await op.plan('owner','ChatGPT se pocho Hello',b.id);
    if(!('steps' in unrelated))throw Error('expected other project plan');
    expect(unrelated.steps[0].args.profile).toBe('Default');
    expect(unrelated.steps[0].args.url).toBe('https://chatgpt.com/g/g-p-other');
  }));
  it('corrupt visible-thread state cannot grant an action',async()=>fixture(async(op,db)=>{
    pending(db,'owner',null,CHATGPT_VISIBLE_PREFIX,initial);
    await expect(op.plan('owner','Usko detail mein samjhao',null))
      .rejects.toMatchObject({code:'AI_NOT_CONFIGURED'});
  }));
});
