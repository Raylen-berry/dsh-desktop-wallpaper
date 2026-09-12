// 底图工坊 · 把 client.js 真实生成的样式表抽出来 + 做完整性/越界检查（开发用，不进 npm 包）
//
// 为什么不能"看代码判断"：STATIC_CSS 里 60% 的规则是 flyRules()/starRules()/dustRules()/…
// 按 prand(i) 生成出来的字符串，手写 typo（关键帧名写错、少个分号、left% 超界）在源码里
// 看不出来，但会让某个特效在用户那边**整个不动或直接消失**。这个脚本用 Node 把 client.js
// 当模块跑一遍（stub 掉 window/document/React），拿到真·样式表，然后：
//   ① 检查所有 animation 引用的关键帧名都真的定义了（反向也查未使用的关键帧）；
//   ② 检查 EFFECTS 里 8 个特效各自都有 CSS 规则 + DockFx 分支；
//   ③ 从真规则里解析粒子行程，算出会不会越出画布（越界=观感被切；画布 overflow:clip
//      所以不会再顶出滚动条，但仍要报出来）。
//
// 用法： node tools/extract-real-css.mjs
// 产物： tools/out/static-css.css（给 tools/effects-live-check.html 用）
// 退出码 0 = 全部通过；1 = 有 FAIL。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const OUT = path.join(HERE, 'out')
const SRC = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')

// ---------------------------------------------------------------- 跑出真样式表 --
let captured = null
const inserted = []
const fakeEl = () => ({ setAttribute() {}, style: {}, textContent: '', parentNode: null })
const documentStub = {
  createElement: fakeEl,
  head: { appendChild(el) { inserted.push(el.textContent || '') }, removeChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, getAttribute: () => null },
  body: { appendChild() {}, addEventListener() {} },
}
const windowStub = {
  __ModuleLoader__: { load(m) { captured = m } },
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  innerWidth: 1440, innerHeight: 900,
}
// React 的最小 stub。**useEffect 会真的执行回调** —— 这是 v1.5.4 的教训：
// 第一版把 syncCanvasWidth 写在 apply() 里、而 DockFx（模块作用域）调它，组件一挂载就
// ReferenceError、整块 dock 被 React 卸掉（用户看到"特效全无"）。当时这个 stub 的 useEffect
// 是空函数，离线完全没抓到；现在它会真跑回调，加上下面 ④(c) 会真渲染一次 DockFx，
// "只有运行时才炸"的错不会再溜过去。
const requireStub = () => ({
  // React 会把数组型 children 展平，stub 也照做 —— 否则 h('div', null, kidsArray) 这种
  // （插件里到处这么写）会被数成 1 个子节点，断言就没意义了。
  createElement: (type, props, ...kids) => ({ type, props, kids: kids.flat(Infinity) }),
  memo: f => f, forwardRef: f => f,
  useState: v => [v, () => {}],
  useEffect: (fn) => fn(),
  useLayoutEffect: fn => fn(),
  useMemo: f => f(), useCallback: f => f, useRef: v => ({ current: v }),
  Fragment: 'Fragment',
})

const factoryFn = new Function('window', 'document', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'require', SRC + '\n//# sourceURL=client.js')
factoryFn(windowStub, documentStub, () => Promise.resolve({ ok: false }), console, setTimeout, clearTimeout, requireStub)

if (!captured || typeof captured.factory !== 'function') { console.error('FAIL 没抓到 __ModuleLoader__.load 的定义'); process.exit(1) }
const mod = captured.factory(requireStub)
if (typeof mod.apply !== 'function') { console.error('FAIL factory 没返回 apply'); process.exit(1) }

const seen = []
mod.apply({
  get: () => undefined,
  effect(fn) { const d = fn(); if (typeof d === 'function') seen.push(d) },
  inject() {}, on() {},
})
const STATIC = inserted[0] || ''
const DYNAMIC = inserted[1] || ''
if (!STATIC) { console.error('FAIL 没抓到 STATIC_CSS（styles.insert 没被调用？）'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'static-css.css'), STATIC)
fs.writeFileSync(path.join(OUT, 'dynamic-css.css'), DYNAMIC)

