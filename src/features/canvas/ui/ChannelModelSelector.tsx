/**
 * ChannelModelSelector — reusable 「通道 ▼ | 模型 ▼」component.
 *
 * Shared by TextAnnotationNode, ImageEditNode, VideoNode.
 * Renders a compact provider dropdown + divider + model dropdown,
 * with click-outside-close, API key status dots, and empty-state hints.
 *
 * v7: When only 1 provider is available, show it as a read-only label (no dropdown).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ProviderOption, ModelOption } from "../hooks/useChannelModelSelector";

export interface ChannelModelSelectorProps {
  /** Currently selected provider ID */
  selectedProviderId: string | undefined;
  /** Currently selected model ID */
  selectedModelId: string;
  /** Available providers for this node type */
  availableProviders: ProviderOption[];
  /** Available models for the current provider */
  availableModels: ModelOption[];
  /** Callback when user picks a new provider */
  onProviderChange: (providerId: string) => void;
  /** Callback when user picks a new model */
  onModelChange: (modelId: string) => void;
  /** Notify parent that a menu is open (for overflow-hidden toggle) */
  onMenuOpenChange?: (isOpen: boolean) => void;
}

/** Dropdown menu shared styles (for portal — fixed position relative to viewport) */
const MENU_STYLE = (placement: "top" | "bottom"): React.CSSProperties => ({
  position: "fixed",
  ...(placement === "top"
    ? { bottom: "100%", marginBottom: "4px" }
    : { top: "100%", marginTop: "4px" }),
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  padding: "4px",
  zIndex: 999,
  minWidth: "140px",
});

const MENU_ITEM_STYLE = (isActive: boolean): React.CSSProperties => ({
  display: "flex",
  width: "100%",
  padding: "6px 10px",
  border: "none",
  borderRadius: "4px",
  backgroundColor: isActive ? "var(--bg-hover)" : "transparent",
  color: isActive ? "var(--accent)" : "var(--text-primary)",
  fontSize: "12px",
  cursor: "pointer",
  textAlign: "left",
  alignItems: "center",
  gap: "6px",
});

