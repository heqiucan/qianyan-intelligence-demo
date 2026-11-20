import type {ScriptLine} from './types';
export function parseScripts(text:string,csv:boolean):ScriptLine[]{
 if(!csv)return text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(text=>({text,role:'host'}));
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=c}
 if(quoted)throw new Error('CSV 引号未闭合，请检查文件。');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 const headers=(rows.shift()||[]).map(s=>s.replace(/^\uFEFF/,'').trim());const textIndex=headers.findIndex(s=>['text','话术'].includes(s)),roleIndex=headers.findIndex(s=>['role','角色'].includes(s));
 if(textIndex<0)throw new Error('CSV 需要 text 或“话术”列，可选 role 或“角色”列。');
 return rows.map((r,i)=>{const role=roleIndex<0?'host':r[roleIndex]?.trim()||'host';if(!['host','assistant','主播','助播'].includes(role))throw new Error(`CSV 第 ${i+2} 行角色应为主播或助播。`);return {text:r[textIndex]?.trim()||'',role:['assistant','助播'].includes(role)?'assistant':'host'}});
}
export function exportScripts(lines:ScriptLine[],csv:boolean){return csv?'\uFEFFtext,role\r\n'+lines.map(l=>[l.text,l.role].map(s=>'"'+s.replaceAll('"','""')+'"').join(',')).join('\r\n'):lines.map(l=>l.text).join('\n')}
