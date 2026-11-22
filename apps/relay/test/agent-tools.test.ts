import { describe, expect, it } from 'vitest';
import { agentToolInstruction, agentToolNames, isAgentTool } from '../src/agent-tools';
import { ACTIONS, requiresApproval } from '../../../packages/command-protocol/src/index';
import { validatePlanShape } from '../src/operator';

describe('native agent tool registry', () => {
  it('advertises exactly the registered actions, with no duplicates or unknown commands', () => {
    const names = agentToolNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(39);
    for (const name of names) {
      expect(ACTIONS[name]).toBeDefined();
      expect(isAgentTool(name)).toBe(true);
    }
    expect(agentToolInstruction()).toBe('Only use these precise action names: ' + names.join(', ') + '.');
    expect(Object.isFrozen(names)).toBe(true);
  });
  it('excludes manual targeting, plugins, shell, and update capabilities from AI planning', () => {
    for (const name of ['shell.exec','plugin.install','controller.update','desktop.control','ui.activate','ui.activate_observed','__proto__','constructor']) {
      expect(isAgentTool(name)).toBe(false);
      expect(() => validatePlanShape({steps:[{action:name,args:{}}]})).toThrow();
    }
  });
  it('does not bypass existing command validation or approval', () => {
    expect(requiresApproval('whatsapp.send_reviewed')).toBe(true);
    expect(requiresApproval('chatgpt.submit_prompt')).toBe(true);
    expect(() => validatePlanShape({steps:[{action:'browser.control',args:{kind:'click',x:10,y:10}}]})).toThrow();
    expect(validatePlanShape({steps:[{action:'device.status',args:{}}]}).steps).toHaveLength(1);
  });
});
