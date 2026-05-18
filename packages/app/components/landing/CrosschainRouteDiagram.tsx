"use client";

import { useEffect, useState } from "react";

/**
 * Forward-looking visualization of the v2.0 crosschain settlement: customer pays
 * USDC from any CCTP-supported source chain → bridges to Arc → Arcora swaps to
 * the merchant's preferred stable. Pure illustration; nothing here claims to be
 * live. The label on the surrounding card says "v2.0 · in design" so the
 * animation can't be misread as production reality.
 */

const SOURCES = [
  { code: "ETH",  label: "Ethereum",  y: 60  },
  { code: "BASE", label: "Base",      y: 130 },
  { code: "ARB",  label: "Arbitrum",  y: 200 },
  { code: "POL",  label: "Polygon",   y: 270 },
] as const;

const ARC_X = 540;
const SETTLE_X = 760;

export function CrosschainRouteDiagram() {
  const [activeStep, setActiveStep] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveStep(s => (s + 1) % SOURCES.length);
      setTick(t => t + 1);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full mx-auto" style={{ aspectRatio: "880 / 360", maxWidth: 880 }} role="img" aria-label="Crosschain route diagram: source chains (Ethereum, Base, Arbitrum, Polygon) connecting through Arc AMM hub to a settlement node">
      <svg viewBox="0 0 880 360" className="w-full h-full" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="ax-line-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#2563ff" stopOpacity="0" />
            <stop offset="50%"  stopColor="#2563ff" stopOpacity="1" />
            <stop offset="100%" stopColor="#2563ff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="ax-hub-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%"   stopColor="#00c2a8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#00c2a8" stopOpacity="0" />
          </radialGradient>
          <filter id="ax-soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* Grid backdrop (light) */}
        <g opacity="0.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={50 + i * 45} x2="880" y2={50 + i * 45}
              stroke="rgba(11,20,38,0.08)" strokeWidth="0.5" strokeDasharray="2 4" />
          ))}
        </g>

        {/* Source → Arc curves: end at the hub edge (ARC_X − 38) so the line
            doesn't disappear under the hub fill. Use pathLength=100 so the dash
            math is independent of the curve's actual arc length. */}
        {SOURCES.map((s, i) => {
          const isActive = i === activeStep;
          const yMid = 165;
          const arcEdge = ARC_X - 40;
          const dx = arcEdge - 110;
          const path = `M 110 ${s.y} C ${110 + dx * 0.5} ${s.y}, ${arcEdge - dx * 0.5} ${yMid}, ${arcEdge} ${yMid}`;
          return (
            <g key={s.code}>
              <path d={path} stroke="rgba(11,20,38,0.16)" strokeWidth="1" fill="none" />
              {isActive && (
                <path
                  key={tick + "-" + i}
                  d={path}
                  pathLength={100}
                  stroke="url(#ax-line-grad)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray="20 100"
                  style={{ animation: "ax-flow 1.6s ease-out forwards" }}
                />
              )}
            </g>
          );
        })}

        {/* Arc → Settlement: solid teal connector that always reads end-to-end,
            with a short pulse traveling on top for the "in flight" feel. The
            line ends at the LEFT EDGE of the settle rect (x = SETTLE_X − 30),
            not the box center, so nothing is hidden under the rect fill. */}
        <line x1={ARC_X + 40} y1="165" x2={SETTLE_X - 30} y2="165"
          stroke="#00c2a8" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        <line
          key={"out-" + tick}
          x1={ARC_X + 40} y1="165" x2={SETTLE_X - 30} y2="165"
          pathLength={100}
          stroke="#00c2a8"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="18 100"
          style={{ animation: "ax-flow 1.6s 0.4s ease-out forwards" }}
        />

        {/* Source nodes */}
        {SOURCES.map((s, i) => {
          const isActive = i === activeStep;
          return (
            <g key={s.code} transform={`translate(60, ${s.y})`}>
              <circle r="22" fill="#ffffff"
                stroke={isActive ? "#2563ff" : "rgba(11,20,38,0.16)"} strokeWidth="1.5" />
              <text x="0" y="4" textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="9.5" fontWeight="600"
                fill={isActive ? "#2563ff" : "#5b6478"}>
                {s.code}
              </text>
              <text x="50" y="4" textAnchor="start"
                fontFamily="var(--font-sans)" fontSize="11.5" fontWeight="500"
                fill={isActive ? "#0b1426" : "#5b6478"}>
                {s.label}
              </text>
            </g>
          );
        })}

        {/* Arc hub */}
        <circle cx={ARC_X} cy="165" r="80" fill="url(#ax-hub-glow)" />
        <circle cx={ARC_X} cy="165" r="38" fill="#ffffff" stroke="#00c2a8" strokeWidth="1.5" />
        <circle cx={ARC_X} cy="165" r="38" fill="none" stroke="#00c2a8" strokeWidth="1" opacity="0.4" filter="url(#ax-soft-glow)" />
        <text x={ARC_X} y="160" textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="9" fontWeight="600"
          fill="#5b6478" letterSpacing="2">ARC</text>
        <text x={ARC_X} y="178" textAnchor="middle"
          fontFamily="var(--font-display)" fontSize="14" fontWeight="600"
          fill="#0b1426">AMM</text>

        {/* Pulsing ring */}
        <circle cx={ARC_X} cy="165" r="50"
          fill="none" stroke="#00c2a8" strokeWidth="1" opacity="0.35"
          style={{ transformOrigin: `${ARC_X}px 165px`, animation: "ax-pulse-ring 2s ease-out infinite" }} />

        {/* Settlement node */}
        <g transform={`translate(${SETTLE_X}, 165)`}>
          <rect x="-32" y="-30" width="124" height="60" rx="10"
            fill="#ffffff" stroke="rgba(11,20,38,0.16)" strokeWidth="1" />
          <text x="30" y="-8" textAnchor="middle"
            fontFamily="var(--font-mono)" fontSize="9" fill="#5b6478" letterSpacing="1.5">SETTLE</text>
          <text x="30" y="14" textAnchor="middle"
            fontFamily="var(--font-display)" fontSize="14" fontWeight="600" fill="#0b1426">USDC · EURC</text>
        </g>

        {/* Labels */}
        <text x="60" y="30" textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="10" fill="#5b6478" letterSpacing="1.5">CUSTOMER</text>
        <text x={SETTLE_X + 30} y="120" textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="10" fill="#5b6478" letterSpacing="1.5">MERCHANT</text>
      </svg>

      <style>{`
        /* With pathLength=100 + dasharray="20 100", a 20-unit pulse rides the
           full path. Animate offset from 120 (entirely before start) to -20
           (entirely past end) so the segment cleanly enters and exits. */
        @keyframes ax-flow {
          0%   { stroke-dashoffset: 120; }
          100% { stroke-dashoffset: -20; }
        }
        @keyframes ax-pulse-ring {
          0%   { r: 38; opacity: 0.6; }
          100% { r: 70; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
