import { MessageCircle } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import communityGroupImage from '@/assets/community-group.jpg';

interface CommunityGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommunityGroupDialog({ open, onOpenChange }: CommunityGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-br from-brand-orange/10 via-background to-background px-5 pb-4 pt-5 text-left">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-orange/12 text-brand-orange ring-1 ring-brand-orange/20">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg">虾客漫交流群</DialogTitle>
              <DialogDescription className="mt-1">
                交流使用经验、反馈问题，也欢迎一起完善社区版。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 p-4 sm:p-5">
          <div
            className="relative overflow-hidden rounded-2xl border border-border/70 bg-white shadow-sm"
            style={{ aspectRatio: '1.16 / 1' }}
          >
            <img
              src={communityGroupImage}
              alt="虾客漫 BUG 反馈交流群微信二维码"
              className="absolute inset-x-0 top-0 block w-full -translate-y-[22%]"
            />
          </div>
          <p className="text-center text-sm font-medium text-foreground">使用微信扫码加入交流群</p>
          <p className="rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-center text-xs leading-relaxed text-amber-900 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
            当前二维码图片标注为 8 月 30 日前有效；如果失效，请等待维护者更新二维码。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
