#!/usr/bin/env node
/**
 * Release contract: the owner sees ONE HUKM version for the relay, Windows
 * controller, consolidated ZIP, installer guide and automated checks.
 */
import {readFileSync} from 'node:fs';

function textFile(path){return readFileSync(path,'utf8');}
function requireMatch(path,pattern,label){
  const matched=textFile(path).match(pattern);
  if(!matched)throw new Error('Missing '+label+' version marker in '+path);
  return matched[1];
}
function same(what,actual,wanted){
  if(actual!==wanted)throw new Error(what+' version mismatch: '+actual+' != '+wanted);
}
const version=requireMatch('apps/relay/src/server.ts',
  /export const VERSION\s*=\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/,'Relay');
same('Windows Controller',
  requireMatch('apps/windows-controller/controller/__init__.py',/VERSION\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/,'Controller'),
  version);
const workflow=textFile('.github/workflows/quality.yml');
if(!workflow.includes('HUKM-Windows-Controller-v'+version+'.zip'))
  throw new Error('CI ZIP file name does not match Relay version '+version);
if(!workflow.includes('name: HUKM-Windows-Controller-v'+version+'\n'))
  throw new Error('CI downloadable artifact name does not match Relay version '+version);
// Standalone Setup EXE is packaged separately from the legacy ZIP so a
// future signed website download can avoid manual extraction entirely.
same('One-time Windows Setup EXE',
  requireMatch('apps/windows-controller/packaging/HUKM-Setup.iss',
    /#define HUKM_VERSION "([0-9]+\.[0-9]+\.[0-9]+)"/,'One-time Setup'),version);
if(!workflow.includes('HUKM-Setup-v'+version+'.exe'))
  throw new Error('Standalone Setup EXE filename does not match relay version '+version);
if(!workflow.includes('name: HUKM-One-Time-Setup-v'+version+'\n'))
  throw new Error('Standalone Setup downloadable artifact name does not match '+version);
const setup=textFile('apps/windows-controller/packaging/ONE_ZIP_SETUP.txt');
if(!setup.includes('(v'+version+')'))
  throw new Error('Windows setup guide version does not match '+version);
console.log('HUKM release version contract PASS: '+version);
