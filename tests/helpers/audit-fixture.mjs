import {DatabaseSync} from 'node:sqlite';
import {applyCurrentSchema} from './schema.mjs';
import worker from '../../src/worker.js';
export function auditFixture(){
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db,{legacyMenu:true});
 const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(queries){db.exec('BEGIN');try{const result=queries.map(q=>q._run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ORDERING_ENABLED:'true',SESSION_SECRET:'local-audit-only-01234567890123456789',POS_STAFF_PASSWORD:'audit-owner-password',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'123456789',BANK_ACCOUNT_NAME:'TEST ONLY'};
 const call=async(path,method='GET',data,token)=>{const response=await worker.fetch(new Request('https://audit.test'+path,{method,headers:{Origin:'https://audit.test',...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),env);return {status:response.status,...await response.json()}};
 const login=async(username='huang',password=env.POS_STAFF_PASSWORD)=>(await call('/api/staff/login','POST',{username,password})).token;
 return {db,call,login};
}
