// ============================================================================
// dsh-bg-atelier · Client half (packaged, boot-loaded; 版本以 package.json 为准)
// 职责: 底图绘制 + 主题 token 染色 + 琉璃卡面与 dock 特效 + WE 动效层 + 设置页。
//   · 底图按"类型"两级浏览: 一级 = 放图目录下每个子文件夹一个类型, 二级 = 该类型图库
//     (缩略图即点即换, №编号角标, 全部/高清/普通筛选)。
//   · 换图宝珠 = 跨全部类型随机, 轮次式 2/3 不重复洗牌 (见 cycleWallpaper 注释)。
//   · 粒子数量随画布宽度按固定间距缩放 (countFor/DENSITY); 特效与底图解耦 (无底图也照画)。
//   · 清单与设置走 /bga/* HTTP 路由, 样式自包含注入。
// 历史流水账的唯一真源在 README「更新记录」；此处只留**解释当前行为**的注释。
// 已移交 dsh-cache-control (v1.3.0): 「对话页固定宽度」整节 —— 本插件不再写任何 --dsh-chat-* 变量。
// ============================================================================

window.__ModuleLoader__.load({
  id: 'dsh-bg-atelier',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')

    // 自包含样式注入器: 不再依赖运行时-only 的 styles 全局。
    var styles = {
      insert: function (css) {
        var el = document.createElement('style')
        el.type = 'text/css'
        el.setAttribute('data-bg-atelier-styles', '1')
        el.textContent = css
        document.head.appendChild(el)
        return function () { if (el.parentNode) el.parentNode.removeChild(el) }
      },
    }

    var h = React.createElement

// 去掉文件扩展名, 底图显示名不带 .png/.jpg 等后缀。
function bareName(name) {
  var n = String(name || '')
  var i = n.lastIndexOf('.')
  return i > 0 ? n.slice(0, i) : n
}

// 当前底图的展示标签: "类型/显示名 №编号" (编号不参与显示名本身)。
function curLabel(w) {
  if (!w) return ''
  var nm = w.name || (w.file ? bareName(w.file) : '')
  nm = bareName(nm)
  var cat = w.cat ? w.cat + '/' : ''
  return cat + (nm || '底图') + (w.no ? '  №' + w.no : '')
}

// ---------------------------------------------------------------- 状态存储 --

var PRESETS = [
  { id: 'sakura',    name: '樱粉',   accent: '#e88ca0', deep: '#241318' },
  { id: 'teal',      name: '青碧',   accent: '#63c8c0', deep: '#0e1a1c' },
  { id: 'amber',     name: '琥珀',   accent: '#e0a75e', deep: '#1d1409' },
  { id: 'violet',    name: '星紫',   accent: '#9d8cff', deep: '#130f22' },
  { id: 'mint',      name: '薄荷',   accent: '#6fce9e', deep: '#0f1c14' },
  { id: 'crimson',   name: '绛红',   accent: '#d96060', deep: '#220f12' },
  { id: 'mist',      name: '雾蓝',   accent: '#7aa7e8', deep: '#101826' },
  { id: 'lavender',  name: '薰衣草', accent: '#c49ae0', deep: '#1b1424' },
  { id: 'peach',     name: '蜜桃',   accent: '#f2a183', deep: '#23120e' },
  { id: 'mono',      name: '墨黑',   accent: '#9aa0a8', deep: '#141518' },
]

// 特效选项: 流萤 / 气泡 / 落樱 / 雨丝 + 关闭 (v1.5.2 定稿, 从 8 种里挑的这 4 个)。
// 全部只画在「输入框上方那条 dock 条」与卡面辉光上, 不碰消息气泡
// (消息气泡的样式归 dsh-cache-control, 两边同时改会互相盖)。
// **硬约束**：任何特效的粒子行程必须留在画布内 —— 飘出右缘会顶大
// [data-conversation-scroll] 的 scrollWidth, 让会话区底部那条横向滚动条频闪
// (v1.4.2 修过一次, 见 tools/verify-dockfx-bounds.mjs)。
var EFFECTS = [
  { id: 'firefly', name: '流萤', hint: '18 只萤 + 14 颗星 + 2 道流星，成群掠过输入框上方 (仅会话页)' },
  { id: 'bubble',  name: '气泡', hint: '14 个大气泡从输入框底部涌起, 边缘带高光, 底部一层水面辉光' },
  { id: 'petal',   name: '落樱', hint: '14 片小花瓣边落边摆边自转, 飘到卡面上沿淡出。配二次元 / 线稿风底图' },
  { id: 'rain',    name: '雨丝', hint: '44 条细斜雨丝下落 + 卡面上沿一层被雨打湿的水光。四条里节奏最快最密' },
  { id: 'off',     name: '关闭', hint: '仅保留琉璃卡面, 不加框缘装饰' },
]

// 已知特效 id 白名单: 盘上存过的历次撤掉的特效 id (锦框/流光环/墨韵/声波/极光/
// 光带扫过/星轨环绕/浮尘光斑/墨韵涟漪) 一律归一到「流萤」, 自己选过「关闭」的保持不变。
var EFFECT_IDS = { firefly: 1, bubble: 1, petal: 1, rain: 1, off: 1 }

function normalizeEffect(v) {
  return EFFECT_IDS[v] === 1 ? v : 'firefly'
}

var FOCI = [
  { id: 'tl', pos: '0% 0%' },     { id: 'tc', pos: '50% 0%' },   { id: 'tr', pos: '100% 0%' },
  { id: 'cl', pos: '0% 50%' },    { id: 'cc', pos: '50% 50%' },  { id: 'cr', pos: '100% 50%' },
  { id: 'bl', pos: '0% 100%' },   { id: 'bc', pos: '50% 100%' }, { id: 'br', pos: '100% 100%' },
]

// 是否成功从 host 读到过设置（模块级、**不落盘**）：save() 的写盘闸，见 save/load 里的注释。
var stateLoaded = false

var STORE = {
  state: {
    wallpaper: null,      // { name, url } | null
    effect: 'firefly',    // 仅 firefly(流萤) / off(关闭); 旧值锦框等载入时由 normalizeEffect 归一到流萤
    accent: '#e88ca0',
    deep: '#241318',
    veil: 0,              // 底图暗纱 0..0.85 (默认 0: 与原图一致 100% 清晰)
    glass: 0.8,           // 全局表面透光 0..1 (越大越透, 默认 80%)
    cardA: 0,             // 输入框不透明度 0..1 (默认 0 → ~95% 透明)
    cardBlur: 10,         // 输入框背景模糊 px 0..24 (白底图建议调低)
    cardShadow: true,     // 卡面深色接触阴影 + 环境阴影的独立开关 (v1.5.4: 关特效不再把阴影一起关掉)
    focus: '50% 50%',     // 底图焦点 (九宫格), 裁剪时保住画面主体
    zoom: 1,              // 底图缩放 1..2.2 (绕焦点放大)
    preset: 'sakura',
    // v1.7.0 WE 动效底图: 只存 entry id, 真实 entry (封面/取色/相对路径) 每次启动从 host 的
    // /bga/we/library.json 重新解析 —— 壁纸在 WE 侧取消订阅后这里自然解析不到, 静默跳过。
    weId: null,
    weMode: 'live',       // live uses the desktop bridge; still remains available.
    weQuality: 'balanced',
  },
  list: [],
  listDir: '',
  writableDir: '',
  skipped: [],
  categories: [],   // v1.1 类型清单 (fetchList 填充); 先给空数组避免首次渲染崩溃
  total: 0,         // 全部类型图片总数
  listeners: [],
  set: function (patch) {
    var next = {}
    for (var k in this.state) next[k] = this.state[k]
    for (var p in patch) next[p] = patch[p]
    this.state = next
    STORE.save()
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i]()
  },
  /** 只通知重渲染、**不写盘**（v1.5.4）：画布宽度变了要按新数量重画粒子，
   *  那是运行时事实、不是用户设置，落到 settings.json 里只会变成噪声。 */
  touch: function () {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i]()
  },
  save: function () {
    // 2026-09-12 加闸：**没成功读到过设置就不许写盘**。
    // 少了这道闸，一个"设置还没拉回来"的客户端（重启后抢跑、路由还没就绪、请求失败）
    // 随手点一下任何开关，就会把自己那套默认值（wallpaper: null、默认主色…）
    // 整份 PUT 覆盖掉你的真实配置 —— 这正是"底图 / 特效突然全没了"的成因之一。
    // dsh-cache-control 早就有这道闸（它 state 里的 loaded），本插件一直缺。
    if (!stateLoaded) return
    if (STORE._saveTimer) { clearTimeout(STORE._saveTimer); STORE._saveTimer = null }
    STORE._saveTimer = setTimeout(function () {
      try {
        fetch('/bga/settings.json', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(STORE.state),
        }).catch(function () {})
      } catch (e) { /* ignore */ }
    }, 300)
  },
  load: function () {
    return fetch('/bga/settings.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {} })
      .catch(function () { return {} })
      .then(function (saved) {
        if (!saved || typeof saved !== 'object') return
        var patch = {}
        for (var k in STORE.state) if (k in saved) patch[k] = saved[k]
        // 一份"真设置"至少要能对上我们认识的一个字段；对不上就是 {} / 路由没就绪
        // ⇒ 保持"未装载"、不许写盘（见 save 里的闸）。
        if (!Object.keys(patch).length) return
        if (patch.effect !== undefined) patch.effect = normalizeEffect(patch.effect)
        stateLoaded = true                    // 先开闸，再 set（set 内部会 save）
        STORE.set(patch)                      // 触发监听→重绘
      })
  },
  subscribe: function (fn) {
    this.listeners.push(fn)
    var self = this
    return function () {
      var i = self.listeners.indexOf(fn)
      if (i >= 0) self.listeners.splice(i, 1)
    }
  },
}

function useBga() {
  var pair = React.useState(0)
  var force = pair[1]
  React.useEffect(function () {
    return STORE.subscribe(function () { force(function (x) { return x + 1 }) })
  }, [])
  return STORE.state
}

// ---------------------------------------------------------- 底图数据与换图 --
// 扁平条目 (跨类型): { id, cat, file, base, url, hd, no, size }
// 状态 wallpaper: { id, cat, file, name(显示名=base), url, hd, no }
//   id = 类型名 + 原始文件名 (稳定, 与排序/编号无关), 用于随机去重。

function hydrateItem(it, catName) {
  return {
    id: catName + '\u0000' + it.name,
    cat: catName,
    file: it.name,
    base: it.base || bareName(it.name),
    url: it.url,
    hd: !!it.hd,
    no: it.no || 0,
    size: it.size || 0,
  }
}

function wallpaperOf(item) {
  return {
    id: item.id,
    cat: item.cat,
    file: item.file,
    name: item.base,   // 显示名 (去扩展名/去高清标记), 不随编号变化
    url: item.url,
    hd: !!item.hd,
    no: item.no || 0,
  }
}

function fetchList() {
  return fetch('/bga/wallpapers.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status)
      return r.json()
    })
    .then(function (res) {
      var cats = (res && res.categories) || []
      var flat = []
      var enriched = []
      for (var c = 0; c < cats.length; c++) {
        var cat = cats[c]
        var catName = (cat && cat.name) || '未分类'
        var rawItems = (cat && cat.items) || []
        var items = []
        for (var i = 0; i < rawItems.length; i++) {
          var it = hydrateItem(rawItems[i], catName)
          items.push(it)
          flat.push(it)
        }
        enriched.push({
          name: catName,
          count: items.length,
          hd: 0,
          items: items,
        })
        for (var h = 0; h < items.length; h++) if (items[h].hd) enriched[enriched.length - 1].hd++
      }
      STORE.categories = enriched
      STORE.list = flat
      STORE.listDir = (res && res.dir) || ''
      STORE.writableDir = (res && res.writableDir) || ''
      STORE.skipped = (res && res.skipped) || []
      STORE.total = flat.length
      rehydrateWallpaper()
      return STORE.list
    })
}

// 持久化的旧选择可能只存了 url/name (旧版根目录图, 甚至乱码文件名)。
// 拉完最新清单后按 url / 文件名对回条目, 给当前底图补上类型/编号/高清等字段。
function rehydrateWallpaper() {
  var w = STORE.state.wallpaper
  if (!w || !STORE.list.length) return
  if (w.id && w.name) return
  var dec = null
  if (w.url) {
    try { dec = decodeURIComponent(String(w.url).split('/').pop() || '') } catch (e) { /* ignore */ }
  }
  var hit = null
  for (var i = 0; i < STORE.list.length; i++) {
    var it = STORE.list[i]
    if (w.url && it.url === w.url) { hit = it; break }
    if (!hit && dec && it.file === dec) { hit = it }
  }
  if (hit) STORE.set({ wallpaper: wallpaperOf(hit) })
}

// 持久化的旧选择可能只存了 url/name (旧版根目录图, 甚至乱码文件名)。
// 拉完最新清单后按 url / 文件名对回条目, 给当前底图补上类型/编号/高清等字段。
function rehydrateWallpaper() {
  var w = STORE.state.wallpaper
  if (!w || !STORE.list.length) return
  if (w.id && w.name) return
  var dec = null
  if (w.url) {
    try { dec = decodeURIComponent(String(w.url).split('/').pop() || '') } catch (e) { /* ignore */ }
  }
  var hit = null
  for (var i = 0; i < STORE.list.length; i++) {
    var it = STORE.list[i]
    if (w.url && it.url === w.url) { hit = it; break }
    if (!hit && dec && it.file === dec) { hit = it }
  }
  if (hit) STORE.set({ wallpaper: wallpaperOf(hit) })
}

// ---- 随机换图: 跨全部类型的轮次式 2/3 不重复 ----
// 规则: 每轮从"所有类型的全部图"里随机抽出 ceil(2/3 × 总数) 张排成随机序列
// 逐张播放; 同一轮内绝不重复 (即至少播完约 2/3 之后才可能出现重复)。一轮放完
// "放回"再从总体随机取 2/3 开新一轮。换轮衔接处只避免与上一轮最后一张紧挨着。
// 池子 (新增/删除图) 变化时自动重新洗一轮。每张图按 类型+文件名 有稳定 id,
// 重复判定基于 id, 不改变任何显示名。
var cycleDeck = []
var cycleSig = ''
var cycleTail = []   // 最近播过的若干 id, 用于换轮衔接时避免刚播完又马上出现

