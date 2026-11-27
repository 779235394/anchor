<div align="center">
  <img src="public/app-icon.png" width="96" height="96" alt="Anchor Icon" />
  <h1>Anchor · 锚点</h1>
  <p><strong>锚定每天最重要的一件事 — 本地优先的跨平台个人深度工作台</strong></p>
  <p>Local-first personal desktop workbench for tasks, Kanban flow, lunar scheduling, global quick capture, floating sticky notes, Markdown knowledge base, multi-range reviews, Git sync &amp; QR mobile companion</p>
  <p>
    <a href="https://779235394.github.io/anchor/"><img src="https://img.shields.io/badge/Official%20Website-779235394.github.io%2Fanchor-0A84FF?style=flat-square" alt="Official Website" /></a>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-1D1D1F?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Built%20with-Tauri%202%20%2B%20React%2019%20%2B%20Rust-0D9488?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/Sync-Local%20Plaintext%20%2B%20Git-34C759?style=flat-square" alt="Local First + Git Sync" />
    <img src="https://img.shields.io/badge/License-All%20Rights%20Reserved-6E6E73?style=flat-square" alt="All Rights Reserved" />
  </p>
  <p>
    <strong><a href="https://779235394.github.io/anchor/">🌐 访问产品官网（交互动画演示 &amp; 自动识别平台下载）</a></strong>
    &nbsp;·&nbsp;
    <a href="https://github.com/779235394/anchor/releases">📦 Releases 下载</a>
    &nbsp;·&nbsp;
    <a href="./CHANGELOG.md">📝 更新日志</a>
  </p>
</div>

---

## 产品简介

**Anchor（锚点）** 是一款采用 **Porcelain & Obsidian Glass（白瓷 · 曜石玻璃）** 视觉体系打造的跨平台（macOS & Windows）**本地优先个人桌面工作台**。它摒弃云端平台锁定、强制登录与繁杂打扰，围绕个人深度推进的完整闭环——**待办列表、四列任务看板、农历日程排期、项目看板、原生 Markdown 知识库、灵感速记、独立置顶桌面便签、多维复盘、全局自定义快捷键悬浮小窗与手机扫码跨网协作**——提供极简、克制、零延迟的原生桌面体验。

