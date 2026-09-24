import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32')throw new Error('Build the Windows companion on Windows');
const csc=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(csc,['/nologo','/target:exe','/optimize+','/r:System.Web.Extensions.dll','/out:'+path.join(root,'we/native/WindowBridge.exe'),path.join(root,'we/native/WindowBridge.cs')],{stdio:'inherit',windowsHide:true});
console.log('Built WE window companion from source.');
