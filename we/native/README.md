# WE 原生实时桥（Windows，v1.9.0）

v1.9.0 新增 properties IPC：从当前已核验场景读取属性定义，校验类型、范围、选项，再通过官方 `applyProperties -location <专用窗口名>` 应用。JSON 用官方 RAW 分隔符直接传给已核验的 WE 可执行文件，不启动 shell；仅这类参数使用 Windows 原样参数模式，避免 CRT 转义破坏 JSON。默认音量为 0，播放速度单位为倍（1 表示正常）。更改和最多 12 个命名预设按场景保存到独立 JSON 文件，串行、原子写入；失败显示原因。

采集使用原尺寸，默认 45 fps 目标；30 / 60 可选。强制缩放在本机实测反而卡顿，已取消。实际帧率通过视频帧回调统计，独立刷新小状态组件，不刷新主题和图库。鼠标仍由 WE 原生读取，窗口对齐策略保留。

v1.8.1 修复正式 DSH 默认权限处理拒绝采集、因此退回静态图的问题。安装器在原有权限判断前增加仅针对待采集 WE 窗口的短期授权；保留摄像头、麦克风、其他页面的原有判断。Electron 43 的采集请求是 `mediaTypes: []`，不能简单放行全部 `media`。同时避免单页内部导航断开背景，并把连接失败原因记录到控制台。回归验收现包含 DSH 原有权限策略：修复前无法取得视频流，修复后播放、缩放、恢复均有连续动态帧。

WE 官方 `playInWindow` 负责真正运行 scene；Electron 只采集这个专用窗口，客户端作为视频背景显示。没有重写 WE 渲染器。每次请求创建随机窗口名，单个 DSH 进程最多维持一个实时背景。

## 鼠标与窗口

本机实测 WE 的 SceneScript 输入来自真实光标位置，普通 `WM_MOUSEMOVE` 转发不足以改变它。`WindowBridge.exe` 把 WE 窗口的客户区对齐到 DSH 客户区，放在 DSH 正下方，并随移动、尺寸和 DPI 变化更新。WE 自己处理原有鼠标视差；不移动系统鼠标，不发送点击或键盘，不把鼠标消息转发到壁纸。

辅助程序只接受标准输入的 status / close 命令。它核实目标窗口的随机标题、WE 程序路径/进程，以及所属 DSH 进程的窗口句柄。DSH 窗口消失、进程结束或管道断开后，关闭专用 WE 窗口。没有网络监听服务。

不要用 SetParent 或强制改 WE 窗口样式替代：本机测试中改样式会导致采集失效。这里用官方无边框参数和普通窗口位置同步。

## 安装与更新

从源码构建辅助程序（Windows 自带 .NET Framework 编译器）：

```powershell
npm run native:build
```

预览安装改动：

```powershell
node tools/install-native-bridge.mjs --app 'D:\deepseek-harness\DSH Desktop'
```

写入并备份：

```powershell
node tools/install-native-bridge.mjs --app 'D:\deepseek-harness\DSH Desktop' --apply --backup 'D:\backup\dsh-native-bridge'
```

这会在 DSH `out/main/index.js` 的主窗口创建处加入受保护的桥加载，并在 `out/preload/index.cjs` 暴露小范围的 start/stop/capability/visibility/properties 接口。桥模块缺失时只记录错误，不阻止 DSH 启动。安装器拒绝不匹配的桌面结构，重复安装不会堆叠入口。

**必须完全退出并重启 DSH Desktop**；仅刷新页面或重启 Harness 不会重载 Electron 主进程。DSH 更新可能覆盖这两个入口，需要重新运行安装器。本机验证版本：DSH 0.9.1 / Electron 43.4.0。

## 权限边界

- IPC 只接受已登记 DSH 主窗口的主 frame，且页面必须位于 loopback HTTP。
- 客户端只提交已扫描库的 ID，不能提交文件路径、命令、窗口句柄或任意捕获源。
- 主进程重新发现 WE 并扫描库，核对真实项目路径在库根中。
- 一次视频采集授权只用于同一 frame 的刚创建 WE 窗口，15 秒过期，不采集音频或整屏。
- 原生程序核实的 HWND 必须与捕获源一致。

## 验收与限制

已用本机 scene 验证动态帧、页面输入区命中、移动缩放、最小化重连和清除。鼠标用带 SceneScript 坐标显示的隔离夹具核对真实输入；未将普通消息发送成功视为鼠标效果成功。

最小化/隐藏释放运行窗口和视频流，恢复时重新连接。失败显示原因并保留静态近似。源壁纸需要有鼠标视差/跟随逻辑才会产生对应效果；不新增壁纸本身没有的交互，不支持穿透点击/拖动壁纸。

实时模式额外运行一份场景并采集，资源开销高于静态图；默认 45 fps 是请求目标，本机重场景实测约 35 fps。尚未做长时间、多显示器跨 DPI 和 4K 压力验收。采集不含音轨，场景音量通过 WE 定向属性控制。Chromium 会报告 cursor=always，即使请求 never；不保证每个平台都排除捕获光标，应留意是否出现指针重影。

## 回退

先在底图工坊选择「场景：静态近似」即可停止实时桥。需要撤回桌面入口时，DSH 尚未升级且没有其他后续改动的情况下，用安装备份中的 main-index.js / preload-index.cjs 恢复相应文件后重启；有后续改动时只删除 BGA_NATIVE_BRIDGE_BEGIN/END 和 BGA_NATIVE_PRELOAD_BEGIN/END 两段标记内容。

官方资料：[WE CLI](https://help.wallpaperengine.io/en/functionality/cli.html)、[SceneScript IInput](https://docs.wallpaperengine.io/en/scene/scenescript/reference/class/IInput.html)、[Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)。
