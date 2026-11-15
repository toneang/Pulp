import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  activeMathEditor,
  closeMathEditors,
  flushEnclosingRules,
  handlePreviewKeydown,
  mathAtomHtml,
  openMathEditor,
  runCommand,
} from "./editing.js";
import "katex/dist/katex.min.css";
import { errorText, getLanguage, setLanguage, t } from "./i18n.js";

const appWindow = getCurrentWindow();
const statusEl = document.getElementById("status");
const counterEl = document.getElementById("counter");
const editorEl = document.getElementById("editor");
const previewEl = document.getElementById("preview");
const viewToggleBtn = document.getElementById("btn-toggle-view");
const viewToggleLabel = document.getElementById("view-toggle-label");
const settingsEl = document.getElementById("settings");
const settingsBtn = document.getElementById("btn-settings");
const shortcutInput = document.getElementById("shortcut-input");
const shortcutFeedback = document.getElementById("shortcut-feedback");
const formatSelect = document.getElementById("default-format");
const autostartCheck = document.getElementById("autostart");
const autostartFeedback = document.getElementById("autostart-feedback");
const languageSelect = document.getElementById("language-select");
const notesDirectory = document.getElementById("notes-directory");
const directoryFeedback = document.getElementById("directory-feedback");
const chooseDirectoryButton = document.getElementById("choose-notes-directory");
let currentNotePath = null;

let noteFontSize = 13;
try {
  const stored = Number(localStorage.getItem("pulp-font-size"));
  if (Number.isFinite(stored) && stored >= 10 && stored <= 32) noteFontSize = stored;
} catch {}

function changeFontSize(delta) {
  noteFontSize = Math.min(32, Math.max(10, noteFontSize + delta));
  document.documentElement.style.setProperty("--note-font-size", `${noteFontSize}px`);
  try { localStorage.setItem("pulp-font-size", String(noteFontSize)); } catch {}
}
changeFontSize(0);
document.getElementById("font-smaller").addEventListener("click", () => changeFontSize(-1));
document.getElementById("font-larger").addEventListener("click", () => changeFontSize(1));
document.addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0 || recording) return;
  event.preventDefault();
  changeFontSize(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
listen("tray-quit", quitAfterSave).catch(setStatus);

const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
document.getElementById("history-close").addEventListener("click", () => {
  historyPanel.hidden = true;
  focusActiveSurface();
});
document.getElementById("btn-history").addEventListener("click", async () => {
  historyPanel.hidden = false;
  historyList.textContent = t("正在读取…");
  try {
    const notes = await invoke("list_archives");
    historyList.replaceChildren();
    if (!notes.length) historyList.textContent = t("暂无历史笔记。点击新建后，原笔记会出现在这里。");
    for (const note of notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-entry";
      const title = document.createElement("strong");
      title.textContent = note.content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 60) || t("无标题笔记");
      const detail = document.createElement("span");
      const milliseconds = Number(BigInt(note.id) / 1000000n);
      detail.textContent = t("{date} · {count} 字", { date: new Date(milliseconds).toLocaleString(getLanguage() === "en" ? "en-US" : "zh-CN"), count: [...note.content].length });
      button.append(title, detail);
      button.addEventListener("click", async () => {
        const sheet = document.querySelector(".sheet");
        sheet.inert = true;
        try {
          const content = currentContent();
          if (!(await saveNow())) throw new Error(t("当前笔记未保存，已取消切换"));
          clearTimeout(saveTimer);
          const opened = await invoke("open_archive", {
            id: note.id,
            current: { content, format, file_path: currentNotePath },
          });
          currentNotePath = opened.file_path ?? null;
          previewEl.hidden = true;
          editorEl.value = opened.content;
          settingsOpen = false;
          viewMode = "preview";
          setFormat(opened.format, { persist: false });
          updateCounter();
          historyPanel.hidden = true;
          flashStatus(t("已打开历史笔记"));
        } catch (error) {
          setStatus(t("打开失败：{error}", { error: errorText(error) }));
        } finally {
          sheet.inert = false;
          focusActiveSurface();
        }
      });
      historyList.appendChild(button);
    }
  } catch (error) {
    historyList.textContent = t("读取历史失败：{error}", { error: errorText(error) });
  }
});

function setStatus(text) {
  if (statusEl) statusEl.textContent = errorText(text);
}

