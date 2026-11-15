# 发布 Pulp v0.2.0

## 推送更新

在 PowerShell 中运行。先检查 `git status`，确认提交的都是本次修改。不要将笔记、凭据或构建目录加入 Git。

```powershell
cd D:\Pulp
git add README.md README.en.md RELEASE_NOTES.md PUBLISHING.md package.json package-macos.sh .github/workflows/packages.yml src src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/src/lib.rs release/下载说明.md
git commit -m "Release Pulp v0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

每个版本只创建一次标签。如果 `v0.2.0` 已存在，不要强制覆盖；后续版本同步修改 package.json、Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本号，并使用新标签。

## 自动发布

标签推送触发 `.github/workflows/packages.yml`。Windows、Apple 芯片 Mac、Intel Mac 分别构建；全部成功后汇总附件，创建或更新同名 GitHub Release，附上 `RELEASE_NOTES.md`、安装包、下载说明与 SHA-256 校验文件。手动在 main 运行 workflow 只构建附件；在版本标签上运行则同时发布。

查看构建：https://github.com/toneang/Pulp/actions

下载页面：https://github.com/toneang/Pulp/releases

如果账号仍有 billing lock，先处理 GitHub 账号的计费限制，再重新运行构建。修改 YAML 无法解除账号限制。

## 手动发布 Windows 包

在无法使用 Actions 时，可在 Releases 页面点击 **Draft a new release**，选择已经推送的 `v0.2.0` 标签，标题填写 `Pulp v0.2.0`，复制 `RELEASE_NOTES.md`，并上传本地 `release/` 中当前版本的 Windows exe、zip 与校验文件后发布。缺少 Mac 包时请明确说明，之后再上传真正生成的 Mac 包。

安装了 GitHub CLI 的用户也可运行：

```powershell
gh auth login
gh release create v0.2.0 --repo toneang/Pulp --verify-tag --title "Pulp v0.2.0" --notes-file RELEASE_NOTES.md release/Pulp-0.2.0-windows-x64.exe release/Pulp-0.2.0-windows-x64.zip release/Pulp_0.2.0_x64-setup.exe release/SHA256SUMS-windows-0.2.0.txt release/下载说明.md
```

若 Release 已存在，改用 `gh release upload v0.2.0 --repo toneang/Pulp <文件路径>` 添加缺少的附件。校验文件仅覆盖与其一起生成的包。

## 在 Mac 本机生成下载包

安装 Node.js、pnpm、Rust 和 Xcode Command Line Tools 后：

```bash
git clone https://github.com/toneang/Pulp.git
cd Pulp
git checkout v0.2.0
bash package-macos.sh
```

默认构建当前 Mac 架构。Apple 芯片与 Intel 包分别在对应机器或 CI 运行器构建，产物位于 `release/`。
