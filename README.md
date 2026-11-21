<div align="center">
  <img src="public/app-icon.png" width="96" height="96" alt="Anchor Icon" />
  <h1>Anchor · 锚点</h1>
  <p><strong>锚定每天最重要的一件事 — 面向个人的跨平台本地任务流转、日程排期与灵感速记工作台</strong></p>
  <p>Local-first Apple-inspired personal desktop workbench for tasks, Kanban flow, calendar scheduling, instant global quick capture, rich notes, Git sync &amp; weekly reviews</p>
  <p>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-007AFF?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Built%20with-Tauri%202%20%2B%20React%20%2B%20Rust-1D1D1F?style=flat-square" alt="Stack" />
    <img src="https://img.shields.io/badge/Sync-Local%20JSON%20%2B%20Git-34C759?style=flat-square" alt="Local First + Git Sync" />
    <img src="https://img.shields.io/badge/License-All%20Rights%20Reserved-6E6E73?style=flat-square" alt="All Rights Reserved" />
  </p>
</div>

---

## 产品简介

**Anchor（锚点）** 是一款遵循苹果桌面美学规范打造的跨平台（macOS & Windows）**个人本地桌面工作台**。它摒弃云端平台锁定与繁杂打扰，围绕个人高效推进的核心闭环——**今天待办、四列任务流转看板、月/周/日日程排期（含农历与每日记录）、灵感速记与全局自定义快捷键悬浮小窗、项目跟进、个人每周复盘**——提供极简、克制、零延迟的原生桌面体验。

## 核心特性

- **四列任务流转看板（`待办 → 进行中 → 待确认 → 已完成`）**：
  - 支持跨列拖拽流转状态、同列拖拽调整顺序、列内快速新建，以及按项目 / 优先级 / 排期状态 / 关键词多维过滤；
  - 卡片直观展示优先级圆点、排期区间与时间段、子清单进度与附件数量，与「今天待办」「日程排期」实时联动。
- **月 / 周 / 日 日程排期看板（含农历与每日记录）**：
  - 完整支持单日与跨天日期区间排期（`startDate` ~ `due`）及可选小时时间段（`startTime` ~ `endTime`）；
  - **月视图**：7 列等高网格 + 零依赖精准农历（初一显示月份，其余初二~三十），跨天任务以连续横条展示，支持直接拖拽改期；
  - **周视图 & 日视图**：顶部全天/跨天区 + `00:00–24:00` 时间轴与当前时刻红线，日视图右侧同步汇总当日完成记录与灵感流水；
  - **左侧可折叠迷你面板**：内置搜索、迷你月历、显示图层勾选（任务排期 / 当日完成记录 / 灵感速记 / 农历）、按项目筛选及「未排期池（拖入日历即排期）」。
- **全局快捷键呼出悬浮小窗（支持自定义快捷键 · 始终置顶）**：
  - 无论身处任意软件或 Anchor 隐入托盘，一键瞬间唤起**始终置顶、跨空间悬浮**的无边框精简小窗（切换其他窗口查阅/复制资料时依然稳固置顶）；
  - 顶部 `Tab` 一键切换 **「灵感」 / 「待办」**，底部单一极简工具栏集成 `#标签` / `链接` / `图片` / `文件`，`Enter` 极速存盘自动隐藏并实时同步主窗口与托盘计数，`Shift + Enter` 换行，`Esc` 或再次按快捷键收起；
  - 设置页提供交互式**自定义快捷键录制器**（默认 macOS `⌥ Space` / Windows `Alt + Shift + Space`），支持热更新与系统冲突检测回滚。
- **轻量所见即所得富文本编排器 + 统一附件引擎**：
  - 零常驻工具栏噪音，支持划词悬浮格式条与 Markdown 快捷语法（`**加粗**`、`==高亮==`、`` `代码` ``、`- `、`1. `、`[] ` 可勾选清单）；
  - 智能粘贴截图与本地文件路径（兼容 Paste / 访达 / 微信复制路径）及系统级文件拖放，自动归档至 `<dataDir>/attachments/`；
  - 底层 100% 明文 Markdown 落盘，兼容 Git Diff 与 Spotlight 搜索。