function buildCycleDeck(ids) {
  var n = ids.length
  var m = Math.max(1, Math.min(n, Math.ceil(n * 2 / 3)))
  var arr = ids.slice()
  for (var i = 0; i < m; i++) {
    var j = i + Math.floor(Math.random() * (n - i))
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t
  }
  var deck = arr.slice(0, m)
  // 换轮衔接: 新轮开头尽量避开上一轮末尾刚播过的几张 (已播的放到本轮靠后位置)。
  if (cycleTail.length) {
    var head = 0
    while (head < deck.length && cycleTail.indexOf(deck[head]) >= 0) head++
    if (head > 0) {
      var offenders = deck.splice(0, head)
      for (var o = 0; o < offenders.length; o++) deck.push(offenders[o])
    }
  }
  return deck
}

function cycleWallpaper() {
  function step(items) {
    if (!items.length) return
    var cur = STORE.state.wallpaper
    var byId = {}
    var ids = []
    for (var i = 0; i < items.length; i++) {
      byId[items[i].id] = items[i]
      ids.push(items[i].id)
    }
    var sig = ids.slice().sort().join('\u0001') + '\u0001' + ids.length
    if (!cycleDeck.length || sig !== cycleSig) {
      cycleDeck = buildCycleDeck(ids)
      cycleSig = sig
    }
    var picked = null
    for (var guard = 0; guard < 2 && !picked; guard++) {
      while (cycleDeck.length) {
        var id = cycleDeck.shift()
        if (cur && cur.id === id) continue   // 不与当前显示的同张
        var it = byId[id]
        if (!it) continue
        picked = it
        break
      }
      if (!picked) { cycleDeck = buildCycleDeck(ids); cycleSig = sig }
    }
    if (!picked && items.length === 1) picked = items[0]  // 全池仅一张时退化
    if (!picked) return
    cycleTail.push(picked.id)
    while (cycleTail.length > 12) cycleTail.shift()
    STORE.set({ wallpaper: wallpaperOf(picked) })
  }
  if (STORE.list.length) { step(STORE.list); return }
  fetchList().then(step).catch(function (e) {
    console.error('[bg-atelier] cycle failed: ' + String(e))
  })
}

// ---------------------------------------------------------------- 颜色工具 --

function hexRgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return { r: 232, g: 140, b: 160 }
  var v = parseInt(m[1], 16)
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

function rgba(c, a) {
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'
}

function mix(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  }
}

var WHITE = { r: 255, g: 255, b: 255 }
var BLACK = { r: 0, g: 0, b: 0 }

// ------------------------------------------------------------ 主题 token 层 --

function buildTokens(s) {
  var accent = hexRgb(s.accent)
  var deep = hexRgb(s.deep)
  var ltint = mix(deep, WHITE, 0.96)          // 浅色表面近纯白, 只留一丝色调, 避免灰雾
  var baseA = 0.6 - s.glass * 0.55            // glass .8 → 0.16; glass 1 → 0.05
  var layerA = baseA + 0.06
  var layer2A = baseA + 0.12
  var sideA = Math.min(0.95, baseA + 0.05)
  var tokens = {}
  tokens['--dsw-alias-bg-base'] = { light: rgba(ltint, baseA), dark: rgba(deep, baseA) }
  tokens['--dsw-alias-bg-layer-1'] = { light: rgba(ltint, layerA), dark: rgba(mix(deep, accent, 0.05), layerA) }
  tokens['--dsw-alias-bg-layer-2'] = { light: rgba(ltint, layer2A), dark: rgba(mix(deep, accent, 0.09), layer2A) }
  tokens['--dsw-alias-bg-layer-3'] = { light: rgba(ltint, layer2A), dark: rgba(mix(deep, accent, 0.11), layer2A) }
  tokens['--dsw-alias-bg-layer-4'] = { light: rgba(ltint, layer2A), dark: rgba(mix(deep, accent, 0.13), layer2A) }
  tokens['--dsw-alias-bg-module-platform'] = { light: rgba(ltint, layerA), dark: rgba(mix(deep, accent, 0.07), layerA) }
  tokens['--dsw-alias-bg-multi-select'] = { light: rgba(ltint, layerA), dark: rgba(mix(deep, accent, 0.07), layerA) }
  tokens['--dsw-alias-bg-overlay'] = { light: rgba(ltint, 0.95), dark: rgba(mix(deep, BLACK, 0.25), 0.95) }
  tokens['--dsw-alias-border-l1'] = { light: rgba(accent, 0.22), dark: rgba(accent, 0.24) }
  tokens['--dsw-alias-border-l2'] = { light: rgba(accent, 0.38), dark: rgba(accent, 0.42) }
  tokens['--dsw-alias-brand-primary'] = { light: rgba(mix(accent, BLACK, 0.12), 1), dark: rgba(accent, 1) }
  tokens['--dsw-specific-sidebar-fill'] = { light: rgba(ltint, sideA), dark: rgba(deep, sideA) }
  return tokens
}

// -------------------------------------------------------------- 动态样式表 --
// ① 琉璃卡面 (始终生效): 调色板染色半透明 + 背景模糊, 透明度由 cardA 控制
// ② 框缘特效 (按选择): 流萤 / 气泡 / 落樱 / 雨丝 / 关闭

function glassCardCss(s, accent, deep) {
  var a = 0.05 + s.cardA * 0.9                            // 0.05..0.95
  var blur = Math.round(s.cardBlur)
  var creamA = rgba(mix(accent, WHITE, 0.94), a)
  var darkA = rgba(mix(deep, accent, 0.07), a)
  var bd = blur > 0
    ? 'backdrop-filter:blur(' + blur + 'px) saturate(1.2);-webkit-backdrop-filter:blur(' + blur + 'px) saturate(1.2);'
    : ''
  return '' +
    'body [data-composer-card]{background:' + creamA + ';' + bd +
    'border-color:' + rgba(accent, 0.4) + '}\n' +
    'body[data-ds-dark-theme] [data-composer-card]{background:' + darkA + '}\n'
}

function effectCss(s, accent, deep) {
  // 卡面阴影 + 特效辉光，合成**一条** box-shadow（两条同选择器的规则会互相覆盖，
  // 不是叠加，所以必须在这里拼起来一次写完）。
  // 卡面两道阴影（v1.5.2）：接触阴影 0 1px 2px --bga-card-edge 贴边定框、环境阴影
  // 0 10px 28px --bga-card-shade 让卡面像浮在底图上；两个变量由 dynamicCss 按配色写入。
  // v1.5.4 起阴影归 cardShadow 开关、特效辉光归 effect 开关，两者独立拼装 ——
  // 选「关闭」特效时阴影仍然在。
  var parts = []
  if (s.cardShadow !== false) {
    parts.push('0 1px 2px var(--bga-card-edge)')
    parts.push('0 10px 28px var(--bga-card-shade)')
  }
  // 特效各自的主色辉光（「关闭」时没有）
  if (s.effect === 'firefly') parts.push('0 0 20px ' + rgba(accent, 0.18))
  else if (s.effect === 'bubble') parts.push('0 0 26px ' + rgba(accent, 0.22), '0 0 64px ' + rgba(accent, 0.1))
  else if (s.effect === 'petal') parts.push('0 0 22px ' + rgba(accent, 0.18))
  else if (s.effect === 'rain') parts.push('0 0 24px ' + rgba(accent, 0.16))
  if (!parts.length) return ''
  return 'body [data-composer-card]{box-shadow:' + parts.join(',') + '}\n'
}

function dynamicCss(s) {
  var accent = hexRgb(s.accent)
  var deep = hexRgb(s.deep)
  var css = ':root{\n' +
    '  --bga-accent:' + s.accent + ';\n' +
    '  --bga-accent-soft:' + rgba(accent, 0.45) + ';\n' +
    '  --bga-accent-faint:' + rgba(accent, 0.16) + ';\n' +
    '  --bga-deep-glow:' + rgba(mix(deep, accent, 0.25), 0.5) + ';\n' +
    // 卡面辨识用的两道阴影 (由 effectCss 用): 深色、低浓度。
    '  --bga-card-shade:' + rgba(mix(deep, accent, 0.12), 0.3) + ';\n' +
    '  --bga-card-edge:' + rgba(deep, 0.34) + ';\n' +
    '}\n'
  if (s.wallpaper) {
    // WE 动效层接管背景时不再画底图: 两者同在根层叠上下文, 底图(-1)会盖住动效层(-2),
    // 所以这里跳过底图那两条规则（卡面染色照旧, 见下）。
    if (!weActive()) {
      var veil1 = rgba(deep, s.veil)
      var veil2 = rgba(deep, s.veil * 0.55)
      var img = 'url("' + s.wallpaper.url + '")'
      var zoom = Math.max(1, Math.min(2.2, s.zoom || 1))
      // 底图统一绘制在视口固定的 ::before 层: cover 裁剪 + 焦点定位 + 绕焦点缩放
      css += 'body{background-color:' + s.deep + '}\n' +
        'body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;' +
        'background-image:linear-gradient(' + veil1 + ',' + veil2 + '),' + img + ';' +
        'background-size:cover;background-repeat:no-repeat;background-position:' + s.focus + ';' +
        'transform:scale(' + zoom.toFixed(2) + ');transform-origin:' + s.focus + '}\n'
    }
    css += glassCardCss(s, accent, deep)
  }
  // 卡面染色只在"有底图"时才加，但**特效与阴影不要求有底图**（解耦, 原因见 DockFx 注释）；
  // 阴影有自己的开关, 选「关闭」特效时这条规则仍要写出来。
  css += effectCss(s, accent, deep)
  return css
}

// -------------------------------------------------------------- 静态样式表 --

