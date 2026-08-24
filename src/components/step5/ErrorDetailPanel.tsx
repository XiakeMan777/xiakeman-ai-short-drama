// ============================================================
// Step5: 错误详情面板子组件
// ============================================================

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check } from '@/components/icons';
import type { StoryboardState } from '@/types';

function CopyButton({
  text,
  fieldName,
  copied,
  onCopy,
}: {
  text: string;
  fieldName: string;
  copied: boolean;
  onCopy: (text: string, fieldName: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(text, fieldName);
      }}
      className="ml-1 text-red-400 hover:text-red-600 transition-colors inline-flex items-center"
      title="复制"
    >
      {copied ? (
        <Check className="h-3 w-3" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

export function ErrorDetailPanel({
  error,
  detail,
}: {
  error: string;
  detail: StoryboardState['videoErrorDetail'];
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // 剪贴板 API 失败，静默处理
    }
  };

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1">{error}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-red-400 hover:text-red-600 transition-colors"
          title="展开详情"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {expanded && detail && (
        <div className="mt-2 space-y-1.5 rounded border border-red-200 bg-white/60 p-2 text-[11px] text-red-800 font-mono">
          {detail.backend && (
            <div>
              <span className="text-red-500 font-sans font-medium">后端：</span>{detail.backend}
            </div>
          )}
          {detail.taskId && (
            <div className="flex items-center">
              <span className="text-red-500 font-sans font-medium">Task ID：</span>
              <span className="truncate flex-1">{detail.taskId}</span>
              <CopyButton text={detail.taskId} fieldName="taskId" copied={copiedField === 'taskId'} onCopy={copyToClipboard} />
            </div>
          )}
          {detail.httpStatus && (
            <div>
              <span className="text-red-500 font-sans font-medium">HTTP 状态：</span>{detail.httpStatus}
            </div>
          )}
          {detail.errorCode && (
            <div>
              <span className="text-red-500 font-sans font-medium">错误码：</span>{detail.errorCode}
            </div>
          )}
          {detail.volcCode && (
            <div>
              <span className="text-red-500 font-sans font-medium">业务码：</span>{detail.volcCode}
            </div>
          )}
          {detail.volcMessage && detail.volcMessage !== error && (
            <div>
              <span className="text-red-500 font-sans font-medium">官方消息：</span>
              <pre className="whitespace-pre-wrap mt-0.5 max-h-[80px] overflow-y-auto text-[10px]">{detail.volcMessage}</pre>
            </div>
          )}
          {detail.errorMsg && detail.errorMsg !== detail.volcMessage && (
            <div>
              <span className="text-red-500 font-sans font-medium">错误描述：</span>
              <pre className="whitespace-pre-wrap mt-0.5 max-h-[80px] overflow-y-auto text-[10px]">{detail.errorMsg}</pre>
            </div>
          )}
          {detail.volcRequestId && (
            <div className="flex items-center">
              <span className="text-red-500 font-sans font-medium">请求 ID：</span>
              <span className="truncate flex-1 text-[10px]">{detail.volcRequestId}</span>
              <CopyButton text={detail.volcRequestId} fieldName="volcRequestId" copied={copiedField === 'volcRequestId'} onCopy={copyToClipboard} />
            </div>
          )}
          {detail.aliyunRequestId && (
            <div className="flex items-center">
              <span className="text-red-500 font-sans font-medium">请求 ID：</span>
              <span className="truncate flex-1 text-[10px]">{detail.aliyunRequestId}</span>
              <CopyButton text={detail.aliyunRequestId} fieldName="aliyunRequestId" copied={copiedField === 'aliyunRequestId'} onCopy={copyToClipboard} />
            </div>
          )}
          {detail.submittedAt && (
            <div>
              <span className="text-red-500 font-sans font-medium">提交时间：</span>{new Date(detail.submittedAt).toLocaleString()}
            </div>
          )}
          {detail.prompt && (
            <div>
              <span className="text-red-500 font-sans font-medium">提示词：</span>
              <pre className="whitespace-pre-wrap mt-0.5 max-h-[80px] overflow-y-auto text-[10px]">{detail.prompt}…</pre>
            </div>
          )}
          {detail.rawError && detail.rawError !== error && detail.rawError !== detail.volcMessage && (
            <div>
              <span className="text-red-500 font-sans font-medium">原始错误：</span>
              <pre className="whitespace-pre-wrap mt-0.5 max-h-[80px] overflow-y-auto text-[10px]">{detail.rawError}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
