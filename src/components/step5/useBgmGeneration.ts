// ============================================================
// Step5 BGM 并行生成 Hook
// 在视频生成的同时，后台并行启动BGM生成
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { useCurrentProject } from '@/stores/projectStore';
import { analyzeBgm, generateBgm, createDefaultBgmProgress, type BgmGenerationProgress, type BgmAnalysisResult } from '@/lib/bgmGenerator';
import { resolveStoryboardVideoDuration } from '@/lib/storyboardDuration';
import type { StoryboardState } from '@/types';

function sumStoryboardDurations(storyboards: readonly StoryboardState[], fallback: number) {
  return storyboards.reduce((total, storyboard) => total + resolveStoryboardVideoDuration(storyboard, fallback), 0);
}

export function useBgmGeneration() {
  const { state, dispatch, currentProject, currentChapter: chapter } = useCurrentProject();

  const [bgmProgress, setBgmProgress] = useState<BgmGenerationProgress>(createDefaultBgmProgress());
  const [bgmGenerating, setBgmGenerating] = useState(false);
  const [bgmPreview, setBgmPreview] = useState<BgmAnalysisResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const analyzeBgmOnly = useCallback(async () => {
    if (!chapter?.analysis) {
      console.warn('[BGM] 无分析结果，跳过BGM分析');
      return null;
    }

    if (bgmGenerating) {
      console.warn('[BGM] 已在生成中，跳过');
      return null;
    }

    const storyboards = chapter.storyboards;
    if (storyboards.length === 0) {
      console.warn('[BGM] 无分镜数据，跳过BGM分析');
      return null;
    }

    const totalDurationSeconds = sumStoryboardDurations(storyboards, state.videoApiConfig.videoDuration || 15);

    const abortController = new AbortController();
    abortRef.current = abortController;

    setBgmGenerating(true);
    setBgmProgress({ phase: 'analyzing', message: '分析全文基调...', progress: 10 });

    try {
      const result = await analyzeBgm({
        analysis: chapter.analysis,
        storyboards,
        apiConfig: state.apiConfig,
        totalDurationSeconds,
        signal: abortController.signal,
      });

      setBgmPreview(result);
      setBgmProgress({ phase: 'analyzing', message: '分析完成，请确认提示词', progress: 30 });
      return result;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setBgmProgress({ phase: 'error', message: 'BGM分析已取消', progress: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[BGM] 分析失败:', message);
        setBgmProgress({ phase: 'error', message: `BGM分析失败: ${message}`, progress: 0 });
      }
      return null;
    } finally {
      setBgmGenerating(false);
      abortRef.current = null;
    }
  }, [chapter, state.apiConfig, state.videoApiConfig.videoDuration, bgmGenerating]);

  const confirmBgmGeneration = useCallback(async () => {
    if (!bgmPreview) {
      console.warn('[BGM] 无预览结果，无法确认生成');
      return;
    }

    if (!chapter?.analysis) {
      console.warn('[BGM] 无分析结果，跳过BGM生成');
      return;
    }

    if (!state.musicApiConfig.apiKey.trim()) {
      setBgmProgress({ phase: 'error', message: '请先在 API 设置中配置音乐模型 API Key。', progress: 0 });
      return;
    }

    const storyboards = chapter.storyboards;
    const totalDurationSeconds = sumStoryboardDurations(storyboards, state.videoApiConfig.videoDuration || 15);

    const abortController = new AbortController();
    abortRef.current = abortController;

    setBgmGenerating(true);
    setBgmProgress({ phase: 'generating', message: `生成BGM: ${bgmPreview.title}（${bgmPreview.style}）`, progress: 30 });

    try {
      const musicResult = await generateBgm({
        analysis: chapter.analysis,
        storyboards,
        apiConfig: state.apiConfig,
        musicApiConfig: state.musicApiConfig,
        totalDurationSeconds,
        projectId: currentProject?.id,
        chapterId: chapter.id,
        signal: abortController.signal,
        onProgress: setBgmProgress,
      });

      dispatch({ type: 'SET_CHAPTER_BGM', bgm: musicResult });
      setBgmProgress({ phase: 'done', message: `BGM已生成: ${musicResult.name}`, progress: 100 });
      setBgmPreview(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setBgmProgress({ phase: 'error', message: 'BGM生成已取消', progress: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[BGM] 生成失败:', message);
        setBgmProgress({ phase: 'error', message: `BGM生成失败: ${message}`, progress: 0 });
      }
    } finally {
      setBgmGenerating(false);
      abortRef.current = null;
    }
  }, [bgmPreview, chapter, currentProject?.id, state.apiConfig, state.musicApiConfig, state.videoApiConfig.videoDuration, dispatch]);

  const cancelBgmPreview = useCallback(() => {
    setBgmPreview(null);
    setBgmProgress(createDefaultBgmProgress());
  }, []);

  const startBgmGeneration = useCallback(async () => {
    if (!chapter?.analysis) {
      console.warn('[BGM] 无分析结果，跳过BGM生成');
      return;
    }

    if (bgmGenerating) {
      console.warn('[BGM] 已在生成中，跳过');
      return;
    }

    if (chapter.bgm?.blobKey) {
      if (import.meta.env.DEV) console.log('[BGM] 章节已有BGM，跳过生成');
      return;
    }

    if (!state.musicApiConfig.apiKey.trim()) {
      setBgmProgress({ phase: 'error', message: '请先在 API 设置中配置音乐模型 API Key。', progress: 0 });
      return;
    }

    const storyboards = chapter.storyboards;
    if (storyboards.length === 0) {
      console.warn('[BGM] 无分镜数据，跳过BGM生成');
      return;
    }

    const totalDurationSeconds = sumStoryboardDurations(storyboards, state.videoApiConfig.videoDuration || 15);

    const abortController = new AbortController();
    abortRef.current = abortController;

    setBgmGenerating(true);
    setBgmProgress({ phase: 'analyzing', message: '分析全文基调...', progress: 5 });

    try {
      const bgmConfig = await generateBgm({
        analysis: chapter.analysis,
        storyboards,
        apiConfig: state.apiConfig,
        musicApiConfig: state.musicApiConfig,
        totalDurationSeconds,
        projectId: currentProject?.id,
        chapterId: chapter.id,
        signal: abortController.signal,
        onProgress: setBgmProgress,
      });

      dispatch({ type: 'SET_CHAPTER_BGM', bgm: bgmConfig });
      setBgmProgress({ phase: 'done', message: `BGM已生成: ${bgmConfig.name}`, progress: 100 });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setBgmProgress({ phase: 'error', message: 'BGM生成已取消', progress: 0 });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[BGM] 生成失败:', message);
        setBgmProgress({ phase: 'error', message: `BGM生成失败: ${message}`, progress: 0 });
      }
    } finally {
      setBgmGenerating(false);
      abortRef.current = null;
    }
  }, [chapter, currentProject?.id, state.apiConfig, state.musicApiConfig, state.videoApiConfig.videoDuration, bgmGenerating, dispatch]);

  const cancelBgmGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const resetBgmGeneration = useCallback(() => {
    setBgmProgress(createDefaultBgmProgress());
    setBgmGenerating(false);
    setBgmPreview(null);
  }, []);

  return {
    bgmProgress,
    bgmGenerating,
    bgmPreview,
    analyzeBgmOnly,
    confirmBgmGeneration,
    cancelBgmPreview,
    startBgmGeneration,
    cancelBgmGeneration,
    resetBgmGeneration,
    hasBgm: !!chapter?.bgm?.blobKey,
  };
}
