/** Shared cloud boundaries. No new runtime dependency or content logging. */
export class CloudLimitError extends Error {
  constructor(public code: 'AI_RATE_LIMIT'|'AI_BUSY'|'AI_QUOTA', message: string) { super(message); }
}
export class CloudBodyTooLarge extends Error {}
type Limits = { perMinute: number; perDay: number; concurrency: number };
export class CloudBudget {
  private requests: number[] = [];
  private active = 0;
  private cooldownUntil = 0;
  constructor(private limits: Limits, private now: () => number = Date.now) {}
  acquire(): () => void {
    const stamp = this.now();
    this.requests = this.requests.filter(t => t > stamp-86400000);
    if (stamp < this.cooldownUntil)
      throw new CloudLimitError('AI_QUOTA','Gemini quota temporarily unavailable. Try again later.');
    if (this.active >= this.limits.concurrency)
      throw new CloudLimitError('AI_BUSY','Gemini is busy. Try again after the current request.');
    if (this.requests.length >= this.limits.perDay ||
        this.requests.filter(t => t > stamp-60000).length >= this.limits.perMinute)
      throw new CloudLimitError('AI_RATE_LIMIT','HUKM shared AI request budget reached. Try again later.');
    this.requests.push(stamp);
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  observe(response: Response) {
    if (response.status !== 429) return;
    const value = response.headers.get('retry-after');
    let delay = 60000;
    if (value && /^\d+$/.test(value)) delay = Number(value)*1000;
    else if (value) {
      const date = Date.parse(value);
      if (Number.isFinite(date)) delay = date-this.now();
    }
    this.cooldownUntil = Math.max(this.cooldownUntil,this.now()+Math.min(3600000,Math.max(1000,delay)));
  }
}
function boundedEnv(name: string, fallback: number, maximum: number): number {
  const raw=process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value=Number(raw);
  return Number.isSafeInteger(value) && value>=1 && value<=maximum ? value : fallback;
}
let shared: CloudBudget | undefined;
function sharedBudget(): CloudBudget {
  return shared ??= new CloudBudget({
    perMinute: boundedEnv('HUKM_GEMINI_RPM',6,120),
    perDay: boundedEnv('HUKM_GEMINI_RPD',60,5000),
    concurrency: boundedEnv('HUKM_GEMINI_CONCURRENCY',2,4),
  });
}
export async function readBoundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    void response.body?.cancel().catch(()=>{});
    throw new CloudBodyTooLarge('Cloud response exceeds byte limit');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[]=[];
  let total=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maxBytes) throw new CloudBodyTooLarge('Cloud response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,total);
  } catch (error) {
    void reader.cancel().catch(()=>{});
    throw error;
  } finally { reader.releaseLock(); }
}
/** Injected fetchers are test seams, never client-selected. Real requests share
 * a process-local budget; no queue, automatic retry or paid fallback. */
export async function geminiRequest(url: string, init: RequestInit, maxBytes: number,
  fetcher?: typeof fetch, budget?: CloudBudget): Promise<{ok:boolean;status:number;raw:string}> {
  const gate=budget ?? (fetcher ? undefined : sharedBudget());
  const release=gate?.acquire();
  try {
    const res=await (fetcher??fetch)(url,{...init,redirect:'error'});
    gate?.observe(res);
    if(!res.ok) {
      void res.body?.cancel().catch(()=>{});
      return {ok:false,status:res.status,raw:''};
    }
    const raw=(await readBoundedBytes(res,maxBytes)).toString('utf8');
    return {ok:true,status:res.status,raw};
  } finally { release?.(); }
}
