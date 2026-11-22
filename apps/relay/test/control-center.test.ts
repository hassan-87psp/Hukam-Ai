import {describe,it,expect} from 'vitest';
import {metric,taskProgress,taskTone} from '../../web/src/lib/control-center';
describe('Control centre status semantics',()=>{
  it('distinguishes unknown from zero and refuses invalid load values',()=>{
    for(const v of [undefined,null,NaN,Infinity,-1,'0'])expect(metric(v,'%')).toBe('—');
    expect(metric(0,'%')).toBe('0%');
    expect(metric(102,'%',100)).toBe('—');
    expect(metric(65.23,' MB')).toBe('65.2 MB');
  });
  it('clamps progress without treating completed steps as verified outcome',()=>{
    expect(taskProgress(2,4)).toBe(50);
    expect(taskProgress(5,4)).toBe(100);
    expect(taskProgress(1,0)).toBe(0);
    expect(taskTone('unverified')).toBe('warn');
    expect(taskTone('completed')).toBe('ok');
  });
});
