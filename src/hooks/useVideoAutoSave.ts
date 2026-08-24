// ============================================================
// useVideoAutoSave - 视频自动保存 Hook
// 视频生成完成后自动保存到用户选择的本地目录
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  isFileSystemAccessSupported,
  pickOutputDirectory,
  verifyDirPermission,
  getOutputDirName,
  clearOutputDirectory,
  autoSaveVideo,
  loadSavedKeys,
  persistSavedKeys,
  clearSavedKeys,
} from '@/lib/videoAutoSave';
import { toast } from 'sonner';

export interface VideoAutoSaveState {
  /** 浏览器是否支持 File System Access API */
  supported: boolean;
  /** 是否已选择输出目录 */
  hasDir: boolean;
  /** 输出目录名称 */
  dirName: string | null;
  /** 是否正在保存 */
  saving: boolean;
  /** 是否启用自动保存 */
  enabled: boolean;
  /** 去重 key 是否已从 IndexedDB 加载完成 */
  keysReady: boolean;
}

export function useVideoAutoSave() {
  const supported = isFileSystemAccessSupported();

  const [state, setState] = useState<VideoAutoSaveState>({
    supported,
    hasDir: false,
    dirName: null,
    saving: false,
    enabled: false,
    keysReady: false,
  });

  // 防止重复保存的 set：key 为 "chapterId_index" 组合
  // 优先从 IndexedDB 恢复，跨组件生命周期持久化
  const savedVideoKeys = useRef<Set<string>>(new Set());

  // 初始化时从 IndexedDB 加载已保存的 key（必须等加载完才能开始自动保存）
  useEffect(() => {
    if (!supported) {
      setState((prev) => ({ ...prev, keysReady: true }));
      return;
    }
    loadSavedKeys().then((keys) => {
      if (keys.size > 0) {
        savedVideoKeys.current = keys;
      }
      setState((prev) => ({ ...prev, keysReady: true }));
    }).catch(() => {
      setState((prev) => ({ ...prev, keysReady: true }));
    });
  }, [supported]);

  // 初始化时检查已保存的目录
  useEffect(() => {
    if (!supported) return;

    (async () => {
      const dirName = await getOutputDirName();
      if (dirName) {
        const hasPermission = await verifyDirPermission();
        if (hasPermission) {
          setState((prev) => ({
            ...prev,
            hasDir: true,
            dirName,
            enabled: true,
          }));
        }
      }
    })();
  }, [supported]);

  /** 选择输出目录 */
  const selectDir = useCallback(async () => {
    if (!supported) {
      toast.error('当前浏览器不支持自动保存，请使用 Chrome 或 Edge');
      return;
    }

    const ok = await pickOutputDirectory();
    if (ok) {
      const dirName = await getOutputDirName();
      await clearSavedKeys();
      savedVideoKeys.current.clear();
      setState((prev) => ({
        ...prev,
        hasDir: true,
        dirName,
        enabled: true,
      }));
      toast.success(`已选择输出目录: ${dirName}`);
    }
  }, [supported]);

  /** 清除输出目录 */
  const clearDir = useCallback(async () => {
    await clearOutputDirectory();
    await clearSavedKeys();
    savedVideoKeys.current.clear();
    setState((prev) => ({
      ...prev,
      hasDir: false,
      dirName: null,
      enabled: false,
    }));
  }, []);

  /** 切换自动保存开关 */
  const toggleEnabled = useCallback(() => {
    setState((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  /**
   * 保存视频到本地
   * 使用 chapterId + index 组合作为去重 key，防止重复保存
   * @param dedupeKey - 去重键，格式 "chapterId_index"
   */
  const saveVideo = useCallback(
    async (
      videoUrl: string | undefined,
      projectName: string,
      chapterName: string,
      fileName: string,
      dedupeKey: string,
      videoBlobKey?: string,
    ): Promise<boolean> => {
      if (!state.enabled || !state.hasDir) return false;

      // 防止重复保存
      if (savedVideoKeys.current.has(dedupeKey)) return true;
      savedVideoKeys.current.add(dedupeKey);
      // 异步持久化到 IndexedDB（不阻塞主流程）
      persistSavedKeys(savedVideoKeys.current).catch(() => {});

        setState((prev) => ({ ...prev, saving: true }));

      try {
        const result = await autoSaveVideo(videoUrl, projectName, chapterName, fileName, videoBlobKey);

        if (result.success) {
          if (import.meta.env.DEV && !result.skipped) {
            console.log(`[autoSave] 视频已保存: ${result.path}`);
          }
          return true;
        } else {
          // 保存失败，移除记录允许重试
          savedVideoKeys.current.delete(dedupeKey);
          persistSavedKeys(savedVideoKeys.current).catch(() => {});
          console.warn(`[autoSave] 保存失败: ${result.error}`);
          return false;
        }
      } finally {
        setState((prev) => ({ ...prev, saving: false }));
      }
    },
    [state.enabled, state.hasDir],
  );

  return {
    ...state,
    selectDir,
    clearDir,
    toggleEnabled,
    saveVideo,
  };
}
