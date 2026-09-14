# dsh-bg-atelier · 底图工坊 (DSH 标准插件)

为 DSH Desktop 提供**可更换底图**与**输入框特效**的标准 DSH 插件。
随 DSH 启动**自动加载**，重启后保留（设置持久化到 host 侧文件 `$DSH_HOME\dsh-bg-atelier\settings.json`）。

**安装后即随启动加载**：本版是打包进 DSH `web` profile 的标准插件，开机即生效、可在 设置 → 插件 里开启/关闭。

## 目录结构

```
dsh-bg-atelier/
├── index.js          # Host 半端 (ESM): 分类型供图路由 + /bga/wallpapers.json 清单路由
├── client.js         # Client 半端: 类型→图库两级浏览 / 随机换图 / 琉璃卡面 / 特效 / 设置页
├── cordis.patch.yml  # bundle 挂载声明 (让 DSH 启动时挂载本插件)
├── package.json      # npm 插件清单 (dsh.bundle.patch + dsh.client 客户端声明)
├── wallpapers/       # 内置底图目录 —— 每个子文件夹 = 一个"底图类型"（**原始文件**，PNG/JPG 原样，无损）
│   ├── 线稿风/          # 例如: 亚丝娜.png / 青缭.png / …
│   └── 重返未来1999/    # 例如: Vertin.png / 梁月.png / …
├── INSTALL.md        # 安装 / 升级 / 卸载指南
└── README.md
```

## 安装（首次）

在 DSH Desktop 的任意会话里让 agent 执行（或直接在宿主 shell 运行）：

```powershell
dsh plugin --profile web add link:D:\DeepSeek\dsh-plugins\dsh-desktop-wallpaper
```

装完后**重启一次 Harness/DSH Desktop**，插件即随启动自动加载。
设置页顶栏会多出 **底图工坊** 入口；侧边栏底部出现「流光宝珠」换图按钮。

> 发布到仓库后（推荐）改为从仓库安装：
> `dsh plugin --profile web add https://github.com/Raylen-berry/dsh-desktop-wallpaper#main`

## 放入/更换底图（按类型）

**开箱即用**：插件内置 **4 个类型共 39 张底图**（二次元 2 / 线稿风 5 / 重返未来1999 12 / 高清 20）。
clone 完先在插件目录跑一次 `node tools/fetch-wallpapers.mjs`（或设置页点「**下载底图**」）把图取回来，再重启 DSH；
设置 → 底图工坊 → 点类型卡进入图库即可选。**图片不进 git**（v1.5.5 起改走 Release 资产，见下面 A 节），
所以 clone 只有代码、很快；`wallpapers/` 里是**原始文件**（无损，约 820 MB，口径见 A 节）。

**加一个新类型/新图**：把图片放进「放图目录」下**一个子文件夹 = 一个类型**，例如：

```powershell
$wp = "D:\DeepSeek\dsh-plugins\dsh-desktop-wallpaper\wallpapers"   # 或下面的放图目录
New-Item -ItemType Directory -Force "$wp\重返未来1999"
Copy-Item C:\some\*.png "$wp\重返未来1999\"
```

host 每次实时解析、按需刷新，设置页点「刷新」即出现新类型/新图（无需重启）。

放图目录解析顺序（首个**有图**的目录命中，① 最高）：

1. `$env:DSH_BG_ATELIER_WALLPAPERS` 指向的绝对目录（显式覆盖）
2. `$DSH_HOME\dsh-bg-atelier\wallpapers`（**推荐**，插件启动时自动建好，随时往里丢图）
3. 插件包内置 `wallpapers/`（随包分发，当作默认图集）
4. 工作区相对路径 `dsh-plugins/dsh-desktop-wallpaper/wallpapers`（旧动态版兼容）

> 根目录若有散图（旧版遗留）会自动归入「未分类」类型；旧版根目录 URL 仍可访问（host 会自动按文件名在类型里找回），升级不丢当前底图。

### 高清细分

文件名去掉扩展名后，**尾部**带这些标记的会自动打上「高清」并可在类型图库内用 `全部 / 高清 / 普通` 筛选：
`高清`、`_高清`、`·高清`、`-高清`、`（高清）`、`_4K`、`·4K`、`_HD`、`(HD)`、`_UHD` 等（英文标记需要前置分隔符，避免误伤正常英文名）。
显示名 = 去掉标记后的名字（如 `亚丝娜_高清.png` 显示为 `亚丝娜` + `高清` 角标），**不会把编号写进显示名**。

## 功能

- **两级底图浏览**：设置 → 底图工坊 → 一级页列出**底图类型**（子文件夹），点类型卡进入二级页**图库**，
  缩略图即点即换；每张带 `№编号` 角标（按文件名自然序在类型内编号，仅用于指认，不改显示名）。
  图库主图走 **640px 派生图**（v1.4.0 起，见下），类型卡迷你图走 112px 派生图；原图只在点击选中后作为底图加载；
  派生图与清单加载中均显示**转圈加载动画**；网格做了 `React.memo` 隔离，图片多时拖动滑杆也不卡。
- **高清细分**：类型内若有高清/普清混合，提供 `全部 / 高清 / 普通` 筛选条。
- **随机换图（流光宝珠）**：跨**所有类型的全部图**随机，采用**轮次式 2/3 不重复**洗牌 ——
  每轮随机抽取 `ceil(2/3 × 总数)` 张排成序列逐张播放，同轮内绝不重复（至少播完约 2/3 后才可能出现重复）；
  一轮放完"放回"、再从总体随机取 2/3 开新一轮；新增/删除图片后自动重洗。