const fails = []
const notes = []

// ------------------------------------------------- ① 关键帧引用 / 定义 双向核对 --
const defined = new Set([...STATIC.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]))
const referenced = new Map()
for (const m of STATIC.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+/).find(t => /^[A-Za-z][\w-]*$/.test(t) && !/^(none|linear|ease|ease-in|ease-out|ease-in-out|infinite|reverse|alternate|normal|forwards|backwards|both|running|paused|steps|linear\(.*)$/.test(t))
    if (name) referenced.set(name, (referenced.get(name) || 0) + 1)
  }
}
for (const [name, n] of referenced) if (!defined.has(name)) fails.push(`引用了未定义的关键帧 ${name}（${n} 处）—— 该动画会完全不跑`)
for (const name of defined) if (!referenced.has(name)) notes.push(`定义了但没人用的关键帧 ${name}`)

// ------------------------------------------------------ ② 每个特效都有实现 --
// v1.5.2 定稿只留四个（用户从 8 种里挑的）：流萤 / 气泡 / 落樱 / 雨丝。
const fxClass = { firefly: ['bga-fly', 'bga-star', 'bga-meteor'], bubble: ['bga-bub', 'bga-bubsurf'], petal: ['bga-ptl'], rain: ['bga-rn', 'bga-wet'], off: [] }
// 只取 EFFECTS 数组本体（PALETTES 也是 { id, name } 形状，整篇 grep 会把十套配色也当成特效）
const EFFECTS_BLOCK = (SRC.match(/var EFFECTS = \[([\s\S]*?)\n\]/) || [, ''])[1]
if (!EFFECTS_BLOCK) { console.error('FAIL 找不到 EFFECTS 数组'); process.exit(1) }
const ids = [...EFFECTS_BLOCK.matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1])
for (const id of ids) {
  const branches = (SRC.match(new RegExp("s\\.effect === '" + id + "'", 'g')) || []).length
  if (branches < 1) fails.push(`特效 ${id} 没有任何 s.effect === '${id}' 分支`)
  for (const cls of fxClass[id] || []) if (!STATIC.includes('.' + cls)) fails.push(`特效 ${id} 的 class .${cls} 在 STATIC_CSS 里没有规则`)
}
for (const need of ['firefly', 'bubble', 'petal', 'rain', 'off']) if (!ids.includes(need)) fails.push(`EFFECTS 里缺了 ${need}`)
// 反向断言（v1.5.2）：用户砍掉的四个不许再留任何分支；FEATURES 里也不许再出现
for (const gone of ['sweep', 'orbit', 'dust', 'ink']) {
  if (ids.includes(gone)) fails.push(`特效 ${gone} 已按用户要求删除，却还留在 EFFECTS 里`)
  if (new RegExp("s\\.effect === '" + gone + "'").test(SRC)) fails.push(`特效 ${gone} 已删除，代码里却还有 s.effect === '${gone}' 分支`)
}

