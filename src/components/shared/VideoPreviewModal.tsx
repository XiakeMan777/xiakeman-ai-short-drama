// ============================================================
// 视频全屏预览弹窗
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Maximize2, Minimize2 } from '@/components/icons';

interface VideoPreviewModalProps {
  videoSrc: string;
  title?: string;
  onClose: () => void;
}

export function VideoPreviewModal({ videoSrc, title, onClose }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 打开时自动播放
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      // Fullscreen API 不可用，忽略
    }
  }, []);

  // 监听全屏变化
  useEffect(() => {
    const handleFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={containerRef} className="relative flex flex-col items-center max-h-[95vh] max-w-[95vw]">
        {/* 顶部标题栏 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 py-3 pointer-events-none">
          <span className="text-white text-sm font-medium truncate">{title}</span>
          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              onClick={toggleFullscreen}
              className="rounded-md bg-white/20 p-1.5 text-white hover:bg-white/30 transition-colors"
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-white/20 p-1.5 text-white hover:bg-white/30 transition-colors"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 视频播放器 */}
        <video
          ref={videoRef}
          src={videoSrc}
          controls
          autoPlay
          className="max-h-[95vh] max-w-[95vw] rounded-lg"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
