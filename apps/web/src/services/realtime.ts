import type { ServerToClient } from '../../../../packages/shared-types/src/index';

type Listener = (m: ServerToClient) => void;
type StateListener = (s: RealtimeState) => void;
export type RealtimeState = 'connecting' | 'open' | 'closed';

/** Authenticated (cookie) WebSocket to the relay with automatic reconnection. */
export class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private retry = 0;
  private stopped = false;
  private timer: number | null = null;
  state: RealtimeState = 'closed';

  start() {
    this.stopped = false;
    this.connect();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
  }

  stop() {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onState(l: StateListener) {
    this.stateListeners.add(l);
    l(this.state);
    return () => this.stateListeners.delete(l);
  }

  private setState(s: RealtimeState) {
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) {
      this.retry = 0;
      this.connect();
    }
  };

  private connect() {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.setState('connecting');
    const ws = new WebSocket(`${proto}//${location.host}/ws/client`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('open');
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as ServerToClient;
        this.listeners.forEach((l) => l(m));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setState('closed');
      if (this.stopped) return;
      const delay = Math.min(30000, 800 * 2 ** this.retry++) + Math.random() * 400;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
