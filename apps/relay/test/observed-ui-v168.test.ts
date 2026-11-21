import {describe,expect,it} from 'vitest';
import {ACTIONS,requiresApproval,validateCommand} from '../../../packages/command-protocol/src/index';
import {validatePlanShape} from '../src/operator';

describe('v1.6.8: observed foreground UIA control contract',()=>{
  const safe={label:'Search',role:'ButtonControl',snapshot:'a'.repeat(64)};

  it('requires a separate owner approval for exact snapshot-bound input',()=>{
    expect(requiresApproval('ui.inspect')).toBe(true);
    expect(requiresApproval('ui.activate_observed')).toBe(true);
    expect(ACTIONS['ui.activate_observed'].capability).toBe('input');
    expect(validateCommand('ui.activate_observed',safe).ok).toBe(true);
    expect(validateCommand('ui.activate',{label:'Search'}).ok).toBe(false);
  });
  it('rejects risky labels even when prefixed by emoji, punctuation or filler',()=>{
    for(const label of [
      '🗑 Delete account','Next: Pay now','Click to Submit',
      'Continue to Checkout','SAVE and Publish','Send message',
      'Admin — Approve','📤 Upload','Sign in','Place Order','Reset account',
    ]){
      expect(validateCommand('ui.activate_observed',{...safe,label}).ok).toBe(false);
    }
  });
  it('requires matching trusted inspection role and lowercase 64-char hash',()=>{
    for(const args of [
      {...safe,snapshot:'a'.repeat(63)},
      {...safe,snapshot:'A'.repeat(64)},
      {...safe,role:'TextControl'},
      {...safe,role:['ButtonControl']},
      {...safe,label:''},
    ])expect(validateCommand('ui.activate_observed',args).ok).toBe(false);
  });
  it('never accepts model-generated arbitrary UI clicks or fake inspection tokens',()=>{
    expect(()=>validatePlanShape({steps:[{action:'ui.activate_observed',args:safe}]})).toThrow();
    expect(()=>validatePlanShape({steps:[{action:'ui.activate',args:{label:'Search'}}]})).toThrow();
    expect(validatePlanShape({steps:[{action:'ui.inspect',args:{}}]}).steps).toHaveLength(1);
  });
});
