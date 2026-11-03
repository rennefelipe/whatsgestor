"use client";

import {
  Children,
  isValidElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((part) =>
      typeof part === "string" || typeof part === "number"
        ? String(part)
        : isValidElement<{ children?: ReactNode }>(part)
          ? optionText(part.props.children)
          : "",
    )
    .join("");
}
function options(node: ReactNode): { value: string; label: string }[] {
  return Children.toArray(node).flatMap((part) => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(part))
      return [];
    return part.type === "option"
      ? [
          {
            value: String(part.props.value ?? ""),
            label: optionText(part.props.children),
          },
        ]
      : options(part.props.children);
  });
}

// Keep the native select's keyboard, labels and mobile picker. Its visible value
// is a wrapping overlay instead of a clipped single line; never tooltip-only.
export function FullTextSelect({
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const choices = options(children);
  const value = String(
    props.value ?? props.defaultValue ?? choices[0]?.value ?? "",
  );
  const label =
    choices.find((choice) => choice.value === value)?.label ?? value;
  return (
    <span
      className={`full-text-select ${className}`}
      data-disabled={props.disabled || undefined}
    >
      <span className="full-text-select-value" aria-hidden="true">
        {label}
        <span className="full-text-select-arrow">⌄</span>
      </span>
      <select {...props}>{children}</select>
    </span>
  );
}
