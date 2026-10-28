import { useState } from "react";

export function CopyButton({ value, label = "Copy", className = "btn-ghost px-3 py-1.5 text-sm" }: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      aria-label={label === "Copy" ? undefined : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
