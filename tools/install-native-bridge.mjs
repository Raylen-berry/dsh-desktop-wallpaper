import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export function patchMain(text,moduleUrl) {
  const clean=text.replace(/  \/\/ BGA_NATIVE_BRIDGE_BEGIN[\s\S]*?  \/\/ BGA_NATIVE_BRIDGE_END\r?\n/g,'')
    .replace(/\/\* BGA_CAPTURE_PERMISSION_BEGIN \*\/[\s\S]*?\/\* BGA_CAPTURE_PERMISSION_END \*\//g,'');
  const anchor='  if (process.platform === "darwin") {\n    window.setWindowButtonVisibility(true);';
  const normalized=clean.replace(/\r\n/g,'\n');
  if(normalized.split(anchor).length!==2)throw new Error('DSH createWindow anchor differs; installation stopped');
  const code='  // BGA_NATIVE_BRIDGE_BEGIN\n  import('+JSON.stringify(moduleUrl)+').then(m => { if (!window.isDestroyed()) m.default.attach(window); }).catch(e => console.warn("[bga-native]", e.message));\n  // BGA_NATIVE_BRIDGE_END\n';
  const check='(_webContents, permission, requestingOrigin, details) => canGrantWindowPermission(';
  const request='canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame)';
  if(normalized.split(check).length!==2 || normalized.split(request).length!==2)throw new Error('DSH permission handlers differ; installation stopped');
  const hook=url=>'/* BGA_CAPTURE_PERMISSION_BEGIN */(_webContents?.__bgaAllowCapture?.(permission, '+url+', details) === true) || /* BGA_CAPTURE_PERMISSION_END */';
  return normalized.replace(anchor,code+anchor)
    .replace(check,'(_webContents, permission, requestingOrigin, details) => '+hook('details.requestingUrl || requestingOrigin')+'canGrantWindowPermission(')
    .replace(request,hook('details.requestingUrl')+request)
    .replace(/\n/g,text.includes('\r\n')?'\r\n':'\n');
}
export function patchPreload(text,fragment) {
  const clean=text.replace(/\r?\n\/\/ BGA_NATIVE_PRELOAD_BEGIN[\s\S]*?\/\/ BGA_NATIVE_PRELOAD_END\r?\n?/g,'');
  return clean.trimEnd()+'\n// BGA_NATIVE_PRELOAD_BEGIN\n'+fragment.trim()+'\n// BGA_NATIVE_PRELOAD_END\n';
}
async function main(){
  const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
  if(!args.includes('--app'))throw new Error('Usage: node tools/install-native-bridge.mjs --app <DSH directory> [--apply --backup <directory>]');
  const root=path.resolve(value('--app'));
  const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const module=path.join(plugin,'we/native/desktop-bridge.cjs');
  await fs.access(module);await fs.access(path.join(plugin,'we/native/WindowBridge.exe'));
  const mainFile=path.join(root,'resources/app/out/main/index.js');
  const preloadFile=path.join(root,'resources/app/out/preload/index.cjs');
  const before=await Promise.all([fs.readFile(mainFile,'utf8'),fs.readFile(preloadFile,'utf8')]);
  const after=[patchMain(before[0],pathToFileURL(module).href),patchPreload(before[1],await fs.readFile(path.join(plugin,'we/native/preload-fragment.cjs'),'utf8'))];
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const changes=[mainFile,preloadFile].map((file,i)=>({file,before:hash(before[i]),after:hash(after[i])}));
  if(args.includes('--apply')){
    if(!args.includes('--backup'))throw new Error('--backup is required when applying');
    const backup=path.resolve(value('--backup'));await fs.mkdir(backup,{recursive:true});
    for(let i=0;i<changes.length;i++)await fs.writeFile(path.join(backup,i===0?'main-index.js':'preload-index.cjs'),before[i],{flag:'wx'});
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(changes,null,2),{flag:'wx'});
    for(let i=0;i<changes.length;i++){
      if(hash(await fs.readFile(changes[i].file,'utf8'))!==changes[i].before)throw new Error('DSH file changed during installation');
      await fs.writeFile(changes[i].file,after[i]);
    }
  }
  console.log(JSON.stringify({applied:args.includes('--apply'),changes,restartRequired:true},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
