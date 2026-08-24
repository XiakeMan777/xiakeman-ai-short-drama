const archiver = require('archiver');
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const RENDER_ROOT = process.env.RENDER_WORK_DIR || path.join(os.tmpdir(), 'xiakeman-render-jobs');
const MAX_UPLOAD_BYTES = Number(process.env.RENDER_MAX_UPLOAD_BYTES || 1.5 * 1024 * 1024 * 1024);
const JOB_TTL_MS = Number(process.env.RENDER_JOB_TTL_MS || 60 * 60 * 1000);
const FAILED_JOB_TTL_MS = Number(process.env.RENDER_FAILED_JOB_TTL_MS || 5 * 60 * 1000);

const jobs = new Map();

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeFileName(value, fallback = 'asset.bin') {
  const base = path.basename(String(value || fallback)).replace(/[^\w.\-()[\] ]+/g, '_');
  return base || fallback;
}

function sanitizeId(value) {
  return String(value || '').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

function roundMs(value) {
  return Math.max(0, Math.round(Number(value || 0) * 1000));
}

function escapeConcatPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function getAssetId(asset) {
  if (!asset || typeof asset !== 'object') return '';
  return String(asset.id || asset.assetId || '').trim();
}

function normalizeRenderManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('manifest must be a JSON object');
  }

  const output = input.output && typeof input.output === 'object' ? input.output : {};
  const normalized = {
    version: String(input.version || '1'),
    projectName: String(input.projectName || 'episode'),
    chapterTitle: String(input.chapterTitle || ''),
    output: {
      width: Math.round(clampNumber(output.width, 1080, 240, 3840)),
      height: Math.round(clampNumber(output.height, 1920, 240, 3840)),
      fps: Math.round(clampNumber(output.fps, 30, 12, 60)),
    },
    assets: Array.isArray(input.assets) ? input.assets.map((asset) => ({
      ...asset,
      id: getAssetId(asset),
      fileName: sanitizeFileName(asset.fileName || asset.name || `${getAssetId(asset)}.bin`),
      type: String(asset.type || 'other'),
    })).filter((asset) => asset.id) : [],
    clips: Array.isArray(input.clips) ? input.clips.map((clip, index) => ({
      ...clip,
      id: String(clip.id || `clip-${index + 1}`),
      name: String(clip.name || `Clip ${index + 1}`),
      order: Math.round(clampNumber(clip.order, index + 1, 0, 100000)),
      enabled: clip.enabled !== false,
      durationSec: clampNumber(clip.durationSec, 0, 0, 60 * 60),
      sourceStartSec: clampNumber(clip.sourceStartSec, 0, 0, 60 * 60),
      sourceEndSec: clip.sourceEndSec === undefined ? undefined : clampNumber(clip.sourceEndSec, 0, 0, 60 * 60),
      videoAssetId: String(clip.videoAssetId || ''),
      volume: clampNumber(clip.volume, 1, 0, 2),
      keepOriginalAudio: clip.keepOriginalAudio === true,
    })) : [],
    subtitles: Array.isArray(input.subtitles) ? input.subtitles.map((cue, index) => ({
      ...cue,
      id: String(cue.id || `sub-${index + 1}`),
      clipId: cue.clipId ? String(cue.clipId) : undefined,
      startSec: clampNumber(cue.startSec, 0, 0, 60 * 60),
      endSec: clampNumber(cue.endSec, 0, 0, 60 * 60),
      speaker: String(cue.speaker || ''),
      text: String(cue.text || '').trim(),
    })).filter((cue) => cue.text && cue.endSec > cue.startSec) : [],
    audioCues: Array.isArray(input.audioCues) ? input.audioCues.map((cue, index) => ({
      ...cue,
      id: String(cue.id || `audio-${index + 1}`),
      clipId: cue.clipId ? String(cue.clipId) : undefined,
      type: String(cue.type || 'tts'),
      assetId: String(cue.assetId || ''),
      startSec: clampNumber(cue.startSec, 0, 0, 60 * 60),
      endSec: cue.endSec === undefined ? undefined : clampNumber(cue.endSec, 0, 0, 60 * 60),
      volume: clampNumber(cue.volume, 1, 0, 2),
    })).filter((cue) => cue.assetId) : [],
    bgm: input.bgm && typeof input.bgm === 'object' ? {
      ...input.bgm,
      assetId: String(input.bgm.assetId || ''),
      volume: clampNumber(input.bgm.volume, 0.25, 0, 1.5),
      fadeIn: clampNumber(input.bgm.fadeIn, 1, 0, 30),
      fadeOut: clampNumber(input.bgm.fadeOut, 1, 0, 30),
      loop: input.bgm.loop !== false,
    } : undefined,
  };

  if (normalized.clips.length === 0) throw new Error('manifest.clips must contain at least one clip');
  if (normalized.clips.filter((clip) => clip.enabled).length === 0) {
    throw new Error('at least one clip must be enabled');
  }

  const assetIds = new Set(normalized.assets.map((asset) => asset.id));
  for (const clip of normalized.clips.filter((item) => item.enabled)) {
    if (!clip.videoAssetId) throw new Error(`clip ${clip.id} is missing videoAssetId`);
    if (!assetIds.has(clip.videoAssetId)) throw new Error(`clip ${clip.id} references missing asset ${clip.videoAssetId}`);
  }
  for (const cue of normalized.audioCues) {
    if (!assetIds.has(cue.assetId)) throw new Error(`audio cue ${cue.id} references missing asset ${cue.assetId}`);
  }
  if (normalized.bgm?.assetId && !assetIds.has(normalized.bgm.assetId)) {
    throw new Error(`bgm references missing asset ${normalized.bgm.assetId}`);
  }

  return normalized;
}

