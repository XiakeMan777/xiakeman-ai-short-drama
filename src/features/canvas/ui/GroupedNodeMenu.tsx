import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  nodeRegistry,
  NODE_CATEGORIES,
  getRecentNodes,
  addRecentNode,
} from "../domain/nodeRegistry";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";

const MAX_NODES_PER_PROJECT = 300;

interface GroupedNodeMenuProps {
  onAddNode: (registryKey: string) => void;
  /** Extra wrapper style (e.g. position, margin) */
  style?: React.CSSProperties;
  /** Extra class for the outer wrapper */
  className?: string;
}

export function GroupedNodeMenu({ onAddNode, style, className }: GroupedNodeMenuProps) {
  const { t } = useTranslation();
  const nodeCount = useCanvasStore((s) => s.nodes.length);
  const isAtLimit = nodeCount >= MAX_NODES_PER_PROJECT;
  const isNearLimit = nodeCount >= MAX_NODES_PER_PROJECT - 10;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    NODE_CATEGORIES.forEach((cat) => {
      init[cat.id] = cat.defaultCollapsed;
    });
    return init;
  });
  const [recentKeys, setRecentKeys] = useState<string[]>([]);

  useEffect(() => {
    const keys = getRecentNodes().filter((k) => nodeRegistry[k]?.visibleInMenu);
    setRecentKeys(keys);
  }, []);

  const handleAdd = useCallback(
    (key: string) => {
      if (isAtLimit) return;
      addRecentNode(key);
      onAddNode(key);
      // Trigger re-render to update recent list
      const updated = getRecentNodes().filter((k) => nodeRegistry[k]?.visibleInMenu);
      setRecentKeys(updated);
    },
    [onAddNode, isAtLimit]
  );

  const toggleCategory = useCallback((catId: string) => {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }, []);

  // Group visible nodes by category
  const visibleNodes = Object.entries(nodeRegistry).filter(
    ([, def]) => def.visibleInMenu
  );

  const grouped: Record<string, [string, typeof nodeRegistry[string]][]> = {};
  NODE_CATEGORIES.forEach((cat) => {
    grouped[cat.id] = [];
  });
  visibleNodes.forEach(([key, def]) => {
    const cat = def.menuCategory;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push([key, def]);
  });

  return (
    <div
      className={className}
      style={{
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "6px",
        boxShadow: "var(--shadow-panel)",
        animation: "fadeIn 0.12s ease",
        maxHeight: "70vh",
        overflowY: "auto",
        minWidth: "200px",
        ...style,
      }}
    >
      {/* Node limit warning */}
      {(isNearLimit || isAtLimit) && (
        <div
          style={{
            margin: "2px 6px 6px",
            padding: "6px 10px",
            borderRadius: "8px",
            fontSize: "11px",
            fontWeight: 500,
            lineHeight: 1.5,
            backgroundColor: isAtLimit ? "rgba(239, 68, 68, 0.10)" : "rgba(234, 179, 8, 0.10)",
            color: isAtLimit ? "#f87171" : "#fbbf24",
            border: `1px solid ${isAtLimit ? "rgba(239, 68, 68, 0.20)" : "rgba(234, 179, 8, 0.20)"}`,
          }}
        >
          {isAtLimit
            ? `⚠️ 已达节点上限（${nodeCount}/${MAX_NODES_PER_PROJECT}），无法添加更多节点`
            : `⚡ 节点数接近上限（${nodeCount}/${MAX_NODES_PER_PROJECT}）`}
        </div>
      )}
      {/* 最近使用 */}
      {recentKeys.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              padding: "4px 12px 2px",
              fontWeight: 500,
              letterSpacing: "0.5px",
            }}
          >
            最近使用
          </div>
          {recentKeys.map((key) => {
            const def = nodeRegistry[key];
            if (!def) return null;
            return (
              <NodeMenuItem
                key={`recent-${key}`}
                icon={def.menuIcon}
                label={t(def.menuLabelKey)}
                onClick={() => handleAdd(key)}
                disabled={isAtLimit}
              />
            );
          })}
          <div
            style={{
              height: 1,
              backgroundColor: "var(--border)",
              margin: "4px 8px",
            }}
          />
        </div>
      )}

      {/* Category groups */}
      {NODE_CATEGORIES.map((cat) => {
        const items = grouped[cat.id];
        if (!items || items.length === 0) return null;
        const isCollapsed = collapsed[cat.id];

        return (
          <div key={cat.id} style={{ marginBottom: 2 }}>
            <button
              onClick={() => toggleCategory(cat.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "5px 8px",
                fontSize: 11,
                color: "var(--text-muted)",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                borderRadius: 6,
                fontWeight: 600,
                letterSpacing: "0.3px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transition: "transform 0.15s ease",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  flexShrink: 0,
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{cat.icon}</span>
              <span>{cat.id}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.6, marginLeft: "auto" }}>
                {items.length}
              </span>
            </button>
            {!isCollapsed &&
              items.map(([key, def]) => (
                <NodeMenuItem
                  key={key}
                  icon={def.menuIcon}
                  label={t(def.menuLabelKey)}
                  onClick={() => handleAdd(key)}
                  disabled={isAtLimit}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Single menu item row */
function NodeMenuItem({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        padding: "7px 12px",
        fontSize: "13px",
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        borderRadius: "8px",
        backgroundColor: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "26px",
          height: "26px",
          borderRadius: "7px",
          backgroundColor: "var(--bg-secondary)",
          fontSize: "13px",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 500 }}>{label}</span>
    </button>
  );
}



