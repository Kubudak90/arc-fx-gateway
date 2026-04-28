import type { SVGProps } from "react";

const TITLE_ID = "arcora-logo-title";

/**
 * Arcora "A" symbol — blue triangular A with a teal arch sweep underneath.
 * Recreated from the brand sheet PNG; treat positions as approximations.
 */
export function ArcoraSymbol({
  size = 32, title = "Arcora", ...rest
}: { size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-labelledby={TITLE_ID}
      {...rest}
    >
      <title id={TITLE_ID}>{title}</title>
      <defs>
        <linearGradient id="arcora-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#3D7CFF" />
          <stop offset="100%" stopColor="#2563FF" />
        </linearGradient>
        <linearGradient id="arcora-teal" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"  stopColor="#00C2A8" />
          <stop offset="100%" stopColor="#34D5BF" />
        </linearGradient>
      </defs>

      {/* A outline */}
      <path
        d="M32 6 L60 58 L48 58 L40 42 L24 42 L16 58 L4 58 Z M28 32 L36 32 L32 22 Z"
        fill="url(#arcora-blue)"
        fillRule="evenodd"
      />

      {/* Teal arch — sweeps up between the legs of the A and tucks behind the right one */}
      <path
        d="M12 58 Q32 22 56 56 Q42 50 32 48 Q22 50 12 58 Z"
        fill="url(#arcora-teal)"
      />
    </svg>
  );
}

export function ArcoraLogo({
  size = 32,
  showWordmark = true,
  className,
}: { size?: number; showWordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <ArcoraSymbol size={size} />
      {showWordmark && (
        <span
          className="font-[family-name:var(--font-display)] font-semibold tracking-tight text-arcora-slate"
          style={{ fontSize: size * 0.72 }}
        >
          Arcora
        </span>
      )}
    </span>
  );
}
