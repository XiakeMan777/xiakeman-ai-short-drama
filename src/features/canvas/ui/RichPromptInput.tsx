// ---------------------------------------------------------------------------
// RichPromptInput — 即梦-style rich prompt input with inline image chips
// v3 - contenteditable approach (like Jimeng/即梦)
// ---------------------------------------------------------------------------
//
// Layout:
//   ┌──────────────────────────────────┐
//   │  [图1] [图2] [图3] ...   ← ReferenceStrip (缩略图条)
//   ├──────────────────────────────────┤
//   │  Prompt text with @图N chips     │  ← contenteditable div
//   │                            [@]   │  ← @ trigger button
//   └──────────────────────────────────┘
//
// Uses a single contenteditable div for both display and input.
// Chips are contenteditable="false" inline elements with data-token attribute.
// No dual-layer alignment issues.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { findReferenceTokens, insertReferenceToken, buildReferenceToken, buildAudioReferenceToken, removeReferenceTokenByNumber } from "../application/referenceTokenEditing";
import type { ReferenceImagePoolResult, ReferenceImageEntry } from "../application/referenceImagePool";
import { resolveReferenceThumbnailUrl } from "../application/referenceImagePool";

import { ReferencePicker } from "./ReferencePicker";
import { ReferenceStrip } from "./ReferenceStrip";
import { PromptAssistantPopover } from "./PromptAssistantPopover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RichPromptInputProps {
  /** The raw text value with @图N tokens */
  value: string;
  /** Called when the text value changes */
  onChange: (value: string) => void;
  /** Key down handler (for Enter to submit, etc.) */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Focus handler */
  onFocus?: () => void;
  /** Cursor position update callback (for external ReferenceStrip insert-at-cursor) */
  onCursorPosChange?: (pos: number) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Max text length */
  maxLength?: number;
  /** Reference image pool for chip rendering and picker */
  pool: ReferenceImagePoolResult;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Minimum height */
  minHeight?: number;
  /** Maximum height before scrolling */
  maxHeight?: number;
  /** Whether to show the reference strip above the input (default: true) */
  showStrip?: boolean;
  /** Called when user deletes a reference from the strip; receives the entry for edge removal */
  onDeleteRefEntry?: (entry: ReferenceImageEntry) => void;
  /** Whether to show the prompt assistant button (default: false) */
  showPromptAssistant?: boolean;
  /** Provider ID for prompt assistant AI calls and credit deduction */
  promptAssistantProviderId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Smart truncate: keep extension, e.g. "very_long_name...png" */
function truncateFilename(name: string, maxLen = 10): string {
  if (name.length <= maxLen) return name;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex > name.length - 8) {
    const ext = name.slice(dotIndex);
    const base = name.slice(0, dotIndex);
    const keep = maxLen - ext.length - 1;
    if (keep > 3) return base.slice(0, keep) + "…" + ext;
  }
  return name.slice(0, maxLen - 1) + "…";
}

/** Escape HTML special chars */
function escapeHTML(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Walk the contenteditable DOM and extract the value string.
 * Text nodes contribute their textContent.
 * Chip elements (data-token) contribute their token string.
 */
function extractValueFromDOM(element: HTMLElement): string {
  let value = "";
  const children = Array.from(element.childNodes);
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.nodeType === Node.TEXT_NODE) {
      value += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset.token) {
        value += el.dataset.token;
        // Ensure a space between token and following non-whitespace text.
        // Without this, the filename parser in findReferenceTokens() would
        // swallow user-typed text into the token's filename suffix, causing
        // the text to disappear inside the chip label.
        if (i + 1 < children.length) {
          const next = children[i + 1];
          const nextText = next.nodeType === Node.TEXT_NODE
            ? (next.textContent || "")
            : next.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).dataset.token
              ? "" // token-to-token: no extra space needed
              : "";
          if (nextText.length > 0 && !/^\s/.test(nextText)) {
            value += " ";
          }
        }
      } else if (el.tagName === "BR") {
        value += "\n";
      } else {
        value += extractValueFromDOM(el);
      }
    }
  }
  return value;
}

/**
 * Save cursor position in the contenteditable div.
 * Returns an offset relative to the value string.
 */
function saveCursorOffset(element: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  // Count text length up to cursor
  const fragment = preRange.cloneContents();
  const tempDiv = document.createElement("div");
  tempDiv.appendChild(fragment);
  return extractValueFromDOM(tempDiv).length;
}

