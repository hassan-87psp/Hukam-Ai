import {describe,it,expect,vi,afterEach} from 'vitest';
import {startRecognition} from '../../../apps/web/src/services/voice';

afterEach(()=>vi.unstubAllGlobals());

describe('Phase 4: repeated voice results never duplicate HUKM commands',()=>{
  class MockRecognition {
    static last:MockRecognition;
    lang='';
    interimResults=false;
    continuous=true;
    maxAlternatives=0;
    onresult:((e:any)=>void)|null=null;
    onend:(()=>void)|null=null;
    onerror:((e:any)=>void)|null=null;
    started=false;
    constructor(){MockRecognition.last=this;}
    start(){this.started=true;}
    stop(){this.onend?.();}
    abort(){this.onend?.();}
  }
  const wire=()=>{
    vi.stubGlobal('window',{SpeechRecognition:MockRecognition});
    const finals:string[]=[];
    const interim:string[]=[];
    const ended:string[]=[];
    const recorder=startRecognition({
      lang:'en-PK',onInterim:x=>interim.push(x),
      onFinal:x=>finals.push(x),onError:()=>{},
      onEnd:()=>ended.push('end'),
    });
    expect(recorder).not.toBeNull();
    return {recorder:recorder!,r:MockRecognition.last,finals,interim,ended};
  };
  it('receives an updated final segment twice but submits once',()=>{
    const {r,finals,interim,ended}=wire();
    const one=[{isFinal:true,0:{transcript:'Notepad kholo'}}];
    r.onresult?.({resultIndex:0,results:one});
    r.onresult?.({resultIndex:0,results:one});
    r.onend?.();
    r.onend?.();
    expect(finals).toEqual(['Notepad kholo']);
    expect(ended).toHaveLength(1);
    expect(interim.at(-1)).toBe('Notepad kholo');
  });
  it('joins distinct final parts once and ignores stale interim',()=>{
    const {r,finals,recorder}=wire();
    r.onresult?.({resultIndex:0,results:[
      {isFinal:true,0:{transcript:'Chrome kholo'}},
      {isFinal:false,0:{transcript:'aur'}},
    ]});
    r.onresult?.({resultIndex:1,results:[
      {isFinal:true,0:{transcript:'Chrome kholo'}},
      {isFinal:true,0:{transcript:'aur YouTube kholo'}},
    ]});
    recorder.stop();
    expect(finals).toEqual(['Chrome kholo aur YouTube kholo']);
  });
  it('abort never executes the partially recognized command',()=>{
    const {r,finals,recorder,ended}=wire();
    r.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'Send'}}]});
    recorder.abort();
    expect(finals).toEqual([]);
    expect(ended).toHaveLength(1);
  });
});
