# dsh-bg-atelier 安装指南（居家电脑）

本版是**标准 DSH 插件**：随 DSH 启动自动加载、重启保留、可在 设置 → 插件 管理。
不再需要“每台机器手动复制源码再让 agent cordis_define”。

## 1. 拿源码

```powershell
git clone https://github.com/Raylen-berry/dsh-desktop-wallpaper.git
# 或 GitHub → Code → Download ZIP 解压
```

解压后路径记为 `$PLUGIN_DIR`（建议 `D:\DeepSeek\dsh-plugins\dsh-desktop-wallpaper`，与仓库名一致）。

## 2. 安装进 DSH profile

在 DSH Desktop 的会话里让 agent 执行，或在本机 PowerShell 运行：

```powershell
dsh plugin --profile web add link:"$PLUGIN_DIR"
```

装完**重启一次 DSH Desktop**。启动后：
- 设置页顶部出现 **底图工坊** 入口（先选底图类型、再进该类型图库选图；调色、特效）
- 侧边栏底部出现「流光宝珠」一键随机换图（跨全部类型，同轮 2/3 内不重复）
- 插件出现在 设置 → 插件 清单里，可随时开启/关闭

> 首次安装需要能解析 `dsh` CLI 与联网（若走仓库安装）。`link:` 本地安装无需联网。

## 3. 放底图（按类型 = 子文件夹）

**开箱即用**：插件自带「线稿风」类型 11 张底图（亚丝娜/月蔷薇/流萤/物语花绫/远坂凛/青缭 及高清版），装完即可选。
**自己加图**：放进任一命中目录下**一个子文件夹 = 一个类型**，例如建 `重返未来1999` 文件夹再把图丢进去：

```powershell
New-Item -ItemType Directory -Force "C:\...\wallpapers\重返未来1999"   # 换下面的命中目录
Copy-Item "D:\图包\*.png" "C:\...\wallpapers\重返未来1999\"
```

放好点设置页「刷新」即出现新类型/新图（无需重启）。支持 png / jpg / webp / gif / svg / avif / bmp。
根目录的散图会自动归为「未分类」类型（兼容旧版）。

命中目录顺序（首个**有图**的命中，① 最高）：

| 顺序 | 目录 |
|---|---|
| ① | `$env:DSH_BG_ATELIER_WALLPAPERS`（绝对路径，显式覆盖） |
| ② | `$DSH_HOME\dsh-bg-atelier\wallpapers`（**推荐**，启动自动建好，随时丢图） |
| ③ | 插件包内置 `wallpapers/`（当作默认图集） |
| ④ | 工作区相对 `dsh-plugins/dsh-desktop-wallpaper/wallpapers` |

**高清细分**：文件名去掉扩展名后尾部带 `高清 / _高清 / ·高清 / 4K / HD` 等标记的自动打「高清」，
类型图库内可用 `全部 / 高清 / 普通` 筛选。显示名自动去掉该标记（如 `亚丝娜_高清.png` 显示为「亚丝娜·高清」角标），
编号仅作为角标、不改文件名/显示名。

## 4. 升级

```powershell
dsh plugin --profile web update dsh-bg-atelier
```

或对 agent 说“更新底图插件”，让它重新拉取源码后 `dsh plugin --profile web add link:$PLUGIN_DIR`。

## 5. 卸载 / 停用

```powershell
dsh plugin --profile web remove dsh-bg-atelier
```

或在 设置 → 插件 里停用该插件后重启 Harness。所有底图/特效/主题覆盖立即还原，
不残留改动（主题覆盖是运行时 token 覆盖，不写底层文件）。

## 常见问题

- **底图不出图**：浏览器直接访问 `http://127.0.0.1:<DSH端口>/bga/wallpapers.json` 看返回；
  `/bga/wallpapers/<类型>/<文件名>` 404 说明目录没解析对（看上面第 3 步顺序）；
  400 是路径安全拦截（不要含 `..`、多余斜杠）。
- **类型没出现**：类型 = 放图目录下的**子文件夹**；文件夹里还没有受支持图片时类型卡显示为「空」，
  放入图片后点「刷新」。
- **安装后没生效**：确认 `dsh plugin add` 已把 `dsh-bg-atelier` 写进 profile 的
  `dsh.profile.bundles`，且已**重启一次** DSH Desktop。
- **底图选择不记住**：设置持久化到 host 侧文件 `$DSH_HOME\dsh-bg-atelier\settings.json`，
  重启 DSH 后自动恢复上次选择（旧版根目录 URL 也会自动对回新类型里的文件）。

## WE 壁纸库（v1.7.0）

设置页「底图工坊 → Wallpaper Engine 库」：列出本机 WE 订阅/本地项目，点卡片即铺成 DSH 背景。

- **改完 host 半必须重启 DSH Desktop**：`/bga/we/*` 与 `/bga/we/still…` 都是 host 路由，
  在 bundle 挂载时注册（实测：只改插件文件、只改 `cordis.patch.yml` 都不会触发热重载）。
  client 半相反，是按请求重建的，刷新窗口即可。
- **scene 类高清静态图**：WE 只给 192×192 的 `preview.gif`，铺 4K 屏等于放大约 10 倍。
  host 现在会解 `scene.pkg`（PKGV00200 容器 + .tex 解码，见 `we/pkg.js`/`we/tex.js`/`we/still.js`）
  合成一张 4367×2456 的静态图，落盘在 `$DSH_HOME\dsh-bg-atelier\we-stills\<id>.webp`（约 1 MB）。
  首次约 5s，之后直接读盘；客户端先铺 gif、生成好了自动换上。
  近似之处（不重写 WE 渲染器）：相机用"整屏覆盖层"矩形推断、origin 按中心解释、
  puppet 骨骼层用最近的非骨骼祖先近似、特效（blur/水波/音频响应/脚本动画）不渲染。
  想要**动态**就只能回到 gif；想要"动得对"需要 WE 的运行时，本插件不做。

