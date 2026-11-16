// The view from the Midas flat: a made-up Gulf city at night, seen past the blinds. Three rows of
// towers fade into a gold haze; the near ones have gold-lit windows, whole office floors still
// working late, gold crown lights on the tallest roofs and red aviation beacons. Drawn once from a
// fixed seed, so the city looks the same on every visit.

const W = 1600;
const H = 560;

// Small seeded random generator (mulberry32): same numbers, same skyline, every load.
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPES = ["box", "box", "step", "taper", "slant", "spire"];

function buildRow(rand, { minH, maxH, minW, maxW, gap, tallChance }) {
  const towers = [];
  for (let x = -30; x < W + 30; ) {
    const tall = rand() < tallChance;
    const w = tall ? minW + rand() * (maxW - minW) * 0.5 : minW + rand() * (maxW - minW);
    const h = tall ? maxH * (0.8 + rand() * 0.2) : minH + rand() * (maxH - minH) * 0.55;
    const shape = tall ? ["spire", "taper", "slant", "spire"][Math.floor(rand() * 4)] : SHAPES[Math.floor(rand() * SHAPES.length)];
    towers.push({ x, w, h, shape, tall });
    x += w * (0.55 + rand() * 0.5) + gap * rand();
  }
  // Short towers first, so the tall ones are drawn in front of them.
  return towers.sort((a, b) => a.h - b.h);
}

// The roofline of a tower, and the highest point (for beacons).
function towerShape({ x, w, h, shape }) {
  const top = H - h;
  const r = x + w;
  const mid = x + w / 2;
  switch (shape) {
    case "step": {
      const i = w * 0.2;
      const s = top + Math.min(40, h * 0.12);
      return { d: `M${x} ${H}V${s}H${x + i}V${top}H${r - i}V${s}H${r}V${H}Z`, peak: [mid, top], sides: [s, s] };
    }
    case "taper": {
      const i = w * 0.3;
      return { d: `M${x} ${H}V${top + 60}L${x + i} ${top}H${r - i}L${r} ${top + 60}V${H}Z`, peak: [mid, top], sides: [top + 60, top + 60] };
    }
    case "slant":
      return { d: `M${x} ${H}V${top + 46}L${r} ${top}V${H}Z`, peak: [r - 3, top], sides: [top + 46, top] };
    case "spire":
      return { d: `M${x} ${H}V${top + 30}L${mid - 3} ${top - 10}V${top - 60}H${mid + 3}V${top - 10}L${r} ${top + 30}V${H}Z`, peak: [mid, top - 60], sides: [top + 30, top + 30] };
    default:
      return { d: `M${x} ${H}V${top}H${r}V${H}Z`, peak: [mid, top], sides: [top, top] };
  }
}

// Windows on a 9×14 grid. Now and then a whole floor is lit: someone's working late.
function windowsFor(rand, t, { lit, gold, floors }) {
  const out = [];
  const cols = Math.max(2, Math.floor((t.w - 10) / 9));
  const left = t.x + (t.w - cols * 9) / 2 + 3;
  const start = H - t.h + (t.shape === "box" || t.shape === "step" ? 18 : 64);
  for (let y = start; y < H - 8; y += 14) {
    const wholeFloor = rand() < floors;
    const floorGold = rand() < gold;
    for (let c = 0; c < cols; c++) {
      if (!wholeFloor && rand() > lit) continue;
      out.push({ x: left + c * 9, y, gold: wholeFloor ? floorGold : rand() < gold, o: wholeFloor ? 0.75 : 0.3 + rand() * 0.6 });
    }
  }
  return out;
}