> 产品官网与实时交互演示：**[https://779235394.github.io/anchor/](https://779235394.github.io/anchor/)**

## 核心特性

- **Porcelain & Obsidian Glass 全端玻璃美学（`v1.0.0`）**：
  - 纯 WebView L0–L4 五级景深体系，浅色「白瓷玻璃」与深色「曜石玻璃」双态一致，支持 4 档系统强调色（蓝 / 靛 / 青 / 石墨）、中英双语切换与 `prefers-reduced-transparency` 无障碍降级，macOS 与 Windows 视觉 100% 统一。
- **左右分栏待办列表 + 四列任务看板 + 多列项目看板**：
  - 统一单框富文本/Markdown 正文录入（首行自动派生摘要，支持常驻精简工具栏、`- [ ]` 清单与截图/附件一体化管理）；
  - 四列看板（`待办 → 进行中 → 待确认 → 已完成`）支持跨列/同列拖拽与 L3 圆角悬浮检视抽屉；多列项目看板支持 8 色分类与跨列拖拽改归属。
- **月 / 周 / 日 日程排期看板（含原生零依赖农历）**：
  - 支持单日/跨天日期区间与小时时间段排期；月视图内置精准农历与跨天连续玻璃横条，周/日视图提供 `00:00–24:00` 时间轴与当前时刻红线；左侧「未排期池」支持直接拖入日历。
- **原生多级目录 Markdown 知识库 + 灵感沉淀 + A4 矢量 PDF**：
  - 以真实系统目录和标准 `.md` 文件存放在 `<dataDir>/docs/`（零私有格式锁定，兼容 VS Code / Typora 热重载）；
  - 支持跨端 Pointer 拖拽排序与移动、外部 `.md`/文件夹直拖导入、阅读态直接勾选清单回写、多条灵感一键合并沉淀为文档，以及双端原生分页直出标准 A4 矢量 PDF。
- **全局快捷键悬浮小窗（`⌥ Space`）+ 多开独立置顶桌面便签（`⌥⇧N`）**：
  - macOS 原生 `NSPanel` 突破原生全屏 Space 遮挡，可在任意全屏应用上方瞬间呼出无边框速记小窗或独立多开 6 色磨砂桌面便签（支持 4 档透明度、逐张置顶与逐张可控启动自启）。
- **移动端扫码访问与跨网实时协作（免装 App）**：
  - 电脑开机作为本地主机（内置 `axum` 回环 HTTP/SSE 服务 + 内嵌 `cloudflared` 安全加密通道），手机在 4G/5G 或任意 Wi-Fi 扫码一次性配对直连 5-Tab 移动 Web，数据 100% 留在本机。
- **多维度复盘（日 / 周 / 月 / 年 / 自定义）**：
  - 聚合已完成/新建待办、知识库文档、灵感明细与 8 色项目精力分布，支持一键复制纯净 Markdown 报告或按维度归档至知识库。
- **100% 本地明文存储 + 通用 Git 云端同步 + 应用内签名直更**：
  - 本地明文模式与 Git 云端同步模式互斥双目录隔离；支持 Gitee / GitLab / GitHub / 自建私有 Git，离线冲突按记录级 LWW + 30 天墓碑无损合并；Rust 原子写盘 + 7 天滚动快照自愈 + Ed25519 数字签名应用内原地升级。

## 下载安装

推荐访问 **[Anchor 产品官网](https://779235394.github.io/anchor/)**（自动识别你的系统），或前往本仓库 **[Releases](https://github.com/779235394/anchor/releases)** 页面下载最新安装器：

- **macOS（Apple Silicon + Intel 通用版）**：下载 `Anchor_*_universal.dmg`，打开后拖入「应用程序」即可。
- **Windows（64 位）**：下载 `Anchor_*_x64-setup.exe`（NSIS 安装器）或 `.msi` 安装包运行安装。

> **跨设备同步推荐用法**：在「设置与数据 → 数据存储方式」中选择「Git 云端存储与同步」，填入私有 Gitee / GitLab / GitHub 仓库地址绑定即可；单机使用则开箱即走纯本地明文目录。

## 常用快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `⌥ Space`（macOS） / `Alt + Shift + Space`（Win） | **全局呼出悬浮快捷记录小窗**（灵感速记 / 快捷待办，可自定义） |
| `⌥⇧N`（macOS） / `Alt + Shift + N`（Win） | **全局新建独立置顶桌面便签**（可自定义） |
| `Cmd / Ctrl + K` | 打开全局 Spotlight 搜索，直达任意待办、项目、知识库、灵感、便签与附件 |
| `Cmd / Ctrl + N` | 聚焦当前视图快速录入框 / 新建便签 |
| `Cmd / Ctrl + 1 ~ 9` | 快速切换 9 个个人工作台主视图 |
| `Cmd / Ctrl + Enter` | 快捷提交当前录入或保存原地编辑 |
| `Cmd / Ctrl + V` | 直接粘贴截图或本地文件路径并自动归档至附件目录 |
| `Esc` | 依次关闭快捷小窗、Spotlight 搜索或右侧悬浮抽屉 |

## 仓库目录与本地开发

本仓库包含两个相互解耦的前端工程：

- **根目录（`src/` + `src-tauri/`）**：Anchor 桌面端与移动端伴侣主机（由 `.github/workflows/release.yml` 经 `v*` Tag 双端构建发布）；
- **独立官网目录（`website/`）**：Anchor 官方静态网站源码（由 `.github/workflows/pages.yml` 自动部署至 `https://779235394.github.io/anchor/`）。

```bash
# 桌面端：安装依赖与校验
pnpm install
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml

# 桌面端：开发与本地打包
pnpm tauri dev
pnpm tauri build --bundles dmg,app

# 官方静态网站（独立子项目）
pnpm --dir website install
pnpm --dir website dev
pnpm --dir website build
```

---

## 版权声明（License）

本软件及本仓库中的全部源代码、界面设计、图标素材与构建产物均受版权保护，**保留所有权利（All Rights Reserved）**。未经版权方事先书面许可，禁止任何形式的复制、修改、商业使用或二次分发。详情请参阅根目录 [LICENSE](./LICENSE) 文件。

> Copyright © 2026 Anchor. All rights reserved.
