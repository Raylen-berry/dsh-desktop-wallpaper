import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {patchMain,patchPreload} from './install-native-bridge.mjs';
const require=createRequire(import.meta.url);
const {localOrigin,inside,sameFrame,capturePermission}=require('../we/native/policy.cjs');
assert.equal(localOrigin('http://127.0.0.1:3000/settings'),'http://127.0.0.1:3000');
for(const u of ['https://example.com','file:///C:/test','http://127.0.0.1.evil.test','http://user:pass@localhost:3000'])assert.throws(()=>localOrigin(u));
assert.ok(inside('C:/WE/projects','C:/WE/projects/group/project.json'));
assert.ok(!inside('C:/WE/projects','C:/WE/projects-other/project.json'));
assert.ok(!inside('C:/WE/projects','C:/WE/workshop/project.json'));
assert.ok(sameFrame({processId:1,routingId:2},{processId:1,routingId:2}));
assert.ok(!sameFrame({processId:1,routingId:3},{processId:1,routingId:2}));
assert.ok(!sameFrame(null,{processId:1,routingId:2}));
console.log('PASS bridge policy: local origin / no credentials / project boundary / exact frame');
const original='function createWindow() {\r\n  if (process.platform === "darwin") {\r\n    window.setWindowButtonVisibility(true);\r\n  }\r\n}\r\n'+
  'const check = (_webContents, permission, requestingOrigin, details) => canGrantWindowPermission(permission, details.requestingUrl ?? requestingOrigin, details.isMainFrame);\n'+
  'const request = (_webContents, permission, callback, details) => callback(canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame));\n';
const url='file:///C:/plugins/we/native/desktop-bridge.cjs';
const patched=patchMain(original,url);
assert.equal(patchMain(patched,url),patched,'installer is idempotent');
assert.equal(patched.split('BGA_NATIVE_BRIDGE_BEGIN').length,2);
assert.throws(()=>patchMain('changed application shell',url));
const preload=patchPreload('existingCode();\r\n','bridgeCode();');
assert.equal(patchPreload(preload,'bridgeCode();'),preload);
assert.ok(preload.startsWith('existingCode();'));
console.log('PASS installer: preserves shell / one hook / repeat-safe / rejects changed anchor');

const owner={},origin='http://127.0.0.1:3000',session={owner,source:{id:'window:123:0'},grantUntil:2000,origin};
const detail={isMainFrame:true,mediaTypes:[]};
assert.equal(capturePermission(session,owner,'media',origin,detail,1000),true);
assert.equal(capturePermission(session,owner,'display-capture',origin,{...detail,mediaTypes:['video']},1000),true);
for(const [s,o,p,u,d,now] of [
  [null,owner,'media',origin,detail,1000],
  [session,{},'media',origin,detail,1000],
  [{...session,closed:true},owner,'media',origin,detail,1000],
  [session,owner,'media',origin,detail,3000],
  [session,owner,'media','http://127.0.0.1:3001',detail,1000],
  [session,owner,'media',origin,{...detail,isMainFrame:false},1000],
  [session,owner,'media',origin,{...detail,mediaTypes:['video']},1000],
  [session,owner,'media',origin,{...detail,mediaTypes:['audio']},1000],
  [session,owner,'media',origin,{isMainFrame:true,mediaType:'video'},1000],
  [session,owner,'display-capture',origin,{...detail,mediaTypes:['audio']},1000],
  [session,owner,'geolocation',origin,detail,1000],
])assert.equal(capturePermission(s,o,p,u,d,now),false);
console.log('PASS host capture permission: pending WE only / expiry / owner / frame / origin / camera and microphone denied');

const shell={canGrantWindowPermission:p=>p==='notifications'};
vm.runInNewContext(patched+'\nglobalThis.check=check;globalThis.request=request;',shell);
const wc={__bgaAllowCapture:(p,u,d)=>capturePermission(session,owner,p,u,d,1000)};
let granted;
shell.request(wc,'media',value=>{granted=value},{...detail,requestingUrl:origin});
assert.equal(granted,true,'installed shell delegates the pending display request');
shell.request(wc,'media',value=>{granted=value},{...detail,requestingUrl:origin,mediaTypes:['audio']});
assert.equal(granted,false,'installed shell still rejects microphone');
shell.request({},'media',value=>{granted=value},{...detail,requestingUrl:origin});
assert.equal(granted,false,'a non-owner webContents cannot use the grant');
shell.request({},'notifications',value=>{granted=value},{...detail,requestingUrl:origin});
assert.equal(granted,true,'host permissions are preserved');

const app=new EventEmitter(),contents=new EventEmitter(),window=new EventEmitter();
contents.id=7;contents.session={setDisplayMediaRequestHandler(){}};
window.webContents=contents;window.isDestroyed=()=>false;
const bridgeRequire=createRequire(new URL('../we/native/desktop-bridge.cjs',import.meta.url));
const sandbox={module:{exports:{}},process,setTimeout,clearTimeout,__dirname:'C:/plugin/we/native',require:name=>name==='electron'?{app,ipcMain:{handle(){}},desktopCapturer:{}}:bridgeRequire(name)};
vm.runInNewContext(fs.readFileSync(new URL('../we/native/desktop-bridge.cjs',import.meta.url),'utf8')+'\nmodule.exports.seed=s=>{s.owner=owners.get(7);current=s;};',sandbox);
sandbox.module.exports.attach(window);
let closed=0;const live={token:'bga-test',native:{close(){closed++}}};sandbox.module.exports.seed(live);
contents.emit('did-start-navigation',{},'http://127.0.0.1/settings',true,true);
assert.equal(closed,0,'SPA navigation must keep the live scene');
contents.emit('did-start-navigation',{},'http://127.0.0.1/',false,true);
assert.equal(closed,1,'full navigation must release the live scene');
console.log('PASS installed host handlers preserve other permissions; SPA navigation keeps live stream; full reload releases it');
