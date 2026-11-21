import {describe,expect,it} from 'vitest';
import {diagnoseGemini} from '../src/ai-diagnostics';
import {GeminiError} from '../src/gemini';

describe('Gemini live diagnostic contract',()=>{
  it('does not make ANY external requests without a configured key',async()=>{
    let called=0;
    const out=await diagnoseGemini({configured:false,model:'gemini-3.5-flash-lite',
      chat:async()=>{called++;},planner:async()=>{called++;}});
    expect(called).toBe(0);
    expect(out.configured).toBe(false);
    expect(out.chat).toBeNull();expect(out.planner).toBeNull();
    expect(out.accuracyVerified).toBe(false);
  });
  it('reports chat and planner status without executing any task',async()=>{
    const calls:string[]=[];
    const out=await diagnoseGemini({configured:true,
      chat:async()=>{calls.push('chat');return {reply:'ok'};},
      planner:async()=>{calls.push('planner');return true;}});
    expect(calls).toEqual(expect.arrayContaining(['chat','planner']));
    expect(out.chat?.ok).toBe(true);
    expect(out.planner?.ok).toBe(true);
    expect(out.noLaptopActions).toBe(true);
    expect(out.accuracyVerified).toBe(false);
    expect(JSON.stringify(out)).not.toContain('secret');
  });
  it('fails one component independently and never leaks upstream secrets',async()=>{
    const out=await diagnoseGemini({configured:true,
      chat:async()=>{throw new GeminiError(503,'AI_ACCESS','private API key: SECRET-123');},
      planner:async()=>true});
    expect(out.chat).toMatchObject({ok:false,errorCode:'AI_ACCESS'});
    expect(out.planner?.ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain('SECRET-123');
  });
  it('does not turn malformed planner output into healthy state',async()=>{
    const out=await diagnoseGemini({configured:true,
      chat:async()=>true,planner:async()=>false});
    expect(out.chat?.ok).toBe(true);
    expect(out.planner?.ok).toBe(false);
    expect(out.planner?.errorCode).toBe('AI_PROBE_FAILED');
  });
});
