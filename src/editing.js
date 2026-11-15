/* Markdown 编辑能力：渲染态的输入即转换 + 两种模式通用的格式化命令。
   渲染态直接操作 DOM（光标由浏览器自然维护），源码态操作文本。 */

import katex from "katex";
import { t } from "./i18n.js";

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "BLOCKQUOTE", "PRE", "TD", "TH", "DIV",
]);


/* ---------- 数学公式 ---------- */

/** 把 TeX 渲染成 KaTeX HTML；出错时退回显示源码，不让异常冒出去 */
export function renderTex(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return `<code>${escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`)}</code>`;
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );
}

/** 公式在文档里是不可编辑的原子节点，TeX 原文挂在 data-tex 上 */
export function mathAtomHtml(tex, displayMode) {
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "math-block" : "math-inline";
  return (
    `<${tag} class="${cls}" data-tex="${escapeHtml(tex)}" contenteditable="false">` +
    `${renderTex(tex, displayMode)}</${tag}>`
  );
}

/** 点击公式时把原子换成可编辑的 $…$ 源码，失焦后再渲染回去。
    中途若直接保存，留在文档里的也是合法 Markdown，不会丢内容。 */
export function openMathEditor(atom, root) {
  const displayMode = atom.classList.contains("math-block");
  const tex = atom.getAttribute("data-tex") ?? "";
  const holder = document.createElement(displayMode ? "div" : "span");
  holder.className = displayMode ? "math-editing math-editing-block" : "math-editing";
  holder.setAttribute("contenteditable", "true");
  holder.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`;
  atom.replaceWith(holder);

  // holder 自己是个 contenteditable，必须显式聚焦，
  // 否则焦点留在外层 root 上，输入会替换整个选区且 blur 永不触发
  holder.focus();

  // 新建的空公式把光标放在两个 $ 中间，已有公式则全选方便改写
  const range = document.createRange();
  if (tex === "") {
    const textNode = holder.firstChild;
    const caret = displayMode ? 2 : 1;
    range.setStart(textNode, caret);
    range.collapse(true);
  } else {
    range.selectNodeContents(holder);
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let closed = false;
  const close = () => {
    if (closed || !holder.isConnected) return;
    closed = true;
    const raw = holder.textContent ?? "";
    const match = raw.match(/^\s*\$\$([\s\S]*)\$\$\s*$/) ?? raw.match(/^\s*\$([\s\S]*)\$\s*$/);
    const nextTex = (match ? match[1] : raw).trim();

    if (nextTex === "") {
      // 空公式直接丢掉，但要保证块里还留着能落光标的地方
      const host = holder.parentElement;
      holder.remove();
      if (host && host !== root && host.textContent.trim() === "") {
        host.appendChild(document.createElement("br"));
      }
    } else {
      const block = displayMode || /^\s*\$\$[\s\S]*\$\$\s*$/.test(raw);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = mathAtomHtml(nextTex, block);
      const atomNode = wrapper.firstElementChild;
      holder.replaceWith(atomNode);

      // 光标落到公式后面，接着打字不会掉进公式内部
      const after = document.createRange();
      after.setStartAfter(atomNode);
      after.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(after);
    }
    root.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // 嵌套 contenteditable 里 activeElement 始终是外层 host，blur 根本不会触发，
  // 所以把收尾函数挂在节点上，由 handlePreviewKeydown / 选区变化统一调用。
  holder.__closeMath = close;
  return holder;
}

/** 光标是否停在某个正在编辑的公式里 */
export function activeMathEditor(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).startContainer;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const holder = element?.closest?.(".math-editing");
  return holder && root.contains(holder) ? holder : null;
}

/** 收起文档里所有打开着的公式编辑器（除了 keep 指定的那个） */
export function closeMathEditors(root, keep = null) {
  let changed = false;
  for (const holder of root.querySelectorAll(".math-editing")) {
    if (holder === keep) continue;
    holder.__closeMath?.();
    changed = true;
  }
  return changed;
}

/* ---------- 选区与块级工具 ---------- */

function currentRange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0);
}

function blockOf(node, root) {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (current && current !== root) {
    if (BLOCK_TAGS.has(current.nodeName)) return current;
    current = current.parentNode;
  }
  return null;
}

