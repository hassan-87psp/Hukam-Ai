/** Owner-scoped project settings, notes and persistent AI conversations.
 * Data is stored in the existing relay SQLite DB and included in private backup.
 * No Chrome session, cookies, passwords or API keys are stored.
 */
import { all, one, run, type DB, type Row } from './db';
import { HttpError } from './core';
import { newId, nowIso } from './util';

export type Project = {
  id: string; name: string; description: string; instructions: string;
  chromeProfile: string; chatgptProjectUrl: string; assetFolder: string;
  preferredDeviceId: string | null; createdAt: string; updatedAt: string;
};
export type ProjectMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type ProjectNote = { id: string; title: string; content: string; createdAt: string; updatedAt: string };

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'INVALID_FIELD', field + ' must be text up to ' + max + ' characters');
  return v.trim();
}
function mapProject(p: Row): Project {
  return { id: p.id, name: p.name, description: p.description, instructions: p.instructions,
    chromeProfile: p.chrome_profile, chatgptProjectUrl: p.chatgpt_project_url,
    assetFolder: p.asset_folder, preferredDeviceId: p.preferred_device_id ?? null,
    createdAt: p.created_at, updatedAt: p.updated_at };
}
const mapMsg = (x: Row): ProjectMessage => ({ id: x.id, role: x.role, content: x.content, createdAt: x.created_at });
const mapNote = (x: Row): ProjectNote => ({ id: x.id, title: x.title, content: x.content, createdAt: x.created_at, updatedAt: x.updated_at });

