import { AppWindow, Globe, Link2, Search, Youtube } from 'lucide-react';
import { useState } from 'react';
import { Card, CardHeader, NotConnected, PageHeader } from '../components/ui';
import { CommandRow } from '../features/command/CommandCard';
import { PageFrame } from '../layouts/AppShell';
import { useStore } from '../services/store';

const SITES = [
  { name: 'TradingView', url: 'https://www.tradingview.com/' },
  { name: 'Forex Factory', url: 'https://www.forexfactory.com/' },
  { name: 'Investing.com', url: 'https://www.investing.com/' },
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
];

export default function Browser() {
  const { runAction, activeDevice, commands } = useStore();
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [yt, setYt] = useState('');
  const off = !activeDevice?.online;
  const recent = commands.filter((c) => ['web.open', 'web.search', 'youtube.search', 'youtube.play', 'window.active'].includes(c.action)).slice(0, 8);
  const browserName = activeDevice?.controllerConfig?.browser === 'default' ? 'default browser' : activeDevice?.controllerConfig?.browser ?? 'browser';

  return (
    <PageFrame>
      <PageHeader title="Browser Control" subtitle={`Opens pages in the laptop’s ${browserName}. Only http/https addresses are allowed.`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-0">
          <CardHeader icon={<Link2 className="h-5 w-5" />} title="Open website" />
          <form className="flex gap-2 px-5 pb-4 pt-3" onSubmit={(e) => { e.preventDefault(); if (url.trim()) runAction('web.open', { url: url.trim() }, { label: `Open ${url.trim()}` }); }}>
            <input className="input" placeholder="forexfactory.com/calendar" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
            <button className="btn-primary" disabled={off || !url.trim()}>Open</button>
          </form>
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            {SITES.map((s) => <button key={s.name} disabled={off} className="btn-ghost px-3 py-1.5 text-xs" onClick={() => runAction('web.open', { url: s.url }, { label: `${s.name} kholo` })}>{s.name}</button>)}
          </div>
        </Card>
        <Card className="p-0">
          <CardHeader icon={<Search className="h-5 w-5" />} title="Search the web" />
          <form className="flex gap-2 px-5 pb-5 pt-3" onSubmit={(e) => { e.preventDefault(); if (q.trim()) runAction('web.search', { query: q.trim() }, { label: `Browser mein ${q.trim()} search karo` }); }}>
            <input className="input" placeholder="Forex news" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
            <button className="btn-primary" disabled={off || !q.trim()}>Search</button>
          </form>
        </Card>
        <Card className="p-0">
          <CardHeader icon={<Youtube className="h-5 w-5 text-[#ff4e45]" />} title="YouTube" />
          <form className="space-y-2 px-5 pb-5 pt-3" onSubmit={(e) => e.preventDefault()}>
            <input className="input" placeholder="Gold analysis" value={yt} onChange={(e) => setYt(e.target.value)} dir="auto" />
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" disabled={off || !yt.trim()} onClick={() => runAction('youtube.search', { query: yt.trim() }, { label: `YouTube par ${yt.trim()} search karo` })}>Search</button>
              <button type="button" className="btn-primary flex-1" disabled={off || !yt.trim()} onClick={() => runAction('youtube.play', { query: yt.trim() }, { label: `YouTube par ${yt.trim()} play karo` })}>Play top result</button>
            </div>
            <p className="text-xs text-ink2">“Play” picks the first organic result from YouTube’s public results page. If that can’t be determined it opens the results instead — and says so. Autoplay depends on the browser.</p>
          </form>
        </Card>
        <Card className="p-0">
          <CardHeader icon={<AppWindow className="h-5 w-5" />} title="Current page" />
          <div className="space-y-3 px-5 pb-5 pt-3">
            <button className="btn-ghost w-full" disabled={off} onClick={() => runAction('window.active', {}, { label: 'Active window batao' })}>Get active window title</button>
            <p className="text-xs text-ink2">Returns the title of the window in front (for a browser, the page title). Exact URLs aren’t read in V1.</p>
            <NotConnected title="Tabs, clicks & page scripting" body="Switching tabs, clicking page elements and reading URLs need a browser extension or automation driver. The adapter boundary exists; it isn’t connected yet." />
          </div>
        </Card>
        <Card className="p-0 lg:col-span-2">
          <CardHeader icon={<Globe className="h-5 w-5" />} title="Recent browser commands" />
          <div className="grid gap-1 px-3 pb-3 pt-2 md:grid-cols-2">
            {recent.map((c) => <CommandRow key={c.id} c={c} />)}
            {!recent.length && <p className="px-2 py-4 text-sm text-ink2">None yet.</p>}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
