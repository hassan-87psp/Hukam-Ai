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
import {normalize} from '../../../packages/command-protocol/src/normalize';

export type CalendarProvider='google'|'outlook';
export type RecentCalendarContext={
  provider:CalendarProvider; profile:string|null; requestedAt:string;
  action:'web.open'|'browser.profile_open'; status:string;
};

const WINDOW_MS=30*60_000;
const ALLOWED_PROFILE=/^(?:Default|Profile [1-9][0-9]?)$/;

export function explicitCalendarProvider(request:string):CalendarProvider|null{
  const text=normalize(request);
  if(/\b(?:google\s+calendar|gcal)\b/.test(text))return 'google';
  if(/\b(?:outlook\s+calendar|microsoft\s+calendar)\b/.test(text))return 'outlook';
  return null;
}

export function calendarSchedulingIntent(request:string):boolean{
  const text=normalize(request);
  const calendarTopic=/\b(?:meeting|calendar|appointment|event)\b/.test(text);
  const scheduleVerb=/\b(?:schedule|create|book|add|set|draft|banao|banado|bana|banaye|rakho|fix|plan|invite|reschedule)\b/.test(text);
  // "meeting link ready krdo" asks to prepare an event, not search the web.
  // This leads to a reviewed Calendar DRAFT only; no meeting link is claimed
  // until the owner verifies the Calendar-generated conference link.
  const prepareMeetingLink=/\bmeeting\b.*\blink\b.*\bready\b/.test(text) &&
    /\b(?:karo|kar do|banao|banado|create|prepare)\b/.test(text);
  return calendarTopic && (scheduleVerb || prepareMeetingLink);
}

export function recentCalendarContext(db:DB,userId:string,projectId:string|null,now=Date.now()):RecentCalendarContext|null{
  const cutoff=new Date(now-WINDOW_MS).toISOString();
  // The latest explicit app/navigation command wins. Opening a different
  // app or website invalidates Calendar focus rather than resurrecting an
  // older Calendar tab from the same day. Projects may inspect ONLY their
  // own operator plans; General commands cannot cross into a Project.
  const rows=projectId===null
    ? all(db,`SELECT action,args,status,created_at,result FROM commands
      WHERE user_id=? AND source IN ('text','voice','ui')
        AND action IN ('web.open','browser.profile_open','app.open','whatsapp.open')
        AND created_at>=? AND status IN ('pending','running','completed')
        AND (client_request_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM operator_runs r JOIN operator_plans p ON p.id=r.plan_id
          WHERE r.user_id=commands.user_id AND p.user_id=commands.user_id
            AND substr(commands.client_request_id,1,length(r.id)+1)=r.id||'-'
            AND p.project_id IS NOT NULL))
      ORDER BY created_at DESC,rowid DESC LIMIT 1`,userId,cutoff)
    : all(db,`SELECT c.action,c.args,c.status,c.created_at,c.result FROM commands c
      JOIN operator_runs r ON r.user_id=c.user_id
        AND substr(c.client_request_id,1,length(r.id)+1)=r.id||'-'
      JOIN operator_plans p ON p.id=r.plan_id AND p.user_id=c.user_id
      WHERE c.user_id=? AND p.project_id=?
        AND c.action IN ('web.open','browser.profile_open','app.open','whatsapp.open')
        AND c.created_at>=? AND c.status IN ('pending','running','completed')
      ORDER BY c.created_at DESC,c.rowid DESC LIMIT 1`,userId,projectId,cutoff);
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
