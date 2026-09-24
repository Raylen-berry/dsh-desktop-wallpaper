import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';

let loaded, polls = [], pauseCount = 0;
const events = new Map();
const nodes = [];
function element(tag) {
  const el = { tag, style: {}, children: [], attributes: {}, isConnected: true,
    setAttribute(k,v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) { this.children.push(child); }, remove() { this.isConnected = false; },
    addEventListener() {}, play: async () => {}, pause() { pauseCount++; }, load() {},
  }; nodes.push(el); return el;
}
const sandbox = {
  window: { __ModuleLoader__: { load(m) { loaded = m; } } }, console, AbortController,
  document: { hidden: false, createElement: element, documentElement: element('html'), addEventListener(n,fn) { events.set(n,fn); }, removeEventListener(n,fn) { if(events.get(n)===fn)events.delete(n); } },
  setTimeout, clearTimeout,
  fetch: (url, options) => new Promise(resolve => polls.push({ url, options, resolve })),
};
vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox);
const api = loaded.factory(name => { if (name === 'react') return React; throw Error(name); }).internals;
const scene = { id: '123', type: 'scene', title: 'scene', stillReady: true, schemeColor: '0.1 0.6 1' };
const video = { id: 'local-'+'a'.repeat(24), type: 'video', file: 'movie.mp4', title: 'video' };
const web = { id: 'local-'+'b'.repeat(24), type: 'web', file: 'index.html', title: 'web' };
const colors = () => JSON.stringify([api.STORE.state.accent, api.STORE.state.deep, api.STORE.state.preset]);
const before = colors();
api.weShow(scene); assert.equal(colors(), before);
api.weShow(video); assert.equal(colors(), before);
assert.ok(nodes.some(e => e.tag === 'video' && e.loop && e.muted));
api.weShow(web); assert.ok(pauseCount > 0, 'video cleanup pauses playback');
const frame = nodes.find(e => e.tag === 'iframe'); assert.equal(frame.attributes.sandbox, 'allow-scripts');
api.weDispose(); assert.equal(frame.src, 'about:blank'); assert.equal(colors(), before);
console.log('PASS selection / switch / clear preserve manual colors; video/web setup and cleanup');

let root;
await act(async () => { root = create(React.createElement(api.WeSection)); });
const status = polls.find(r => r.url.includes('/status')), library = polls.find(r => r.url.includes('/library'));
assert.ok(status && library);
await act(async () => { status.resolve({ ok: true, json: async () => ({ bridge: { running: true, available: false } }) }); });
await act(async () => { library.resolve({ ok: true, json: async () => ({ weFound: true, entries: [scene, video, web] }) }); });
const text = () => JSON.stringify(root.toJSON());
assert.ok(text().includes('WE 已运行'), 'library completion must not erase status result');
assert.ok(!text().includes('离线模式'));
const buttons = () => root.root.findAllByType('button');
assert.equal(buttons().filter(b => b.children.join('') === '在 WE 打开').length, 3, 'local projects have launch buttons');
await act(async () => { buttons().find(b => b.children.join('') === '采用壁纸配色').props.onClick({ stopPropagation() {} }); });
assert.notEqual(colors(), before, 'explicit palette action still works');
const explicit = colors(); api.weDispose(); assert.equal(colors(), explicit);
await act(async () => { buttons().find(b => b.children.join('') === '刷新').props.onClick(); });
assert.ok(polls.some(r => r.url.includes('library.json?force=1')));
await act(async () => root.unmount());
console.log('PASS real React mount: status race / local launch / explicit palette / forced refresh');

const starts=[], stops=[], captures=[], captureOptions=[];
let tracksStopped=0;
let nativeVisibility;
sandbox.window.dshWallpaper={start:(id,token)=>new Promise(resolve=>starts.push({id,token,resolve})),stop:async token=>{stops.push(token)},onVisibility:fn=>{nativeVisibility=fn;return()=>{nativeVisibility=null}}};
sandbox.navigator={mediaDevices:{getDisplayMedia:options=>{captureOptions.push(options);return new Promise(resolve=>captures.push(resolve))}}};
const tick=()=>new Promise(r=>setTimeout(r,5));
api.STORE.state.weMode='live';
api.weShow(scene); await tick();
api.weDispose(); starts[0].resolve({}); await tick();
assert.equal(captures.length,0,'cancelled start must not begin capturing');
assert.ok(stops.includes(starts[0].token),'pending start is cancelled by its own token');
api.weShow(scene); await tick(); starts[1].resolve({}); await tick();
assert.equal(captureOptions[0].video.frameRate.max,45,'balanced cadence is the default');
assert.equal(captureOptions[0].video.width,undefined,'do not reintroduce the Windows capture rescaling stall');
assert.equal(captureOptions[0].video.height,undefined);
api.weDispose();
const track={stop(){tracksStopped++},addEventListener(){}};
captures[0]({getTracks:()=>[track],getVideoTracks:()=>[track]});await tick();
assert.equal(tracksStopped,1,'late stream after disposal must be stopped');
api.weShow(scene); await tick(); starts[2].resolve({});await tick();
captures[1]({getTracks:()=>[track],getVideoTracks:()=>[track]});await tick();
sandbox.document.hidden=true;events.get('visibilitychange')();await tick();
assert.equal(tracksStopped,2,'hidden window releases capture');
sandbox.document.hidden=false;events.get('visibilitychange')();await tick();
assert.equal(starts.length,4,'visible window reconnects');
starts[3].resolve({});await tick();captures[2]({getTracks:()=>[track],getVideoTracks:()=>[track]});await tick();
nativeVisibility(false);await tick();assert.equal(tracksStopped,3,'native hidden event works even when document.hidden remains false');
nativeVisibility(true);await tick();assert.equal(starts.length,5);
api.weDispose();starts[4].resolve({});await tick();
assert.equal(nativeVisibility,null,'native IPC listener is removed');
assert.equal(events.has('visibilitychange'),false,'disposal removes native visibility listener');
console.log('PASS native lifecycle: cancel during launch / late stream / hide / resume / dispose');

