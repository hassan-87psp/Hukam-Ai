import {describe,it,expect} from 'vitest';
import {Skills,reusableSteps} from '../src/skills';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDb,run} from '../src/db';
import {Projects} from '../src/projects';
import {validatePlanShape} from '../src/operator';
describe('owner-reviewed demonstration rules',()=>{
  it('validates bounded reusable sequences',()=>{
    const steps=reusableSteps([{action:'app.open',args:{app:'chrome'}},{action:'folder.open',args:{folder:'downloads'}},{action:'device.status',args:{}}]);
    expect(validatePlanShape({summary:'Demonstration',steps}).steps).toHaveLength(3);
    expect(()=>reusableSteps(Array(6).fill({action:'app.open',args:{app:'chrome'}}))).toThrow();
  });
  it('rejects sensitive inputs, arbitrary commands and extra arguments',()=>{
    for(const step of [
      {action:'notepad.type',args:{text:'private'}},
      {action:'desktop.control',args:{}},
      {action:'web.open',args:{url:'https://example.test/'}},
      {action:'whatsapp.send_reviewed',args:{}},
      {action:'whatsapp.open',args:{mode:'web'}},
      {action:'app.open',args:{app:'chrome',password:'secret'}},
      {action:'app.open',args:{app:'cmd'}},
      {action:'file.search',args:{query:'private'}},
    ])expect(()=>reusableSteps([step])).toThrow();
  });
});


describe('learning eligibility from actual operator execution',()=>{
  it('never teaches an unverified run, even if its individual commands completed',()=>{
    const dir=mkdtempSync(join(tmpdir(),'hukm-learn-verified-'));
    const db=openDb(dir,resolve(process.cwd(),'database/migrations'));
    try{
      const at=new Date().toISOString();
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
          'owner','owner@example.test','Owner','test-hash',at);
      const project=new Projects(db).save('owner',null,{name:'Work'});
      const plan=[{action:'app.open',args:{app:'chrome'}}];
      run(db,'INSERT INTO operator_plans(id,user_id,project_id,request,summary,steps,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
          'plan','owner',project.id,'Open Chrome','Open Chrome',JSON.stringify(plan),at,at);
      run(db,'INSERT INTO operator_runs(id,user_id,plan_id,status,current_step,total_steps,command_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          'run','owner','plan','unverified',1,1,JSON.stringify(['cmd']),at,at);
      run(db,`INSERT INTO commands(id,user_id,client_request_id,source,input_text,action,args,requires_approval,status,timeout_ms,created_at,dispatched_at,finished_at,result)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          'cmd','owner','run-0','text','Open Chrome','app.open',JSON.stringify({app:'chrome'}),0,
          'completed',20000,at,at,at,JSON.stringify({opened:true}));
      const skills=new Skills(db);
      expect(skills.demonstrations('owner',project.id)).toHaveLength(0);
      expect(()=>skills.teachWorkflow('owner',project.id,{alias:'Open work Chrome',runId:'run',reviewed:true})).toThrow();

      // Only a fully verified operator run can become an owner-reviewed skill.
      run(db,"UPDATE operator_runs SET status='completed' WHERE id='run'");
      expect(skills.demonstrations('owner',project.id)).toHaveLength(1);
      const taught=skills.teachWorkflow('owner',project.id,
          {alias:'Open work Chrome',runId:'run',reviewed:true});
      expect(skills.resolve('owner',project.id,'Open work Chrome').steps).toEqual(plan);
      expect(taught.workflow).toBe(true);
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
