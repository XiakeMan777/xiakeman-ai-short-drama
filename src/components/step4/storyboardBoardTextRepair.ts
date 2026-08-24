import type { StoryboardBoardMode, StoryboardBoardPlan, StoryboardBoardPlanPanel, StoryboardState } from '@/types';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextRepairOptions {
  mode: StoryboardBoardMode;
  storyboard: StoryboardState;
  plan: StoryboardBoardPlan;
}

interface TextStyle {
  fontSize: number;
  fontWeight?: number;
  color?: string;
  lineHeight?: number;
  fontFamily?: string;
}

interface LineBand {
  start: number;
  end: number;
  center: number;
  max: number;
  sum: number;
}

interface LineCluster {
  start: number;
  end: number;
  center: number;
  max: number;
  sum: number;
}

export interface StoryboardBoardTextRepairLayout {
  width: number;
  height: number;
  titleBar: Rect;
  metaBar: Rect;
  panels: Array<{
    frame: Rect;
    label: Rect;
    info: Rect;
  }>;
  footer: Rect;
}

const FONT_FAMILY = '"Microsoft YaHei", "Noto Sans SC", "PingFang SC", "Source Han Sans SC", Arial, sans-serif';

function isNineGridMode(mode: StoryboardBoardMode) {
  return mode === 'nine-landscape' || mode === 'nine-portrait';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compactText(value: string | undefined, maxLength: number) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}...` : normalized;
}

function getContext(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持故事板文字修复');
  return ctx;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('故事板图片读取失败'));
    };
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('故事板文字修复导出失败'));
    }, 'image/png');
  });
}

export function getStoryboardBoardTextRepairLayout(
  width: number,
  height: number,
  mode: StoryboardBoardMode,
): StoryboardBoardTextRepairLayout {
  const margin = Math.round(width * 0.015);
  const gap = Math.max(2, Math.round(width * 0.004));
  const titleHeight = Math.round(height * 0.036);
  const metaHeight = Math.round(height * 0.028);
  const footerHeight = Math.round(height * 0.075);
  const gridTop = titleHeight + metaHeight + gap;
  const gridHeight = height - gridTop - footerHeight - gap;
  const columns = mode === 'shot-plan-landscape' ? 5 : 3;
  const rows = mode === 'shot-plan-landscape' ? 3 : 3;
  const gridWidth = width - margin * 2;
  const cellWidth = (gridWidth - gap * (columns - 1)) / columns;
  const cellHeight = (gridHeight - gap * (rows - 1)) / rows;
  const labelSize = Math.max(28, Math.round(Math.min(cellWidth, cellHeight) * 0.075));
  const infoHeightRatio = mode === 'shot-plan-landscape' ? 0.36 : 0.34;
  const infoHeight = Math.round(cellHeight * infoHeightRatio);

  const panels = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = Math.round(margin + column * (cellWidth + gap));
    const y = Math.round(gridTop + row * (cellHeight + gap));
    const frame = {
      x,
      y,
      width: Math.round(cellWidth),
      height: Math.round(cellHeight),
    };
    return {
      frame,
      label: {
        x: x + Math.round(gap * 1.5),
        y: y + Math.round(gap * 1.5),
        width: labelSize * 1.85,
        height: labelSize,
      },
      info: {
        x,
        y: Math.round(y + cellHeight - infoHeight),
        width: Math.round(cellWidth),
        height: infoHeight,
      },
    };
  });

  return {
    width,
    height,
    titleBar: { x: 0, y: 0, width, height: titleHeight },
    metaBar: { x: 0, y: titleHeight, width, height: metaHeight },
    panels,
    footer: {
      x: 0,
      y: height - footerHeight,
      width,
      height: footerHeight,
    },
  };
}

function setFont(ctx: CanvasRenderingContext2D, style: TextStyle) {
  ctx.font = `${style.fontWeight ?? 500} ${style.fontSize}px ${style.fontFamily ?? FONT_FAMILY}`;
  ctx.fillStyle = style.color ?? '#f8fafc';
  ctx.textBaseline = 'top';
}

function splitTextIntoLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const tokens = normalized.match(/[A-Z0-9_:/.-]+|[\u4e00-\u9fff]|[^\u4e00-\u9fff\s]/g) ?? [normalized];
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    const next = current ? `${current}${/^[A-Z0-9_:/.-]+$/.test(token) ? ' ' : ''}${token}` : token;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }

    lines.push(current);
    current = token;
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (lines.length === maxLines && current && tokens.length > 0) {
    const lastIndex = lines.length - 1;
    while (lines[lastIndex].length > 1 && ctx.measureText(`${lines[lastIndex]}...`).width > maxWidth) {
      lines[lastIndex] = lines[lastIndex].slice(0, -1);
    }
    if (!lines[lastIndex].endsWith('...') && ctx.measureText(`${lines[lastIndex]}...`).width <= maxWidth) {
      lines[lastIndex] = `${lines[lastIndex]}...`;
    }
  }
  return lines;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rect,
  style: TextStyle,
  maxLines: number,
) {
  setFont(ctx, style);
  const lineHeight = style.lineHeight ?? Math.round(style.fontSize * 1.28);
  const lines = splitTextIntoLines(ctx, text, rect.width, maxLines);
  lines.forEach((line, index) => {
    ctx.fillText(line, rect.x, rect.y + index * lineHeight);
  });
}

function drawBackground(ctx: CanvasRenderingContext2D, rect: Rect, color = 'rgba(2, 6, 23, 0.98)') {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawStroke(ctx: CanvasRenderingContext2D, rect: Rect, color = 'rgba(148, 163, 184, 0.35)', width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function isGridLinePixel(data: Uint8ClampedArray, index: number) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 105 && green > 105 && blue > 105 && max - min < 95;
}

function buildLineBands(scores: number[], threshold: number): LineBand[] {
  const bands: LineBand[] = [];
  let start = -1;
  let max = 0;
  let sum = 0;
  let weightedSum = 0;

  scores.forEach((score, index) => {
    if (score >= threshold) {
      if (start < 0) {
        start = index;
        max = 0;
        sum = 0;
        weightedSum = 0;
      }
      max = Math.max(max, score);
      sum += score;
      weightedSum += index * score;
      return;
    }

    if (start >= 0) {
      bands.push({
        start,
        end: index - 1,
        center: sum ? weightedSum / sum : (start + index - 1) / 2,
        max,
        sum,
      });
      start = -1;
    }
  });

  if (start >= 0) {
    bands.push({
      start,
      end: scores.length - 1,
      center: sum ? weightedSum / sum : start,
      max,
      sum,
    });
  }

  return bands;
}

function clusterLineBands(bands: LineBand[], maxGap: number): LineCluster[] {
  const clusters: LineCluster[] = [];
  bands.forEach((band) => {
    const current = clusters[clusters.length - 1];
    if (!current || band.start - current.end > maxGap) {
      clusters.push({ ...band });
      return;
    }

    current.end = band.end;
    current.max = Math.max(current.max, band.max);
    current.sum += band.sum;
    current.center = (current.center + band.center) / 2;
  });
  return clusters;
}

function scanGridLineClusters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  axis: 'x' | 'y',
) {
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const isHorizontal = axis === 'y';
  const scoreLength = isHorizontal ? height : width;
  const sampleLength = isHorizontal ? width : height;
  const step = Math.max(2, Math.floor(sampleLength / 960));
  const scores = Array.from({ length: scoreLength }, () => 0);

  if (isHorizontal) {
    for (let y = 0; y < height; y += 1) {
      let score = 0;
      for (let x = 0; x < width; x += step) {
        const index = (y * width + x) * 4;
        if (isGridLinePixel(imageData, index)) score += 1;
      }
      scores[y] = score;
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      let score = 0;
      for (let y = 0; y < height; y += step) {
        const index = (y * width + x) * 4;
        if (isGridLinePixel(imageData, index)) score += 1;
      }
      scores[x] = score;
    }
  }

  const sampleCount = Math.ceil(sampleLength / step);
  const threshold = Math.max(24, Math.round(sampleCount * (isHorizontal ? 0.45 : 0.28)));
  const bands = buildLineBands(scores, threshold);
  return clusterLineBands(bands, Math.max(4, Math.round((isHorizontal ? height : width) * 0.007)));
}

function pickColumnSpans(clusters: LineCluster[], width: number): Array<{ x: number; width: number }> | null {
  const candidates = clusters
    .filter((cluster) => cluster.center >= width * 0.005 && cluster.center <= width * 0.995)
    .sort((left, right) => left.center - right.center);
  if (candidates.length < 4) return null;

  const left = candidates[0];
  const right = candidates[candidates.length - 1];
  const middleCandidates = candidates.slice(1, -1);
  const firstSeparator = middleCandidates.reduce((best, cluster) =>
    Math.abs(cluster.center - width / 3) < Math.abs(best.center - width / 3) ? cluster : best,
  middleCandidates[0]);
  const secondSeparator = middleCandidates.reduce((best, cluster) =>
    Math.abs(cluster.center - (width * 2) / 3) < Math.abs(best.center - (width * 2) / 3) ? cluster : best,
  middleCandidates[middleCandidates.length - 1]);
  if (!firstSeparator || !secondSeparator || firstSeparator.center >= secondSeparator.center) return null;

  const inset = Math.max(3, Math.round(width * 0.002));
  const spans = [
    { x: left.end + inset, right: firstSeparator.start - inset },
    { x: firstSeparator.end + inset, right: secondSeparator.start - inset },
    { x: secondSeparator.end + inset, right: right.start - inset },
  ];
  if (spans.some((span) => span.right - span.x < width * 0.18)) return null;
  return spans.map((span) => ({ x: span.x, width: span.right - span.x }));
}

function scoreRowClusterWindow(window: LineCluster[], height: number) {
  const rowHeights = [
    window[2].start - window[0].end,
    window[4].start - window[2].end,
    window[6].start - window[4].end,
  ];
  const visualHeights = [
    window[1].center - window[0].end,
    window[3].center - window[2].end,
    window[5].center - window[4].end,
  ];
  if (rowHeights.some((value) => value < height * 0.12)) return Number.POSITIVE_INFINITY;
  if (visualHeights.some((value, index) => value < rowHeights[index] * 0.42 || value > rowHeights[index] * 0.82)) {
    return Number.POSITIVE_INFINITY;
  }
  if (window[0].center < height * 0.05 || window[0].center > height * 0.25) return Number.POSITIVE_INFINITY;
  if (window[6].center < height * 0.72 || window[6].center > height * 0.95) return Number.POSITIVE_INFINITY;

  const averageRowHeight = rowHeights.reduce((sum, value) => sum + value, 0) / rowHeights.length;
  const rowVariance = rowHeights.reduce((sum, value) => sum + Math.abs(value - averageRowHeight), 0) / averageRowHeight;
  const ratioVariance = visualHeights.reduce((sum, value, index) => {
    const ratio = value / rowHeights[index];
    return sum + Math.abs(ratio - 0.62);
  }, 0);
  return rowVariance + ratioVariance;
}

function pickRowSpans(clusters: LineCluster[], height: number): Array<{ y: number; height: number }> | null {
  const candidates = clusters
    .filter((cluster) => cluster.center >= height * 0.04 && cluster.center <= height * 0.97)
    .sort((left, right) => left.center - right.center);
  if (candidates.length < 7) return null;

  let bestWindow: LineCluster[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= candidates.length - 7; index += 1) {
    const window = candidates.slice(index, index + 7);
    const score = scoreRowClusterWindow(window, height);
    if (score < bestScore) {
      bestScore = score;
      bestWindow = window;
    }
  }

  if (!bestWindow || !Number.isFinite(bestScore)) return null;
  const inset = Math.max(3, Math.round(height * 0.002));
  const spans = [
    { y: bestWindow[0].end + inset, bottom: bestWindow[1].center - inset },
    { y: bestWindow[2].end + inset, bottom: bestWindow[3].center - inset },
    { y: bestWindow[4].end + inset, bottom: bestWindow[5].center - inset },
  ];
  if (spans.some((span) => span.bottom - span.y < height * 0.1)) return null;
  return spans.map((span) => ({ y: span.y, height: span.bottom - span.y }));
}

export function detectStoryboardBoardPanelVisualRects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): Rect[] | null {
  const xClusters = scanGridLineClusters(ctx, width, height, 'x');
  const yClusters = scanGridLineClusters(ctx, width, height, 'y');
  const columns = pickColumnSpans(xClusters, width);
  const rows = pickRowSpans(yClusters, height);
  if (!columns || !rows) return null;

  return rows.flatMap((row) =>
    columns.map((column) => ({
      x: column.x,
      y: row.y,
      width: column.width,
      height: row.height,
    })),
  );
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  source: Rect,
  target: Rect,
) {
  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  let sx = source.x;
  let sy = source.y;
  let sw = source.width;
  let sh = source.height;

  if (sourceRatio > targetRatio) {
    sw = source.height * targetRatio;
    sx = source.x + (source.width - sw) / 2;
  } else {
    sh = source.width / targetRatio;
    sy = source.y + (source.height - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, target.x, target.y, target.width, target.height);
}

function getPanelVisualRect(
  panelLayout: StoryboardBoardTextRepairLayout['panels'][number],
  cropInset = 0,
): Rect {
  const visualBottom = panelLayout.info.y;
  const x = panelLayout.frame.x + cropInset;
  const y = panelLayout.frame.y + cropInset;
  return {
    x,
    y,
    width: Math.max(1, panelLayout.frame.width - cropInset * 2),
    height: Math.max(1, visualBottom - panelLayout.frame.y - cropInset),
  };
}

function drawPanelVisuals(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  sourceCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  layout: StoryboardBoardTextRepairLayout,
  mode: StoryboardBoardMode,
) {
  const detectedSourceRects = detectStoryboardBoardPanelVisualRects(
    sourceCtx,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const sourceLayout = getStoryboardBoardTextRepairLayout(image.naturalWidth || image.width, image.naturalHeight || image.height, mode);
  layout.panels.forEach((panelLayout, index) => {
    const sourcePanel = sourceLayout.panels[index];
    if (!sourcePanel) return;
    const targetVisual = getPanelVisualRect(panelLayout);
    const sourceVisual = detectedSourceRects?.[index]
      ?? getPanelVisualRect(sourcePanel, Math.max(2, Math.round(sourcePanel.frame.width * 0.004)));
    drawBackground(ctx, panelLayout.frame, '#020617');
    drawImageCover(ctx, detectedSourceRects ? sourceCanvas : image, sourceVisual, targetVisual);
    drawStroke(ctx, targetVisual, 'rgba(226, 232, 240, 0.2)', 1);
  });
}

function getPanelShotLine(panel: StoryboardBoardPlanPanel) {
  return compactText([
    panel.shotType,
    panel.cameraAngle,
    panel.cameraTask,
  ].filter(Boolean).join(' / '), 70);
}

export function buildStoryboardBoardPanelInfoLines(panel: StoryboardBoardPlanPanel): string[] {
  return [
    `TIME ${compactText(panel.timeRange || panel.beat, 28)}`,
    `SHOT ${getPanelShotLine(panel)}`,
    `ACTION ${compactText(panel.motion || panel.staticMoment || panel.beat, 66)}`,
    `DIALOGUE ${compactText(panel.dialogue || 'NO DIALOGUE', 62)}`,
    `SFX ${compactText(panel.sfx || 'ROOM TONE', 48)}  AUDIO ${compactText(panel.audio || 'SYNC AUDIO', 48)}`,
    `TRANSITION ${compactText(panel.transition || (panel.index >= 9 ? 'END HOLD' : 'CUT'), 34)}`,
  ];
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  layout: StoryboardBoardTextRepairLayout,
  storyboard: StoryboardState,
  panelCount: number,
) {
  drawBackground(ctx, layout.titleBar, 'rgba(0, 0, 0, 0.96)');
  const titleFont = clamp(Math.round(layout.titleBar.height * 0.46), 18, 44);
  const title = `STORYBOARD SHEET - ${storyboard.storyboard.name}`;
  drawWrappedText(ctx, title, {
    x: Math.round(layout.width * 0.018),
    y: Math.round(layout.titleBar.height * 0.2),
    width: Math.round(layout.width * 0.72),
    height: layout.titleBar.height,
  }, { fontSize: titleFont, fontWeight: 800, color: '#ffffff' }, 1);

  const meta = `SHOT ${String(storyboard.storyboard.number).padStart(2, '0')} / ${storyboard.storyboard.duration} / ${storyboard.storyboard.shotSize} / ${panelCount} PANELS`;
  drawWrappedText(ctx, meta, {
    x: Math.round(layout.width * 0.74),
    y: Math.round(layout.titleBar.height * 0.25),
    width: Math.round(layout.width * 0.24),
    height: layout.titleBar.height,
  }, { fontSize: clamp(Math.round(layout.titleBar.height * 0.28), 11, 24), fontWeight: 700, color: '#cbd5e1' }, 1);
}

function drawMetaBar(
  ctx: CanvasRenderingContext2D,
  layout: StoryboardBoardTextRepairLayout,
  plan: StoryboardBoardPlan,
) {
  drawBackground(ctx, layout.metaBar, 'rgba(8, 13, 24, 0.95)');
  const metaFont = clamp(Math.round(layout.metaBar.height * 0.34), 10, 20);
  const meta = [
    'READ ORDER S01-S09',
    compactText(plan.cameraPlan?.cameraId || 'CAMERA', 22),
    compactText(plan.cameraPlan?.lensPlan || plan.cameraPlan?.cameraRelation || 'FOLLOW BOARD RHYTHM', 46),
    compactText(plan.sceneAnchor, 52),
  ].filter(Boolean).join('  |  ');
  drawWrappedText(ctx, meta, {
    x: Math.round(layout.width * 0.018),
    y: layout.metaBar.y + Math.round(layout.metaBar.height * 0.24),
    width: Math.round(layout.width * 0.965),
    height: layout.metaBar.height,
  }, { fontSize: metaFont, fontWeight: 700, color: '#e2e8f0' }, 1);
}

function drawPanelInfo(
  ctx: CanvasRenderingContext2D,
  panelLayout: StoryboardBoardTextRepairLayout['panels'][number],
  panel: StoryboardBoardPlanPanel,
) {
  drawBackground(ctx, panelLayout.info, 'rgba(0, 0, 0, 0.86)');
  drawStroke(ctx, panelLayout.frame, 'rgba(226, 232, 240, 0.28)', 2);

  const label = panel.index >= 10 ? `S${panel.index}` : `S${String(panel.index).padStart(2, '0')}`;
  drawBackground(ctx, panelLayout.label, 'rgba(0, 0, 0, 0.82)');
  drawStroke(ctx, panelLayout.label, 'rgba(255, 255, 255, 0.42)', 1);
  drawWrappedText(ctx, label, {
    x: panelLayout.label.x + Math.round(panelLayout.label.width * 0.12),
    y: panelLayout.label.y + Math.round(panelLayout.label.height * 0.14),
    width: panelLayout.label.width * 0.8,
    height: panelLayout.label.height,
  }, {
    fontSize: clamp(Math.round(panelLayout.label.height * 0.46), 11, 32),
    fontWeight: 900,
    color: '#ffffff',
  }, 1);

  const paddingX = Math.max(6, Math.round(panelLayout.info.width * 0.025));
  const paddingY = Math.max(4, Math.round(panelLayout.info.height * 0.055));
  const lineHeight = Math.max(10, Math.floor((panelLayout.info.height - paddingY * 2) / 6));
  const fontSize = clamp(Math.floor(lineHeight * 0.72), 8, 18);
  const lines = buildStoryboardBoardPanelInfoLines(panel);
  const textRect = {
    x: panelLayout.info.x + paddingX,
    y: panelLayout.info.y + paddingY,
    width: panelLayout.info.width - paddingX * 2,
    height: panelLayout.info.height - paddingY * 2,
  };

  lines.forEach((line, index) => {
    const keyword = line.split(' ')[0];
    const y = textRect.y + index * lineHeight;
    drawWrappedText(ctx, keyword, {
      x: textRect.x,
      y,
      width: Math.round(textRect.width * 0.24),
      height: lineHeight,
    }, { fontSize, fontWeight: 900, color: '#facc15', lineHeight }, 1);
    drawWrappedText(ctx, line.slice(keyword.length).trim(), {
      x: textRect.x + Math.round(textRect.width * 0.25),
      y,
      width: Math.round(textRect.width * 0.74),
      height: lineHeight,
    }, { fontSize, fontWeight: 650, color: '#f8fafc', lineHeight }, 1);
  });
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  layout: StoryboardBoardTextRepairLayout,
  storyboard: StoryboardState,
  plan: StoryboardBoardPlan,
) {
  drawBackground(ctx, layout.footer, 'rgba(0, 0, 0, 0.96)');
  const padX = Math.round(layout.width * 0.018);
  const padY = Math.round(layout.footer.height * 0.13);
  const lineHeight = Math.max(12, Math.floor((layout.footer.height - padY * 2) / 4));
  const fontSize = clamp(Math.floor(lineHeight * 0.66), 9, 18);
  const first = plan.panels[0];
  const last = plan.panels[plan.panels.length - 1];
  const lines = [
    `BOARD INFO: SHOT ${String(storyboard.storyboard.number).padStart(2, '0')} / ${storyboard.storyboard.name} / ${storyboard.storyboard.duration} / ${storyboard.storyboard.shotSize}`,
    `READ ORDER: S01 S02 S03 / S04 S05 S06 / S07 S08 S09`,
    `CONTINUITY: IN ${compactText(first?.continuityIn || plan.blockingContinuity?.currentStart, 72)} / OUT ${compactText(last?.continuityOut || plan.blockingContinuity?.currentEnd, 72)}`,
    `CAMERA: ${compactText([plan.cameraPlan?.cameraId, plan.cameraPlan?.cameraRelation, plan.cameraPlan?.lensPlan].filter(Boolean).join(' / '), 92)}  |  DO NOT REDESIGN STEP3 ASSETS`,
  ];

  lines.forEach((line, index) => {
    drawWrappedText(ctx, line, {
      x: padX,
      y: layout.footer.y + padY + index * lineHeight,
      width: layout.width - padX * 2,
      height: lineHeight,
    }, { fontSize, fontWeight: 700, color: index === 0 ? '#ffffff' : '#cbd5e1', lineHeight }, 1);
  });
}

export async function repairStoryboardBoardTextBlob(
  sourceBlob: Blob,
  options: TextRepairOptions,
): Promise<Blob> {
  if (!isNineGridMode(options.mode)) return sourceBlob;
  const image = await loadImageFromBlob(sourceBlob);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = getContext(canvas);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;
  const sourceCtx = getContext(sourceCanvas);
  sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);

  const layout = getStoryboardBoardTextRepairLayout(canvas.width, canvas.height, options.mode);
  drawBackground(ctx, { x: 0, y: 0, width: canvas.width, height: canvas.height }, '#020617');
  drawPanelVisuals(ctx, image, sourceCtx, sourceCanvas, layout, options.mode);

  const panels = options.plan.panels.slice(0, 9);
  drawTitle(ctx, layout, options.storyboard, panels.length);
  drawMetaBar(ctx, layout, options.plan);
  panels.forEach((panel, index) => {
    const panelLayout = layout.panels[index];
    if (panelLayout) drawPanelInfo(ctx, panelLayout, panel);
  });
  drawFooter(ctx, layout, options.storyboard, options.plan);

  return canvasToPngBlob(canvas);
}