// 粒子按序号**确定性**生成 CSS: prand 对同一个 i 永远给同一个值, 所以换配色/换壁纸
// 重建整张静态样式表时萤点不会乱跳 (这里绝对不能用 Math.random)。
function prand(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/**
 * 把 n 个粒子的横向位置**均匀铺**在 [lo, hi]% 区间上：先分成 n 个等宽格子、每格放一个，
 * 格内再抖一点(≤±40% 格宽)。`prand` 本身是均匀分布，但均匀分布**不等于看起来均匀** ——
 * 样本一少（14、30 个）就必然出现"两点挨在一起、旁边一大片空着"的成团现象（泊松成团）。
 * 等分格子能保证任意一小段里的期望个数恒定，随机感靠抖动保留。
 * 端点安全：i=n-1 时基准 = lo + slot×(n-0.5)，加抖动也不会越过 hi（实测见 tools/extract-real-css.mjs）。
 */
function spread(i, n, lo, hi, seed) {
  var slot = (hi - lo) / n
  return lo + slot * (i + 0.5) + (prand(seed) - 0.5) * slot * 0.8
}

// 漂移方向**按位置选**（v1.4.2）：画布左半区的萤只向右漂，右半区只向左漂。
// 为什么必须这样：画布加了 overflow:clip 治「横向滚动条频闪」（见 staticCss() 里
// .bga-dockfx-in 的注释），粒子一旦飘出画布边缘就会被硬切一刀；按位置选方向后，
// 可见行程（含 reverse）全落在画布内，观感与从前一致而不再切边。
var WANDERS_R = ['bga-wander1', 'bga-wander2']
var WANDERS_L = ['bga-wander1L', 'bga-wander2L', 'bga-wander3']

function flyRules(n) {
  var out = []
  for (var i = 0; i < n; i++) {
    var leftN = 1 + prand(i + 1) * 97
    var left = leftN.toFixed(1)
    var bottom = 4 + Math.round(prand(i + 31) * 42)
    var size = 3 + Math.round(prand(i + 61) * 4) * 0.5
    var dur = 8 + Math.round(prand(i + 91) * 10)
    var delay = (prand(i + 121) * 12).toFixed(1)
    var tail = i % 4 === 3 ? ' reverse' : ''
    var pool = leftN >= 50 ? WANDERS_L : WANDERS_R
    out.push('.bga-fly.f' + (i + 1) + '{left:' + left + '%;bottom:' + bottom + 'px;width:' + size + 'px;height:' + size +
      'px;animation:' + pool[i % pool.length] + ' ' + dur + 's linear infinite ' + delay + 's' + tail + '}')
  }
  return out
}

function starRules(n) {
  var out = []
  for (var i = 0; i < n; i++) {
    var left = (3 + prand(i + 201) * 94).toFixed(1)
    var bottom = 40 + Math.round(prand(i + 231) * 34)
    var size = 2.5 + Math.round(prand(i + 261) * 2) * 0.5
    var dur = (2.2 + prand(i + 291) * 2.4).toFixed(1)
    var delay = (prand(i + 321) * 4).toFixed(1)
    out.push('.bga-star.s' + (i + 1) + '{left:' + left + '%;bottom:' + bottom + 'px;width:' + size + 'px;height:' + size +
      'px;animation:bga-twinkle ' + dur + 's ease-in-out infinite ' + delay + 's}')
  }
  return out
}

function bubRules(n) {
  var out = []
  for (var i = 0; i < n; i++) {
    var left = (2 + prand(i + 401) * 95).toFixed(1)
    var bottom = 4 + Math.round(prand(i + 431) * 18)
    var size = 7 + Math.round(prand(i + 461) * 15)          // 7~22px
    var dur = 5.2 + prand(i + 491) * 5                      // 升得更快, 一屏里同时在飞的多
    // **负延迟**（v1.5.3）：切换瞬间气泡已在行程中途, 不会带着边框实心停在底部"等发车";
    // 配合下面 .bga-bub 的 opacity:0 双保险。
    var delay = -(prand(i + 521) * dur).toFixed(1)
    out.push('.bga-bub.b' + (i + 1) + '{left:' + left + '%;bottom:' + bottom + 'px;width:' + size + 'px;height:' + size +
      'px;animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay + 's}')
  }
  return out
}

// ================= 画布宽度 → 粒子数量（数量随屏宽，密度不随屏宽） =================
// 每个特效定义一个**间距**（多少 px 一颗），数量 = round(画布宽 / 间距)，再夹进上下限。
// 间距按"本机画布 985px 下复核过的数量"折算：流萤 54.7px/颗、星与气泡与落樱 70.4、雨丝 22.4。
// 上下限只防极端：小到 300px 画布也不至于只剩两三颗，大到 4K 也不至于上百颗压帧。
var CANVAS_W = 985
var DENSITY = {
  fly:   { per: 54.7, min: 6,  max: 40 },
  star:  { per: 70.4, min: 4,  max: 30 },
  bub:   { per: 70.4, min: 5,  max: 26 },
  petal: { per: 70.4, min: 4,  max: 30 },
  rain:  { per: 22.4, min: 10, max: 90 },
}
function countFor(kind) {
  var d = DENSITY[kind]
  return Math.min(d.max, Math.max(d.min, Math.round(CANVAS_W / d.per)))
}

// 规则数组是**可重建**的：画布宽度一变就按新数量重算（数量同时决定 CSS 规则条数与 DockFx 的节点数）。
var FLY_RULES = [], STAR_RULES = [], BUB_RULES = [], PETAL_RULES = [], RAIN_RULES = []
function regenerateParticles() {
  FLY_RULES = flyRules(countFor('fly'))
  STAR_RULES = starRules(countFor('star'))
  BUB_RULES = bubRules(countFor('bub'))
  PETAL_RULES = petalRules(countFor('petal'))
  RAIN_RULES = rainRules(countFor('rain'))
}
regenerateParticles()

// ---- v1.5.2 定稿留下的两条粒子特效 (同一套 prand 确定性生成, 同样不许用 Math.random) ----
// 每个 for 里的 left 区间都按 **最宽画布 (会话列宽 3840 ⇒ 画布 3872px)** 之外的常态宽度算过，
// 并留出"粒子自身尺寸 + 模糊外扩"的余量，保证行程不越出画布右缘
// （越界就会顶大会话区的 scrollWidth ⇒ 横向滚动条频闪，见 tools/verify-dockfx-bounds.mjs）。

/** 落樱：小花瓣下落 + 横摆。left 走 spread() 等分格子防泊松成团；
 *  尺寸 5–8px、985px 画布下 14 片 —— "多了叶子、不是变密了"（视觉铺满感反而约 -27%）。 */
function petalRules(n) {
  var out = []
  for (var i = 0; i < n; i++) {
    var left = spread(i, n, 4, 92, i + 601).toFixed(1)
    var w = 5 + Math.round(prand(i + 611) * 3)
    var dur = 9 + Math.round(prand(i + 621) * 6)
    var delay = (prand(i + 631) * 11).toFixed(1)
    var dx = Math.round(-26 + prand(i + 641) * 52)
    out.push('.bga-ptl i.p' + (i + 1) + '{left:' + left + '%;width:' + w + 'px;height:' + (w + 2) +
      'px;--bga-dur:' + dur + 's;--bga-delay:' + delay + 's;--bga-dx:' + dx + 'px}')
  }
  return out
}

/** 雨丝：细斜雨丝下落。left 走 spread() 等分格子（局部挤成一簇 = 泊松成团，不是数量问题）；
 *  985px 画布下 44 条、落速 0.85–1.5s（行程 110px）。粗细 1px、跨度不动。 */
function rainRules(n) {
  var out = []
  for (var i = 0; i < n; i++) {
    var left = spread(i, n, 4, 96, i + 701).toFixed(1)
    var h = 14 + Math.round(prand(i + 711) * 16)
    var dur = (0.85 + prand(i + 721) * 0.65).toFixed(2)
    // 负延迟：切到雨丝特效的瞬间就已经满屏在下，不需要等 0–3s 才逐条开始
    var delay = -(prand(i + 731) * 1.5).toFixed(2)
    out.push('.bga-rn i.r' + (i + 1) + '{left:' + left + '%;height:' + h + 'px;--bga-dur:' + dur + 's;--bga-delay:' + delay + 's}')
  }
  return out
}

// 样式表改成**函数**：数量随画布宽度变，所以每次重建都要重新读一遍上面的数组（它们在
// 末尾用 ...FLY_RULES 这类展开进来的）。画布宽变化时由 rebuildStatic() 重新插入一份。
function staticCss() {
  return [
  '@property --bga-a{syntax:"<angle>";initial-value:0deg;inherits:false}',
  '@keyframes bga-spin{to{--bga-a:360deg}}',
  '@keyframes bga-breathe{50%{opacity:0.45}}',
  '@keyframes bga-twinkle{0%,100%{transform:scale(0.7);opacity:0.35}50%{transform:scale(1.15);opacity:0.95}}',
  '@keyframes bga-wander1{0%{opacity:0;transform:translate(0,0)}10%{opacity:0.9}45%{opacity:0.7;transform:translate(130px,-14px)}80%{opacity:0.9}100%{opacity:0;transform:translate(260px,-2px)}}',
  '@keyframes bga-wander2{0%{opacity:0;transform:translate(0,0)}14%{opacity:0.85}50%{opacity:0.6;transform:translate(90px,-20px)}85%{opacity:0.85}100%{opacity:0;transform:translate(190px,-6px)}}',
  '@keyframes bga-wander3{0%{opacity:0;transform:translate(0,0)}12%{opacity:0.8}40%{opacity:0.65;transform:translate(-80px,-16px)}78%{opacity:0.85}100%{opacity:0;transform:translate(-170px,-4px)}}',
  // 向左的镜像版 (v1.4.2): 右半区的萤用这两条, 保证它们不飘出画布右缘。
  '@keyframes bga-wander1L{0%{opacity:0;transform:translate(0,0)}10%{opacity:0.9}45%{opacity:0.7;transform:translate(-130px,-14px)}80%{opacity:0.9}100%{opacity:0;transform:translate(-260px,-2px)}}',
  '@keyframes bga-wander2L{0%{opacity:0;transform:translate(0,0)}14%{opacity:0.85}50%{opacity:0.6;transform:translate(-90px,-20px)}85%{opacity:0.85}100%{opacity:0;transform:translate(-190px,-6px)}}',
  '@keyframes bga-meteor{0%{opacity:0;transform:translateX(0) rotate(-4deg)}6%{opacity:0.9}18%{opacity:0;transform:translateX(58vw) rotate(-4deg)}100%{opacity:0;transform:translateX(58vw) rotate(-4deg)}}',
  '@keyframes bga-meteor2{0%{opacity:0;transform:translateX(0) rotate(3deg)}5%{opacity:0.85}16%{opacity:0;transform:translateX(-52vw) rotate(3deg)}100%{opacity:0;transform:translateX(-52vw) rotate(3deg)}}',
  '@keyframes bga-rot{to{transform:rotate(360deg)}}',
  // ---- 流萤 dock ----
  '.bga-dockfx{height:0;position:relative;z-index:5;width:100%;max-width:var(--dsh-composer-card-max-width,100%);pointer-events:none}',
  // 画布 overflow:clip 治「横向滚动条频闪」：粒子/流星都是 left% + translate 漂移,
  // overflow:visible 时飘出右缘会把外层 [data-conversation-scroll]（overflow:auto）的
  // scrollWidth 顶大 ⇒ 会话区底部横滚条反复出现。clip 不生成滚动容器、不顶祖先;
  // 配合 flyRules 的「按位置选漂移方向」, 粒子行程全在画布内, clip 只当兜底。
  '.bga-dockfx-in{position:absolute;left:0;right:0;bottom:4px;height:90px;overflow:clip}',
  '.bga-fly{position:absolute;width:5px;height:5px;border-radius:50%;corner-shape:round;background:var(--bga-accent);box-shadow:0 0 12px 3px var(--bga-accent-soft);opacity:0}',
  ...FLY_RULES,
  '.bga-star{position:absolute;width:3px;height:3px;border-radius:50%;corner-shape:round;background:var(--bga-accent);box-shadow:0 0 7px 1.5px var(--bga-accent-soft);opacity:0;animation:bga-twinkle 2.8s ease-in-out infinite}',
  ...STAR_RULES,
  '.bga-meteor{position:absolute;left:-8%;bottom:48px;width:70px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--bga-accent),transparent);opacity:0;animation:bga-meteor 9s linear infinite 4s}',
  // m2 起点收进画布内（原 right:-6% 起手就探出右缘）, 免得流星从边缘"凭空冒头"。
  '.bga-meteor.m2{left:auto;right:0;bottom:66px;width:94px;height:2.5px;animation:bga-meteor2 13s linear infinite 7.5s}',
  // ---- 特效: 气泡 (与流萤共用 .bga-dockfx 这块画布) ----
  // 气泡: 个头 7~22px、边缘带高光+外辉, 底部铺一层"水面"辉光带, 让整串气泡有出处。
  '@keyframes bga-rise{0%{transform:translateY(0) scale(.5);opacity:0}12%{opacity:.95}68%{opacity:.72}100%{transform:translateY(-92px) scale(1.35);opacity:0}}',
  '.bga-bub{position:absolute;border-radius:50%;corner-shape:round;border:2px solid var(--bga-accent-soft);background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.95),var(--bga-accent-faint) 60%,var(--bga-accent-soft) 100%);box-shadow:0 0 10px var(--bga-accent-faint),inset 0 -2px 6px var(--bga-accent-faint);opacity:0;animation:bga-rise 7s ease-in infinite}',
  ...BUB_RULES,
  '@keyframes bga-bubsurf{0%,100%{opacity:.3;transform:scaleX(1)}50%{opacity:.62;transform:scaleX(1.05)}}',
  '.bga-bubsurf{position:absolute;left:-2%;right:-2%;bottom:0;height:22px;border-radius:50%;corner-shape:round;filter:blur(13px);background:var(--bga-accent-soft);opacity:.4;animation:bga-bubsurf 6.5s ease-in-out infinite}',
  // ---- 落樱 / 雨丝 (都在同一块 .bga-dockfx-in 画布上; 画布 overflow:clip,
  //      每条的行程都按"不碰到画布边缘"设计, clip 只当兜底)。
  // 落樱: 花瓣用 border-radius:50% 0 50% 0 出叶形 (corner-shape:round 保住这个形状,
  //    否则会被主题的全局 corner-shape 改成方圆角)。落到底部前淡出, 不会"拍"在卡面上。
  '@keyframes bga-fall{0%{transform:translate(0,-10px) rotate(0);opacity:0}12%{opacity:.85}88%{opacity:.7}100%{transform:translate(var(--bga-dx,0px),104px) rotate(300deg);opacity:0}}',
  '.bga-ptl i{position:absolute;top:-12px;background:linear-gradient(150deg,var(--bga-accent),var(--bga-accent-soft));border-radius:50% 0 50% 0;corner-shape:round;opacity:0;animation:bga-fall var(--bga-dur,11s) linear infinite var(--bga-delay,0s)}',
  ...PETAL_RULES,
  // 雨丝: 细斜雨丝下落 + 底部一层"被雨打湿"的水光。雨丝左移 22px, left 起点 4% 起,
  //    两端都不触画布边。条数见 RAIN_RULES。
  '@keyframes bga-drop{0%{transform:translate(0,-16px) rotate(12deg);opacity:0}10%{opacity:.75}100%{transform:translate(-22px,110px) rotate(12deg);opacity:0}}',
  '@keyframes bga-wet{0%,100%{opacity:.09}50%{opacity:.2}}',
  '.bga-rn i{position:absolute;top:-14px;width:1px;background:linear-gradient(180deg,transparent,var(--bga-accent));opacity:0;animation:bga-drop var(--bga-dur,2s) linear infinite var(--bga-delay,0s)}',
  ...RAIN_RULES,
  '.bga-wet{position:absolute;left:8%;right:8%;bottom:0;height:10px;border-radius:50%;corner-shape:round;background:var(--bga-accent);filter:blur(9px);opacity:.14;animation:bga-wet 3.4s ease-in-out infinite}',
  // ---- 侧边栏宝珠 ----
  // --bga-orb-dy / --bga-orb-dx 由 dsh-browser-live 叠列模式写入（纯平移让位，不影响布局盒）
  // DSH 主题有全局 `*,:before,:after{corner-shape:var(--dsw-corner-shape)}`（默认方圆角），
  // 凡 border-radius:50% 的"真圆"都会被画成圆角方块 —— 圆形控件必须写 corner-shape:round 豁免。
  '.bga-orb{border:none;background:none;padding:4px;cursor:pointer;display:flex;align-items:center;justify-content:center}',
  '.bga-orb-core{display:block;width:18px;height:18px;border-radius:50%;corner-shape:round;border:1px solid rgba(255,255,255,.4);box-shadow:0 0 9px var(--bga-accent-soft,rgba(0,0,0,.2));transition:transform .18s;transform:translate(var(--bga-orb-dx,0px),var(--bga-orb-dy,0px))}',
  '.bga-orb:hover .bga-orb-core{transform:translate(var(--bga-orb-dx,0px),var(--bga-orb-dy,0px)) scale(1.18)}',
  // ---- 设置页 ----
  '.bga-page{display:flex;flex-direction:column;gap:22px;max-width:760px}',
  '.bga-h{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0 0 4px}',
  '.bga-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 10px;line-height:1.6}',
  '.bga-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;max-height:264px;overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:var(--bga-accent-soft,rgba(0,0,0,.2)) transparent}',
  '.bga-card{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;cursor:pointer;background:var(--dsw-alias-bg-layer-1);padding:0;text-align:left;transition:border-color .15s,transform .15s}',
  '.bga-card:hover{transform:translateY(-2px);border-color:var(--dsw-alias-border-l2)}',
  '.bga-card.on{border-color:var(--bga-accent,var(--dsw-alias-brand-primary));box-shadow:0 0 0 1px var(--bga-accent,var(--dsw-alias-brand-primary)) inset}',
  '.bga-thumb{width:100%;height:86px;object-fit:cover;display:block;background:var(--dsw-alias-bg-layer-2)}',
  '.bga-none{width:100%;height:86px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:13px}',
  '.bga-name{padding:6px 8px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;display:flex;align-items:center;justify-content:center;gap:4px}',
  '.bga-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
  '.bga-swatches{display:flex;gap:8px;flex-wrap:wrap}',
  '.bga-swatch{display:flex;flex-direction:column;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}',
  '.bga-swatch.on{border-color:var(--bga-accent);box-shadow:0 0 0 1px var(--bga-accent) inset}',
  '.bga-dots{display:flex;gap:4px}',
  '.bga-dot{width:14px;height:14px;border-radius:50%;corner-shape:round;border:1px solid rgba(0,0,0,.15)}',
  '.bga-field{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.bga-field input[type=color]{width:34px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:none;padding:1px;cursor:pointer}',
  '.bga-field input[type=range]{width:130px;accent-color:var(--bga-accent,var(--dsw-alias-brand-primary))}',
  '.bga-fxopts{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}',
  '.bga-fxopt{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);text-align:left;color:var(--dsw-alias-label-primary)}',
  '.bga-fxopt.on{border-color:var(--bga-accent);box-shadow:0 0 0 1px var(--bga-accent) inset}',
  '.bga-fxopt b{display:block;font-size:13px;margin-bottom:4px}',
  '.bga-fxopt span{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
  '.bga-btn{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 12px;cursor:pointer}',
  '.bga-btn:hover{border-color:var(--dsw-alias-border-l2)}',
  '.bga-foci{display:grid;grid-template-columns:repeat(3,26px);gap:4px}',
  '.bga-focus{width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
  '.bga-focus i{width:6px;height:6px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-secondary);display:block}',
  '.bga-focus.on{border-color:var(--bga-accent);box-shadow:0 0 0 1px var(--bga-accent) inset}',
  '.bga-focus.on i{background:var(--bga-accent)}',
  '.bga-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.7;border-left:2px solid var(--bga-accent,var(--dsw-alias-brand-primary));padding-left:10px}',
  '.bga-we-controls{margin:16px 0;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:rgba(248,250,252,.94)}body[data-ds-dark-theme] .bga-we-controls{background:rgba(18,24,34,.92)}',
  '.bga-we-properties{margin-top:18px}.bga-we-group{margin:10px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}',
  '.bga-we-group summary{padding:12px 14px;cursor:pointer;font-size:13px;font-weight:600}.bga-we-group[open] summary{border-bottom:1px solid var(--dsw-alias-border-l1)}',
  '.bga-we-field{display:grid;grid-template-columns:minmax(120px,1fr) minmax(150px,1.2fr);align-items:center;gap:16px;padding:10px 14px;font-size:12px}.bga-we-field+ .bga-we-field{border-top:1px solid var(--dsw-alias-border-l1)}',
  '.bga-we-range{display:flex;align-items:center;gap:10px}.bga-we-range input[type=range]{flex:1;min-width:60px;accent-color:var(--bga-accent,var(--dsw-alias-brand-primary))}.bga-we-range input[type=number]{width:70px}',
  '.bga-we-properties input:not([type=range]):not([type=checkbox]):not([type=color]),.bga-we-properties select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;min-width:0}',
  '.bga-we-field input[type=checkbox]{justify-self:end;width:18px;height:18px;accent-color:var(--bga-accent,var(--dsw-alias-brand-primary))}.bga-we-field input[type=color]{justify-self:end;width:48px;height:30px;border:0;background:transparent}',
  '.bga-we-presets{margin-top:18px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:14px}.bga-we-presets .bga-row{margin-top:8px}.bga-we-controls button:disabled{opacity:.5;cursor:default}',
  '.bga-we-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}.bga-we-toolbar input{flex:1;min-width:140px}.bga-we-toolbar input,.bga-we-toolbar select{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}',
  '.bga-we-library{max-height:360px;overflow-y:auto;padding:3px;align-content:start}.bga-we-card{cursor:default}.bga-we-pick{display:block;width:100%;border:0;padding:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}.bga-we-pick:focus-visible{outline:2px solid var(--bga-accent);outline-offset:-3px}.bga-we-card-title{display:block;padding:8px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bga-we-card-meta{display:flex;gap:6px;padding:0 8px 8px;font-size:11px;opacity:.8}.bga-we-card-actions{display:flex;flex-wrap:wrap;gap:4px;padding:0 8px 8px}.bga-we-card .bga-note{padding:0 8px 8px}',
  '.bga-we-actions{padding:10px 0;flex-wrap:wrap}.bga-we-current{margin:12px 0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}.bga-we-current strong{overflow-wrap:anywhere}.bga-we-current .bga-row{margin-top:8px}.bga-we-empty{padding:24px;text-align:center}.bga-we-controls .bga-row{flex-wrap:wrap}',
  '@media(max-width:650px){.bga-we-field{grid-template-columns:1fr;gap:8px}.bga-we-field input[type=checkbox]{justify-self:start}}',
  // ---- v1.1: 当前底图条 + 类型卡 + 二级图库 ----
  '.bga-cur{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:10px}',
  '.bga-curbox{position:relative;display:block;width:64px;height:42px;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);flex:none}',
  '.bga-curbox.off{opacity:.45}',
  '.bga-curbox.off::before{display:none}',
  '.bga-cur-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}',
  '.bga-cur-info{flex:1;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}',
  '.bga-cur-info small{display:block;font-size:11px;color:var(--dsw-alias-label-secondary)}',
  '.bga-card:disabled{opacity:.5;cursor:default}',
  '.bga-card:disabled:hover{transform:none;border-color:var(--dsw-alias-border-l1)}',
  '.bga-catgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px;max-height:300px;overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:var(--bga-accent-soft,rgba(0,0,0,.2)) transparent}',
  '.bga-cat{display:flex;gap:10px;align-items:center;padding:10px}',
  '.bga-cat-thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;width:118px;flex:none}',
  '.bga-mini{width:57px;height:40px;object-fit:cover;border-radius:6px;display:block;background:var(--dsw-alias-bg-layer-2)}',
  '.bga-emptymini{width:57px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:10px;background:var(--dsw-alias-bg-layer-2)}',
  '.bga-cat-meta{min-width:0;flex:1}',
  '.bga-cat-meta b{display:block;font-size:13px;color:var(--dsw-alias-label-primary);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.bga-cat-meta span{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.4}',
  '.bga-grid.tall{max-height:min(58vh,560px)}',
  '.bga-back{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:4px 10px;cursor:pointer}',
  '.bga-back:hover{border-color:var(--dsw-alias-border-l2)}',
  '.bga-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;padding:3px 12px;cursor:pointer;line-height:1.5}',
  '.bga-chip:hover{border-color:var(--dsw-alias-border-l2)}',
  '.bga-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--bga-accent,var(--dsw-alias-brand-primary));box-shadow:0 0 0 1px var(--bga-accent,var(--dsw-alias-brand-primary)) inset}',
  '.bga-thumbwrap{position:relative;display:block}',
  '.bga-no{position:absolute;left:4px;top:4px;font-size:9px;line-height:1.2;padding:2px 5px;border-radius:5px;background:rgba(0,0,0,.6);color:#fff;pointer-events:none}',
  '.bga-name em{font-style:normal;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:0 4px;flex:none}',
  // ---- v1.2: 加载动画 (转圈) + 类型卡缩略图盒子 ----  '.bga-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:26px 0;color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.bga-spin{width:15px;height:15px;border-radius:50%;corner-shape:round;border:2px solid rgba(160,170,190,.3);border-top-color:var(--bga-accent,#7aa7e8);animation:bga-rot .7s linear infinite}',
  '.bga-thumbwrap::before,.bga-curbox::before,.bga-minibox::before{content:"";position:absolute;left:50%;top:50%;z-index:0;border-radius:50%;corner-shape:round;border:2px solid rgba(160,170,190,.28);border-top-color:var(--bga-accent,#7aa7e8);animation:bga-rot .7s linear infinite}',
  '.bga-thumbwrap::before{width:20px;height:20px;margin:-10px 0 0 -10px}',
  '.bga-curbox::before{width:15px;height:15px;margin:-8px 0 0 -8px}',
  '.bga-minibox::before{width:13px;height:13px;margin:-7px 0 0 -7px}',
  '.bga-thumbwrap img{position:relative;z-index:1}',
  '.bga-minibox{position:relative;display:block;width:57px;height:40px;border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
  '.bga-minibox img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}',
  // ---- 「文件目录与类型说明」抽屉 (点开才显示说明正文) ----
  '.bga-foldbtn{display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;padding:3px 10px;border-radius:8px;cursor:pointer}',
  '.bga-foldbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--bga-accent,var(--dsw-alias-brand-primary))}',
  '.bga-foldbody{margin-top:8px;border-left:2px solid var(--bga-accent,var(--dsw-alias-brand-primary));padding-left:10px;display:flex;flex-direction:column;gap:6px}',
  // 卡面阴影的独立小开关：一行小字 + 原生勾选框
  '.bga-tiny{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}',
  '.bga-tiny:hover{color:var(--dsw-alias-label-primary)}',
  '.bga-tiny input{width:13px;height:13px;margin:0;accent-color:var(--bga-accent,var(--dsw-alias-brand-primary));cursor:pointer}',
  ].join('\n')
}

// ---------------------------------------------- 画布实宽 → 重建样式表 --
// **必须在模块作用域**：DockFx（模块级组件）每次渲染后要调 syncCanvasWidth，
// apply() 里的 resize 监听也要调它。踩过的坑：把 syncCanvasWidth 定义在 apply()
// 内部、而 DockFx 在模块作用域调用 ⇒ 组件一挂载就 ReferenceError, 整块 dock 被 React
// 卸掉（表现为"对话框特效全无"）。离线 harness 现在会真跑 useEffect 并渲染 DockFx, 这类错当场炸。
var disposeStatic = null
function rebuildStatic() {
  if (disposeStatic) disposeStatic()
  disposeStatic = styles.insert(staticCss())
}
var canvasTimer = 0
/** 量画布实宽 → 按新宽度重算数量 → 重建样式表 + 通知重渲染。
 *  只在"变化超过 24px"时才动：拖窗口边缘会连续触发 resize，不设闸会把整张样式表
 *  一帧重建一次。 */
function syncCanvasWidth() {
  if (typeof document === 'undefined' || !document.querySelector) return
  var el = document.querySelector('.bga-dockfx')
  var w = el && el.getBoundingClientRect ? Math.round(el.getBoundingClientRect().width) : 0
  if (!w) {
    var c = document.querySelector('[data-composer-card]')
    w = c ? Math.round(c.getBoundingClientRect().width) : 0
  }
  if (!w || Math.abs(w - CANVAS_W) < 24) return
  CANVAS_W = w
  regenerateParticles()
  rebuildStatic()
  STORE.touch()          // 让 DockFx 用新数量重渲染（不写盘，见 STORE.touch 注释）
}

// ---------------------------------------------------------- 流萤 dock -------

// 输入框上方那条 0 高度 dock 画布: 按当前特效渲染各自的 DOM。
// 只负责建节点, 动画全在 staticCss() 里 (纯 CSS, 不跑 JS 定时器)。
function DockFx() {
  var s = useBga()
  // 特效不要求"有底图"（解耦）：点「清除底图」只影响背景, 不该让特效一起无声消失。
  if (s.effect === 'off') return null
  var kids = []
  var i
  if (s.effect === 'firefly') {
    for (i = 1; i <= FLY_RULES.length; i++) kids.push(h('div', { key: 'f' + i, className: 'bga-fly f' + i }))
    for (i = 1; i <= STAR_RULES.length; i++) kids.push(h('div', { key: 's' + i, className: 'bga-star s' + i }))
    kids.push(h('div', { key: 'meteor', className: 'bga-meteor' }))
    kids.push(h('div', { key: 'meteor2', className: 'bga-meteor m2' }))
  } else if (s.effect === 'bubble') {
    kids.push(h('div', { key: 'surf', className: 'bga-bubsurf' }))
    for (i = 1; i <= BUB_RULES.length; i++) kids.push(h('div', { key: 'b' + i, className: 'bga-bub b' + i }))
  } else if (s.effect === 'petal') {
    var petals = []
    for (i = 1; i <= PETAL_RULES.length; i++) petals.push(h('i', { key: 'p' + i, className: 'p' + i }))
    kids.push(h('div', { key: 'ptl', className: 'bga-ptl' }, petals))
  } else if (s.effect === 'rain') {
    var drops = []
    for (i = 1; i <= RAIN_RULES.length; i++) drops.push(h('i', { key: 'r' + i, className: 'r' + i }))
    kids.push(h('div', { key: 'wet', className: 'bga-wet' }))
    kids.push(h('div', { key: 'rn', className: 'bga-rn' }, drops))
  } else {
    return null
  }
  // 每次渲染后量一次画布实宽（数量按它算）。syncCanvasWidth 自己带 24px 闸门，
  // 量到变化才重建样式表 + 通知重渲染，所以这里不会形成渲染循环。
  React.useEffect(function () { syncCanvasWidth() })
  return h('div', { className: 'bga-dockfx', 'aria-hidden': 'true' },
    h('div', { className: 'bga-dockfx-in' }, kids))
}

// ---------------------------------------------------------- 侧边栏宝珠 ------

function Orb() {
  var s = useBga()
  return h('button', {
    className: 'bga-orb',
    title: '底图工坊 · 随机换一张 (全部类型, 同轮 2/3 内不重复)' + (s.wallpaper ? ' (当前: ' + curLabel(s.wallpaper) + ')' : ''),
    onClick: cycleWallpaper,
  }, h('span', {
    className: 'bga-orb-core',
    style: { background: 'radial-gradient(circle at 35% 30%, ' + s.accent + ', ' + s.deep + ')' },
  }))
}

// ---------------------------------------------------- 叠列协同：宝珠被动让位 --
// 与 dsh-browser-live 的「叠列」约定：browser-live 的客户端发现本插件宝珠
// （.bga-orb）与 wallet 峰谷卡（.dshw_footRing）共存时，会把「宝珠上 + 地球下」
// 这一对以峰谷卡中心为对称轴上下居中；卡片与宝珠空档较大时还会把整列右移吸附到
// 卡片左侧。几何全部由 dsh-browser-live 单点写入 --bga-orb-dy/--bga-orb-dx，
// 本插件只提供被动 CSS 变量（见 staticCss()），避免两处周期测量互相打架。

// ---------------------------------------------------------------- 设置页 ----

function Section(title, sub) {
  var kids = Array.prototype.slice.call(arguments, 2)
  return h('section', null,
    h('h3', { className: 'bga-h' }, title),
    sub ? h('p', { className: 'bga-sub' }, sub) : null,
    h.apply(null, ['div', null].concat(kids)))
}

function Slider(label, value, min, max, onChange, unit) {
  var shown = unit === 'px' ? Math.round(value) + 'px'
    : unit === 'x' ? '×' + Number(value).toFixed(2)
    : Math.round(value * 100) + '%'
  return h('label', { className: 'bga-field' }, label + ' ',
    h('input', { type: 'range', min: String(min), max: String(max), step: '0.01', value: String(value),
      onChange: function (e) { onChange(Number(e.target.value)) } }),
    shown)
}

/** 一行小字 + 原生勾选框的小开关（「卡面阴影」用, 它从特效里独立出来）。 */
function TinySwitch(label, value, onChange) {
  return h('label', { className: 'bga-tiny' },
    h('input', { type: 'checkbox', checked: !!value, onChange: function (e) { onChange(e.target.checked) } }),
    label)
}

// ------------------------------------------------- 二级图库网格 (memo 隔离) --
// 底图列表卡片多(几十~上百张)时, 拖动滑杆/改颜色等操作会让 SettingsPage 频繁
// 重渲染; 用 React.memo 让"数据引用、筛选、选中项都没变"的网格跳过重渲染,
// 图卡本身不重建, 显著减卡顿。点击卡片直接写 STORE, 不依赖父级回调。
var ItemGrid = React.memo(function ItemGrid(props) {
  var items = props.items
  var filter = props.filter
  var curId = props.curId
  var showNo = props.showNo
  var mixed = props.mixed
  var cards = []
  for (var i = 0; i < items.length; i++) {
    ;(function (it) {
      if (filter === 'hd' && !it.hd) return
      if (filter === 'plain' && it.hd) return
      var on = !!(curId && curId === it.id)
      cards.push(h('button', {
        key: it.id,
        className: 'bga-card' + (on ? ' on' : ''),
        title: '选择 ' + it.base + (it.hd ? ' (高清)' : ''),
        onClick: function () { STORE.set({ wallpaper: wallpaperOf(it) }) },
      },
        h('span', { className: 'bga-thumbwrap' },
          // 图库主图用 640px 派生图: 网格卡约 150–260 CSS 宽, 2x 屏也不糊。
          h('img', { className: 'bga-thumb', src: it.url + '?sz=preview', alt: it.base, loading: 'lazy', decoding: 'async' }),
          showNo ? h('span', { className: 'bga-no' }, '№' + it.no) : null),
        h('div', { className: 'bga-name' }, it.base,
          it.hd ? h('em', null, '高清') : (mixed ? h('em', null, '普通') : null))))
    })(items[i])
  }
  return h('div', { className: 'bga-grid tall' }, cards)
})

// ------------------------------------------------------ 对话页宽度：已迁出 --
// 「对话页固定宽度」整节（UI + findChatRoot/pinChatWidth/MutationObserver）自 v1.3.0
// 移交 dsh-cache-control（设置页「会话策略 · 对话页」），本插件不再碰 --dsh-chat-* 变量。

function SettingsPage() {
  var s = useBga()
  var cur = s.wallpaper || null
  var dataPair = React.useState({ dir: STORE.listDir, cats: STORE.categories || [], total: STORE.total || 0 })
  var data = dataPair[0]
  var setData = dataPair[1]
  var errPair = React.useState('')
  var loadError = errPair[0]
  var setLoadError = errPair[1]
  var viewPair = React.useState({ page: 'cats', cat: '', hd: 'all' })
  var view = viewPair[0]
  var setView = viewPair[1]
  var readyPair = React.useState(false)   // 清单首次拉取完成前显示加载动画
  var ready = readyPair[0]
  var setReady = readyPair[1]
  var foldPair = React.useState(false)    // 「文件目录与类型说明」抽屉默认收起
  var dirFoldOpen = foldPair[0]
  var setDirFoldOpen = foldPair[1]

  function refresh() {
    setLoadError('')
    fetchList().then(function () {
      setData({ dir: STORE.listDir, cats: STORE.categories, total: STORE.total })
      setReady(true)
    }).catch(function (e) {
      setLoadError('底图清单加载失败: ' + String(e))
      setReady(true)
    })
  }
  React.useEffect(function () { refresh() }, [])   // 打开页面始终拉最新清单

  // ---- 从 GitHub Release 取回底图（图片不进 git，见 README「底图分发」节）----
  // 与命令行 node tools/fetch-wallpapers.mjs 走 host 侧同一份实现（fetch-wallpapers.js），
  // 逐张校验字节数与 sha256；已存在且校验通过的会跳过，所以按钮可以反复点、断网续传。
  var progPair = React.useState(null)
  var prog = progPair[0]
  var setProg = progPair[1]
  function pollFetch() {
    fetch('/bga/wallpapers/fetch-status', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (st) {
        setProg(st)
        if (st.running) { setTimeout(pollFetch, 800); return }
        if (st.finishedAt) refresh()          // 取完（无论成败）刷一次列表，把新图显示出来
      })
      .catch(function () { /* 状态查不到就不轮询了 */ })
  }
  function startFetch() {
    setProg({ running: true, done: 0, total: 0 })
    fetch('/bga/wallpapers/fetch', { method: 'POST' })
      .then(function (r) { return r.json() })
      .then(function (r) {
        if (r && r.error) { setProg({ running: false, error: r.error }); return }
        pollFetch()
      })
      .catch(function (e) { setProg({ running: false, error: '请求失败: ' + String(e) }) })
  }
  React.useEffect(function () {
    // 进设置页时若正在下（比如上次没看完），接上进度
    fetch('/bga/wallpapers/fetch-status', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (st) { if (st && st.running) { setProg(st); pollFetch() } })
      .catch(function () {})
  }, [])
  var fetchRow = (function () {
    var label = '下载底图'
    var note = '从 Release 资产取回（19 张约 333MB，逐张校验 sha256；已存在的会跳过）'
    if (prog && prog.running) {
      var pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
      label = '下载中 ' + pct + '%'
      note = prog.done + '/' + prog.total + ' · 已下 ' + (prog.downloaded || 0) + ' 跳过 ' + (prog.skipped || 0) + ' 失败 ' + (prog.failed || 0) + ' · ' + ((prog.bytes || 0) / 1048576).toFixed(1) + ' MB'
    } else if (prog && prog.error) {
      note = '失败：' + prog.error
    } else if (prog && prog.finishedAt) {
      note = '完成：下载 ' + (prog.downloaded || 0) + ' 张 · 跳过 ' + (prog.skipped || 0) + ' 张 · 失败 ' + (prog.failed || 0) + ' 张'
        + (prog.failed ? '（可再点一次补缺）' : '')
    }
    return h('div', { className: 'bga-row', style: { margin: '0 0 10px' } },
      h('button', {
        className: 'bga-btn',
        disabled: !!(prog && prog.running),
        onClick: startFetch,
        title: '等价于在插件目录执行 node tools/fetch-wallpapers.mjs',
      }, label),
      h('span', { className: 'bga-field' }, note))
  })()

  // 当前正浏览的类型若已不存在/为空目录, 自动退回类型页
  var activeCat = null
  if (view.page === 'cat') {
    for (var ai = 0; ai < data.cats.length; ai++) {
      if (data.cats[ai].name === view.cat && data.cats[ai].count > 0) { activeCat = data.cats[ai]; break }
    }
  }
  React.useEffect(function () {
    if (view.page === 'cat' && !activeCat) setView({ page: 'cats', cat: '', hd: 'all' })
  })

  var totalHd = 0
  for (var th = 0; th < data.cats.length; th++) totalHd += data.cats[th].hd || 0

  // ---- 类型卡 (一级页) ----
  var catCards = []
  for (var ci = 0; ci < data.cats.length; ci++) {
    ;(function (cat) {
      var on = !!(cur && cur.cat === cat.name)
      var thumbs = []
      var lim = Math.min(cat.items.length, 4)
      for (var ti = 0; ti < lim; ti++) {
        thumbs.push(h('span', { key: 't' + ti, className: 'bga-minibox' },
          h('img', { className: 'bga-mini', src: cat.items[ti].url + '?sz=poster', alt: cat.items[ti].base, loading: 'lazy', decoding: 'async' })))
      }
      for (var pad = lim; pad < 4; pad++) {
        thumbs.push(h('div', { key: 'e' + pad, className: 'bga-emptymini' }, '—'))
      }
      var meta = cat.count
        ? (cat.count + ' 张' + (cat.hd ? ' · ' + cat.hd + ' 张高清' : ''))
        : '空 · 放入图片后点刷新'
      catCards.push(h('button', {
        key: cat.name,
        className: 'bga-card bga-cat' + (on ? ' on' : ''),
        disabled: !cat.count,
        title: (on ? '当前类型 · ' : '') + '打开「' + cat.name + '」图库 (' + cat.count + ' 张)',
        onClick: function () { setView({ page: 'cat', cat: cat.name, hd: 'all' }) },
      },
        h('div', { className: 'bga-cat-thumbs' }, thumbs),
        h('div', { className: 'bga-cat-meta' },
          h('b', null, cat.name),
          h('span', null, meta))))
    })(data.cats[ci])
  }

  // (类型内图库网格已提为模块级 ItemGrid 组件, 用 React.memo 隔离, 见下方定义)

  // ---- 类型内筛选: 全部 / 高清 / 普通 (细分是否高清) ----
  function chipRow(cat) {
    if (!cat.count) return null
    var chips = []
    var opts = [
      { k: 'all', label: '全部', n: cat.count },
      { k: 'hd', label: '高清', n: cat.hd },
      { k: 'plain', label: '普通', n: cat.count - cat.hd },
    ]
    for (var ch = 0; ch < opts.length; ch++) {
      ;(function (o) {
        if (o.n <= 0) return
        var isOn = (view.hd || 'all') === o.k
        chips.push(h('button', {
          key: o.k,
          className: 'bga-chip' + (isOn ? ' on' : ''),
          onClick: function () { setView({ page: 'cat', cat: cat.name, hd: o.k }) },
        }, o.label + ' (' + o.n + ')'))
      })(opts[ch])
    }
    return chips.length ? h('div', { className: 'bga-chips' }, chips) : null
  }

  // ---- 主体: 类型页 或 类型内图库 ----
  var picker
  if (view.page === 'cat' && activeCat) {
    picker = h('div', { key: activeCat.name },
      h('div', { className: 'bga-row', style: { margin: '0 0 10px' } },
        h('button', { className: 'bga-back', onClick: function () { setView({ page: 'cats', cat: '', hd: 'all' }) } }, '← 全部类型'),
        h('span', { className: 'bga-h', style: { margin: '0' } }, activeCat.name + ' · ' + activeCat.count + ' 张' + (activeCat.hd ? ' (' + activeCat.hd + ' 高清)' : ''))),
      chipRow(activeCat),
      h(ItemGrid, {
        items: activeCat.items,
        filter: view.hd || 'all',
        curId: cur ? cur.id : null,
        showNo: activeCat.count > 1,
        mixed: activeCat.count > 1 && activeCat.hd > 0 && activeCat.hd < activeCat.count,
      }))
  } else {
    var body
    if (!ready) {
      body = h('div', { className: 'bga-loading' }, h('span', { className: 'bga-spin' }), '正在加载底图清单…')
    } else if (data.cats.length) {
      body = h('div', { className: 'bga-catgrid' }, catCards)
    } else {
      // 空目录时说清"怎么把图弄回来" —— 图片不进 git（仓库只留清单），新机器用下载按钮或命令行取回。
      body = h('div', { className: 'bga-none', style: { height: 'auto', flexDirection: 'column', gap: '8px', padding: '18px 0' } },
        h('span', null, '底图目录是空的 —— 点上面的「下载底图」从 Release 取回（约 333MB），或在插件目录执行 node tools/fetch-wallpapers.mjs'))
    }
    picker = h('div', { key: 'cats' }, fetchRow, body)
  }

  // 当前底图摘要条 (缩略图加载中显示转圈)
  var curStrip = h('div', { className: 'bga-cur' },
    h('span', { className: 'bga-curbox' + (cur && cur.url ? '' : ' off') },
      cur && cur.url
        ? h('img', { className: 'bga-cur-img', src: cur.url + '?sz=thumb', alt: curLabel(cur), decoding: 'async' })
        : null),
    h('div', { className: 'bga-cur-info' },
      h('b', null, cur ? curLabel(cur) : '未使用底图'),
      h('small', null, cur
        ? (cur.hd ? '高清 · ' : '') + '点击下面任一张图即切换'
        : '当前不使用底图, 点击下面任一张图即可启用')),
    cur ? h('button', { className: 'bga-btn', onClick: function () { STORE.set({ wallpaper: null }) } }, '清除底图') : null)

  var skipTxt = ''
  if (STORE.skipped && STORE.skipped.length) {
    var shown = STORE.skipped.slice(0, 4).join(', ')
    skipTxt = '已忽略 ' + STORE.skipped.length + ' 个不支持文件' + (shown ? ': ' + shown : '') + (STORE.skipped.length > 4 ? ' …' : '')
  }

  var swatches = []
  for (var j = 0; j < PRESETS.length; j++) {
    ;(function (p) {
      swatches.push(h('button', {
        key: p.id,
        className: 'bga-swatch' + (s.preset === p.id ? ' on' : ''),
        onClick: function () { STORE.set({ preset: p.id, accent: p.accent, deep: p.deep }) },
      },
        h('span', { className: 'bga-dots' },
          h('span', { className: 'bga-dot', style: { background: p.accent } }),
          h('span', { className: 'bga-dot', style: { background: p.deep } })),
        p.name))
    })(PRESETS[j])
  }

  var fxOpts = []
  for (var k = 0; k < EFFECTS.length; k++) {
    ;(function (fx) {
      fxOpts.push(h('button', {
        key: fx.id,
        className: 'bga-fxopt' + (s.effect === fx.id ? ' on' : ''),
        onClick: function () { STORE.set({ effect: fx.id }) },
      }, h('b', null, fx.name), h('span', null, fx.hint)))
    })(EFFECTS[k])
  }

  var fociBtns = []
  for (var f = 0; f < FOCI.length; f++) {
    ;(function (fc) {
      fociBtns.push(h('button', {
        key: fc.id,
        className: 'bga-focus' + (s.focus === fc.pos ? ' on' : ''),
        title: '焦点 ' + fc.pos,
        onClick: function () { STORE.set({ focus: fc.pos }) },
      }, h('i', null)))
    })(FOCI[f])
  }

  var dirPathText = (STORE.writableDir ? '放图目录: ' + STORE.writableDir : '目录: ' + (data.dir || '(读取中)'))
    + (data.dir && STORE.writableDir && data.dir !== STORE.writableDir ? '（当前显示: ' + data.dir + '）' : '')

  return h('div', { className: 'bga-page' },
    Section('底图', null,
      h('div', { className: 'bga-row', style: { marginBottom: '10px' } },
        h('span', { className: 'bga-field', title: dirPathText }, dirPathText),
        h('button', { className: 'bga-btn', onClick: refresh }, '刷新'),
        h('span', { className: 'bga-field' }, '类型 ' + data.cats.length + ' 个 · 共 ' + data.total + ' 张' + (totalHd ? ' (' + totalHd + ' 高清)' : '')),
        skipTxt ? h('span', { className: 'bga-field' }, skipTxt) : null,
        loadError ? h('span', { className: 'bga-field' }, loadError) : null),
      h('div', { className: 'bga-fold', style: { marginBottom: '10px' } },
        h('button', {
          type: 'button', className: 'bga-foldbtn',
          'aria-expanded': dirFoldOpen ? 'true' : 'false',
          onClick: function () { setDirFoldOpen(!dirFoldOpen) },
        }, (dirFoldOpen ? '▾ ' : '▸ ') + '文件目录与类型说明'),
        dirFoldOpen ? h('div', { className: 'bga-foldbody' },
          h('p', { className: 'bga-sub', style: { margin: 0 } },
            '底图按类型两级浏览: 一级选类型, 二级选具体底图, 点缩略图即切换。' +
            '类型 = 放图目录下的子文件夹 (如 线稿风 / 重返未来1999); ' +
            '文件名尾部带 高清/_高清/·高清/4K/HD 等标记的会自动归为高清并可用筛选细分。'),
          h('p', { className: 'bga-sub', style: { margin: 0 } },
            '浏览: 点一张类型卡进入它的图库 (类型 = 放图目录里的子文件夹); 图库内可用「全部/高清/普通」筛选。')) : null),
      curStrip,
      picker,
      h('div', { className: 'bga-row', style: { marginTop: '12px' } },
        Slider('暗纱', s.veil, 0, 0.85, function (v) { STORE.set({ veil: v }) }),
        Slider('透光', s.glass, 0, 1, function (v) { STORE.set({ glass: v }) })),
      h('div', { className: 'bga-sub', style: { margin: '14px 0 8px' } }, '范围调整: 焦点决定裁剪时保住的位置; 缩放绕焦点放大'),
      h('div', { className: 'bga-row' },
        h('div', { className: 'bga-foci' }, fociBtns),
        Slider('缩放', s.zoom, 1, 2.2, function (v) { STORE.set({ zoom: v }) }, 'x'))),
    Section('配色', '十套预设快速贴合底图色调; 主色驱动边框光效与卡面染色, 深色驱动暗纱与深色表面。',
      h('div', { className: 'bga-swatches' }, swatches),
      h('div', { className: 'bga-row', style: { marginTop: '12px' } },
        h('label', { className: 'bga-field' }, '主色 ',
          h('input', { type: 'color', value: s.accent, onChange: function (e) { STORE.set({ accent: e.target.value, preset: 'custom' }) } })),
        h('label', { className: 'bga-field' }, '深色 ',
          h('input', { type: 'color', value: s.deep, onChange: function (e) { STORE.set({ deep: e.target.value, preset: 'custom' }) } })))),
    Section('对话框', '琉璃卡面: 半透明 + 可调背景模糊; 特效: 输入框上方的动态装饰 (流萤 / 气泡 / 落樱 / 雨丝)。三者可自由组合。',
      h('div', { className: 'bga-row', style: { marginBottom: '12px' } },
        Slider('卡面不透明', s.cardA, 0, 1, function (v) { STORE.set({ cardA: v }) }),
        Slider('卡面模糊', s.cardBlur, 0, 24, function (v) { STORE.set({ cardBlur: v }) }, 'px')),
      // 阴影独立成一个小开关（原来它拼在特效里，选「关闭」就一起没了）
      h('div', { style: { margin: '0 0 10px' } },
        TinySwitch('卡面阴影（全透明时也能看出输入框边界；与特效开关无关）',
          s.cardShadow !== false, function (v) { STORE.set({ cardShadow: v }) })),
      h('div', { className: 'bga-fxopts' }, fxOpts)),
    WeSection(),
    h('p', { className: 'bga-note' },
      '设置自动保存到 DSH 配置目录 (host 侧 settings.json), 重启后恢复上次选择。底图与特效由 bg-atelier 插件提供, 停用插件即完全还原, 不改动任何底层文件。对话页固定宽度改在「会话策略」插件里设置。'))
}

// ------------------------------------------------------------ WE 壁纸库 ----
// Wallpaper Engine 接入。host 侧 /bga/we/* 路由提供库清单与媒体流;
// 这里三块: WeSection(设置页列表) + WE_LAYER(全屏动效层, 挂 <html>) + WE 配色联动。
// scene 可用桌面原生桥接收 WE 实时画面；静态模式和连接失败时保留静态近似。

var WE_TYPE_LABEL = {
  video: ['视频', '#3b82f6'],
  web: ['网页', '#22c55e'],
  scene: ['场景', '#a855f7'],
  application: ['程序', '#eab308'],
  unknown: ['暂不支持', '#6b7280'],
}

function weMediaUrl(entry, rel) {
  var segs = String(rel).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return '/bga/we/media/' + encodeURIComponent(entry.id) + '/' + segs
}

// scene 类的高清静态图（host 侧解 scene.pkg 合成，见 we/still.js）
function weStillUrl(id) { return '/bga/we/still/' + encodeURIComponent(id) + '.webp' }

// 先铺 192px 的 preview.gif（秒出），同时让 host 去解包出高清静态图，好了再换上去。
// 解包一次约 5s，不值得让用户对着空白等，也不该阻塞请求。
var WE_NOTICES = new Map()
var WE_QUALITY = {
  smooth: { name: '流畅', fps: 60 },
  balanced: { name: '均衡', fps: 45 },
  saver: { name: '省资源', fps: 30 },
}
var WE_STATS = new Map(), WE_STATS_WATCHERS = []
function weStats(id, data) { if (data) WE_STATS.set(id, data); else WE_STATS.delete(id); WE_STATS_WATCHERS.forEach(function (f) { f() }) }
function weNotice(id, message) {
  WE_NOTICES.set(id, message)
  if (WE_NOTICES.size > 256) WE_NOTICES.delete(WE_NOTICES.keys().next().value)
  weNotify()
}

// The companion WE window follows DSH's native content rectangle. WE reads the
// actual cursor itself; this video layer never consumes clicks or keyboard input.
function weStartNative(entry, root) {
  var bridge = window.dshWallpaper, destroyed = false, generation = 0
  var bridgeVisible = !document.hidden
  var stream = null, video = null, token = null, timer = null, stillCleanup = null
  var stopStats = null, placeholder = root.querySelector ? root.querySelector('img') : null
  function stopRun() {
    generation++
    clearTimeout(timer)
    if (stopStats) { stopStats(); stopStats = null }
    if (placeholder) placeholder.style.display = ''
    weStats(entry.id, null)
    var old = token; token = null
    if (stream) { stream.getTracks().forEach(function (t) { t.stop() }); stream = null }
    if (video) { video.remove(); video = null }
    if (old) bridge.stop(old).catch(function () {})
  }
  function fallback(message) {
    stopRun()
    console.error('[bga-live] ' + message)
    weNotice(entry.id, message + '；当前保留静态预览')
    if (!entry.stillReady && !stillCleanup) {
      var img = root.querySelector('img')
      if (img) stillCleanup = weUpgradeToStill(entry.id, img, message + '；')
    }
  }
  async function start() {
    if (destroyed || !bridgeVisible) return
    stopRun()
    var run = generation
    token = 'bga-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    var requested = token
    weNotice(entry.id, '正在连接 WE 原生场景…')
    timer = setTimeout(function () { if (!destroyed && run === generation) fallback('实时连接超时') }, 25000)
    try {
      var ready = await bridge.start(entry.id, requested)
      if (destroyed || run !== generation) { bridge.stop(requested).catch(function () {}); return }
      var quality = WE_QUALITY[STORE.state.weQuality] || WE_QUALITY.balanced
      // Windows window capture here stalls badly when forced to rescale. Keep
      // native pixels and adjust cadence only; mouse alignment remains exact.
      var next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: quality.fps, max: quality.fps }, cursor: 'never' }, audio: false })
      if (destroyed || run !== generation) { next.getTracks().forEach(function (t) { t.stop() }); bridge.stop(requested).catch(function () {}); return }
      stream = next
      video = document.createElement('video')
      video.muted = true; video.autoplay = true; video.playsInline = true
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none'
      video.srcObject = stream
      root.appendChild(video)
      stream.getVideoTracks()[0].addEventListener('ended', function () {
        if (!destroyed && run === generation && bridgeVisible) fallback('WE 实时连接已结束')
      }, { once: true })
      await video.play()
      if (destroyed || run !== generation) return
      clearTimeout(timer)
      if (placeholder) placeholder.style.display = 'none'
      stopStats = weWatchFrames(entry.id, video)
      weNotice(entry.id, 'WE 原生实时场景 · 鼠标跟随 · ' + quality.name + '模式')
    } catch (e) {
      if (!destroyed && run === generation) fallback('实时背景未连接：' + String(e.message || e).slice(0, 180))
    }
  }
  var setVisible = function (visible) {
    if (bridgeVisible === visible) return
    bridgeVisible = visible
    if (!visible) { stopRun(); weNotice(entry.id, '窗口隐藏，实时背景已暂停') }
    else start()
  }
  var visibility = function () { setVisible(!document.hidden) }
  var unwatch = bridge.onVisibility ? bridge.onVisibility(setVisible) : null
  document.addEventListener('visibilitychange', visibility)
  // Start after weShow attaches the fallback image and root to the document.
  timer = setTimeout(start, 0)
  return function () {
    destroyed = true; stopRun()
    document.removeEventListener('visibilitychange', visibility)
    if (unwatch) unwatch()
    if (stillCleanup) stillCleanup()
  }
}
// Count presented frames; update only the small status component, never theme CSS.
function weWatchFrames(id, video) {
  if (!video.requestVideoFrameCallback) return function () {}
  var stopped = false, handle, first = null, frames = 0, previous = null, longest = 0
  function frame(now) {
    if (stopped) return
    if (first === null) first = now
    if (previous !== null) longest = Math.max(longest, now - previous)
    previous = now; frames++
    if (now - first >= 2000) {
      weStats(id, { fps: Math.round((frames - 1) * 10000 / (now - first)) / 10, width: video.videoWidth, height: video.videoHeight, gap: Math.round(longest) })
      frames = 1; first = now; longest = 0
    }
    handle = video.requestVideoFrameCallback(frame)
  }
  handle = video.requestVideoFrameCallback(frame)
  return function () { stopped = true; if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle) }
}
function WeLiveStatus(props) {
  var state = React.useState(0), bump = state[1]
  React.useEffect(function () { var f = function () { bump(function (n) { return n + 1 }) }; WE_STATS_WATCHERS.push(f); return function () { var i = WE_STATS_WATCHERS.indexOf(f); if (i >= 0) WE_STATS_WATCHERS.splice(i, 1) } }, [])
  var s = WE_STATS.get(props.id)
  return h('span', { className: 'bga-note', role: 'status' }, s ? '实时 ' + s.fps + ' 帧/秒 · ' + s.width + ' × ' + s.height + (s.gap > 100 ? ' · 检测到卡顿，可选省资源模式' : '') : '帧率将在播放后显示')
}
function weUpgradeToStill(id, img, prefix) {
  var controller = new AbortController(), timer, disposed = false
  function note(message) {
    WE_NOTICES.set(id, (prefix || '') + message)
    if (WE_NOTICES.size > 256) WE_NOTICES.delete(WE_NOTICES.keys().next().value)
    weNotify()
  }
  async function check(method, count) {
    if (disposed || !img.isConnected) return
    try {
      var response = await fetch('/bga/we/still?id=' + encodeURIComponent(id), { method: method, cache: 'no-store', signal: controller.signal })
      var result = await response.json()
      if (disposed) return
      if (!response.ok || result.state === 'error' || result.state === 'busy') throw new Error(result.error || 'HTTP ' + response.status)
      if (result.state === 'ready') { img.src = weStillUrl(id); note('静态近似图已就绪'); return }
      if (count >= 120) { note('仍在生成，稍后刷新查看；当前保留预览图'); return }
      note(result.state === 'queued' ? '静态图排队中，当前显示预览图' : '正在生成静态近似图…')
      timer = setTimeout(function () { check('GET', count + 1) }, 1500)
    } catch (e) {
      if (!disposed) note('静态图未生成：' + String(e.message || e).slice(0, 180) + '。保留预览图；失败后冷却一分钟再试。')
    }
  }
  // Called after the image is attached; disposal cancels polls, not a shared host job.
  timer = setTimeout(function () { check('POST', 0) }, 0)
  return function () { disposed = true; clearTimeout(timer); controller.abort() }
}

