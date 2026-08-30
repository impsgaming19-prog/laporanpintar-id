import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium text-gray-600">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
          )}
          <input
            ref={ref}
            className={cn(
              "w-full rounded-xl bg-gray-50 border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-all",
              "focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500",
              "hover:border-gray-300",
              icon && "pl-10",
              error && "border-red-300 focus:ring-red-500/30",
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