- **图片适应**：cover 裁剪 + 九宫格焦点 + 绕焦点缩放（1–2.2×）。
- **配色**：10 套预设（樱粉/青碧/琥珀/星紫/薄荷/绛红/雾蓝/薰衣草/蜜桃/墨黑）+ 主色/深色自定义。
- **对话框琉璃卡面**：半透明 + `backdrop-filter` 背景模糊，英雄页/会话页同时生效。
- **对话框特效**（输入框上方那条 dock，v1.5.0 起 8 种 + 关闭）：**流萤**（18 只萤 + 14 颗星 + 2 道流星）/
  **气泡**（16 个 7–22px 大气泡 + 底部水面辉光）/ **光带扫过** / **星轨环绕** / **浮尘光斑** /
  **落樱** / **墨韵涟漪** / **雨丝**（v1.5.0 新增六个，见下）。**极光**已于 v1.4.2 按用户要求删除
  （盘上存过 `aurora` 的由 `normalizeEffect` 自动归回流萤，不需要重设）。
  全部纯 CSS 动画（无 JS 定时器），粒子位置按序号**确定性**生成；**不碰消息气泡**
  （气泡样式归 dsh-cache-control，两边同时改会互相盖）。
- **特效画布不得产生横向滚动溢出**（v1.4.2 的硬约束）：`.bga-dockfx-in` 必须是 `overflow:clip`，
  粒子的漂移行程也必须留在画布内。原因见「版本 · v1.4.2」——飘出画布右缘的萤点会把
  `[data-conversation-scroll]` 的 scrollWidth 顶大，会话区底部那条横向滚动条就会一直频闪。
- **滑杆**：暗纱 / 透光 / 卡面不透明 / 卡面模糊 / 缩放。
- 设置持久化到 host 侧文件 `$DSH_HOME\dsh-bg-atelier\settings.json`，重启 DSH 后保留上次选择。

> **v1.3.0 起不再提供「对话页固定宽度」**：那一节（开关 + 640–3840px 滑杆 + 常用宽度快捷键）
> 已整体移到 **dsh-cache-control** 的设置页 **「会话策略」→ ④ 对话页**。钉的是同一组
> `--dsh-chat-content-width / --dsh-composer-card-max-width / --dsh-chat-user-width`
> 变量，两边同时开只会互相覆盖，所以本插件这边彻底删净。数值不用重设：cache-control 的
> host 半在启动时发现自家 `settings.json` 缺 `chatWidth / chatWidthEnabled`，就一次性从
> `$DSH_HOME\dsh-bg-atelier\settings.json` 搬过去并写盘。本插件此后不再碰这些字段。

## 换台机器：可迁移性与**必须手动的步骤**

> 给后续在任何一台机器上接手的人或 agent：**装本插件不需要任何手工点击**（不像
> `dsh-browser-live` 要装浏览器扩展），但下面几条必须先看清楚。
> （起因：用户 2026-09-12 反馈"工作电脑上传、回家发现可用性很差、必须手动操作"。）

**A. 克隆体积（v1.5.5 起：图不进 git，改为 Release 资产 + 按需下载）**
39 张底图合计约 **820 MB**，长期放在 git 里会让每次克隆都变成几百 MB（用户换机时"装个插件要拉几百兆"就是这么来的）。
仓库只留 `wallpapers.manifest.json`（每张图的路径 + 字节数 + sha256），图片作为 Release 资产发布（tag `wallpapers-v1`）：

```powershell
git clone https://github.com/Raylen-berry/dsh-desktop-wallpaper.git   # 只有代码，很快
cd dsh-desktop-wallpaper && node tools/fetch-wallpapers.mjs            # 从 Release 取回 39 张（可重入/断点续传）
node tools/fetch-wallpapers.mjs --check                               # 只校验本机现有图（不联网）
```

**画质口径：完全无损 —— 不缩放、不重编码。** Release 资产就是原始文件（PNG / JPG 原样），逐张 sha256 与清单一致。
下载量确实大（820 MB），这是有意换来的：底图是长期资产，宁可下载慢，也不要在存档上留一次有损编码。

**显示这一侧现在也不打折（v1.6.1 起）**：host 供图**不设尺寸上限**，把原图**字节**直接送给浏览器 ——
5120 / 7680 长边的超宽屏、8K 屏全都吃满，不会再被 3840 拉成放大模糊（此前 `SERVED_MAX_DIM = 3840`
会先在宿主里缩到 3840 再送）。代价是浏览器要解码整张 30–44 MP 的图：单张解码后约 120–175 MB 内存、
切图首帧多等几百毫秒 —— 换的是大屏上的清晰度；而且送原图这条路上 `sharp` 完全不参与，
省掉了一次「解码 + 重编码」的 CPU 与首字节等待。派生图（图库 640 / 当前底图 320 / 类型卡 112 px）
另走一套，不受影响。真要一份轻量版：`node tools/compress-wallpapers.mjs` 可另生成一套 3840 宽 WebP q92
到 `wallpapers_light/`（**仅供自用，不参与发版**）。

