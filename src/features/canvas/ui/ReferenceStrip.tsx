// ---------------------------------------------------------------------------
// ReferenceStrip — 即梦-style reference image strip shown above the prompt
// ---------------------------------------------------------------------------
//
// Displays a horizontal row of reference image thumbnails with labels.
// Clicking a card inserts @图N into the prompt.
// Already-referenced cards show a highlighted border.
//
// 即梦 (Dreamina) 全能参考风格:
//   - 深色背景区域包裹整个缩略图条
//   - 每个缩略图 ~56×56px，圆角矩形
//   - 选中态: 高亮边框 + 右下角勾选指示器
//   - 未选中态: 半透明 + 暗色边框
// ---------------------------------------------------------------------------

import { memo } from "react";
import type { ReferenceImageEntry } from "../application/referenceImagePool";
import { resolveReferenceThumbnailUrl } from "../application/referenceImagePool";
import { useCachedImage } from "../hooks/useCachedImage";

interface ReferenceStripProps {
  /** All reference image entries from the pool */
  entries: ReferenceImageEntry[];
  /** Set of currently referenced image numbers (from @图N tokens in prompt) */
  referencedNumbers: Set<number>;
  /** Called when user clicks a card to insert @图N reference */
  onInsertRef: (imageNumber: number) => void;
  /** Called when user clicks the delete button on a card; receives the full entry for edge cleanup */
  onDeleteRef?: (entry: ReferenceImageEntry) => void;
}

// ---------------------------------------------------------------------------
// Individual strip item — memoized to prevent re-rendering when other
// entries change (e.g., another image is added/removed).
// ---------------------------------------------------------------------------

interface ReferenceStripItemProps {
  entry: ReferenceImageEntry;
  isReferenced: boolean;
  onInsertRef: (imageNumber: number) => void;
  onDeleteRef?: (entry: ReferenceImageEntry) => void;
}

const ReferenceStripItem = memo(function ReferenceStripItem({
  entry,
  isReferenced,
  onInsertRef,
  onDeleteRef,
}: ReferenceStripItemProps) {
  const thumbnailSrc = resolveReferenceThumbnailUrl(entry);
  const { loaded, displayUrl } = useCachedImage(thumbnailSrc);
  const isAudio = entry.mediaType === "audio";
  const label = entry.sourceNodeName || (isAudio ? `音频${entry.number}` : `图${entry.number}`);
  const accentColor = isAudio ? "#22c55e" : "var(--accent)";

  return (
    <div
      className="nodrag"
      onClick={() => onInsertRef(entry.number)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        cursor: "pointer",
        flexShrink: 0,
        transition: "transform 0.15s, opacity 0.15s",
        opacity: isReferenced ? 1 : 0.6,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "scale(1.05)";
        el.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.transform = "scale(1)";
        el.style.opacity = isReferenced ? "1" : "0.6";
      }}
    >
      {/* Thumbnail card */}
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "10px",
          overflow: "hidden",
          border: isReferenced
            ? `2px solid ${accentColor}`
            : "2px solid rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.05)",
          position: "relative",
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxShadow: isReferenced
            ? `0 0 0 1px ${accentColor}, 0 2px 8px ${isAudio ? "rgba(34,197,94,0.25)" : "rgba(176,176,184,0.15)"}`
            : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={`${label}${entry.width && entry.height ? ` · ${entry.width}×${entry.height}` : ""}${entry.source === "upstream" ? " · 上游参考" : " · 素材库"}`}
      >
        {isAudio ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        ) : displayUrl ? (
          <img
            src={displayUrl}
            alt={`图${entry.number}`}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: loaded ? 1 : 0,
              transition: "opacity 0.15s ease",
            }}
            draggable={false}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
              color: "var(--text-muted)",
            }}
          >
            ?
          </div>
        )}

        {/* Referenced checkmark badge */}
        {isReferenced && (
          <div
            style={{
              position: "absolute",
              bottom: "2px",
              right: "2px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: accentColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              color: "#fff",
              fontWeight: 700,
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            ✓
          </div>
        )}

        {/* Delete button — available for both upstream and asset-library images */}
        {onDeleteRef && (
          <button
            className="nodrag"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteRef(entry);
            }}
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.9)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              padding: 0,
              lineHeight: 1,
              zIndex: 2,
            }}
            title="删除"
          >
            ×
          </button>
        )}
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: "10px",
          color: isReferenced ? accentColor : "var(--text-muted)",
          fontWeight: isReferenced ? 600 : 400,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "60px",
          textAlign: "center",
          lineHeight: "12px",
        }}
      >
        {label}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main strip component
// ---------------------------------------------------------------------------

export function ReferenceStrip({
  entries,
  referencedNumbers,
  onInsertRef,
  onDeleteRef,
}: ReferenceStripProps) {
  // Show upstream images always, and asset-library images only when referenced.
  // Persisted asset refs ensure referenced assets survive panel closes.
  const displayEntries = entries.filter(
    (e) => e.source === "upstream" || referencedNumbers.has(e.number)
  );
  if (displayEntries.length === 0) return null;

  return (
    <div
      className="nodrag"
      style={{
        display: "flex",
        gap: "8px",
        padding: "10px 12px",
        overflowX: "auto",
        flexShrink: 0,
        scrollbarWidth: "thin",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        borderRadius: "10px",
        marginBottom: "8px",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      {displayEntries.map((entry) => (
        <ReferenceStripItem
          key={`ref-strip-${entry.number}`}
          entry={entry}
          isReferenced={referencedNumbers.has(entry.number)}
          onInsertRef={onInsertRef}
          onDeleteRef={onDeleteRef}
        />
      ))}
    </div>
  );
}