function formatSrtTime(seconds) {
  const totalMs = roundMs(seconds);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatAssTime(seconds) {
  const totalCs = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const hours = Math.floor(totalCs / 360000);
  const minutes = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function getSubtitleText(cue) {
  const speaker = cue.speaker ? `${cue.speaker}: ` : '';
  return `${speaker}${cue.text}`.replace(/\r?\n/g, '\n').trim();
}

function buildSrt(cues) {
  return cues
    .filter((cue) => cue.text && cue.endSec > cue.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}`,
      getSubtitleText(cue),
    ].join('\n'))
    .join('\n\n')
    .concat('\n');
}

function escapeAssText(value) {
  return String(value || '')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

function buildAss(cues, output = {}) {
  const width = Math.round(clampNumber(output.width, 1080, 240, 3840));
  const height = Math.round(clampNumber(output.height, 1920, 240, 3840));
  const fontSize = Math.max(38, Math.round(height * 0.032));
  const marginV = Math.max(90, Math.round(height * 0.09));
  const events = cues
    .filter((cue) => cue.text && cue.endSec > cue.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((cue) => `Dialogue: 0,${formatAssTime(cue.startSec)},${formatAssTime(cue.endSec)},Default,,0,0,0,,${escapeAssText(getSubtitleText(cue))}`)
    .join('\n');

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&HAA000000,&H66000000,1,0,0,0,100,100,0,0,1,5,1,2,48,48,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    events,
    '',
  ].join('\n');
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadUrl: job.status === 'done' ? `/api/render/jobs/${job.id}/download` : undefined,
  };
}

async function ensureRoot() {
  await fsp.mkdir(RENDER_ROOT, { recursive: true });
  await fsp.mkdir(path.join(RENDER_ROOT, 'incoming'), { recursive: true });
}

function runProcess(job, command, args, label) {
  if (job.status === 'cancelled') {
    return Promise.reject(new Error('Render cancelled'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    job.process = child;
    job.updatedAt = Date.now();

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
    });

    child.on('error', (error) => {
      job.process = null;
      reject(error);
    });

    child.on('close', (code, signal) => {
      job.process = null;
      if (job.status === 'cancelled') {
        reject(new Error('Render cancelled'));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
      reject(new Error(`${label} failed (${signal || code}): ${tail || 'no ffmpeg output'}`));
    });
  });
}

async function probeJson(filePath) {
  return await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function probeFile(filePath) {
  const json = await probeJson(filePath);
  const streams = Array.isArray(json.streams) ? json.streams : [];
  const duration = Number(json.format?.duration);
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : 0,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    hasVideo: streams.some((stream) => stream.codec_type === 'video'),
  };
}

async function checkBinary(command) {
  return await new Promise((resolve) => {
    const child = spawn(command, ['-version'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        version: stdout.split(/\r?\n/)[0] || stderr.split(/\r?\n/)[0] || '',
        error: code === 0 ? undefined : stderr.trim(),
      });
    });
  });
}

async function moveUploadedFiles(job, files, manifest) {
  const inputDir = path.join(job.dir, 'input');
  await fsp.mkdir(inputDir, { recursive: true });

  const byField = new Map();
  for (const file of files) byField.set(file.fieldname, file);

  const assetPaths = new Map();
  for (const asset of manifest.assets) {
    const assetId = sanitizeId(asset.id);
    const file = byField.get(`asset_${asset.id}`) || byField.get(asset.id);
    if (!file) {
      throw new Error(`missing upload for asset ${asset.id}`);
    }
    const destination = path.join(inputDir, `${assetId}-${sanitizeFileName(asset.fileName)}`);
    await fsp.rename(file.path, destination).catch(async () => {
      await fsp.copyFile(file.path, destination);
      await fsp.unlink(file.path).catch(() => {});
    });
    assetPaths.set(asset.id, destination);
  }

  for (const file of files) {
    if (fs.existsSync(file.path)) await fsp.unlink(file.path).catch(() => {});
  }

  return assetPaths;
}

async function normalizeVideos(job, manifest, assetPaths) {
  const workDir = path.join(job.dir, 'work');
  await fsp.mkdir(workDir, { recursive: true });
  const enabledClips = manifest.clips
    .filter((clip) => clip.enabled)
    .sort((a, b) => a.order - b.order);
  const clipTimings = [];
  let timelineSec = 0;

  for (let i = 0; i < enabledClips.length; i += 1) {
    const clip = enabledClips[i];
    const sourcePath = assetPaths.get(clip.videoAssetId);
    const probed = await probeFile(sourcePath);
    if (!probed.hasVideo) throw new Error(`clip ${clip.name} is not a video`);
    const sourceStartSec = Math.min(Math.max(0, clip.sourceStartSec || 0), Math.max(0, probed.durationSec - 0.1));
    const sourceEndSec = clip.sourceEndSec && clip.sourceEndSec > sourceStartSec
      ? Math.min(clip.sourceEndSec, probed.durationSec || clip.sourceEndSec)
      : undefined;
    const maxDurationSec = sourceEndSec ? sourceEndSec - sourceStartSec : Math.max(0, probed.durationSec - sourceStartSec);
    const durationSec = clip.durationSec > 0 ? Math.min(clip.durationSec, maxDurationSec || clip.durationSec) : maxDurationSec;
    if (!durationSec || durationSec <= 0) throw new Error(`clip ${clip.name} has invalid duration`);

    const normalizedPath = path.join(workDir, `clip-${String(i + 1).padStart(3, '0')}.mp4`);
    const { width, height, fps } = manifest.output;
    const videoFilter = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      'setsar=1',
      `fps=${fps}`,
      'format=yuv420p',
    ].join(',');

    job.progress = Math.round(8 + (i / Math.max(enabledClips.length, 1)) * 35);
    job.message = `Normalizing clip ${i + 1}/${enabledClips.length}`;
    job.updatedAt = Date.now();

    await runProcess(job, 'ffmpeg', [
      '-y',
      '-hide_banner',
      '-ss', String(sourceStartSec),
      '-i', sourcePath,
      '-t', String(durationSec),
      '-vf', videoFilter,
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      normalizedPath,
    ], `normalize ${clip.name}`);

    clipTimings.push({
      ...clip,
      sourcePath,
      normalizedPath,
      startSec: timelineSec,
      endSec: timelineSec + durationSec,
      durationSec,
      sourceStartSec,
      sourceEndSec: sourceStartSec + durationSec,
      sourceHasAudio: probed.hasAudio,
    });
    timelineSec += durationSec;
  }

  return { clipTimings, totalDurationSec: timelineSec };
}

async function concatVideos(job, clipTimings) {
  const workDir = path.join(job.dir, 'work');
  const concatPath = path.join(workDir, 'concat.txt');
  const silentVideoPath = path.join(workDir, 'episode-silent.mp4');
  const concatText = clipTimings
    .map((clip) => `file '${escapeConcatPath(clip.normalizedPath)}'`)
    .join('\n');
  await fsp.writeFile(concatPath, concatText, 'utf8');

  job.progress = 52;
  job.message = 'Joining clips';
  job.updatedAt = Date.now();
  await runProcess(job, 'ffmpeg', [
    '-y',
    '-hide_banner',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    silentVideoPath,
  ], 'concat videos');
  return silentVideoPath;
}

function buildAudioArgs(manifest, clipTimings, assetPaths, totalDurationSec, outputAudioPath) {
  const args = [
    '-y',
    '-hide_banner',
    '-f', 'lavfi',
    '-t', String(totalDurationSec),
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  ];
  const filters = ['[0:a]volume=0[a0]'];
  const mixLabels = ['[a0]'];
  let inputIndex = 1;
  let labelIndex = 1;

  for (const clip of clipTimings) {
    if (!clip.keepOriginalAudio || !clip.sourceHasAudio) continue;
    args.push('-i', clip.sourcePath);
    const label = `a${labelIndex++}`;
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=${clip.sourceStartSec.toFixed(3)}:${clip.sourceEndSec.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${roundMs(clip.startSec)}:all=1,volume=${clip.volume.toFixed(3)}[${label}]`,
    );
    mixLabels.push(`[${label}]`);
    inputIndex += 1;
  }

  for (const cue of manifest.audioCues) {
    const cuePath = assetPaths.get(cue.assetId);
    if (!cuePath) continue;
    args.push('-i', cuePath);
    const label = `a${labelIndex++}`;
    const trim = cue.endSec && cue.endSec > cue.startSec ? `,atrim=0:${(cue.endSec - cue.startSec).toFixed(3)}` : '';
    filters.push(
      `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo${trim},asetpts=PTS-STARTPTS,adelay=${roundMs(cue.startSec)}:all=1,volume=${cue.volume.toFixed(3)}[${label}]`,
    );
    mixLabels.push(`[${label}]`);
    inputIndex += 1;
  }

  if (manifest.bgm?.assetId) {
    const bgmPath = assetPaths.get(manifest.bgm.assetId);
    if (bgmPath) {
      if (manifest.bgm.loop) args.push('-stream_loop', '-1');
      args.push('-i', bgmPath);
      const label = `a${labelIndex++}`;
      const volume = manifest.bgm.volume.toFixed(3);
      const fadeIn = manifest.bgm.fadeIn > 0 ? `,afade=t=in:st=0:d=${manifest.bgm.fadeIn.toFixed(3)}` : '';
      const fadeStart = Math.max(0, totalDurationSec - manifest.bgm.fadeOut);
      const fadeOut = manifest.bgm.fadeOut > 0 ? `,afade=t=out:st=${fadeStart.toFixed(3)}:d=${manifest.bgm.fadeOut.toFixed(3)}` : '';
      filters.push(
        `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${totalDurationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${volume}${fadeIn}${fadeOut}[${label}]`,
      );
      mixLabels.push(`[${label}]`);
      inputIndex += 1;
    }
  }

  filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0,alimiter=limit=0.98,atrim=0:${totalDurationSec.toFixed(3)},asetpts=N/SR/TB[aout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[aout]',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputAudioPath,
  );
  return args;
}

