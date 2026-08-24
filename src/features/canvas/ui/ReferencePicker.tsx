import { useState, useEffect, useRef } from "react";
import type { ReferenceImageEntry } from "../application/referenceImagePool";
import { resolveReferenceThumbnailUrl } from "../application/referenceImagePool";
import { resolveImageDisplayUrl } from "../application/imageData";

type TabType = "upstream" | "asset";

interface ReferencePickerProps {
  entries: ReferenceImageEntry[];
  onSelect: (imageNumber: number) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
  /** Search/filter text typed after "@" */
  filterText?: string;
}

export function ReferencePicker({
  entries,
  onSelect,
  onClose,
  anchorRect,
  filterText = "",
}: ReferencePickerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("upstream");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group entries by source
  const upstreamEntries = entries.filter((e) => e.source === "upstream");
  const assetEntries = entries.filter((e) => e.source === "asset");

  // Apply filter text (fuzzy match on sourceNodeName)
  const filterLower = filterText.toLowerCase();
  const filterEntries = (list: ReferenceImageEntry[]) =>
    filterLower
      ? list.filter((e) => {
          const name = (e.sourceNodeName || `图${e.number}`).toLowerCase();
          return name.includes(filterLower);
        })
      : list;

  const filteredUpstream = filterEntries(upstreamEntries);
  const filteredAsset = filterEntries(assetEntries);

  const hasUpstream = filteredUpstream.length > 0;
  const hasAsset = filteredAsset.length > 0;

  // Current tab's entries
  const currentEntries = activeTab === "upstream" ? filteredUpstream : filteredAsset;

  // Auto-switch tab if current tab is empty (based on filtered results)
  useEffect(() => {
    if (activeTab === "upstream" && !hasUpstream && hasAsset) {
      setActiveTab("asset");
    } else if (activeTab === "asset" && !hasAsset && hasUpstream) {
      setActiveTab("upstream");
    }
  }, [hasUpstream, hasAsset, activeTab]);

  // Reset selection when tab, entries, or filter change
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeTab, currentEntries.length, filterText]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab switching with left/right arrows
      if (e.key === "ArrowRight" && hasUpstream && hasAsset) {
        e.preventDefault();
        setActiveTab((prev) => (prev === "upstream" ? "asset" : "upstream"));
        return;
      }
      if (e.key === "ArrowLeft" && hasUpstream && hasAsset) {
        e.preventDefault();
        setActiveTab((prev) => (prev === "asset" ? "upstream" : "asset"));
        return;
      }

      if (currentEntries.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % currentEntries.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + currentEntries.length) % currentEntries.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = currentEntries[selectedIndex];
        if (entry) {
          onSelect(entry.number);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentEntries, selectedIndex, onSelect, onClose, hasUpstream, hasAsset]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  if (entries.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          left: anchorRect ? anchorRect.left : 0,
          top: anchorRect ? anchorRect.bottom + 4 : 0,
          zIndex: 999,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "16px 20px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          minWidth: "200px",
        }}
      >
        <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          暂无可用素材
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
          请先连接包含图片或音频的上游节点或添加素材到素材库
        </div>
      </div>
    );
  }

  // No results after filtering
  const allFilteredCount = filteredUpstream.length + filteredAsset.length;
  if (allFilteredCount === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          left: anchorRect ? anchorRect.left : 0,
          top: anchorRect ? anchorRect.bottom + 4 : 0,
          zIndex: 999,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "16px 20px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          minWidth: "200px",
        }}
      >
        <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          无匹配结果
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
          "{filterText}" 未匹配到任何素材
        </div>
      </div>
    );
  }

  const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "6px 12px",
    borderRadius: "20px",
    border: "none",
    background: isActive ? "var(--bg-hover)" : "transparent",
    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
    fontSize: "13px",
    fontWeight: isActive ? 600 : 400,
    cursor: "pointer",
    transition: "all 0.15s",
    textAlign: "center",
  });

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: anchorRect ? anchorRect.left : 0,
        top: anchorRect ? anchorRect.bottom + 4 : 0,
        zIndex: 999,
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        minWidth: "240px",
        maxWidth: "320px",
        maxHeight: "360px",
        overflow: "auto",
      }}
    >
      {/* Tab buttons */}
      {(hasUpstream && hasAsset) && (
        <div
          style={{
            display: "flex",
            gap: "4px",
            padding: "4px 4px 8px",
            borderBottom: "1px solid var(--border)",
            marginBottom: "8px",
          }}
        >
          {hasUpstream && (
            <button
              style={tabButtonStyle(activeTab === "upstream")}
              onClick={() => setActiveTab("upstream")}
            >
              参考素材
            </button>
          )}
          {hasAsset && (
            <button
              style={tabButtonStyle(activeTab === "asset")}
              onClick={() => setActiveTab("asset")}
            >
              素材库
            </button>
          )}
        </div>
      )}

      {/* Only one source available — show label */}
      {!(hasUpstream && hasAsset) && (
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-muted)",
            padding: "4px 8px 8px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {hasUpstream ? "参考素材" : "素材库"}
        </div>
      )}

      {/* Media grid */}
      {currentEntries.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "8px",
            padding: "4px",
          }}
        >
          {currentEntries.map((entry, index) => {
            const thumbnailSrc = resolveReferenceThumbnailUrl(entry);
            const displaySrc = resolveImageDisplayUrl(thumbnailSrc);
            const isSelected = index === selectedIndex;
            const isAudio = entry.mediaType === "audio";
            const selectColor = isAudio ? "#22c55e" : "var(--accent)";
            const selectBg = isAudio ? "rgba(34, 197, 94, 0.1)" : "rgba(122, 180, 240, 0.1)";

            return (
              <button
                key={`${activeTab}-${entry.number}`}
                onClick={() => onSelect(entry.number)}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px",
                  borderRadius: "8px",
                  border: isSelected
                    ? `2px solid ${selectColor}`
                    : "2px solid transparent",
                  background: isSelected
                    ? selectBg
                    : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {/* Thumbnail */}
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg-secondary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isAudio ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={selectColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  ) : (
                    <img
                      src={displaySrc}
                      alt={`图${entry.number}`}
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                      draggable={false}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </div>

                {/* Label — show filename if available, else fallback */}
                <div
                  style={{
                    fontSize: "11px",
                    color: isSelected ? selectColor : "var(--text-muted)",
                    fontWeight: isSelected ? 600 : 400,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    width: "100%",
                  }}
                  title={entry.sourceNodeName || (isAudio ? `音频${entry.number}` : `图${entry.number}`)}
                >
                  {entry.sourceNodeName || (isAudio ? `音频${entry.number}` : `图${entry.number}`)}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            padding: "16px",
            textAlign: "center",
            fontSize: "13px",
            color: "var(--text-muted)",
          }}
        >
          {activeTab === "upstream"
            ? "暂无上游参考素材"
            : "素材库为空"}
        </div>
      )}
    </div>
  );
}



