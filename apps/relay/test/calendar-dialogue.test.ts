import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {
  recentCalendarContext,explicitCalendarProvider,calendarSchedulingIntent,
} from '../src/recent-calendar-context';
import {
  CALENDAR_SLOT_PREFIX,blankCalendarSlots,decodeCalendarSlots,advanceCalendarSlots,
} from '../src/calendar-dialogue';

const NOW=Date.parse('2026-11-22T09:00:00Z'); // 5 PM in Malaysia
let db:DatabaseSync|null=null;
function setup(){
  db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE commands (
    user_id TEXT, action TEXT, args TEXT, status TEXT, source TEXT,
    created_at TEXT, client_request_id TEXT, result TEXT
  );
  CREATE TABLE operator_plans(id TEXT, user_id TEXT,project_id TEXT);
  CREATE TABLE operator_runs(id TEXT,user_id TEXT,plan_id TEXT);`);
  return db;
}
function command(user:string,action:string,args:object,at=NOW,status='completed',clientRequestId:string|null=null){
  db!.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?,?,?)').run(
    user,action,JSON.stringify(args),status,'text',new Date(at).toISOString(),clientRequestId,
    JSON.stringify({opened:true}));
}
afterEach(()=>{db?.close();db=null;});

describe('HUKM short-term context from real owner commands',()=>{
  it('recognizes Roman Urdu scheduling without inventing Google from the meeting request',()=>{
    expect(calendarSchedulingIntent('meeting schedule kro 5.bjy ka')).toBe(true);
    expect(calendarSchedulingIntent('Google Calendar kholo')).toBe(false);
    expect(explicitCalendarProvider('Google Calendar kholo')).toBe('google');
    expect(explicitCalendarProvider('Outlook Calendar open karo')).toBe('outlook');
    expect(explicitCalendarProvider('meeting schedule kro 5.bjy ka')).toBeNull();
  });
  it('retains the last opened Calendar provider but never claims login or save',()=>{
    const c=setup();
    command('owner','web.open',{url:'https://calendar.google.com/calendar/u/0/r'});
    expect(recentCalendarContext(c,'owner',null,NOW+1000)).toMatchObject({
      provider:'google',profile:null,action:'web.open',status:'completed'});
    expect(recentCalendarContext(c,'other',null,NOW+1000)).toBeNull();
    expect(recentCalendarContext(c,'owner',null,NOW+31*60_000)).toBeNull();
  });
  it('does not reuse Calendar context after another browser or app was requested',()=>{
    const c=setup();
    command('owner','web.open',{url:'https://calendar.google.com/calendar/u/0/r'});
    command('owner','app.open',{app:'notepad'},NOW+2000);
    expect(recentCalendarContext(c,'owner',null,NOW+3000)).toBeNull();
  });
  it('preserves the explicit Chrome profile when Calendar is opened in that profile',()=>{
    const c=setup();
    command('owner','browser.profile_open',{profile:'Profile 3',url:'https://outlook.office.com/calendar/'});
    expect(recentCalendarContext(c,'owner',null,NOW+1000)).toMatchObject({
      provider:'outlook',profile:'Profile 3'});
  });
  it('isolates one Project Calendar from General and another Project',()=>{
    const c=setup();
    c.prepare('INSERT INTO operator_plans VALUES(?,?,?)').run('plan','owner','project-a');
    c.prepare('INSERT INTO operator_runs VALUES(?,?,?)').run('task_123','owner','plan');
    command('owner','browser.profile_open',{profile:'Profile 2',url:'https://calendar.google.com/'},
      NOW,'completed','task_123-0');
    expect(recentCalendarContext(c,'owner','project-a',NOW+1000)).toMatchObject({
      provider:'google',profile:'Profile 2'});
    expect(recentCalendarContext(c,'owner','project-b',NOW+1000)).toBeNull();
    expect(recentCalendarContext(c,'owner',null,NOW+1000)).toBeNull();
  });
  it('rejects simulation and unrelated domains',()=>{
    const c=setup();
    command('owner','web.open',{url:'https://calendar.google.com.evil.test/'});
    expect(recentCalendarContext(c,'owner',null,NOW+1000)).toBeNull();
  });
});

describe('Calendar multi-turn slot memory',()=>{
  it('resolves Google Calendar kholo → meeting schedule kro 5.bjy ka → date/PM/title/duration/profile',()=>{
    let next=advanceCalendarSlots(blankCalendarSlots('google'),
      'meeting schedule kro 5.bjy ka','',NOW);
    expect(next.slots.rawHour).toBe(5);
    expect(next.slots.hour).toBeNull();
    expect(next.question).toContain('kis date');
    let state=decodeCalendarSlots(CALENDAR_SLOT_PREFIX+JSON.stringify(next.slots));
    expect(state).not.toBeNull();
    next=advanceCalendarSlots(state!,'kal',next.question!,NOW);
    expect(next.slots.date).toBe('2026-11-23');
    expect(next.question).toMatch(/AM|PM/);
    next=advanceCalendarSlots(next.slots,'shaam',next.question!,NOW);
    expect(next.slots.hour).toBe(17);
    expect(next.question).toContain('title');
    next=advanceCalendarSlots(next.slots,'Team Sync',next.question!,NOW);
    expect(next.slots.title).toBe('Team Sync');
    expect(next.question).toContain('der');
    next=advanceCalendarSlots(next.slots,'30 minutes',next.question!,NOW);
    expect(next.slots.durationMinutes).toBe(30);
    expect(next.question).toContain('Chrome profile');
    next=advanceCalendarSlots(next.slots,'Default',next.question!,NOW);
    expect(next.question).toBeNull();
    expect(next.startUtc).toBe('2026-11-23T09:00:00.000Z');
    expect(next.endUtc).toBe('2026-11-23T09:30:00.000Z');
  });
  it('reads a complete unambiguous request in one message with saved Project profile',()=>{
    const next=advanceCalendarSlots(blankCalendarSlots('outlook','Profile 1'),
      '2026-11-23 17:30 meeting title: Client Call 1 hour','',NOW);
    expect(next.slots.hour).toBe(17);
    expect(next.slots.minute).toBe(30);
    expect(next.slots.title).toContain('Client Call');
    expect(next.durationMinutes).toBeUndefined();
    expect(next.question).toBeNull();
  });
  it('refuses to schedule a past event or assume AM/PM or a meeting title',()=>{
    const first=advanceCalendarSlots(blankCalendarSlots('google','Default'),
      'meeting schedule 5 bjy aaj', '',NOW);
    expect(first.slots.rawHour).toBe(5);
    expect(first.slots.hour).toBeNull();
    const withTime=advanceCalendarSlots(first.slots,'shaam',first.question!,NOW);
    expect(withTime.question).toContain('title');
    const title=advanceCalendarSlots(withTime.slots,'Team Check-in',withTime.question!,NOW);
    const complete=advanceCalendarSlots(title.slots,'1 hour',title.question!,NOW);
    expect(complete.question).toMatch(/guzar chuka/);
    expect(complete.slots.date).toBeNull();
  });
  it('rejects malformed persisted state, including unauthorized Chrome profiles',()=>{
    expect(decodeCalendarSlots(CALENDAR_SLOT_PREFIX+'{}')).toBeNull();
    expect(decodeCalendarSlots(CALENDAR_SLOT_PREFIX+JSON.stringify({
      ...blankCalendarSlots('google'),profile:'../../Default'}))).toBeNull();
  });
});