- **100% 本地明文存储 + 通用 Git 云端同步**：
  - 所有个人数据以标准 UTF-8 LF JSON 分片存放在用户自选本地目录（`tasks.json`、`projects.json`、`notes.json`、`attachments/`、`reports/`）；
  - 支持任意 Git 平台（Gitee / GitLab / GitHub / 自建 Git），支持本机 SSH / 系统凭据或 HTTPS + Token（仅存本机配置），多端冲突自动按记录级 LWW 无损合并；
  - Rust 原子写盘（`tmp → sync_all → rename`）+ 7 天自动恢复快照 + 损坏文件备份自愈。
- **个人效率闭环 & 原生桌面体验**：
  - **今天待办**：P1–P4 彩色圆形复选框、跨天自动结转与顺延成本统计、本周/本月按日期分组、统一右侧检视抽屉；
  - **灵感速记 & 项目跟进**：标签云筛选、卡片内直接勾选子清单、一键转今日待办；项目卡聚焦「现在 / 下一步 / 卡点」并一键直达看板；
  - **每周复盘**：聚焦个人推进概览、当前流转分布、优先级与项目精力投入、卡点汇总及一键导出 Markdown 周报（`reports/YYYY-Www.md`）；
  - **原生应用内自动更新**：支持后台静默查新、Ed25519 数字签名校验下载进度条与一键原地重启升级。

## 下载安装

前往本仓库右侧 **[Releases](https://github.com/779235394/anchor/releases)** 页面下载对应平台的最新直接安装器：

- **macOS（Apple Silicon + Intel 通用版）**：下载 `Anchor_*_universal.dmg`，打开后拖入「应用程序」即可。
- **Windows（64 位）**：下载 `Anchor_*_x64-setup.exe`（NSIS 安装器）或 `.msi` 安装包运行安装。

> **跨设备同步推荐用法**：在「设置与数据 → Git 云端存储与同步」中填入私有 Gitee / GitLab / GitHub 仓库地址，点击「绑定当前目录」并在另一台电脑上「克隆到空目录」即可无缝同步；也可以直接将本地目录指向 OneDrive / 坚果云文件夹。

## 常用快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `⌥ Space`（macOS） / `Alt + Shift + Space`（Win） | **全局呼出悬浮快捷记录小窗**（灵感速记 / 快捷待办，可在设置页自定义） |
| `Cmd / Ctrl + K` | 打开全局 Spotlight 搜索，直达任意待办、项目、灵感或附件 |
| `Cmd / Ctrl + N` | 聚焦当前视图快速录入框 |
| `Enter` / `Shift + Enter` | 在快速录入框与悬浮小窗中 `Enter` 提交入列、`Shift + Enter` 换行或展开富文本补充区 |
| `Cmd / Ctrl + V` | 直接粘贴截图或本地文件路径并自动转为附件，或在选区粘贴网址自动加链接 |
| `Esc` | 关闭快捷小窗、搜索框、右侧检视抽屉或图片预览灯箱 |
| `Cmd / Ctrl + 1 ~ 7` | 快速切换 7 个个人工作台主视图 |
| `Cmd / Ctrl + Enter` | 快捷提交当前录入或灵感原地编辑 |

## 本地开发与自动发布

```bash
# 安装依赖
pnpm install

# 运行前端单元测试 & 生产构建检查
pnpm test
pnpm build

# 运行 Rust 原子存储、附件与 Git 同步单元测试
cargo test --manifest-path src-tauri/Cargo.toml

# 启动桌面开发模式
pnpm tauri dev

# 打包当前系统安装包
pnpm tauri build --bundles dmg,app
```

### GitHub Actions 双端自动打包发布

仓库内置 `.github/workflows/release.yml`：每次推送以 `v` 开头的版本标签（或在 Actions 页面手动点击 `Run workflow`），GitHub Actions 会自动执行前后端测试门禁，并在 `macos-latest` 与 `windows-latest` 上并行打包发布 **macOS Universal `.dmg` / `.app.tar.gz`** 与 **Windows `.exe` / `.msi`** 及自动更新清单 `latest.json` 到 Releases：

```bash
git tag v0.6.0
git push origin v0.6.0
```

---

## 版权声明（License）

本软件及本仓库中的全部源代码、界面设计、图标素材与构建产物均受版权保护，**保留所有权利（All Rights Reserved）**。未经版权方事先书面许可，禁止任何形式的复制、修改、商业使用或二次分发。详情请参阅根目录 [LICENSE](./LICENSE) 文件。

> Copyright © 2026 Anchor. All rights reserved.