// "0.1 0.6 1" -> [r,g,b] 浮点；非法返回 null (与 host scanner 同规则)
function weParseSchemeColor(s) {
  if (typeof s !== 'string') return null
  var p = s.trim().split(/\s+/).map(Number)
  return p.length >= 3 && p.every(function (n) { return isFinite(n) }) ? [p[0], p[1], p[2]] : null
}

// schemeColor -> 底图工坊的 accent/deep: 主色直接采用, 深色取同色相暗调。
// 走 STORE.set 进现有持久化链路, 用户之后在「配色」区手动改即覆盖。
function weApplySchemeColor(rgbFloat) {
  var rgb = rgbFloat.map(function (x) { return Math.round(Math.max(0, Math.min(1, x)) * 255) })
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255
  var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  var hDeg = 0, sat = 0
  if (max !== min) {
    var d = max - min
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    hDeg = max === r ? (g - b) / d + (g < b ? 6 : 0)
      : max === g ? (b - r) / d + 2
      : (r - g) / d + 4
    hDeg *= 60
  }
  var hx = function (hH, hS, hL) { // HSL(0-360,0-1,0-1) -> #rrggbb
    var f = function (n) {
      var k = (n + hH / 30) % 12
      var a = hS * Math.min(hL, 1 - hL)
      var v = hL - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
      return Math.round(255 * v).toString(16).padStart(2, '0')
    }
    return '#' + f(0) + f(8) + f(4)
  }
  STORE.set({
    accent: hx(hDeg, Math.max(sat, 0.35), 0.62),
    deep: hx(hDeg, Math.min(sat + 0.15, 0.9), 0.10),
    preset: 'custom',
  })
}

