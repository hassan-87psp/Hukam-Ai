/**
 * HUKM test-only Pakistani female Urdu TTS.
 * Uses the unofficial Microsoft Edge Read Aloud client (node-edge-tts).
 * No billing keys are required, but Microsoft may change or block this service.
 * Never log or persist the message text.
 */
import { log } from './util';

const VOICE = 'ur-PK-UzmaNeural';
const MAX_AUDIO = 2 * 1024 * 1024;
const MAX_TEXT = 450;
// Only cache the fixed public voice-test phrase; no private command text is stored.
const PREVIEW = 'السلام علیکم، میں حکم ہوں۔';
let previewAudio: Buffer | null = null;

export async function femaleUrduAudio(input: string): Promise<Buffer> {
  const text = input.trim();
  if (text === PREVIEW && previewAudio) return previewAudio;
  if (!text || text.length > MAX_TEXT) throw new Error('Voice text length invalid');
  // A Pakistani Urdu neural voice reads Urdu script more naturally than romanized text.
  if (!/[\u0600-\u06FF]/u.test(text)) throw new Error('Pakistani voice requires Urdu script');

  const module: any = await import('node-edge-tts');
  const Engine = module.EdgeTTS ?? module.default?.EdgeTTS;
  if (!Engine) throw new Error('Edge TTS client is not installed');

  const client = new Engine({
    voice: VOICE,
    lang: 'ur-PK',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: '-5%',
    pitch: 'default',
    volume: 'default',
    timeout: 20000,
    saveSubtitles: false,
  });

  const stream = typeof client.streamAudio === 'function' ? client.streamAudio(text) : null;
  if (!stream || !stream[Symbol.asyncIterator]) throw new Error('TTS client audio streaming unsupported');

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of stream) {
    const bytePart = Buffer.isBuffer(part)
      ? part
      : part instanceof Uint8Array ? Buffer.from(part) : null;
    if (!bytePart || !bytePart.length) continue;
    total += bytePart.length;
    if (total > MAX_AUDIO) throw new Error('Voice response too large');
    chunks.push(bytePart);
  }
  const audio = Buffer.concat(chunks);
  if (audio.length < 300) throw new Error('No audio returned by voice service');
  const mp3 = audio.subarray(0, 3).toString('ascii') === 'ID3'
    || audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  if (!mp3) throw new Error('Voice service returned invalid audio');
  if (text === PREVIEW) previewAudio = audio;
  return audio;
}

export function reportFemaleVoiceError(error: unknown) {
  log('warn', 'free Pakistani female TTS unavailable', {
    error: String(error instanceof Error ? error.message : error).slice(0, 200),
  });
}
