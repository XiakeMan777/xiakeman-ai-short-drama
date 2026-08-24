export type LocalMediaFile = {
  id: string;
  file: File;
  url: string;
  label: string;
};

export function createLocalMediaFiles(files: FileList | File[], prefix = 'reference'): LocalMediaFile[] {
  return Array.from(files).map((file, index) => ({
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    url: URL.createObjectURL(file),
    label: `${prefix}${index + 1}`,
  }));
}

export function revokeLocalMediaFiles(files: LocalMediaFile[]) {
  files.forEach((file) => URL.revokeObjectURL(file.url));
}

export function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