// ------------------------------------------------------------ ③ 粒子行程越界 --
// 从真规则里解析；画布宽取 --dsh-composer-card-max-width = 会话列宽 + 32（640–3840）
// 每条 @keyframes 规则在合并后的样式表里正好占一行 ⇒ 按行取整条，既简单又不会截错。
const keyframeX = name => {
  const m = STATIC.match(new RegExp('@keyframes\\s+' + name + '\\{([^\\n]*)\\}'))
  if (!m) return null
  const xs = []
  for (const t of m[1].matchAll(/translate(?:X)?\(\s*(-?[\d.]+)px/g)) xs.push(parseFloat(t[1]))
  return { xMin: xs.length ? Math.min(0, ...xs) : 0, xMax: xs.length ? Math.max(0, ...xs) : 0 }
}
const r3 = n => Math.round(n)

function boundCheck(label, items, blur, ignore) {
  let worst = { margin: Infinity }
  const bad = []
  for (const it of items) {
    // NaN 守卫：解析失配时必须炸出来，不能"没查成"被当成"查过了没问题"
    for (const k of ['leftPct', 'w', 'xMin', 'xMax']) {
      if (!Number.isFinite(it[k])) throw new Error(`解析出的粒子字段 ${k} 不是有限数（${label} #${it.i}）—— 选择器或字段名变了，检查脚本本身要同步`)
    }
  }
  for (const w of [640, 860, 900, 1180, 1600, 1920, 2560, 3840]) {
    const band = w + 32
    for (const it of items) {
      const leftPx = it.leftPct / 100 * band
      const lo = leftPx + it.xMin - (ignore ? 0 : blur)
      const hi = leftPx + it.xMax + it.w + (ignore ? 0 : blur)
      if (lo < -0.5 || hi > band + 0.5) bad.push({ w, label, left: r3(lo), right: r3(hi), band })
      const m = Math.min(lo, band - hi)
      if (m < worst.margin) worst = { margin: r3(m), w, label }
    }
  }
  if (!Number.isFinite(worst.margin)) throw new Error(`${label} 的余量算成了非有限值 —— 检查脚本本身`)
  return { worst, bad }
}

const results = []
const collect = (re, map) => [...STATIC.matchAll(re)].map(map)
// 萤 / 星 / 气泡：动画位移来自关键帧
const flies = collect(/\.bga-fly\.f(\d+)\{left:([\d.]+)%;[^}]*width:([\d.]+)px;[^}]*animation:([\w-]+)/g,
  m => ({ i: m[1], leftPct: +m[2], w: +m[3], ...keyframeX(m[4]) }))