回归测试（**不用重启 DSH**）：`node tools/test-served-bytes.mjs` —— 用假 `ctx` 调 `apply()` 把路由处理器抓出来
直接请求，断言原图那条路逐字节等于磁盘文件、`?sz=thumb|preview|poster` 仍在缩放、404 与路径穿越防护仍在。

设置页里同一个入口是「**下载底图**」按钮（显示进度、逐张校验 sha256；已存在且校验通过的跳过 ⇒ 断网了再点一次即可）。

> **下载的健壮性参数**（`fetch-wallpapers.js` 的 `fetchWallpapers(opts)`，host 路由与命令行共用这一份）
> - `timeoutMs`：**单张**的时间预算，默认 **300000（5 分钟）**。超时按"这一张失败"处理并走既有退避重试，
>   不会让任务永远停在"下载中"。覆盖方式：`fetchWallpapers({ timeoutMs: 60000 })`。
>   默认值的依据：清单里最大一张是 63283616 B（60.4MB），5 分钟意味着 ~1.7 Mbps 的慢线也能下完，
>   而正常家用宽带（20 Mbps 以上）一张只要几秒 —— 既不误杀慢线，也不让真卡死的连接赖着不走。
> - `retries`：单张重试次数（不含首次尝试），默认 **2**，必须是**非负整数**（非法值回落 2）。
>   `retries: 0` 表示**只试一次**，真的不重试。
> - `signal`：外部 `AbortSignal`。触发后**立即停止且不再重试**，错误消息会写明"已取消"。
> - 下载是**流式**的：边收边写 `.part`、边累计 sha256，字节数一超过清单值就立刻中止 ——
>   不会把整张图先读进内存（最大 60.4MB）再校验。校验通过才 `rename` 到最终路径。
>
> 这些行为的离线断言：`node tools/test-download-robustness.mjs`（**不联网**，把 `fetch` 打桩、
> 写入临时目录，覆盖超时/取消/字节数不符/哈希不符/正常落盘，共 42 条断言）。

> **加图/改图必须用追加式清单生成器**：`tools/make-wallpaper-manifest.mjs` 是**从零重编号**的，
> 一改名或加图就会让既有 `wNN` 与 Release 里已上传的资产整体错位（`贝利尔.png`→`贝利尔2.png` 就撞过
> w08/w16），make-release 会因为"同名资产字节数不符"把已传的删掉重传。发版一律走
> `node tools/make-manifest-append.mjs`（默认拿 HEAD 那份清单作基准，按 sha256 把已发布的图绑回原资产名，
> 只给新图续编 `w20`、`w21`…），再 `node tools/make-release.mjs` 补传差额。

> **迁移顺序（重要）**：先把图作为 Release 资产发布并验证下载可用，**再**把 `wallpapers/` 从 git 移除；
> 反了的话，新克隆在 Release 就绪前一张图都拿不到。图片从 git 移除之前，`git sparse-checkout add wallpapers`
> 仍可按需从 git 取图（离线机器适用）。

**B. 装（agent 可全自动）**

```powershell
dsh plugin --profile web add link:<你放插件的绝对路径>
```
`link:` 挂载 ⇒ 改完即生效。**装完必须重启 DSH Desktop**：client 半在服务启动时 compose
（与 dsh-cache-control 同理，刷新页面无效）。重启会掐断正在跑的会话轮次 ⇒ 让用户自己挑时间。

**C. 底图在哪 / 设置在哪**
- **底图**在插件目录自己的 `wallpapers/<类型>/` 下（**原始文件、不进 git** ⇒ 换机后先按 A 节从 Release 取回）；
  往里加图后派生图（640px 图库图 / 112px 类型卡迷你图）会自动生成。
- **设置**（当前底图 / 特效 / 配色 / 卡面不透明度与模糊 / **卡面阴影开关**）在
  `$DSH_HOME/dsh-bg-atelier/settings.json`，**不在仓库里** ⇒ 换机器后是默认值：
  特效回到「流萤」、卡面阴影为开、**底图要重新选一张** —— 这是最常见的"装好了但看着没变"。
- 特效与底图**已解耦**（v1.5.1 起）：没有底图也照样画特效。若在老版本上遇到
  "点了清除底图 ⇒ 特效全无"，那是 v1.5.0 及以前的旧 bug，升级即可。

**D. 已知的宿主坑：插件会被 generation 迁移搬走（本机踩过）**
部分 DSH Desktop 版本启动时做 `installGeneration` 迁移，会把 `link:` 挂载的插件重新 stage，
期间把一个**绝对路径当相对路径拼接** ⇒ `ENOENT`、迁移被 defer，插件也可能不加载。
本机的处置是给应用 bundle 打本地补丁（把本插件加进 `KEEP_IN_SHARED_TREE`）——**该补丁不在本仓库里**，
它属于"每台机器各自的 DSH 应用目录"。识别方法：启动日志出现 `migration deferred` / `could not stage`，
或 `profiles/web/.generations-deferred.json` 反复出现。DSH **每次升级都会覆盖该补丁**，升级后要重跑。

**F. 设置导出/导入（换机器一键搬配置，v1.5.4 新增）**