function currentContent() {
  if (!previewEl.hidden) {
    flushEnclosingRules(previewEl);
    closeMathEditors(previewEl);
    editorEl.value = toMarkdown(previewEl.innerHTML);
  }
  return editorEl.value;
}

const pinButton = document.getElementById("btn-pin");
let pinBusy = false;

async function syncPinButton() {
  const pinned = await appWindow.isAlwaysOnTop();
  pinButton.setAttribute("aria-pressed", String(pinned));
  pinButton.classList.toggle("is-active", pinned);
  pinButton.title = pinned ? t("取消置顶") : t("置于所有窗口之上");
}

pinButton.addEventListener("click", async () => {
  if (pinBusy) return;
  pinBusy = true;
  try {
    await appWindow.setAlwaysOnTop(!(await appWindow.isAlwaysOnTop()));
    await syncPinButton();
  } catch (error) {
    setStatus(t("置顶设置失败：{error}", { error: errorText(error) }));
  } finally {
    pinBusy = false;
  }
});

document.getElementById("btn-new").addEventListener("click", async () => {
  const sheet = document.querySelector(".sheet");
  try {
    const content = currentContent();
    sheet.inert = true;
    if (!(await saveNow())) throw new Error(t("当前笔记未保存，已取消新建"));
    clearTimeout(saveTimer);
    const created = await invoke("new_note", {
      note: { content, format, file_path: currentNotePath },
      nextFormat: settings.default_format,
    });
    currentNotePath = created.file_path ?? null;
    previewEl.hidden = true;
    editorEl.value = "";
    settingsOpen = false;
    viewMode = "preview";
    closeTablePicker();
    setFormat(settings.default_format, { persist: false });
    updateCounter();
    flashStatus(content.trim() ? t("已新建，原笔记已归档") : t("已新建"));
  } catch (error) {
    setStatus(t("新建失败：{error}", { error: errorText(error) }));
  } finally {
    sheet.inert = false;
    focusActiveSurface();
  }
});

document.getElementById("btn-export-md").addEventListener("click", async () => {
  try {
    const exported = await invoke("export_markdown", { content: currentContent() });
    if (exported) flashStatus(t("Markdown 已导出"));
  } catch (error) {
    setStatus(errorText(error));
  }
});

const printDocument = document.createElement("article");
printDocument.className = "print-document preview";
document.body.appendChild(printDocument);

document.getElementById("btn-export-pdf").addEventListener("click", async () => {
  try {
    const content = currentContent();
    if (format === "plain") {
      printDocument.textContent = content;
      printDocument.classList.add("print-plain");
    } else {
      printDocument.classList.remove("print-plain");
      printDocument.innerHTML = DOMPurify.sanitize(marked.parse(content));
    }
    await document.fonts.ready;
    await invoke("print_note");
    flashStatus(t("在打印面板中选择另存为 PDF"));
  } catch (error) {
    setStatus(errorText(error));
  }
});

/* ---------- 窗口按钮 ---------- */

document.getElementById("btn-minimize")?.addEventListener("click", () => {
  appWindow.minimize();
});

document.getElementById("btn-maximize")?.addEventListener("click", () => {
  appWindow.toggleMaximize();
});

document.getElementById("btn-hide")?.addEventListener("click", () => {
  saveNow().finally(() => appWindow.hide());
});

// 退出按钮真正结束进程，区别于隐藏
document.getElementById("btn-quit")?.addEventListener("click", () => {
  quitAfterSave();
});

async function quitAfterSave() {
  if (await saveNow()) await invoke("quit_app");
}

// 标题栏空白处双击 = 最大化 / 还原
document.querySelector(".titlebar")?.addEventListener("dblclick", (event) => {
  if (event.target.closest(".icon-btn")) return;
  appWindow.toggleMaximize();
});

/* ---------- 自绘缩放热区 ---------- */

for (const grip of document.querySelectorAll(".resize-grip")) {
  grip.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    appWindow.startResizeDragging(grip.dataset.resize);
  });
}

/* ---------- 最大化状态同步 ---------- */

async function syncMaximized() {
  try {
    const maximized = await appWindow.isMaximized();
    document.body.classList.toggle("is-maximized", maximized);
  } catch {
    /* 忽略状态读取失败 */
  }
}

