/**
 * On-demand, owner-authenticated Gemini diagnostic.
 *
 * Two fixed, harmless prompts may consume a small amount of the owner's
 * Gemini quota. No user chat, Project, Windows state or private content is sent.
 * Tests assert protocol reachability only; model accuracy is never guaranteed.
 */
import {chatWithGemini, GeminiError, geminiConfigured} from './gemini';
import {probeGeminiPlanner} from './operator';
import {HttpError} from './core';

export type Check = {ok:boolean; latencyMs:number; errorCode?:string};
export type GeminiDiagnostic = {
  provider:'gemini'; model:string; configured:boolean; checkedAt:string;
  chat:Check|null; planner:Check|null; noLaptopActions:boolean;
  accuracyVerified:false;
};
type Fn = ()=>Promise<unknown>;

async function check(fn:Fn):Promise<Check> {
  const start=Date.now();
  try {
    const result=await fn();
    if(result===false)throw new Error('diagnostic returned false');
    return {ok:true,latencyMs:Math.max(0,Date.now()-start)};
  } catch(e) {
    // No model response, exceptions, credentials or user content in result.
    const code=(e instanceof GeminiError||e instanceof HttpError)
      ? e.code : 'AI_PROBE_FAILED';
    return {ok:false,latencyMs:Math.max(0,Date.now()-start),
      errorCode:code.slice(0,48)};
  }
}

export async function diagnoseGemini(opts:{
  configured?:boolean;model?:string; chat?:Fn;planner?:Fn;
}={}):Promise<GeminiDiagnostic>{
  const configured=opts.configured??geminiConfigured();
  const model=opts.model??process.env.GEMINI_MODEL??'gemini-3.5-flash-lite';
  const base={provider:'gemini' as const,model,configured,
    checkedAt:new Date().toISOString(),noLaptopActions:true as const,
    accuracyVerified:false as const};
  if(!configured)return {...base,chat:null,planner:null};
  const [chat,planner]=await Promise.all([
    check(opts.chat??(()=>chatWithGemini(
      'Connectivity diagnostic: briefly greet HUKM in Roman Urdu.',[],{timeoutMs:16000}))),
    check(opts.planner??(()=>probeGeminiPlanner())),
  ]);
  return {...base,chat,planner};
}