```powershell
node tools/settings.mjs export --out D:\bga-settings.json   # 旧机器
node tools/settings.mjs import D:\bga-settings.json --yes   # 新机器（覆盖前自动备份 settings.json.bak-*）
```
`show` 看当前值；不带 `--yes` 是演练模式（只打印将要写入什么）。导入只做**表层校验 + 区间钳制**
（本插件 host 是原样存取、不 sanitize，所以钳制在这儿做严）；底图结构不合法时置空并提示，
底图**图片**不在导出文件里（脚本会检查本机有没有这张图，缺了就提示去 `git sparse-checkout add wallpapers`）。
导入后仍需重启。

**E. 换机后自查（30 秒）**

```powershell
node tools/extract-real-css.mjs      # 期望 PASS（含数量随屏宽 / 阴影独立开关 / DockFx 真渲染三条）
node tools/verify-dockfx-bounds.mjs  # 期望 PASS
```
设置页 →「底图工坊」→「对话框」应看到：卡面不透明、卡面模糊、**卡面阴影勾选框**、
四个特效（流萤 / 气泡 / 落樱 / 雨丝）+ 关闭。

## 卸载

```powershell
dsh plugin --profile web remove dsh-bg-atelier
```

或在 设置 → 插件 里停用/移除该插件后重启 Harness。

## 技术要点 (debug 备忘)

- Client 用 `window.__ModuleLoader__.load({ id, factory })` 包裹，`exports.apply`/`exports.inject`。
- 底图清单走 `/bga/wallpapers.json` HTTP 路由（返回 `{ total, categories:[{name,count,hd,items}] }`），不再用运行时-only 的 `host.call` 桥。
- 供图 URL：`/bga/wallpapers/<编码类型名>/<编码文件名>`（旧格式 `/bga/wallpapers/<文件名>` 仍兼容，自动按文件名在类型里找回）。
  调试可直接访问：`/bga/wallpapers/%E7%BA%BF%E7%A8%BF%E9%A3%8E/%E4%BA%9A%E4%B8%9D%E5%A8%9C.png`（含路径穿越防护，`..`/多余斜杠返回 400）。
- 样式自包含注入（`data-bg-atelier-styles`），不依赖 `styles` 全局。
- `webServer` prefix 路由匹配规则 `pathname === prefix || startsWith(prefix + '/')`，注册路径不带尾斜杠。
- Host 日志 `[dsh-bg-atelier]`（harness 控制台），Client 日志在浏览器 DevTools。

## 版本

- v1.6.2：**下载健壮性**（`fetch-wallpapers.js`，host 路由与命令行共用这一份）
  - `retries` 判定从 `opts.retries || 2` 改成 `Number.isInteger(x) && x >= 0 ? x : 2`：原先传 `retries: 0`（意图"不重试"）
    会被 `0 || 2` 变成 2，实际仍重试两次 —— 现在零次重试真的生效，非法值（负数/小数/非数）回落 2。
  - 新增单张时间预算 `timeoutMs`（默认 **300000**，见上文）：超时算一次失败、走既有退避重试，不再让任务长期停在"下载中"。
    新增外部取消 `opts.signal`：触发后立即停且**不重试**，错误消息标明"已取消"，不会误报成"重试耗尽"。
  - 改为**流式下载 + 边下边算 sha256**：`res.body` 异步迭代，字节数一超过清单值立刻中止，不再 `arrayBuffer()` 整张读进内存
    （最大一张 60.4MB）；校验通过才把 `.part` `rename` 成最终文件，失败则清掉 `.part`。失败分类：HTTP / 字节数不符 / sha256 不符 / 超时 / 已取消。
  - 验证：新增离线断言 `tools/test-download-robustness.mjs`（42 条，把 `fetch` 打桩、写临时目录，**不联网**）。
    同一条断言集在**改动前**的 `fetch-wallpapers.js` 上跑：**28 通过 / 14 失败**；改动后 **42 / 42 通过**。
    其中"字节数超长立即中止"那条最直观：服务端发 12.5MB，改动前**消费 100.0%（全读完）**，改动后只消费 **19.2%（2.5MB）** 就中止。
    既有工具回归：`test-served-bytes.mjs`、`verify-dockfx-bounds.mjs` 全通过；`fetch-wallpapers.mjs --check` 报"全部 39 张都在且校验通过"。

- v1.6.1：**供图不再限 3840 —— 超宽屏直接吃原图**
  - `SERVED_MAX_DIM` 3840 → **0（不设上限）**：真正使用时那条路直接把原文件**字节**送出去 —— 不缩放、不重编码，
    `sharp` 完全不参与（省掉一次「解码 + 重编码」的 CPU 与首字节等待）。5120 / 7680 长边的超宽屏不再被放大糊。
  - 送原图那条路**不进内存缓存**：`servedBufferCache` 是个无界 Map，39 张合计 **820 MB**（高清那 20 张占 764 MB），
    全缓存住就等于让一个换底图插件常驻 820 MB 内存 —— 而它省下的只是 OS 页缓存本来就兜住了的读盘。缩略图那条路照旧缓存。
    （**更正**：此条原先写「约 1.5 GB」，那是把 40–60 MB 套到全部 39 张上的口算错误。真实最坏情况是 39 张字节之和
    **820 MB**；而旧代码缓存的是缩到 3840 之后的字节，实测约占原体积 25% ⇒ 最坏约 **247 MB**。两者都不是 1.5 GB。）
  - 代价（如实记）：浏览器要解码整张图 —— 30–44 MP 单张解码后约 120–175 MB 内存，切图首帧慢几百毫秒。
  - 验证：新增 `tools/test-served-bytes.mjs`（假 `ctx` 调 `apply()` 抓路由处理器直接请求，不用重启 DSH）。
    实测原图路：楪祈 27.45 MB / 小瑞安侬 53.88 MB / 梁月 4.38 MB，**sha256 与磁盘文件逐张相同**；
    `?sz=thumb|preview|poster` 仍在缩放；不存在的图 404、路径穿越 400。
  - ⚠️ 两件事要知道：① 生效要**重启 DSH Desktop**（改的是 Host 半）；② 浏览器对同一个 URL 的旧 3840 图
    可能还缓存着（host 给原图 `max-age=3600`，客户端拼 URL 时不带缓存破坏参数）⇒ 重启后先 **Ctrl+Shift+R** 硬刷一次。