async function renderAudio(job, manifest, clipTimings, assetPaths, totalDurationSec) {
  const outputAudioPath = path.join(job.outputDir, 'mix-audio.m4a');
  job.progress = 66;
  job.message = 'Mixing audio';
  job.updatedAt = Date.now();
  await runProcess(
    job,
    'ffmpeg',
    buildAudioArgs(manifest, clipTimings, assetPaths, totalDurationSec, outputAudioPath),
    'mix audio',
  );
  return outputAudioPath;
}

async function muxEpisode(job, silentVideoPath, audioPath) {
  const episodePath = path.join(job.outputDir, 'episode.mp4');
  job.progress = 82;
  job.message = 'Muxing episode';
  job.updatedAt = Date.now();
  await runProcess(job, 'ffmpeg', [
    '-y',
    '-hide_banner',
    '-i', silentVideoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    episodePath,
  ], 'mux episode');
  return episodePath;
}

async function writeOutputs(job, manifest, clipTimings, totalDurationSec) {
  const cuePathSrt = path.join(job.outputDir, 'episode.srt');
  const cuePathAss = path.join(job.outputDir, 'episode.ass');
  const manifestPath = path.join(job.outputDir, 'render-manifest.json');
  await fsp.writeFile(cuePathSrt, buildSrt(manifest.subtitles), 'utf8');
  await fsp.writeFile(cuePathAss, buildAss(manifest.subtitles, manifest.output), 'utf8');
  await fsp.writeFile(manifestPath, JSON.stringify({
    ...manifest,
    renderedAt: new Date().toISOString(),
    totalDurationSec,
    clips: clipTimings.map((clip) => ({
      id: clip.id,
      name: clip.name,
      order: clip.order,
      startSec: clip.startSec,
      endSec: clip.endSec,
      durationSec: clip.durationSec,
      sourceStartSec: clip.sourceStartSec,
      sourceEndSec: clip.sourceEndSec,
      keepOriginalAudio: clip.keepOriginalAudio,
      volume: clip.volume,
      videoAssetId: clip.videoAssetId,
    })),
  }, null, 2), 'utf8');
  return { cuePathSrt, cuePathAss, manifestPath };
}

