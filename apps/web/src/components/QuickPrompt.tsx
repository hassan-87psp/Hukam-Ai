import { useEffect, useState } from 'react';
import { Modal } from './ui';

/** Small modal that asks for one value (e.g. a YouTube or web search query). */
export default function QuickPrompt({ open, title, placeholder, cta, onClose, onSubmit }: { open: boolean; title: string; placeholder: string; cta: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  useEffect(() => {
    if (open) setV('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!v.trim()} onClick={() => { onSubmit(v.trim()); onClose(); }}>{cta}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); onClose(); } }}>
        <input autoFocus className="input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} dir="auto" maxLength={200} />
      </form>
    </Modal>
  );
}