- v1.6.0：**补齐此前漏发的 20 张底图（共 39 张，全部无损原图）**
  - 补齐 **20 张从没发过 Release 的图**（9/12 的梁月 / 无名者 / 小瑞安侬 / 哑谜1 / 哑谜2 与 9/13 的
    贝丽尔1 / 贝丽尔3 / 贝丽尔4 / 惠姑 / Vertin，各含普通 + 高清两份）—— 在此之前清单里有的图远端没有，
    别的机器点「下载底图」会恰好在这 20 张上 404。
  - **画质口径定死为无损**：Release 资产一律是原始文件，不缩放、不重编码。已发布的 `w01`–`w19` 逐张按
    sha256 核对确认与本地原图字节相同 ⇒ 只补传了新增的 20 张（487 MB），tag 续用 `wallpapers-v1`。
    （一度做过 3840 宽 WebP q92 的有损版并发成 `wallpapers-v2`，已按"要无损"的要求连同该 Release 与 tag 一起删除。）
  - `贝利尔.png` 已改名 `贝利尔2.png`（4x 版同步改名），清单里的路径跟着更新。
  - 新增 **`tools/make-manifest-append.mjs`**：追加式清单生成器 —— 按 sha256 把已发布的图绑回原资产名，
    只给新图续编编号。直接用 `make-wallpaper-manifest.mjs` 是从零重编号，会把已上传的资产全部冲掉。
  - 另留 **`tools/compress-wallpapers.mjs`**：想省下载量的人可自行生成一套 3840 宽 WebP q92 到 `wallpapers_light/`，
    **仅供自用、不参与发版**。
- v1.5.4：**粒子数量随画布宽度走（密度不再随屏宽变）+ 卡面阴影独立成开关**
  - **数量适配屏宽**（用户 2026-09-12："如果你限定数量，在我小屏显示的时候，密度就会很大，
    你现在需要全改数量为适配屏宽的类型了"）。做法：每个特效定义一个**间距**（px/颗），
    数量 = `round(画布宽 / 间距)` 再夹上下限，间距按"本机画布 985px 下当时定过的数量"折算 ——
    大屏观感与以前完全一致，小屏按比例减少：
    流萤 54.7px/只、星 70.4、气泡 70.4、落樱 70.4、雨丝 22.4。
    实测（`tools/extract-real-css.mjs` 用测试缝驱动真函数）：
    `985px ⇒ 萤18 星14 气泡14 落樱14 雨丝44`；`400px ⇒ 7/6/6/6/18`；`1600px ⇒ 29/23/23/23/71`；
    **雨丝间距在 400–1600px 全区间恒为 22.2–22.5 px/条** ⇒ 密度不随屏宽变（120px 触下限、4000px 触上限）。
  - 实现要点：规则数组改为可重建（`regenerateParticles()`），`STATIC_CSS` 由常量改成
    **函数 `staticCss()`**（每次重建都重读数组，DOM 节点数也跟着 `XXX_RULES.length` 变）；
    画布实宽由 `DockFx` 每次渲染后与 `window.resize`（200ms 去抖）量取，
    **变化超过 24px 才重建样式表**（拖窗口边缘不会一帧重建一次）；
    重渲染走新增的 `STORE.touch()` —— **只通知、不写盘**（画布宽度是运行时事实，不该落到 settings.json）。
  - **卡面阴影独立开关**（用户："关闭特效时会把对话框阴影也关了，这个还是新开一个开关（不要太大）控制阴影吧"）：
    原来阴影拼在 `effectCss` 的特效分支里，选「关闭」就一起没了。现在拆成
    `cardShadow`（只管那两道深色阴影）/ `effect`（只管主色辉光），**合成一条 `box-shadow`** 写出
    （两条同选择器规则是互相覆盖、不是叠加，必须一次拼好），设置页「对话框」里多一行小勾选框
    （`.bga-tiny`，13px 原生 checkbox，符合"不要太大"）。
    实测：特效关闭 + 阴影开 ⇒ 阴影仍在；阴影关 + 雨丝开 ⇒ 雨丝辉光仍在、阴影没了。
  - 另：模块新增 `exports.internals` 测试缝（与 dsh-cache-control 同套路），上面两组数字都由
    `tools/extract-real-css.mjs` 驱动真函数量出来的，不是手算的。