// ---- 全屏动效层 (video / web / scene 三态) ----
// **必须 append 到 documentElement, 不能挂 body**: DSH 应用根节点带 transform/filter 类属性时
// 自成 stacking context, body 子树里的负 z-index 会被钳在它自己的背景之后。挂 html 上则与底图的
// body::before(-1) 同属根层叠上下文: 本层 -2 < -1, 观感 = 动效垫在暗纱与界面之下。
//
// 「应用了动效」必须连带两件事, 否则画面不动（实机踩过的两个坑）:
//   ① 有底图时 dynamicCss 不再画底图 —— body::before(-1) 会盖死动效层(-2);
//   ② 主题 token 把应用外框调成半透明 —— 没底图时 .frame 用 DSH 默认不透明底色,
//      半透明的 --dsw-alias-bg-base 只在有底图时才下发。
// 这两件事都发生在重建样式时, 所以用 WE_WATCHERS 把 apply() 里的 rebuildStyle/rebuildTokens 接进来。
var WE_LAYER = { root: null, cleanup: null }
var WE_WATCHERS = []

function weActive() { return !!WE_LAYER.root }

function weNotify() {
  for (var i = 0; i < WE_WATCHERS.length; i++) {
    try { WE_WATCHERS[i]() } catch (e) { /* noop */ }
  }
}

