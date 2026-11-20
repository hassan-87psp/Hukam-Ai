import type { Lang, Localized } from '../../../../packages/shared-types/src/index';

// ---------------------------------------------------------------- recognition
// Uses the browser's Web Speech API. In Chrome/Edge the audio is processed by the
// browser vendor's speech service (Google/Microsoft); Safari uses Apple's service.

export const RECOGNITION_LANGS = [
  { code: 'en-PK', label: 'Roman Urdu / English (Pakistan)' },
  { code: 'ur-PK', label: 'Urdu script (alternative)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi (for Roman/Hindustani speech)' },
];

export function getRecognitionCtor(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
export const recognitionSupported = () => !!getRecognitionCtor();

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';
export async function micPermission(): Promise<MicPermission> {
  try {
    const p = await (navigator as any).permissions?.query({ name: 'microphone' });
    return (p?.state as MicPermission) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Allow it in the browser’s site settings.',
  'service-not-allowed': 'Speech recognition is blocked in this browser (it needs HTTPS and a supported browser).',
  'no-speech': 'No speech was heard. Tap the mic and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser’s speech service could not be reached (needs internet).',
  'language-not-supported': 'This browser does not support the selected speech language. Try English (Pakistan) or Hindi.',
  aborted: 'Listening stopped.',
};

export interface Recognizer {
  stop(): void;
  abort(): void;
}

export function startRecognition(opts: {
  lang: string;
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}): Recognizer | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = opts.lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    opts.onInterim((finalText + ' ' + interim).trim());
  };
  r.onerror = (e: any) => opts.onError(e.error || 'unknown');
  r.onend = () => {
    if (finalText.trim()) opts.onFinal(finalText.trim());
    opts.onEnd();
  };
  try {
    r.start();
  } catch {
    opts.onError('start-failed');
    return null;
  }
  return { stop: () => r.stop(), abort: () => r.abort() };
}

// ---------------------------------------------------------------- audio level (optional)
export async function openLevelMeter(onLevel: (v: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 256;
  src.connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += ((b - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
}

// ---------------------------------------------------------------- synthesis
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

const FEMALE = /(uzma|female|zira|aria|jenny|salma|heera|neerja|swara|samantha|karen|moira|tessa|veena|google.*female)/i;
const MALE = /(asad|male|david|guy|mark|ravi|prabhat|madhur|daniel|rishi|alex|google.*male)/i;
export function voiceGender(v: SpeechSynthesisVoice): 'female' | 'male' | null {
  if (FEMALE.test(v.name)) return 'female';
  if (MALE.test(v.name)) return 'male';
  return null;
}

export function pickVoice(voices: SpeechSynthesisVoice[], uri: string | null, lang: Lang = 'roman'): SpeechSynthesisVoice | null {
  if (uri) {
    const v = voices.find((x) => x.voiceURI === uri);
    if (v) return v;
  }
  const english = () => (
    voices.find((v) => v.lang.toLowerCase() === 'en-pk') ??
    voices.find((v) => v.lang.toLowerCase() === 'en-in') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en') && v.default) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('hi')) ??
    null
  );
  if (lang === 'roman' || lang === 'en') return english() ?? voices[0] ?? null;
  return (
    voices.find((v) => v.lang.toLowerCase() === 'ur-pk' && /natural|online/i.test(v.name)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('ur')) ??
    english() ??
    null
  );
}

/** Choose which text variant a voice can actually pronounce. */
export function textForVoice(m: Localized, voice: SpeechSynthesisVoice | null, lang: Lang): string {
  // Roman Urdu is Latin-script Urdu: speak it as written, not an English translation.
  if (lang === 'roman') return m.roman;
  if (lang === 'ur') return voice?.lang.toLowerCase().startsWith('ur') ? m.ur : m.roman;
  return m.en;
}

let lastUtterance: { text: string; voice: SpeechSynthesisVoice | null; rate: number; volume: number } | null = null;

export function speak(text: string, voice: SpeechSynthesisVoice | null, rate: number, volume: number, onState?: (speaking: boolean) => void) {
  if (!ttsSupported() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = rate;
  u.volume = volume;
  u.onstart = () => onState?.(true);
  u.onend = () => onState?.(false);
  u.onerror = () => onState?.(false);
  lastUtterance = { text, voice, rate, volume };
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}

export function replayLast(onState?: (s: boolean) => void) {
  if (lastUtterance) speak(lastUtterance.text, lastUtterance.voice, lastUtterance.rate, lastUtterance.volume, onState);
}
export const hasLastUtterance = () => !!lastUtterance;
