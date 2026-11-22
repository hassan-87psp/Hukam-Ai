import {describe,it,expect} from 'vitest';
import {parseChatGPTAsk,chatGPTSendApproval,chromeProfile,routeIntent,parseCommand} from '../src/index';

describe('natural AI se pocho -> supervised ChatGPT browser intent',()=>{
  for(const [input,question] of [
    ['AI se pocho Gold ka kya scene hai','Gold ka kya scene hai'],
    ['HUKM, AI se zara pocho Gold kal kahan ja sakta hai?','Gold kal kahan ja sakta hai?'],
    ['ChatGPT se pocho VSA kya hai','VSA kya hai'],
    ['AI ko bolo weekly outlook likho','weekly outlook likho'],
    ['Ask ChatGPT what is market structure','what is market structure'],
    ['AI se pocho',null],
  ] as const){
    it(input,()=>{
      expect(parseChatGPTAsk(input)).toEqual({question});
      expect(routeIntent(input,parseCommand(input))).toBe('plan');
    });
  }
  it('does not seize ordinary questions or Gemini requests and send them to browser',()=>{
    for(const input of ['AI kya hai?','AI se kya faida hota hai?','AI se poch raha ho','Gold mein support kya hai?','Gemini se pocho Gold kya hai']){
      expect(parseChatGPTAsk(input)).toBeNull();
      expect(routeIntent(input,parseCommand(input))).toBe('chat');
    }
  });
  it('distinguishes explicit send permission from an ambiguous yes',()=>{
    for(const input of ['haan bhej do','haan, bhej do','send karo','pooch lo','okay send now'])
      expect(chatGPTSendApproval(input)).toBe(true);
    for(const input of ['yes','haan','ok','cancel','Gold ki price batao','kya scene hai','send it to WhatsApp'])
      expect(chatGPTSendApproval(input)).toBe(false);
  });
  it('only accepts exact allowlisted owner Chrome profiles',()=>{
    expect(chromeProfile('Default')).toBe('Default');
    expect(chromeProfile('Profile 9')).toBe('Profile 9');
    expect(chromeProfile('chrome Profile 2')).toBe('Profile 2');
    for(const input of ['Profile 0','Profile 100','../Default','Work profile','Profile 1, Profile 2'])
      expect(chromeProfile(input)).toBeNull();
  });
});