appWindow.onResized(syncMaximized);
syncMaximized();

/* ---------- 键盘与原生行为 ---------- */

document.addEventListener("keydown", (event) => {
  // 录制快捷键时让输入框独占按键
  if (recording) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const increase = event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
    const decrease = (event.key === "-" && !event.shiftKey) || event.code === "NumpadSubtract";
    if (increase || decrease) {
      event.preventDefault();
      changeFontSize(increase ? 1 : -1);
      return;
    }
  }
  if (!historyPanel.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      historyPanel.hidden = true;
      focusActiveSurface();
    }
    return;
  }

  // 表格选择器开着时独占按键
  if (handleTablePickerKey(event)) {
    event.preventDefault();
    return;
  }

  // 渲染态的输入即转换：行首标记、行内标记、结构内的回车退格等
  if (
    !settingsOpen &&
    !previewEl.hidden &&
    previewEl.contains(document.activeElement === previewEl ? previewEl : document.activeElement)
  ) {
    if (handlePreviewKeydown(event, previewEl)) {
      event.preventDefault();
      return;
    }
  }

  // 渲染态里按 Tab 走缩进语义，交给浏览器默认行为会跳出编辑区
  if (event.key === "Tab" && !previewEl.hidden && document.activeElement === previewEl) {
    event.preventDefault();
    document.execCommand("insertText", false, "  ");
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    // 设置面板打开时，Esc 先退回编辑而不是隐藏窗口
    if (settingsOpen) {
      toggleSettings();
      return;
    }
    saveNow().finally(() => appWindow.hide());
  }

  // Ctrl/Cmd+E 切换预览，Ctrl/Cmd+S 立即保存，Ctrl/Cmd+, 打开设置
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "e") {
    event.preventDefault();
    if (format === "markdown" && !settingsOpen) toggleView();
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveNow();
  }
  if (mod && event.key === ",") {
    event.preventDefault();
    toggleSettings();
  }

  if (!settingsOpen && runFormatShortcut(event, mod)) {
    event.preventDefault();
  }
});

/* ---------- 格式化快捷键 ---------- */

/** 所有格式化快捷键集中在这张表里，两种编辑态共用。
    key 用小写比较，数字键单独走标题分支。 */
const FORMAT_SHORTCUTS = [
  { key: "b", mod: true, command: "bold" },
  { key: "i", mod: true, command: "italic" },
  { key: "d", mod: true, shift: true, command: "strike" },
  { key: "k", mod: true, command: "link" },
  { key: "`", mod: true, command: "code" },
  { key: "`", mod: true, shift: true, command: "codeblock" },
  { key: "q", mod: true, shift: true, command: "quote" },
  { key: "u", mod: true, shift: true, command: "ul" },
  { key: "o", mod: true, shift: true, command: "ol" },

  { key: "m", mod: true, command: "math" },
  { key: "m", mod: true, shift: true, command: "mathblock" },
  { key: "-", mod: true, shift: true, command: "hr" },
];

function runFormatShortcut(event, mod) {
  if (!mod) return false;
  // 纯文本模式不做任何 Markdown 格式化
  if (format !== "markdown") return false;

  const key = event.key.toLowerCase();

  // 表格先让用户挑尺寸，再插入
  if (key === "t" && event.shiftKey) {
    openTablePicker();
    return true;
  }

  // Ctrl+1..6 设标题，Ctrl+0 回正文
  if (/^[0-6]$/.test(key) && !event.shiftKey && !event.altKey) {
    return runCommand("heading", editingContext, Number(key));
  }

  for (const entry of FORMAT_SHORTCUTS) {
    if (entry.key !== key) continue;
    if (!!entry.shift !== event.shiftKey) continue;
    if (entry.alt !== undefined && !!entry.alt !== event.altKey) continue;
    return runCommand(entry.command, editingContext, undefined);
  }
  return false;
}

document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

/* ---------- 编辑器状态 ---------- */

let format = "markdown";
/** "preview" | "source"；Markdown 默认停在可直接编辑的渲染态 */
let viewMode = "preview";
let syncingFromPreview = false;
let saveTimer = null;
let statusTimer = null;
let settingsOpen = false;
let recording = false;
let settings = { language: "zh", shortcut: "CmdOrCtrl+Shift+P", default_format: "markdown", autostart: false, notes_directory: "" };
const editingContext = { previewEl, editorEl };