/** Portal dropdown — renders menu fixed-positioned at trigger rect */
function PortalDropdown({
  show,
  triggerRef,
  placement,
  children,
  onClick,
}: {
  show: boolean;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  placement: "top" | "bottom";
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });

  useEffect(() => {
    if (!show || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = 220; // approximate max height
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const actualPlacement = placement === "top" && spaceAbove < menuHeight && spaceBelow > spaceAbove ? "bottom" : placement;

    if (actualPlacement === "top") {
      setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
    } else {
      setPos({ left: rect.left, top: rect.bottom + 4 });
    }
  }, [show, triggerRef, placement]);

  if (!show) return null;

  return createPortal(
    <div
      className="nodrag"
      data-portal-dropdown="true"
      style={{
        ...MENU_STYLE(placement),
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
      }}
      onClick={onClick}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ChannelModelSelector({
  selectedProviderId,
  selectedModelId,
  availableProviders,
  availableModels,
  onProviderChange,
  onModelChange,
  onMenuOpenChange,
}: ChannelModelSelectorProps) {
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [providerMenuPlacement, setProviderMenuPlacement] = useState<"top" | "bottom">("top");
  const [modelMenuPlacement, setModelMenuPlacement] = useState<"top" | "bottom">("top");
  const containerRef = useRef<HTMLDivElement>(null);
  const providerTriggerRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);

  // Notify parent of menu state for overflow toggle
  useEffect(() => {
    onMenuOpenChange?.(showProviderMenu || showModelMenu);
  }, [showProviderMenu, showModelMenu, onMenuOpenChange]);

  // Click outside to close menus
  // Portal menus render at document.body, so we must also check
  // if the click target is inside any open portal dropdown.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is inside a portal dropdown (rendered at body level), don't close
      if (target.closest?.("[data-portal-dropdown]")) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setShowProviderMenu(false);
        setShowModelMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      onProviderChange(providerId);
      setShowProviderMenu(false);
    },
    [onProviderChange],
  );

  const handleModelSelect = useCallback(
    (modelId: string) => {
      onModelChange(modelId);
      setShowModelMenu(false);
    },
    [onModelChange],
  );

  const computePlacement = useCallback((triggerEl: HTMLElement | null): "top" | "bottom" => {
    if (!triggerEl) return "top";
    const rect = triggerEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Need ~200px for menu; if not enough space above, place below
    return spaceAbove < 200 && spaceBelow > spaceAbove ? "bottom" : "top";
  }, []);

  const openProviderMenu = useCallback(() => {
    const next = !showProviderMenu;
    if (next) {
      setProviderMenuPlacement(computePlacement(providerTriggerRef.current));
    }
    setShowProviderMenu(next);
    setShowModelMenu(false);
  }, [showProviderMenu, computePlacement]);

  const openModelMenu = useCallback(() => {
    const next = !showModelMenu;
    if (next) {
      setModelMenuPlacement(computePlacement(modelTriggerRef.current));
    }
    setShowModelMenu(next);
    setShowProviderMenu(false);
  }, [showModelMenu, computePlacement]);

  // Display names
  const currentProviderName =
    availableProviders.find((p) => p.id === selectedProviderId)?.name || "通道";
  const currentModelLabel =
    availableModels.find((m) => m.id === selectedModelId)?.label
    || (availableModels.length === 0 ? "请先选择通道" : selectedModelId);

  const anyMenuOpen = showProviderMenu || showModelMenu;

  useEffect(() => {
    if (availableProviders.length === 0) return;
    if (selectedProviderId && availableProviders.some((p) => p.id === selectedProviderId)) return;
    onProviderChange(availableProviders[0].id);
  }, [availableProviders, selectedProviderId, onProviderChange]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center gap-1${anyMenuOpen ? "" : ""}`}
      style={{ position: "relative" }}
    >
      {/* ── Provider selector ── */}
      <div ref={providerTriggerRef} className="flex items-center gap-1 relative nodrag">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span
          onClick={openProviderMenu}
          title={currentProviderName}
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            fontWeight: 500,
            cursor: "pointer",
            maxWidth: "28px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentProviderName}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ cursor: "pointer", flexShrink: 0 }}
          onClick={openProviderMenu}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>

        <PortalDropdown
          show={showProviderMenu}
          triggerRef={providerTriggerRef}
          placement={providerMenuPlacement}
          onClick={(e) => e.stopPropagation()}
        >
          {availableProviders.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderSelect(p.id)}
              style={MENU_ITEM_STYLE(selectedProviderId === p.id)}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: p.hasApiKey ? "#22c55e" : "var(--text-muted)",
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
              {!p.hasApiKey && (
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>
                  未配置
                </span>
              )}
            </button>
          ))}
          {availableProviders.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
              请先在设置中启用通道
            </div>
          )}
        </PortalDropdown>
      </div>

      {/* ── Divider ── */}
      <span style={{ color: "var(--border)", fontSize: "12px" }}>|</span>

      {/* ── Model selector ── */}
      <div ref={modelTriggerRef} className="flex items-center gap-1 relative nodrag">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span
          onClick={openModelMenu}
          title={currentModelLabel}
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            fontWeight: 500,
            cursor: "pointer",
            maxWidth: "56px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentModelLabel}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ cursor: "pointer", flexShrink: 0 }}
          onClick={openModelMenu}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>

        <PortalDropdown
          show={showModelMenu}
          triggerRef={modelTriggerRef}
          placement={modelMenuPlacement}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ maxHeight: "240px", overflowY: "auto" }}>
            {availableModels.map((m) => (
              <button
                key={m.id}
                onClick={() => handleModelSelect(m.id)}
                style={{
                  ...MENU_ITEM_STYLE(selectedModelId === m.id),
                  display: "block",
                  minWidth: "160px",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.label}
                </span>
              </button>
            ))}
            {availableModels.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
                请先选择通道
              </div>
            )}
          </div>
        </PortalDropdown>
      </div>
    </div>
  );
}