- v1.5.3：**雨丝加密提速 + 落樱/雨丝改等分格子 + 气泡修"停车待发"**
  - 落樱与雨丝的横向位置从纯 `prand` 抽样改成 **`spread()` 等分格子 + 格内抖动**：
    均匀分布 ≠ 看起来均匀，样本一少必然成团（用户两次反馈"局部密度过大"）。
    实测相邻间距：雨丝 0.7–3.4（均值 2.1，最大仅 1.6 倍；改前是均值 4 倍）。
  - 雨丝：条数 30 → 44、落速 1.5–2.6s → **0.85–1.5s**、延迟改负（切换即满屏，不再逐条起跑）。
  - 气泡：16 → 14；**修「刚切换时气泡停在底部等发车」**——真因是正延迟 0–7s 期间 `.bga-bub`
    没写 `opacity:0`，气泡带着边框实心停在那儿；改成负延迟 + 补 `opacity:0` 双保险。
- v1.5.2：**定稿四种 + 卡面可辨识化 + 落樱/雨丝调参**（全部按用户 2026-09-12 逐条要求）
  - **只留 落樱 / 气泡 / 流萤 / 雨丝**，删掉 **光带扫过 / 星轨环绕 / 浮尘光斑 / 墨韵涟漪**：
    选项、`EFFECT_IDS`、`effectCss` 分支、`DockFx` 分支、STATIC_CSS 规则与关键帧、`dustRules()` 全部删净
    （盘上存过这四个 id 的由白名单自动归到**流萤**）。`tools/extract-real-css.mjs` 增了**反向断言**：
    这四个 id 若再出现在 EFFECTS 或代码分支里，直接 FAIL。
  - **卡面可辨识化**（用户："有时因为全透明看壁纸，确实分不清对话框"）：把墨韵涟漪那条
    `0 0 30px var(--bga-deep-glow)`（alpha .5）**削浓度后拆成两道**，拼在四条特效各自的主色辉光之前 ——
    `0 1px 2px var(--bga-card-edge)`（接触阴影，.34，负责把边勾出来）
    + `0 10px 28px var(--bga-card-shade)`（环境阴影，.30，负责把卡面从底图上托起来）。
    两个变量由 `dynamicCss` 按当前配色写入 `:root`（与有没有底图无关）。
  - **落樱**（用户："数量少了些许、体型有点大 ⇒ 缩小叶子、加点数量，注意不是密度"）：
    叶子 **7–12px → 5–8px**（面积约降到 45%）、数量 **9 → 14**。数量 +56% 而单叶面积 −55%，
    所以观感是"叶子多了、不是变密了"。
  - **雨丝**（用户："粗细刚好、数量太少，像空调外机滴水中头奖 ⇒ 加点密度"）：
    只加条数 **12 → 30**，跨度不变、粗细仍 1px、落速与长度区间不动 ⇒ 同期在落的雨丝约 2.5 倍。
  - 验证（越界余量按会话列宽 640–3840 全区间算）：
    `extract-real-css.mjs` **PASS**（EFFECTS 5 项 / 关键帧 16 定义 14 引用自洽 /
    流萤 18·星 14·气泡 16·落樱 14·雨丝 30 全部 0 越界，最紧余量 18–48px）；
    `verify-dockfx-bounds.mjs` **PASS**。预览页 `tools/effect-candidates.html` 同步：
    改成真底图背景 + 顶部加了「卡面无阴影 vs 有阴影」对比条，并把落樱/雨丝按新参数重画。
- v1.5.1：**堵掉「底图一被清掉、8 种特效一起无声消失」这个陷阱**（用户 2026-09-12 实测反馈）
  - 症状：设置页里点了「清除底图」之后特效全部不见（连底图背景也没了）。
    定位：`$DSH_HOME/dsh-bg-atelier/settings.json` 里 `wallpaper` 变成 `null`，
    而 `DockFx` 与 `dynamicCss` 当时都拿 `s.wallpaper` 当前置条件 ⇒ **特效与底图被绑死在一条判断里**。
  - **修法一（解耦）**：`DockFx` 不再要求有底图（只剩 `s.effect === 'off'`），
    `dynamicCss` 里的 `effectCss(...)` 也移出 `if (s.wallpaper)` 块 ——
    特效画在输入框上方那条画布上、配色来自 `:root` 上**无条件**写入的 `--bga-accent`，
    跟有没有底图本来就无关。卡面染色（`glassCardCss`）仍然只在有底图时才加。
  - **修法二（写盘闸）**：新增模块级 `stateLoaded`，**没成功读到过设置就拒绝写盘**
    （`save()` 开头直接 return），并且只认"至少对上过一个认识的字段"的响应
    （拿到 `{}` / 路由还没就绪都算没读到）。少了这道闸，一个设置还没拉回来的客户端
    随手点一下任何开关，就会把自己那套默认值整份 PUT 覆盖掉真实配置 ——
    dsh-cache-control 早就有这道闸（它的 `loaded`），本插件一直缺。
  - 两处都只动 `client.js` 与版本号，**需要重启才生效**；被清成 null 的 `wallpaper`
    是数据不是代码，得重新选一张底图（本次已由我按原值写回「线稿风 / 月薔薇（ヒトこもる）」）。
