/**
 * Draws pixel art from rows of characters. "." is empty; any other character
 * is looked up in `palette`. Decorative by default (hidden from screen readers).
 */

interface PixelIconProps {
  rows: readonly string[];
  palette: Record<string, string>;
  /** Rendered width in CSS pixels. Height follows the grid's proportions. */
  size?: number;
  label?: string;
  className?: string;
}

export function PixelIcon({ rows, palette, size = 48, label, className }: PixelIconProps) {
  const width = Math.max(...rows.map((row) => row.length));
  const height = rows.length;
  const cells: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const fill = palette[char];
      if (fill) cells.push({ x, y, fill });
    });
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={(size * height) / width}
      shapeRendering="crispEdges"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells.map((cell) => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} fill={cell.fill} />
      ))}
    </svg>
  );
}

/** The app's mark: a magnifying glass over a checked line of spec. */
export const INSPECTOR_ROWS = [
  "...RRRRR......",
  "..R.....R.....",
  ".R..WWW..R....",
  ".R.......R....",
  ".R..WW...R....",
  ".R.......R....",
  "..R.....R.....",
  "...RRRRRYY....",
  ".........YY...",
  "..........YY..",
  "...........YY.",
  "............Y.",
] as const;

export const INSPECTOR_PALETTE = { R: "#e5333d", W: "#f2f2f2", Y: "#f5c542" } as const;
