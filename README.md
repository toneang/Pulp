<p align="center">
  <img src="./app-icon.png" width="96" alt="Pulp icon" />
</p>

<h1 align="center">Pulp</h1>
<p align="center"><strong>灵感出现时，纸就在手边。</strong><br />一款有纸感、可悬浮、支持 Markdown 的桌面随手记。</p>
<p align="center">Windows · macOS · 本地保存 · 中文 / English</p>
<p align="center"><a href="https://github.com/toneang/Pulp/releases/latest">下载 Pulp</a> · <a href="./README.en.md">English</a> · <a href="./RELEASE_NOTES.md">版本更新</a></p>

---

写下一闪而过的想法，不必打断正在做的事。

**Pulp 是桌面上的一张小纸。** 按下快捷键，它出现在眼前；记下一段文字、一张表格或一个公式，再按一下，继续手头的工作。米白色界面、轻巧的悬浮窗口，让记录成为一个自然的小动作。

适合临时待办、会议要点、代码片段、学习公式，以及每一个“这个先记一下”的瞬间。

## 为什么用 Pulp

- **随叫随到**：全局快捷键显示 / 隐藏窗口，也能从系统托盘打开。
- **边写边呈现**：Markdown 默认进入可编辑的渲染视图，左下角一键切换源码。
- **小窗也能认真写**：标题、列表、引用、代码、表格与 KaTeX 数学公式，配合常用格式快捷键。
- **记录找得到**：新建前自动归档当前笔记，从「历史」找回；支持设置新笔记保存文件夹。
- **舒适由你决定**：字号缩放、拖动与调整窗口大小、置顶切换、自定义唤出快捷键。
- **自己的文字，自己保管**：笔记保存在本机；记录功能无需注册账号或配置云端服务。
- **两种语言，一样顺手**：在设置中即时切换中文 / English，正文保持原样。

## 下载与安装

前往 **[Releases 下载页](https://github.com/toneang/Pulp/releases/latest)**，以该版本实际列出的 Assets 为准。

| 你的设备 | 选择的文件 | 使用方式 |
| --- | --- | --- |
| Windows x64（推荐） | `Pulp_0.2.0_x64-setup.exe` | 安装后运行，支持系统卸载 |
| Windows x64（便携） | `Pulp-0.2.0-windows-x64.exe` | 直接运行 |
| Apple 芯片 Mac | `Pulp-0.2.0-macos-apple-silicon.app.zip` 或对应 `.dmg` | 解压后将 Pulp.app 放入「应用程序」 |
| Intel Mac | `Pulp-0.2.0-macos-intel.app.zip` 或对应 `.dmg` | 选择 Intel 版本 |

> Mac 下载包需要对应 macOS 构建任务成功后才会出现。仓库中的构建配置不代表安装包已经生成；GitHub Actions 计费或运行器限制可能使发布缺少平台包。

Windows 需要 Microsoft Edge WebView2 Runtime。应用目前未签名，首次运行可能出现系统安全提示，请确认下载来源。便携版仅表示无需安装，**笔记与设置不会随 exe 自动搬家**。

安装版可从 Windows「设置 → 应用」卸载。便携版退出后删除程序即可；需要清理笔记时，请先备份，再自行处理数据文件夹。

## 一分钟开始记录

1. 启动 Pulp，按 `Ctrl+Shift+P`（Mac：`Cmd+Shift+P`）唤出窗口。
2. 直接输入。Markdown 默认显示可编辑的渲染结果，左下角按钮切换源码。
3. 点击 **新建** 开始下一条，上一条会保存在 **历史** 中。
4. 点击图钉，切换是否始终置于其他窗口之上。
5. 打开设置，选择语言、默认格式、唤出快捷键、开机自启与新笔记保存文件夹。

关闭或按 Esc 隐藏窗口后，Pulp 仍在后台运行。可用快捷键或托盘图标再次打开；点击电源按钮或托盘菜单「退出 Pulp」结束进程。Windows 托盘图标可能被收纳在任务栏右侧的 **^** 中。

## 写作与快捷键

下表中的 `Ctrl` 在 macOS 上对应 `Cmd`。格式快捷键用于 Markdown 模式。

| 操作 | 快捷键 |
| --- | --- |
| 显示 / 隐藏窗口 | Ctrl+Shift+P（可自定义） |
| 源码 / 渲染视图 | Ctrl+E |
| 立即保存 | Ctrl+S |
| 打开 / 关闭设置 | Ctrl+, |
| 放大 / 缩小字号 | Ctrl+鼠标滚轮、Ctrl++ / Ctrl+-，或 A+ / A− |
| 加粗 / 斜体 | Ctrl+B / Ctrl+I |
| 删除线 / 链接 | Ctrl+Shift+D / Ctrl+K |
| 一级至六级标题 / 普通正文 | Ctrl+1…6 / Ctrl+0 |
| 插入表格并选择行列 | Ctrl+Shift+T |
| 无序 / 有序列表 | Ctrl+Shift+U / Ctrl+Shift+O |
| 引用 | Ctrl+Shift+Q |
| 行内 / 块级公式 | Ctrl+M / Ctrl+Shift+M |
| 隐藏窗口 | Esc（先关闭当前面板） |

支持常见 Markdown 输入转换，例如 `### 标题`、`- 列表`、`> 引用`、加粗、斜体、代码块与 `$$` 公式块。点击已渲染的公式可编辑 TeX。源码模式适合精确调整 Markdown，渲染模式适合日常记录。

**导出**：支持导出 Markdown；PDF 目前通过系统打印面板生成。Windows 选择 **Microsoft Print to PDF**，macOS 使用打印面板的 PDF 保存功能。

## 文件保存在哪里

- 当前笔记、设置与历史归档保存在系统应用数据目录。Windows 通常为 `%APPDATA%\com.yjw.pulp\`；macOS 通常为 `~/Library/Application Support/com.yjw.pulp/`。
- 在「设置 → 新笔记保存文件夹」选择目录，**之后新建**的笔记将以独立 `.md` / `.txt` 文件保存到那里；未指定时使用应用数据目录内的 `notes/`。
- 更换目录不会移动已有笔记。已有笔记继续保存到原位置，历史归档仍保存在应用数据目录的 `archive/`。
- 历史用于找回新建或切换前的笔记，不是每一次编辑的版本记录，也不替代备份。迁移前请备份整个应用数据目录及自定义保存目录。

## 从源码运行

需要 Node.js、pnpm、Rust 和 Tauri 对应平台的系统依赖；Windows 使用 MSVC 工具链及 WebView2，macOS 需要 Xcode Command Line Tools。

```bash
git clone https://github.com/toneang/Pulp.git
cd Pulp
pnpm install --frozen-lockfile
pnpm tauri dev
```

Windows 打包：

```powershell
pnpm tauri build --bundles nsis
# 安装包：src-tauri/target/release/bundle/nsis/
# 便携程序：src-tauri/target/release/pulp.exe
```

macOS 打包（在 Mac 上运行）：

```bash
bash package-macos.sh
```

标签 `v*` 会触发 GitHub Actions，分别构建 Windows、Apple 芯片 Mac 与 Intel Mac。全部成功后自动创建或更新对应 Release，并附上安装包、下载说明与 SHA-256 校验文件。详细发布方式见 [发布指南](./PUBLISHING.md)。

## 一起把这张小纸做好

欢迎在 [Issues](https://github.com/toneang/Pulp/issues) 分享问题与建议。反馈编辑问题时，请附最小 Markdown 示例、系统版本和 Pulp 版本；反馈窗口或托盘问题时，说明操作步骤。

**少一点切换，多留住一个想法。**