const stars = collect(/\.bga-star\.s(\d+)\{left:([\d.]+)%;[^}]*width:([\d.]+)px/g, m => ({ i: m[1], leftPct: +m[2], w: +m[3] * 1.15, xMin: 0, xMax: 0 }))
const bubs = collect(/\.bga-bub\.b(\d+)\{left:([\d.]+)%;[^}]*width:([\d.]+)px/g, m => ({ i: m[1], leftPct: +m[2], w: +m[3] * 1.35 / 2, xMin: 0, xMax: 0 }))
const dust = collect(/\.bga-dst i\.d(\d+)\{left:([\d.]+)%;[^}]*width:([\d.]+)px/g, m => ({ i: m[1], leftPct: +m[2], w: +m[3], xMin: 0, xMax: 0 }))
const petals = collect(/\.bga-ptl i\.p(\d+)\{left:([\d.]+)%;width:([\d.]+)px[^}]*--bga-dx:(-?\d+)px/g, m => ({ i: m[1], leftPct: +m[2], w: +m[3], xMin: Math.min(0, +m[4]), xMax: Math.max(0, +m[4]) }))
const drops = collect(/\.bga-rn i\.r(\d+)\{left:([\d.]+)%;height:([\d.]+)px/g, m => ({ i: m[1], leftPct: +m[2], w: 1, ...keyframeX('bga-drop') }))

// v1.5.2：被删的四个（光带扫过/星轨环绕/浮尘光斑/墨韵涟漪）连同它们的 CSS 一起没了，
// 所以 dust 这个收集器现在必然为空 —— 只做"不该再出现"的反向断言，不再进越界表。
if (dust.length) fails.push(`浮尘光斑已删除，但 STATIC_CSS 里还有 ${dust.length} 条 .bga-dst 规则`)

for (const [label, items, blur] of [['流萤', flies, 3], ['星', stars, 2], ['气泡', bubs, 2], ['落樱', petals, 0], ['雨丝', drops, 0]]) {
  if (!items.length) { fails.push(`解析不出 ${label} 的粒子规则（选择器或字段名变了？）`); continue }
  const { worst, bad } = boundCheck(label, items, blur)
  results.push({ 特效: label, 粒子: items.length, 最紧余量: worst.margin + 'px', 档位: worst.w, 越界: bad.length })
  if (bad.length) fails.push(`${label} 有 ${bad.length} 处行程越出画布：` + JSON.stringify(bad.slice(0, 4)))
}
// 非粒子型：按几何常量核
const geo = [
  ['雨面', 0.08, 0.92, 'left/right 8% + blur 9px'],
]
for (const [label, lo, hi, why] of geo) {
  const ok = lo >= 0 && hi <= 1
  results.push({ 特效: label, 粒子: '-', 最紧余量: ok ? '在画布内（' + why + '）' : '越界', 档位: '-', 越界: ok ? 0 : 1 })
  if (!ok) fails.push(`${label} 几何越界：${lo}–${hi}（${why}）`)
}
notes.push('流星 bga-meteor1/2 用 translateX(58vw/52vw)：vw 随窗口变，宽窗口下会被画布 clip 掉尾部 —— 这是原设计（流星本来就淡出）+ 画布 overflow:clip 兜底，不算越界')
notes.push('气泡特效的 .bga-bubsurf 是 left/right:-2% 的宽辉光带，超出部分由画布 clip 裁掉（v1.4.2 起）')

// ---------------------------------------------------------------------- 报告 --
console.log(`[extract] 抓到 STATIC_CSS ${STATIC.length} 字节 / DYNAMIC ${DYNAMIC.length} 字节 → tools/out/`)
console.log(`[extract] EFFECTS ${ids.length} 个：${ids.join(' / ')}`)
console.log(`[extract] 关键帧 定义 ${defined.size} 个，被引用 ${referenced.size} 个`)
console.table(results)
for (const n of notes) console.log('[note] ' + n)

// ------------------------------------------- ④ v1.5.4 新特性：数量随画布宽 / 阴影独立开关 --
// 这两条用模块暴露的测试缝（exports.internals）直接驱动，量的是真函数、真 CSS。
const it = mod.internals
if (!it) { fails.push('模块没有暴露 internals 测试缝，v1.5.4 的两条新特性无法离线验证') }
else {
  // (a) 数量必须随画布宽度走：同一间距、上下限之外才夹住
  const at = (w) => { it.setCanvasWidth(w); return it.counts() }
  const c400 = at(400), c985 = at(985), c1600 = at(1600), c300 = at(300), c4000 = at(4000)
  const dens = it.density()
  const scaleOk = ['fly', 'star', 'bub', 'petal', 'rain'].every(k => {
    const lo = c400[k], mid = c985[k], hi = c1600[k]
    const clampedLo = lo === dens[k].min, clampedHi = hi === dens[k].max
    return (clampedLo || lo < mid) && (clampedHi || mid < hi)
  })
  if (!scaleOk) fails.push('数量没随画布宽度缩放：' + JSON.stringify({ c400, c985, c1600 }))
  // 间距恒定 ⇒ 密度不随屏宽变（这才是用户要的那件事）
  const spreads = [400, 700, 985, 1300, 1600].map(w => { const c = at(w); return { w, rainPer: c.rain > dens.rain.min && c.rain < dens.rain.max ? +(w / c.rain).toFixed(1) : 'clamped' } })
  if (!spreads.some(r => typeof r.rainPer === 'number')) fails.push('雨丝数量在所有档位都被夹住了，缩放没生效')
  // 夹住的档位不能越界：120px 画布才真的触到下限，4000px 触上限
  const c120 = at(120)
  if (c120.rain !== dens.rain.min || c4000.rain !== dens.rain.max) fails.push('上下限没夹住：' + JSON.stringify({ c120: c120.rain, c4000: c4000.rain }))
  it.setCanvasWidth(985)   // 还原，后面的越界检查仍按本机 985px 画布算
  console.log('[v1.5.4] 数量随画布宽：985px ⇒ ' + JSON.stringify(c985) + '；400px ⇒ ' + JSON.stringify(c400) + '；1600px ⇒ ' + JSON.stringify(c1600))
  console.log('[v1.5.4] 雨丝间距（px/条，恒定即密度不变）：' + JSON.stringify(spreads))

  // (b) 卡面阴影必须是独立开关：关特效不掉阴影、关阴影不掉特效
  // 注意：dynamicCss 永远会写 :root 里的 --bga-card-shade / --bga-card-edge 变量（变量本身无害），
  // 所以判据必须只看 **body [data-composer-card]{box-shadow:…} 这条规则的内容**。
  const S = it.STORE.state
  const ruleOf = (css) => (css.match(/body \[data-composer-card\]\{box-shadow:([^}]*)\}/) || [, ''])[1]
  const withState = (patch) => { Object.assign(S, patch); return ruleOf(it.dynamicCss()) }
  const shadowOff = withState({ effect: 'off', cardShadow: true })
  const bothOff = withState({ effect: 'off', cardShadow: false })
  const rainOn = withState({ effect: 'rain', cardShadow: true })
  const rainNoShadow = withState({ effect: 'rain', cardShadow: false })
  if (!/--bga-card-edge/.test(shadowOff)) fails.push('特效选「关闭」但 cardShadow 开着时，卡面阴影规则不见了（正是用户报的那个 bug）')
  if (bothOff !== '') fails.push('cardShadow 关掉后不该再写 box-shadow 规则，实际：' + bothOff)
  if (!/--bga-card-edge/.test(rainOn) || !/0 0 24px/.test(rainOn)) fails.push('雨丝 + 阴影同开时两条应该合成一条 box-shadow：' + rainOn)
  if (/--bga-card-edge/.test(rainNoShadow) || !/0 0 24px/.test(rainNoShadow)) fails.push('只关阴影时不该把雨丝的辉光也带走：' + rainNoShadow)
  console.log('[v1.5.4] 阴影独立：关特效仍留阴影=' + /--bga-card-edge/.test(shadowOff) + ' / 关阴影后无 box-shadow=' + (bothOff === '') + ' / 只关阴影仍保留雨丝辉光=' + /0 0 24px/.test(rainNoShadow))

  // (c) **真渲染一次 DockFx**：专抓"引用了看不见的标识符"这类只有运行时才炸的错 ——
  //     v1.5.4 第一版就是这么让"对话框特效全无"的（syncCanvasWidth 定义在 apply() 内部，
  //     而 DockFx 在模块作用域调用它 ⇒ ReferenceError）。React stub 的 useEffect 会真跑回调。
  try {
    it.STORE.state.effect = 'firefly'
    const dock = it.DockFx()
    const inner = dock && dock.kids && dock.kids[0]
    const n = inner && inner.kids ? inner.kids.length : 0
    const c = it.counts()
    const want = c.fly + c.star + 2   // 萤 + 星 + 2 道流星
    if (!n) fails.push('DockFx 渲染出来是空的（= 特效全无）')
    else if (n !== want) fails.push(`DockFx 渲染的粒子数 ${n} 与按画布宽算的 ${want} 不一致`)
    console.log('[v1.5.4] DockFx 真渲染：' + n + ' 个粒子节点（按画布宽应为 ' + want + '）')
  } catch (e) {
    fails.push('DockFx 渲染时抛错（这正是"特效全无"的成因）：' + (e && e.message))
  }
}

if (fails.length) { console.error('FAIL ' + fails.length + ' 项：'); for (const f of fails) console.error('  - ' + f); process.exit(1) }
console.log('PASS ' + ids.filter(i => i !== 'off').length + ' 种特效（' + ids.join(' / ') + '）都有规则与分支、关键帧引用自洽、粒子行程不越界')
