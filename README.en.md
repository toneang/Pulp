<p align="center"><img src="./app-icon.png" width="96" alt="Pulp icon" /></p>
<h1 align="center">Pulp</h1>
<p align="center"><strong>A little space for your next thought.</strong><br />A paper-inspired floating Markdown notepad for Windows and macOS.</p>
<p align="center"><a href="https://github.com/toneang/Pulp/releases/latest">Download</a> · <a href="./README.md">简体中文</a> · <a href="./RELEASE_NOTES.md">Release notes</a></p>

Capture an idea without losing your place. Press a shortcut, jot down a thought, and tuck Pulp away until you need it again. Its warm paper palette and compact window keep your notes close at hand.

Use it for meeting notes, quick tasks, code snippets, formulas, and all the things you want to remember before they disappear.

## Made for the moment

- **One shortcut away.** Toggle the window with a global shortcut or open it from the system tray.
- **Write in the result.** Markdown opens in an editable rendered view. Switch to source with the button in the bottom left.
- **More than plain text.** Headings, lists, quotes, code, tables, and KaTeX math, with formatting shortcuts.
- **Find previous notes.** Creating a note archives the current one. Reopen it from History.
- **Make room for your eyes.** Adjust the font with A− / A+, Ctrl/Cmd + mouse wheel, or Ctrl/Cmd + plus/minus. Move, resize, maximize, or pin the window.
- **Keep files close.** Choose a folder for new .md / .txt notes. Your notes are stored locally; recording notes needs no account or cloud setup.
- **中文 / English.** Switch the interface language in Settings. Your writing stays exactly as it is.

## Download

Visit [Releases](https://github.com/toneang/Pulp/releases/latest) and use the assets actually listed for that release.

| Platform | Package |
| --- | --- |
| Windows x64 installer | `Pulp_0.2.0_x64-setup.exe` |
| Windows x64 portable | `Pulp-0.2.0-windows-x64.exe` |
| Apple silicon Mac | `Pulp-0.2.0-macos-apple-silicon.app.zip` or the matching DMG |
| Intel Mac | `Pulp-0.2.0-macos-intel.app.zip` or the matching DMG |

Mac assets appear only after their macOS builds succeed. GitHub billing or runner restrictions can prevent packages from being produced. Windows needs Microsoft Edge WebView2 Runtime. Builds are currently unsigned; confirm the source before allowing an app through your operating system's security prompts.

The Windows installer supports removal through Settings → Apps. The portable executable needs no installer: quit Pulp, then delete the executable. **Portable does not mean portable data**: notes and preferences live separately in app data.

## Start writing

1. Launch Pulp and press **Ctrl+Shift+P** on Windows or **Cmd+Shift+P** on Mac.
2. Type directly into the rendered Markdown view. Use the bottom-left button or **Ctrl/Cmd+E** for source.
3. Click **New** for another note and **History** to revisit earlier notes.
4. Toggle the pin to keep the window above other apps.
5. Open **Settings** for language, the global shortcut, default format, launch at login, and the folder for new notes.

Closing or hiding the window keeps Pulp running. Open it again using the shortcut or tray icon; on Windows the icon may be inside the **^** overflow menu. Use the power button or **Quit Pulp** in the tray menu to exit.

## Shortcuts

Use Cmd instead of Ctrl on macOS. Formatting shortcuts apply to Markdown mode.

| Action | Shortcut |
| --- | --- |
| Show / hide | Ctrl+Shift+P, customizable |
| Source / rendered view | Ctrl+E |
| Save / Settings | Ctrl+S / Ctrl+, |
| Font size | Ctrl+wheel or Ctrl+plus/minus |
| Bold / italic | Ctrl+B / Ctrl+I |
| Strikethrough / link | Ctrl+Shift+D / Ctrl+K |
| Heading 1–6 / paragraph | Ctrl+1…6 / Ctrl+0 |
| Table size picker | Ctrl+Shift+T |
| Bullet / numbered list | Ctrl+Shift+U / Ctrl+Shift+O |
| Quote | Ctrl+Shift+Q |
| Inline / block math | Ctrl+M / Ctrl+Shift+M |
| Hide (close an active panel first) | Esc |

Common Markdown patterns are converted as you type, including headings, lists, quotes, emphasis, code blocks, and `$$` math blocks. Click a rendered formula to edit its TeX.

Export Markdown directly. **PDF export currently uses the system print dialog**: choose Microsoft Print to PDF on Windows or the PDF save option on macOS.

## Your notes and files

The current note, preferences, and archive live in the system app data folder, typically `%APPDATA%\com.yjw.pulp\` on Windows and `~/Library/Application Support/com.yjw.pulp/` on macOS.

Set **Settings → New notes folder** to save subsequently created notes as individual `.md` / `.txt` files. The default is `notes/` inside app data. Existing notes keep their original locations when you change this setting. History remains in app data under `archive/`.

History captures notes before creating or switching notes; it is not an edit-by-edit version history or a backup service. Back up both app data and any custom notes folder before migrating.

## Development

Install Node.js, pnpm, Rust, and the Tauri prerequisites for your platform: MSVC and WebView2 on Windows, Xcode Command Line Tools on macOS.

```bash
git clone https://github.com/toneang/Pulp.git
cd Pulp
pnpm install --frozen-lockfile
pnpm tauri dev
```

Build Windows with `pnpm tauri build --bundles nsis`. The installer is in `src-tauri/target/release/bundle/nsis/`; the standalone executable is `src-tauri/target/release/pulp.exe`.

On a Mac, run `bash package-macos.sh`. Tag pushes matching `v*` build all three platform packages and publish a Release after all jobs succeed. See [Publishing](./PUBLISHING.md).

Found an issue or have an idea? [Tell us](https://github.com/toneang/Pulp/issues). Include your OS, Pulp version, steps to reproduce, and a small Markdown example when relevant.

**Less switching. More thoughts kept.**
