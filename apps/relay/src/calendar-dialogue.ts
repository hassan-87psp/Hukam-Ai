/** Durable owner-scoped Calendar clarification slots.
 *
 * Resolve date/time/provider/profile from the user's own messages only.
 * A complete result creates an approval-gated DRAFT; it NEVER saves an
 * event, invites attendees or asserts provider-side success.
 */
import type {CalendarProvider} from './recent-calendar-context';

export const CALENDAR_SLOT_PREFIX='HUKM_CALENDAR_SLOTS:';
export type CalendarSlots={
  provider:CalendarProvider;
  profile:string|null;
  date:string|null;
  hour:number|null; // 0..23 only once AM/PM is established
  minute:number;
  rawHour:number|null; // 1..12 with unresolved AM/PM
  title:string|null;
  durationMinutes:number|null;
};
export type CalendarNext={slots:CalendarSlots;question:string|null;startUtc?:string;endUtc?:string};

export function blankCalendarSlots(provider:CalendarProvider,profile:string|null=null):CalendarSlots{
  return {provider,profile,date:null,hour:null,minute:0,rawHour:null,title:null,durationMinutes:null};
}
export function decodeCalendarSlots(request:unknown):CalendarSlots|null{
  if(typeof request!=='string'||!request.startsWith(CALENDAR_SLOT_PREFIX))return null;
  try{
    const v=JSON.parse(request.slice(CALENDAR_SLOT_PREFIX.length)) as CalendarSlots;
    if(!v||!['google','outlook'].includes(v.provider) ||
       (v.profile!==null&&!/^(?:Default|Profile [1-9][0-9]?)$/.test(v.profile)) ||
       (v.date!==null&&(typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date))) ||
       (v.hour!==null&&(!Number.isInteger(v.hour)||v.hour<0||v.hour>23)) ||
       (v.rawHour!==null&&(!Number.isInteger(v.rawHour)||v.rawHour<1||v.rawHour>12)) ||
       !Number.isInteger(v.minute)||v.minute<0||v.minute>59 ||
       (v.title!==null&&(typeof v.title!=='string'||v.title.length>100)) ||
       (v.durationMinutes!==null&&(!Number.isInteger(v.durationMinutes)||v.durationMinutes<5||v.durationMinutes>480)))
      return null;
    return v;
  }catch{return null;}
}

