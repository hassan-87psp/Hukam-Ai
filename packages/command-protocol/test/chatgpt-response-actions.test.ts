import {describe,it,expect} from 'vitest';
import {parseCommand,routeIntent,validateCommand,requiresApproval} from '../src/index';

describe('approved ChatGPT response and follow-up command contract',()=>{
  it('both new actions require owner approval and cannot be forged as automatic Gemini read',()=>{
    expect(requiresApproval('chatgpt.read_response')).toBe(true);
    expect(requiresApproval('chatgpt.followup_draft')).toBe(true);
    const link='https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2';
    expect(validateCommand('chatgpt.read_response',{projectUrl:link,prompt:'What is VSA?'}).ok).toBe(true);
    expect(validateCommand('chatgpt.followup_draft',{
      projectUrl:link,previousPrompt:'What is VSA?',prompt:'Usko detail mein samjhao',
    }).ok).toBe(true);
    expect(validateCommand('chatgpt.followup_draft',{
      projectUrl:link,previousPrompt:'',prompt:'More detail',
    }).ok).toBe(false);
    expect(validateCommand('chatgpt.read_response',{
      projectUrl:'https://chatgpt.com.evil.test/c/thread',prompt:'What is VSA?',
    }).ok).toBe(false);
  });
  it('reply/read follow-ups remain in the operator conversation rather than direct Gemini when pending',()=>{
    for(const value of ['Jawab batao','Usko detail mein samjhao','Isko short karo']){
      expect(routeIntent(value,parseCommand(value),true)).toBe('plan');
    }
  });
});