/* ---------- 表格尺寸选择器 ---------- */

const TABLE_MAX_ROWS = 8;
const TABLE_MAX_COLS = 8;
const tablePicker = document.getElementById("table-picker");
const tableGrid = document.getElementById("table-grid");
const tablePickerLabel = document.getElementById("table-picker-label");
let tablePickerOpen = false;
let tableRows = 3;
let tableCols = 3;

// 8×8 的格子一次建好，之后只改高亮状态
for (let row = 1; row <= TABLE_MAX_ROWS; row += 1) {
  for (let col = 1; col <= TABLE_MAX_COLS; col += 1) {
    const cell = document.createElement("span");
    cell.className = "table-picker-cell";
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    tableGrid.appendChild(cell);
  }
}

function highlightTableSize(rows, cols) {
  tableRows = Math.min(TABLE_MAX_ROWS, Math.max(1, rows));
  tableCols = Math.min(TABLE_MAX_COLS, Math.max(1, cols));
  for (const cell of tableGrid.children) {
    const within =
      Number(cell.dataset.row) <= tableRows && Number(cell.dataset.col) <= tableCols;
    cell.classList.toggle("is-on", within);
  }
  // 标注的是内容行数，表头单独算，和用户心里的"几行几列"一致
  tablePickerLabel.textContent = t("{rows} 行 × {cols} 列", { rows: tableRows, cols: tableCols });
}

function openTablePicker() {
  tablePickerOpen = true;
  tablePicker.hidden = false;
  highlightTableSize(3, 3);
}

function closeTablePicker() {
  tablePickerOpen = false;
  tablePicker.hidden = true;
}

function confirmTableSize() {
  const rows = tableRows;
  const cols = tableCols;
  closeTablePicker();
  // 表头用占位名，省得插进去还要先想列名
  const headers = Array.from({ length: cols }, (_, index) => t("列 {index}", { index: index + 1 }));
  runCommand("table", editingContext, { headers, rows });
}

tableGrid.addEventListener("mousemove", (event) => {
  const cell = event.target.closest(".table-picker-cell");
  if (cell) highlightTableSize(Number(cell.dataset.row), Number(cell.dataset.col));
});

tableGrid.addEventListener("click", (event) => {
  const cell = event.target.closest(".table-picker-cell");
  if (!cell) return;
  highlightTableSize(Number(cell.dataset.row), Number(cell.dataset.col));
  confirmTableSize();
});

/** 选择器开着时独占方向键 / 回车 / Esc */
function handleTablePickerKey(event) {
  if (!tablePickerOpen) return false;

  switch (event.key) {
    case "Escape":
      closeTablePicker();
      focusActiveSurface();
      return true;
    case "Enter":
      confirmTableSize();
      return true;
    case "ArrowUp":
      highlightTableSize(tableRows - 1, tableCols);
      return true;
    case "ArrowDown":
      highlightTableSize(tableRows + 1, tableCols);
      return true;
    case "ArrowLeft":
      highlightTableSize(tableRows, tableCols - 1);
      return true;
    case "ArrowRight":
      highlightTableSize(tableRows, tableCols + 1);
      return true;
    default:
      return false;
  }
}

function focusActiveSurface() {
  if (previewEl.hidden) editorEl.focus();
  else previewEl.focus();
}

marked.setOptions({ breaks: true, gfm: true });

// 公式必须在解析期就识别：breaks:true 会把 $$ 块按行拆成多个文本节点，
// 解析后再扫文本是抓不全的。
marked.use({
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (src) => src.indexOf("$$"),
      tokenizer(src) {
        const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (!match) return undefined;
        return { type: "mathBlock", raw: match[0], text: match[1].trim() };
      },
      renderer: (token) => mathAtomHtml(token.text, true),
    },
    {
      name: "mathInline",
      level: "inline",
      start: (src) => src.indexOf("$"),
      tokenizer(src) {
        const match = /^\$([^$\n]+?)\$/.exec(src);
        if (!match) return undefined;
        return { type: "mathInline", raw: match[0], text: match[1].trim() };
      },
      renderer: (token) => mathAtomHtml(token.text, false),
    },
  ],
});

// 渲染态是真正可编辑的，所以需要把 HTML 回写成 Markdown 源码
const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndown.use(gfm);

