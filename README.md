# 底图工坊

**给 DSH Desktop 换上喜欢的背景，收藏成图单，再配上颜色和输入框特效。**

DSH Desktop 插件 · 当前版本 **1.15.2** · MIT 开源

[安装教程](docs/安装.md) · [使用指南](docs/使用.md) · [动态壁纸](docs/动态壁纸.md) · [换机迁移](docs/迁移.md) · [更新记录](CHANGELOG.md)

## 能做什么

| 想做的事 | 插件提供的功能 |
| --- | --- |
| 换一张聊天背景 | 从本地图片或可下载图库中选图，调整位置与缩放 |
| 整理喜欢的图片 | 收藏、搜索、自建图单、批量收录和拖动排序 |
| 只轮播选中的一组图 | 指定图单或文件夹，随机或顺序切换，也能返回上一张 |
| 让背景自己变化 | 设置 1–120 分钟的轮播间隔，调整渐变速度；窗口在后台时暂停 |
| 调整界面观感 | 配色预设、背景明暗、输入框透明度、模糊和阴影 |
| 给输入框加点动效 | 流萤、气泡、落樱、雨丝等八种特效，也可以关闭 |
| 使用 Wallpaper Engine 壁纸 | 读取本机壁纸库；场景可选静态近似或实时动画与鼠标跟随 |

普通图片背景可以直接使用。**Wallpaper Engine 实时场景需要 Windows、已运行的 Wallpaper Engine 和额外安装的桌面桥**，见[动态壁纸教程](docs/动态壁纸.md)。

## 第一次使用

### 1. 安装插件

先安装好 DSH Desktop，并确认终端能使用 `dsh` 和 `git`。下面以 Windows PowerShell 为例，安装位置可以自行修改：

```powershell
$pluginDir = 'D:\DeepSeek\dsh-plugins\dsh-desktop-wallpaper'
New-Item -ItemType Directory -Force (Split-Path $pluginDir) | Out-Null
git clone https://github.com/Raylen-berry/dsh-desktop-wallpaper.git $pluginDir
dsh plugin --profile web add "link:$pluginDir"
```

安装完成后，**在当前任务结束后完全退出并重新打开 DSH Desktop**。进入 **设置 → 底图工坊**；侧边栏底部的「流光宝珠」也能快速换图。

没有 Git、安装遇到问题，或需要升级与卸载，请看[安装教程](docs/安装.md)。

### 2. 准备图片

二选一即可：

- **用自己的图片**：在 **图库 → 管理壁纸文件** 查看放图目录，把图片放进其中的子文件夹，再点「刷新图库」。一个子文件夹就是一个分类。
- **用已发布图库**：在同一入口点「下载内置壁纸」。当前清单有 **313 张原图，完整下载约 9.06 GiB**；下载中断后可以重试，已校验通过的图片会跳过。

**克隆仓库只取得代码，图片需要另行准备。** 不必下载整个图库，也可以先用自己的几张图片。

### 3. 选图并调整

在图库点击一张图片即可设为背景。喜欢就点「♡ 喜欢」；想自动换图，先选切换范围，再点「开始轮播」。外观、构图和切换速度在对应页签中调整。

设置自动保存在本机，重新打开 DSH 后会恢复。具体按钮说明见[使用指南](docs/使用.md)。

## 按需要继续阅读

| 你现在需要 | 打开这份说明 |
| --- | --- |
| 安装、更新、停用或卸载 | [安装](docs/安装.md) |
| 收藏、图单、轮播、外观设置和常见问题 | [使用](docs/使用.md) |
| 接入 Wallpaper Engine、使用实时场景 | [动态壁纸](docs/动态壁纸.md) |
| 把图片和个人设置搬到另一台电脑 | [迁移](docs/迁移.md) |
| 了解每次更新的内容 | [更新记录](CHANGELOG.md) |
| 修改源码、运行检查或发布图库 | [开发](docs/开发.md) |

安装命令中的包名是 `dsh-bg-atelier`，GitHub 仓库名是 `dsh-desktop-wallpaper`。这是同一个插件，更新与卸载时使用包名。

问题或建议可提交到 [Issues](https://github.com/Raylen-berry/dsh-desktop-wallpaper/issues)，附上 DSH 版本、插件版本和复现步骤。