/**
 * Restore cursor position in the contenteditable div.
 * Tries to set cursor at the given offset in the value string.
 */
function restoreCursorOffset(element: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  let currentOffset = 0;

  function walk(node: Node): boolean {
    if (currentOffset >= offset) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (currentOffset + text.length >= offset) {
        range.setStart(node, offset - currentOffset);
        range.collapse(true);
        return true;
      }
      currentOffset += text.length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset.token) {
        const tokenLen = (el.dataset.token || "").length;
        if (currentOffset + tokenLen >= offset) {
          // Cursor should be after this chip
          range.setStartAfter(el);
          range.collapse(true);
          return true;
        }
        currentOffset += tokenLen;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walk(child)) return true;
        }
      }
    }
    return false;
  }

  walk(element);

  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RichPromptInput({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onCursorPosChange,
  placeholder = "",
  disabled = false,
  // maxLength is not used in contenteditable mode but kept in the interface
  // for API compatibility. eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxLength: _maxLength,
  pool,
  className = "",
  style,
  minHeight: _minHeight = 120,
  maxHeight = 320,
  showStrip = false,
  onDeleteRefEntry,
  showPromptAssistant = false,
  promptAssistantProviderId = "grsai",
}: RichPromptInputProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastValueRef = useRef(value);
  const skipNextUpdateRef = useRef(false);
  const assistantBtnRef = useRef<HTMLButtonElement>(null);

  // Prompt assistant popover state
  const [showAssistantPopover, setShowAssistantPopover] = useState(false);
  const [assistantAnchorRect, setAssistantAnchorRect] = useState<DOMRect | undefined>();

  // @ picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);
  const atPositionRef = useRef<number | null>(null);
  const cursorPosRef = useRef<number>(0);

  // Compute which image numbers are currently referenced in the prompt
  const referencedNumbers = useMemo(() => {
    const tokens = findReferenceTokens(value, pool.count);
    return new Set(tokens.map((t) => t.imageNumber));
  }, [value, pool.count]);

  // ─── Build HTML content from value + tokens ──────────────────────────
  const buildHTML = useCallback((val: string): string => {
    const tokens = findReferenceTokens(val, pool.count);
    if (tokens.length === 0) {
      return escapeHTML(val);
    }

    let html = "";
    let lastIndex = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Text before token
      if (token.start > lastIndex) {
        html += escapeHTML(val.slice(lastIndex, token.start));
      }

      const entry = pool.getByNumber(token.imageNumber);
      const isValid = !!entry;
      const isAudio = token.mediaType === "audio";

      if (isValid) {
        // Build chip HTML
        let rawLabel = entry?.sourceNodeName || token.filename || (isAudio ? `音频${token.imageNumber}` : `图${token.imageNumber}`);
        if (rawLabel.startsWith("@image#") || rawLabel.startsWith("@audio#")) {
          const colonIdx = rawLabel.indexOf(":");
          rawLabel = colonIdx > 0 ? rawLabel.slice(colonIdx + 1) : (isAudio ? `音频${token.imageNumber}` : `图${token.imageNumber}`);
        }
        if (!rawLabel || rawLabel.trim() === "") {
          rawLabel = isAudio ? `音频${token.imageNumber}` : `图${token.imageNumber}`;
        }
        const label = escapeHTML(truncateFilename(rawLabel));

        const thumbnailSrc = entry ? resolveReferenceThumbnailUrl(entry) : null;
        // Chip color by media type
        const chipBg = isAudio ? "rgba(34, 197, 94, 0.92)" : "rgba(122, 180, 240, 0.92)";
        const chipBorder = isAudio ? "rgba(34, 197, 94, 0.95)" : "rgba(122, 180, 240, 0.95)";

        // Thumbnail / icon
        let thumbHTML = "";
        if (isAudio) {
          thumbHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
        } else if (thumbnailSrc) {
          thumbHTML = `<img src="${escapeHTML(thumbnailSrc)}" alt="" style="width:16px;height:16px;border-radius:3px;object-fit:cover;flex-shrink:0" draggable="false" />`;
        } else {
          thumbHTML = `<span style="display:inline-flex;width:16px;height:16px;flex-shrink:0;align-items:center;justify-content:center"></span>`;
        }

        html += `<span contenteditable="false" data-token="${escapeHTML(token.text)}" data-image-number="${token.imageNumber}" data-media-type="${token.mediaType || (isAudio ? "audio" : "image")}" class="nodrag" style="display:inline-flex;align-items:center;gap:4px;background-color:${chipBg};border:1px solid ${chipBorder};border-radius:6px;padding:1px 6px 1px 3px;cursor:default;font-size:12px;line-height:20px;color:#ffffff;font-weight:500;white-space:nowrap;position:relative;transition:background-color 0.15s;box-sizing:border-box;vertical-align:middle;user-select:none;margin:0 1px">${thumbHTML}<span style="flex-shrink:0">${label}</span><span data-chip-delete style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;font-size:10px;color:rgba(255,255,255,0.6);cursor:pointer;flex-shrink:0;margin-left:2px">×</span></span>`;
      } else {
        // Invalid token — show as strikethrough
        html += `<span style="background-color:rgba(234,88,12,0.15);border:1px solid rgba(234,88,12,0.3);border-radius:4px;padding:0 4px;color:var(--text-muted);text-decoration:line-through;font-size:12px">${escapeHTML(token.text)}</span>`;
      }

      lastIndex = token.end;
    }

    // Text after last token
    if (lastIndex < val.length) {
      html += escapeHTML(val.slice(lastIndex));
    }

    return html;
  }, [pool]);

  // ─── Keep buildHTML in a ref so the sync effect only fires on value changes ──
  const buildHTMLRef = useRef(buildHTML);
  buildHTMLRef.current = buildHTML;

  // ─── Helper: read current value from DOM (avoids stale closure) ────────
  const readDOMValue = useCallback((): string => {
    const el = editableRef.current;
    return el ? extractValueFromDOM(el) : value;
  }, [value]);

  // ─── Helper: apply new value to DOM and React state ───────────────────
  const applyValue = useCallback((newValue: string, cursorPos?: number) => {
    const el = editableRef.current;
    if (el) {
      el.innerHTML = buildHTMLRef.current(newValue);
    }
    skipNextUpdateRef.current = true;
    lastValueRef.current = newValue;
    onChange(newValue);
    if (cursorPos !== undefined) {
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          restoreCursorOffset(el, cursorPos);
        }
      });
    }
  }, [onChange]);

  // ─── Initial render + sync DOM from value ────────────────────────────
  // Use ref to manage DOM directly (not dangerouslySetInnerHTML)
  // because contenteditable manages its own DOM.
  const isInitializedRef = useRef(false);

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;

    if (!isInitializedRef.current) {
      // First render — set initial HTML
      el.innerHTML = buildHTMLRef.current(value);
      lastValueRef.current = value;
      isInitializedRef.current = true;
      return;
    }

    // If this update was triggered by our own handlers, don't overwrite the DOM
    if (skipNextUpdateRef.current) {
      skipNextUpdateRef.current = false;
      lastValueRef.current = value;
      return;
    }

    // External value change (from parent) — update DOM
    const currentDOMValue = extractValueFromDOM(el);
    if (currentDOMValue !== value) {
      el.innerHTML = buildHTMLRef.current(value);
      lastValueRef.current = value;
    }
  }, [value]); // intentionally only depend on value, not buildHTML

  // ─── Handle input from contenteditable ───────────────────────────────
  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    const el = editableRef.current;
    if (!el) return;

    const newValue = extractValueFromDOM(el);
    cursorPosRef.current = saveCursorOffset(el);
    onCursorPosChange?.(cursorPosRef.current);

    if (newValue !== value) {
      skipNextUpdateRef.current = true;
      lastValueRef.current = newValue;
      onChange(newValue);
    }
  }, [value, onChange]);

  // ─── Handle clicks on chip delete buttons ────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const deleteBtn = target.closest("[data-chip-delete]") as HTMLElement | null;
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const chip = deleteBtn.closest("[data-token]") as HTMLElement | null;
      if (chip) {
        const imageNumber = Number(chip.dataset.imageNumber);
        const mediaType = chip.dataset.mediaType as "image" | "audio" | undefined;
        // Read from DOM to avoid stale closure
        const currentValue = readDOMValue();
        const tokens = findReferenceTokens(currentValue, pool.count);
        const token = tokens.find((t) => t.imageNumber === imageNumber && (mediaType ? t.mediaType === mediaType : true));
        if (token) {
          let newValue = currentValue.slice(0, token.start) + currentValue.slice(token.end);
          newValue = newValue.replace(/\s{2,}/g, " ").trim();
          applyValue(newValue);
        }
      }
    }
  }, [readDOMValue, applyValue, pool.count]);

  // ─── Open picker ────────────────────────────────────────────────────
  const openPicker = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const anchorRect = {
      left: rect.left,
      top: rect.bottom - 30,
      right: rect.left,
      bottom: rect.bottom - 30 + 22,
      width: 0,
      height: 22,
      x: rect.left,
      y: rect.bottom - 30,
      toJSON: () => "",
    } as DOMRect;

    setPickerAnchorRect(anchorRect);
    setShowPicker(true);
  }, []);

  // ─── Detect bare "@" in value after every change ────────────────────
  useEffect(() => {
    const cursorPos = cursorPosRef.current;

    let foundAtPos: number | null = null;
    for (let i = cursorPos - 1; i >= Math.max(0, cursorPos - 50); i--) {
      const ch = value[i];
      if (ch === "@") {
        const afterAt = value.slice(i);
        if (/^@image#\d+:/.test(afterAt) || /^@audio#\d+:/.test(afterAt) || /^@图\d+[\s\W]/.test(afterAt) || /^@图\d+$/.test(afterAt)) {
          break;
        }
        foundAtPos = i;
        break;
      }
      if (ch === " " || ch === "\n" || ch === "\t") {
        break;
      }
    }

    if (foundAtPos !== null && !showPicker) {
      atPositionRef.current = foundAtPos;
      openPicker();
    } else if (foundAtPos === null && showPicker) {
      setShowPicker(false);
      atPositionRef.current = null;
    } else if (foundAtPos !== null && showPicker) {
      atPositionRef.current = foundAtPos;
    }
  }, [value, showPicker, openPicker]);

  // ─── Handle clicking a reference strip card ─────────────────────────
  const handleStripInsertRef = useCallback(
    (imageNumber: number) => {
      const el = editableRef.current;

      // If editor is not focused, we need to focus it first.
      // However, we should NOT move cursor to end — instead, restore cursor
      // to the last known position (cursorPosRef) so the chip inserts where
      // the user was typing, not at the end of the text.
      if (el && document.activeElement !== el) {
        el.focus();
        // Restore cursor to the last known position (may be 0 if never focused)
        const lastPos = cursorPosRef.current;
        if (lastPos > 0) {
          restoreCursorOffset(el, lastPos);
        }
      }

      // Read from DOM to avoid stale closure (user may have typed text not yet in value)
      const currentValue = readDOMValue();

      const entry = pool.getByNumber(imageNumber);
      const filename = entry?.sourceNodeName || undefined;
      const isAudioEntry = entry?.mediaType === "audio";
      const marker = isAudioEntry
        ? buildAudioReferenceToken(imageNumber, filename)
        : buildReferenceToken(imageNumber, filename);

      // If already referenced, remove the reference (toggle behavior)
      const tokens = findReferenceTokens(currentValue, pool.count);
      const existingToken = tokens.find((t) => t.imageNumber === imageNumber && (isAudioEntry ? t.mediaType === "audio" : t.mediaType !== "audio"));
      if (existingToken) {
        let newValue = currentValue.slice(0, existingToken.start) + currentValue.slice(existingToken.end);
        newValue = newValue.replace(/\s{2,}/g, " ").trim();
        applyValue(newValue);
        return;
      }

      // Insert at current cursor position (not at end)
      const cursorPos = cursorPosRef.current;
      const result = insertReferenceToken(currentValue, cursorPos, marker);
      applyValue(result.text, result.cursor);
    },
    [readDOMValue, applyValue, pool]
  );

  // ─── Handle deleting a reference from the strip ─────────────────────
  const handleStripDeleteRef = useCallback(
    (entry: ReferenceImageEntry) => {
      const currentValue = readDOMValue();
      const newValue = removeReferenceTokenByNumber(currentValue, entry.number);
      applyValue(newValue);
      if (onDeleteRefEntry) {
        onDeleteRefEntry(entry);
      }
    },
    [readDOMValue, applyValue, onDeleteRefEntry]
  );

  // ─── Handle keydown ─────────────────────────────────────────────────
  const handleKeyDownInternal = useCallback(
    (e: React.KeyboardEvent) => {
      // Update cursor position tracking
      const el = editableRef.current;
      if (el) {
        cursorPosRef.current = saveCursorOffset(el);
        onCursorPosChange?.(cursorPosRef.current);
      }

      if (showPicker) {
        if (e.key === "Escape") {
          setShowPicker(false);
          atPositionRef.current = null;
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          return;
        }
      }

      // No custom backspace handler — let the browser handle chip deletion
      // natively. contenteditable="false" elements are selected on first
      // backspace and deleted on second, which is the expected UX.

      onKeyDown?.(e);
    },
    [showPicker, onKeyDown]
  );

  // ─── Handle image/audio selection from picker ────────────────────────
  const handlePickerSelect = useCallback(
    (imageNumber: number) => {
      setShowPicker(false);

      const currentValue = readDOMValue();

      const entry = pool.getByNumber(imageNumber);
      const filename = entry?.sourceNodeName || undefined;
      const isAudioEntry = entry?.mediaType === "audio";
      const marker = isAudioEntry
        ? buildAudioReferenceToken(imageNumber, filename)
        : buildReferenceToken(imageNumber, filename);

      if (atPositionRef.current !== null) {
        const atPos = atPositionRef.current;

        // Find end of the filter text / partial reference after "@"
        let endPos = atPos + 1;
        while (endPos < currentValue.length && !/[\s@\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(currentValue[endPos])) {
          endPos++;
        }

        const before = currentValue.slice(0, atPos);
        const after = currentValue.slice(endPos);
        const needsTrailingSpace = after.length > 0 && !/\s/.test(after[0]);
        const newValue = `${before}${marker}${needsTrailingSpace ? " " : ""}${after}`;

        const newCursorPos = atPos + marker.length + (needsTrailingSpace ? 1 : 0);
        applyValue(newValue, newCursorPos);
      } else {
        // Fallback: append
        const result = insertReferenceToken(currentValue, currentValue.length, marker);
        applyValue(result.text, result.cursor);
      }

      atPositionRef.current = null;
    },
    [readDOMValue, applyValue, pool]
  );

  // ─── Close picker ───────────────────────────────────────────────────
  const handlePickerClose = useCallback(() => {
    if (atPositionRef.current !== null) {
      const atPos = atPositionRef.current;
      const currentValue = readDOMValue();
      if (currentValue[atPos] === "@") {
        let endPos = atPos + 1;
        while (endPos < currentValue.length && /[\w\u4e00-\u9fff\d]/.test(currentValue[endPos])) {
          endPos++;
        }
        const afterAt = currentValue.slice(atPos);
        const isCompleteToken = /^@image#\d+:/.test(afterAt) || /^@audio#\d+:/.test(afterAt) || /^@图\d+[\s\W]/.test(afterAt) || /^@图\d+$/.test(afterAt);
        if (!isCompleteToken) {
          const newValue = currentValue.slice(0, atPos) + currentValue.slice(endPos);
          applyValue(newValue);
        }
      }
    }
    setShowPicker(false);
    atPositionRef.current = null;
  }, [readDOMValue, applyValue]);

  // ─── Compute filter text ────────────────────────────────────────────
  const filterText = useMemo(() => {
    if (!showPicker || atPositionRef.current === null) return "";
    const atPos = atPositionRef.current + 1;
    let end = atPos;
    while (end < value.length && !/[\s@\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(value[end])) {
      end++;
    }
    return value.slice(atPos, end);
  }, [showPicker, value]);

  const hasReferences = pool.entries.length > 0;

  return (
    <div
      ref={containerRef}
      className={`unified-input ${className}`}
      style={{
        position: "relative",
        minHeight: `${_minHeight}px`,
        display: "flex",
        flexDirection: "column",
        borderRadius: "10px",
        padding: 0,
        ...style,
      }}
    >
      {/* Reference strip — 即梦-style thumbnail bar above the input */}
      {showStrip && hasReferences && (
        <ReferenceStrip
          entries={pool.entries}
          referencedNumbers={referencedNumbers}
          onInsertRef={handleStripInsertRef}
          onDeleteRef={handleStripDeleteRef}
        />
      )}

      {/* Contenteditable input area */}
      <div style={{ position: "relative", flex: 1, minHeight: `${_minHeight}px`, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          ref={editableRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onClick={handleClick}
          onInput={handleInput}
          onKeyDown={handleKeyDownInternal}
          onFocus={() => {
            const el = editableRef.current;
            if (el) { cursorPosRef.current = saveCursorOffset(el); onCursorPosChange?.(cursorPosRef.current); }
            onFocus?.();
          }}
          onBlur={() => {
            // Save cursor position on blur so we can restore it later
            // (e.g., when user clicks a reference strip card)
            const el = editableRef.current;
            if (el) { cursorPosRef.current = saveCursorOffset(el); onCursorPosChange?.(cursorPosRef.current); }
          }}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            // After composition, extract value and notify
            const el = editableRef.current;
            if (el) {
              const newValue = extractValueFromDOM(el);
              cursorPosRef.current = saveCursorOffset(el);
              onCursorPosChange?.(cursorPosRef.current);
              if (newValue !== value) {
                skipNextUpdateRef.current = true;
                lastValueRef.current = newValue;
                onChange(newValue);
              }
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            let text = e.clipboardData.getData("text/plain");
            // Strip @image#N:filename / @audio#N:filename markers from pasted text
            text = text.replace(/@(?:image|audio)#\d+:[^\s]*/g, "").replace(/\s{2,}/g, " ").trim();
            document.execCommand("insertText", false, text);
          }}
          className="w-full nodrag nowheel"
          style={{
            fontSize: "14px",
            lineHeight: "22px",
            fontFamily: "inherit",
            width: "100%",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
            outline: "none",
            border: "none",
            borderRadius: "6px",
            padding: "6px 8px",
            minHeight: `${Math.max(_minHeight - 12, 40)}px`,
            flex: 1,
            ...(maxHeight > 0 ? { maxHeight: `${maxHeight}px` } : {}),
            overflow: "auto",
            color: "var(--text-primary)",
            caretColor: "var(--text-primary)",
            opacity: disabled ? 0.5 : 1,
            backgroundColor: "var(--bg-secondary)",
          }}
        />

        {/* Placeholder */}
        {!value && (
          <div
            style={{
              position: "absolute",
              top: "6px",
              left: "8px",
              fontSize: "14px",
              lineHeight: "22px",
              fontFamily: "inherit",
              color: "var(--text-muted)",
              pointerEvents: "none",
              padding: "0",
            }}
          >
            {placeholder}
          </div>
        )}

        {/* Prompt assistant button */}
        {showPromptAssistant && (
          <button
            ref={assistantBtnRef}
            type="button"
            onClick={() => {
              const btn = assistantBtnRef.current;
              if (btn) setAssistantAnchorRect(btn.getBoundingClientRect());
              setShowAssistantPopover((v) => !v);
            }}
            className="nodrag"
            style={{
              position: "absolute",
              top: "6px",
              right: "6px",
              zIndex: 3,
              width: "22px",
              height: "22px",
              borderRadius: "6px",
              backgroundColor: showAssistantPopover ? "rgba(122, 180, 240, 0.2)" : "transparent",
              border: `0.5px solid ${showAssistantPopover ? "#7ab4f0" : "#2e2e34"}`,
              color: "#7ab4f0",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!showAssistantPopover) { (e.currentTarget as HTMLElement).style.borderColor = "#7ab4f0"; (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(122, 180, 240, 0.1)"; }
            }}
            onMouseLeave={(e) => {
              if (!showAssistantPopover) { (e.currentTarget as HTMLElement).style.borderColor = "#2e2e34"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }
            }}
            title="提示词助手"
          >
            +
          </button>
        )}

      </div>

      {/* Reference picker popup — portal to body */}
      {showPicker &&
        createPortal(
          <ReferencePicker
            entries={pool.entries}
            onSelect={handlePickerSelect}
            onClose={handlePickerClose}
            anchorRect={pickerAnchorRect}
            filterText={filterText}
          />,
          document.body
        )}

      {/* Prompt assistant popover */}
      {showAssistantPopover && (
        <PromptAssistantPopover
          currentPrompt={value}
          selectedProviderId={promptAssistantProviderId}
          onApply={(newPrompt) => {
            applyValue(newPrompt, newPrompt.length);
            setShowAssistantPopover(false);
          }}
          onClose={() => setShowAssistantPopover(false)}
          anchorRect={assistantAnchorRect}
        />
      )}
    </div>
  );
}