async function zipOutputs(job, files) {
  const zipPath = path.join(job.dir, 'episode-render.zip');
  job.progress = 92;
  job.message = 'Packing ZIP';
  job.updatedAt = Date.now();

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.file(file.path, { name: file.name });
    }
    archive.finalize();
  });

  job.zipPath = zipPath;
  return zipPath;
}

function scheduleCleanup(job, ttlMs) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    jobs.delete(job.id);
    fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }, ttlMs);
  if (typeof job.cleanupTimer.unref === 'function') job.cleanupTimer.unref();
}

async function renderJob(job, manifest, assetPaths) {
  try {
    job.status = 'running';
    job.progress = 3;
    job.message = 'Starting render';
    job.updatedAt = Date.now();
    job.outputDir = path.join(job.dir, 'output');
    await fsp.mkdir(job.outputDir, { recursive: true });

    const { clipTimings, totalDurationSec } = await normalizeVideos(job, manifest, assetPaths);
    const silentVideoPath = await concatVideos(job, clipTimings);
    const audioPath = await renderAudio(job, manifest, clipTimings, assetPaths, totalDurationSec);
    const episodePath = await muxEpisode(job, silentVideoPath, audioPath);
    const textOutputs = await writeOutputs(job, manifest, clipTimings, totalDurationSec);

    await zipOutputs(job, [
      { path: episodePath, name: 'episode.mp4' },
      { path: textOutputs.cuePathSrt, name: 'episode.srt' },
      { path: textOutputs.cuePathAss, name: 'episode.ass' },
      { path: audioPath, name: 'mix-audio.m4a' },
      { path: textOutputs.manifestPath, name: 'render-manifest.json' },
    ]);

    job.status = 'done';
    job.progress = 100;
    job.message = 'Render complete';
    job.updatedAt = Date.now();
    scheduleCleanup(job, JOB_TTL_MS);
  } catch (error) {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.message = 'Render failed';
      job.updatedAt = Date.now();
      scheduleCleanup(job, FAILED_JOB_TTL_MS);
    }
  }
}

