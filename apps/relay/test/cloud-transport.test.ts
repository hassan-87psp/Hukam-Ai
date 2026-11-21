import {describe,it,expect,vi} from 'vitest';
import {CloudBudget,geminiRequest,readBoundedBytes} from '../src/cloud-transport';

describe('shared Gemini transport',()=>{
  it('counts all provider requests in one rolling budget',async()=>{
    let clock=100000000;
    const budget=new CloudBudget({perMinute:2,perDay:3,concurrency:2},()=>clock);
    const fetcher=vi.fn(async()=>new Response('ok'));
    const send=()=>geminiRequest('https://example.test',{},100,fetcher,budget);
    await send();await send();
    await expect(send()).rejects.toMatchObject({code:'AI_RATE_LIMIT'});
    clock+=60001;await send();
    await expect(send()).rejects.toMatchObject({code:'AI_RATE_LIMIT'});
    clock+=86400000;await send();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects concurrent overload and releases on upstream failure',async()=>{
    const budget=new CloudBudget({perMinute:20,perDay:20,concurrency:1});
    let finish!:()=>void;
    const fetcher=vi.fn(async()=>{await new Promise<void>(resolve=>{finish=resolve});throw Error('network');});
    const first=geminiRequest('https://example.test',{},100,fetcher,budget);
    await expect(geminiRequest('https://example.test',{},100,fetcher,budget)).rejects.toMatchObject({code:'AI_BUSY'});
    finish();
    await expect(first).rejects.toThrow('network');
    const next=await geminiRequest('https://example.test',{},100,async()=>new Response('ok'),budget);
    expect(next.raw).toBe('ok');
  });
  it('honors quota cooldown without automatic retries or redirects',async()=>{
    let clock=100000000;
    const budget=new CloudBudget({perMinute:20,perDay:20,concurrency:2},()=>clock);
    const fetcher=vi.fn(async()=>new Response('private error',{status:429,headers:{'retry-after':'30'}}));
    const res=await geminiRequest('https://example.test',{},100,fetcher,budget);
    expect(res).toEqual({ok:false,status:429,raw:''});
    expect(fetcher).toHaveBeenCalledWith('https://example.test',expect.objectContaining({redirect:'error'}));
    await expect(geminiRequest('https://example.test',{},100,fetcher,budget)).rejects.toMatchObject({code:'AI_QUOTA'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock+=30001;
    expect((await geminiRequest('https://example.test',{},100,async()=>new Response('ok'),budget)).ok).toBe(true);
  });
  it('bounds actual streaming bytes even without Content-Length',async()=>{
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));c.close();}});
    await expect(readBoundedBytes(new Response(stream),10)).rejects.toThrow('exceeds byte limit');
    await expect(readBoundedBytes(new Response('abc',{headers:{'content-length':'100'}}),10)).rejects.toThrow();
    expect((await readBoundedBytes(new Response('abc'),10)).toString()).toBe('abc');
  });
});
