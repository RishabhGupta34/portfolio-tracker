import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const DateInput = forwardRef(({ className, ...props }, ref) => {
  return (
    <input
      type="date"
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        "cursor-pointer",
        "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
        "[&::-webkit-calendar-picker-indicator]:opacity-60",
        "[&::-webkit-calendar-picker-indicator]:hover:opacity-100",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

DateInput.displayName = "DateInput";

export { DateInput };
