import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {openDb,run,one} from '../src/db';
import {Operator} from '../src/operator';
import {Projects} from '../src/projects';
import {MemoryRecords} from '../src/memory-records';
import {CHATGPT_REVIEWED_PREFIX} from '../src/chatgpt-dialogue';
import type {Relay} from '../src/core';

function fixture<T>(fn:(operator:Operator,db:ReturnType<typeof openDb>,projects:Projects)=>Promise<T>):Promise<T>{
  const dir=mkdtempSync(join(tmpdir(),'hukm-chatgpt-natural-'));
  const db=openDb(dir,resolve(process.cwd(),'database/migrations'));
  run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
    'owner','owner@example.test','Owner','mock-hash',new Date().toISOString());
  run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
    'other','other@example.test','Other','mock-hash',new Date().toISOString());
  const projects=new Projects(db);
  const operator=new Operator(db,{} as Relay,projects);
  return fn(operator,db,projects).finally(()=>{
    db.close();rmSync(dir,{recursive:true,force:true});
  });
}

describe('HUKM multi-turn ChatGPT computer assistant',()=>{
  it('AI se pocho -> asks profile once -> a two-step approved DRAFT, no automatic Send',async()=>fixture(async(op,db)=>{
    const first=await op.plan('owner','AI se pocho Gold ka kya scene hai',null);
    expect(first).toMatchObject({kind:'clarify',topic:'operator-followup'});
    expect('question' in first && first.question).toContain('Chrome profile');
    const saved=one(db,'SELECT * FROM operator_dialogues WHERE user_id=? AND project_key=?','owner','general');
    expect(String(saved?.request)).toContain('Gold ka kya scene hai');
    const planned=await op.plan('owner','Profile 1',null);
    expect('steps' in planned).toBe(true);
    if('steps' in planned){
      expect(planned.steps.map(s=>s.action))
        .toEqual(['browser.profile_open','chatgpt.prompt_draft']);
      expect(planned.steps[0].args)
        .toEqual({profile:'Profile 1',url:'https://chatgpt.com/'});
      expect(planned.steps[1].args)
        .toEqual({projectUrl:'https://chatgpt.com/',prompt:'Gold ka kya scene hai'});
    }
    expect(one(db,'SELECT * FROM operator_dialogues WHERE user_id=? AND project_key=?','owner','general'))
      .toBeUndefined();
  }));
  it('asks the question only if AI se pocho was incomplete, without model guesses',async()=>fixture(async(op)=>{
    const first=await op.plan('owner','HUKM, AI se pocho',null);
    expect('question' in first && first.question).toContain('kya poochna');
    const second=await op.plan('owner','CPI ka gold par kya effect hai',null);
    expect('question' in second && second.question).toContain('Chrome profile');
    const third=await op.plan('owner','Default',null);
    if(!('steps' in third))throw Error('Expected deterministic plan');
    expect(third.steps[1].args.prompt).toBe('CPI ka gold par kya effect hai');
  }));
  it('uses an explicitly approved computer Memory profile without asking again',async()=>fixture(async(op,db)=>{
    const memory=new MemoryRecords(db);
    memory.save('owner',null,null,{category:'computer',
      title:'ChatGPT Chrome profile',content:'Default',useInAI:true});
    const planned=await op.plan('owner','AI se pocho next week Gold ka trend kya hai',null);
    if(!('steps' in planned))throw Error('Expected deterministic plan');
    expect(planned.steps[0].args.profile).toBe('Default');
    expect(planned.steps[1].args.prompt).toBe('next week Gold ka trend kya hai');
    // User B must never inherit A's profile.
    const other=await op.plan('other','AI se pocho USDJPY ka trend',null);
    expect('question' in other && other.question).toContain('Chrome profile');
  }));
  it('honors the exact configured ChatGPT Project URL and account identity',async()=>fixture(async(op,_db,projects)=>{
    const project=projects.save('owner',null,{name:'PipSePaisa',
      chromeProfile:'Profile 2',
      chatgptProjectUrl:'https://chatgpt.com/g/g-pipsepaisa-demo'});
    const planned=await op.plan('owner','ChatGPT se pocho VSA smart money kya hai',project.id);
    if(!('steps' in planned))throw Error('Expected deterministic plan');
    expect(planned.projectId).toBe(project.id);
    expect(planned.steps[0].args).toEqual({profile:'Profile 2',
      url:'https://chatgpt.com/g/g-pipsepaisa-demo'});
    expect(planned.steps[1].args).toEqual({projectUrl:'https://chatgpt.com/g/g-pipsepaisa-demo',
      prompt:'VSA smart money kya hai'});
  }));
  it('a reviewed draft requires EXPLICIT second Send request; yes alone is not authority',async()=>fixture(async(op,db)=>{
    const now=new Date().toISOString(),expiry=new Date(Date.now()+600000).toISOString();
    const reviewed={prompt:'What is a pip?',profile:'Default',projectUrl:'https://chatgpt.com/'};
    run(db,`INSERT INTO operator_dialogues
      (user_id,project_key,request,question,topic,created_at,updated_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`,
      'owner','general',CHATGPT_REVIEWED_PREFIX+JSON.stringify(reviewed),
      'Bhej do?', 'operator-followup',now,now,expiry);
    const unsure=await op.plan('owner','haan',null);
    expect('question' in unsure && unsure.question).toContain('bhej do');
    const other=await op.plan('other','haan bhej do',null);
    expect(!('steps' in other)||other.steps.every(s=>s.action!=='chatgpt.submit_prompt')).toBe(true);
    const final=await op.plan('owner','haan bhej do',null);
    if(!('steps' in final))throw Error('Expected separately approved Send plan');
    expect(final.steps).toEqual([{action:'chatgpt.submit_prompt',
      args:{projectUrl:'https://chatgpt.com/',prompt:'What is a pip?'}}]);
  }));
  it('cancel removes the pending ChatGPT request and creates no laptop command',async()=>fixture(async(op,db)=>{
    await op.plan('owner','AI se pocho',null);
    const cancelled=await op.plan('owner','cancel',null);
    expect(cancelled).toMatchObject({kind:'cancelled'});
    expect(one(db,'SELECT * FROM operator_dialogues WHERE user_id=?','owner')).toBeUndefined();
    expect(one(db,'SELECT * FROM operator_plans WHERE user_id=?','owner')).toBeUndefined();
  }));
});
