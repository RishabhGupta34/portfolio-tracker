import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function Modal({ isOpen, onClose, title, children, className, size = 'default' }) {
  // Lock body scroll while the modal is open. iOS WKWebView misaligns
  // fixed-positioned overlays when the page underneath has scrolled.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    default: 'max-w-lg',
    large: 'max-w-4xl',
    small: 'max-w-md'
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          // Absolutely positioned card — hardcoded top offset avoids iOS
          // WKWebView quirks with flex centering of fixed elements.
          "absolute left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] z-50 bg-background/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 p-6 overflow-y-auto",
          sizeClasses[size],
          className
        )}
        style={{
          top: '6rem',
          maxHeight: 'calc(100dvh - 8rem)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
