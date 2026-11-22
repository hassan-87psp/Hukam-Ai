import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import WebSocket from 'ws';
import {startRelay,type RelayHandle} from '../src/server';

describe('ephemeral owner-approved live screen preview',()=>{
  let relay:RelayHandle,dir:string,cookie='',deviceId='',device:WebSocket;
  const deviceEvents:any[]=[];
  async function api(method:string,path:string,body?:unknown){
    const response=await fetch(relay.url+path,{method,headers:{
      'x-hukm-client':'web', ...(cookie?{cookie}:{}),
      ...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined});
    const ck=response.headers.get('set-cookie');
    if(ck)cookie=ck.split(';')[0];
    return {status:response.status,data:await response.json()};
  }
  async function waitFor<T>(fn:()=>T|undefined,ms=3000):Promise<T>{
    const start=Date.now();
    while(Date.now()-start<ms){
      const value=fn();if(value)return value;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Live preview event timeout');
  }
  async function socket(path:string,headers:Record<string,string>={}):Promise<WebSocket>{
    const s=new WebSocket(relay.url.replace('http','ws')+path,{headers});
    await new Promise<void>((resolve,reject)=>{s.once('open',()=>resolve());s.once('error',reject);});
    return s;
  }
  beforeAll(async()=>{
    dir=mkdtempSync(join(tmpdir(),'hukm-live-preview-'));
    relay=await startRelay({port:0,host:'127.0.0.1',dataDir:dir,publicDir:join(dir,'no'),
      setupCode:'LIVE-TEST',heartbeatTimeoutMs:60_000});
    expect((await api('POST','/api/auth/setup',{email:'owner@example.test',
      name:'Owner',password:'longpassword1',setupCode:'LIVE-TEST'})).status).toBe(200);
    const pairing=await api('POST','/api/devices/pairing-code',{name:'Test desktop'});
    const claim=await api('POST','/api/pair/claim',{code:pairing.data.code,os:'Windows'});
    deviceId=claim.data.deviceId;
    device=await socket('/ws/device',{authorization:'Bearer '+claim.data.deviceToken});
    device.on('message',d=>deviceEvents.push(JSON.parse(d.toString())));
    device.send(JSON.stringify({type:'hello',controllerVersion:'1.9.6',os:'Windows',osVersion:'11',
      hostname:'TEST',capabilities:['screen','system'],
      config:{allowedDirs:[],apps:[],screenCapture:true,liveScreenPreview:true,browser:'default'}}));
    await waitFor(()=>deviceEvents.find(x=>x.type==='welcome'));
  });
  afterAll(async()=>{
    if(device?.readyState===WebSocket.OPEN)device.close();
    await relay?.close();if(dir)rmSync(dir,{recursive:true,force:true});
  });

  it('rejects a client websocket without a valid signed-in owner session',async()=>{
    const anonymous=new WebSocket(relay.url.replace('http','ws')+'/ws/client');
    const code=await new Promise<number>(resolve=>{
      anonymous.on('unexpected-response',(_req,res)=>resolve(res.statusCode??0));
      anonymous.on('error',()=>resolve(0));
    });
    expect(code).toBe(401);
    anonymous.terminate();
  });

  it('starts only after local ready, streams in RAM, and stops on viewer close',async()=>{
    const viewer=await socket('/ws/client',{cookie});
    const updates:any[]=[];
    viewer.on('message',d=>updates.push(JSON.parse(d.toString())));
    viewer.send(JSON.stringify({type:'live_screen.subscribe',deviceId,monitor:1}));
    const command=await waitFor(()=>deviceEvents.find(x=>x.type==='live_screen.start'));
    expect(command.durationSeconds).toBe(90);
    const pending=await waitFor(()=>updates.find(x=>x.status==='awaiting_local_approval'));
    expect(pending.sessionId).toBe(command.sessionId);

    const frame=Buffer.alloc(160,25).toString('base64');
    const message={type:'live_screen.frame',sessionId:command.sessionId,
      mime:'image/jpeg',dataBase64:frame,width:640,height:360};
    device.send(JSON.stringify(message));
    await new Promise(r=>setTimeout(r,55));
    expect(updates.some(x=>x.type==='live_screen.frame')).toBe(false);

    device.send(JSON.stringify({type:'live_screen.ready',sessionId:command.sessionId}));
    await waitFor(()=>updates.some(x=>x.status==='live'));
    device.send(JSON.stringify(message));
    await waitFor(()=>updates.some(x=>x.type==='live_screen.frame'));
    const received=updates.find(x=>x.type==='live_screen.frame');
    expect(received.dataBase64).toBe(frame);
    expect((await api('GET','/api/screenshots')).data).toEqual([]);
    viewer.close();
    await waitFor(()=>deviceEvents.some(x=>x.type==='live_screen.stop'&&x.sessionId===command.sessionId));
  });

  it('refuses duplicate viewers and terminates on emergency pause',async()=>{
    const a=await socket('/ws/client',{cookie});
    const b=await socket('/ws/client',{cookie});
    const one:any[]=[],two:any[]=[];
    a.on('message',x=>one.push(JSON.parse(x.toString())));
    b.on('message',x=>two.push(JSON.parse(x.toString())));
    a.send(JSON.stringify({type:'live_screen.subscribe',deviceId,monitor:1}));
    await waitFor(()=>one.some(x=>x.status==='awaiting_local_approval'));
    b.send(JSON.stringify({type:'live_screen.subscribe',deviceId,monitor:1}));
    await waitFor(()=>two.some(x=>x.status==='error'));
    expect(two.find(x=>x.status==='error').reason).toMatch(/already active/);
    expect((await api('POST',`/api/devices/${deviceId}/pause`)).status).toBe(200);
    await waitFor(()=>one.some(x=>x.status==='ended'&&x.reason==='emergency_pause'));
    a.close();b.close();
  });
});
