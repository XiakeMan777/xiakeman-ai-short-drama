import type { StoryboardBoardMode, StoryboardBoardPlanPanel, StoryboardState } from '@/types';

type NineGridStoryboardBoardMode = 'nine-portrait' | 'nine-landscape';

export interface StoryboardBoardComposerTemplateSpec {
  mode: NineGridStoryboardBoardMode;
  width: number;
  height: number;
  frameRatio: '9:16' | '16:9';
}

export interface StoryboardBoardComposerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StoryboardBoardComposerPanelLayout {
  panelRect: StoryboardBoardComposerRect;
  imageRect: StoryboardBoardComposerRect;
  textRect: StoryboardBoardComposerRect;
}

export interface StoryboardBoardComposerDetailedLayout {
  width: number;
  height: number;
  footerRect: StoryboardBoardComposerRect;
  panels: StoryboardBoardComposerPanelLayout[];
}

interface PixelDataLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

interface GridLineCluster {
  start: number;
  end: number;
}

export function isComposableStoryboardBoardMode(mode: StoryboardBoardMode): mode is NineGridStoryboardBoardMode {
  return mode === 'nine-portrait' || mode === 'nine-landscape';
}

export function getStoryboardBoardComposerTemplateSpec(
  mode: StoryboardBoardMode,
): StoryboardBoardComposerTemplateSpec | null {
  if (mode === 'nine-landscape') {
    return {
      mode,
      width: 1600,
      height: 900,
      frameRatio: '16:9',
    };
  }
  if (mode === 'nine-portrait') {
    return {
      mode,
      width: 900,
      height: 1600,
      frameRatio: '9:16',
    };
  }
  return null;
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  return ctx;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export storyboard board canvas.'));
    }, 'image/png');
  });
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
      reject(new Error('Failed to load storyboard board image.'));
    };
    image.src = url;
  });
}

function isDarkPixel(data: ArrayLike<number>, offset: number) {
  const alpha = data[offset + 3] ?? 255;
  if (alpha < 180) return false;
  return (data[offset] ?? 255) < 42
    && (data[offset + 1] ?? 255) < 42
    && (data[offset + 2] ?? 255) < 42;
}

function clusterLineIndexes(indexes: number[]): GridLineCluster[] {
  if (indexes.length === 0) return [];
  const clusters: GridLineCluster[] = [];
  let start = indexes[0];
  let end = indexes[0];

  for (let i = 1; i < indexes.length; i += 1) {
    const value = indexes[i];
    if (value <= end + 2) {
      end = value;
      continue;
    }
    clusters.push({ start, end });
    start = value;
    end = value;
  }
  clusters.push({ start, end });
  return clusters.filter((cluster) => cluster.end - cluster.start >= 2);
}

function pickGridLineClusters(clusters: GridLineCluster[], size: number): GridLineCluster[] {
  if (clusters.length <= 4) return clusters;
  const candidates = [
    clusters[0],
    ...clusters.slice(1, -1)
      .sort((left, right) => {
        const leftTarget = Math.min(
          Math.abs(((left.start + left.end) / 2) - size / 3),
          Math.abs(((left.start + left.end) / 2) - (size * 2) / 3),
        );
        const rightTarget = Math.min(
          Math.abs(((right.start + right.end) / 2) - size / 3),
          Math.abs(((right.start + right.end) / 2) - (size * 2) / 3),
        );
        return leftTarget - rightTarget;
      })
      .slice(0, 2)
      .sort((left, right) => left.start - right.start),
    clusters[clusters.length - 1],
  ];
  return candidates.filter(Boolean);
}

export function getFallbackStoryboardBoardGridCells(width: number, height: number): StoryboardBoardComposerRect[] {
  const marginX = Math.max(8, Math.round(width * 0.012));
  const marginY = Math.max(8, Math.round(height * 0.012));
  const line = Math.max(5, Math.round(Math.min(width, height) * 0.007));
  const availableWidth = width - marginX * 2 - line * 2;
  const availableHeight = height - marginY * 2 - line * 2;
  const cellWidth = availableWidth / 3;
  const cellHeight = availableHeight / 3;
  const cells: StoryboardBoardComposerRect[] = [];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push({
        x: Math.round(marginX + col * (cellWidth + line)),
        y: Math.round(marginY + row * (cellHeight + line)),
        width: Math.round(cellWidth),
        height: Math.round(cellHeight),
      });
    }
  }

  return cells;
}

