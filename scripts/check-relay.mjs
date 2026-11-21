#!/usr/bin/env node
/**
 * Read-only deployment preflight for a HUKM relay.
 *
 * Usage:
 *   node scripts/check-relay.mjs --url https://your-relay.example.com --expected-version 1.6.9
 *
 * No cookies, tokens or user account data are transmitted. Only unauthenticated
 * GET requests are made. This deliberately FAILS on static GitHub Pages or an
 * incorrectly routed /api endpoint instead of reporting a false "online".
 */
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

function fail(message) {
  throw new Error(message);
}
function option(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) fail(name + ' needs a value');
  return process.argv[i + 1];
}
async function getJson(base, route, timeoutMs = 25_000) {
  const response = await fetch(new URL(route, base), {
    method: 'GET',
    headers: {accept: 'application/json'},
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    fail(route + ' returned ' + response.status + ' with non-JSON content. '
      + 'This may be static Pages hosting rather than the running HUKM Node relay.');
  }
  let result;
  try { result = await response.json(); }
  catch { fail(route + ' did not return valid JSON'); }
  return {status: response.status, result};
}

export async function checkRelay(base, expectedVersion = null) {
  const target = new URL(base);
  if (target.username || target.password || target.search || target.hash ||
      (target.pathname !== '/' && target.pathname !== '') ||
      !['http:', 'https:'].includes(target.protocol)) {
    fail('Provide only the relay origin URL, without login, query or path');
  }
  if (target.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    fail('Remote relay must use HTTPS. Localhost may use HTTP.');
  }
  const origin = target.origin + '/';
  const health = await getJson(origin, '/api/health');
  if (health.status !== 200 || health.result?.ok !== true ||
      typeof health.result.version !== 'string') {
    fail('/api/health was not a healthy HUKM relay response');
  }
  if (expectedVersion && health.result.version !== expectedVersion) {
    fail('Relay version mismatch (expected ' + expectedVersion
      + ', received ' + health.result.version + '). Do not assume deployment is current.');
  }
  const auth = await getJson(origin, '/api/auth/status');
  if (auth.status !== 200 || typeof auth.result?.setupRequired !== 'boolean') {
    fail('Owner authentication API is unavailable or returned unexpected data');
  }
  // The anonymous caller must not be able to retrieve the owner's controller,
  // project or task state. No login attempt or mutation is performed.
  const gated = await getJson(origin, '/api/runtime/status');
  if (gated.status !== 401 ||
      gated.result?.error?.code !== 'UNAUTHENTICATED') {
    fail('Private runtime diagnostics are not correctly owner-gated');
  }
  return {
    relayReachable: true,
    version: health.result.version,
    ownerAccountSetup: !auth.result.setupRequired,
    anonymousRuntimeProtected: true,
    // These cannot be verified without the owner's authenticated connection.
    windowsControllerConnected: null,
    geminiReachable: null,
    liveApplicationActionsVerified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const base = option('--url');
    if (!base) fail('Usage: node scripts/check-relay.mjs --url <relay-origin> [--expected-version x.y.z]');
    const output = await checkRelay(base, option('--expected-version'));
    console.log('HUKM relay preflight PASS');
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error('HUKM relay preflight FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
