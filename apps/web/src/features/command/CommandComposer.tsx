import { Mic, MicOff, SendHorizontal, Square } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { cx, Spinner } from '../../components/ui';
import { useReducedMotion, useVoiceInput } from '../../hooks/useVoice';
import { useStore } from '../../services/store';
import Waveform from './Waveform';

export default function CommandComposer({ placeholder = 'Speak in Urdu or English…', autoFocus, compact }: { placeholder?: string; autoFocus?: boolean; compact?: boolean }) {
  const { runText, submitting, audioLevel } = useStore();
  const voice = useVoiceInput();
  const reduced = useReducedMotion();
  const [text, setText] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || submitting) return;
    setText('');
    runText(t, 'text');
  };

  const shown = voice.listening ? voice.transcript : text;

  return (
    <div className="w-full">
      <form
        onSubmit={submit}
        className={cx(
          'group relative flex items-center gap-2 rounded-2xl p-1.5 pl-2 transition',
          'bg-field/70 ring-1 ring-blue2/40 backdrop-blur-md',
          'focus-within:ring-2 focus-within:ring-blue2/80 focus-within:shadow-[0_0_0_4px_rgb(var(--blue)/0.12),0_0_40px_-8px_rgb(var(--blue)/0.6)]',
          voice.listening && 'ring-2 ring-ice/80 shadow-[0_0_40px_-6px_rgb(var(--blue)/0.8)]',
        )}
      >
        <button
          type="button"
          onClick={voice.toggle}
          aria-label={voice.listening ? 'Stop listening' : 'Speak a command'}
          aria-pressed={voice.listening}
          className={cx(
            'relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition',
            voice.listening ? 'bg-blue text-white' : 'text-ice hover:bg-blue/15',
            !voice.supported && 'opacity-60',
          )}
        >
          {voice.listening && <span className="absolute inset-0 animate-pulse-ring rounded-xl ring-2 ring-ice/70" />}
          {voice.supported ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <input
          value={shown}
          onChange={(e) => setText(e.target.value)}
          readOnly={voice.listening}
          autoFocus={autoFocus}
          placeholder={voice.listening ? 'Listening…' : placeholder}
          enterKeyHint="send"
          dir="auto"
          className={cx('min-w-0 flex-1 bg-transparent py-2 text-[15px] text-ink placeholder:text-ink2/70 focus:outline-none', compact ? 'text-sm' : '')}
          aria-label="Command"
        />
        {!compact && <Waveform active={voice.listening || submitting} level={audioLevel} bars={9} className="hidden h-6 sm:flex" reduced={reduced} />}
        {voice.listening ? (
          <button type="button" onClick={voice.stop} className="grid h-10 w-10 place-items-center rounded-xl bg-bad/90 text-white" aria-label="Stop">
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || submitting}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white transition disabled:opacity-60"
            style={{ background: 'linear-gradient(180deg, rgb(var(--blue2)), rgb(var(--blue)))', boxShadow: '0 6px 20px -6px rgb(var(--blue))' }}
            aria-label="Send command"
          >
            {submitting ? <Spinner /> : <SendHorizontal className="h-[18px] w-[18px]" />}
          </button>
        )}
      </form>
      {voice.error && (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn ring-1 ring-warn/25">
          <span>{voice.error}</span>
          <button className="shrink-0 font-semibold underline" onClick={() => { voice.clearError(); voice.start(); }}>Retry</button>
        </div>
      )}
    </div>
  );
}
