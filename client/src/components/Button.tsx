import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold leading-none no-underline " +
  "transition-colors active:translate-y-px disabled:cursor-default disabled:opacity-50 disabled:active:translate-y-0";

const variants: Record<Variant, string> = {
  primary: "border-transparent bg-brand text-brand-ink [&:not(:disabled)]:hover:bg-brand-strong",
  secondary: "border-line bg-surface text-ink [&:not(:disabled)]:hover:bg-surface-2",
  ghost: "border-line bg-transparent text-ink [&:not(:disabled)]:hover:bg-surface-2",
  danger: "border-line bg-transparent text-fail [&:not(:disabled)]:hover:bg-surface-2",
};

const sizes: Record<Size, string> = {
  md: "rounded-[10px] px-4 py-[11px] text-sm",
  sm: "rounded-lg px-[11px] py-2 text-[13px]",
};

/** The class names for a button; also used for links that look like buttons. */
export function buttonClass(variant: Variant = "primary", size: Size = "md") {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}
