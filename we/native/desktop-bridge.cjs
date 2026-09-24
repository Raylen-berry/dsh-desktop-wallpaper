const {app,ipcMain,desktopCapturer} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFile} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {NativeChannel} = require('./channel.cjs');
const {localOrigin,inside,sameFrame,capturePermission} = require('./policy.cjs');
const properties = require('./properties.cjs');
const owners = new Map(), sessions = new WeakSet();
let registered = false, current = null, serial = Promise.resolve();
const delay = ms => new Promise(r=>setTimeout(r,ms));
// WE reads RAW~ JSON from the raw Windows command line, before CRT unescaping.
// This mode is only used with the validated payload and generated window title;
// execFile never invokes a shell. Normal file-path commands keep normal quoting.
const run = (exe,args) => new Promise((resolve,reject)=>execFile(exe,args,{windowsHide:true,timeout:7000,windowsVerbatimArguments:args[1]==='applyProperties'},e=>e?reject(e):resolve()));
const load = file => import(pathToFileURL(path.join(__dirname,'..',file)).href);
const settingsFile = () => path.join(app.getPath('userData'),'harness','dsh-bg-atelier','we-scene-properties.json');
async function readSceneSettings(){try{const file=settingsFile();if((await fs.stat(file)).size>1024*1024)throw Error('属性文件过大');const data=JSON.parse(await fs.readFile(file,'utf8'));return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function persistScene(s){const data=await readSceneSettings();data[s.id]={values:s.values,presets:s.presets};const body=JSON.stringify(data,null,2);if(Buffer.byteLength(body)>1024*1024)throw Error('已保存的场景属性超过容量限制');const file=settingsFile();await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',body);await fs.rename(file+'.tmp',file);}
const sceneSnapshot=s=>({id:s.id,fields:s.fields,values:s.values,presets:Object.keys(s.presets||{})});
function sender(event) {
  const owner=owners.get(event.sender.id);
  if(!owner || owner.window.isDestroyed() || !sameFrame(event.senderFrame,event.sender.mainFrame)) throw new Error('实时背景调用来源无效');
  localOrigin(event.sender.getURL());
  return owner;
}
async function release(s) {
  if(!s)return;
  s.closed=true; s.grantUntil=0;
  if(current===s)current=null;
  s.native?.close();
  if(s.opened && !s.closeSent) { s.closeSent=true; await run(s.exe,['-control','closeWallpaper','-location',s.title]).catch(()=>{}); }
}
function active(s) {
  if(s.closed || s.owner.pending!==s.token || s.owner.window.isDestroyed()) throw new Error('实时背景请求已取消');
}
async function start(owner,id,token) {
  if(owner.pending!==token)throw new Error('实时背景请求已取消');
  await release(current);
  const s={owner,id,token,title:'DSH-WE-'+process.pid+'-'+randomBytes(8).toString('hex'),closed:false};
  current=s;
  try {
    const [{discoverWePaths},{scanLibrary},{bridgeStatus}]=await Promise.all([load('paths.js'),load('scanner.js'),load('bridge.js')]);
    const paths=await discoverWePaths(); active(s);
    const entry=(await scanLibrary(paths)).find(e=>e.id===id && e.type==='scene');
    if(!entry)throw new Error('找不到这个场景项目');
    const project=await fs.realpath(path.join(entry.path,'project.json'));
    const allowed=await Promise.all([paths.localProjectsDir,paths.workshopRoot].filter(Boolean).map(p=>fs.realpath(p).catch(()=>null)));
    if(!allowed.some(root=>root&&inside(root,project)))throw new Error('场景不在本机 WE 库内');
    s.fields=properties.schema(JSON.parse(await fs.readFile(project,'utf8')));
    const saved=(await readSceneSettings())[id];
    s.values=properties.restore(s.fields,saved?.values);s.presets=saved?.presets||{};
    const runtime=await bridgeStatus(true); active(s);
    if(runtime.running!==true)throw new Error('请先启动 Wallpaper Engine，再启用实时背景');
    if(!['wallpaper32.exe','wallpaper64.exe'].includes(runtime.executable))throw new Error('WE 程序不可用');
    s.exe=path.join(paths.wallpaperEngineDir,runtime.executable);
    await fs.access(path.join(__dirname,'WindowBridge.exe'));
    const bounds=owner.window.getContentBounds();
    // This is an additional WE instance of the scene; keep it bounded to the app.
    await run(s.exe,['-control','openWallpaper','-file',project,'-playInWindow',s.title,
      '-width',String(Math.min(1920,bounds.width)),'-height',String(Math.min(1080,bounds.height)),
      '-x',String(bounds.x),'-y',String(bounds.y),'-activate','0','-borderless','1']);
    s.opened=true; active(s);
    let source;
    for(let i=0;i<24;i++) {
      active(s);
      source=(await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0}})).find(x=>x.name===s.title);
      if(source)break;
      await delay(300);
    }
    if(!source)throw new Error('WE 场景窗口未就绪');
    const handle=owner.window.getNativeWindowHandle();
    const hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
    s.native=new NativeChannel(path.join(__dirname,'WindowBridge.exe'),s.title,s.exe,hwnd);
    const geometry=await s.native.request({op:'status'}); active(s);
    // Re-query after the first layout, without changing WE styles or reparenting.
    await delay(350); active(s);
    source=(await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0}})).find(x=>x.name===s.title);
    if(!source)throw new Error('WE 窗口无法采集');
    if(source.id.split(':')[1]!==String(geometry.handle))throw new Error('采集窗口与原生窗口身份不一致');
    await run(s.exe,properties.command(s.title,s.values));active(s);
    s.source=source; s.grantUntil=Date.now()+15000; s.origin=localOrigin(owner.window.webContents.getURL());
    return {token,geometry,mouse:'native-aligned'};
  } catch(e) { await release(s); throw e; }
}
function attach(window) {
  if(process.platform!=='win32')return;
  if(owners.has(window.webContents.id))return;
  const webContentsId=window.webContents.id;
  const owner={window,pending:null}; owners.set(webContentsId,owner);
  // Called only by the trusted desktop shell's existing permission handlers.
  window.webContents.__bgaAllowCapture=(permission,url,details)=>capturePermission(current,owner,permission,url,details);
  const stop=()=>{owner.pending=null;if(current?.owner===owner)void release(current);};
  window.on('closed',()=>{stop();owners.delete(webContentsId);});
  const visibility=visible=>{if(!window.isDestroyed())window.webContents.send('bga-live:visibility',visible);};
  window.on('minimize',()=>{stop();visibility(false);}); window.on('hide',()=>{stop();visibility(false);});
  window.on('restore',()=>visibility(true)); window.on('show',()=>visibility(true));
  window.webContents.on('render-process-gone',stop);
  window.webContents.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame && !inPlace)stop();});
  const session=window.webContents.session;
  if(!sessions.has(session)) {
    sessions.add(session);
    session.setDisplayMediaRequestHandler((request,callback)=>{
      const s=current;
      if(!s || s.closed || s.owner.window.isDestroyed() || !sameFrame(request.frame,s.owner.window.webContents.mainFrame)
        || s.grantUntil<Date.now() || request.audioRequested || localOriginSafe(request.securityOrigin)!==s.origin) return callback({});
      s.grantUntil=0;
      callback({video:s.source});
    });
  }
  if(registered)return; registered=true;
  ipcMain.handle('bga-live:capability',event=>{sender(event);return {version:2,available:true,mouse:'native-aligned'};});
  ipcMain.handle('bga-live:properties',(event,args)=>{
    const owner=sender(event);
    const s=current;if(!s || s.owner!==owner || s.closed || s.id!==args?.id)throw Error('请先连接这个实时场景');
    const next=serial.catch(()=>{}).then(async()=>{
      active(s);if(current!==s)throw Error('场景已切换');
      if(!args.action || args.action==='read')return sceneSnapshot(s);
      let values=s.values;
      if(args.action==='apply')values={...values,...properties.validate(s.fields,args.values)};
      else if(args.action==='reset')values=properties.defaults(s.fields);
      else if(args.action==='load'){
        if(typeof args.name!=='string'||!Object.hasOwn(s.presets,args.name))throw Error('预设不存在');
        values=properties.restore(s.fields,s.presets[args.name]);
      } else if(args.action==='save'){
        if(typeof args.name!=='string'||!args.name.trim()||args.name.length>40||['__proto__','constructor','prototype'].includes(args.name))throw Error('请输入 1–40 字的预设名称');
        if(!Object.hasOwn(s.presets,args.name)&&Object.keys(s.presets).length>=12)throw Error('每张壁纸最多保存 12 个预设');
        const before=s.presets;s.presets={...s.presets,[args.name]:{...values}};
        try{await persistScene(s)}catch(e){s.presets=before;throw e}return sceneSnapshot(s);
      }else throw Error('未知属性操作');
      await run(s.exe,properties.command(s.title,values));active(s);
      const before=s.values;s.values=values;
      try{await persistScene(s)}catch(e){s.values=before;await run(s.exe,properties.command(s.title,before)).catch(()=>{});throw e}
      return sceneSnapshot(s);
    });serial=next;return next;
  });
  ipcMain.handle('bga-live:start',(event,args)=>{
    const owner=sender(event);
    if(!args || !/^(?:\d+|local-[a-f0-9]{24})$/.test(args.id) || !/^[a-zA-Z0-9-]{8,80}$/.test(args.token))throw new Error('无效场景请求');
    owner.pending=args.token;
    const next=serial.catch(()=>{}).then(()=>start(owner,args.id,args.token));serial=next;
    return next;
  });
  ipcMain.handle('bga-live:stop',async(event,token)=>{
    const owner=sender(event);
    if(owner.pending===token)owner.pending=null;
    if(current?.owner===owner && current.token===token)await release(current);
    return {ok:true};
  });
  app.on('before-quit',()=>{for(const owner of owners.values())owner.pending=null;current?.native?.close();});
}
function localOriginSafe(value){try{return localOrigin(value)}catch{return null}}
module.exports={attach};