function weDispose() {
  if (!WE_LAYER.root) return
  try { if (WE_LAYER.cleanup) WE_LAYER.cleanup() } catch (e) { /* noop */ }
  WE_LAYER.cleanup = null
  WE_LAYER.root.remove()
  WE_LAYER.root = null
  weNotify()
}

function weShow(entry) {
  weDispose()
  var root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = 'position:fixed;inset:0;z-index:-2;pointer-events:none;overflow:hidden'
  WE_LAYER.root = root

  if (entry.type === 'video' && /\.(mp4|webm)$/i.test(entry.file || '')) {
    var v = document.createElement('video')
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
    v.src = weMediaUrl(entry, entry.file)
    root.appendChild(v)
    var play = function () { v.play().catch(function () { /* 自动播放策略拦截时静默 */ }) }
    v.addEventListener('canplay', play, { once: true })
    var onVis = function () { if (document.hidden) v.pause(); else play() }
    document.addEventListener('visibilitychange', onVis)
    WE_LAYER.cleanup = function () {
      document.removeEventListener('visibilitychange', onVis)
      v.pause(); v.removeAttribute('src'); v.load()
    }
  } else if (entry.type === 'web' && /\.html?$/i.test(entry.file || '')) {
    var f = document.createElement('iframe')
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none'
    f.setAttribute('sandbox', 'allow-scripts')
    f.src = weMediaUrl(entry, entry.file)
    root.appendChild(f)
    WE_LAYER.cleanup = function () { f.src = 'about:blank' }
  } else if (entry.type === 'scene') {
    // The host reports unsupported unpacked projects explicitly; selection
    // never changes manual colors, including when generation fails.
    // 高清静态图优先（host 已解包好），否则先 gif 再后台升级
    var still = entry.stillReady ? weStillUrl(entry.id) : null
    var src = still || (entry.previewRel ? weMediaUrl(entry, entry.previewRel) : null)
    var img = document.createElement('img')
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
    if (src) img.src = src
    root.appendChild(img)
    if (STORE.state.weMode !== 'still' && window.dshWallpaper) WE_LAYER.cleanup = weStartNative(entry, root)
    else {
      if (!still) WE_LAYER.cleanup = weUpgradeToStill(entry.id, img)
      if (STORE.state.weMode !== 'still') weNotice(entry.id, '原生桥尚未加载，当前为静态近似；安装桥后需重启 DSH')
    }
  } else if (entry.previewRel) {
    var img2 = document.createElement('img')
    img2.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
    img2.src = weMediaUrl(entry, entry.previewRel)
    root.appendChild(img2)
  }
  document.documentElement.appendChild(root)
  weNotify()
}