function createRenderRouter() {
  const router = express.Router();
  const upload = multer({
    dest: path.join(RENDER_ROOT, 'incoming'),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 500,
      fields: 20,
    },
  });

  router.get('/health', async (_req, res) => {
    const [ffmpeg, ffprobe] = await Promise.all([checkBinary('ffmpeg'), checkBinary('ffprobe')]);
    res.json({
      ok: ffmpeg.ok && ffprobe.ok,
      ffmpeg,
      ffprobe,
      renderRoot: RENDER_ROOT,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  });

  router.post('/jobs', async (req, res) => {
    await ensureRoot();
    upload.any()(req, res, async (uploadError) => {
      const files = Array.isArray(req.files) ? req.files : [];
      if (uploadError) {
        for (const file of files) await fsp.unlink(file.path).catch(() => {});
        return res.status(413).json({ error: uploadError.message || 'Upload failed' });
      }

      let manifest;
      const jobId = randomUUID();
      const jobDir = path.join(RENDER_ROOT, jobId);
      const job = {
        id: jobId,
        dir: jobDir,
        status: 'queued',
        progress: 0,
        message: 'Queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      try {
        await fsp.mkdir(jobDir, { recursive: true });
        const manifestFile = files.find((file) => file.fieldname === 'manifest' || file.originalname === 'manifest.json');
        const manifestText = manifestFile
          ? await fsp.readFile(manifestFile.path, 'utf8')
          : req.body?.manifest;
        if (!manifestText) throw new Error('missing manifest.json');
        manifest = normalizeRenderManifest(JSON.parse(manifestText));
        await fsp.writeFile(path.join(jobDir, 'submitted-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

        const mediaFiles = files.filter((file) => file !== manifestFile);
        const assetPaths = await moveUploadedFiles(job, mediaFiles, manifest);
        if (manifestFile && fs.existsSync(manifestFile.path)) await fsp.unlink(manifestFile.path).catch(() => {});

        jobs.set(jobId, job);
        res.status(202).json(publicJob(job));
        renderJob(job, manifest, assetPaths);
      } catch (error) {
        for (const file of files) {
          if (file.path && fs.existsSync(file.path)) await fsp.unlink(file.path).catch(() => {});
        }
        await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  router.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(publicJob(job));
  });

  router.get('/jobs/:id/download', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (job.status !== 'done' || !job.zipPath || !fs.existsSync(job.zipPath)) {
      return res.status(409).json({ error: 'job is not ready for download' });
    }
    res.download(job.zipPath, 'episode-render.zip');
  });

  router.delete('/jobs/:id', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    job.status = 'cancelled';
    job.progress = Math.min(job.progress || 0, 99);
    job.message = 'Cancelled';
    job.updatedAt = Date.now();
    if (job.process) {
      try { job.process.kill('SIGTERM'); } catch {}
    }
    jobs.delete(job.id);
    if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
    await fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    res.json(publicJob(job));
  });

  return router;
}

module.exports = {
  buildAss,
  buildAudioArgs,
  buildSrt,
  createRenderRouter,
  formatAssTime,
  formatSrtTime,
  renderJob,
  normalizeRenderManifest,
  probeFile,
};
