import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer,type Server} from 'node:http';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {startRelay,type RelayHandle} from '../src/server';

const execute=promisify(execFile);
const cli=resolve(process.cwd(),'scripts/check-relay.mjs');

describe('Phase 6: read-only production relay preflight',()=>{
  let relay:RelayHandle;
  let dir:string;
  let staticServer:Server;
  let fakeOrigin:string;

  beforeAll(async()=>{
    dir=mkdtempSync(join(tmpdir(),'hukm-phase6-'));
    relay=await startRelay({port:0,host:'127.0.0.1',dataDir:dir,
      publicDir:join(dir,'missing-ui'),setupCode:'PHASE6-TEST'});
    staticServer=createServer((_req,res)=>{
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end('<!doctype html><title>Static page only</title>');
    });
    await new Promise<void>(done=>staticServer.listen(0,'127.0.0.1',done));
    const addr=staticServer.address();
    if(!addr || typeof addr==='string')throw new Error('No static test server port');
    fakeOrigin='http://127.0.0.1:'+addr.port;
  });
  afterAll(async()=>{
    await new Promise<void>(done=>staticServer?.close(()=>done()));
    await relay?.close();
    if(dir)rmSync(dir,{recursive:true,force:true});
  });

  it('accepts real relay JSON, version and properly gated private runtime status',async()=>{
    const {stdout}=await execute(process.execPath,[cli,'--url',relay.url,
      '--expected-version','1.8.2'],{timeout:30_000});
    expect(stdout).toContain('HUKM relay preflight PASS');
    expect(stdout).toContain('"version": "1.8.2"');
    expect(stdout).toContain('"anonymousRuntimeProtected": true');
    expect(stdout).toContain('"liveApplicationActionsVerified": false');
  });
  it('rejects static hosting that answers /api/health with HTML',async()=>{
    await expect(execute(process.execPath,[cli,'--url',fakeOrigin],{timeout:30_000}))
      .rejects.toMatchObject({code:1,stderr:expect.stringContaining('non-JSON')});
  });
  it('rejects a stale relay even when the port answers successfully',async()=>{
    await expect(execute(process.execPath,[cli,'--url',relay.url,
      '--expected-version','9.9.9'],{timeout:30_000}))
      .rejects.toMatchObject({code:1,stderr:expect.stringContaining('version mismatch')});
  });
  it('refuses remote plaintext HTTP and login URLs without sending requests',async()=>{
    await expect(execute(process.execPath,[cli,'--url','http://example.com'],{timeout:30_000}))
      .rejects.toMatchObject({code:1,stderr:expect.stringContaining('Remote relay must use HTTPS')});
    await expect(execute(process.execPath,[cli,'--url','https://someone:password@example.com'],{timeout:30_000}))
      .rejects.toMatchObject({code:1,stderr:expect.stringContaining('without login')});
  });
});
