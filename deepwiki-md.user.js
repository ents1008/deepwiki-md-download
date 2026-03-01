// ==UserScript==
// @name         DeepWiki to Markdown (Userscript)
// @namespace    https://github.com/ents1008/deepwiki-md-download
// @version      1.0.21
// @description  Convert DeepWiki pages to Markdown and batch export as ZIP.
// @author       ents1008
// @homepageURL  https://github.com/ents1008/deepwiki-md-download
// @supportURL   https://github.com/ents1008/deepwiki-md-download/issues
// @downloadURL  https://github.com/ents1008/deepwiki-md-download/raw/main/deepwiki-md.user.js
// @updateURL    https://github.com/ents1008/deepwiki-md-download/raw/main/deepwiki-md.user.js
// @match        https://deepwiki.com/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_download
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "dwmd-panel";
  const STATUS_ID = "dwmd-status";
  const ACTIONS_ID = "dwmd-actions";
  const STATE_KEY = "dwmd-batch-state-v1";
  const CANCEL_KEY = "dwmd-batch-cancel-v1";
  const CONTENT_KEY_PREFIX = "dwmd-batch-content-v1-";
  const TASK_LOCK = { running: false };

  function applyStyles() {
    const css = `
      #${PANEL_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        width: 300px;
        border-radius: 14px;
        border: 1px solid rgba(18, 24, 38, 0.16);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 12px 36px rgba(8, 19, 38, 0.18);
        backdrop-filter: blur(8px);
        padding: 12px;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #0f172a;
      }

      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      #${PANEL_ID} .dwmd-title {
        font-size: 15px;
        font-weight: 700;
        margin: 0 0 8px;
      }

      #${PANEL_ID} .dwmd-buttons {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      #${PANEL_ID} button {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: transform .14s ease, opacity .14s ease;
      }

      #${PANEL_ID} button:hover {
        transform: translateY(-1px);
      }

      #${PANEL_ID} .dwmd-single {
        background: #0f7b0f;
        color: #fff;
      }

      #${PANEL_ID} .dwmd-batch {
        background: #0b63ce;
        color: #fff;
      }

      #${PANEL_ID} .dwmd-cancel {
        background: #9f1239;
        color: #fff;
      }

      #${STATUS_ID} {
        margin-top: 9px;
        font-size: 12px;
        line-height: 1.45;
        border-radius: 8px;
        padding: 8px;
        min-height: 34px;
        border: 1px solid transparent;
        white-space: pre-wrap;
      }

      #${STATUS_ID}.info {
        background: #e0f2fe;
        border-color: #7dd3fc;
        color: #075985;
      }

      #${STATUS_ID}.success {
        background: #dcfce7;
        border-color: #4ade80;
        color: #166534;
      }

      #${STATUS_ID}.error {
        background: #fee2e2;
        border-color: #fda4af;
        color: #991b1b;
      }

      #${ACTIONS_ID} {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      #${ACTIONS_ID} button {
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        background: #111827;
        color: #fff;
      }
    `;

    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    applyStyles();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <h3 class="dwmd-title">DeepWiki to Markdown</h3>
      <div class="dwmd-buttons">
        <button type="button" class="dwmd-single" id="dwmd-convert-current">导出当前页 Markdown</button>
        <button type="button" class="dwmd-batch" id="dwmd-convert-all">批量导出全部页面 ZIP</button>
        <button type="button" class="dwmd-cancel" id="dwmd-cancel-batch">取消批量任务</button>
      </div>
      <div id="${STATUS_ID}" class="info">就绪</div>
      <div id="${ACTIONS_ID}"></div>
    `;

    document.body.appendChild(panel);

    panel
      .querySelector("#dwmd-convert-current")
      .addEventListener("click", () => void exportCurrentPage());

    panel
      .querySelector("#dwmd-convert-all")
      .addEventListener("click", () => void startBatchExport());

    panel
      .querySelector("#dwmd-cancel-batch")
      .addEventListener("click", () => void cancelBatchExport());
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    GM_registerMenuCommand("DeepWiki: 导出当前页", () => {
      void exportCurrentPage();
    });

    GM_registerMenuCommand("DeepWiki: 批量导出全部", () => {
      void startBatchExport();
    });

    GM_registerMenuCommand("DeepWiki: 取消批量任务", () => {
      void cancelBatchExport();
    });
  }

  function showStatus(message, type = "info") {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }

    status.textContent = message;
    status.className = type;
  }

  function clearActions() {
    const actions = document.getElementById(ACTIONS_ID);
    if (!actions) {
      return;
    }
    actions.replaceChildren();
  }

  function isChromeLikeBrowser() {
    const ua = navigator.userAgent || "";
    return /chrome|chromium|crios|edg\//i.test(ua) && !/firefox/i.test(ua);
  }

  function renderDownloadAction(blob, fileName) {
    const actions = document.getElementById(ACTIONS_ID);
    if (!actions) {
      return;
    }

    actions.replaceChildren();
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `点击下载 ${fileName}`;
    button.addEventListener("click", () => {
      void downloadBlob(blob, fileName);
    });
    actions.appendChild(button);
  }

  async function buildZipBlob(entries) {
    if (typeof fflate === "undefined") {
      throw new Error("fflate 未加载，无法生成 ZIP");
    }

    const encoder = new TextEncoder();
    const files = {};
    entries.forEach((entry) => {
      files[entry.name] = encoder.encode(entry.content);
    });

    const zipData = await new Promise((resolve, reject) => {
      fflate.zip(files, { level: 0 }, (error, data) => {
        if (error) {
          reject(new Error(`ZIP 打包失败: ${String(error)}`));
          return;
        }
        resolve(data);
      });
    });

    return new Blob([zipData], { type: "application/zip" });
  }

  function sanitizeFileName(text) {
    return (text || "")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "Untitled";
  }

  function parseOrderParts(text) {
    const source = String(text || "").trim();
    const match = source.match(/^(\d+(?:\.\d+)*)(?:\D|$)/);
    if (!match) {
      return null;
    }

    const parts = match[1]
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .filter((num) => Number.isFinite(num));

    return parts.length ? parts : null;
  }

  function parseOrderPartsFromUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1] || "";
      const match = last.match(/^(\d+(?:\.\d+)*)(?:-|$)/);
      if (!match) {
        return null;
      }
      return match[1]
        .split(".")
        .map((part) => Number.parseInt(part, 10))
        .filter((num) => Number.isFinite(num));
    } catch (_error) {
      return null;
    }
  }

  function stripOrderPrefix(text) {
    return String(text || "")
      .trim()
      .replace(/^\d+(?:\.\d+)*[\s._-]*/, "")
      .trim();
  }

  function compareOrderParts(partsA, partsB) {
    const a = Array.isArray(partsA) ? partsA : null;
    const b = Array.isArray(partsB) ? partsB : null;

    if (!a && !b) {
      return 0;
    }
    if (a && !b) {
      return -1;
    }
    if (!a && b) {
      return 1;
    }

    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i += 1) {
      const av = Number.isFinite(a[i]) ? a[i] : -1;
      const bv = Number.isFinite(b[i]) ? b[i] : -1;
      if (av !== bv) {
        return av - bv;
      }
    }
    return 0;
  }

  function ensureUniqueEntryPath(entryPath, usedSet) {
    const normalized = String(entryPath || "")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+|\/+$/g, "");

    const safePath = normalized || "Untitled.md";
    const slashIndex = safePath.lastIndexOf("/");
    const dir = slashIndex >= 0 ? safePath.slice(0, slashIndex) : "";
    const file = slashIndex >= 0 ? safePath.slice(slashIndex + 1) : safePath;
    const dotIndex = file.lastIndexOf(".");
    const stem = dotIndex > 0 ? file.slice(0, dotIndex) : file;
    const ext = dotIndex > 0 ? file.slice(dotIndex) : "";

    let candidate = safePath;
    let suffix = 2;
    while (usedSet.has(candidate.toLowerCase())) {
      const nextFile = `${stem}-${suffix}${ext}`;
      candidate = dir ? `${dir}/${nextFile}` : nextFile;
      suffix += 1;
    }

    usedSet.add(candidate.toLowerCase());
    return candidate;
  }

  function formatHeadTitle(headTitle) {
    return sanitizeFileName(
      (headTitle || "").replace(/[\/|]/g, "-").replace(/---/g, "-")
    );
  }

  function getCurrentTitle() {
    return (
      document
        .querySelector('.container > div:nth-child(1) a[data-selected="true"]')
        ?.textContent?.trim() ||
      document
        .querySelector('.container > div:nth-child(1) h1')
        ?.textContent?.trim() ||
      document.querySelector("h1")?.textContent?.trim() ||
      "Untitled"
    );
  }

  function getContentContainer() {
    return (
      document.querySelector('.container > div:nth-child(2) .prose') ||
      document.querySelector('.container > div:nth-child(2) .prose-custom') ||
      document.querySelector('.container > div:nth-child(2)')
    );
  }

  async function waitForContentContainer(timeoutMs = 20000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const container = getContentContainer();
      if (container && container.childNodes.length > 0) {
        return container;
      }
      await sleep(250);
    }

    throw new Error("页面内容加载超时，未找到可转换的正文区域");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function hasLoadingMarkers(container) {
    return Boolean(
      container.querySelector(
        '[aria-busy="true"], [data-loading="true"], .animate-pulse, [class*="skeleton"]'
      )
    );
  }

  function isDiagramSvgCandidate(svgElement) {
    if (!svgElement) {
      return false;
    }

    const role = (svgElement.getAttribute("aria-roledescription") || "").toLowerCase();
    const cls = (svgElement.getAttribute("class") || "").toLowerCase();
    if (
      role.includes("flowchart") ||
      role.includes("class") ||
      role.includes("sequence") ||
      cls.includes("flowchart") ||
      cls.includes("classdiagram") ||
      cls.includes("sequencediagram") ||
      cls.includes("sequence")
    ) {
      return true;
    }

    return Boolean(
      svgElement.querySelector(
        'g.node, path.flowchart-link, path.relation[id^="id_"], line.actor-line, line[class^="messageLine"], g.cluster, rect.note, foreignObject'
      )
    );
  }

  function getDiagramSvgInPre(preElement) {
    if (!preElement) {
      return null;
    }

    const preferred = preElement.querySelector(
      'svg[id^="mermaid-"], svg[aria-roledescription], svg.flowchart, svg.classDiagram, svg.sequencediagram, svg[class*="flowchart"], svg[class*="classDiagram"], svg[class*="classdiagram"], svg[class*="sequence"]'
    );
    if (preferred && isDiagramSvgCandidate(preferred)) {
      return preferred;
    }

    const allSvg = Array.from(preElement.querySelectorAll("svg"));
    return allSvg.find((svg) => isDiagramSvgCandidate(svg)) || null;
  }

  function isLikelyMermaidPre(preElement) {
    if (
      preElement.querySelector("code.language-mermaid") ||
      preElement.querySelector(".mermaid")
    ) {
      return true;
    }

    if (getDiagramSvgInPre(preElement)) {
      return true;
    }

    const rawText = (preElement.textContent || "").trim();
    return /(flowchart|classDiagram|sequenceDiagram|erDiagram|graph\s+(TD|LR))/i.test(rawText);
  }

  function isMermaidSvgStructReady(svgElement) {
    if (!svgElement) {
      return false;
    }

    const roleDesc = (svgElement.getAttribute("aria-roledescription") || "").toLowerCase();
    const svgClass = (svgElement.getAttribute("class") || "").toLowerCase();
    const textCount = svgElement.querySelectorAll("text, tspan, foreignObject").length;

    const flowNodeCount = svgElement.querySelectorAll("g.node").length;
    const flowEdgeCount = svgElement.querySelectorAll("path.flowchart-link").length;
    const clusterCount = svgElement.querySelectorAll("g.cluster").length;

    const classNodeCount = svgElement.querySelectorAll("g.node.default, g.classGroup").length;
    const classRelationCount = svgElement.querySelectorAll('path.relation[id^="id_"]').length;

    const actorLineCount = svgElement.querySelectorAll("line.actor-line").length;
    const messageLineCount = svgElement.querySelectorAll('line[class^="messageLine"]').length;
    const noteCount = svgElement.querySelectorAll("rect.note").length;

    if (roleDesc.includes("flowchart") || svgClass.includes("flowchart")) {
      return flowNodeCount > 0 && (flowEdgeCount > 0 || clusterCount > 0 || textCount > 0);
    }

    if (roleDesc.includes("class") || svgClass.includes("classdiagram") || svgClass.includes("class")) {
      return classNodeCount > 0 && (classRelationCount > 0 || textCount > 0);
    }

    if (roleDesc.includes("sequence") || svgClass.includes("sequencediagram") || svgClass.includes("sequence")) {
      return actorLineCount > 0 && (messageLineCount > 0 || noteCount > 0 || textCount > 0);
    }

    return textCount > 0 && (flowNodeCount + classNodeCount + actorLineCount + messageLineCount > 0);
  }

  function getMermaidReadiness(container) {
    const mermaidBlocks = Array.from(container.querySelectorAll("pre")).filter((pre) =>
      isLikelyMermaidPre(pre)
    );

    let readyCount = 0;
    mermaidBlocks.forEach((pre) => {
      const codeMermaid = pre.querySelector("code.language-mermaid");
      if (codeMermaid && (codeMermaid.textContent || "").trim().length > 0) {
        readyCount += 1;
        return;
      }

      const svgElement = getDiagramSvgInPre(pre);
      if (svgElement) {
        if (isMermaidSvgStructReady(svgElement)) {
          readyCount += 1;
        }
        return;
      }

      const text = (pre.textContent || "").trim();
      if (/^```mermaid[\s\S]*```$/.test(text)) {
        readyCount += 1;
      }
    });

    return {
      total: mermaidBlocks.length,
      ready: readyCount
    };
  }

  function hasUnreadyPreBlocks(container) {
    const preBlocks = Array.from(container.querySelectorAll("pre"));
    return preBlocks.some((pre) => {
      const code = pre.querySelector("code");
      const codeText = (code?.textContent || "").trim();
      const preText = (pre.textContent || "").trim();
      const svgElement = getDiagramSvgInPre(pre);

      if (svgElement) {
        return !isMermaidSvgStructReady(svgElement) && codeText.length === 0;
      }

      if (codeText.length === 0 && preText.length === 0) {
        const hasChildren = pre.children.length > 0;
        return hasChildren || hasLoadingMarkers(pre);
      }

      return false;
    });
  }

  async function waitForBatchPageContentReady(timeoutMs = 20000) {
    const container = await waitForContentContainer(timeoutMs);
    const start = Date.now();
    let lastSignature = "";
    let stableRounds = 0;

    while (Date.now() - start < timeoutMs) {
      const signature = [
        container.textContent.length,
        container.querySelectorAll("pre").length,
        container.querySelectorAll('svg[id^="mermaid-"], svg[aria-roledescription]').length
      ].join("|");

      if (signature === lastSignature) {
        stableRounds += 1;
      } else {
        lastSignature = signature;
        stableRounds = 0;
      }

      const readiness = getMermaidReadiness(container);
      const mermaidReady = readiness.ready >= readiness.total;

      const hasUnreadyPre = hasUnreadyPreBlocks(container);
      if (!hasLoadingMarkers(container) && stableRounds >= 3 && mermaidReady && !hasUnreadyPre) {
        return;
      }

      await sleep(200);
    }

    const finalReadiness = getMermaidReadiness(container);
    const hasUnreadyPre = hasUnreadyPreBlocks(container);
    console.warn(
      `页面图表等待超时，继续导出（mermaid 就绪 ${finalReadiness.ready}/${finalReadiness.total}，空预块 ${hasUnreadyPre ? "存在" : "无"}）`
    );
  }

  function collectContentDiagnostics(container) {
    const preBlocks = Array.from(container.querySelectorAll("pre"));
    const expectedDiagramCount = preBlocks.filter((pre) => {
      if (pre.querySelector("code.language-mermaid")) {
        return true;
      }
      return Boolean(getDiagramSvgInPre(pre));
    }).length;
    const pendingEmptyPreCount = preBlocks.filter((pre) => {
      const svgElement = getDiagramSvgInPre(pre);
      if (svgElement) {
        return false;
      }
      const code = pre.querySelector("code");
      const codeText = (code?.textContent || "").trim();
      const preText = (pre.textContent || "").trim();
      if (codeText.length > 0 || preText.length > 0) {
        return false;
      }
      return pre.children.length > 0 || hasLoadingMarkers(pre);
    }).length;

    return {
      preCount: preBlocks.length,
      expectedDiagramCount,
      pendingEmptyPreCount
    };
  }

  function getMarkdownDiagnostics(markdown) {
    const content = String(markdown || "");
    return {
      mermaidBlockCount: (content.match(/```mermaid\b/g) || []).length,
      emptyFenceCount: (content.match(/```\s*\r?\n\s*```/g) || []).length
    };
  }

  function validateConversionIntegrity(converted) {
    const issues = [];
    const expectedDiagramCount = converted?.diagnostics?.expectedDiagramCount || 0;
    const pendingEmptyPreCount = converted?.diagnostics?.pendingEmptyPreCount || 0;
    const markdownStats = getMarkdownDiagnostics(converted?.markdown || "");

    if (expectedDiagramCount > 0 && markdownStats.mermaidBlockCount < expectedDiagramCount) {
      issues.push(
        `Mermaid 数量不足（期望 ${expectedDiagramCount}，实际 ${markdownStats.mermaidBlockCount}）`
      );
    }

    if (pendingEmptyPreCount > 0) {
      issues.push(`页面仍有未就绪代码块 ${pendingEmptyPreCount} 个`);
    }

    if (markdownStats.emptyFenceCount > 0) {
      issues.push(`检测到空代码块 ${markdownStats.emptyFenceCount} 个`);
    }

    return {
      ok: issues.length === 0,
      issues
    };
  }

  async function convertCurrentPageToMarkdown() {
    const contentContainer = await waitForContentContainer();
    const diagnostics = collectContentDiagnostics(contentContainer);

    let markdown = "";
    contentContainer.childNodes.forEach((child) => {
      markdown += processNode(child);
    });

    const title = getCurrentTitle();
    markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");

    return {
      markdown,
      markdownTitle: sanitizeFileName(title),
      headTitle: formatHeadTitle(document.title || ""),
      diagnostics
    };
  }

  function extractAllPages() {
    const baseUrl = window.location.origin;
    const sidebarLinks = Array.from(
      document.querySelectorAll('.border-r-border ul li a')
    );

    const pages = sidebarLinks.map((link) => ({
      url: new URL(link.getAttribute("href"), baseUrl).href,
      title: link.textContent.trim(),
      selected: link.getAttribute("data-selected") === "true"
    }));

    const uniquePages = [];
    const seen = new Set();

    pages.forEach((page) => {
      const normalized = normalizeUrl(page.url);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniquePages.push(page);
      }
    });

    return {
      pages: uniquePages,
      currentTitle: getCurrentTitle(),
      headTitle: formatHeadTitle(document.title || ""),
      baseUrl
    };
  }

  function normalizeUrl(url) {
    const parsed = new URL(url, window.location.origin);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  }

  function loadBatchState() {
    const raw = GM_getValue(STATE_KEY, "");
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`批量状态解析失败: ${String(error)}`);
    }
  }

  function saveBatchState(state) {
    GM_setValue(STATE_KEY, JSON.stringify(state));
  }

  function clearBatchState() {
    GM_deleteValue(STATE_KEY);
  }

  function loadCancelBatchId() {
    return GM_getValue(CANCEL_KEY, "");
  }

  function markBatchCanceled(batchId) {
    GM_setValue(CANCEL_KEY, batchId || "");
  }

  function clearCancelBatchId() {
    GM_deleteValue(CANCEL_KEY);
  }

  function getBatchContentKey(batchId, pageIndex) {
    return `${CONTENT_KEY_PREFIX}${batchId}-${pageIndex}`;
  }

  function saveBatchPageContent(batchId, pageIndex, data) {
    GM_setValue(getBatchContentKey(batchId, pageIndex), JSON.stringify(data));
  }

  function loadBatchPageContent(batchId, pageIndex) {
    const raw = GM_getValue(getBatchContentKey(batchId, pageIndex), "");
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`批量内容解析失败: ${String(error)}`);
    }
  }

  function clearBatchContent(state) {
    if (!state?.id || !Array.isArray(state.pages)) {
      return;
    }

    for (let i = 0; i < state.pages.length; i += 1) {
      GM_deleteValue(getBatchContentKey(state.id, i));
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Blob 转 DataURL 失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function downloadBlob(blob, fileName) {
    const objectUrl = URL.createObjectURL(blob);

    const gmDownload = (url) =>
      new Promise((resolve, reject) => {
        let timeoutId = setTimeout(() => {
          reject(new Error("GM_download timeout"));
        }, 120000);

        GM_download({
          url,
          name: fileName,
          saveAs: true,
          onload: () => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            resolve();
          },
          ontimeout: () => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            reject(new Error("GM_download timeout"));
          },
          onerror: (error) => {
            clearTimeout(timeoutId);
            timeoutId = 0;
            reject(
              new Error(
                `GM_download failed: ${error?.error || error?.details || "unknown"}`
              )
            );
          }
        });
      });

    try {
      if (isChromeLikeBrowser()) {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }

      if (typeof GM_download === "function") {
        let gmError = null;
        try {
          await gmDownload(objectUrl);
          return;
        } catch (firstError) {
          gmError = firstError;
          try {
            const dataUrl = await blobToDataUrl(blob);
            await gmDownload(dataUrl);
            return;
          } catch (secondError) {
            gmError = secondError;
          }
        }

        console.warn("GM_download 不可用，回退原生下载:", gmError);
      }

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    }
  }

  async function exportCurrentPage() {
    try {
      clearActions();
      showStatus("正在转换当前页面...", "info");

      const converted = await convertCurrentPageToMarkdown();
      const integrity = validateConversionIntegrity(converted);
      if (!integrity.ok) {
        throw new Error(`页面内容不完整: ${integrity.issues.join("；")}`);
      }
      const fileName = converted.headTitle
        ? `${converted.headTitle}-${converted.markdownTitle}.md`
        : `${converted.markdownTitle}.md`;

      await downloadBlob(
        new Blob([converted.markdown], { type: "text/markdown;charset=utf-8" }),
        fileName
      );

      showStatus(`下载完成: ${fileName}`, "success");
    } catch (error) {
      showStatus(`当前页导出失败: ${error.message || String(error)}`, "error");
      console.error("DeepWiki to Markdown single export error:", error);
    }
  }

  async function startBatchExport() {
    try {
      clearActions();
      let currentState = loadBatchState();
      const canceledId = loadCancelBatchId();
      if (currentState && canceledId && currentState.id === canceledId) {
        clearBatchContent(currentState);
        clearBatchState();
        clearCancelBatchId();
        currentState = null;
      }
      if (currentState) {
        showStatus("检测到已有批量任务，继续执行中...", "info");
        await runBatchStep();
        return;
      }

      const { pages, currentTitle, headTitle } = extractAllPages();
      if (pages.length === 0) {
        throw new Error("未找到侧边栏目录链接");
      }

      const folderName = sanitizeFileName(headTitle || currentTitle || "DeepWiki");
      const batchState = {
        id: `${Date.now()}`,
        originUrl: window.location.href,
        folderName,
        pages: pages.map((page) => ({ title: page.title, url: page.url })),
        currentIndex: 0,
        results: [],
        errors: [],
        createdAt: Date.now()
      };

      clearCancelBatchId();
      saveBatchState(batchState);
      showStatus(`批量任务启动，共 ${batchState.pages.length} 页`, "info");

      await runBatchStep();
    } catch (error) {
      showStatus(`批量任务启动失败: ${error.message || String(error)}`, "error");
      console.error("DeepWiki to Markdown batch start error:", error);
    }
  }

  function cancelBatchExport() {
    clearActions();
    const state = loadBatchState();
    if (!state) {
      showStatus("当前没有批量任务", "info");
      return;
    }

    markBatchCanceled(state.id);
    try {
      clearBatchContent(state);
    } finally {
      clearBatchState();
    }
    showStatus("批量任务已取消", "info");
  }

  async function runBatchStep() {
    if (TASK_LOCK.running) {
      return;
    }

    TASK_LOCK.running = true;

    try {
      let state = loadBatchState();
      if (!state) {
        return;
      }

      if (state.currentIndex >= state.pages.length) {
        await finalizeBatch(state);
        return;
      }

      const currentPage = state.pages[state.currentIndex];
      const expectedUrl = normalizeUrl(currentPage.url);
      const currentUrl = normalizeUrl(window.location.href);

      if (expectedUrl !== currentUrl) {
        showStatus(
          `跳转中 ${state.currentIndex + 1}/${state.pages.length}: ${currentPage.title}`,
          "info"
        );
        window.location.href = currentPage.url;
        return;
      }

      showStatus(
        `转换中 ${state.currentIndex + 1}/${state.pages.length}: ${currentPage.title}`,
        "info"
      );

      const currentIndex = state.currentIndex;
      try {
        const maxAttempts = 3;
        let converted = null;
        let lastAttemptError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          await waitForBatchPageContentReady();
          const currentConverted = await convertCurrentPageToMarkdown();
          const integrity = validateConversionIntegrity(currentConverted);
          if (integrity.ok) {
            converted = currentConverted;
            break;
          }

          lastAttemptError = new Error(
            `第 ${attempt}/${maxAttempts} 次转换未通过: ${integrity.issues.join("；")}`
          );

          if (attempt < maxAttempts) {
            showStatus(
              `内容未就绪，重试 ${attempt + 1}/${maxAttempts}: ${currentPage.title}`,
              "info"
            );
            await sleep(1200);
          }
        }

        if (!converted) {
          throw lastAttemptError || new Error("页面转换失败");
        }

        const orderParts =
          parseOrderPartsFromUrl(currentPage.url) ||
          parseOrderParts(currentPage.title);
        const orderLabel = orderParts ? orderParts.join(".") : `${currentIndex + 1}`;
        const titleSource = converted.markdownTitle || currentPage.title || `Page-${currentIndex + 1}`;
        const normalizedTitle = sanitizeFileName(stripOrderPrefix(titleSource) || titleSource);
        const displayTitle = sanitizeFileName(`${orderLabel}-${normalizedTitle}`);
        const fileTitle = displayTitle;
        const entryPath = `${fileTitle}.md`;
        saveBatchPageContent(state.id, currentIndex, {
          title: fileTitle,
          content: converted.markdown,
          url: currentPage.url,
          orderParts,
          orderLabel,
          displayTitle,
          entryPath
        });
        state.results.push({
          index: currentIndex,
          title: fileTitle,
          url: currentPage.url,
          orderParts,
          orderLabel,
          displayTitle,
          entryPath
        });
      } catch (error) {
        state.errors.push({
          index: currentIndex,
          title: currentPage.title,
          url: currentPage.url,
          message: error.message || String(error)
        });
      }

      if (loadCancelBatchId() === state.id) {
        showStatus("批量任务已取消", "info");
        return;
      }

      const latestState = loadBatchState();
      if (!latestState || latestState.id !== state.id) {
        return;
      }

      state.currentIndex += 1;
      saveBatchState(state);

      if (state.currentIndex < state.pages.length) {
        const next = state.pages[state.currentIndex];
        showStatus(
          `继续下一页 ${state.currentIndex + 1}/${state.pages.length}: ${next.title}`,
          "info"
        );
        window.location.href = next.url;
        return;
      }

      if (loadCancelBatchId() === state.id) {
        showStatus("批量任务已取消", "info");
        return;
      }

      await finalizeBatch(state);
    } finally {
      TASK_LOCK.running = false;
    }
  }

  async function finalizeBatch(state) {
    showStatus("正在生成 ZIP 文件...", "info");
    let indexContent = `# ${state.folderName}\n\n## Content Index\n\n`;

    const orderedResults = [...state.results].sort((a, b) => {
      const orderCompare = compareOrderParts(
        a?.orderParts || parseOrderParts(a?.title),
        b?.orderParts || parseOrderParts(b?.title)
      );
      if (orderCompare !== 0) {
        return orderCompare;
      }
      const indexA = Number.isFinite(a?.index) ? a.index : 0;
      const indexB = Number.isFinite(b?.index) ? b.index : 0;
      return indexA - indexB;
    });

    const entries = [];
    const usedEntryPaths = new Set();
    orderedResults.forEach((page) => {
      const stored = loadBatchPageContent(state.id, page.index);

      if (!stored?.title || typeof stored?.content !== "string") {
        state.errors.push({
          index: page.index,
          title: page.title || "Unknown",
          url: page.url || "",
          message: "页面内容丢失，无法写入 ZIP"
        });
        return;
      }

      const baseEntryPath = stored.entryPath || `${sanitizeFileName(stored.title || page.title || `Page-${page.index + 1}`)}.md`;
      const uniqueEntryPath = ensureUniqueEntryPath(baseEntryPath, usedEntryPaths);
      const pathParts = uniqueEntryPath.split("/").filter(Boolean);
      const fileName = pathParts[pathParts.length - 1] || uniqueEntryPath;
      const displayName = sanitizeFileName(
        stored.displayTitle || page.displayTitle || fileName.replace(/\.md$/i, "")
      );
      const depth = Math.max(pathParts.length - 1, 0);
      const indent = "  ".repeat(depth);

      indexContent += `${indent}- [${displayName}](${uniqueEntryPath})\n`;
      entries.push({
        name: uniqueEntryPath,
        content: stored.content
      });
    });

    entries.push({
      name: "README.md",
      content: indexContent
    });

    if (state.errors.length > 0) {
      entries.push({
        name: "ERRORS.json",
        content: JSON.stringify(state.errors, null, 2)
      });
    }

    const zipBlob = await buildZipBlob(entries);

    const zipName = `${state.folderName}.zip`;
    renderDownloadAction(zipBlob, zipName);

    if (isChromeLikeBrowser()) {
      await downloadBlob(zipBlob, zipName);
      showStatus(
        `ZIP 已生成并触发下载；若未弹出下载，请点下方按钮（成功 ${state.results.length} 页，失败 ${state.errors.length} 页）`,
        state.errors.length ? "error" : "success"
      );
    } else {
      showStatus(
        `ZIP 已生成，点击下方按钮下载（成功 ${state.results.length} 页，失败 ${state.errors.length} 页）`,
        state.errors.length ? "error" : "success"
      );
    }

    clearBatchContent(state);
    clearBatchState();
    clearCancelBatchId();

  }

  async function resumeBatchTask() {
    try {
      const state = loadBatchState();
      if (!state) {
        return;
      }

      showStatus(
        `检测到未完成批量任务，恢复进度 ${Math.min(state.currentIndex + 1, state.pages.length)}/${state.pages.length}`,
        "info"
      );

      await runBatchStep();
    } catch (error) {
      showStatus(`恢复批量任务失败: ${error.message || String(error)}`, "error");
      console.error("DeepWiki to Markdown batch resume error:", error);
    }
  }
