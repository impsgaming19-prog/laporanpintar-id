import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/AppContext";

interface CardProps extends HTMLAttributes<HTMLDivElement> {}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark" || theme === "blue" || theme === "green";

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl border shadow-sm p-5 transition-colors duration-300",
          isDark
            ? "bg-[#1e293b] border-white/10"
            : "bg-white border-gray-100",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("mb-3", className)} {...props}>
      {children}
    </div>
  )
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark" || theme === "blue" || theme === "green";
    return (
      <h3 ref={ref} className={cn("text-base font-semibold", isDark ? "text-white" : "text-gray-900", className)} {...props}>
        {children}
      </h3>
    );
  }
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => (
    <p ref={ref} className={cn("text-xs text-gray-400", className)} {...props}>
      {children}
    </p>
  )
);
CardDescription.displayName = "CardDescription";

export default Card;