// 启动时把上次用的 WE 底图接回来 (STORE.state.weId 是唯一落盘的东西)。
function weRestore() {
  if (weActive()) return
  var id = STORE.state.weId
  if (!id) return
  fetch('/bga/we/library.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {} })
    .then(function (d) {
      var hit = (d.entries || []).filter(function (e) { return e.id === id })[0]
      if (hit && STORE.state.weId === id && !weActive()) weShow(hit)
    })
    .catch(function () { /* host 路由没就绪: 下次启动再说 */ })
}

function weColorHex(value) {
  var rgb = String(value || '').trim().split(/\s+/).map(Number)
  return '#' + [0, 1, 2].map(function (i) { return Math.round(Math.max(0, Math.min(1, rgb[i] || 0)) * 255).toString(16).padStart(2, '0') }).join('')
}
function WeProperties(props) {
  var pair = React.useState({ fields: [], values: {}, presets: [], loading: true, busy: false, error: '', dirty: false, note: '' })
  var state = pair[0], set = pair[1], alive = React.useRef(false), request = React.useRef(0), dirty = React.useRef(false)
  var applied = React.useRef(null), working = React.useRef(false)
  var presetPair = React.useState(''), preset = presetPair[0], setPreset = presetPair[1]
  var namePair = React.useState(''), name = namePair[0], setName = namePair[1]
  var bridge = window.dshWallpaper
  function accept(result, note) { applied.current = result; dirty.current = false; set({ fields: result.fields, values: result.values, presets: result.presets, loading: false, busy: false, error: '', dirty: false, note: note || '' }) }
  function read() {
    if (working.current || dirty.current) return
    if (!bridge || !bridge.properties) { set(function (s) { return Object.assign({}, s, { loading: false, error: '桌面桥更新后，完全退出并重启 DSH 才能加载属性面板。' }) }); return }
    var seq = ++request.current
    bridge.properties(props.id).then(function (r) { if (alive.current && seq === request.current && !dirty.current) accept(r) })
      .catch(function (e) { if (alive.current && seq === request.current) set(function (s) { return Object.assign({}, s, { loading: false, error: String(e.message || e) }) }) })
  }
  React.useEffect(function () {
    alive.current = true; read()
    var onReady = function () { if (!dirty.current && String(WE_NOTICES.get(props.id)).indexOf('WE 原生实时场景') === 0) read() }
    WE_WATCHERS.push(onReady)
    return function () { alive.current = false; request.current++; var i = WE_WATCHERS.indexOf(onReady); if (i >= 0) WE_WATCHERS.splice(i, 1) }
  }, [props.id])
  function change(key, value) {
    request.current++
    set(function (s) {
      var values = Object.assign({}, s.values); values[key] = value
      var baseline = applied.current ? applied.current.values : {}
      dirty.current = Object.keys(values).some(function (k) { return values[k] !== baseline[k] })
      return Object.assign({}, s, { values: values, dirty: dirty.current, note: '' })
    })
  }
  function discard() {
    if (!working.current && applied.current) { request.current++; accept(applied.current, '已放弃未应用的更改') }
  }
  async function action(kind) {
    if (!bridge || !bridge.properties || working.current) return
    working.current = true
    var seq = ++request.current; set(function (s) { return Object.assign({}, s, { busy: true, error: '', note: '' }) })
    try {
      if (kind === 'save' && state.dirty) await bridge.properties(props.id, 'apply', state.values)
      var result = await bridge.properties(props.id, kind, kind === 'apply' ? state.values : undefined, kind === 'save' ? name.trim() : preset)
      if (alive.current && seq === request.current) { accept(result, kind === 'save' ? '预设已保存' : kind === 'reset' ? '已恢复默认值' : '已应用到 DSH 背景'); if (kind === 'save') setPreset(name.trim()) }
    } catch (e) { if (alive.current && seq === request.current) set(function (s) { return Object.assign({}, s, { busy: false, error: String(e.message || e) }) }) }
    finally { working.current = false }
  }
  function field(p) {
    var value = state.values[p.key], input
    if (p.type === 'bool') input = h('input', { type: 'checkbox', checked: !!value, 'aria-label': p.text, onChange: function (e) { change(p.key, e.target.checked) } })
    else if (p.type === 'slider') input = h('div', { className: 'bga-we-range' },
      h('input', { type: 'range', min: p.min, max: p.max, step: p.step, value: value == null ? p.min : value, 'aria-label': p.text, onChange: function (e) { change(p.key, Number(e.target.value)) } }),
      h('input', { type: 'number', min: p.min, max: p.max, step: p.step, value: value == null ? '' : value, 'aria-label': p.text + '数值', onChange: function (e) { var v = Number(e.target.value); if (Number.isFinite(v)) change(p.key, Math.max(p.min, Math.min(p.max, v))) } }))
    else if (p.type === 'color') input = h('input', { type: 'color', value: weColorHex(value), 'aria-label': p.text, onChange: function (e) { var hex = e.target.value; change(p.key, [1, 3, 5].map(function (i) { return (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5) }).join(' ')) } })
    else if (p.type === 'combo') input = h('select', { value: String(value), 'aria-label': p.text, onChange: function (e) { var option = p.options.find(function (o) { return String(o.value) === e.target.value }); if (option) change(p.key, option.value) } }, p.options.map(function (o) { return h('option', { key: String(o.value), value: String(o.value) }, o.label) }))
    else if (p.type === 'textinput') input = h('input', { type: 'text', maxLength: 200, value: value || '', 'aria-label': p.text, onChange: function (e) { change(p.key, e.target.value) } })
    else input = h('span', { className: 'bga-note' }, p.note)
    return h('div', { key: p.key, className: 'bga-we-field' }, h('span', null, p.text), input)
  }
  var groups = []
  state.fields.forEach(function (p) { var g = groups.find(function (x) { return x.name === p.group }); if (!g) { g = { name: p.group, fields: [] }; groups.push(g) } g.fields.push(p) })
  return h('section', { className: 'bga-we-properties', 'aria-label': '场景属性' },
    h('div', { className: 'bga-row' }, h('strong', null, '场景属性'), h('span', { className: 'bga-note' }, state.dirty ? '有未应用的更改' : state.note || '仅控制 DSH 中的壁纸')),
    state.loading ? h('p', { className: 'bga-note' }, '正在读取场景属性…') : null,
    state.error ? h('div', { role: 'alert', className: 'bga-note' }, state.error, h('button', { type: 'button', className: 'bga-btn', disabled: state.busy || state.dirty, onClick: read }, '重新读取')) : null,
    state.fields.length ? h('fieldset', { disabled: state.busy, style: { border: 0, padding: 0, margin: 0 } },
      h('div', { className: 'bga-row bga-we-actions' },
        h('button', { type: 'button', className: 'bga-btn', disabled: !state.dirty, onClick: function () { action('apply') } }, state.busy ? '处理中…' : '应用到此背景'),
        h('button', { type: 'button', className: 'bga-btn', disabled: !state.dirty, onClick: discard }, '放弃修改'),
        h('button', { type: 'button', className: 'bga-btn', onClick: function () { action('reset') } }, '恢复默认')),
      groups.map(function (g, i) { return h('details', { key: g.name, className: 'bga-we-group', open: i === 0 }, h('summary', null, g.name, h('span', { className: 'bga-note' }, ' · ' + g.fields.length + ' 项')), g.fields.map(field)) }),
      h('p', { className: 'bga-note' }, '调整后点击应用。拖动滑块不会反复重启场景。音量默认静音；自定义图片等文件选项仍需在 WE 设置。'),

      h('div', { className: 'bga-we-presets' }, h('strong', null, '我的预设'),
        h('div', { className: 'bga-row' }, h('input', { type: 'text', placeholder: '例如：安静办公', maxLength: 40, value: name, 'aria-label': '预设名称', onChange: function (e) { setName(e.target.value) } }), h('button', { type: 'button', className: 'bga-btn', disabled: !name.trim(), onClick: function () { action('save') } }, '保存当前设置')),
        h('div', { className: 'bga-row' }, h('select', { value: preset, 'aria-label': '已保存预设', onChange: function (e) { setPreset(e.target.value) } }, h('option', { value: '' }, '选择预设'), state.presets.map(function (s) { return h('option', { key: s, value: s }, s) })), h('button', { type: 'button', className: 'bga-btn', disabled: !preset, onClick: function () { action('load') } }, '加载')))) : null)
}

// ---- WE library: data loading, selection and independently rendered cards ----
function weFilterLibrary(entries, query, type) {
  var needle = String(query || '').trim().toLocaleLowerCase()
  return entries.filter(function (entry) {
    return (type === 'all' || entry.type === type) && (!needle ||
      [entry.title, entry.id].concat(entry.tags || []).join(' ').toLocaleLowerCase().indexOf(needle) >= 0)
  })
}

function WeLibraryCard(props) {
  var entry = props.entry, label = WE_TYPE_LABEL[entry.type] || WE_TYPE_LABEL.unknown
  var pair = React.useState({ busy: false, note: '', error: false }), state = pair[0], set = pair[1]
  var pending = React.useRef(null), mounted = React.useRef(false)
  React.useEffect(function () {
    mounted.current = true
    return function () { mounted.current = false; if (pending.current) pending.current.abort() }
  }, [])
  async function open() {
    if (pending.current) return
    var controller = new AbortController(); pending.current = controller
    set({ busy: true, note: '', error: false })
    try {
      var response = await fetch('/bga/we/open-in-we?id=' + encodeURIComponent(entry.id), { method: 'POST', cache: 'no-store', signal: controller.signal })
      var result = await response.json()
      if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status)
      if (mounted.current) set({ busy: false, note: result.message || (result.targeted ? '已发送到 WE' : 'WE 已启动，请再点一次'), error: false })
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) set({ busy: false, note: String(e.message || e), error: true })
    } finally { if (pending.current === controller) pending.current = null }
  }
  return h('article', { className: 'bga-card bga-we-card' + (props.selected ? ' on' : '') },
    h('button', { type: 'button', className: 'bga-we-pick', 'aria-pressed': props.selected, 'aria-label': '应用背景：' + entry.title, title: entry.title, onClick: function () { props.onSelect(entry) } },
      entry.previewRel ? h('img', { className: 'bga-thumb', style: { height: '86px' }, alt: '', loading: 'lazy', decoding: 'async', src: weMediaUrl(entry, entry.previewRel), onError: function (e) { e.target.style.visibility = 'hidden' } }) : h('div', { className: 'bga-emptymini' }, '无封面'),
      h('span', { className: 'bga-we-card-title' }, entry.title),
      h('span', { className: 'bga-we-card-meta' }, label[0], ' · ', entry.source === 'local' ? '本地项目' : '订阅', props.selected ? ' · 使用中' : '')),
    h('div', { className: 'bga-we-card-actions' },
      ['scene', 'video', 'web'].includes(entry.type) ? h('button', { type: 'button', className: 'bga-btn', disabled: state.busy, onClick: open }, state.busy ? '打开中…' : '在 WE 打开') : null,
      weParseSchemeColor(entry.schemeColor) ? h('button', { type: 'button', className: 'bga-btn', title: '保存为手动配色，清除背景后仍保留', onClick: function () { weApplySchemeColor(weParseSchemeColor(entry.schemeColor)) } }, '采用壁纸配色') : null),
    state.note ? h('p', { className: 'bga-note', role: state.error ? 'alert' : 'status' }, state.note) : null)
}

