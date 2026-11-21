/** Unknown and malformed telemetry must not be displayed as zero usage. */
export function metric(value:unknown,unit:string,max=Number.MAX_SAFE_INTEGER):string{
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max
    ? String(Math.round(value*10)/10)+unit : '—';
}
export function taskTone(status:string):'ok'|'warn'|'bad'|'muted'{
  if(status==='completed')return 'ok';
  if(status==='failed')return 'bad';
  if(['running','queued','awaiting_approval','unverified','interrupted'].includes(status))return 'warn';
  return 'muted';
}
export function taskProgress(current:number,total:number):number{
  return Number.isFinite(current)&&Number.isFinite(total)&&total>0?Math.max(0,Math.min(100,Math.round(current/total*100))):0;
}
