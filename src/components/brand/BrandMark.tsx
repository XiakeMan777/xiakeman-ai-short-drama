import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  size?: number;
  alt?: string;
}

export function BrandMark({
  className,
  size = 40,
  alt = '虾客漫 Logo',
}: BrandMarkProps) {
  return (
    <img
      src="/brand/xiakeman-logo-tight.png"
      alt={alt}
      width={size}
      height={size}
      className={cn('select-none object-contain', className)}
      draggable={false}
    />
  );
}