// 默认的 "  \n" 会在源码里留下行尾空格，这里直接换行。
// 表格单元格里的占位 <br> 要吞掉，否则源码会被换行撑坏。
turndown.addRule("pulpLineBreak", {
  filter: "br",
  replacement: (_content, node) =>
    node.parentElement?.closest("td, th") ? "" : "\n",
});

// turndown-plugin-gfm 的删除线只写一个 ~，标准 GFM 要两个
turndown.addRule("pulpStrikethrough", {
  filter: ["del", "s", "strike"],
  replacement: (content) => (content.trim() === "" ? "" : `~~${content}~~`),
});

// 公式是 contenteditable=false 的原子节点，TeX 原文存在 data-tex 上
turndown.addRule("pulpMath", {
  filter: (node) =>
    node.classList?.contains("math-inline") || node.classList?.contains("math-block"),
  replacement: (_content, node) => {
    const tex = node.getAttribute("data-tex") ?? "";
    if (tex.trim() === "") return "";
    return node.classList.contains("math-block") ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
});

// 正在编辑中的公式保持源码形态，直接取文本
turndown.addRule("pulpMathEditing", {
  filter: (node) => node.classList?.contains("math-editing"),
  replacement: (_content, node) => node.textContent ?? "",
});

// turndown 默认写成 "-   项目"（三个空格），源码看着脏，收成一个空格
turndown.addRule("pulpListItem", {
  filter: "li",
  replacement: (content, node, options) => {
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "")
      .replace(/\n/g, "\n  ");

    const parent = node.parentNode;
    let prefix = `${options.bulletListMarker} `;
    if (parent.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? 1);
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = `${start + index}. `;
    }

    return `${prefix}${body}\n`;
  },
});

// Tab 键插入缩进而不是跳出编辑区
editorEl.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const { selectionStart, selectionEnd, value } = editorEl;
  editorEl.value = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
  editorEl.selectionStart = editorEl.selectionEnd = selectionStart + 2;
  scheduleSave();
});

editorEl.addEventListener("input", () => {
  updateCounter();
  scheduleSave();
});

function updateCounter() {
  const text = editorEl.value;
  const chars = [...text].length;
  const lines = text === "" ? 0 : text.split("\n").length;
  counterEl.textContent = t("{chars} 字 · {lines} 行", { chars, lines });
}

function flashStatus(text, revertTo = null) {
  setStatus(text);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => setStatus(revertTo ?? t("就绪")), 1200);
}

/* ---------- 持久化 ---------- */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  // 渲染态里的最新改动可能还没回写，落盘前先取一次
  if (!previewEl.hidden && !syncingFromPreview) {
    syncingFromPreview = true;
    editorEl.value = toMarkdown(previewEl.innerHTML);
    syncingFromPreview = false;
  }
  try {
    await invoke("save_note", {
      note: { content: editorEl.value, format, file_path: currentNotePath },
    });
    flashStatus(t("已保存"));
    return true;
  } catch (error) {
    setStatus(t("保存失败：{error}", { error: errorText(error) }));
    return false;
  }
}

// 隐藏窗口前落盘，避免丢掉最后几百毫秒的输入
appWindow.onCloseRequested(saveNow);
window.addEventListener("beforeunload", saveNow);

/* ---------- 格式与预览 ---------- */

function renderPreview() {
  const raw = editorEl.value.trim();
  if (raw === "") {
    // 空文档也要给一个可以落光标的段落，占位文字由 CSS 画
    previewEl.innerHTML = "<p><br></p>";
    previewEl.classList.add("is-blank");
    return;
  }
  // KaTeX 会生成 MathML，sanitize 默认会把它剥掉
  previewEl.innerHTML = DOMPurify.sanitize(marked.parse(raw), {
    ADD_ATTR: ["contenteditable", "data-tex"],
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });
  previewEl.classList.remove("is-blank");
}

// 点公式就地改 TeX
previewEl.addEventListener("click", (event) => {
  if (previewEl.hidden) return;
  const atom = event.target.closest?.(".math-inline, .math-block");
  if (atom) {
    event.preventDefault();
    closeMathEditors(previewEl);
    openMathEditor(atom, previewEl);
  }
});

