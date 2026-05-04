import type { SVGProps } from "react";
import { useId } from "react";

/**
 * Arcora "A" symbol — A-stroke with cut-out counter and a teal settlement
 * arc that exits through a gradient dot. Matches the canonical SVG at
 * `public/brand/arcora-logo.svg`. Updated 2026-05-04.
 *
 * Gradient ids are scoped via useId() so multiple instances in the same DOM
 * (e.g. header + footer + hero) don't collide on `url(#arcora-blue)`.
 */
export function ArcoraSymbol({
  size = 32, title = "Arcora", ...rest
}: { size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  const uid       = useId();
  const titleId   = `${uid}-title`;
  const gBlue     = `${uid}-blue`;
  const gTeal     = `${uid}-teal`;
  const gDot      = `${uid}-dot`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 285 279"
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      {...rest}
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={gBlue} x1="59" y1="35.5" x2="229" y2="221.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563FF" />
          <stop offset="1" stopColor="#165DFF" />
        </linearGradient>
        <linearGradient id={gTeal} x1="115.538" y1="223.214" x2="271.082" y2="66.3927" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00C2A8" />
          <stop offset="1" stopColor="#21D4E6" />
        </linearGradient>
        <linearGradient id={gDot} x1="82" y1="245.5" x2="285" y2="144.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563FF" />
          <stop offset="0.55" stopColor="#1B9BDE" />
          <stop offset="1" stopColor="#00C2A8" />
        </linearGradient>
      </defs>
      <path d="M141 7.5C135 -2.5 121 -2.5 115 7.5L23 191.5C17 203.5 26 217.5 39 217.5H87C94 217.5 100 213.5 103 207.5L141 127.5L179 207.5C182 213.5 188 217.5 195 217.5H245C258 217.5 267 203.5 261 191.5L141 7.5Z" fill={`url(#${gBlue})`} />
      <path d="M143.263 80.25L115.263 140.25C111.263 148.25 117.263 157.25 126.263 157.25H170.263C179.263 157.25 185.263 148.25 181.263 140.25L153.263 80.25C151.263 75.25 145.263 75.25 143.263 80.25Z" fill="white" fillOpacity="0.98" />
      <path d="M61.2135 217.236C94.6442 170.408 137.477 145.5 190.757 145.5C224.188 145.5 250.306 153.471 276.424 169.412C285.826 175.39 287.915 188.343 280.602 196.313L254.485 226.203C248.216 233.178 236.725 235.171 228.367 230.189C213.741 222.218 195.981 217.236 175.087 217.236C134.343 217.236 98.823 235.171 71.6606 271.039C65.3923 279.009 52.8558 281.002 44.4981 275.024L7.93326 249.119C-1.46912 242.145 -2.51383 229.193 4.79914 220.225C20.4698 200.299 37.1851 182.365 55.9899 167.419C66.437 159.449 81.0629 166.423 81.0629 179.376V198.306C81.0629 205.28 76.8841 212.255 71.6606 217.236H61.2135Z" fill={`url(#${gTeal})`} />
      <path opacity="0.92" d="M73 199.5C109.973 163.742 152.081 146.856 200.351 149.836C223.973 151.822 243.486 157.782 263 169.701" stroke="white" strokeWidth="13" strokeLinecap="round" />
      <path d="M270 192.5C278.284 192.5 285 185.784 285 177.5C285 169.216 278.284 162.5 270 162.5C261.716 162.5 255 169.216 255 177.5C255 185.784 261.716 192.5 270 192.5Z" fill={`url(#${gDot})`} />
      <path d="M270 183.5C273.314 183.5 276 180.814 276 177.5C276 174.186 273.314 171.5 270 171.5C266.686 171.5 264 174.186 264 177.5C264 180.814 266.686 183.5 270 183.5Z" fill="white" fillOpacity="0.92" />
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
