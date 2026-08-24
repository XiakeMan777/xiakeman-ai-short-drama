import { useMemo, useCallback, useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import type { VideoCompositionNodeData, VideoClipEdit } from "../domain/canvasNodes";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { useConfirm } from "@/features/canvas/compat/ConfirmDialog";
import { resolveImageDisplayUrl } from "../application/imageData";
import { useUpstreamNodes } from "../hooks/useUpstreamNodes";
import {
  composeVideosSequential,
  extractAudioFromVideo,
  getVideoDuration,
  persistVideoSource,
} from "@/features/canvas/compat/commands";
import { open as dialogOpen } from "@/features/canvas/compat/dialog";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimePrecise(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function defaultClipEdit(duration: number = 0): VideoClipEdit {
  return {
    trimStart: 0,
    trimEnd: duration || 9999,
    speed: 1,
    audioMuted: false,
    extractedAudioPath: null,
    volume: 100,
    splitPoints: [],
  };
}

// A "clip segment" — after splitting, one source video becomes multiple segments
interface ClipSegment {
  id: string;
  sourcePath: string;
  sourceLabel: string;
  sourceDuration: number; // original video duration
  trimStart: number;
  trimEnd: number;
  speed: number;
  audioMuted: boolean;
  volume: number;
  extractedAudioPath: string | null;
}

function editToSegment(clip: { path: string; label: string; duration: number }, edit: VideoClipEdit, id: string): ClipSegment {
  return {
    id,
    sourcePath: clip.path,
    sourceLabel: clip.label,
    sourceDuration: clip.duration,
    trimStart: edit.trimStart,
    trimEnd: edit.trimEnd || clip.duration,
    speed: edit.speed,
    audioMuted: edit.audioMuted,
    volume: edit.volume,
    extractedAudioPath: edit.extractedAudioPath,
  };
}

function segmentToEdit(seg: ClipSegment): VideoClipEdit {
  return {
    trimStart: seg.trimStart,
    trimEnd: seg.trimEnd,
    speed: seg.speed,
    audioMuted: seg.audioMuted,
    volume: seg.volume,
    extractedAudioPath: seg.extractedAudioPath,
    splitPoints: [],
  };
}

// ---------------------------------------------------------------------------
// Inline SVG Icon helpers
// ---------------------------------------------------------------------------

function IconPlay({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="8 5 20 12 8 19 8 5" /></svg>;
}
function IconPause({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>;
}
function IconSplit({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22" /><polyline points="8 6 4 6 4 10" /><polyline points="16 6 20 6 20 10" /><polyline points="8 18 4 18 4 14" /><polyline points="16 18 20 18 20 14" /></svg>;
}
function IconTrash({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function IconVolume({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>;
}
function IconVolumeX({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>;
}
function IconMusic({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
}
function IconZoomIn({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>;
}
function IconZoomOut({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>;
}
function IconExpand({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>;
}
function IconBack({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>;
}
function IconUpload({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
}

// ---------------------------------------------------------------------------
// JianYing-style Fullscreen Video Editor
// ---------------------------------------------------------------------------

interface VideoEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: ClipSegment[];
  onSegmentsChange: (segments: ClipSegment[]) => void;
  onCompose: () => void;
  isComposing: boolean;
  onAddLocalVideo: () => void;
}

function VideoEditorModal({
  isOpen,
  onClose,
  segments,
  onSegmentsChange,
  onCompose,
  isComposing,
  onAddLocalVideo,
}: VideoEditorModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const showConfirm = useConfirm();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentGlobalTime, setCurrentGlobalTime] = useState(0); // time in the global timeline
  const [selectedSegIdx, setSelectedSegIdx] = useState(-1);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isDraggingTrim, setIsDraggingTrim] = useState<"left" | "right" | null>(null);
  const [dragSegIdx, setDragSegIdx] = useState(-1);

  // Local state for property panel (commit on pointer up)
  const [localSpeed, setLocalSpeed] = useState(1);
  const [localVolume, setLocalVolume] = useState(100);
  const [localTrimStart, setLocalTrimStart] = useState(0);
  const [localTrimEnd, setLocalTrimEnd] = useState(0);
  const [isExtractingAudio, setIsExtractingAudio] = useState(false);

  // Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Duration cache for source videos
  const [durationCache, setDurationCache] = useState<Record<string, number>>({});

  const selectedSeg = selectedSegIdx >= 0 ? segments[selectedSegIdx] : null;

  // Sync local state when selected segment changes
  useEffect(() => {
    if (!selectedSeg) return;
    setLocalSpeed(selectedSeg.speed);
    setLocalVolume(selectedSeg.volume);
    setLocalTrimStart(selectedSeg.trimStart);
    setLocalTrimEnd(selectedSeg.trimEnd);
  }, [selectedSegIdx, selectedSeg?.id]);

  // Load durations for all source videos
  useEffect(() => {
    const uniquePaths = new Set<string>();
    for (const seg of segments) {
      if (durationCache[seg.sourcePath] === undefined) {
        uniquePaths.add(seg.sourcePath);
      }
    }
    for (const path of uniquePaths) {
      getVideoDuration(path)
        .then((d) => setDurationCache((prev) => ({ ...prev, [path]: d })))
        .catch(() => setDurationCache((prev) => ({ ...prev, [path]: 0 })));
    }
  }, [segments]);

  // Update segment durations when loaded
  useEffect(() => {
    const updated = segments.map((seg) => {
      const loadedDur = durationCache[seg.sourcePath];
      if (loadedDur && loadedDur > 0 && seg.sourceDuration === 0) {
        return { ...seg, sourceDuration: loadedDur, trimEnd: seg.trimEnd === 9999 ? loadedDur : seg.trimEnd };
      }
      if (loadedDur && loadedDur > 0 && seg.trimEnd === 9999) {
        return { ...seg, trimEnd: loadedDur };
      }
      return seg;
    });
    const changed = updated.some((s, i) => s !== segments[i]);
    if (changed) onSegmentsChange(updated);
  }, [durationCache]);

  // --- Timeline layout ---
  const ZOOM_BASE = 50;
  const pxPerSec = ZOOM_BASE * timelineZoom;

  // Each segment's effective duration and position on timeline
  const segLayouts = useMemo(() => {
    const layouts: { x: number; width: number; seg: ClipSegment }[] = [];
    let x = 40; // offset for track label
    for (const seg of segments) {
      const effectiveDur = (seg.trimEnd - seg.trimStart) / seg.speed;
      const width = Math.max(effectiveDur * pxPerSec, 20); // min 20px
      layouts.push({ x, width, seg });
      x += width + 2; // 2px gap between segments
    }
    return layouts;
  }, [segments, pxPerSec]);

  const totalTimelineWidth = useMemo(() => {
    if (segLayouts.length === 0) return 600;
    const last = segLayouts[segLayouts.length - 1];
    return Math.max(last.x + last.width + 40, 600);
  }, [segLayouts]);

  const totalDuration = useMemo(() => {
    let total = 0;
    for (const seg of segments) {
      const effectiveDur = (seg.trimEnd - seg.trimStart) / seg.speed;
      total += effectiveDur;
    }
    return total || 1;
  }, [segments]);

  // Playhead X position based on global time
  const playheadX = useMemo(() => {
    let accumulated = 0;
    for (const layout of segLayouts) {
      const segDur = (layout.seg.trimEnd - layout.seg.trimStart) / layout.seg.speed;
      if (currentGlobalTime >= accumulated && currentGlobalTime < accumulated + segDur) {
        return layout.x + (currentGlobalTime - accumulated) * pxPerSec;
      }
      accumulated += segDur;
    }
    // Past all segments
    if (segLayouts.length > 0) {
      const last = segLayouts[segLayouts.length - 1];
      return last.x + last.width;
    }
    return 40;
  }, [currentGlobalTime, segLayouts, pxPerSec]);

  // Which segment is the playhead on?
  const playheadSegIdx = useMemo(() => {
    let accumulated = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDur = (seg.trimEnd - seg.trimStart) / seg.speed;
      if (currentGlobalTime >= accumulated && currentGlobalTime < accumulated + segDur) {
        return i;
      }
      accumulated += segDur;
    }
    return -1;
  }, [currentGlobalTime, segments]);

  // --- Video playback ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSeg) return;

    video.src = resolveImageDisplayUrl(selectedSeg.sourcePath);
    video.playbackRate = selectedSeg.speed;
    video.muted = selectedSeg.audioMuted;

    // Seek to the right position based on global time
    let accumulated = 0;
    for (let i = 0; i <= selectedSegIdx; i++) {
      const seg = segments[i];
      const segDur = (seg.trimEnd - seg.trimStart) / seg.speed;
      if (i === selectedSegIdx) {
        const timeInSeg = currentGlobalTime - accumulated;
        video.currentTime = seg.trimStart + timeInSeg * seg.speed;
      }
      accumulated += segDur;
    }
  }, [selectedSegIdx, selectedSeg?.id]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSeg) return;
    const onTimeUpdate = () => {
      const videoTime = video.currentTime;
      // Map video time back to global time
      const seg = selectedSeg;
      const timeInSeg = (videoTime - seg.trimStart) / seg.speed;
      let accumulated = 0;
      for (let i = 0; i < selectedSegIdx; i++) {
        const s = segments[i];
        accumulated += (s.trimEnd - s.trimStart) / s.speed;
      }
      setCurrentGlobalTime(accumulated + timeInSeg);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      // Move to next segment or stop
      if (selectedSegIdx < segments.length - 1) {
        setSelectedSegIdx(selectedSegIdx + 1);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [selectedSegIdx, selectedSeg?.id, segments]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  // --- Commit local edits ---
  const commitEdits = useCallback(() => {
    if (selectedSegIdx < 0) return;
    const updated = [...segments];
    updated[selectedSegIdx] = {
      ...updated[selectedSegIdx],
      trimStart: localTrimStart,
      trimEnd: localTrimEnd,
      speed: localSpeed,
      volume: localVolume,
    };
    onSegmentsChange(updated);
  }, [segments, selectedSegIdx, localTrimStart, localTrimEnd, localSpeed, localVolume, onSegmentsChange]);

  // --- Split at playhead ---
  const handleSplit = useCallback(() => {
    if (playheadSegIdx < 0) {
      addToast("warning", "播放头不在任何片段上");
      return;
    }
    const seg = segments[playheadSegIdx];
    // Calculate the video time at the playhead position
    let accumulated = 0;
    for (let i = 0; i < playheadSegIdx; i++) {
      const s = segments[i];
      accumulated += (s.trimEnd - s.trimStart) / s.speed;
    }
    const timeInSeg = currentGlobalTime - accumulated;
    const splitVideoTime = seg.trimStart + timeInSeg * seg.speed;

    // Don't split at the edges
    if (splitVideoTime <= seg.trimStart + 0.1 || splitVideoTime >= seg.trimEnd - 0.1) {
      addToast("warning", "分割位置太靠近边缘");
      return;
    }

    // Create two new segments
    const left: ClipSegment = {
      ...seg,
      id: `${seg.id}-L`,
      trimEnd: splitVideoTime,
    };
    const right: ClipSegment = {
      ...seg,
      id: `${seg.id}-R`,
      trimStart: splitVideoTime,
    };

    const updated = [...segments];
    updated.splice(playheadSegIdx, 1, left, right);
    onSegmentsChange(updated);
    setSelectedSegIdx(playheadSegIdx); // select left part
    addToast("success", `已在 ${formatTimePrecise(splitVideoTime)} 处分割`);
  }, [playheadSegIdx, currentGlobalTime, segments, onSegmentsChange, addToast]);

  // --- Delete selected segment ---
  const handleDeleteSegment = useCallback(() => {
    if (selectedSegIdx < 0) return;
    showConfirm({
      title: "删除片段",
      message: "确定删除此片段吗？",
      variant: "danger",
      confirmLabel: "删除",
      onConfirm: () => {
        const updated = [...segments];
        updated.splice(selectedSegIdx, 1);
        onSegmentsChange(updated);
        setSelectedSegIdx(Math.min(selectedSegIdx, updated.length - 1));
        addToast("success", "已删除片段");
      },
    });
  }, [selectedSegIdx, segments, onSegmentsChange, addToast, showConfirm]);

  // --- Keyboard shortcut: Delete/Backspace to delete selected segment ---
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if user is typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        handleDeleteSegment();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleDeleteSegment]);

  // --- Audio extraction ---
  const handleExtractAudio = useCallback(async () => {
    if (selectedSegIdx < 0) return;
    setIsExtractingAudio(true);
    try {
      addToast("info", "正在分离音频...");
      const audioPath = await extractAudioFromVideo(selectedSeg!.sourcePath);
      const updated = [...segments];
      updated[selectedSegIdx] = { ...updated[selectedSegIdx], extractedAudioPath: audioPath };
      onSegmentsChange(updated);
      addToast("success", "音频分离完成");
    } catch (err) {
      addToast("error", `音频分离失败: ${err}`);
    } finally {
      setIsExtractingAudio(false);
    }
  }, [selectedSegIdx, selectedSeg, segments, onSegmentsChange, addToast]);

  // --- Mute toggle ---
  const handleToggleMute = useCallback(() => {
    if (selectedSegIdx < 0) return;
    const updated = [...segments];
    updated[selectedSegIdx] = { ...updated[selectedSegIdx], audioMuted: !updated[selectedSegIdx].audioMuted };
    onSegmentsChange(updated);
  }, [selectedSegIdx, segments, onSegmentsChange]);

  // --- Speed presets ---
  const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  // --- Timeline mouse handlers ---
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;

    // Check if clicking on a segment
    for (let i = 0; i < segLayouts.length; i++) {
      const layout = segLayouts[i];
      if (x >= layout.x && x <= layout.x + layout.width) {
        const relX = x - layout.x;

        // Check if near trim edges (within 8px)
        if (relX < 8) {
          setIsDraggingTrim("left");
          setDragSegIdx(i);
          setSelectedSegIdx(i);
          return;
        }
        if (layout.width - relX < 8) {
          setIsDraggingTrim("right");
          setDragSegIdx(i);
          setSelectedSegIdx(i);
          return;
        }

        // Clicked on segment body — select and seek
        setSelectedSegIdx(i);
        const seg = segments[i];
        const timeInSeg = (relX / layout.width) * (seg.trimEnd - seg.trimStart) / seg.speed;
        let accumulated = 0;
        for (let j = 0; j < i; j++) {
          accumulated += (segments[j].trimEnd - segments[j].trimStart) / segments[j].speed;
        }
        const newGlobalTime = accumulated + timeInSeg;
        setCurrentGlobalTime(newGlobalTime);

        // Seek video
        const video = videoRef.current;
        if (video && i === selectedSegIdx) {
          video.currentTime = seg.trimStart + timeInSeg * seg.speed;
        }
        return;
      }
    }

    // Clicked on empty area — move playhead to nearest position
    if (segLayouts.length > 0) {
      let accumulated = 0;
      for (let i = 0; i < segLayouts.length; i++) {
        const layout = segLayouts[i];
        const seg = segments[i];
        const segDur = (seg.trimEnd - seg.trimStart) / seg.speed;
        const segEndX = layout.x + layout.width;

        if (x >= layout.x && x <= segEndX) {
          // Within this segment
          const relX = x - layout.x;
          const timeInSeg = (relX / layout.width) * segDur;
          setCurrentGlobalTime(accumulated + timeInSeg);
          setSelectedSegIdx(i);
          return;
        }
        if (x < layout.x && i === 0) {
          // Before first segment
          setCurrentGlobalTime(0);
          setSelectedSegIdx(0);
          return;
        }
        if (x > segEndX && i === segLayouts.length - 1) {
          // After last segment
          setCurrentGlobalTime(accumulated + segDur);
          setSelectedSegIdx(i);
          return;
        }
        accumulated += segDur;
      }
    }
  }, [segLayouts, segments, selectedSegIdx]);

  // Global mouse move/up for dragging
  useEffect(() => {
    if (!isDraggingPlayhead && !isDraggingTrim) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineRef.current.scrollLeft;

      if (isDraggingPlayhead) {
        // Find which segment the x falls on
        for (let i = 0; i < segLayouts.length; i++) {
          const layout = segLayouts[i];
          if (x >= layout.x && x <= layout.x + layout.width) {
            const relX = x - layout.x;
            const seg = segments[i];
            const timeInSeg = (relX / layout.width) * (seg.trimEnd - seg.trimStart) / seg.speed;
            let accumulated = 0;
            for (let j = 0; j < i; j++) {
              accumulated += (segments[j].trimEnd - segments[j].trimStart) / segments[j].speed;
            }
            setCurrentGlobalTime(accumulated + timeInSeg);
            setSelectedSegIdx(i);
            const video = videoRef.current;
            if (video) {
              video.currentTime = seg.trimStart + timeInSeg * seg.speed;
            }
            break;
          }
        }
      }

      if (isDraggingTrim && dragSegIdx >= 0) {
        const layout = segLayouts[dragSegIdx];
        const seg = segments[dragSegIdx];
        const relX = x - layout.x;
        // Map x to video time
        const videoTime = seg.trimStart + (relX / layout.width) * (seg.trimEnd - seg.trimStart);

        if (isDraggingTrim === "left") {
          const newTrimStart = Math.max(0, Math.min(videoTime, seg.trimEnd - 0.1));
          setLocalTrimStart(newTrimStart);
        } else {
          const srcDur = durationCache[seg.sourcePath] || seg.sourceDuration;
          const newTrimEnd = Math.max(seg.trimStart + 0.1, Math.min(videoTime, srcDur));
          setLocalTrimEnd(newTrimEnd);
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingTrim && dragSegIdx >= 0) {
        const updated = [...segments];
        updated[dragSegIdx] = {
          ...updated[dragSegIdx],
          trimStart: localTrimStart,
          trimEnd: localTrimEnd,
        };
        onSegmentsChange(updated);
      }
      setIsDraggingPlayhead(false);
      setIsDraggingTrim(null);
      setDragSegIdx(-1);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingPlayhead, isDraggingTrim, dragSegIdx, segLayouts, segments, localTrimStart, localTrimEnd, durationCache, onSegmentsChange]);

  // --- Timeline ruler marks ---
  const rulerMarks = useMemo(() => {
    const marks: { x: number; label: string; major: boolean }[] = [];
    let interval = 1;
    if (pxPerSec < 20) interval = 10;
    else if (pxPerSec < 40) interval = 5;
    else if (pxPerSec < 80) interval = 2;
    for (let t = 0; t <= totalDuration; t += interval) {
      marks.push({ x: 40 + t * pxPerSec, label: formatTime(t), major: t % (interval * 5) === 0 || interval >= 5 });
    }
    return marks;
  }, [pxPerSec, totalDuration]);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
        backgroundColor: "var(--bg-node)", zIndex: 999,
        display: "flex", flexDirection: "column",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* ======== Top Bar ======== */}
      <div style={{ height: "48px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-node)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px" }}>
            <IconBack size={14} /> 返回
          </button>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>视频编辑器</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{segments.length} 个片段</span>
        </div>
        <button onClick={onCompose} disabled={isComposing} style={{ padding: "7px 20px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "none", backgroundColor: isComposing ? "var(--border-hover)" : "var(--accent)", color: isComposing ? "var(--text-muted)" : "var(--text-primary)", cursor: isComposing ? "not-allowed" : "pointer" }}>
          {isComposing ? "合成中..." : "导出视频"}
        </button>
      </div>

      {/* ======== Main Content ======== */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ======== Center: Preview ======== */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: "var(--bg-node)", minWidth: 0 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#000", position: "relative" }}>
            {selectedSeg ? (
              <video ref={videoRef} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} muted={selectedSeg.audioMuted} />
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>选择片段预览</span>
            )}
            {selectedSeg && !isPlaying && (
              <button onClick={togglePlay} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "56px", height: "56px", borderRadius: "50%", backgroundColor: "var(--accent-dim)", backdropFilter: "blur(8px)", border: "1px solid var(--border-glow)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-primary)" }}>
                <IconPlay size={22} />
              </button>
            )}
          </div>
          {/* Playback Controls */}
          <div style={{ height: "44px", display: "flex", alignItems: "center", gap: "10px", padding: "0 16px", backgroundColor: "var(--bg-node)", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            <button onClick={togglePlay} disabled={!selectedSeg} style={{ width: "32px", height: "32px", borderRadius: "50%", border: "none", backgroundColor: selectedSeg ? "var(--accent)" : "var(--bg-node)", color: "var(--text-primary)", cursor: selectedSeg ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {isPlaying ? <IconPause size={12} /> : <IconPlay size={12} />}
            </button>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace", minWidth: "120px" }}>
              {formatTimePrecise(currentGlobalTime)} / {formatTime(totalDuration)}
            </span>
            <div style={{ flex: 1 }} />
          </div>
        </div>

        {/* ======== Right: Properties Panel ======== */}
        <div style={{ width: "280px", backgroundColor: "var(--bg-node)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={selectedSeg?.sourceLabel || "属性"}>
              {selectedSeg ? selectedSeg.sourceLabel : "属性"}
            </span>
            {selectedSeg && (
              <button onClick={handleDeleteSegment} title="删除此片段" style={{ width: "28px", height: "28px", borderRadius: "4px", border: "1px solid color-mix(in srgb, var(--error) 40%, transparent)", backgroundColor: "var(--bg-surface)", color: "var(--error)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <IconTrash size={13} />
              </button>
            )}
          </div>

          {/* Segment list */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", maxHeight: "120px", overflowY: "auto" }}>
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {segments.map((seg, idx) => (
                <button
                  key={seg.id}
                  onClick={() => setSelectedSegIdx(idx)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    border: idx === selectedSegIdx ? "1px solid var(--accent)" : "1px solid var(--border-hover)",
                    backgroundColor: idx === selectedSegIdx ? "var(--accent-dim)" : "var(--bg-surface)",
                    color: idx === selectedSegIdx ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                    maxWidth: "80px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={seg.sourceLabel}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Properties */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {!selectedSeg ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: "13px" }}>选择片段进行编辑</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* 变速 */}
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>变速</div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "8px" }}>
                    {SPEED_PRESETS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setLocalSpeed(s);
                          const updated = [...segments];
                          updated[selectedSegIdx] = { ...updated[selectedSegIdx], speed: s };
                          onSegmentsChange(updated);
                        }}
                        style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "11px", border: localSpeed === s ? "1px solid var(--accent)" : "1px solid var(--border-hover)", backgroundColor: localSpeed === s ? "var(--accent-dim)" : "var(--bg-node)", color: localSpeed === s ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", minWidth: "38px" }}
                      >{s}x</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="range" min={0.25} max={4} step={0.05} value={localSpeed} onChange={(e) => setLocalSpeed(parseFloat(e.target.value))} onPointerUp={commitEdits} style={{ flex: 1, accentColor: "var(--accent)", height: "4px" }} />
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "monospace", width: "40px", textAlign: "right" }}>{localSpeed.toFixed(2)}x</span>
                  </div>
                </div>

                {/* 音频 */}
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>音频</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <button onClick={handleToggleMute} style={{ width: "28px", height: "28px", borderRadius: "4px", border: "1px solid var(--border-hover)", backgroundColor: selectedSeg.audioMuted ? "var(--accent-dim)" : "var(--bg-node)", color: selectedSeg.audioMuted ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {selectedSeg.audioMuted ? <IconVolumeX size={12} /> : <IconVolume size={12} />}
                    </button>
                    <input type="range" min={0} max={100} step={1} value={selectedSeg.audioMuted ? 0 : localVolume} onChange={(e) => setLocalVolume(parseInt(e.target.value))} onPointerUp={commitEdits} disabled={selectedSeg.audioMuted} style={{ flex: 1, accentColor: "var(--accent)", height: "4px", opacity: selectedSeg.audioMuted ? 0.3 : 1 }} />
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "monospace", width: "32px", textAlign: "right" }}>{selectedSeg.audioMuted ? "0" : localVolume}%</span>
                  </div>
                  <button onClick={handleExtractAudio} disabled={isExtractingAudio} style={{ width: "100%", padding: "7px 0", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: isExtractingAudio ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", opacity: isExtractingAudio ? 0.5 : 1, transition: "opacity 0.2s" }}>
                    <IconMusic size={13} /> {isExtractingAudio ? "分离中..." : "分离音频"}
                  </button>
                  {selectedSeg.extractedAudioPath && <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--accent)" }}>音频已分离保存</div>}
                </div>

                {/* 裁剪 */}
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>裁剪</div>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" }}>开始</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>{formatTimePrecise(localTrimStart)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" }}>结束</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>{formatTimePrecise(localTrimEnd)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>在时间轴上拖拽片段边缘调整裁剪范围</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ======== Bottom: Timeline ======== */}
      <div style={{ height: "180px", backgroundColor: "var(--bg-node)", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Toolbar */}
        <div style={{ height: "36px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-node)" }}>
          <button onClick={handleSplit} disabled={playheadSegIdx < 0} title="在播放头位置分割" style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: playheadSegIdx >= 0 ? "var(--text-secondary)" : "var(--text-muted)", cursor: playheadSegIdx >= 0 ? "pointer" : "not-allowed" }}>
            <IconSplit size={12} /> 分割
          </button>
          <button onClick={handleDeleteSegment} disabled={selectedSegIdx < 0} title="删除选中片段" style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: selectedSegIdx >= 0 ? "var(--error)" : "var(--text-muted)", cursor: selectedSegIdx >= 0 ? "pointer" : "not-allowed" }}>
            <IconTrash size={12} /> 删除
          </button>
          <button onClick={onAddLocalVideo} title="导入本地视频" style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer" }}>
            <IconUpload size={12} /> 导入
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setTimelineZoom((z) => Math.max(0.25, z - 0.25))} style={{ width: "28px", height: "28px", borderRadius: "4px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="缩小"><IconZoomOut size={12} /></button>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", minWidth: "30px", textAlign: "center" }}>{Math.round(timelineZoom * 100)}%</span>
          <button onClick={() => setTimelineZoom((z) => Math.min(4, z + 0.25))} style={{ width: "28px", height: "28px", borderRadius: "4px", border: "1px solid var(--border-hover)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="放大"><IconZoomIn size={12} /></button>
        </div>

        {/* Timeline scrollable area */}
        <div
          ref={timelineRef}
          onMouseDown={(e) => {
            // Always allow dragging playhead from anywhere in timeline
            setIsDraggingPlayhead(true);
            handleTimelineMouseDown(e);
          }}
          style={{ flex: 1, overflowX: "auto", overflowY: "hidden", position: "relative", cursor: isDraggingTrim ? "col-resize" : isDraggingPlayhead ? "col-resize" : "default" }}
        >
          <div data-timeline-area style={{ width: totalTimelineWidth, height: "100%", position: "relative" }}>
            {/* Time ruler */}
            <div style={{ height: "24px", position: "relative", borderBottom: "1px solid var(--border)" }}>
              {rulerMarks.map((mark, idx) => (
                <div key={idx} style={{ position: "absolute", left: mark.x, top: 0, height: "100%", borderLeft: mark.major ? "1px solid #333" : "1px solid #222" }}>
                  {mark.major && <span style={{ fontSize: "9px", color: "var(--text-muted)", paddingLeft: "4px", position: "relative", top: "2px" }}>{mark.label}</span>}
                </div>
              ))}
            </div>

            {/* Video track */}
            <div style={{ position: "relative", height: "52px" }}>
              <div style={{ position: "absolute", left: 0, top: 2, bottom: 2, width: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>视频</span>
              </div>
              {segLayouts.map((layout, idx) => {
                const seg = layout.seg;
                const isSelected = idx === selectedSegIdx;
                const srcDur = durationCache[seg.sourcePath] || seg.sourceDuration || 1;
                const trimLeftPct = (seg.trimStart / srcDur) * 100;
                const trimRightPct = (seg.trimEnd / srcDur) * 100;

                return (
                  <div
                    key={seg.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSegIdx(idx);
                    }}
                    style={{
                      position: "absolute",
                      left: layout.x,
                      top: "4px",
                      width: layout.width,
                      height: "44px",
                      borderRadius: "4px",
                      overflow: "hidden",
                      border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border-hover)",
                      backgroundColor: isSelected ? "var(--accent-dim)" : "var(--bg-surface)",
                      cursor: "pointer",
                      transition: "border-color 0.1s",
                    }}
                  >
                    {/* Video thumbnail strip - simulate with gradient + pattern */}
                    <div style={{
                      position: "absolute",
                      top: 0, left: 0, right: 0, bottom: 0,
                      background: `linear-gradient(90deg, 
                        #1a3a4a 0%, #2a4a5a 8%, #1a3a4a 16%,
                        #1a3a4a 20%, #2a5a6a 28%, #1a3a4a 36%,
                        #1a3a4a 40%, #2a4a5a 48%, #1a3a4a 56%,
                        #1a3a4a 60%, #2a5a6a 68%, #1a3a4a 76%,
                        #1a3a4a 80%, #2a4a5a 88%, #1a3a4a 96%)`,
                      opacity: 0.6,
                      zIndex: 0,
                    }} />
                    {/* Clip label */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "2px 6px", fontSize: "10px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", zIndex: 2, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
                      {seg.sourceLabel}
                    </div>
                    {/* Speed indicator */}
                    {seg.speed !== 1 && (
                      <div style={{ position: "absolute", bottom: "2px", right: "4px", fontSize: "9px", color: "var(--text-primary)", zIndex: 2, backgroundColor: "var(--glass-bg)", padding: "0 3px", borderRadius: "2px" }}>{seg.speed}x</div>
                    )}
                    {/* Duration label */}
                    <div style={{ position: "absolute", bottom: "2px", left: "4px", fontSize: "8px", color: "var(--text-secondary)", zIndex: 2 }}>
                      {formatTime((seg.trimEnd - seg.trimStart) / seg.speed)}
                    </div>
                    {/* Trimmed-out area (left) */}
                    {seg.trimStart > 0 && (
                      <div style={{ position: "absolute", top: 0, left: 0, width: `${trimLeftPct}%`, height: "100%", backgroundColor: "var(--glass-bg)", zIndex: 1 }} />
                    )}
                    {/* Trimmed-out area (right) */}
                    {seg.trimEnd < srcDur && (
                      <div style={{ position: "absolute", top: 0, right: 0, width: `${100 - trimRightPct}%`, height: "100%", backgroundColor: "var(--glass-bg)", zIndex: 1 }} />
                    )}
                    {/* Left trim drag handle */}
                    <div
                      style={{ position: "absolute", top: 0, left: 0, width: "8px", height: "100%", cursor: "col-resize", backgroundColor: "transparent", zIndex: 5 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--accent-muted)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                      onMouseDown={(e) => { e.stopPropagation(); setIsDraggingTrim("left"); setDragSegIdx(idx); setSelectedSegIdx(idx); }}
                    />
                    {/* Right trim drag handle */}
                    <div
                      style={{ position: "absolute", top: 0, right: 0, width: "8px", height: "100%", cursor: "col-resize", backgroundColor: "transparent", zIndex: 5 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--accent-muted)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                      onMouseDown={(e) => { e.stopPropagation(); setIsDraggingTrim("right"); setDragSegIdx(idx); setSelectedSegIdx(idx); }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Audio track */}
            <div style={{ position: "relative", height: "38px", borderTop: "1px solid var(--border)" }}>
              <div style={{ position: "absolute", left: 0, top: 2, bottom: 2, width: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>音频</span>
              </div>
              {segLayouts.map((layout, idx) => {
                const seg = layout.seg;
                const isSelected = idx === selectedSegIdx;
                return (
                  <div
                    key={`audio-${seg.id}`}
                    style={{
                      position: "absolute", left: layout.x, top: "3px",
                      width: layout.width, height: "32px", borderRadius: "3px",
                      border: isSelected ? "1px solid var(--accent-muted)" : "1px solid var(--border)",
                      backgroundColor: seg.audioMuted ? "var(--bg-surface)" : "#1a2028",
                      opacity: seg.audioMuted ? 0.3 : 0.7,
                      overflow: "hidden",
                    }}
                  >
                    {/* Audio waveform pattern */}
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                      background: `repeating-linear-gradient(90deg, transparent, transparent 2px, var(--accent-dim) 2px, var(--accent-dim) 4px)`,
                    }} />
                    {seg.extractedAudioPath && <div style={{ position: "absolute", top: "2px", right: "4px", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent)" }} />}
                  </div>
                );
              })}
            </div>

            {/* Playhead - clickable/draggable */}
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsDraggingPlayhead(true);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: playheadX - 8,
                width: "16px",
                height: "100%",
                cursor: "col-resize",
                zIndex: 20,
              }}
            >
              <div style={{ position: "absolute", top: "24px", left: "7px", width: "2px", height: "calc(100% - 24px)", backgroundColor: "var(--error)" }} />
              <div style={{ position: "absolute", top: "18px", left: "3px", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid var(--error)" }} />
              {/* Time tooltip */}
              <div style={{ position: "absolute", top: "2px", left: "50%", transform: "translateX(-50%)", backgroundColor: "var(--error)", color: "var(--text-primary)", fontSize: "9px", padding: "1px 4px", borderRadius: "2px", whiteSpace: "nowrap" }}>
                {formatTimePrecise(currentGlobalTime)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Main Node Component
// ---------------------------------------------------------------------------

export const VideoCompositionNode = memo(function VideoCompositionNode({ data, id, selected }: NodeProps & { data: VideoCompositionNodeData }) {
  const nodeData = data;
  const { incomingEdges, upstreamNodes } = useUpstreamNodes(id);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addToast = useToastStore((s) => s.addToast);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeClipIndex, setActiveClipIndex] = useState(0);

  const isEditorOpen = nodeData.isEditorOpen || false;
  const clipEdits = nodeData.clipEdits || [];
  const localVideoPaths = nodeData.videoPaths || [];

  /** Collect upstream video paths from connected nodes */
  const upstreamVideos = useMemo(() => {
    const videoEntries: { path: string; label: string; x: number }[] = [];
    for (const edge of incomingEdges) {
      const srcNode = upstreamNodes.find((n) => n.id === edge.source);
      if (!srcNode) continue;
      const srcData = srcNode.data as Record<string, unknown>;
      let videoPath: string | null = null;
      if (srcNode.type === CANVAS_NODE_TYPES.videoResult) videoPath = srcData.videoUrl as string | null;
      else if (srcNode.type === CANVAS_NODE_TYPES.video) videoPath = srcData.videoUrl as string | null;
      else if (srcNode.type === CANVAS_NODE_TYPES.videoFrame) videoPath = srcData.videoPath as string | null;
      if (videoPath) {
        videoEntries.push({ path: videoPath, label: (srcData.displayName as string) || "视频", x: srcNode.position.x });
      }
    }
    return videoEntries.sort((a, b) => a.x - b.x);
  }, [incomingEdges, upstreamNodes]);

  const upstreamPathSet = useMemo(() => new Set(upstreamVideos.map((v) => v.path)), [upstreamVideos]);

  const localOnlyVideos = useMemo(() => {
    return localVideoPaths
      .filter((p) => !upstreamPathSet.has(p))
      .map((p, i) => ({ path: p, label: p.split(/[\\/]/).pop() || `本地视频 ${i + 1}`, x: Infinity }));
  }, [localVideoPaths, upstreamPathSet]);

  /** Build clip entries for the node body */
  const clipEntries = useMemo(() => {
    return [...upstreamVideos, ...localOnlyVideos].map((v, i) => ({
      path: v.path,
      label: v.label,
      duration: 0,
      edit: clipEdits[i] || defaultClipEdit(),
    }));
  }, [upstreamVideos, localOnlyVideos, clipEdits]);

  const isComposing = nodeData.isComposing || false;

  const nodeWidth = nodeData.width || 520;
  const nodeHeight = nodeData.height || 400;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );
  const composedVideoUrl = nodeData.composedVideoUrl;
  const error = nodeData.error;
  const hasVideos = clipEntries.length > 0;
  const currentVideoSrc = composedVideoUrl || (clipEntries[activeClipIndex]?.path ?? null);

  /** Build ClipSegments for the editor */
  const editorSegments = useMemo(() => {
    return clipEntries.map((entry, i) => editToSegment(entry, entry.edit, `seg-${i}`));
  }, [clipEntries]);

  /** Handle segments change from editor */
  const handleSegmentsChange = useCallback((newSegments: ClipSegment[]) => {
    // Convert back to clipEdits
    // We need to map segments back to the original clip structure
    // For simplicity: each segment becomes its own entry
    const newPaths: string[] = [];
    const newEdits: VideoClipEdit[] = [];
    for (const seg of newSegments) {
      newPaths.push(seg.sourcePath);
      newEdits.push(segmentToEdit(seg));
    }
    updateNodeData(id, { videoPaths: newPaths, clipEdits: newEdits });
  }, [id, updateNodeData]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [currentVideoSrc]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = parseFloat((e.target as HTMLInputElement).value);
  }, []);

  const handleClipClick = useCallback((index: number) => {
    setActiveClipIndex(index);
    if (!composedVideoUrl && clipEntries[index]) setCurrentTime(0);
  }, [composedVideoUrl, clipEntries]);

  const openEditor = useCallback(() => updateNodeData(id, { isEditorOpen: true }), [id, updateNodeData]);
  const closeEditor = useCallback(() => updateNodeData(id, { isEditorOpen: false }), [id, updateNodeData]);

  const handleAddLocalVideo = useCallback(async () => {
    try {
      const selected = await dialogOpen({
        multiple: true,
        filters: [{ name: "Video Files", extensions: ["mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v", "3gp"] }],
      });
      if (!selected) return;
      const paths: string[] = Array.isArray(selected) ? selected : [selected as string];
      if (paths.length === 0) return;

      const persistedPaths: string[] = [];
      for (const filePath of paths) {
        try {
          const localPath = await persistVideoSource(filePath);
          persistedPaths.push(String(localPath));
        } catch (e) {
          console.error("[视频合成] 视频文件持久化失败:", e);
          persistedPaths.push(filePath);
        }
      }

      const existingPaths = nodeData.videoPaths || [];
      const newVideoPaths = [...existingPaths, ...persistedPaths];
      const existingEdits = nodeData.clipEdits || [];
      const newEdits = [...existingEdits];
      for (const _ of persistedPaths) newEdits.push(defaultClipEdit());

      updateNodeData(id, { videoPaths: newVideoPaths, clipEdits: newEdits });
      const fileNames = paths.map((p) => p.split(/[\\/]/).pop()).join(", ");
      addToast("success", `已导入: ${fileNames}`);
    } catch (e) {
      console.error("Failed to import video:", e);
      addToast("error", `导入视频失败: ${e}`);
    }
  }, [id, nodeData.videoPaths, nodeData.clipEdits, updateNodeData, addToast]);

  const handleCompose = useCallback(async () => {
    if (!hasVideos || isComposing) return;
    updateNodeData(id, { isComposing: true, error: null });
    try {
      const videoPaths = clipEntries.map((c) => c.path);
      updateNodeData(id, { videoPaths });
      const resultPath = await composeVideosSequential(videoPaths, "");
      updateNodeData(id, { isComposing: false, composedVideoUrl: resultPath });
      addToast("success", "视频合成完成");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      updateNodeData(id, { isComposing: false, error: errorMsg });
      addToast("error", `视频合成失败: ${errorMsg}`);
    }
  }, [hasVideos, isComposing, clipEntries, id, updateNodeData, addToast]);

  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
        <div style={{ position: 'relative' }}>
        <div className="node-inner" style={{ width: nodeWidth, height: nodeHeight, backgroundColor: "var(--bg-node)", border: "1px solid var(--border)", borderRadius: "var(--node-radius)", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,.3)", boxSizing: "border-box" }}>
          {/* Header */}
          <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <line x1="2" y1="7" x2="7" y2="7"/>
                <line x1="2" y1="17" x2="7" y2="17"/>
                <line x1="17" y1="17" x2="22" y2="17"/>
                <line x1="17" y1="7" x2="22" y2="7"/>
              </svg>
              <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "视频合成"}>
                {nodeData.displayName || "视频合成"}
              </span>
            </div>
          </div>

          {/* Video Preview */}
          <div style={{ width: "100%", aspectRatio: "16/9", backgroundColor: "var(--bg-primary)", position: "relative", overflow: "hidden" }}>
            {currentVideoSrc ? (
              <>
                <video ref={videoRef} src={resolveImageDisplayUrl(currentVideoSrc)} style={{ width: "100%", height: "100%", objectFit: "contain" }} onClick={togglePlay} />
                <button onClick={openEditor} className="nodrag" style={{ position: "absolute", top: "8px", right: "8px", width: "28px", height: "28px", borderRadius: "6px", backgroundColor: "var(--glass-bg)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-primary)" }} title="打开编辑器"><IconExpand size={13} /></button>
              </>
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "10px" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="var(--text-muted)" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>连接视频节点或上传本地视频</span>
                <button onClick={handleAddLocalVideo} className="nodrag" style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: "1px solid var(--border)", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                  <IconUpload size={14} /> 上传视频
                </button>
              </div>
            )}
            {currentVideoSrc && !isPlaying && (
              <button onClick={togglePlay} className="nodrag" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "48px", height: "48px", borderRadius: "50%", backgroundColor: "var(--glass-bg)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-primary)" }}><IconPlay size={18} /></button>
            )}
          </div>

          {/* Playback Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-secondary)" }}>
            <button onClick={togglePlay} disabled={!currentVideoSrc} className="nodrag" style={{ width: "28px", height: "28px", borderRadius: "50%", border: "none", backgroundColor: currentVideoSrc ? "var(--accent-btn)" : "var(--bg-primary)", color: currentVideoSrc ? "var(--text-primary)" : "var(--text-muted)", cursor: currentVideoSrc ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {isPlaying ? <IconPause size={10} /> : <IconPlay size={10} />}
            </button>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "monospace", minWidth: "70px" }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
            <input type="range" min={0} max={duration || 1} step={0.1} value={currentTime} onChange={handleSeek} onInput={handleSeek} disabled={!currentVideoSrc} style={{ flex: 1, height: "4px", cursor: currentVideoSrc ? "pointer" : "not-allowed", accentColor: "var(--accent)" }} />
          </div>

          {/* Timeline Track (compact node view) */}
          <div style={{ padding: "8px 12px", backgroundColor: "var(--bg-primary)", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: "10px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>时间轴</div>
            {hasVideos ? (
              <div style={{ display: "flex", gap: "4px", overflowX: "auto", paddingBottom: "4px" }}>
                {clipEntries.map((clip, index) => {
                  const edit = clip.edit;
                  return (
                    <div key={`clip-${index}`} onClick={() => handleClipClick(index)} style={{ flexShrink: 0, width: "80px", cursor: "pointer", borderRadius: "4px", overflow: "hidden", border: activeClipIndex === index ? "2px solid var(--accent)" : "2px solid transparent", transition: "all 0.15s ease" }}>
                      <div style={{ width: "100%", height: "45px", backgroundColor: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                        <IconPlay size={14} />
                        <div style={{ position: "absolute", top: "2px", left: "2px", width: "16px", height: "16px", borderRadius: "3px", backgroundColor: "var(--glass-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "var(--text-primary)", fontWeight: 600 }}>{index + 1}</div>
                        {edit.speed !== 1 && <div style={{ position: "absolute", bottom: "2px", right: "2px", padding: "0 3px", borderRadius: "2px", backgroundColor: "var(--accent)", fontSize: "8px", color: "var(--text-primary)", fontWeight: 600 }}>{edit.speed}x</div>}
                      </div>
                      <div style={{ padding: "3px 4px", fontSize: "9px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center", backgroundColor: "var(--bg-surface)" }}>{clip.label}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ height: "60px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "11px", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "4px" }}>
                <span>连接视频节点或</span>
                <button onClick={handleAddLocalVideo} className="nodrag" style={{ padding: "3px 10px", borderRadius: "4px", fontSize: "11px", border: "1px solid var(--border)", backgroundColor: "var(--bg-secondary)", color: "var(--text-secondary)", cursor: "pointer" }}>上传视频</button>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ padding: "8px 12px", display: "flex", gap: "8px" }}>
            <button onClick={handleAddLocalVideo} className="nodrag" style={{ padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-primary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flexShrink: 0 }}><IconUpload size={13} /> 上传</button>
            <button onClick={openEditor} disabled={!hasVideos} className="nodrag" style={{ flex: 1, padding: "8px 0", borderRadius: "6px", fontSize: "12px", fontWeight: 500, border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)", color: hasVideos ? "var(--text-primary)" : "var(--text-muted)", cursor: hasVideos ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}><IconExpand size={13} /> 打开编辑器</button>
            <button onClick={handleCompose} disabled={!hasVideos || isComposing} className="nodrag" style={{ flex: 1, padding: "8px 0", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid var(--border)", background: !hasVideos || isComposing ? "var(--bg-primary)" : "var(--bg-secondary)", color: !hasVideos || isComposing ? "var(--text-muted)" : "var(--text-primary)", cursor: !hasVideos || isComposing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              {isComposing ? (<><div className="animate-spin" style={{ width: "14px", height: "14px", border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%" }} /><span>合成中...</span></>) : <span>合成视频</span>}
            </button>
          </div>

          {error && (
            <div style={{ padding: "6px 12px 8px", display: "flex", alignItems: "flex-start", gap: "6px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              <span style={{ fontSize: "11px", color: "var(--accent-secondary)" }}>{error}</span>
            </div>
          )}
        </div>
    <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={520} maxWidth={900} minHeight={300} maxHeight={1200} />
        </div>

      <VideoEditorModal
        isOpen={isEditorOpen}
        onClose={closeEditor}
        segments={editorSegments}
        onSegmentsChange={handleSegmentsChange}
        onCompose={handleCompose}
        isComposing={isComposing}
        onAddLocalVideo={handleAddLocalVideo}
      />
      <Handle type="target" position={Position.Left} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" />
    </>
  );
});