// 光标移出公式就收起它重新渲染（嵌套 contenteditable 收不到 blur，只能盯选区）
document.addEventListener("selectionchange", () => {
  if (previewEl.hidden) return;
  if (!previewEl.querySelector(".math-editing")) return;
  const keep = activeMathEditor(previewEl);
  if (closeMathEditors(previewEl, keep)) syncFromPreview();
});

/** 渲染态里的编辑结果回写成 Markdown 源码。
    注意此处绝不重新渲染，否则光标会被打飞。 */
function syncFromPreview() {
  if (previewEl.hidden) return;
  syncingFromPreview = true;
  editorEl.value = toMarkdown(previewEl.innerHTML);
  syncingFromPreview = false;
  updateCounter();
  scheduleSave();
}

/** 渲染态 HTML -> Markdown 源码。
    零宽空格是行内转换时用来"跳出"样式的辅助字符，不该进源码。 */
function toMarkdown(html) {
  return turndown.turndown(html).replace(/\u200b/g, "").trim();
}

previewEl.addEventListener("input", () => {
  previewEl.classList.remove("is-blank");
  syncFromPreview();
});

// 渲染态里粘贴一律降成纯文本，避免把外部样式塞进文档
previewEl.addEventListener("paste", (event) => {
  if (previewEl.hidden) return;
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") ?? "";
  document.execCommand("insertText", false, text);
});

/** 集中控制编辑区 / 预览区 / 设置面板的可见性 */
function applyView() {
  // 纯文本模式没有渲染一说，始终留在源码态
  const showPreview = !settingsOpen && format === "markdown" && viewMode === "preview";
  const showEditor = !settingsOpen && !showPreview;

  // 先于隐藏取回渲染态的改动，避免切走时丢字
  if (!previewEl.hidden && !showPreview) {
    flushEnclosingRules(previewEl);
    closeMathEditors(previewEl);
    syncFromPreview();
  }

  editorEl.hidden = !showEditor;
  previewEl.hidden = !showPreview;
  previewEl.contentEditable = showPreview ? "true" : "false";
  settingsEl.hidden = !settingsOpen;

  document.body.classList.toggle("is-settings", settingsOpen);
  document.body.classList.toggle("is-preview", showPreview);
  settingsBtn.classList.toggle("is-active", settingsOpen);
  settingsBtn.title = settingsOpen ? t("返回编辑 (Ctrl+,)") : t("设置 (Ctrl+,)");

  // 按钮写的是"点下去会到哪里"，和 Typora 左下角一个意思
  viewToggleLabel.textContent = showPreview ? t("源码") : t("渲染");
  viewToggleBtn.classList.toggle("is-source", !showPreview);

  if (showPreview) renderPreview();
}

function setViewMode(mode) {
  if (settingsOpen) return;
  viewMode = mode === "source" ? "source" : "preview";
  applyView();
  if (viewMode === "source") editorEl.focus();
  else if (!previewEl.hidden) previewEl.focus();
}

/** 左下角按钮 / Ctrl+E：源码与渲染二态切换 */
function toggleView() {
  setViewMode(viewMode === "preview" ? "source" : "preview");
}

function setFormat(next, { persist = true } = {}) {
  format = next === "plain" ? "plain" : "markdown";
  document.body.classList.toggle("is-plain", format === "plain");

  for (const btn of document.querySelectorAll(".mode-btn")) {
    btn.classList.toggle("is-active", btn.dataset.format === format);
  }

  applyView();

  if (persist) scheduleSave();
}

viewToggleBtn.addEventListener("click", toggleView);

for (const btn of document.querySelectorAll(".mode-btn")) {
  btn.addEventListener("click", () => {
    setFormat(btn.dataset.format);
    // 切格式后焦点别留在按钮上，直接回到当前可写的那一侧
    if (previewEl.hidden) editorEl.focus();
    else previewEl.focus();
  });
}

/* ---------- 设置面板 ---------- */

const IS_MAC = navigator.userAgent.includes("Mac");