function buildCity() {
  const rand = seeded(2207);
  const back = buildRow(rand, { minH: 140, maxH: 420, minW: 30, maxW: 70, gap: 6, tallChance: 0.1 });
  const mid = buildRow(rand, { minH: 110, maxH: 470, minW: 40, maxW: 90, gap: 14, tallChance: 0.12 });
  const near = buildRow(rand, { minH: 60, maxH: 330, minW: 60, maxW: 140, gap: 30, tallChance: 0.1 });
  const midWindows = mid.flatMap((t) => windowsFor(rand, t, { lit: 0.08, gold: 0.6, floors: 0.03 }));
  const nearWindows = near.flatMap((t) => windowsFor(rand, t, { lit: 0.13, gold: 0.8, floors: 0.05 }));
  // The tallest towers of the middle row wear gold crowns and red aviation beacons.
  const crowned = mid.filter((t) => t.tall);
  const beacons = crowned.map((t, i) => ({ at: towerShape(t).peak, delay: (i * 1.3) % 3.2 }));
  return { back, mid, near, midWindows, nearWindows, crowned, beacons };
}

const CITY = buildCity();

const Win = ({ w, o = 1, size = [3, 5] }) => (
  <rect x={w.x} y={w.y} width={size[0]} height={size[1]} className={w.gold ? "win-gold" : "win-cool"} opacity={w.o * o} />
);

export default function Skyline() {
  const { back, mid, near, midWindows, nearWindows, crowned, beacons } = CITY;
  return (
    <svg className="skyline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="sky-haze" cx="0.6" cy="1.05" r="0.8">
          <stop offset="0" stopColor="#f2a541" stopOpacity="0.32" />
          <stop offset="0.4" stopColor="#f2a541" stopOpacity="0.1" />
          <stop offset="1" stopColor="#f2a541" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sky-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2d3c" />
          <stop offset="1" stopColor="#2a3436" />
        </linearGradient>
        <linearGradient id="sky-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12202c" />
          <stop offset="1" stopColor="#1a2329" />
        </linearGradient>
        {/* Street light rising from below, and the dark floor of the room in front. */}
        <linearGradient id="sky-street" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#f2a541" stopOpacity="0" />
          <stop offset="0.86" stopColor="#f2a541" stopOpacity="0.16" />
          <stop offset="1" stopColor="#0b151d" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="sky-glow">
          <stop offset="0" stopColor="#f5c36a" stopOpacity="0.22" />
          <stop offset="1" stopColor="#f5c36a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sky-crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="1" stopColor="#f2a541" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#sky-haze)" />

      <g opacity="0.55">
        {back.map((t, i) => (
          <path key={i} d={towerShape(t).d} fill="url(#sky-back)" />
        ))}
      </g>

      <g>
        {mid.map((t, i) => (
          <path key={i} d={towerShape(t).d} fill="url(#sky-mid)" />
        ))}
        {midWindows.map((w, i) => (
          <Win key={i} w={w} o={0.55} size={[2.5, 4]} />
        ))}
        {/* Gold crown lights: a soft glow round the top and a strip down each edge of the tallest towers. */}
        {crowned.map((t, i) => {
          const { peak, sides } = towerShape(t);
          return (
            <g key={i}>
              <ellipse cx={peak[0]} cy={sides[1] - 10} rx={t.w * 0.9} ry="60" fill="url(#sky-glow)" />
              <rect x={t.x} y={sides[0]} width="1.6" height={t.h * 0.55} fill="url(#sky-crown)" />
              <rect x={t.x + t.w - 1.6} y={sides[1]} width="1.6" height={t.h * 0.55} fill="url(#sky-crown)" />
            </g>
          );
        })}
      </g>

      <g>
        {near.map((t, i) => (
          <path key={i} d={towerShape(t).d} fill="#08111a" />
        ))}
        {nearWindows.map((w, i) => (
          <Win key={i} w={w} size={[3.5, 6]} />
        ))}
      </g>

      <rect width={W} height={H} fill="url(#sky-street)" />

      {beacons.map((b, i) => (
        <circle key={i} cx={b.at[0]} cy={b.at[1] - 3} r="2.6" className="beacon" style={{ animationDelay: `${b.delay}s` }} />
      ))}
    </svg>
  );
}
