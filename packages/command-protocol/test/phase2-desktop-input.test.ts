import {describe,it,expect} from 'vitest';
import {parseCommand,validateCommand,requiresApproval} from '../src/index';
import {validatePlanShape} from '../../../apps/relay/src/operator';

const command = (text:string) => {
  const result=parseCommand(text);
  if(result.kind!=='command')throw new Error('Not parsed as command: '+text);
  return result;
};

describe('Phase 2: explicitly approved desktop mouse and keyboard',()=>{
  it('parses manual commands, including multi-monitor negative coordinates',()=>{
    expect(command('mouse click 120 240')).toMatchObject({
      action:'desktop.control',args:{kind:'click',x:120,y:240}
    });
    expect(command('mouse double click 120 240').args).toEqual({kind:'double_click',x:120,y:240});
    expect(command('mouse right click -850 220').args).toEqual({kind:'right_click',x:-850,y:220});
    expect(command('mouse drag 100 200 to 300 400').args)
      .toEqual({kind:'drag',x:100,y:200,toX:300,toY:400});
    expect(command('keyboard press ctrl+c').args).toEqual({kind:'key',key:'ctrl+c'});
    expect(command('keyboard press shift+tab').args).toEqual({kind:'key',key:'shift+tab'});
    expect(command('desktop type: Market structure check').args)
      .toEqual({kind:'type',text:'Market structure check'});
  });
  it('requires approval and blocks unsupported input on both validation layers',()=>{
    expect(requiresApproval('desktop.control')).toBe(true);
    expect(validateCommand('desktop.control',{kind:'click',x:-100,y:140}).ok).toBe(true);
    expect(validateCommand('desktop.control',{kind:'click',x:32001,y:140}).ok).toBe(false);
    expect(validateCommand('desktop.control',{kind:'drag',x:100,y:200,toX:300,toY:400}).ok).toBe(true);
    expect(validateCommand('desktop.control',{kind:'key',key:'win+r'}).ok).toBe(false);
    expect(validateCommand('desktop.control',{kind:'key',key:'ctrl+alt+del'}).ok).toBe(false);
    expect(validateCommand('desktop.control',{kind:'type',text:''}).ok).toBe(false);
    expect(validateCommand('desktop.control',{kind:'scroll',steps:0}).ok).toBe(false);
  });
  it('does not let Gemini inject desktop input, clicks or arbitrary coordinates',()=>{
    for (const args of [{kind:'click',x:10,y:20},{kind:'key',key:'ctrl+s'},{kind:'type',text:'Hello'}]){
      expect(()=>validatePlanShape({steps:[{action:'desktop.control',args}]})).toThrow();
    }
  });
  it('preserves existing browser command routing',()=>{
    expect(command('browser click 450 300').action).toBe('browser.control');
    expect(command('type: plain browser input').action).toBe('browser.control');
  });
});
