import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {openDb,run,one} from '../src/db';
import {Operator} from '../src/operator';
import {Relay} from '../src/core';
import {Projects} from '../src/projects';
import {requiresApproval} from '../../../packages/command-protocol/src/index';
import type {RelayConfig} from '../src/config';

describe('operator Calendar context across actual user turns',()=>{
  it('Google Calendar kholo -> meeting schedule 5.bjy -> one missing detail at a time -> approved draft',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'hukm-calendar-flow-'));
    const db=openDb(folder,resolve(process.cwd(),'database/migrations'));
    try{
      const id='calendar-owner',at=new Date().toISOString();
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,'calendar@example.test','Calendar Test','fake-hash',at);
      // Emulate a previously authenticated, owner-requested web.open.
      // No fake command success is produced by the planner itself.
      run(db,`INSERT INTO commands
        (id,user_id,source,action,args,status,timeout_ms,created_at,finished_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,
        'c-calendar',id,'text','web.open',
        JSON.stringify({url:'https://calendar.google.com/calendar/u/0/r'}),
        'completed',30_000,at,at);
      const relay=new Relay(db,{dataDir:folder} as RelayConfig);
      const operator=new Operator(db,relay,new Projects(db));
      let before=await operator.plan(id,'meeting schedule kro 5.bjy ka',null);
      expect('kind' in before && before.kind).toBe('clarify');
      if(!('kind' in before)||before.kind!=='clarify')throw Error('Expected calendar question');
      expect(before.question).toContain('Google Calendar');
      expect(before.question).toContain('date');
      const pending=operator.pending(id,null);
      expect(pending?.question).toContain('date');

      before=await operator.plan(id,'kal',null);
      expect('kind' in before&&before.kind).toBe('clarify');
      if(!('kind' in before)||before.kind!=='clarify')throw Error('Expected AM/PM question');
      expect(before.question).toMatch(/AM|PM/);
      before=await operator.plan(id,'shaam',null);
      expect('kind' in before&&before.kind).toBe('clarify');
      before=await operator.plan(id,'Team Sync',null);
      expect('kind' in before&&before.kind).toBe('clarify');
      before=await operator.plan(id,'30 minutes',null);
      expect('kind' in before&&before.kind).toBe('clarify');
      before=await operator.plan(id,'Default',null);
      expect('kind' in before).toBe(false);
      if('kind' in before)throw Error('Expected reviewed plan');
      expect(before.steps).toHaveLength(1);
      expect(before.steps[0].action).toBe('calendar.event_draft');
      expect(before.steps[0].args).toMatchObject({
        provider:'google',profile:'Default',title:'Team Sync',
        timeZone:'Asia/Kuala_Lumpur'});
      expect(requiresApproval(before.steps[0].action)).toBe(true);
      const start=Date.parse(before.steps[0].args.startUtc as string);
      const end=Date.parse(before.steps[0].args.endUtc as string);
      expect(end-start).toBe(30*60_000);
      expect(start).toBeGreaterThan(Date.now());
      expect(operator.pending(id,null)).toBeNull();
    }finally{db.close();rmSync(folder,{recursive:true,force:true});}
  });

  it('owner screenshot examples route misspelled Calendar and meeting-link request without web search or false save',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'hukm-calendar-typo-'));
    const db=openDb(folder,resolve(process.cwd(),'database/migrations'));
    try{
      const id='calendar-typo-owner',at=new Date().toISOString();
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,'calendar-typo@example.test','Owner','fake-hash',at);
      const operator=new Operator(db,new Relay(db,{dataDir:folder} as RelayConfig),new Projects(db));
      const open=await operator.plan(id,'Google calande kro',null);
      expect('kind' in open).toBe(false);
      if('kind' in open)throw Error('Calendar app open command was not planned');
      expect(open.steps).toEqual([{action:'web.open',args:{url:'https://calendar.google.com/calendar/u/0/r'}}]);
      const meeting=await operator.plan(id,'Google calnder open kro sham 5 bjy ke meeting link ready krdo',null);
      expect('kind' in meeting&&meeting.kind).toBe('clarify');
      if(!('kind' in meeting)||meeting.kind!=='clarify')throw Error('Expected reviewed meeting details, not web search');
      expect(meeting.question).toContain('Google Calendar');
      expect(meeting.question).toContain('date');
      const next=await operator.plan(id,'kal',null);
      expect('kind' in next&&next.kind).toBe('clarify');
      if(!('kind' in next)||next.kind!=='clarify')throw Error('Expected missing meeting title');
      expect(next.question).toContain('title');
    }finally{db.close();rmSync(folder,{recursive:true,force:true});}
  });

  it('asks Calendar provider only when no earlier application context is available',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'hukm-calendar-provider-'));
    const db=openDb(folder,resolve(process.cwd(),'database/migrations'));
    try{
      const id='provider-owner',at=new Date().toISOString();
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        id,'provider@example.test','Owner','fake-hash',at);
      const operator=new Operator(db,new Relay(db,{dataDir:folder} as RelayConfig),new Projects(db));
      const ask=await operator.plan(id,'meeting schedule kro 5.bjy ka',null);
      expect('kind' in ask&&ask.kind).toBe('clarify');
      if(!('kind' in ask)||ask.kind!=='clarify')throw Error('Expected provider question');
      expect(ask.question).toContain('Google Calendar');
      expect(ask.question).toContain('Outlook Calendar');
      const reply=await operator.plan(id,'Google',null);
      expect('kind' in reply&&reply.kind).toBe('clarify');
      if(!('kind' in reply)||reply.kind!=='clarify')throw Error('Expected date question');
      expect(reply.question).toContain('date');
      const next=await operator.plan(id,'kal',null);
      expect('kind' in next&&next.kind).toBe('clarify');
      if(!('kind' in next)||next.kind!=='clarify')throw Error('Expected AM/PM question');
      expect(next.question).toMatch(/AM|PM/);
    }finally{db.close();rmSync(folder,{recursive:true,force:true});}
  });

  it('final Save requires a verified draft marker and explicit owner command, not casual yes',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'hukm-calendar-save-'));
    const db=openDb(folder,resolve(process.cwd(),'database/migrations'));
    try{
      const owner='calendar-save-owner',at=new Date().toISOString();
      run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',
        owner,'saved@example.test','Owner','fake-hash',at);
      const operator=new Operator(db,new Relay(db,{dataDir:folder} as RelayConfig),new Projects(db));
      const start=new Date(Date.now()+2*86400_000).toISOString().replace(/\.\d{3}Z$/,'Z');
      const end=new Date(Date.now()+2*86400_000+1800_000).toISOString().replace(/\.\d{3}Z$/,'Z');
      const args={provider:'google',profile:'Default',title:'Team Sync',
        startUtc:start,endUtc:end,timeZone:'Asia/Kuala_Lumpur',details:'',location:''};
      run(db,`INSERT INTO operator_dialogues(user_id,project_key,request,question,topic,created_at,updated_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?)`,
        owner,'general','HUKM_OPENED_CALENDAR_DRAFT:'+JSON.stringify(args),
        'Save karo?', 'operator-followup',at,at,new Date(Date.now()+600_000).toISOString());
      const no=await operator.plan(owner,'haan',null);
      expect('kind' in no&&no.kind).toBe('clarify');
      const approved=await operator.plan(owner,'Save karo',null);
      expect('kind' in approved).toBe(false);
      if('kind' in approved)throw Error('Expected reviewed Save plan');
      expect(approved.steps).toEqual([{action:'calendar.save_reviewed',args}]);
      expect(requiresApproval('calendar.save_reviewed')).toBe(true);
      expect(operator.pending(owner,null)).toBeNull();
    }finally{db.close();rmSync(folder,{recursive:true,force:true});}
  });
});
