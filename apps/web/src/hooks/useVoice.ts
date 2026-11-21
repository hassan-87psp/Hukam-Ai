import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../services/store';
import { micPermission, openLevelMeter, RECOGNITION_ERRORS, recognitionSupported, startRecognition, type MicPermission, type Recognizer } from '../services/voice';

export function useReducedMotion(): boolean {
  const { settings } = useStore();
  const [sys, setSys] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setSys(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && sys);
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mm = window.matchMedia(q);
    const f = () => setM(mm.matches);
    mm.addEventListener('change', f);
    return () => mm.removeEventListener('change', f);
  }, [q]);
  return m;
}

/** Push-to-talk voice input wired to the command pipeline. */
export function useVoiceInput() {
  const store = useStore();
  const { settings, setListening, setAudioLevel, runText } = store;
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const rec = useRef<Recognizer | null>(null);
  const meterOff = useRef<(() => void) | null>(null);
  // Closing the microphone while getUserMedia is still pending must stop
  // the late audio stream too (no microphone left live behind the UI).
  const meterGeneration = useRef(0);
  const supported = recognitionSupported();

  useEffect(() => {
    micPermission().then(setPermission);
  }, []);

  const cleanup = useCallback(() => {
    meterGeneration.current += 1;
    meterOff.current?.();
    meterOff.current = null;
    setAudioLevel(0);
    setListening(false);
  }, [setAudioLevel, setListening]);

  const start = useCallback(async () => {
    setError(null);
    if (!window.isSecureContext) {
      setError('Voice needs a secure (https://) address. Open HUKM through your HTTPS URL (e.g. the Cloudflare Tunnel link), not a plain http:// LAN address.');
      return;
    }
    if (!supported) {
      setError('This browser has no speech recognition. Use Chrome or Edge (Android/desktop) or Safari 14.5+ — or type the command.');
      return;
    }
    if (rec.current) return;
    setTranscript('');
    setListening(true);
    if (settings.audioReactiveOrb) {
      const generation = ++meterGeneration.current;
      void openLevelMeter(setAudioLevel).then((off) => {
        if (generation === meterGeneration.current && rec.current) {
          meterOff.current = off;
        } else {
          // User stopped or recognition failed before getUserMedia returned.
          off();
        }
      }).catch(() => {});
    }
    rec.current = startRecognition({
      lang: settings.recognitionLang,
      onInterim: setTranscript,
      onFinal: (t) => {
        setTranscript(t);
        runText(t, 'voice');
      },
      onError: (code) => {
        setError(RECOGNITION_ERRORS[code] ?? `Speech recognition error: ${code}`);
        if (code === 'not-allowed') setPermission('denied');
      },
      onEnd: () => {
        rec.current = null;
        cleanup();
        micPermission().then(setPermission);
      },
    });
    if (!rec.current) cleanup();
  }, [cleanup, runText, settings.audioReactiveOrb, settings.recognitionLang, setAudioLevel, setListening, supported]);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  useEffect(() => () => {
    meterGeneration.current += 1;
    rec.current?.abort();
    meterOff.current?.();
    meterOff.current = null;
  }, []);

  return { supported, listening: store.listening, transcript, error, permission, start, stop, toggle, clearError: () => setError(null) };
}