- v1.5.0：**对话框特效从 2 种扩到 8 种**（按用户要求：6 个候选全做成设置页可点选项，逐个切着挑）
  - 新增 **光带扫过 / 星轨环绕 / 浮尘光斑 / 落樱 / 墨韵涟漪 / 雨丝**，规则同样由 `prand(i)` 确定性生成
    （`dustRules(7) / petalRules(9) / rainRules(12)`），DOM 由 `DockFx` 按 `s.effect` 建节点，
    卡面辉光在 `effectCss` 里各给一档（一律比流萤轻 —— 这几条是"安静"取向，辉光抢戏就违背选它的理由）。
  - **星轨环绕踩到的坑（实机抓的，别再改回去）**：`offset-path: ellipse(38% 26px at 50% 62%)` 里的百分比
    是按**元素自己的 border box**（4px 火花）解析的，不是按画布 ⇒ rx ≈ 1.5px，
    三颗火花只在画布最左边上下抖、根本不成轨道。改成
    `ellipse(calc(var(--dsh-composer-card-max-width,748px) * .38) 26px at calc(... * .5) 56px)`
    之后实测横向行程 **712px**（原来约 3px），仍留 110px 左边距、0 越界。
  - 验证：`tools/extract-real-css.mjs`（把 client.js 当模块跑起来抽真样式表 + 关键帧双向核对 +
    按真规则算粒子越界，**PASS**）与 `tools/effects-live-check.html`（真样式表 + 真类名在真浏览器里量
    行程与可见性：8 个特效全部 `moved` 满额、opacity 区间非零、除"流星起点 / 气泡水面"这两处
    设计上就超出画布的，其余 0 越界）。
  - 两个 dev 脚本都在 `tools/`，**不在 npm 包的 `files` 白名单里**，不会随包分发。
- v1.4.2：**修「对话区底部那条左右滑动的滑块一直频闪」+ 按用户要求删掉极光**
  - **根因（真浏览器实量，不是推断）**：`.bga-dockfx-in` 原来是 `overflow:visible`，而粒子/流星
    都是 `left% + translate` 漂移 —— 飘到画布右缘之外的萤点（`bga-wander1` 最远 +260px）把外层
    `[data-conversation-scroll]`（`overflow:auto`）的 **scrollWidth 顶大**。实测：
    scrollWidth 在 **1139 ↔ 1209** 之间反复变、横向滚动条高度 **0 ↔ 8px** 反复出现
    ⇒ 会话区底部那条横向滚动条滑块一直在闪（30ms 采样 2.5s 抓到 2 次通断）。
    逐元素定位抓到的越界元素稳定是 **`.bga-fly.f13` 等萤点**（`overflow-x` 溢出 1–4px 起，随漂移增大）。
    **不是 dsh-cache-control（会话策略）的问题**：那边只写 `--dsh-chat-*` 宽度变量，不产出任何绝对定位粒子。
  - **修法**：① `.bga-dockfx-in` 改 **`overflow:clip`**（不生成滚动容器、不顶大祖先 scrollWidth，
    画布本身 `height:0` 也不影响纵向布局）；② `flyRules()` 改成**按位置选漂移方向**
    —— 左半区的萤只向右漂、右半区只向左漂（新增镜像关键帧 `bga-wander1L/2L`），
    可见行程因此全落在画布内，不会被 clip 硬切；③ `bga-meteor2` 起点 `right:-6%` → `right:0`。
  - **修后实测**（把新规则注入真页面量 6s）：scrollWidth **恒为 1139**、横向滚动条**恒为 0**、
    通断 **0 次**，且 **18 只萤没有一只越出画布**（最右 1245px < 画布右缘 1316px）⇒ 观感不变。
  - **删掉极光**：三团光雾同样靠 `translateX` 漂移出画布（同样有频闪嫌疑），观感也和琉璃卡面辉光重复。
    同时删掉 `@keyframes bga-cardbreath`、`bga-aurora1/2/3`、`.bga-aur/a1/a2/a3`、
    `effectCss` 的 aurora 分支、`DockFx` 的 aurora 分支、设置页「对话框」说明里的「极光」字样。
  - 候选特效留档：`tools/effect-candidates.html`（6 个纯 CSS 候选并排预览，只在开发时看，不进 npm 包）。
- v1.4.1：**特效按反馈收敛（撤声波、气泡加重、流萤加密）**
  - 撤掉 **声波**：一排音柱在输入框上跳动，看着像进度条，和对话场景不搭。盘上存过 `wave` 的
    由 `normalizeEffect` 白名单自动归回 **流萤**，不需要重设。
  - **流萤加密度**：10 只萤 / 6 颗星 → **18 只 / 14 颗星**，第二道反向流星（`bga-meteor2`），
    萤点辉光 `9px 2px` → `12px 3px`、星级辉光 `5px 1px` → `7px 1.5px`。
    粒子规则改由 `flyRules()/starRules()/bubRules()` 按序号生成，位置/时长/延迟取自 `prand(i)`
    （对同一 `i` 永远同一值）——这里绝对不能用 `Math.random`：换配色、换壁纸都会重建整张
    静态样式表，随机数会让萤点每帧乱跳位。
  - **气泡加重**：8 个 5–11px → **16 个 7–22px**；描边 `1px` → `2px`（写 1.5px 在 DPR1 下被
    舍回 1px，实测计算样式就是 1px，等于白写）；新增外辉 + 内阴影高光；升起 74px → 92px、
    周期 9s → 5.2–10.2s 更快更活跃；底部铺一层"水面"辉光带让气泡有出处；
    卡面辉光由单层 `0 0 18px .14` 改为双层 `0 0 26px .22 + 0 0 64px .1`。
  - 验证：`03-调试临时\verify-bga-trim.mjs` 16 项（含"三种特效、无声波"、"无 `bga-eq`/`EQ_BARS` 残留"、
    "密度 18/14/16"）；`03-调试临时\smoke-bg-poster.mjs` 12 项（派生图链路复跑未回归）。
    另外在真 Chrome 里量 `03-调试临时\bga-fx-sample.mjs` 生成的样张计算样式，实测
    `fly=18 star=14 bub=16 eq=0`、气泡尺寸 9–20px、样式表里已无 `.bga-eq` 规则。
