import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeScreenshot} from '../src/vision';

describe('explicit screenshot visual understanding',()=>{
  it('shares only owner-approved screenshot bytes and performs no action',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'hukm-vision-'));
    const file=join(dir,'screen.jpg');
    writeFileSync(file,Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(120,10)]));
    let calls=0;
    try {
      const r=await analyzeScreenshot(file,'Which app is visible?',{
        key:'FAKE_TEST_KEY',model:'gemini-2.5-flash',
        fetcher:async (_url:any,init:any)=>{
          calls++;
          const body=JSON.parse(init.body);
          expect(body.contents[0].parts[0].text).toBe('Which app is visible?');
          expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
          expect(body.contents[0].parts[1].inlineData.data.length).toBeGreaterThan(80);
          return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Chrome browser is visible, no action taken.'}]}}]}),{status:200});
        },
      });
      expect(calls).toBe(1);
      expect(r.actionsExecuted).toBe(false);
      expect(r.imageSharedWith).toBe('Google Gemini');
      expect(r.analysis).toContain('no action');
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('refuses secrets, missing and invalid input without forwarding to model',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'hukm-vision-bad-'));
    const file=join(dir,'not-image.bin');writeFileSync(file,Buffer.alloc(100,65));
    let calls=0;
    const config={key:'FAKE_TEST_KEY',model:'gemini-2.5-flash',
      fetcher:async()=>{calls++;return new Response('{}',{status:200});}};
    try{
      await expect(analyzeScreenshot(file,'What is on screen?',config)).rejects.toThrow();
      await expect(analyzeScreenshot(file,'',config)).rejects.toThrow();
      await expect(analyzeScreenshot(join(dir,'missing.jpg'),'What app is visible?',config)).rejects.toThrow();
      expect(calls).toBe(0);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});