import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
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

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
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
  pinButton.title = pinned ? "取消置顶" : "置于所有窗口之上";
}

pinButton.addEventListener("click", async () => {
  if (pinBusy) return;
  pinBusy = true;
  try {
    await appWindow.setAlwaysOnTop(!(await appWindow.isAlwaysOnTop()));
    await syncPinButton();
  } catch (error) {
    setStatus(`置顶设置失败：${error}`);
  } finally {
    pinBusy = false;
  }
});

document.getElementById("btn-new").addEventListener("click", async () => {
  const sheet = document.querySelector(".sheet");
  try {
    const content = currentContent();
    sheet.inert = true;
    await saveNow();
    clearTimeout(saveTimer);
    await invoke("new_note", {
      note: { content, format },
      nextFormat: settings.default_format,
    });
    previewEl.hidden = true;
    editorEl.value = "";
    settingsOpen = false;
    viewMode = "preview";
    closeTablePicker();
    setFormat(settings.default_format, { persist: false });
    updateCounter();
    flashStatus(content.trim() ? "已新建，原笔记已归档" : "已新建");
  } catch (error) {
    setStatus(`新建失败：${error}`);
  } finally {
    sheet.inert = false;
    focusActiveSurface();
  }
});

document.getElementById("btn-export-md").addEventListener("click", async () => {
  try {
    const exported = await invoke("export_markdown", { content: currentContent() });
    if (exported) flashStatus("Markdown 已导出");
  } catch (error) {
    setStatus(String(error));
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
    flashStatus("在打印面板中选择另存为 PDF");
  } catch (error) {
    setStatus(String(error));
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
  saveNow().finally(() => invoke("quit_app"));
});

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
  { key: "=", mod: true, command: "heading-up" },
  { key: "-", mod: true, command: "heading-down" },
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
let settings = { shortcut: "CmdOrCtrl+Shift+P", default_format: "markdown", autostart: false };
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
  tablePickerLabel.textContent = `${tableRows} 行 × ${tableCols} 列`;
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
  const headers = Array.from({ length: cols }, (_, index) => `列 ${index + 1}`);
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
  counterEl.textContent = `${chars} 字 · ${lines} 行`;
}

function flashStatus(text, revertTo = "就绪") {
  setStatus(text);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => setStatus(revertTo), 1200);
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
      note: { content: editorEl.value, format },
    });
    flashStatus("已保存");
  } catch (error) {
    setStatus(`保存失败：${error}`);
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
  settingsBtn.title = settingsOpen ? "返回编辑 (Ctrl+,)" : "设置 (Ctrl+,)";

  // 按钮写的是"点下去会到哪里"，和 Typora 左下角一个意思
  viewToggleLabel.textContent = showPreview ? "源码" : "渲染";
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
  shortcutInput.value = "按下组合键…";
  setShortcutFeedback("按 Esc 取消录制。");
});

shortcutInput.addEventListener("blur", stopRecording);

shortcutInput.addEventListener("keydown", async (event) => {
  if (!recording) return;

  // 录制期间吞掉所有按键，避免触发全局 Esc / Ctrl+S 等
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    shortcutInput.blur();
    setShortcutFeedback("已取消，快捷键未改动。");
    return;
  }

  const accelerator = acceleratorFromEvent(event);
  if (!accelerator) {
    setShortcutFeedback("需要至少一个修饰键（Ctrl / Alt / Shift / Cmd）。", "error");
    return;
  }

  if (accelerator === settings.shortcut) {
    shortcutInput.blur();
    setShortcutFeedback("与当前快捷键相同，未改动。");
    return;
  }

  shortcutInput.value = prettyAccelerator(accelerator);
  setShortcutFeedback("正在注册…");

  const ok = await persistSettings({ shortcut: accelerator });
  if (ok) {
    setShortcutFeedback(`已生效：${prettyAccelerator(accelerator)}`, "ok");
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
    autostartFeedback.textContent = wanted ? "已加入开机启动。" : "已取消开机启动。";
    autostartFeedback.classList.add("is-ok");
  } else {
    autostartCheck.checked = !wanted;
  }
});

document.getElementById("btn-reset-shortcut").addEventListener("click", async () => {
  const fallback = "CmdOrCtrl+Shift+P";
  if (settings.shortcut === fallback) {
    setShortcutFeedback("当前已是默认快捷键。");
    return;
  }
  const ok = await persistSettings({ shortcut: fallback });
  if (ok) setShortcutFeedback(`已恢复默认：${prettyAccelerator(fallback)}`, "ok");
});

/** 把改动合并进设置并落盘；失败时回滚界面并提示 */
async function persistSettings(patch) {
  const next = { ...settings, ...patch };
  try {
    const saved = await invoke("save_settings", { settings: next });
    settings = saved;
    syncSettingsUI();
    flashStatus("设置已保存");
    return true;
  } catch (error) {
    syncSettingsUI();
    setShortcutFeedback(String(error), "error");
    if (patch.autostart !== undefined) {
      autostartFeedback.textContent = String(error);
      autostartFeedback.classList.add("is-error");
    }
    return false;
  }
}

function syncSettingsUI() {
  shortcutInput.value = prettyAccelerator(settings.shortcut);
  formatSelect.value = settings.default_format;
  autostartCheck.checked = settings.autostart;
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  applyView();
  if (settingsOpen) syncSettingsUI();
  else editorEl.focus();
}

settingsBtn.addEventListener("click", toggleSettings);

/* ---------- 初始化 ---------- */

async function init() {
  syncPinButton().catch((error) => setStatus(String(error)));
  // 设置要先读，因为新笔记的格式取决于默认格式
  try {
    settings = await invoke("load_settings");
  } catch {
    /* 读不到就用内置默认值 */
  }
  syncSettingsUI();

  try {
    const note = await invoke("load_note");
    editorEl.value = note.content ?? "";
    // 已有笔记沿用它自己的格式；空笔记按设置里的默认格式开
    const isNewNote = (note.content ?? "") === "";
    const initialFormat = isNewNote
      ? settings.default_format
      : note.format ?? settings.default_format;
    setFormat(initialFormat, { persist: false });
  } catch (error) {
    setFormat(settings.default_format, { persist: false });
    setStatus(`读取笔记失败：${error}`);
  }
  updateCounter();

  try {
    const state = await invoke("shortcut_state");
    if (state.registered) {
      setStatus("就绪");
    } else {
      setStatus(`快捷键 ${prettyAccelerator(state.accelerator)} 被占用`);
      setShortcutFeedback(
        `当前快捷键 ${prettyAccelerator(state.accelerator)} 注册失败，请换一个组合。`,
        "error",
      );
    }
  } catch (error) {
    setStatus(String(error));
  }

  if (previewEl.hidden) editorEl.focus();
  else previewEl.focus();
}

init();
