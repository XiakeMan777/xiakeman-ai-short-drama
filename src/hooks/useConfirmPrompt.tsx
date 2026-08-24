// ============================================================
// 确认对话框 Hook - 替代原生 confirm()
// ============================================================

import React, { useState, useCallback, useRef } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * 用法：
 * const { confirm, ConfirmDialog } = useConfirm();
 * const ok = await confirm('确定删除？');
 * // 在 JSX 中渲染 <ConfirmDialog />
 */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  const resolvedRef = useRef(false);

  const confirm = useCallback((message: string, title = '确认操作') => {
    return new Promise<boolean>((resolve) => {
      resolvedRef.current = false;
      setState({ open: true, title, description: message, resolve });
    });
  }, []);

  const handleAction = useCallback(() => {
    resolvedRef.current = true;
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    resolvedRef.current = true;
    state?.resolve(false);
    setState(null);
  }, [state]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !resolvedRef.current) {
      state?.resolve(false);
      setState(null);
    }
  }, [state]);

  const ConfirmDialog = (
    <AlertDialog open={!!state?.open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title ?? '确认'}</AlertDialogTitle>
          <AlertDialogDescription>
            {state?.description || '请确认是否继续执行该操作。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>取消</AlertDialogCancel>
          <Button onClick={handleAction}>确定</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, ConfirmDialog };
}

/**
 * 用法：
 * const { prompt, PromptDialog } = usePrompt();
 * const name = await prompt('输入名称：', '默认值');
 * // 在 JSX 中渲染 <PromptDialog />
 */
export function usePrompt() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    placeholder: string;
    defaultValue: string;
    resolve: (value: string | null) => void;
  } | null>(null);

  const [inputValue, setInputValue] = useState('');
  // 标志位：区分"用户主动关闭"和"提交后关闭"
  const resolvedRef = useRef(false);

  const prompt = useCallback((message: string, defaultValue = '') => {
    return new Promise<string | null>((resolve) => {
      resolvedRef.current = false;
      setState({ open: true, title: message, placeholder: '', defaultValue, resolve });
      setInputValue(defaultValue);
    });
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    resolvedRef.current = true;
    const val = inputValue.trim();
    state?.resolve(val || null);
    setState(null);
  }, [inputValue, state]);

  const handleCancel = useCallback(() => {
    resolvedRef.current = true;
    state?.resolve(null);
    setState(null);
  }, [state]);

  // onOpenChange: 仅在非提交/取消的情况下（如点遮罩层关闭）触发
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !resolvedRef.current) {
      state?.resolve(null);
      setState(null);
    }
  }, [state]);

  const PromptDialog = (
    <AlertDialog open={!!state?.open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title ?? '输入'}</AlertDialogTitle>
            <AlertDialogDescription>
              输入名称后点击确定；不想修改时可以取消或关闭窗口。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={state?.placeholder}
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button" onClick={handleCancel}>取消</AlertDialogCancel>
            <Button type="submit">确定</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { prompt, PromptDialog };
}