export class Projects {
  constructor(private db: DB) {}
  list(userId: string): Project[] {
    return all(this.db, 'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100', userId).map(mapProject);
  }
  get(userId: string, id: string): Project {
    const p = one(this.db, 'SELECT * FROM projects WHERE user_id = ? AND id = ?', userId, id);
    if (!p) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    return mapProject(p);
  }
  save(userId: string, id: string | null, data: Record<string, unknown>): Project {
    const old = id ? this.get(userId, id) : null;
    if (!old && !id && this.list(userId).length >= 60) throw new HttpError(400, 'PROJECT_LIMIT', 'Maximum 60 projects');
    const value = (k: keyof Project, max: number) => data[k] === undefined ? (old?.[k] ?? '') : str(data[k], k, max);
    const name = value('name', 80);
    if (!name) throw new HttpError(400, 'PROJECT_NAME', 'Project name required');
    const description = value('description', 400);
    const instructions = value('instructions', 6000);
    const chromeProfile = value('chromeProfile', 100);
    const assetFolder = value('assetFolder', 350);
    const chatgptProjectUrl = value('chatgptProjectUrl', 500);
    if (chatgptProjectUrl) {
      let url: URL;
      try { url = new URL(chatgptProjectUrl); }
      catch { throw new HttpError(400, 'PROJECT_URL', 'Invalid ChatGPT Project URL'); }
      if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.username || url.password || url.hash)
        throw new HttpError(400, 'PROJECT_URL', 'Only HTTPS chatgpt.com project URLs are allowed');
    }
    const preferredDeviceId = data.preferredDeviceId === undefined ? (old?.preferredDeviceId ?? null)
      : data.preferredDeviceId === null ? null : str(data.preferredDeviceId, 'preferredDeviceId', 120);
    if (preferredDeviceId && !one(this.db, "SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND status = 'paired'", preferredDeviceId, userId))
      throw new HttpError(400, 'PROJECT_DEVICE', 'Device is not paired to your account');
    const now = nowIso(), projectId = id ?? newId('prj_');
    if (old) {
      run(this.db, `UPDATE projects SET name=?, description=?, instructions=?, chrome_profile=?, chatgpt_project_url=?,
        asset_folder=?, preferred_device_id=?, updated_at=? WHERE user_id=? AND id=?`,
        name, description, instructions, chromeProfile, chatgptProjectUrl, assetFolder, preferredDeviceId, now, userId, projectId);
    } else if (id) {
      throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    } else {
      run(this.db, `INSERT INTO projects
        (id,user_id,name,description,instructions,chrome_profile,chatgpt_project_url,asset_folder,preferred_device_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        projectId, userId, name, description, instructions, chromeProfile, chatgptProjectUrl, assetFolder, preferredDeviceId, now, now);
    }
    return this.get(userId, projectId);
  }
  remove(userId: string, id: string) {
    this.get(userId, id);
    run(this.db, 'DELETE FROM projects WHERE user_id=? AND id=?', userId, id);
    return { ok: true };
  }
  messages(userId: string, projectId: string): ProjectMessage[] {
    this.get(userId, projectId);
    return all(this.db, `SELECT id,role,content,created_at FROM
      (SELECT * FROM project_messages WHERE user_id=? AND project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100)
      ORDER BY created_at ASC`, userId, projectId).map(mapMsg);
  }
  appendMessage(userId: string, projectId: string, role: 'user' | 'assistant', content: unknown): ProjectMessage {
    this.get(userId, projectId);
    if (role !== 'user' && role !== 'assistant') throw new HttpError(400, 'INVALID_ROLE', 'Invalid message role');
    const text = str(content, 'content', 3600);
    if (!text) throw new HttpError(400, 'EMPTY_MESSAGE', 'Message cannot be empty');
    const id = newId('pm_'), now = nowIso();
    run(this.db, 'INSERT INTO project_messages(id,user_id,project_id,role,content,created_at) VALUES(?,?,?,?,?,?)',
      id,userId,projectId,role,text,now);
    run(this.db, `DELETE FROM project_messages WHERE user_id=? AND project_id=? AND id NOT IN
      (SELECT id FROM project_messages WHERE user_id=? AND project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)`,
      userId,projectId,userId,projectId);
    run(this.db, 'UPDATE projects SET updated_at=? WHERE id=? AND user_id=?',now,projectId,userId);
    return {id,role,content:text,createdAt:now};
  }
  clearMessages(userId:string,projectId:string){
    this.get(userId,projectId);
    run(this.db,'DELETE FROM project_messages WHERE user_id=? AND project_id=?',userId,projectId);
    return {ok:true};
  }
  notes(userId: string, projectId: string): ProjectNote[] {
    this.get(userId,projectId);
    return all(this.db, 'SELECT * FROM project_notes WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 100',
      userId,projectId).map(mapNote);
  }
  saveNote(userId:string,projectId:string,id:string|null,body:Record<string,unknown>):ProjectNote {
    this.get(userId,projectId);
    const prev = id ? one(this.db,'SELECT * FROM project_notes WHERE user_id=? AND project_id=? AND id=?',userId,projectId,id) : null;
    if (id && !prev) throw new HttpError(404,'NOTE_NOT_FOUND','Note not found');
    if (!prev && this.notes(userId,projectId).length >= 100) throw new HttpError(400,'NOTE_LIMIT','Maximum 100 notes per project');
    const title = body.title===undefined && prev ? prev.title : str(body.title,'title',120);
    const content = body.content===undefined && prev ? prev.content : str(body.content,'content',3500);
    if(!title) throw new HttpError(400,'NOTE_TITLE','Note title required');
    const key = id ?? newId('note_'),now=nowIso();
    if(prev) run(this.db,'UPDATE project_notes SET title=?,content=?,updated_at=? WHERE user_id=? AND project_id=? AND id=?',
      title,content,now,userId,projectId,key);
    else run(this.db,'INSERT INTO project_notes(id,user_id,project_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      key,userId,projectId,title,content,now,now);
    return mapNote(one(this.db,'SELECT * FROM project_notes WHERE id=? AND user_id=?',key,userId)!);
  }
  removeNote(userId:string,projectId:string,id:string){
    this.get(userId,projectId);
    const n=run(this.db,'DELETE FROM project_notes WHERE user_id=? AND project_id=? AND id=?',userId,projectId,id).changes;
    if(!n) throw new HttpError(404,'NOTE_NOT_FOUND','Note not found');
    return {ok:true};
  }
}
