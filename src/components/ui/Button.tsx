import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          {
            "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-500/20 active:scale-[0.98]":
              variant === "primary",
            "bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-[0.98]":
              variant === "secondary",
            "bg-red-500 hover:bg-red-600 text-white shadow-sm shadow-red-500/20 active:scale-[0.98]":
              variant === "danger",
            "bg-transparent hover:bg-gray-100 text-gray-500":
              variant === "ghost",
          },
          {
            "text-[13px] px-3.5 py-2 min-h-[36px]": size === "sm",
            "text-[14px] px-4 py-2.5 min-h-[44px]": size === "md",
            "text-[15px] px-5 py-3 min-h-[50px]": size === "lg",
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
