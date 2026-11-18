const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const venv=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.PYTHON||(fs.existsSync(venv)?venv:'python');
const result=spawnSync(python,[path.join(__dirname,'run_e2e.py'),...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error){console.error('Cannot launch Python. Create .venv or set PYTHON to its executable.');process.exit(1)}
process.exit(result.status??1);