function WePlaybackControls(props) {
  if (props.entry.type !== 'scene' || STORE.state.weMode === 'still') return null
  return h('div', { className: 'bga-we-controls' },
    h('div', { className: 'bga-row' }, h('strong', null, '播放质量'),
      h('select', { className: 'bga-btn', 'aria-label': '实时播放质量', value: STORE.state.weQuality || 'balanced', onChange: function (e) { props.onQuality(e.target.value) } },
        Object.keys(WE_QUALITY).map(function (key) { var quality = WE_QUALITY[key]; return h('option', { key: key, value: key }, quality.name + ' · ' + quality.fps + ' 帧目标') })),
      h(WeLiveStatus, { id: props.entry.id })),
    h('p', { className: 'bga-note' }, '目标帧率不等于实际帧率；复杂壁纸可关闭部分自定义动效。'),
    h(WeProperties, { key: props.entry.id, id: props.entry.id }))
}

function WeSection() {
  var stPair = React.useState({ loading: true, entries: [], weFound: false, bridge: null, error: '' })
  var st = stPair[0], setState = stPair[1], active = React.useRef(false)
  var requests = React.useRef({ library: null, status: null })
  var selPair = React.useState(STORE.state.weId || null), selId = selPair[0], setSelId = selPair[1]
  var searchPair = React.useState(''), query = searchPair[0], setQuery = searchPair[1]
  var typePair = React.useState('all'), type = typePair[0], setType = typePair[1]
  function patch(values) { if (active.current) setState(function (previous) { return Object.assign({}, previous, values) }) }
  // Independent status/library requests cannot overwrite each other or a newer refresh.
  async function load(kind, force) {
    if (requests.current[kind]) requests.current[kind].abort()
    var controller = new AbortController(); requests.current[kind] = controller
    if (kind === 'library') patch({ loading: true, error: '' })
    try {
      var response = await fetch('/bga/we/' + (kind === 'library' ? 'library.json' : 'status') + (force ? '?force=1' : ''), { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      var result = await response.json()
      if (controller.signal.aborted) return
      patch(kind === 'library' ? { loading: false, entries: result.entries || [], weFound: !!result.weFound, error: '' } : { bridge: result.bridge })
    } catch (e) {
      if (!controller.signal.aborted) patch(kind === 'library' ? { loading: false, error: '扫描失败：' + String(e.message || e) } : { bridge: { running: null } })
    }
  }
  function refresh(force) { load('status', force); load('library', force) }
  React.useEffect(function () {
    active.current = true; refresh(false)
    var update = function () { patch({}); setSelId(STORE.state.weId || null) }
    WE_WATCHERS.push(update)
    return function () {
      active.current = false
      Object.keys(requests.current).forEach(function (key) { if (requests.current[key]) requests.current[key].abort() })
      var i = WE_WATCHERS.indexOf(update); if (i >= 0) WE_WATCHERS.splice(i, 1)
    }
  }, [])
  function applyEntry(entry) {
    STORE.set({ weId: entry.id }); setSelId(entry.id); weShow(entry)
  }
  function clearWe() { STORE.set({ weId: null }); setSelId(null); weDispose() }
  var selected = st.entries.find(function (entry) { return entry.id === selId })
  function setMode(mode) {
    if (mode === STORE.state.weMode) return
    STORE.set({ weMode: mode }); if (selected) weShow(selected); patch({})
  }
  function setQuality(value) {
    if (!WE_QUALITY[value] || value === STORE.state.weQuality) return
    STORE.set({ weQuality: value }); if (selected) weShow(selected); patch({})
  }
  var visible = weFilterLibrary(st.entries, query, type)
  return Section('Wallpaper Engine 库', '读取本机订阅与本地项目。实时场景由 WE 渲染，保留鼠标视差。',
    h('div', { className: 'bga-row' },
      h('span', { className: 'bga-note', role: 'status' }, st.loading ? '正在扫描 WE 库…' : st.weFound ? '本地库共 ' + st.entries.length + ' 张' : '未找到 Wallpaper Engine'),
      h('span', { className: 'bga-chip', style: { background: st.bridge && st.bridge.running === true ? '#166534' : '#374151' } }, st.bridge == null ? 'WE 状态检测中' : st.bridge.running === true ? 'WE 已运行' : st.bridge.running === false ? 'WE 未运行' : 'WE 进程状态未知'),
      h('button', { type: 'button', className: 'bga-btn', disabled: st.loading, onClick: function () { refresh(true) } }, '刷新')),
    st.error ? h('p', { className: 'bga-note', role: 'alert' }, st.error) : null,
    selId ? h('div', { className: 'bga-we-current' },
      h('strong', null, '当前背景：' + (selected ? selected.title : '已保存的壁纸')),
      h('div', { className: 'bga-row' },
        selected && selected.type === 'scene' ? h('button', { type: 'button', className: 'bga-btn', 'aria-pressed': STORE.state.weMode !== 'still', onClick: function () { setMode('live') } }, '实时动效') : null,
        selected && selected.type === 'scene' ? h('button', { type: 'button', className: 'bga-btn', 'aria-pressed': STORE.state.weMode === 'still', onClick: function () { setMode('still') } }, '静态近似') : null,
        selected && selected.type === 'scene' && STORE.state.weMode !== 'still' ? h('button', { type: 'button', className: 'bga-btn', onClick: function () { weShow(selected) } }, '重新连接') : null,
        h('button', { type: 'button', className: 'bga-btn', onClick: clearWe }, '清除 WE 背景')),
      selected && selected.type === 'scene' ? h('p', { className: 'bga-note', role: 'status' }, STORE.state.weMode === 'still' ? '当前使用静态近似图' : WE_NOTICES.get(selId) || '正在连接实时背景…') : null) : null,
    st.entries.length ? h('div', { className: 'bga-we-toolbar' },
      h('input', { type: 'search', value: query, placeholder: '搜索名称、标签或编号', 'aria-label': '搜索壁纸', onChange: function (e) { setQuery(e.target.value) } }),
      h('select', { value: type, 'aria-label': '壁纸类型', onChange: function (e) { setType(e.target.value) } },
        h('option', { value: 'all' }, '全部类型'), ['scene', 'video', 'web'].map(function (key) { return h('option', { key: key, value: key }, WE_TYPE_LABEL[key][0]) })),
      h('span', { className: 'bga-note', role: 'status' }, visible.length + ' / ' + st.entries.length),
      query || type !== 'all' ? h('button', { type: 'button', className: 'bga-btn', onClick: function () { setQuery(''); setType('all') } }, '清空筛选') : null) : null,
    visible.length ? h('div', { className: 'bga-grid bga-we-library' }, visible.map(function (entry) { return h(WeLibraryCard, { key: entry.id, entry: entry, selected: entry.id === selId, onSelect: applyEntry }) })) :
      !st.loading ? h('p', { className: 'bga-note bga-we-empty' }, st.entries.length ? '没有匹配的壁纸，试试其他名称或类型。' : '暂无壁纸。添加 WE 订阅或本地项目后点击刷新。') : null,
    selected ? h(WePlaybackControls, { entry: selected, onQuality: setQuality }) : null)
}


// -------------------------------------------------------------------- 入口 --

var inject = ['slots', 'theme']

function apply(ctx) {
    var theme = ctx.get('theme')
    var slots = ctx.get('slots')

    // 静态样式表可重建（disposeStatic / rebuildStatic / syncCanvasWidth 都在**模块作用域**，
    // 因为模块级的 DockFx 也要调 syncCanvasWidth —— 见那边的注释）。
    ctx.effect(function () {
      rebuildStatic()
      return function () { if (disposeStatic) { disposeStatic(); disposeStatic = null } }
    }, 'bga-static')

    // 窗口尺寸变化时重新量画布（200ms 去抖；syncCanvasWidth 自己带 24px 闸门）
    ctx.effect(function () {
      if (typeof window === 'undefined' || !window.addEventListener) return
      var onResize = function () {
        if (canvasTimer) clearTimeout(canvasTimer)
        canvasTimer = setTimeout(function () { canvasTimer = 0; syncCanvasWidth() }, 200)
      }
      window.addEventListener('resize', onResize)
      syncCanvasWidth()
      return function () {
        window.removeEventListener('resize', onResize)
        if (canvasTimer) { clearTimeout(canvasTimer); canvasTimer = 0 }
      }
    }, 'bga-canvas-width')

    var disposeDyn = null
    function rebuildStyle() {
      if (disposeDyn) disposeDyn()
      disposeDyn = styles.insert(dynamicCss(STORE.state))
    }
    ctx.effect(function () {
      rebuildStyle()
      return function () { if (disposeDyn) disposeDyn() }
    }, 'bga-dynamic')

    var disposeTokens = null
    function rebuildTokens() {
      if (theme === undefined) return
      if (disposeTokens) { disposeTokens(); disposeTokens = null }
      // 没有底图时也要下发: WE 动效层同样需要外框半透明才看得见 (见 WE_LAYER 注释)
      var tokens = (STORE.state.wallpaper || weActive()) ? buildTokens(STORE.state) : {}
      disposeTokens = theme.overrideTokens('bg-atelier', tokens)
    }
    ctx.effect(function () {
      rebuildTokens()
      return function () { if (disposeTokens) disposeTokens() }
    }, 'bga-tokens')

    ctx.effect(function () {
      return STORE.subscribe(function () { rebuildStyle(); rebuildTokens() })
    }, 'bga-watch')

    // WE 动效层的出现/消失要重建动态样式与 token (为什么: 见 WE_LAYER 上方的注释)
    ctx.effect(function () {
      var previousActive = weActive()
      var fn = function () { var active = weActive(); if (active === previousActive) return; previousActive = active; rebuildStyle(); rebuildTokens() }
      WE_WATCHERS.push(fn)
      return function () { var i = WE_WATCHERS.indexOf(fn); if (i >= 0) WE_WATCHERS.splice(i, 1) }
    }, 'bga-we-watch')

    if (slots !== undefined) {
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'bga', order: 60, label: '底图工坊' },
          function () { return h(SettingsPage) })
      })
      slots.inject('conversation.composer.dock', function () {
        return slots.register(
          { name: 'conversation.composer.dock', id: 'bga-flies', order: -10 },
          function () { return h(DockFx) })
      })
      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'bga-orb', order: 0, label: '底图工坊 · 换下一张底图' },
          function () { return h(Orb) })
      })
      // WE 动效层不需要 slot: 它没有 UI, 直接 append 到 <html> (见上面 WE_LAYER 注释)。
    }

    // 动效层的生命周期 = 插件生命周期。挂 ctx.effect 而不是 slot 空组件: 组件卸载必跑 cleanup,
    // 那样"离开会话页"这类正常装卸就会顺手把底图拆掉, 层的存活不该由页面装卸决定。
    ctx.effect(function () { return function () { weDispose() } }, 'bga-we-layer')

    console.log('[dsh-bg-atelier] client up')

    // 恢复上次应用过的 WE 动效底图: 必须等 weId 从 settings.json 拉回来, 所以接在 load 后面。
    STORE.load().then(function () { weRestore() })
  }

  exports.apply = apply
  exports.inject = inject
  // 测试缝（与 dsh-cache-control 同套路）：tools/ 下的离线脚本用它驱动
  // "数量随画布宽度"、"卡面阴影独立开关"与 DockFx 真渲染。
  exports.internals = {
    STORE: STORE,
    weShow: weShow, weDispose: weDispose, weStartNative: weStartNative, weApplySchemeColor: weApplySchemeColor, WeSection: WeSection, WeProperties: WeProperties, weFilterLibrary: weFilterLibrary, weMediaUrl: weMediaUrl,
    staticCss: staticCss,
    dynamicCss: function () { return dynamicCss(STORE.state) },
    DockFx: DockFx,
    canvasWidth: function () { return CANVAS_W },
    setCanvasWidth: function (w) { CANVAS_W = Math.max(120, Math.round(Number(w) || 985)); regenerateParticles() },
    counts: function () {
      return { fly: countFor('fly'), star: countFor('star'), bub: countFor('bub'), petal: countFor('petal'), rain: countFor('rain') }
    },
    density: function () { return DENSITY },
  }
  return module.exports
  }
})