// Function for Flowchart (ensure this exists from previous responses)
function convertFlowchartSvgToMermaidText(svgElement) {
  // ... (previous implementation for flowchart)
  if (!svgElement) return null;

  let mermaidCode = "flowchart TD\n\n";
  const nodes = {}; 
  const edges = [];
  const clusters = {}; 

  const nodeElements = svgElement.querySelectorAll('g.node');
  nodeElements.forEach(nodeEl => {
    const svgId = nodeEl.id;
    let textContent = "";
    const textFo = nodeEl.querySelector('.label foreignObject div > span > p, .label foreignObject div > p, .label foreignObject p, .label p');
    if (textFo) {
      textContent = textFo.textContent.trim().replace(/"/g, '#quot;');
    } else {
      const textElement = nodeEl.querySelector('text, .label text');
      if (textElement) {
        textContent = textElement.textContent.trim().replace(/"/g, '#quot;');
      }
    }
    let mermaidId = svgId.replace(/^flowchart-/, '');
    mermaidId = mermaidId.replace(/-\d+$/, '');
    nodes[svgId] = { mermaidId: mermaidId, text: textContent, svgId: svgId };
  });

  const clusterNodeMapping = { 
    "subGraph0": { title: "User Layer", nodeSvgIds: ["flowchart-Client-0", "flowchart-Server-1"] },
    "subGraph2": { title: "Transport Layer", nodeSvgIds: ["flowchart-ClientTransport-7", "flowchart-ServerTransport-8", "flowchart-SSE-9", "flowchart-Stdio-10"] },
    "subGraph1": { title: "Protocol Layer", nodeSvgIds: ["flowchart-JSONRPC-2", "flowchart-Tools-3", "flowchart-Resources-4", "flowchart-Prompts-5", "flowchart-Schema-6"] }
  };
  const svgClusterElements = svgElement.querySelectorAll('g.cluster');
  svgClusterElements.forEach(clusterEl => {
    const clusterSvgId = clusterEl.id;
    const labelFo = clusterEl.querySelector('.cluster-label foreignObject div > span > p, .cluster-label foreignObject div > p, .cluster-label foreignObject p');
    const title = labelFo ? labelFo.textContent.trim() : clusterSvgId;
    const clusterMermaidId = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    clusters[clusterMermaidId] = { title: title, nodes: [], svgId: clusterSvgId };
    if (clusterNodeMapping[clusterSvgId] && clusterNodeMapping[clusterSvgId].nodeSvgIds) {
      clusterNodeMapping[clusterSvgId].nodeSvgIds.forEach(nodeSvgId => {
        if (nodes[nodeSvgId]) {
          clusters[clusterMermaidId].nodes.push(nodes[nodeSvgId].mermaidId);
          nodes[nodeSvgId].clusterMermaidId = clusterMermaidId;
        }
      });
    }
  });
  
  const definedNodesInClusters = new Set();
  for (const clusterMermaidId in clusters) {
    const cluster = clusters[clusterMermaidId];
    mermaidCode += `subgraph ${clusterMermaidId} ["${cluster.title}"]\n`;
    cluster.nodes.forEach(nodeMermaidId => {
      const nodeInfo = Object.values(nodes).find(n => n.mermaidId === nodeMermaidId && n.clusterMermaidId === clusterMermaidId);
      if (nodeInfo) {
           mermaidCode += `    ${nodeInfo.mermaidId}["${nodeInfo.text}"]\n`;
           definedNodesInClusters.add(nodeInfo.mermaidId); 
      }
    });
    mermaidCode += "end\n\n";
  }
  for (const svgId in nodes) {
    const node = nodes[svgId];
    if (!node.clusterMermaidId && !definedNodesInClusters.has(node.mermaidId)) {
      if (!mermaidCode.includes(`${node.mermaidId}["`)) {
           mermaidCode += `${node.mermaidId}["${node.text}"]\n`;
      }
    }
  }
  mermaidCode += "\n";

  const edgeElements = svgElement.querySelectorAll('path.flowchart-link');
  edgeElements.forEach(edgeEl => {
    const edgeId = edgeEl.id;
    const parts = edgeId.substring(2).split('_'); 
    if (parts.length >= 2) {
      let sourceName = parts[0];
      let targetName = parts[1]; 
      const sourceNode = Object.values(nodes).find(n => n.mermaidId === sourceName);
      const targetNode = Object.values(nodes).find(n => n.mermaidId === targetName);
      if (sourceNode && targetNode) {
        edges.push(`    ${sourceNode.mermaidId} --> ${targetNode.mermaidId}`);
      } else {
        console.warn(`Flowchart: Could not fully resolve edge: ${edgeId}. Parsed as ${sourceName} --> ${targetName}. Source found: ${!!sourceNode}, Target found: ${!!targetNode}`);
      }
    }
  });
  [...new Set(edges)].forEach(edge => {
    mermaidCode += `${edge}\n`;
  });
  
  if (Object.keys(nodes).length === 0 && edges.length === 0 && Object.keys(clusters).length === 0) return null;
  return '```mermaid\n' + mermaidCode.trim() + '\n```';
}

// Function for Class Diagram (ensure this exists from previous responses)
function convertClassDiagramSvgToMermaidText(svgElement) {
  // ... (previous implementation for class diagram)
  if (!svgElement) return null;
  const mermaidLines = ['classDiagram'];
  const classData = {}; 

  svgElement.querySelectorAll('g.node.default').forEach(node => {
    const classIdSvg = node.getAttribute('id'); 
    if (!classIdSvg) return;
    const classNameMatch = classIdSvg.match(/^classId-([^-]+(?:-[^-]+)*)-(\d+)$/);
    if (!classNameMatch) return;
    const className = classNameMatch[1];
    if (!classData[className]) {
        classData[className] = { stereotype: "", members: [], methods: [] };
    }
    const stereotypeElem = node.querySelector('g.annotation-group.text foreignObject span.nodeLabel p, g.annotation-group.text foreignObject div p');
    if (stereotypeElem && stereotypeElem.textContent.trim()) {
        classData[className].stereotype = stereotypeElem.textContent.trim();
    }
    node.querySelectorAll('g.members-group.text g.label foreignObject span.nodeLabel p, g.members-group.text g.label foreignObject div p').forEach(m => {
      const txt = m.textContent.trim();
      if (txt) classData[className].members.push(txt);
    });
    node.querySelectorAll('g.methods-group.text g.label foreignObject span.nodeLabel p, g.methods-group.text g.label foreignObject div p').forEach(m => {
      const txt = m.textContent.trim();
      if (txt) classData[className].methods.push(txt);
    });
  });

  for (const className in classData) {
    const data = classData[className];
    if (data.stereotype) {
        mermaidLines.push(`    class ${className} {`);
        mermaidLines.push(`        ${data.stereotype}`);
    } else {
        mermaidLines.push(`    class ${className} {`);
    }
    data.members.forEach(member => { mermaidLines.push(`        ${member}`); });
    data.methods.forEach(method => { mermaidLines.push(`        ${method}`); });
    mermaidLines.push('    }');
  }

  const pathElements = Array.from(svgElement.querySelectorAll('path.relation[id^="id_"]'));
  const labelElements = Array.from(svgElement.querySelectorAll('g.edgeLabels .edgeLabel foreignObject p'));

  pathElements.forEach((path, index) => {
    const id = path.getAttribute('id'); 
    const parts = id.split('_'); 
    if (parts.length < 3) return; 
    const fromClass = parts[1];
    const toClass = parts[2];
    const markerEndAttr = path.getAttribute('marker-end') || "";
    let relationshipType = "";
    const lineStyle = path.classList.contains('dashed-line') ? ".." : 
                      path.classList.contains('dotted-line') ? "." : "--";

    if (markerEndAttr.includes('extensionEnd')) { 
        relationshipType = `${toClass} <|${lineStyle} ${fromClass}`;
    } else if (markerEndAttr.includes('compositionEnd')) { 
        relationshipType = `${fromClass} *${lineStyle} ${toClass}`;
    } else if (markerEndAttr.includes('aggregationEnd')) { 
        relationshipType = `${fromClass} o${lineStyle} ${toClass}`;
    } else if (markerEndAttr.includes('lollipopEnd')) { 
        relationshipType = `${fromClass} ..|> ${toClass}`; 
    } else if (markerEndAttr.includes('dependencyEnd')) { 
        relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
    } else { 
        relationshipType = `${fromClass} ${lineStyle}> ${toClass}`; 
        if (lineStyle === "--" && !markerEndAttr.includes('End')) { 
             relationshipType = `${fromClass} -- ${toClass}`;
        }
    }
    const labelText = (labelElements[index] && labelElements[index].textContent) ? labelElements[index].textContent.trim() : "";
    if (relationshipType) {
        mermaidLines.push(`    ${relationshipType}${labelText ? ' : ' + labelText : ''}`);
    }
  });

  if (mermaidLines.length <= 1 && Object.keys(classData).length === 0) return null;
  return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
}

/**
 * Helper: 将 SVG Sequence Diagram 图表转换为 Mermaid 代码
 * @param {SVGElement} svgElement - The SVG DOM element for the sequence diagram
 * @returns {string|null}
 */
function convertSequenceDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;

    const participants = [];
    const actorXCoordinates = new Map(); // Map actor name to its lifeline X coordinate

    // Extract participants from actor lines primarily, then fallback to top boxes
    svgElement.querySelectorAll('line.actor-line').forEach(line => {
        const name = line.getAttribute('name');
        const xPos = parseFloat(line.getAttribute('x1'));
        if (name && !isNaN(xPos) && !actorXCoordinates.has(name)) {
            participants.push({ name: name, x: xPos, alias: name.replace(/[^a-zA-Z0-9_]/g, '_') });
            actorXCoordinates.set(name, xPos);
        }
    });
    
    // Fallback if no actor-lines found or to catch any missed ones from top boxes
    svgElement.querySelectorAll('g[id^="root-"] > text.actor-box').forEach((textEl, index) => {
        // Try to get name from associated rect first if it's more reliable
        const parentGroup = textEl.closest('g[id^="root-"]');
        const rectName = parentGroup?.querySelector('rect.actor-top')?.getAttribute('name');
        const name = rectName || textEl.textContent.trim();
        
        if (name && !actorXCoordinates.has(name)) {
            // Estimate X from text el if line wasn't found or didn't have this participant
             // For X, try to find its corresponding line if possible, otherwise use text X
            let xPos = parseFloat(textEl.getAttribute('x')); // Text X is center
            const correspondingLine = svgElement.querySelector(`line.actor-line[name="${name}"]`);
            if(correspondingLine) {
                xPos = parseFloat(correspondingLine.getAttribute('x1'));
            }
            
            if (!isNaN(xPos)) {
                 participants.push({ name: name, x: xPos, alias: name.replace(/[^a-zA-Z0-9_]/g, '_') });
                 actorXCoordinates.set(name, xPos);
            }
        }
    });
    
    // Remove duplicate participants just in case, preferring those with valid x
    const uniqueParticipants = [];
    const seenNames = new Set();
    participants.filter(p => p.name && !isNaN(p.x)).forEach(p => {
        if (!seenNames.has(p.name)) {
            uniqueParticipants.push(p);
            seenNames.add(p.name);
        }
    });

    uniqueParticipants.sort((a, b) => a.x - b.x);

    let mermaidOutput = "sequenceDiagram\n";
    uniqueParticipants.forEach(p => {
        if (p.alias !== p.name) {
            mermaidOutput += `  participant ${p.alias} as "${p.name}"\n`;
        } else {
            mermaidOutput += `  participant ${p.name}\n`;
        }
    });
    mermaidOutput += "\n";

    const events = []; // To store messages and notes, then sort by Y

    // Extract Messages
    const messageLineElements = Array.from(svgElement.querySelectorAll('line[class^="messageLine"]'));
    const messageTextElements = Array.from(svgElement.querySelectorAll('text.messageText'));

    messageLineElements.forEach((lineEl, index) => {
        const x1 = parseFloat(lineEl.getAttribute('x1'));
        const y1 = parseFloat(lineEl.getAttribute('y1'));
        const x2 = parseFloat(lineEl.getAttribute('x2'));

        let fromActorName = null;
        let toActorName = null;
        let minDiffFrom = Infinity;
        let minDiffTo = Infinity;

        uniqueParticipants.forEach(p => {
            const diff1 = Math.abs(p.x - x1);
            if (diff1 < minDiffFrom) {
                minDiffFrom = diff1;
                fromActorName = p.alias; // Use alias for Mermaid syntax
            }
            const diff2 = Math.abs(p.x - x2);
            if (diff2 < minDiffTo) {
                minDiffTo = diff2;
                toActorName = p.alias; // Use alias for Mermaid syntax
            }
        });
        
        // Message text Y is usually close to line Y. The text element has its own Y.
        // Let's use the messageTextElements[index]'s Y if available and reliable.
        let eventY = y1;
        let textContent = "";
        if (messageTextElements[index]) {
            textContent = messageTextElements[index].textContent.trim().replace(/"/g, '#quot;');
            const textY = parseFloat(messageTextElements[index].getAttribute('y'));
            if (!isNaN(textY)) eventY = textY; // Use text's Y for sorting if it's more central to the message
        }


        const lineClass = lineEl.getAttribute('class') || "";
        const arrowType = lineClass.includes('messageLine1') ? '-->' : '->'; // Dashed or Solid

        if (fromActorName && toActorName) {
            events.push({
                y: eventY,
                type: 'message',
                data: {
                    from: fromActorName,
                    to: toActorName,
                    arrow: arrowType,
                    text: textContent
                }
            });
        }
    });

    // Extract Notes
    svgElement.querySelectorAll('g > rect.note').forEach(noteRect => {
        const rectY = parseFloat(noteRect.getAttribute('y'));
        const noteX = parseFloat(noteRect.getAttribute('x'));
        const noteWidth = parseFloat(noteRect.getAttribute('width'));
        
        let noteTextContent = "Note"; // Default text
        // Note text is within the same <g> as the rect.note in this SVG
        const noteTextElement = noteRect.parentElement.querySelector('text.noteText');

        if (noteTextElement) {
             noteTextContent = Array.from(noteTextElement.querySelectorAll('tspan'))
                               .map(tspan => tspan.textContent.trim())
                               .join(' ') || noteTextElement.textContent.trim();
             noteTextContent = noteTextContent.replace(/"/g, '#quot;');
        }

        let noteMermaidData = { text: noteTextContent };
        let placementDetermined = false;

        // Try to determine "over P1,P2" or "over P"
        const coveredParticipants = uniqueParticipants.filter(p => {
            const participantBoxStartX = p.x - 75; // Approximate box width 150
            const participantBoxEndX = p.x + 75;
            // Check for overlap: note range vs participant box range
            return Math.max(noteX, participantBoxStartX) < Math.min(noteX + noteWidth, participantBoxEndX);
        });

        if (coveredParticipants.length > 1) {
            // Sort covered participants by their X position
            coveredParticipants.sort((a,b) => a.x - b.x);
            noteMermaidData.position = 'over'; // Mermaid uses "over A,B" for notes spanning multiple actors
            noteMermaidData.actor1 = coveredParticipants[0].alias;
            noteMermaidData.actor2 = coveredParticipants[coveredParticipants.length - 1].alias;
            placementDetermined = true;
        } else if (coveredParticipants.length === 1) {
            noteMermaidData.position = 'over';
            noteMermaidData.actor1 = coveredParticipants[0].alias;
            placementDetermined = true;
        }

        // If not "over", try "left of" or "right of" the closest participant
        if (!placementDetermined) {
            let closestParticipant = null;
            let minDistToClosest = Infinity;
            uniqueParticipants.forEach(p => {
                const dist = Math.abs(p.x - (noteX + noteWidth / 2)); // Distance from note center to participant lifeline
                if (dist < minDistToClosest) {
                    minDistToClosest = dist;
                    closestParticipant = p;
                }
            });

            if (closestParticipant) {
                if (noteX + noteWidth < closestParticipant.x - 10) { // Note ends before participant lifeline (with margin)
                    noteMermaidData.position = 'left of';
                    noteMermaidData.actor1 = closestParticipant.alias;
                } else if (noteX > closestParticipant.x + 10) { // Note starts after participant lifeline (with margin)
                    noteMermaidData.position = 'right of';
                    noteMermaidData.actor1 = closestParticipant.alias;
                } else { // Default to "over" the closest if it's very near or slightly overlapping
                    noteMermaidData.position = 'over';
                    noteMermaidData.actor1 = closestParticipant.alias;
                }
                placementDetermined = true;
            }
        }
        
        if (placementDetermined && noteMermaidData.actor1) {
            events.push({
                y: rectY, // Sort notes by their rect's Y position
                type: 'note',
                data: noteMermaidData
            });
        }
    });

    // Sort all events by Y coordinate
    events.sort((a, b) => a.y - b.y);

    // Generate Mermaid lines for events
    events.forEach(event => {
        if (event.type === 'message') {
            const m = event.data;
            mermaidOutput += `  ${m.from}${m.arrow}${m.to}: ${m.text}\n`;
        } else if (event.type === 'note') {
            const n = event.data;
            if (n.position === 'over' && n.actor2) { // Handles "Note over P1,P2"
                mermaidOutput += `  Note over ${n.actor1},${n.actor2}: ${n.text}\n`;
            } else { // 'over P', 'left of P', 'right of P'
                mermaidOutput += `  Note ${n.position} ${n.actor1}: ${n.text}\n`;
            }
        }
    });
    
    if (uniqueParticipants.length === 0 && events.length === 0) return null; // No sequence elements found

    return '```mermaid\n' + mermaidOutput.trim() + '\n```';
}
// Helper function: recursively process nodes
function processNode(node) {
  // console.log("processNode START:", node.nodeName, node.nodeType, node.textContent ? node.textContent.substring(0,50) : ''); // DEBUG
  let resultMd = "";

  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentNode && node.parentNode.nodeName === 'PRE') { return node.textContent; }
    // Fix: For normal text nodes, avoid consecutive blank lines being converted to a single newline, 
    // then having \n\n added by outer logic causing too many empty lines
    // Simply return the text and let the parent block element handle the trailing \n\n
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node;
  const style = window.getComputedStyle(element);

  if (
    (style.display === "none" || style.visibility === "hidden") &&
    !["DETAILS", "SUMMARY"].includes(element.nodeName)
  ) {
    return "";
  }

  if (element.matches('button, [role="button"], nav, footer, aside, script, style, noscript, iframe, embed, object, header')) { // Added header to general skip
      return "";
  }
  if (element.classList.contains("bg-input-dark") && element.querySelector("svg")){ // Your specific rule
    return "";
  }


  // Main logic wrapped in try...catch to catch errors when processing specific nodes
  try {
    switch (element.nodeName) {
      case "P": {
        let txt = "";
        element.childNodes.forEach((c) => {
            try { txt += processNode(c); } catch (e) { console.error("Error processing child of P:", c, e); txt += "[err]";}
        });
        txt = txt.trim();
        if (txt.startsWith("```mermaid") && txt.endsWith("```")) { // Already processed as Mermaid
          resultMd = txt + "\n\n";
        } else if (txt) {
          resultMd = txt + "\n\n";
        } else {
          resultMd = "\n"; // Keep empty P tag as a newline if needed
        }
        break;
      }
      case "H1": resultMd = (element.textContent.trim() ? `# ${element.textContent.trim()}\n\n` : ""); break;
      case "H2": resultMd = (element.textContent.trim() ? `## ${element.textContent.trim()}\n\n` : ""); break;
      case "H3": resultMd = (element.textContent.trim() ? `### ${element.textContent.trim()}\n\n` : ""); break;
      case "H4": resultMd = (element.textContent.trim() ? `#### ${element.textContent.trim()}\n\n` : ""); break;
      case "H5": resultMd = (element.textContent.trim() ? `##### ${element.textContent.trim()}\n\n` : ""); break;
      case "H6": resultMd = (element.textContent.trim() ? `###### ${element.textContent.trim()}\n\n` : ""); break;
      case "UL": {
        let list = "";
        element.querySelectorAll(":scope > li").forEach((li) => {
          let liTxt = "";
          li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]";}});
          // Remove extra trailing newlines that might be produced by internal block elements
          liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
          if (liTxt) list += `* ${liTxt}\n`;
        });
        resultMd = list + (list ? "\n" : "");
        break;
      }
      case "OL": {
        let list = "";
        let i = 1;
        element.querySelectorAll(":scope > li").forEach((li) => {
          let liTxt = "";
          li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]";}});
          liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
          if (liTxt) {
            list += `${i}. ${liTxt}\n`;
            i++;
          }
        });
        resultMd = list + (list ? "\n" : "");
        break;
      }
      case "PRE": {
        const svgElement = getDiagramSvgInPre(element);
        let mermaidOutput = null;

        if (svgElement) {
          const diagramTypeDesc = (svgElement.getAttribute('aria-roledescription') || '').toLowerCase();
          const diagramClass = (svgElement.getAttribute('class') || '').toLowerCase();

          // console.log("Found SVG in PRE: desc=", diagramTypeDesc, "class=", diagramClass); // DEBUG
          if (diagramTypeDesc.includes('flowchart')) {
            mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
          } else if (diagramTypeDesc.includes('class')) {
            mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
          } else if (diagramTypeDesc.includes('sequence')) {
            mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
          } else if (diagramClass.includes('flowchart')) {
              mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
          } else if (diagramClass.includes('classdiagram') || diagramClass.includes('class')) {
              mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
          } else if (diagramClass.includes('sequencediagram') || diagramClass.includes('sequence')) {
              mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
          } else {
            // If role/class isn't stable yet, probe all Mermaid converters.
            mermaidOutput =
              convertFlowchartSvgToMermaidText(svgElement) ||
              convertClassDiagramSvgToMermaidText(svgElement) ||
              convertSequenceDiagramSvgToMermaidText(svgElement);
          }
        }

        if (mermaidOutput) {
          resultMd = `\n${mermaidOutput}\n\n`;
        } else {
          const code = element.querySelector("code");
          const codeText = (code?.textContent || "").trim();
          if (svgElement && !codeText) {
            const svgMarkup = svgElement.outerHTML || "";
            if (svgMarkup.trim()) {
              resultMd = `\n\`\`\`html\n${svgMarkup}\n\`\`\`\n\n`;
              break;
            }
          }
          let lang = "";
          let txt = "";
          if (code) {
            txt = code.textContent;
            const cls = Array.from(code.classList).find((c) => c.startsWith("language-"));
            if (cls) lang = cls.replace("language-", "");
          } else {
             txt = element.textContent;
          }
          const trimmedText = txt.trim();
          if (!trimmedText) {
            resultMd = "\n";
            break;
          }
          if (/^```mermaid[\s\S]*```$/.test(trimmedText)) {
            resultMd = `${trimmedText}\n\n`;
            break;
          }
          if (!lang) {
            const preCls = Array.from(element.classList).find((c) => c.startsWith("language-"));
            if (preCls) lang = preCls.replace("language-", "");
          }
          resultMd = `\`\`\`${lang}\n${trimmedText}\n\`\`\`\n\n`;
        }
        break;
      }
      case "A": {
        const href = element.getAttribute("href");
        let text = "";
        element.childNodes.forEach(c => { 
          try { 
            text += processNode(c); 
          } catch (e) { 
            console.error("Error processing child of A:", c, e); 
            text += "[err]";
          }
        });
        text = text.trim();

        if (!text && element.querySelector('img')) {
            text = element.querySelector('img').alt || 'image';
        }
        text = text || (href ? href : ""); // Fallback to href itself if text is still empty

        if (href && (href.startsWith('http') || href.startsWith('https') || href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:'))) {
          
          // 处理代码引用链接格式
          const hashMatch = href.match(/#L(\d+)-L(\d+)$/);
          if (hashMatch) {
              const hashStartLine = hashMatch[1];
              const hashEndLine = hashMatch[2];
              
              // 匹配"file.js 47-64"格式
              const textMatch = text.match(/^([\w\/-]+(?:\.\w+)?)\s+(\d+)-(\d+)$/);
              if (textMatch) {
                  const textFilename = textMatch[1];
                  const textStartLine = textMatch[2];
                  const textEndLine = textMatch[3];

                  if (hashStartLine === textStartLine && hashEndLine === textEndLine) {
                      const pathPart = href.substring(0, href.indexOf('#'));
                      if (pathPart.endsWith('/' + textFilename) || pathPart.includes('/' + textFilename) || pathPart === textFilename) {
                          text = `${textFilename} L${hashStartLine}-L${hashEndLine}`;
                      }
                  }
              } else {
                  // 匹配"Sources: [file.js 47-64]"格式
                  const sourcesMatch = text.match(/^Sources:\s+\[([\w\/-]+(?:\.\w+)?)\s+(\d+)-(\d+)\]$/);
                  if (sourcesMatch) {
                      const textFilename = sourcesMatch[1];
                      const textStartLine = sourcesMatch[2];
                      const textEndLine = sourcesMatch[3];
                      
                      if (hashStartLine === textStartLine && hashEndLine === textEndLine) {
                          const pathPart = href.substring(0, href.indexOf('#'));
                          if (pathPart.endsWith('/' + textFilename) || pathPart.includes('/' + textFilename) || pathPart === textFilename) {
                              text = `Sources: [${textFilename} L${hashStartLine}-L${hashEndLine}]`;
                          }
                      }
                  }
              }
          }
          
          resultMd = `[${text}](${href})`;
          if (window.getComputedStyle(element).display !== "inline") {
              resultMd += "\n\n";
          }
        } else { 
          resultMd = text; 
          if (window.getComputedStyle(element).display !== "inline" && text.trim()) {
              resultMd += "\n\n";
          }
        }
        break;
      }
      case "IMG":
        if (element.closest && element.closest('a')) return "";
        resultMd = (element.src ? `![${element.alt || ""}](${element.src})\n\n` : "");
        break;
      case "BLOCKQUOTE": {
        let qt = "";
        element.childNodes.forEach((c) => { try { qt += processNode(c); } catch (e) { console.error("Error processing child of BLOCKQUOTE:", c, e); qt += "[err]";}});
        const trimmedQt = qt.trim();
        if (trimmedQt) {
            resultMd = trimmedQt.split("\n").map((l) => `> ${l.trim() ? l : ''}`).filter(l => l.trim() !== '>').join("\n") + "\n\n";
        } else {
            resultMd = "";
        }
        break;
      }
      case "HR":
        resultMd = "\n---\n\n";
        break;
      case "STRONG":
      case "B": {
        let st = "";
        element.childNodes.forEach((c) => { try { st += processNode(c); } catch (e) { console.error("Error processing child of STRONG/B:", c, e); st += "[err]";}});
        return `**${st.trim()}**`; // Return directly
      }
      case "EM":
      case "I": {
        let em = "";
        element.childNodes.forEach((c) => { try { em += processNode(c); } catch (e) { console.error("Error processing child of EM/I:", c, e); em += "[err]";}});
        return `*${em.trim()}*`; // Return directly
      }
      case "CODE": {
          if (element.parentNode && element.parentNode.nodeName === 'PRE') {
              return element.textContent;
          }
          return `\`${element.textContent.trim()}\``; // Return directly
      }
      case "BR":
        if (element.parentNode && ['P', 'DIV', 'LI'].includes(element.parentNode.nodeName) ) { // Added LI
            const nextSibling = element.nextSibling;
            // Add markdown hard break only if BR is followed by text or is at the end of a line within a block
            if (!nextSibling || (nextSibling.nodeType === Node.TEXT_NODE && nextSibling.textContent.trim() !== '') || nextSibling.nodeType === Node.ELEMENT_NODE) {
                 return "  \n"; // Return directly
            }
        }
        return ""; // Return directly (or empty if not a hard break)
      case "TABLE": {
          let tableMd = "";
          const headerRows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tr:first-child'));
          const bodyRows = Array.from(element.querySelectorAll(':scope > tbody > tr'));
          const allRows = Array.from(element.rows); // Fallback

          let rowsToProcessForHeader = headerRows;
          if (headerRows.length === 0 && allRows.length > 0) { // Infer header if THEAD is missing
              rowsToProcessForHeader = [allRows[0]];
          }

          if (rowsToProcessForHeader.length > 0) {
              const headerRowElement = rowsToProcessForHeader[0];
              let headerContent = "|"; let separator = "|";
              Array.from(headerRowElement.cells).forEach(cell => {
                  let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Header):", c, e); cellText += "[err]";}});
                  headerContent += ` ${cellText.trim().replace(/\|/g, "\\|")} |`; separator += ` --- |`;
              });
              tableMd += `${headerContent}\n${separator}\n`;
          }

          let rowsToProcessForBody = bodyRows;
          if (bodyRows.length === 0 && allRows.length > (headerRows.length > 0 ? 1 : 0) ) { // If no TBODY, take remaining rows
              rowsToProcessForBody = headerRows.length > 0 ? allRows.slice(1) : allRows;
          }


          rowsToProcessForBody.forEach(row => {
              // Ensure we don't re-process a header row if using allRows fallback logic above and header was found
              if (rowsToProcessForHeader.length > 0 && rowsToProcessForHeader.includes(row)) return;

              let rowContent = "|";
              Array.from(row.cells).forEach(cell => {
                  let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Body):", c, e); cellText += "[err]";}});
                  rowContent += ` ${cellText.trim().replace(/\|/g, "\\|").replace(/\n+/g, ' <br> ')} |`;
              });
              tableMd += `${rowContent}\n`;
          });
          resultMd = tableMd + (tableMd ? "\n" : "");
          break;
      }
      case "THEAD": case "TBODY": case "TFOOT": case "TR": case "TH": case "TD":
          return ""; // Handled by TABLE case, return empty string if processed directly

      case "DETAILS": {
          let summaryText = "Details"; const summaryElem = element.querySelector('summary');
          if (summaryElem) { let tempSummary = ""; summaryElem.childNodes.forEach(c => { try { tempSummary += processNode(c); } catch (e) { console.error("Error processing child of SUMMARY:", c, e); tempSummary += "[err]";}}); summaryText = tempSummary.trim() || "Details"; }
          let detailsContent = "";
          Array.from(element.childNodes).forEach(child => { if (child.nodeName !== "SUMMARY") { try { detailsContent += processNode(child); } catch (e) { console.error("Error processing child of DETAILS:", child, e); detailsContent += "[err]";}}});
          resultMd = `> **${summaryText}**\n${detailsContent.trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
          break;
      }
      case "SUMMARY": return ""; // Handled by DETAILS

      case "DIV":
      case "SPAN":
      case "SECTION":
      case "ARTICLE":
      case "MAIN":
      default: {
        let txt = "";
        element.childNodes.forEach((c) => { try { txt += processNode(c); } catch (e) { console.error("Error processing child of DEFAULT case:", c, element.nodeName, e); txt += "[err]";}});
        
        const d = window.getComputedStyle(element);
        const isBlock = ["block", "flex", "grid", "list-item", "table", 
                         "table-row-group", "table-header-group", "table-footer-group"].includes(d.display);

        if (isBlock && txt.trim()) {
          // Ensure that text from children which already ends in \n\n isn't given more \n\n
          if (txt.endsWith('\n\n')) {
              resultMd = txt;
          } else if (txt.endsWith('\n')) { // if it ends with one \n, add one more for spacing
              resultMd = txt + '\n';
          } else { // if it has no trailing newlines, add two.
              resultMd = txt.trimEnd() + "\n\n";
          }
        } else { // Inline element or empty block element
          return txt; // Return directly
        }
      }
    }
  } catch (error) {
      console.error("Unhandled error in processNode for element:", element.nodeName, element, error);
      return `\n[ERROR_PROCESSING_ELEMENT: ${element.nodeName}]\n\n`; // Return an error placeholder
  }
  // console.log("processNode END for:", element.nodeName, "Output:", resultMd.substring(0,50)); // DEBUG
  return resultMd;
}
  function bootstrap() {
    mountPanel();
    registerMenuCommands();
    void resumeBatchTask();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
