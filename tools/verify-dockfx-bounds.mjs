// 底图工坊 · dock 特效画布越界检查（开发用，不进 npm 包）
//
// 为什么需要它：2026-09-12 修的「对话区底部横向滚动条频闪」，根因就是 .bga-fly 用
// left% + translate 漂移时飘出画布右缘，把 [data-conversation-scroll] 的 scrollWidth
// 顶大。修法有两半：画布 overflow:clip（兜底）+ 按位置选漂移方向（保证观感不切边）。
// 这个脚本只校验后半条 —— 纯算术、不需要浏览器：
//   对每一只萤，算出动画行程的两个极值，检查它在**整条 640–3840px 宽度区间**里
//   都不越出画布 [0, band]。
//
// 用法： node tools/verify-dockfx-bounds.mjs
// 退出码 0 = 全部在界内；1 = 有越界（说明有人改了 FLY/漂移参数，得同时收一收行程）。

// ---- 与 client.js 逐字一致的三处 ----
function prand(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
var WANDERS_R = ['bga-wander1', 'bga-wander2']                    // 0 → +260 / +190
var WANDERS_L = ['bga-wander1L', 'bga-wander2L', 'bga-wander3']   // 0 → -260 / -190 / -170
// 每条漂移动画的最大位移（100% 关键帧处的 translateX）
var EXTREME = { 'bga-wander1': 260, 'bga-wander2': 190, 'bga-wander3': -170, 'bga-wander1L': -260, 'bga-wander2L': -190 }
var FLY_N = 18

// 与 flyRules() 同样的确定性生成（left/bottom/size/dur/delay/pool 选择全部照抄）
function flies() {
  var out = []
  for (var i = 0; i < FLY_N; i++) {
    var leftN = 1 + prand(i + 1) * 97
    out.push({
      i: i + 1,
      leftPct: leftN,
      size: 3 + Math.round(prand(i + 61) * 4) * 0.5,
      anim: (leftN >= 50 ? WANDERS_L : WANDERS_R)[i % (leftN >= 50 ? WANDERS_L : WANDERS_R).length],
    })
  }
  return out
}

// --dsh-composer-card-max-width = chatWidth + 32（dsh-cache-control 钉的）
var WIDTHS = []
WIDTHS.push(640, 860, 900, 940, 1180, 1280, 1600, 1920, 2560, 3840)

var bad = [], tightest = { margin: Infinity }
for (var w = 0; w < WIDTHS.length; w++) {
  var band = WIDTHS[w] + 32
  var list = flies()
  for (var f = 0; f < list.length; f++) {
    var fl = list[f]
    var leftPx = fl.leftPct / 100 * band
    var d = EXTREME[fl.anim]
    // 动画两端：0 与最远处；reverse 只是把两端对调，极值集合不变
    var xs = [leftPx, leftPx + d]
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs) + fl.size
    if (lo < 0 || hi > band) bad.push({ chatWidth: WIDTHS[w], band: band, fly: fl.i, anim: fl.anim, lo: +lo.toFixed(1), hi: +hi.toFixed(1) })
    var margin = Math.min(lo, band - hi)
    if (margin < tightest.margin) tightest = { margin: +margin.toFixed(1), chatWidth: WIDTHS[w], band: band, fly: fl.i, anim: fl.anim }
  }
}

var pools = flies().map(function (f) { return f.leftPct >= 50 ? 'L' : 'R' })
var lCount = pools.filter(function (p) { return p === 'L' }).length
console.log('[dockfx] 萤 ' + FLY_N + ' 只：左半区(向右漂) ' + (FLY_N - lCount) + ' 只 / 右半区(向左漂) ' + lCount + ' 只')
console.log('[dockfx] 画布宽度扫描 ' + WIDTHS.length + ' 档 (640–3840px 会话列宽 ⇒ 672–3872px 画布)')
console.log('[dockfx] 最紧的一处余量：' + tightest.margin + 'px（chatWidth=' + tightest.chatWidth + ' f' + tightest.fly + ' ' + tightest.anim + '）')
if (bad.length) {
  console.error('FAIL 越界 ' + bad.length + ' 处，前 10：')
  console.error(bad.slice(0, 10))
  process.exit(1)
}
console.log('PASS 所有萤的行程都在画布内 —— clip 只是兜底，正常情况不会切到任何粒子')
