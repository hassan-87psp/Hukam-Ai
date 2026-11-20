import { AlertTriangle, CheckCircle2, Mic, MicOff, Repeat, Square, Volume2, VolumeX } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { pick } from '../../../../packages/command-protocol/src/index';
import { Badge, Card, CardHeader, cx, PageHeader } from '../components/ui';
import Waveform from '../features/command/Waveform';
import { useReducedMotion, useVoiceInput } from '../hooks/useVoice';
import { PageFrame } from '../layouts/AppShell';
import { useStore } from '../services/store';
import { hasLastUtterance, listVoices, RECOGNITION_LANGS, replayLast, stopSpeaking, ttsSupported, voiceGender } from '../services/voice';

const BrainOrb = lazy(() => import('../features/brain/BrainOrb'));

export default function Voice() {
  const { settings, saveSettings, brain, audioLevel, chat, speaking, say, pendingWhatsAppChoice, runText } = useStore();
  const voice = useVoiceInput();
  const reduced = useReducedMotion();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    let active = true;
    const sync = () => { if (active && ttsSupported()) setVoices(speechSynthesis.getVoices()); };
    void listVoices().then((v) => { if (active) setVoices(v); });
    if (ttsSupported()) speechSynthesis.addEventListener('voiceschanged', sync);
    return () => {
      active = false;
      if (ttsSupported()) speechSynthesis.removeEventListener('voiceschanged', sync);
    };
  }, []);
  const urduVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('ur'));
  const uzma = urduVoices.find((v) => /uzma|female/i.test(v.name));
  const lastAgent = [...chat].reverse().find((m) => m.kind === 'agent');
  const lastUser = [...chat].reverse().find((m) => m.kind === 'user' && m.source === 'voice');
  const autoPrompt = useRef<string | null>(null);
  const heardPrompt = useRef(false);
  const didAutoListen = useRef(false);

  // After HUKM asks a spoken follow-up, listen once more when speech ENDS.
  // No permanent microphone monitoring; browser permission and availability apply.
  useEffect(() => {
    if (!pendingWhatsAppChoice || !lastAgent || !lastUser || lastAgent.at < lastUser.at) {
      autoPrompt.current = null;
      heardPrompt.current = false;
      didAutoListen.current = false;
      return;
    }
    if (autoPrompt.current !== lastAgent.id) {
      autoPrompt.current = lastAgent.id;
      heardPrompt.current = false;
      didAutoListen.current = false;
    }
    if (speaking) {
      heardPrompt.current = true;
    } else if (heardPrompt.current && !didAutoListen.current && !voice.listening && voice.supported) {
      didAutoListen.current = true;
      void voice.start();
    }
  }, [pendingWhatsAppChoice, lastAgent?.id, lastAgent?.at, lastUser?.at, speaking, voice.listening, voice.supported, voice.start]);

  return (
    <PageFrame>
      <PageHeader title="Voice Assistant" subtitle="Roman Urdu ya English mein boliye. HUKM Roman Urdu mein jawab bolay ga (device voice se)." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex flex-col items-center px-5 pb-8 pt-2 text-center">
          <div className="h-[260px] w-full max-w-md">
            <Suspense fallback={null}><BrainOrb state={brain} level={audioLevel} reducedMotion={reduced} className="h-full w-full" /></Suspense>
          </div>
          <div className="flex items-center gap-4">
            <Waveform active={voice.listening} level={audioLevel} bars={14} mirror reduced={reduced} className="h-12" />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={voice.toggle}
              disabled={!voice.supported}
              className={cx('relative grid h-24 w-24 place-items-center rounded-full text-white transition active:scale-95 disabled:opacity-50', voice.listening && 'glow-ring')}
              style={{ background: 'radial-gradient(circle at 35% 30%, rgb(var(--blue2)), rgb(var(--blue)) 55%, rgb(12 60 140))', boxShadow: '0 0 0 8px rgb(var(--blue)/0.12), 0 14px 50px -8px rgb(var(--blue))' }}
              aria-label={voice.listening ? 'Stop listening' : 'Start listening'}
            >
              {voice.listening && <span className="absolute inset-0 animate-pulse-ring rounded-full ring-4 ring-ice/50" />}
              {voice.supported ? <Mic className="h-10 w-10" /> : <MicOff className="h-10 w-10" />}
            </button>
            <Waveform active={voice.listening} level={audioLevel} bars={14} mirror reduced={reduced} className="h-12" />
          </div>
          <p className="mt-3 text-sm font-medium text-ice">{voice.listening ? 'Recording — speak now' : 'Tap the microphone to speak'}</p>
          <div className="mt-4 min-h-[64px] w-full max-w-lg rounded-2xl bg-field/40 px-4 py-3 text-left ring-1 ring-line/10">
            <p className="text-[11px] uppercase tracking-wider text-ink2">Transcript</p>
            <p className="mt-1 text-[15px]" dir="auto">{voice.listening ? voice.transcript || '…' : lastUser && lastUser.kind === 'user' ? lastUser.text : <span className="text-ink2">Nothing yet</span>}</p>
          </div>
          {lastAgent && lastAgent.kind === 'agent' && (
            <div className="mt-3 w-full max-w-lg rounded-2xl bg-blue/10 px-4 py-3 text-left ring-1 ring-ice/20">
              <p className="text-[11px] uppercase tracking-wider text-ink2">HUKM replied</p>
              <p className={cx('mt-1 text-[15px]', settings.responseLang === 'ur' && 'urdu text-right')}>{pick(lastAgent.msg, settings.responseLang)}</p>
              <div className="mt-2 flex gap-2">
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => (hasLastUtterance() ? replayLast() : say(lastAgent.msg, true))}><Repeat className="h-3.5 w-3.5" /> Replay</button>
                {speaking && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={stopSpeaking}><Square className="h-3.5 w-3.5" /> Stop speaking</button>}
              </div>
            </div>
          )}
          {pendingWhatsAppChoice && (
            <div className="mt-3 w-full max-w-lg rounded-2xl border border-ice/25 bg-blue/10 p-3 text-left">
              <p className="mb-2 text-sm font-medium">{voice.listening ? 'Boliye: Desktop ya Web' : 'WhatsApp Desktop ya Web? Boliye ya select karein.'}</p>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={() => void runText('Desktop wala')}>Desktop App</button>
                <button className="btn-ghost flex-1" onClick={() => void runText('Web wala')}>WhatsApp Web</button>
              </div>
            </div>
          )}
          {voice.error && (
            <div className="mt-3 flex w-full max-w-lg items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-left text-sm text-warn ring-1 ring-warn/25">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{voice.error}</span>
              <button className="font-semibold underline" onClick={() => { voice.clearError(); voice.start(); }}>Retry</button>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-0">
            <CardHeader icon={<Mic className="h-5 w-5" />} title="Voice input" />
            <div className="space-y-3 px-5 pb-5 pt-3 text-sm">
              <Row label="Speech recognition">{voice.supported ? <Badge tone="ok" dot>Available</Badge> : <Badge tone="bad" dot>Not in this browser</Badge>}</Row>
              <Row label="Microphone permission">
                <Badge tone={voice.permission === 'granted' ? 'ok' : voice.permission === 'denied' ? 'bad' : 'muted'} dot>{voice.permission === 'unknown' ? 'Asked on first use' : voice.permission}</Badge>
              </Row>
              <div>
                <label className="label" htmlFor="rlang">Recognition language</label>
                <select id="rlang" className="input" value={settings.recognitionLang} onChange={(e) => saveSettings({ recognitionLang: e.target.value })}>
                  {RECOGNITION_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
                </select>
                <p className="mt-1.5 text-xs text-ink2">Roman Urdu / English (en-PK) recommended hai. Misaal: "Notepad kholo" ya "Chrome open karo". Recognition ki accuracy browser aur accent par depend karti hai.</p>
              </div>
            </div>
          </Card>
          <Card className="p-0">
            <CardHeader icon={<Volume2 className="h-5 w-5" />} title="Spoken replies" action={
              <button onClick={() => saveSettings({ speechMuted: !settings.speechMuted })} className={cx('chip ring-1', settings.speechMuted ? 'text-warn ring-warn/30' : 'text-ok ring-ok/30')}>
                {settings.speechMuted ? <><VolumeX className="h-3.5 w-3.5" /> Muted</> : <><Volume2 className="h-3.5 w-3.5" /> On</>}
              </button>
            } />
            <div className="space-y-3 px-5 pb-5 pt-3 text-sm">
              {!ttsSupported() && <p className="text-warn">Browser mein device voice available nahi. Online preview try kar sakte hain.</p>}
              <Row label="Pakistani female voice — Uzma">
                <Badge tone="muted" dot>Free online preview</Badge>
              </Row>
              <Row label="Pakistani Urdu voice on this device">
                {uzma ? <Badge tone="ok" dot>Available</Badge> : <Badge tone="warn" dot>Not installed</Badge>}
              </Row>
              <p className="rounded-xl bg-blue/10 px-3 py-2 text-xs text-ink2 ring-1 ring-ice/20">
                Automatic mode server se Pakistani female Uzma ki awaaz try karega, Chrome par bhi.
                Agar free service busy ho ya audio fail ho to HUKM aapki device ki female voice mein bolay ga.
                Speech banane ke liye Urdu text online Microsoft service ko jata hai. Ye unofficial free preview hai, guaranteed nahi.
              </p>
              <div>
                <label className="label" htmlFor="voice">Voice</label>
                <select id="voice" className="input" value={settings.voiceURI ?? ''} onChange={(e) => saveSettings({ voiceURI: e.target.value || null })}>
                  <option value="">Pakistani Female — Uzma (Free Online)</option>
                  <option value="device:auto">Automatic Device Voice (Offline)</option>
                  {[...urduVoices, ...voices.filter((v) => !v.lang.toLowerCase().startsWith('ur') && /^(en|hi)/i.test(v.lang))].map((v) => {
                    const g = voiceGender(v);
                    return <option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.lang}{g ? ` · ${g}` : ''}</option>;
                  })}
                </select>
                <p className="mt-1.5 text-xs text-ink2">Uzma Online by default. Agar online service na chale to device voice use hogi. Kisi bhi device voice ko manually select kar sakte hain.</p>
              </div>
              <Slider label="Speech speed" min={0.5} max={2} step={0.1} value={settings.speechRate} fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => saveSettings({ speechRate: v })} />
              <Slider label="Volume" min={0} max={1} step={0.05} value={settings.speechVolume} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => saveSettings({ speechVolume: v })} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost px-3 py-2 text-xs" onClick={() => say({ roman: 'Assalam o Alaikum, main HUKM hoon.', ur: 'السلام علیکم، میں حکم ہوں۔', en: 'Hello, I am HUKM.' }, true)}><CheckCircle2 className="h-4 w-4" /> Test selected voice</button>
                <button className="btn-ghost px-3 py-2 text-xs" onClick={stopSpeaking}><Square className="h-4 w-4" /> Stop</button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-ink2">{label}</span>{children}</div>;
}

export function Slider({ label, min, max, step, value, onChange, fmt }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="label mb-0">{label}</span><span className="text-ink2">{fmt(v)}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} className="w-full accent-[rgb(var(--blue))]" />
    </div>
  );
}