function localYmd(now:number):string{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const field=(kind:string)=>parts.find(p=>p.type===kind)?.value??'';
  return field('year')+'-'+field('month')+'-'+field('day');
}
function calendarDayValid(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number);
  return y>=2025&&y<=2100&&new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)===value;
}
function dateMention(input:string,now:number):string|null{
  const explicit=input.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if(explicit)return calendarDayValid(explicit[1])?explicit[1]:null;
  const lower=input.toLowerCase();
  const current=localYmd(now);
  if(/\b(?:kal|tomorrow)\b/.test(lower)){
    const [y,m,d]=current.split('-').map(Number);
    return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
  }
  if(/\b(?:aaj|today)\b/.test(lower))return current;
  return null;
}
function profileMention(input:string):string|null{
  const match=input.match(/\b(Default|Profile [1-9][0-9]?)\b/i);
  if(!match)return null;
  return match[1].toLowerCase()==='default'?'Default':
    'Profile '+match[1].split(/\s+/)[1];
}
function timeMention(input:string):{hour:number|null;rawHour:number|null;minute:number}|null{
  const text=input.toLowerCase().replace(/(\d)\.\s*(?=bjy\b|baje\b|bj\b)/g,'$1 ');
  const matches=[...text.matchAll(/\b([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:baje|bjy|bj|bajay|o'clock|am|pm)?\b/g)];
  const hasClock=/(?:baje|bjy|bj|bajay|o'clock|am|pm|subah|shaam|sham|evening|morning|\d{1,2}[:.]\d{2})/i.test(text);
  if(!hasClock)return null;
  // Date, year and duration can contain digits. Accept the first number next
  // to a clock word; 24-hour HH:mm notation is an explicit clock by itself.
  let picked:RegExpMatchArray|null=null;
  for(const match of matches){
    const after=text.slice((match.index??0)+match[0].length,((match.index??0)+match[0].length)+22);
    const before=text.slice(Math.max(0,(match.index??0)-18),match.index??0);
    if(/^(?:\s*(?:baje|bjy|bj|bajay|am|pm|shaam|sham|subah|evening|morning)\b)/.test(after) ||
       /(?:subah|shaam|sham|evening|morning)\s*$/.test(before) ||
       /[:.]\d{2}/.test(match[0]) ||
       /\b(?:baje|bjy|bj|bajay|am|pm)\b/.test(match[0])){picked=match;break;}
  }
  if(!picked)return null;
  const h=Number(picked[1]),minute=picked[2]?Number(picked[2]):0;
  const period=/\b(?:pm|shaam|sham|evening)\b/.test(text)?'pm':
               /\b(?:am|subah|morning)\b/.test(text)?'am':null;
  if(h>12)return {hour:h,rawHour:null,minute};
  if(period)return {hour:(h%12)+(period==='pm'?12:0),rawHour:null,minute};
  return {hour:null,rawHour:h===0?null:h,minute};
}
function durationMention(input:string):number|null{
  const m=input.match(/\b(\d{1,3})\s*(minute|minutes|mins|min|ghant[ae]|hour|hours|hr)\b/i);
  if(!m)return null;
  const n=Number(m[1]),duration=/^(?:ghant|hour|hr)/i.test(m[2])?n*60:n;
  return duration>=5&&duration<=480?duration:null;
}
function titleMention(input:string,asked:string):string|null{
  const explicit=input.match(/(?:^|\b)(?:title|subject|meeting name|meeting naam)\s*(?::|-|hai|is)?\s+([^\n]{2,100})/i);
  let value=explicit?.[1]?.trim();
  if(value)value=value.replace(/\s+\d{1,3}\s*(?:minutes?|mins?|ghant[ae]|hours?|hr)\s*$/i,'').trim();
  if(!value&&/title|meeting ka naam/i.test(asked)){
    const trimmed=input.trim();
    // Reply "Team Sync" is a title. Not "kal" or a time/duration/profile
    if(!/\b(?:aaj|kal|today|tomorrow|default|profile|baje|bjy|bj|am|pm|minutes?|hours?|ghanta)\b/i.test(trimmed) &&
       !/^\d/.test(trimmed))value=trimmed;
  }
  if(!value||value.length<2||value.length>100||/[\u0000-\u001f<>]/.test(value))return null;
  return value;
}

/** All follow-up details are safe owner-provided metadata, never auto-execute. */
export function advanceCalendarSlots(previous:CalendarSlots,input:string,asked='',now=Date.now()):CalendarNext{
  const next:CalendarSlots={...previous};
  const p=profileMention(input);if(p)next.profile=p;
  const date=dateMention(input,now);if(date)next.date=date;
  const tm=timeMention(input);
  if(tm){next.hour=tm.hour;next.rawHour=tm.rawHour;next.minute=tm.minute;}
  if(next.hour===null&&next.rawHour!==null){
    const period=/\b(?:pm|shaam|sham|evening)\b/i.test(input)?'pm':
                 /\b(?:am|subah|morning)\b/i.test(input)?'am':null;
    if(period){next.hour=(next.rawHour%12)+(period==='pm'?12:0);next.rawHour=null;}
  }
  const title=titleMention(input,asked);if(title)next.title=title;
  const duration=durationMention(input);if(duration)next.durationMinutes=duration;

  const label=next.provider==='google'?'Google Calendar':'Outlook Calendar';
  let question:string|null=null;
  if(!next.date)question=`${label} mein meeting kis date ko hai? Aaj, kal ya YYYY-MM-DD batayein.`;
  else if(next.hour===null)question=next.rawHour!==null
    ?`${label} ki meeting ${next.rawHour}${next.minute?':'+String(next.minute).padStart(2,'0'):''} baje — subah (AM) ya shaam (PM)?`
    :`${label} mein meeting kitne baje hai? Misal: 5 PM ya 17:00.`;
  else if(!next.title)question='Meeting ka title/naam kya rakhoon?';
  else if(!next.durationMinutes)question='Meeting kitni der ki hogi? Misal: 30 minutes ya 1 hour.';
  else if(!next.profile)question=`${label} kaunsa Chrome profile use karta hai? Default ya Profile 1 jaise exact naam batayein.`;

  if(question)return {slots:next,question};
  const [y,m,d]=(next.date as string).split('-').map(Number);
  const startMs=Date.UTC(y,m-1,d,(next.hour as number)-8,next.minute);
  if(startMs<=now+60_000){
    next.date=null;
    return {slots:next,question:'Yeh waqt guzar chuka hai. Meeting ke liye future date batayein.'};
  }
  const endMs=startMs+(next.durationMinutes as number)*60_000;
  const utcSeconds=(time:number)=>new Date(time).toISOString().replace(/\.\d{3}Z$/,'Z');
  return {slots:next,question:null,startUtc:utcSeconds(startMs),
    endUtc:utcSeconds(endMs)};
}
