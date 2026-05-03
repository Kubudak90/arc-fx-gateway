import type { SVGProps } from "react";

const TITLE_ID = "arcora-logo-title";

/**
 * Arcora "A" symbol — designed mark with rising A-stroke, inner counter, and
 * teal settlement arc cutting through the base. Matches the canonical SVG at
 * `public/brand/arcora-logo.svg`. The arc-eats-A overlap is intentional —
 * the settlement-flow metaphor of the brand.
 */
export function ArcoraSymbol({
  size = 32, title = "Arcora", ...rest
}: { size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="52 40 320 320"
      width={size}
      height={size}
      role="img"
      aria-labelledby={TITLE_ID}
      {...rest}
    >
      <title id={TITLE_ID}>{title}</title>
      <defs>
        <linearGradient id="arcora-blue" x1="72" y1="56" x2="242" y2="242" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563FF" />
          <stop offset="1" stopColor="#165DFF" />
        </linearGradient>
        <linearGradient id="arcora-teal" x1="124" y1="244" x2="280" y2="94" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00C2A8" />
          <stop offset="1" stopColor="#21D4E6" />
        </linearGradient>
        <linearGradient id="arcora-blend" x1="85" y1="262" x2="288" y2="161" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563FF" />
          <stop offset="0.55" stopColor="#1B9BDE" />
          <stop offset="1" stopColor="#00C2A8" />
        </linearGradient>
        <filter id="arcora-shadow" x="-40" y="-20" width="380" height="380" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="14" stdDeviation="18" floodColor="#0B1426" floodOpacity="0.12" />
        </filter>
      </defs>

      <g transform="translate(56 32)" filter="url(#arcora-shadow)">
        <path d="M154 28C148 18 134 18 128 28L36 212C30 224 39 238 52 238H100C107 238 113 234 116 228L154 148L192 228C195 234 201 238 208 238H258C271 238 280 224 274 212L154 28Z" fill="url(#arcora-blue)" />
        <path d="M154 78L126 138C122 146 128 155 137 155H181C190 155 196 146 192 138L164 78C162 73 156 73 154 78Z" fill="white" fillOpacity="0.98" />
        <path d="M72 238C104 191 145 166 196 166C228 166 253 174 278 190C287 196 289 209 282 217L257 247C251 254 240 256 232 251C218 243 201 238 181 238C142 238 108 256 82 292C76 300 64 302 56 296L21 270C12 263 11 250 18 241C33 221 49 203 67 188C77 180 91 187 91 200V219C91 226 87 233 82 238H72Z" fill="url(#arcora-teal)" />
        <path d="M86 220C122 184 163 167 210 170C233 172 252 178 271 190" stroke="white" strokeWidth="13" strokeLinecap="round" opacity="0.92" />
        <circle cx="273" cy="194" r="15" fill="url(#arcora-blend)" />
        <circle cx="273" cy="194" r="6" fill="white" fillOpacity="0.92" />
      </g>
    </svg>
  );
}

interface ArcoraLogoProps {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
}

/**
 * Full Arcora logo lockup: symbol + wordmark, optional tagline.
 * Use `showTagline` in hero / footer surfaces; leave it off in headers.
 */
export function ArcoraLogo({
  size = 32,
  showWordmark = true,
  showTagline = false,
  className,
}: ArcoraLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <ArcoraSymbol size={size} />
      {showWordmark && (
        <span className="inline-flex flex-col leading-none">
          <span
            className="font-[family-name:var(--font-display)] font-bold tracking-tight text-arcora-slate"
            style={{ fontSize: size * 0.78, letterSpacing: "-0.02em" }}
          >
            Arcora
          </span>
          {showTagline && (
            <span
              className="font-[family-name:var(--font-mono)] uppercase text-muted-foreground mt-1"
              style={{ fontSize: size * 0.22, letterSpacing: "0.18em" }}
            >
              Stablecoin checkout &amp; settlement
            </span>
          )}
        </span>
      )}
    </span>
  );
}