export function detectStoryboardBoardGridCells(pixelData: PixelDataLike): StoryboardBoardComposerRect[] {
  const { width, height, data } = pixelData;
  const darkColumns: number[] = [];
  const darkRows: number[] = [];

  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      if (isDarkPixel(data, (y * width + x) * 4)) dark += 1;
    }
    if (dark / height > 0.45) darkColumns.push(x);
  }

  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) {
      if (isDarkPixel(data, (y * width + x) * 4)) dark += 1;
    }
    if (dark / width > 0.45) darkRows.push(y);
  }

  const vertical = pickGridLineClusters(clusterLineIndexes(darkColumns), width);
  const horizontal = pickGridLineClusters(clusterLineIndexes(darkRows), height);
  if (vertical.length < 4 || horizontal.length < 4) {
    return getFallbackStoryboardBoardGridCells(width, height);
  }

  const cells: StoryboardBoardComposerRect[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const left = vertical[col];
      const right = vertical[col + 1];
      const top = horizontal[row];
      const bottom = horizontal[row + 1];
      cells.push({
        x: left.end + 1,
        y: top.end + 1,
        width: Math.max(1, right.start - left.end - 1),
        height: Math.max(1, bottom.start - top.end - 1),
      });
    }
  }

  return cells;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}...`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 1,
) {
  if (maxLines <= 1 || ctx.measureText(text).width <= maxWidth) {
    return [fitText(ctx, text, maxWidth)];
  }

  const chars = Array.from(text);
  const lines: string[] = [];
  let current = '';

  for (const char of chars) {
    const next = `${current}${char}`;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = char;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }

  const consumed = lines.join('').length + current.length;
  const remainder = chars.slice(consumed).join('');
  if (current || lines.length === 0) lines.push(remainder ? fitText(ctx, `${current}${remainder}`, maxWidth) : current);

  return lines.slice(0, maxLines).map((line, index, all) =>
    index === all.length - 1 ? fitText(ctx, line, maxWidth) : line,
  );
}

function compactText(value: string | undefined, fallback = '') {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function buildStoryboardBoardComposerPanelRows(panel: StoryboardBoardPlanPanel): string[] {
  const shot = [panel.shotType, panel.cameraAngle, panel.cameraTask].filter(Boolean).join(' / ');
  const action = compactText(panel.staticMoment || panel.motion || panel.beat);
  const dialogue = compactText(panel.dialogue, 'NO DIALOGUE');
  const sfx = compactText(panel.sfx, 'ROOM TONE');
  const audio = compactText(panel.audio, 'SYNC AUDIO');
  const transition = compactText(panel.transition, panel.index === 9 ? 'END HOLD' : 'CUT');

  return [
    `TIME ${compactText(panel.timeRange, panel.beat)}`,
    `SHOT ${shot || compactText(panel.shotType, 'FOLLOW PLAN')}`,
    `ACTION ${action}`,
    `DIALOGUE ${dialogue}`,
    `SFX ${sfx}`,
    `AUDIO ${audio}`,
    `TRANSITION ${transition}`,
  ];
}

function getPanelRowMaxLines(row: string) {
  if (row.startsWith('ACTION ') || row.startsWith('DIALOGUE ')) return 2;
  if (row.startsWith('SHOT ')) return 2;
  return 1;
}

function buildPanelTextLines(
  ctx: CanvasRenderingContext2D,
  panel: StoryboardBoardPlanPanel,
  maxWidth: number,
) {
  return [
    `S${String(panel.index).padStart(2, '0')}`,
    ...buildStoryboardBoardComposerPanelRows(panel).flatMap((row) =>
      wrapText(ctx, row, maxWidth, getPanelRowMaxLines(row)),
    ),
  ];
}

export function buildStoryboardBoardComposerDetailedLayout(
  mode: StoryboardBoardMode,
  options?: { width?: number; maxTextLineCount?: number },
): StoryboardBoardComposerDetailedLayout | null {
  const templateSpec = getStoryboardBoardComposerTemplateSpec(mode);
  if (!templateSpec) return null;

  const width = options?.width ?? templateSpec.width;
  const margin = Math.max(10, Math.round(width * 0.011));
  const gap = Math.max(6, Math.round(width * 0.005));
  const footerHeight = Math.max(22, Math.round(width * 0.02));
  const panelWidth = Math.floor((width - margin * 2 - gap * 2) / 3);
  const imageHeight = templateSpec.frameRatio === '9:16'
    ? Math.round((panelWidth * 16) / 9)
    : Math.round((panelWidth * 9) / 16);
  const fontSize = Math.max(10, Math.min(16, Math.round(panelWidth / 34)));
  const lineHeight = fontSize + 4;
  const textPadding = Math.max(7, Math.round(fontSize * 0.75));
  const textLineCount = options?.maxTextLineCount ?? 12;
  const textHeight = textPadding * 2 + textLineCount * lineHeight;
  const panelHeight = imageHeight + textHeight;
  const panels: StoryboardBoardComposerPanelLayout[] = [];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = margin + col * (panelWidth + gap);
      const y = margin + row * (panelHeight + gap);
      panels.push({
        panelRect: { x, y, width: panelWidth, height: panelHeight },
        imageRect: { x, y, width: panelWidth, height: imageHeight },
        textRect: { x, y: y + imageHeight, width: panelWidth, height: textHeight },
      });
    }
  }

  const contentBottom = margin + 3 * panelHeight + 2 * gap;
  const height = contentBottom + gap + footerHeight;

  return {
    width,
    height,
    panels,
    footerRect: {
      x: 0,
      y: height - footerHeight,
      width,
      height: footerHeight,
    },
  };
}

function drawPanelText(
  ctx: CanvasRenderingContext2D,
  textRect: StoryboardBoardComposerRect,
  panel: StoryboardBoardPlanPanel,
) {
  const fontSize = Math.max(10, Math.min(16, Math.round(textRect.width / 34)));
  const lineHeight = fontSize + 4;
  const padding = Math.max(7, Math.round(fontSize * 0.75));
  const maxWidth = textRect.width - padding * 2;

  ctx.save();
  ctx.fillStyle = '#050505';
  ctx.fillRect(textRect.x, textRect.y, textRect.width, textRect.height);
  ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`;
  const lines = buildPanelTextLines(ctx, panel, maxWidth);
  ctx.fillStyle = '#ffffff';

  lines.forEach((line, index) => {
    const y = textRect.y + padding + fontSize + index * lineHeight;
    if (y > textRect.y + textRect.height - padding) return;
    ctx.fillText(line, textRect.x + padding, y);
  });

  ctx.restore();
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  storyboard: StoryboardState,
) {
  const footerHeight = Math.max(18, Math.round(width * 0.018));
  const text = `FULL BOARD DIRECTOR REFERENCE | Storyboard ${String(storyboard.storyboard.number).padStart(2, '0')} ${storyboard.storyboard.name} | Read board first, then Step3 assets | Final video removes grid and text.`;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(0, height - footerHeight, width, footerHeight);
  ctx.font = `700 ${Math.max(10, Math.round(footerHeight * 0.52))}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fitText(ctx, text, width - 24), 12, height - Math.round(footerHeight * 0.3));
  ctx.restore();
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: StoryboardBoardComposerRect,
  target: StoryboardBoardComposerRect,
) {
  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  const sx = source.x;
  const sy = source.y;
  const sw = source.width;
  const sh = source.height;
  let dx = target.x;
  let dy = target.y;
  let dw = target.width;
  let dh = target.height;

  if (sourceRatio > targetRatio) {
    dh = target.width / sourceRatio;
    dy = target.y + (target.height - dh) / 2;
  } else {
    dw = target.height * sourceRatio;
    dx = target.x + (target.width - dw) / 2;
  }

  ctx.fillStyle = '#000000';
  ctx.fillRect(target.x, target.y, target.width, target.height);
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

export async function composeStoryboardBoardBlob(
  visualBoardBlob: Blob,
  options: {
    mode: StoryboardBoardMode;
    storyboard: StoryboardState;
    panels: readonly StoryboardBoardPlanPanel[];
  },
): Promise<Blob> {
  const templateSpec = getStoryboardBoardComposerTemplateSpec(options.mode);
  if (!templateSpec) return visualBoardBlob;

  const visualImage = await loadImageFromBlob(visualBoardBlob);
  const layoutWidth = Math.max(
    visualImage.naturalWidth || visualImage.width || 0,
    templateSpec.width,
  );
  const layout = buildStoryboardBoardComposerDetailedLayout(options.mode, { width: layoutWidth });
  if (!layout) return visualBoardBlob;

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = getCanvasContext(canvas);
  ctx.fillStyle = '#f7f7f7';
  ctx.fillRect(0, 0, layout.width, layout.height);

  const sourceWidth = visualImage.naturalWidth || visualImage.width;
  const sourceHeight = visualImage.naturalHeight || visualImage.height;
  const sourceCellWidth = sourceWidth / 3;
  const sourceCellHeight = sourceHeight / 3;

  layout.panels.slice(0, 9).forEach((panelLayout, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(
      panelLayout.panelRect.x - 2,
      panelLayout.panelRect.y - 2,
      panelLayout.panelRect.width + 4,
      panelLayout.panelRect.height + 4,
    );
    drawContainedImage(ctx, visualImage, {
      x: col * sourceCellWidth,
      y: row * sourceCellHeight,
      width: sourceCellWidth,
      height: sourceCellHeight,
    }, panelLayout.imageRect);
    const panel = options.panels[index];
    if (panel) drawPanelText(ctx, panelLayout.textRect, panel);
  });

  drawFooter(ctx, layout.width, layout.height, options.storyboard);
  return canvasToPngBlob(canvas);
}