const calls=[];
const snapshot={fields:[{key:'move',type:'bool',text:'人物动作',group:'人物',value:true},{key:'zoom',type:'slider',text:'镜头缩放',group:'其他',min:1,max:1.3,step:.01,value:1}],values:{move:true,zoom:1},presets:[]};
sandbox.window.dshWallpaper.properties=async(id,action='read',values,name)=>{calls.push({id,action,values,name});return {...snapshot,values:values||snapshot.values};};
let propsRoot;
await act(async()=>{propsRoot=create(React.createElement(api.WeProperties,{id:'123'}));});
assert.equal(propsRoot.root.findAllByType('details').length,2);
const range=propsRoot.root.findAllByType('input').find(x=>x.props.type==='range');
await act(async()=>{range.props.onChange({target:{value:'1.2'}});range.props.onChange({target:{value:'1.3'}});});
assert.equal(calls.length,1,'dragging must not spawn control commands');
await act(async()=>{propsRoot.root.findAllByType('button').find(x=>x.children.includes('应用到此背景')).props.onClick();});
assert.equal(calls.length,2);assert.equal(calls[1].values.zoom,1.3);assert.equal(calls[1].id,'123');
await act(async()=>{range.props.onChange({target:{value:'1.1'}});});
await act(async()=>{propsRoot.root.findAllByType('button').find(x=>x.children.includes('放弃修改')).props.onClick();});
assert.equal(range.props.value,1.3,'discard restores the last applied value, not project defaults');
assert.equal(calls.length,2,'discard must not issue a native command');
await act(async()=>{range.props.onChange({target:{value:'1.2'}});});
await act(async()=>{range.props.onChange({target:{value:'1.3'}});});
assert.equal(propsRoot.root.findAllByType('button').find(x=>x.children.includes('应用到此背景')).props.disabled,true,'returning to the applied value clears the dirty flag');
await act(async()=>propsRoot.unmount());
console.log('PASS property panel: grouped React controls / drag coalescing / apply latest values to selected scene');

assert.deepEqual(Array.from(api.weFilterLibrary([{...scene,title:'梁月',tags:['Night']},video], ' night ', 'scene'),e=>e.id), ['123']);
assert.equal(api.weFilterLibrary([scene,video], 'not found', 'all').length,0);
polls=[];api.STORE.state.weId=scene.id;api.STORE.state.weMode='still';
await act(async()=>{root=create(React.createElement(api.WeSection));});
const firstLibrary=polls.find(p=>p.url.includes('library'));
const refreshButton=()=>root.root.findAllByType('button').find(b=>b.children.includes('刷新'));
await act(async()=>{refreshButton().props.onClick();});
const latestLibrary=polls.filter(p=>p.url.includes('library')).at(-1);
assert.equal(firstLibrary.options.signal.aborted,true,'refresh cancels the previous scan');
await act(async()=>{latestLibrary.resolve({ok:true,json:async()=>({weFound:true,entries:[scene,video,web]})});});
await act(async()=>{firstLibrary.resolve({ok:true,json:async()=>({weFound:false,entries:[]})});});
assert.equal(root.root.findAllByType('article').length,3,'a late scan cannot replace the latest library');
const search=root.root.findByProps({'aria-label':'搜索壁纸'});
await act(async()=>{search.props.onChange({target:{value:'video'}});});
assert.equal(root.root.findAllByType('article').length,1);
assert.equal(api.STORE.state.weId,scene.id,'filtering never changes the playing wallpaper');
assert.ok(JSON.stringify(root.toJSON()).includes('当前背景：scene'));
assert.equal(root.root.findAllByProps({'aria-label':'实时播放质量'}).length,0,'static mode hides irrelevant live controls');
const selectedCard=root.root.findByProps({'aria-label':'应用背景：video'});
assert.equal(selectedCard.type,'button','wallpaper selection supports native keyboard activation');
await act(async()=>root.unmount());
assert.ok(polls.every(p=>p.options.signal.aborted),'unmount cancels outstanding library/status requests');
console.log('PASS library: filters preserve selection / stale refresh ignored / keyboard buttons / static controls / request cleanup');
