import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function Modal({ isOpen, onClose, title, children, className, size = 'default' }) {
  if (!isOpen) return null;

  const sizeClasses = {
    default: 'max-w-lg',
    large: 'max-w-4xl',
    small: 'max-w-md'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose}
      />
      <div className={cn(
        "relative z-50 w-full bg-background/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 p-6 m-4 max-h-[90vh] overflow-y-auto",
        sizeClasses[size],
        className
      )}>
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
