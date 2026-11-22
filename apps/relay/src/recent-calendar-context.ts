/**
 * Short-lived, server-derived app context for conversational follow-ups.
 *
 * No model- or chat-authored application identity is trusted. The owner must
 * actually have requested a supported laptop action through their account.
 * Provider context is an INTENT hint, never proof that a browser authenticated
 * or a calendar event was saved. No passwords, contact lists or page content
 * are copied into conversational context.
 */
import {all,type DB} from './db';

export type CalendarProvider='google'|'outlook';
export type RecentCalendarContext={
  provider:CalendarProvider; profile:string|null; requestedAt:string;
  action:'web.open'|'browser.profile_open'; status:string;
};

const WINDOW_MS=30*60_000;
const ALLOWED_PROFILE=/^(?:Default|Profile [1-9][0-9]?)$/;

export function explicitCalendarProvider(request:string):CalendarProvider|null{
  if(/\b(?:google\s+calend[ae]r|gcal)\b/i.test(request))return 'google';
  if(/\b(?:outlook\s+calend[ae]r|microsoft\s+calend[ae]r)\b/i.test(request))return 'outlook';
  return null;
}

export function calendarSchedulingIntent(request:string):boolean{
  const text=request.toLowerCase().replace(/\s+/g,' ');
  return /\b(?:meeting|calendar|calender|appointment|event)\b/.test(text) &&
    /\b(?:schedule|create|book|add|set|draft|banao|banado|bana|banaye|rakho|fix|plan|invite|reschedule)\b/.test(text);
}

export function recentCalendarContext(db:DB,userId:string,projectId:string|null,now=Date.now()):RecentCalendarContext|null{
  if(projectId!==null)return null; // Separate HUKM Projects never inherit General browser context.
  const cutoff=new Date(now-WINDOW_MS).toISOString();
  // The latest explicit app/navigation command wins. Opening a different
  // app or website invalidates Calendar focus rather than resurrecting an
  // older Google Calendar tab from the same day.
  const rows=all(db,`SELECT action,args,status,created_at,result FROM commands
    WHERE user_id=? AND source IN ('text','voice','ui')
      AND action IN ('web.open','browser.profile_open','app.open','whatsapp.open')
      AND created_at>=? AND status IN ('pending','running','completed')
    ORDER BY created_at DESC,rowid DESC LIMIT 1`,userId,cutoff);
  if(!rows.length)return null;
  const latest=rows[0];
  if(latest.action!=='web.open'&&latest.action!=='browser.profile_open')return null;
  let args:Record<string,unknown>,result:Record<string,unknown>;
  try{
    args=JSON.parse(String(latest.args)) as Record<string,unknown>;
    result=latest.result?JSON.parse(String(latest.result)) as Record<string,unknown>:{};
  }catch{return null;}
  if(result.simulated===true)return null;
  const url=typeof args.url==='string'?args.url:'';
  let parsed:URL;
  try{parsed=new URL(url);}catch{return null;}
  if(parsed.protocol!=='https:')return null;
  const provider:CalendarProvider|null =
    parsed.hostname==='calendar.google.com'?'google':
    parsed.hostname==='outlook.office.com'&&parsed.pathname.startsWith('/calendar')?'outlook':null;
  if(!provider)return null;
  const profile=latest.action==='browser.profile_open' && typeof args.profile==='string' &&
    ALLOWED_PROFILE.test(args.profile)?args.profile:null;
  return {provider,profile,requestedAt:String(latest.created_at),
    action:latest.action,status:String(latest.status)};
}

export function calendarContextHint(context:RecentCalendarContext):string{
  const label=context.provider==='google'?'Google Calendar':'Outlook Calendar';
  return `Recent authenticated owner command targeted ${label} within 30 minutes. `+
    `This is a conversational provider reference only; browser sign-in, selected tab, `+
    `event creation and invites are NOT verified. `+
    (context.profile?`The owner explicitly used Chrome ${context.profile}. `:'Chrome profile is not known. ')+
    `A follow-up meeting request without a named provider may use ${label}; `+
    `ask only for missing date, AM/PM, title, duration, profile and other essential event details. `+
    `Never schedule/send invitations without separate owner review and action approval.`;
}
