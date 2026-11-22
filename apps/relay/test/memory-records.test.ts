import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDb,run} from '../src/db';
import {MemoryRecords,MEMORY_CATEGORIES} from '../src/memory-records';
import {Projects} from '../src/projects';

describe('owner-reviewed categorized memory',()=>{
  it('persists eight categories, isolates users/workspaces and respects AI consent',()=>{
    const dir=mkdtempSync(join(tmpdir(),'hukm-memory-'));
    const migrations=resolve(process.cwd(),'database/migrations');
    let db=openDb(dir,migrations);
    try{
      for(const id of ['a','b'])run(db,'INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)',id,id+'@example.test',id,'test-hash',new Date().toISOString());
      const projects=new Projects(db);
      const a=projects.save('a',null,{name:'Alpha'}),b=projects.save('b',null,{name:'Beta'});
      let mem=new MemoryRecords(db);
      for(const category of MEMORY_CATEGORIES)mem.save('a',a.id,null,{category,title:category,content:'reference-'+category,useInAI:category==='project'});
      const general=mem.save('a',null,null,{category:'personal',title:'General',content:'general-only'});
      const other=mem.save('b',b.id,null,{category:'project',title:'Beta',content:'other-owner',useInAI:true});
      expect(mem.list('a',a.id)).toHaveLength(8);
      expect(mem.context('a',a.id)).toContain('reference-project');
      expect(mem.context('a',a.id)).not.toContain('reference-personal');
      expect(mem.context('a',a.id)).not.toContain('general-only');
      expect(mem.context('a',null)).toBe('');
      // A newer large memory must not split JSON or crowd out older
      // approved facts that still fit in the requested context budget.
      mem.save('a',a.id,null,{category:'project',title:'Large reference',
          content:'L'.repeat(1600),useInAI:true});
      const packed=mem.context('a',a.id,230);
      expect(packed.length).toBeLessThanOrEqual(230);
      expect(packed).toContain('reference-project');
      for(const line of packed.split('\n').slice(1))expect(()=>JSON.parse(line)).not.toThrow();
      expect(mem.context('a',a.id,15)).toBe('');
      expect(mem.context('a',a.id,-20)).toBe('');
      expect(mem.context('a',a.id,Infinity)).toBe('');
      expect(()=>mem.list('a',b.id)).toThrow();
      expect(()=>mem.remove('a',a.id,other.id)).toThrow();
      expect(()=>mem.save('a',a.id,general.id,{title:'wrong scope'})).toThrow();
      expect(()=>mem.save('a',null,null,{category:'personal',title:'bad',content:'password: abc123'})).toThrow();
      db.close();db=openDb(dir,migrations);mem=new MemoryRecords(db);
      expect(mem.list('a',a.id)).toHaveLength(9);
      mem.save('a',null,general.id,{useInAI:true});
      expect(mem.context('a',null)).toContain('general-only');
      mem.remove('a',null,general.id);
      expect(mem.context('a',null)).toBe('');
      new Projects(db).remove('a',a.id);
      expect(()=>mem.list('a',a.id)).toThrow();
      expect(mem.list('b',b.id)).toHaveLength(1);
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
