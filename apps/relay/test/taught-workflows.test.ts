import {describe,it,expect} from 'vitest';
import {reusableSteps} from '../src/skills';
import {validatePlanShape} from '../src/operator';
describe('owner-reviewed demonstration rules',()=>{
  it('validates bounded reusable sequences',()=>{
    const steps=reusableSteps([{action:'app.open',args:{app:'chrome'}},{action:'folder.open',args:{folder:'downloads'}},{action:'device.status',args:{}}]);
    expect(validatePlanShape({summary:'Demonstration',steps}).steps).toHaveLength(3);
    expect(()=>reusableSteps(Array(6).fill({action:'app.open',args:{app:'chrome'}}))).toThrow();
  });
  it('rejects sensitive inputs, arbitrary commands and extra arguments',()=>{
    for(const step of [
      {action:'notepad.type',args:{text:'private'}},
      {action:'desktop.control',args:{}},
      {action:'web.open',args:{url:'https://example.test/'}},
      {action:'whatsapp.send_reviewed',args:{}},
      {action:'whatsapp.open',args:{mode:'web'}},
      {action:'app.open',args:{app:'chrome',password:'secret'}},
      {action:'app.open',args:{app:'cmd'}},
      {action:'file.search',args:{query:'private'}},
    ])expect(()=>reusableSteps([step])).toThrow();
  });
});
