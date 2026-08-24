/**
 * ImageViewerModal — full-screen image viewer with zoom/pan.
 *
 * Features:
 * - Mouse wheel zoom
 * - Drag to pan
 * - Arrow key navigation between images
 * - Zoom percentage display
 * - Reset view button
 * - Escape to close
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { resolveImageDisplayUrl } from "../application/imageData";

interface ImageViewerModalProps {
  /** Image sources to display */
  images: string[];
  /** Initial image index */
  initialIndex?: number;
  /** Close callback */
  onClose: () => void;
}

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_FACTOR = 0.1;

export function ImageViewerModal({
  images,
  initialIndex = 0,
  onClose,
}: ImageViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(
    Math.min(initialIndex, images.length - 1)
  );
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const isPanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const currentImage = images[currentIndex]
    ? resolveImageDisplayUrl(images[currentIndex])
    : "";

  // Reset transform when image changes
  useEffect(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, [currentIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentIndex((prev) => Math.min(images.length - 1, prev + 1));
        return;
      }
      if (e.key === "+" || e.key === "=") {
        setTransform((prev) => ({
          ...prev,
          scale: Math.min(MAX_SCALE, prev.scale * (1 + ZOOM_FACTOR)),
        }));
        return;
      }
      if (e.key === "-") {
        setTransform((prev) => ({
          ...prev,
          scale: Math.max(MIN_SCALE, prev.scale * (1 - ZOOM_FACTOR)),
        }));
        return;
      }
      if (e.key === "0") {
        setTransform({ scale: 1, translateX: 0, translateY: 0 });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, onClose]);

  // Mouse wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_FACTOR : ZOOM_FACTOR;
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, transform.scale * (1 + delta))
      );

      // Zoom toward mouse position
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        const scaleRatio = newScale / transform.scale;
        setTransform({
          scale: newScale,
          translateX: mouseX - scaleRatio * (mouseX - transform.translateX),
          translateY: mouseY - scaleRatio * (mouseY - transform.translateY),
        });
      } else {
        setTransform((prev) => ({ ...prev, scale: newScale }));
      }
    },
    [transform]
  );

  // Pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Left button only
      isPanning.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning.current) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setTransform((prev) => ({
        ...prev,
        translateX: prev.translateX + dx,
        translateY: prev.translateY + dy,
      }));
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleReset = useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[999] bg-black/90 flex flex-col"
      onClick={(e) => {
        // Close on clicking outside the image
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/50 text-white text-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="hover:text-[var(--accent)] transition-colors"
            title="关闭 (Esc)"
          >
            ✕ 关闭
          </button>
          {images.length > 1 && (
            <span className="text-[var(--text-secondary)]">
              {currentIndex + 1} / {images.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[var(--text-secondary)]">
            {Math.round(transform.scale * 100)}%
          </span>
          <button
            onClick={handleReset}
            className="hover:text-[var(--accent)] transition-colors text-xs"
            title="重置 (0)"
          >
            ⟲ 重置
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {currentImage && (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ userSelect: "none" }}
          >
            <img
              src={currentImage}
              alt={`Image ${currentIndex + 1}`}
              className="max-w-none"
              style={{
                transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
                transformOrigin: "center center",
                transition: isPanning.current ? "none" : "transform 0.1s ease-out",
              }}
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white hover:bg-black/70 flex items-center justify-center text-lg transition-colors"
              onClick={() => setCurrentIndex((prev) => prev - 1)}
              title="上一张 (←)"
            >
              ‹
            </button>
          )}
          {currentIndex < images.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white hover:bg-black/70 flex items-center justify-center text-lg transition-colors"
              onClick={() => setCurrentIndex((prev) => prev + 1)}
              title="下一张 (→)"
            >
              ›
            </button>
          )}
        </>
      )}

      {/* Bottom hint */}
      <div className="px-4 py-1.5 bg-black/50 text-[var(--text-secondary)] text-[10px] text-center">
        滚轮缩放 · 拖拽平移 · 方向键切换 · Esc 关闭 · 0 重置
      </div>
    </div>,
    document.body
  );
}



