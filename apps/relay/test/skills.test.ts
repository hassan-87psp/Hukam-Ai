import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDb,run} from '../src/db';
import {Skills,starterSkills,getRecipe} from '../src/skills';
import {validatePlanShape} from '../src/operator';
import {Projects} from '../src/projects';
import {parseCommand,routeIntent} from '../../../packages/command-protocol/src/index';

describe('Step 11 curated skills and explicit teaching',()=>{
  it('validates all 34 recipe plans without high impact final sends or arbitrary code',()=>{
    const recipes=starterSkills();
    expect(recipes).toHaveLength(34);
    expect(new Set(recipes.map(x=>x.id)).size).toBe(34);
    for(const r of recipes){
      expect(validatePlanShape({summary:r.title,steps:r.steps}).steps).toHaveLength(r.steps.length);
      expect(r.steps.every(s=>!['whatsapp.send_reviewed','whatsapp.send_attachment_reviewed','calendar.save_reviewed','chatgpt.submit_prompt','desktop.control','controller.update'].includes(s.action))).toBe(true);
    }
    const r=getRecipe('open-chrome');r.steps[0].args.app='cmd';
    expect(getRecipe('open-chrome').steps[0].args.app).toBe('chrome');
    expect(()=>getRecipe('shell.exec')).toThrow();
    expect(routeIntent('skill morning check',parseCommand('skill morning check'),true)).toBe('plan');
  });
  it('persists taught names, scopes to owner and project, rejects arbitrary args',()=>{
    const dir=mkdtempSync(join(tmpdir(),'hukm-teach-'));
    const migrations=resolve(process.cwd(),'database/migrations');
    let db=openDb(dir,migrations);
    try{
      for(const id of ['a','b'])run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',id,id+'@example.test',id,'test-hash',new Date().toISOString());
      const project=new Projects(db).save('a',null,{name:'Alpha'});
      let skills=new Skills(db);
      const item=skills.teach('a',project.id,{alias:'Morning check',skillId:'whatsapp-count'});
      expect(skills.resolve('a',project.id,'morning check').id).toBe('whatsapp-count');
      expect(()=>skills.resolve('a',null,'Morning check')).toThrow();
      expect(()=>skills.list('b',project.id)).toThrow();
      expect(()=>skills.teach('a',null,{alias:'test',skillId:'shell.exec'})).toThrow();
      expect(()=>skills.teach('a',null,{alias:'test',skillId:'open-chrome',args:{app:'cmd'}})).toThrow();
      expect(()=>skills.teach('a',project.id,{alias:' MORNING CHECK ',skillId:'open-chrome'})).toThrow();
      db.close();db=openDb(dir,migrations);skills=new Skills(db);
      expect(skills.resolve('a',project.id,'Morning check').id).toBe('whatsapp-count');
      expect(()=>skills.remove('a',null,item.id)).toThrow();
      skills.remove('a',project.id,item.id);
      expect(()=>skills.resolve('a',project.id,'Morning check')).toThrow();
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