/** 把 Tauri 加速键写法转成给人看的样子 */
function prettyAccelerator(accelerator) {
  if (!accelerator) return "";
  return accelerator
    .split("+")
    .map((part) => {
      const key = part.trim();
      const lower = key.toLowerCase();
      if (lower === "cmdorctrl" || lower === "commandorcontrol") {
        return IS_MAC ? "⌘" : "Ctrl";
      }
      if (lower === "cmd" || lower === "command" || lower === "super" || lower === "meta") {
        return IS_MAC ? "⌘" : "Win";
      }
      if (lower === "ctrl" || lower === "control") return IS_MAC ? "⌃" : "Ctrl";
      if (lower === "shift") return IS_MAC ? "⇧" : "Shift";
      if (lower === "alt" || lower === "option") return IS_MAC ? "⌥" : "Alt";
      return key.length === 1 ? key.toUpperCase() : key;
    })
    .join(IS_MAC ? "" : "+");
}

/** 把一次 keydown 转成 Tauri 加速键；不合法则返回 null */
function acceleratorFromEvent(event) {
  const key = event.key;

  // 只按修饰键不算完整组合
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(key)) return null;

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Cmd");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  // 必须带修饰键，否则会把普通打字也抢走
  if (parts.length === 0) return null;

  let main;
  if (/^[a-z]$/i.test(key)) main = key.toUpperCase();
  else if (/^[0-9]$/.test(key)) main = key;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) main = key;
  else if (key === " ") main = "Space";
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
    main = key.replace("Arrow", "");
  } else if (["Enter", "Tab", "Backspace", "Delete", "Home", "End", "Insert"].includes(key)) {
    main = key;
  } else if (["PageUp", "PageDown"].includes(key)) {
    main = key === "PageUp" ? "PageUp" : "PageDown";
  } else if (/^[`\-=\[\]\\;',.\/]$/.test(key)) {
    main = key;
  } else {
    return null;
  }

  return [...parts, main].join("+");
}

function setShortcutFeedback(text, kind = "") {
  shortcutFeedback.textContent = text;
  shortcutFeedback.classList.toggle("is-error", kind === "error");
  shortcutFeedback.classList.toggle("is-ok", kind === "ok");
}

function stopRecording() {
  recording = false;
  shortcutInput.classList.remove("is-recording");
  shortcutInput.value = prettyAccelerator(settings.shortcut);
}

shortcutInput.addEventListener("focus", () => {
  recording = true;
  shortcutInput.classList.add("is-recording");
  shortcutInput.value = t("按下组合键…");
  setShortcutFeedback(t("按 Esc 取消录制。"));
});

shortcutInput.addEventListener("blur", stopRecording);

shortcutInput.addEventListener("keydown", async (event) => {
  if (!recording) return;

  // 录制期间吞掉所有按键，避免触发全局 Esc / Ctrl+S 等
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    shortcutInput.blur();
    setShortcutFeedback(t("已取消，快捷键未改动。"));
    return;
  }

  const accelerator = acceleratorFromEvent(event);
  if (!accelerator) {
    setShortcutFeedback(t("需要至少一个修饰键（Ctrl / Alt / Shift / Cmd）。"), "error");
    return;
  }

  if (accelerator === settings.shortcut) {
    shortcutInput.blur();
    setShortcutFeedback(t("与当前快捷键相同，未改动。"));
    return;
  }

  shortcutInput.value = prettyAccelerator(accelerator);
  setShortcutFeedback(t("正在注册…"));

  const ok = await persistSettings({ shortcut: accelerator });
  if (ok) {
    setShortcutFeedback(t("已生效：{shortcut}", { shortcut: prettyAccelerator(accelerator) }), "ok");
  }
  shortcutInput.blur();
});

formatSelect.addEventListener("change", () => {
  persistSettings({ default_format: formatSelect.value });
});

autostartCheck.addEventListener("change", async () => {
  const wanted = autostartCheck.checked;
  autostartFeedback.textContent = "";
  autostartFeedback.classList.remove("is-error", "is-ok");
  const ok = await persistSettings({ autostart: wanted });
  if (ok) {
    autostartFeedback.textContent = wanted ? t("已加入开机启动。") : t("已取消开机启动。");
    autostartFeedback.classList.add("is-ok");
  } else {
    autostartCheck.checked = !wanted;
  }
});

document.getElementById("btn-reset-shortcut").addEventListener("click", async () => {
  const fallback = "CmdOrCtrl+Shift+P";
  if (settings.shortcut === fallback) {
    setShortcutFeedback(t("当前已是默认快捷键。"));
    return;
  }
  const ok = await persistSettings({ shortcut: fallback });
  if (ok) setShortcutFeedback(t("已恢复默认：{shortcut}", { shortcut: prettyAccelerator(fallback) }), "ok");
});

/** 把改动合并进设置并落盘；失败时回滚界面并提示 */
async function persistSettings(patch) {
  const next = { ...settings, ...patch };
  try {
    const saved = await invoke("save_settings", { settings: next });
    settings = saved;
    syncSettingsUI();
    flashStatus(t("设置已保存"));
    return true;
  } catch (error) {
    syncSettingsUI();
    setShortcutFeedback(errorText(error), "error");
    if (patch.autostart !== undefined) {
      autostartFeedback.textContent = errorText(error);
      autostartFeedback.classList.add("is-error");
    }
    return false;
  }
}

function syncSettingsUI() {
  setLanguage(settings.language ?? "zh");
  languageSelect.value = getLanguage();
  shortcutInput.value = prettyAccelerator(settings.shortcut);
  formatSelect.value = settings.default_format;
  autostartCheck.checked = settings.autostart;
  notesDirectory.value = settings.notes_directory || t("系统默认（应用数据目录下的 notes 文件夹）");
  notesDirectory.title = notesDirectory.value;
}

languageSelect.addEventListener("change", async () => {
  languageSelect.disabled = true;
  try {
    if (!(await persistSettings({ language: languageSelect.value }))) return;
    applyView();
    updateCounter();
    highlightTableSize(tableRows, tableCols);
    syncPinButton().catch(setStatus);
    shortcutFeedback.textContent = t("点击输入框后直接按组合键，需至少一个修饰键。");
    directoryFeedback.textContent = t("仅对之后新建的笔记生效，Markdown 保存为 .md，纯文本保存为 .txt。");
    autostartFeedback.textContent = "";
  } finally {
    languageSelect.disabled = false;
  }
});

chooseDirectoryButton.addEventListener("click", async () => {
  chooseDirectoryButton.disabled = true;
  directoryFeedback.textContent = "";
  try {
    const selected = await invoke("choose_notes_directory");
    if (!selected) return;
    if (!(await persistSettings({ notes_directory: selected }))) {
      directoryFeedback.textContent = t("保存失败，请检查文件夹权限后重试。");
      return;
    }
    directoryFeedback.textContent = t("已设置，之后新建的笔记会保存到此文件夹。已有笔记位置不变。");
  } catch (error) {
    directoryFeedback.textContent = t("设置失败：{error}", { error: errorText(error) });
  } finally {
    chooseDirectoryButton.disabled = false;
  }
});

function toggleSettings() {
  settingsOpen = !settingsOpen;
  applyView();
  if (settingsOpen) syncSettingsUI();
  else editorEl.focus();
}

settingsBtn.addEventListener("click", toggleSettings);

/* ---------- 初始化 ---------- */

async function init() {
  // 设置要先读，因为新笔记的格式取决于默认格式
  try {
    settings = await invoke("load_settings");
  } catch {
    /* 读不到就用内置默认值 */
  }
  syncSettingsUI();

  syncPinButton().catch((error) => setStatus(errorText(error)));

  try {
    const note = await invoke("load_note");
    currentNotePath = note.file_path ?? null;
    editorEl.value = note.content ?? "";
    // 已有笔记沿用它自己的格式；空笔记按设置里的默认格式开
    const isNewNote = (note.content ?? "") === "";
    const initialFormat = isNewNote
      ? settings.default_format
      : note.format ?? settings.default_format;
    setFormat(initialFormat, { persist: false });
  } catch (error) {
    setFormat(settings.default_format, { persist: false });
    setStatus(t("读取笔记失败：{error}", { error: errorText(error) }));
  }
  updateCounter();

  try {
    const state = await invoke("shortcut_state");
    if (state.registered) {
      setStatus(t("就绪"));
    } else {
      setStatus(t("快捷键 {shortcut} 被占用", { shortcut: prettyAccelerator(state.accelerator) }));
      setShortcutFeedback(
        t("当前快捷键 {shortcut} 注册失败，请换一个组合。", { shortcut: prettyAccelerator(state.accelerator) }),
        "error",
      );
    }
  } catch (error) {
    setStatus(errorText(error));
  }

  if (previewEl.hidden) editorEl.focus();
  else previewEl.focus();
}

init();