- v1.4.0：**图库看得更清 + 对话框特效扩到四种**
  - 设置页**图库主图**由 48px 占位图换成 **640px 派生图**（webp q86，实测每张 17–45 KB、生成 54–321 ms），
    类型卡**迷你图**由 48px 提到 **112px**（q80）。派生图落盘在
    `$DSH_HOME\dsh-bg-atelier\{previews,posters}\`，只生成一次；源文件改动（大小/mtime 变化）后
    key 变化、旧图自动失效重生成，不用手工清缓存。
  - **新增图自动生成派生图**：插件启动后延时后台补齐缺失的派生图；每次设置页打开/刷新
    （`/bga/wallpapers.json`）之后再 debounce 补一次 —— 新丢进放图目录的图不用等第一次点开就缩好。
  - **对话框特效从 1 种扩到 4 种**：流萤（原样）/ 极光（三团光雾漂移 + 卡面呼吸辉光）/
    气泡（底部升起、到顶消散）/ 声波（14 根错拍音柱）。全部画在输入框上方那条 dock 画布上，
    纯 CSS 动画（无 JS 定时器），且**不碰消息气泡**（气泡样式归 dsh-cache-control）。
  - 目录改名：`dsh-plugins/bg-atelier` → `dsh-plugins/dsh-desktop-wallpaper`（与 GitHub 仓库名一致）。
    包名仍是 `dsh-bg-atelier`，安装/升级命令不变；已装 link 的 profile 需要把
    `profiles/web/package.json` 里的 link 路径一并改掉（见安装一节）。
- v1.3.1：与 **dsh-browser-live** 叠列模式协同 —— 宝珠只提供被动 CSS 变量
  `--bga-orb-dx` / `--bga-orb-dy`（平移让位、不改布局盒），几何一律由 browser-live 单点写入，
  避免两边各自周期测量互相打架；新增壁纸类型「重返未来1999」及「高清」两张。
- **v1.3.2（2026-09-11 修）**：宝珠从"拟球"变成**圆角方块**。根因不在本插件 ——
  DSH 主题自带一条全局规则
  `@supports (corner-shape:superellipse(1.5)){:root{--dsw-corner-shape:superellipse(1.5)}*,:before,:after{corner-shape:var(--dsw-corner-shape)}}`，
  即给**所有元素**设了方圆角（`superellipse(1.5)`，新版 Chromium 支持 corner-shape 后开始生效）；
  凡是 `border-radius:50%` 的"真圆"都会被画成方圆块。宿主自己的圆形控件都显式写了
  `corner-shape:round` 做豁免，本插件此前没写，于是只有宝珠中招（🌐 那个按钮的底是
  `background:transparent`，看到的是 emoji 字形，所以它照样圆）。
  已给本插件所有真圆补上 `corner-shape:round`：宝珠、色点、焦点点、转圈、缩略图上的
  `::before` 转圈、流萤/星光/气泡/极光/水面等特效粒子。旧内核不认这条属性会自动忽略，无副作用。
  排查用的对照实验：同一页面渲染 `round / superellipse(1.5) / superellipse(2) / superellipse(4)`
  四种 `border-radius:50%` 方块，长得和你截图里那颗"圆角矩形"一致的是 `superellipse(1.5)`。
- v1.3.0：**职责收敛** —— 「对话页固定宽度」整节（开关、640–3840px 滑杆、常用宽度快捷键、
  钉 `--dsh-chat-*` 三个变量的实现与补写观察器）移交 **dsh-cache-control**（设置页「会话策略」④ 对话页），
  客户端状态里不再有 `chatWidth` / `chatWidthEnabled`，`dynamicCss` 也不再输出 `:root{--dsh-chat-user-width…}`
  兜底；本插件只剩底图 / 配色 / 卡面 / 特效。旧值由那边启动时一次性搬走，用户无需重设。
- v1.2.0：底图工坊性能与体验 —— 图库只加载缩略图（host 缩略图改强缓存、原图点选后才加载）、
  图库网格 `React.memo` 隔离 + 加载转圈动画；对话页宽度上限提到 **3840px** 并加快捷按钮，
  滑杆拖动改为局部即时预览、松手才保存（不再逐格重渲染）。
- v1.1.0：底图按**类型子文件夹**组织，设置页改为 **类型页 → 类型内图库** 两级浏览；类型内支持
  **高清/普通筛选**（文件名高清标记自动识别）+ `№编号` 角标；换图宝珠改为跨全部类型的
  **2/3 不重复轮次洗牌**；旧版根目录 URL/散图平滑兼容。
- v1.0.0：由「动态 cordis_define 加载」改为「std DSH 插件打包 + profile 安装」，随启动自动加载，
  设置持久化；host 改用 Node fs，新增 `/bga/wallpapers.json` 清单路由。
