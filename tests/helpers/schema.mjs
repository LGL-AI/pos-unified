import {readFileSync,readdirSync} from 'node:fs';

const dir=new URL('../../migrations/',import.meta.url);
const names=readdirSync(dir).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();

// Exercise the schema actually required by the current Worker. Older flow
// suites can explicitly keep their historical product enabled after 0011;
// the server must remain able to sell a restored legacy catalog item.
export function applyCurrentSchema(db,{legacyMenu=false}={}){
 for(const name of names)db.exec(readFileSync(new URL(name,dir),'utf8'));
 if(legacyMenu)db.exec("UPDATE pos_products SET active=1 WHERE id IN ('101','102','103','104','105','106','107','108','109','110','111','112','113')");
}

export function applyAfter(db,migration){
 const index=names.indexOf(migration);
 if(index<0)throw Error(`Unknown migration: ${migration}`);
 for(const name of names.slice(index+1))db.exec(readFileSync(new URL(name,dir),'utf8'));
}
