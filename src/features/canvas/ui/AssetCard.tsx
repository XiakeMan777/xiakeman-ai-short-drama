import { useMemo, useState, useCallback } from "react";
import { resolveImageDisplayUrl } from "../application/imageData";
import type { AssetRecord } from "@/features/canvas/stores/assetStore";

// ---------------------------------------------------------------------------
// AssetCard — with click-to-apply, drag, edit, and fallback support
// ---------------------------------------------------------------------------

interface AssetCardProps {
  asset: AssetRecord;
  onDelete: (id: string) => void;
  onEdit: (asset: AssetRecord) => void;
  onClick: (asset: AssetRecord) => void;
  onDragStart?: (e: React.DragEvent, asset: AssetRecord) => void;
  onInsert?: (asset: AssetRecord) => void;
}

/** Category badge color mapping — low-saturation, matches dark theme (fix C2) */
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  模特: { bg: "rgba(139, 92, 246, 0.30)", text: "rgba(179, 150, 255, 0.95)" },
  场景: { bg: "rgba(122, 180, 240, 0.25)", text: "rgba(160, 210, 255, 0.95)" },
  道具: { bg: "rgba(234, 179, 8, 0.25)", text: "rgba(250, 210, 100, 0.95)" },
};

const MEDIA_TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  video: { bg: "rgba(16, 185, 129, 0.30)", text: "rgba(110, 231, 183, 0.95)", label: "视频" },
  image: { bg: "rgba(100, 100, 100, 0.20)", text: "var(--text-secondary)", label: "图片" },
};

const DEFAULT_BADGE: { bg: string; text: string } = {
  bg: "rgba(100, 100, 100, 0.35)", // C11: slightly more visible than before
  text: "var(--text-secondary)",
};

function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen) + "…";
}

export function AssetCard({ asset, onDelete, onEdit, onClick, onDragStart, onInsert }: AssetCardProps) {
  // Fix A1: Prefer thumbnail_path for display (much smaller), fall back to full file_path
  const displayUrl = useMemo(
    () => resolveImageDisplayUrl(asset.thumbnail_path || asset.file_path),
    [asset.thumbnail_path, asset.file_path]
  );

  // U5: Track image load failure for fallback
  const [imgError, setImgError] = useState(false);

  const badgeStyle = CATEGORY_COLORS[asset.category] || DEFAULT_BADGE;
  const isVideo = (asset.media_type || "image") === "video";
  const mediaBadge = MEDIA_TYPE_BADGE[asset.media_type || "image"] || MEDIA_TYPE_BADGE.image;

  // U2: Drag support — pass asset data via dataTransfer
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (onDragStart) {
        onDragStart(e, asset);
      }
      // Set drag image to the card's image preview
      const imgEl = e.currentTarget.querySelector("img");
      if (imgEl) {
        e.dataTransfer.setDragImage(imgEl, 40, 40);
      }
      e.dataTransfer.setData("application/asset-id", asset.id);
      e.dataTransfer.setData("application/asset-path", asset.file_path);
      e.dataTransfer.effectAllowed = "copy";
    },
    [onDragStart, asset]
  );

  return (
    <div
      className="group relative flex flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        // C7: Use border-hover instead of accent — hover ≠ selected
        e.currentTarget.style.borderColor = "var(--border-hover)";
        e.currentTarget.style.boxShadow = "0 0 0 1px var(--border-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
      }}
      // U1: Click to apply asset to selected node
      onClick={() => onClick(asset)}
      // U2: Enable drag
      draggable={true}
      onDragStart={handleDragStart}
      title={`点击应用到当前选中节点 · 拖拽到画布创建新节点`}
    >
      {/* Image preview */}
      <div
        className="relative"
        style={{
          width: "100%",
          // U14: Use 4:3 aspect ratio instead of 1:1 for better image display
          aspectRatio: "4/3",
          overflow: "hidden",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        {displayUrl && !imgError ? (
          <img
            src={displayUrl}
            alt={asset.name}
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            // U5: Handle image load failure
            onError={() => setImgError(true)}
            draggable={false}
          />
        ) : (
          // Fix C1 + U5: SVG fallback for missing/broken images
          <div
            className="flex items-center justify-center"
            style={{
              width: "100%",
              height: "100%",
              color: "var(--text-muted)",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
              {imgError && (
                // Red X overlay for broken images
                <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2" stroke="var(--error)" />
              )}
            </svg>
          </div>
        )}

        {/* Category badge (top-left) — C2: uses category-matched bg + text */}
        <div
          style={{
            position: "absolute",
            top: "6px",
            left: "6px",
            padding: "2px 8px",
            borderRadius: "6px",
            backgroundColor: badgeStyle.bg,
            color: badgeStyle.text,
            fontSize: "11px",
            fontWeight: 600,
            lineHeight: "18px",
            pointerEvents: "none",
          }}
        >
          {asset.category}
        </div>

        {/* Media type badge (top-left, next to category) — video badge for video assets */}
        {isVideo && (
          <div
            style={{
              position: "absolute",
              top: "6px",
              left: asset.category.length > 2 ? "44px" : "30px",
              padding: "2px 8px",
              borderRadius: "6px",
              backgroundColor: mediaBadge.bg,
              color: mediaBadge.text,
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: "18px",
              pointerEvents: "none",
            }}
          >
            视频
          </div>
        )}

        {/* Video play icon overlay (center) */}
        {isVideo && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "rgba(0, 0, 0, 0.60)",
              border: "2px solid rgba(255, 255, 255, 0.30)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="white"
              stroke="none"
            >
              <polygon points="5 3 19 12 5 21" />
            </svg>
          </div>
        )}

        {/* Insert-to-node button (top-right, visible on hover) */}
        {onInsert && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInsert(asset);
            }}
            title="插入到节点"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              position: "absolute",
              top: "6px",
              right: "74px",
              width: "26px",
              height: "26px",
              borderRadius: "6px",
              backgroundColor: "rgba(0, 0, 0, 0.65)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "var(--accent-btn)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}

        {/* Edit button (top-right, visible on hover) — U3 — C9: added border for dark images */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(asset);
          }}
          title="编辑"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            position: "absolute",
            top: "6px",
            right: "40px",
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>

        {/* Delete button (top-right, visible on hover) — C9: added border */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(asset.id);
          }}
          title="删除"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            color: "var(--error)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>

      {/* Title + Tags — U4: show tags */}
      <div
        style={{
          padding: "6px 8px",
          fontSize: "12px",
          color: "var(--text-primary)",
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={asset.name}
      >
        {truncateName(asset.name, 20)}
      </div>
      {/* Tags row (U4) */}
      {asset.tags && (
        <div
          style={{
            padding: "0 8px 6px",
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
            overflow: "hidden",
          }}
        >
          {asset.tags.split(/[,，\s]+/).filter(Boolean).slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                // C10: Use accent-dim + accent text, consistent with AudioNode badge style
                backgroundColor: "var(--accent-dim)",
                color: "var(--accent-light)",
                lineHeight: "16px",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}



