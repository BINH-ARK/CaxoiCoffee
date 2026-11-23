import React from "react";

interface WatermarkPatternProps {
  /** Unique SVG pattern ID per instance so multiple watermarks on a page never collide. */
  patternId: string;
  text: string;
  color: string;
  opacity?: number;
  tileWidth?: number;
  tileHeight?: number;
  fontSize?: number;
  letterSpacing?: string;
  fontFamily?: string;
  /** Enable smooth infinite diagonal drift animation (default: true). */
  animate?: boolean;
  /** Duration in seconds for one exact tile cycle (default: 16s). */
  durationSeconds?: number;
}

/**
 * Renders a seamlessly tiled SVG text watermark covering 100% of its parent container
 * regardless of viewport width or height, with smooth GPU-accelerated infinite drift.
 */
export default function WatermarkPattern({
  patternId,
  text,
  color,
  opacity = 0.05,
  tileWidth = 180,
  tileHeight = 72,
  fontSize = 22,
  letterSpacing = "0.08em",
  fontFamily = "inherit",
  animate = true,
  durationSeconds = 16,
}: WatermarkPatternProps) {
  const halfW = tileWidth / 2;
  const row1Y = Math.round(tileHeight * 0.36);
  const row2Y = Math.round(tileHeight * 0.86);

  const svgStyle: React.CSSProperties & {
    "--wm-dx"?: string;
    "--wm-dy"?: string;
    "--wm-duration"?: string;
  } = {
    opacity,
    top: animate ? `-${tileHeight}px` : 0,
    left: animate ? `-${tileWidth}px` : 0,
    width: animate ? `calc(100% + ${tileWidth * 2}px)` : "100%",
    height: animate ? `calc(100% + ${tileHeight * 2}px)` : "100%",
    "--wm-dx": `-${tileWidth}px`,
    "--wm-dy": `-${tileHeight}px`,
    "--wm-duration": `${durationSeconds}s`,
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none select-none"
      aria-hidden="true"
    >
      <svg
        className={`absolute ${animate ? "animate-watermark-drift" : ""}`}
        style={svgStyle}
      >
        <defs>
          <pattern
            id={patternId}
            width={tileWidth}
            height={tileHeight}
            patternUnits="userSpaceOnUse"
          >
            <text
              x={halfW}
              y={row1Y}
              textAnchor="middle"
              fill={color}
              fontSize={fontSize}
              fontWeight="900"
              letterSpacing={letterSpacing}
              style={{ fontFamily }}
            >
              {text}
            </text>
            {/* Split second row across tile edges for staggered brick alignment without clipping */}
            <text
              x={0}
              y={row2Y}
              textAnchor="middle"
              fill={color}
              fontSize={fontSize}
              fontWeight="900"
              letterSpacing={letterSpacing}
              style={{ fontFamily }}
            >
              {text}
            </text>
            <text
              x={tileWidth}
              y={row2Y}
              textAnchor="middle"
              fill={color}
              fontSize={fontSize}
              fontWeight="900"
              letterSpacing={letterSpacing}
              style={{ fontFamily }}
            >
              {text}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