function placeCaret(node, atStart = false) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(atStart);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 换掉块元素的标签但保留内容，返回新元素 */
function retagBlock(block, tag) {
  if (block.nodeName === tag) return block;
  const next = document.createElement(tag);
  while (block.firstChild) next.appendChild(block.firstChild);
  if (next.childNodes.length === 0) next.appendChild(document.createElement("br"));
  block.replaceWith(next);
  return next;
}

function emptyParagraph() {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}
/* ---------- 输入即转换（Typora 风格） ---------- */

/** 行首标记：光标前整段文字匹配时，把这一块变成对应结构。
    每条规则只在“刚敲下触发键”的那一刻跑一次。 */
const LINE_RULES = [
  {
    // ### 三级标题
    test: /^(#{1,6})\s$/,
    apply: (block, match) => {
      const level = match[1].length;
      const next = retagBlock(block, `H${level}`);
      next.textContent = "";
      next.appendChild(document.createElement("br"));
      placeCaret(next, true);
      return true;
    },
  },
  {
    // - 无序列表 / * 无序列表 / + 无序列表
    test: /^[-*+]\s$/,
    apply: (block) => wrapInList(block, "UL"),
  },
  {
    // 1. 有序列表
    test: /^(\d{1,3})[.)]\s$/,
    apply: (block, match) => wrapInList(block, "OL", Number(match[1])),
  },
  {
    // > 引用
    test: /^>\s$/,
    apply: (block) => {
      const quote = document.createElement("blockquote");
      const inner = emptyParagraph();
      quote.appendChild(inner);
      block.replaceWith(quote);
      placeCaret(inner, true);
      return true;
    },
  },
  {
    // ``` 代码块（含可选语言）
    test: /^```([a-zA-Z0-9+#-]*)$/,
    trigger: "Enter",
    apply: (block, match) => {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (match[1]) code.className = `language-${match[1]}`;
      code.textContent = "\n";
      pre.appendChild(code);
      block.replaceWith(pre);
      placeCaret(code, true);
      return true;
    },
  },
  {
    // $$ 公式块
    test: /^\$\$$/,
    trigger: "Enter",
    apply: (block, _match, root) => {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = mathAtomHtml("", true);
      const atom = wrapper.firstElementChild;
      block.replaceWith(atom);
      const tail = emptyParagraph();
      atom.after(tail);
      openMathEditor(atom, root);
      return true;
    },
  },
  {
    // --- 分割线
    test: /^(-{3,}|\*{3,}|_{3,})$/,
    trigger: "Enter",
    apply: (block) => {
      const hr = document.createElement("hr");
      block.replaceWith(hr);
      const tail = emptyParagraph();
      hr.after(tail);
      placeCaret(tail, true);
      return true;
    },
  },
  {
    // | 列1 | 列2 |  → 按竖线数量建表
    test: /^\|(.+)\|$/,
    trigger: "Enter",
    apply: (block, match) => {
      const headers = match[1].split("|").map((part) => part.trim());
      if (headers.length < 1) return false;
      const table = buildTable(headers, 1);
      block.replaceWith(table);
      const tail = emptyParagraph();
      table.after(tail);
      placeCaret(table.querySelector("tbody td"), true);
      return true;
    },
  },
];

function wrapInList(block, listTag, start) {
  const list = document.createElement(listTag);
  if (listTag === "OL" && start && start !== 1) list.setAttribute("start", String(start));
  const item = document.createElement("li");
  item.appendChild(document.createElement("br"));
  list.appendChild(item);

  // 本来就在列表里的话，接着往同一个列表里加，别嵌套
  if (block.nodeName === "LI") {
    block.textContent = "";
    block.appendChild(document.createElement("br"));
    placeCaret(block, true);
    return true;
  }

  block.replaceWith(list);
  placeCaret(item, true);
  return true;
}

function buildTable(headers, rows = 1) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of headers) {
    const th = document.createElement("th");
    th.textContent = text || " ";
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (let line = 0; line < Math.max(1, rows); line += 1) {
    const bodyRow = document.createElement("tr");
    for (let index = 0; index < headers.length; index += 1) {
      const td = document.createElement("td");
      td.appendChild(document.createElement("br"));
      bodyRow.appendChild(td);
    }
    tbody.appendChild(bodyRow);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

/** 行内标记：**粗体** *斜体* `代码` ~~删除~~ $公式$，在闭合符敲下时成形 */
const INLINE_RULES = [
  { pattern: /\*\*([^*\n]+)\*\*$/, command: "bold" },
  { pattern: /__([^_\n]+)__$/, command: "bold" },
  { pattern: /(?:^|[^*])\*([^*\n]+)\*$/, command: "italic", group: 1 },
  { pattern: /(?:^|[^_])_([^_\n]+)_$/, command: "italic", group: 1 },
  { pattern: /~~([^~\n]+)~~$/, command: "strike" },
  { pattern: /`([^`\n]+)`$/, command: "code" },
  // $$…$$ 必须排在前面，否则会被行内公式规则拆坏
  { pattern: /\$\$([^$\n]+)\$\$$/, command: "mathblock" },
  // 前面不能再有 $，避免打 $$x$$ 的中途被当成行内公式
  { pattern: /(?:^|[^$])\$([^$\n]+)\$$/, command: "math", group: 1 },
];

/** 在文本节点里把 markdown 标记替换成真实元素。
    做法是先删掉标记文本，再插入元素，这样光标自然落在元素之后。 */
function applyInlineRule(textNode, offset, root) {
  const text = textNode.textContent.slice(0, offset);

  for (const rule of INLINE_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    const inner = match[rule.group ?? 1];
    if (!inner || inner.trim() === "") continue;

    const from = findMarkerStart(text, match, rule);
    if (from < 0) continue;

    const range = document.createRange();
    range.setStart(textNode, from);
    range.setEnd(textNode, offset);
    range.deleteContents();

    const node = buildInlineNode(rule.command, inner);
    range.insertNode(node);
    finishInlineInsert(node, rule.command, root);
    return true;
  }
  return false;
}

/** 行内/块级元素插入后的统一收尾：摆正位置并放好光标 */
function finishInlineInsert(node, command, root) {
  if (command === "mathblock") {
    // 块级公式不能待在 <p> 里，提到段落外面去。
    // 从父节点找起，否则 blockOf 会把公式 div 自己当成宿主。
    const host = blockOf(node.parentNode, root);
    if (host && host !== root && host.nodeName === "P") {
      host.after(node);
      if (host.textContent.trim() === "") host.remove();
    }
    let tail = node.nextElementSibling;
    if (!tail || tail.nodeName !== "P") {
      tail = emptyParagraph();
      node.after(tail);
    }
    placeCaret(tail, true);
  } else {
    // 行内元素后补一个零宽空格，避免光标被困在加粗区里继续加粗
    const tail = document.createTextNode("\u200b");
    node.after(tail);
    const after = document.createRange();
    after.setStart(tail, 1);
    after.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(after);
  }

  root.dispatchEvent(new Event("input", { bubbles: true }));
}
/** 算出要删除的起始位置：match[0] 去掉可能的前导字符后在 text 里的落点 */
function findMarkerStart(text, match, rule) {
  let token = match[0];
  // 带前导字符的规则（斜体、行内公式）先把那个字符剥掉
  if (rule.group === 1 && !/^[*_$]/.test(token)) token = token.slice(1);
  const from = text.length - token.length;
  return from >= 0 ? from : -1;
}

function buildInlineNode(command, inner) {
  if (command === "code") {
    const code = document.createElement("code");
    code.textContent = inner;
    return code;
  }
  if (command === "math" || command === "mathblock") {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = mathAtomHtml(inner, command === "mathblock");
    return wrapper.firstElementChild;
  }
  const tag = command === "bold" ? "strong" : command === "italic" ? "em" : "del";
  const element = document.createElement(tag);
  element.textContent = inner;
  return element;
}
/* ---------- 渲染态按键入口 ---------- */

/** 处理渲染态里的一次 keydown。返回 true 表示已消费，调用方应 preventDefault。 */
export function handlePreviewKeydown(event, root) {
  // 公式编辑态优先：Esc / Enter 收起并渲染，其余按键照常输入
  const mathHolder = activeMathEditor(root);
  if (mathHolder) {
    if (event.key === "Escape" || event.key === "Enter") {
      mathHolder.__closeMath?.();
      root.focus();
      return true;
    }
    return false;
  }

  const range = currentRange();
  if (!range || !range.collapsed) return false;

  const block = blockOf(range.startContainer, root);
  if (!block) return false;

  // 代码块里只认 Esc 跳出，其余按键一律当字面量
  if (block.nodeName === "PRE" || block.closest?.("pre")) {
    if (event.key === "Escape") {
      const pre = block.nodeName === "PRE" ? block : block.closest("pre");
      let tail = pre.nextElementSibling;
      if (!tail || tail.nodeName === "PRE") {
        tail = emptyParagraph();
        pre.after(tail);
      }
      placeCaret(tail, true);
      return true;
    }
    return false;
  }

  if (event.key === "Enter") {
    if (runLineRules(block, root, "Enter")) return true;
    // 回车前把夹在标记中间、还没成形的内容结算掉
    if (flushEnclosingRules(root)) return true;
    if (exitEmptyBlock(block, root)) return true;
    return false;
  }

  if (event.key === " ") {
    if (runLineRules(block, root, " ")) return true;
    return false;
  }

  // 任何可打印字符落下后都试一次行内转换。
  // 只认闭合符是不够的：先打好 $$$$ 再回到中间补公式时，
  // 最后敲下的是普通字符，闭合符早就在右边了。
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return tryInlineAfterKey(event, root);
  }

  if (event.key === "Backspace") {
    return unwrapOnBackspace(block, root, range);
  }

  if (event.key === "Tab") {
    return handleTab(event, block, root);
  }

  return false;
}

/** 行首规则：把光标前的文本凑齐后匹配。空格触发的规则不含触发键本身。 */
function runLineRules(block, root, trigger) {
  const range = currentRange();
  if (!range) return false;

  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  const before = probe.toString();

  // 光标必须在块首那一段，后面不能已经有别的内容
  const full = block.textContent ?? "";
  if (full.trim() !== before.trim()) return false;

  for (const rule of LINE_RULES) {
    const ruleTrigger = rule.trigger ?? " ";
    if (ruleTrigger !== trigger) continue;

    const candidate = trigger === " " ? `${before} ` : before;
    const match = candidate.match(rule.test);
    if (!match) continue;

    if (rule.apply(block, match, root)) {
      root.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }
  return false;
}

function tryInlineAfterKey(event, root) {
  const range = currentRange();
  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return false;

  // 先让这个字符真的落进文本，再回头匹配
  const textNode = range.startContainer;
  const offset = range.startOffset;
  event.preventDefault();
  textNode.insertData(offset, event.key);

  const after = document.createRange();
  after.setStart(textNode, offset + 1);
  after.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(after);

  // 刚敲下闭合符就地成形
  if (applyInlineRule(textNode, offset + 1, root)) return true;

  // 夹在一对标记中间时不能边打边转，否则刚写一个字就被吃掉。
  // 停手 600ms 再收尾，手感接近 Typora。
  scheduleEnclosingCheck(textNode, root);
  root.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

let enclosingTimer = null;

/** 延迟检查"光标夹在标记中间"的情况，等用户把内容写完 */
function scheduleEnclosingCheck(textNode, root) {
  clearTimeout(enclosingTimer);
  enclosingTimer = setTimeout(() => {
    const range = currentRange();
    if (!range || !range.collapsed) return;
    // 光标必须还在同一个文本节点里，否则用户已经走开了
    if (range.startContainer !== textNode || !textNode.isConnected) return;
    if (!root.contains(textNode)) return;
    applyEnclosingRule(textNode, range.startOffset, root);
  }, 600);
}

/** 光标离开时立刻结算，别让延迟检查落空 */
export function flushEnclosingRules(root) {
  clearTimeout(enclosingTimer);
  const range = currentRange();
  if (!range || !range.collapsed) return false;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return false;
  return applyEnclosingRule(node, range.startOffset, root);
}

/** 光标停在标记中间时的转换：左边有开标记、右边有闭标记就地成形。
    对应「先打 $$$$ 再回填中间」这种写法。 */
function applyEnclosingRule(textNode, offset, root) {
  const text = textNode.textContent ?? "";
  const before = text.slice(0, offset);
  const after = text.slice(offset);

  for (const rule of ENCLOSING_RULES) {
    const head = before.match(rule.open);
    if (!head) continue;
    const tail = after.match(rule.close);
    if (!tail) continue;

    const inner = head[1] + tail[1];
    if (inner.trim() === "") continue;

    const from = offset - head[0].length;
    const to = offset + tail[0].length;

    const range = document.createRange();
    range.setStart(textNode, from);
    range.setEnd(textNode, to);
    range.deleteContents();

    const node = buildInlineNode(rule.command, inner);
    range.insertNode(node);
    finishInlineInsert(node, rule.command, root);
    return true;
  }
  return false;
}

/** 左右成对的标记；open 匹配光标左侧（含开标记），close 匹配右侧（含闭标记） */
const ENCLOSING_RULES = [
  { open: /\$\$([^$\n]*)$/, close: /^([^$\n]*)\$\$/, command: "mathblock" },
  { open: /\*\*([^*\n]*)$/, close: /^([^*\n]*)\*\*/, command: "bold" },
  { open: /~~([^~\n]*)$/, close: /^([^~\n]*)~~/, command: "strike" },
  { open: /(?:^|[^$])\$([^$\n]*)$/, close: /^([^$\n]*)\$/, command: "math" },
  { open: /(?:^|[^*])\*([^*\n]*)$/, close: /^([^*\n]*)\*/, command: "italic" },
  { open: /`([^`\n]*)$/, close: /^([^`\n]*)`/, command: "code" },
];

/** 在空的列表项 / 引用里回车，跳出该结构 */
function exitEmptyBlock(block, root) {
  const text = (block.textContent ?? "").trim();
  if (text !== "") return false;

  const list = block.closest?.("ul, ol");
  if (block.nodeName === "LI" && list) {
    const tail = emptyParagraph();
    list.after(tail);
    block.remove();
    if (list.children.length === 0) list.remove();
    placeCaret(tail, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  const quote = block.closest?.("blockquote");
  if (quote) {
    const tail = emptyParagraph();
    quote.after(tail);
    block.remove();
    if (quote.textContent.trim() === "") quote.remove();
    placeCaret(tail, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // 标题行回车后应该回到正文，而不是继续写标题
  if (/^H[1-6]$/.test(block.nodeName)) {
    const tail = emptyParagraph();
    block.replaceWith(tail);
    placeCaret(tail, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

/** 块首按退格：把标题/引用/列表降回普通段落，符合 Typora 的手感 */
function unwrapOnBackspace(block, root, range) {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  if (probe.toString() !== "") return false;

  if (/^H[1-6]$/.test(block.nodeName)) {
    const next = retagBlock(block, "P");
    placeCaret(next, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  const quote = block.closest?.("blockquote");
  if (quote && quote.firstElementChild === block) {
    const fragment = document.createDocumentFragment();
    while (quote.firstChild) fragment.appendChild(quote.firstChild);
    const first = fragment.firstChild;
    quote.replaceWith(fragment);
    if (first) placeCaret(first, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  const list = block.closest?.("ul, ol");
  if (block.nodeName === "LI" && list && list.firstElementChild === block) {
    const paragraph = emptyParagraph();
    paragraph.textContent = block.textContent ?? "";
    if ((paragraph.textContent ?? "") === "") paragraph.appendChild(document.createElement("br"));
    list.before(paragraph);
    block.remove();
    if (list.children.length === 0) list.remove();
    placeCaret(paragraph, true);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  return false;
}

/** 表格里 Tab 跳下一格，其它地方插两个空格 */
function handleTab(event, block, root) {
  const cell = block.closest?.("td, th");
  if (cell) {
    const cells = Array.from(cell.closest("table").querySelectorAll("td, th"));
    const index = cells.indexOf(cell);
    const next = event.shiftKey ? cells[index - 1] : cells[index + 1];
    if (next) {
      placeCaret(next, true);
      return true;
    }
    // 最后一格继续 Tab：补一行
    if (!event.shiftKey) {
      const row = cell.closest("tr");
      const fresh = row.cloneNode(true);
      for (const td of fresh.children) {
        td.textContent = "";
        td.appendChild(document.createElement("br"));
      }
      row.after(fresh);
      placeCaret(fresh.firstElementChild, true);
      root.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }
  return false;
}
/* ---------- 格式化命令（快捷键用，两种模式都支持） ---------- */

/** 渲染态：用 execCommand / DOM 操作实现 */
function applyPreviewCommand(command, root, payload) {
  const range = currentRange();
  if (!range) return false;
  const block = blockOf(range.startContainer, root);

  switch (command) {
    case "bold":
      document.execCommand("bold");
      return true;
    case "italic":
      document.execCommand("italic");
      return true;
    case "strike":
      document.execCommand("strikeThrough");
      return true;
    case "code": {
      const text = range.toString();
      if (text === "") return false;
      const code = document.createElement("code");
      code.textContent = text;
      range.deleteContents();
      range.insertNode(code);
      placeCaret(code, false);
      return true;
    }
    case "link": {
      const text = range.toString() || t("链接");
      const anchor = document.createElement("a");
      anchor.href = payload ?? "https://";
      anchor.textContent = text;
      range.deleteContents();
      range.insertNode(anchor);
      placeCaret(anchor, false);
      return true;
    }
    case "heading": {
      if (!block) return false;
      const tag = payload === 0 ? "P" : `H${payload}`;
      const next = retagBlock(block, tag);
      placeCaret(next, false);
      return true;
    }
    case "heading-up":
    case "heading-down": {
      if (!block) return false;
      const match = /^H([1-6])$/.exec(block.nodeName);
      const level = match ? Number(match[1]) : 0;
      // up = 更大的标题（H3 -> H2），正文按 H1 起步
      const next =
        command === "heading-up"
          ? level === 0
            ? 1
            : Math.max(1, level - 1)
          : Math.min(6, level + 1);
      const retagged = retagBlock(block, `H${next}`);
      placeCaret(retagged, false);
      return true;
    }
    case "quote": {
      if (!block) return false;
      const quote = block.closest?.("blockquote");
      if (quote) {
        const fragment = document.createDocumentFragment();
        while (quote.firstChild) fragment.appendChild(quote.firstChild);
        const first = fragment.firstChild;
        quote.replaceWith(fragment);
        if (first) placeCaret(first, false);
      } else {
        const fresh = document.createElement("blockquote");
        block.replaceWith(fresh);
        fresh.appendChild(block);
        placeCaret(block, false);
      }
      return true;
    }
    case "ul":
      document.execCommand("insertUnorderedList");
      return true;
    case "ol":
      document.execCommand("insertOrderedList");
      return true;
    case "codeblock": {
      if (!block) return false;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.textContent || "\n";
      pre.appendChild(code);
      block.replaceWith(pre);
      placeCaret(code, true);
      return true;
    }
    case "hr": {
      if (!block) return false;
      const hr = document.createElement("hr");
      block.after(hr);
      const tail = emptyParagraph();
      hr.after(tail);
      placeCaret(tail, true);
      return true;
    }
    case "table": {
      if (!block) return false;
      const table = buildTable(payload?.headers ?? [t("列 1"), t("列 2"), t("列 3")], payload?.rows ?? 1);
      block.replaceWith(table);
      const tail = emptyParagraph();
      table.after(tail);
      placeCaret(table.querySelector("tbody td"), true);
      return true;
    }
    case "math": {
      const tex = range.toString();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = mathAtomHtml(tex, false);
      const atom = wrapper.firstElementChild;
      range.deleteContents();
      range.insertNode(atom);
      openMathEditor(atom, root);
      return true;
    }
    case "mathblock": {
      if (!block) return false;
      const wrapper = document.createElement("div");
      wrapper.innerHTML = mathAtomHtml(block.textContent.trim(), true);
      const atom = wrapper.firstElementChild;
      block.replaceWith(atom);
      const tail = emptyParagraph();
      atom.after(tail);
      openMathEditor(atom, root);
      return true;
    }
    default:
      return false;
  }
}

/* ---------- 源码态命令 ---------- */

function wrapSelection(textarea, left, right = left, placeholder = "") {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end) || placeholder;
  const before = value.slice(0, start);
  const after = value.slice(end);

  // 已经被同样的标记包住就取消，形成开关手感
  if (
    before.endsWith(left) &&
    after.startsWith(right) &&
    start !== end
  ) {
    textarea.value = before.slice(0, -left.length) + selected + after.slice(right.length);
    textarea.selectionStart = start - left.length;
    textarea.selectionEnd = end - left.length;
    return;
  }

  textarea.value = before + left + selected + right + after;
  if (start === end && placeholder) {
    textarea.selectionStart = start + left.length;
    textarea.selectionEnd = start + left.length + placeholder.length;
  } else {
    textarea.selectionStart = start + left.length;
    textarea.selectionEnd = start + left.length + selected.length;
  }
}

function lineBoundsOf(textarea) {
  const { value, selectionStart, selectionEnd } = textarea;
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  let end = value.indexOf("\n", selectionEnd);
  if (end < 0) end = value.length;
  return { start, end };
}

/** 对选中的每一行套同一个前缀，已有则去掉 */
function togglePrefix(textarea, build) {
  const { start, end } = lineBoundsOf(textarea);
  const block = textarea.value.slice(start, end);
  const lines = block.split("\n");

  const next = lines
    .map((line, index) => {
      const prefix = build(index + 1);
      const stripped = line.replace(/^(\s*)(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)?/, "$1");
      return line.startsWith(prefix) ? stripped : prefix + stripped;
    })
    .join("\n");

  textarea.value = textarea.value.slice(0, start) + next + textarea.value.slice(end);
  textarea.selectionStart = start;
  textarea.selectionEnd = start + next.length;
}

function replaceLines(textarea, text, caretOffset) {
  const { start, end } = lineBoundsOf(textarea);
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const caret = start + (caretOffset ?? text.length);
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

function applySourceCommand(command, textarea, payload) {
  switch (command) {
    case "bold":
      wrapSelection(textarea, "**", "**", t("加粗文字"));
      return true;
    case "italic":
      wrapSelection(textarea, "*", "*", t("斜体文字"));
      return true;
    case "strike":
      wrapSelection(textarea, "~~", "~~", t("删除线"));
      return true;
    case "code":
      wrapSelection(textarea, "`", "`", "code");
      return true;
    case "math":
      wrapSelection(textarea, "$", "$", "a^2 + b^2 = c^2");
      return true;
    case "link": {
      const { selectionStart: start, selectionEnd: end, value } = textarea;
      const text = value.slice(start, end) || t("链接文字");
      const snippet = `[${text}](${payload ?? "https://"})`;
      textarea.value = value.slice(0, start) + snippet + value.slice(end);
      textarea.selectionStart = start + text.length + 3;
      textarea.selectionEnd = start + snippet.length - 1;
      return true;
    }
    case "heading":
      togglePrefix(textarea, () => (payload === 0 ? "" : `${"#".repeat(payload)} `));
      return true;
    case "heading-up":
    case "heading-down": {
      const { start, end } = lineBoundsOf(textarea);
      const line = textarea.value.slice(start, end);
      const current = line.match(/^(#{1,6})\s/);
      const level = current ? current[1].length : 0;
      const next =
        command === "heading-up"
          ? level === 0
            ? 1
            : Math.max(1, level - 1)
          : Math.min(6, level + 1);
      togglePrefix(textarea, () => (next === 0 ? "" : `${"#".repeat(next)} `));
      return true;
    }
    case "quote":
      togglePrefix(textarea, () => "> ");
      return true;
    case "ul":
      togglePrefix(textarea, () => "- ");
      return true;
    case "ol":
      togglePrefix(textarea, (index) => `${index}. `);
      return true;
    case "codeblock": {
      const { start, end } = lineBoundsOf(textarea);
      const body = textarea.value.slice(start, end) || "";
      const snippet = "```\n" + body + "\n```";
      textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
      const caret = start + 4;
      textarea.selectionStart = caret;
      textarea.selectionEnd = caret;
      return true;
    }
    case "mathblock": {
      const { start, end } = lineBoundsOf(textarea);
      const body = textarea.value.slice(start, end) || "";
      const snippet = "$$\n" + body + "\n$$";
      textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
      const caret = start + 3;
      textarea.selectionStart = caret;
      textarea.selectionEnd = caret;
      return true;
    }
    case "hr":
      replaceLines(textarea, "\n---\n");
      return true;
    case "table": {
      const headers = payload?.headers ?? [t("列 1"), t("列 2"), t("列 3")];
      const rows = Math.max(1, payload?.rows ?? 1);
      const head = `| ${headers.join(" | ")} |`;
      const rule = `| ${headers.map(() => "---").join(" | ")} |`;
      const blank = `| ${headers.map(() => "   ").join(" | ")} |`;
      const body = Array.from({ length: rows }, () => blank).join("\n");
      replaceLines(textarea, `${head}\n${rule}\n${body}`, head.length + rule.length + 4);
      return true;
    }
    default:
      return false;
  }
}

/** 统一入口：按当前所在的编辑面分发命令 */
export function runCommand(command, context, payload) {
  const { previewEl, editorEl } = context;
  if (!previewEl.hidden) {
    previewEl.focus();
    const done = applyPreviewCommand(command, previewEl, payload);
    if (done) previewEl.dispatchEvent(new Event("input", { bubbles: true }));
    return done;
  }
  editorEl.focus();
  const done = applySourceCommand(command, editorEl, payload);
  if (done) editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  return done;
}
