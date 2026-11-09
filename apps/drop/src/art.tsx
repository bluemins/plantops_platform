// Drop's own drawings (mock-up approved by the owner 2026-11-09): the water-drop character, waves, the delivery
// truck, bottles / jars, the drop-shaped points gauge, reward boxes. Plain SVG in the plant's brand colour
// (Tailwind fill-brand / stroke-brand classes follow --color-brand), all decoration: hidden from screen readers.

const DROP = "M110 8 C110 8 22 120 22 168 C22 218 62 252 110 252 C158 252 198 218 198 168 C198 120 110 8 110 8 Z";

/** The drop character's face (eyes, cheeks, smile) inside a drop of the given box. */
function Face({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="-35" cy="22" rx="11" ry="6" fill="#ffb4c2" opacity="0.85" />
      <ellipse cx="35" cy="22" rx="11" ry="6" fill="#ffb4c2" opacity="0.85" />
      <circle cx="-22" cy="0" r="8" fill="#0f1b33" />
      <circle cx="22" cy="0" r="8" fill="#0f1b33" />
      <circle cx="-19" cy="-3" r="2.5" fill="#fff" />
      <circle cx="25" cy="-3" r="2.5" fill="#fff" />
      <path d="M-15 24 Q0 39 15 24" fill="none" stroke="#0f1b33" strokeWidth="5" strokeLinecap="round" />
    </g>
  );
}

/** Log in: the big drop with ripples, bubbles, a jar and a bottle. */
export function LoginArt() {
  return (
    <svg viewBox="0 0 390 400" className="absolute inset-x-0 top-0 w-full" aria-hidden>
      <g fill="#fff">
        <circle cx="40" cy="70" r="14" opacity="0.14" />
        <circle cx="70" cy="40" r="6" opacity="0.2" />
        <circle cx="342" cy="90" r="20" opacity="0.12" />
        <circle cx="318" cy="52" r="7" opacity="0.22" />
        <circle cx="30" cy="180" r="8" opacity="0.18" />
        <g opacity="0.13">
          <rect x="22" y="196" width="18" height="14" rx="3" />
          <path d="M14 214 Q14 208 22 208 L40 208 Q48 208 48 214 L56 230 Q60 236 60 244 L60 332 L2 332 L2 244 Q2 236 6 230 Z" />
          <rect x="346" y="186" width="16" height="12" rx="3" />
          <path d="M344 200 L364 200 L364 214 Q378 226 378 244 L378 338 L330 338 L330 244 Q330 226 344 214 Z" />
        </g>
      </g>
      <ellipse cx="195" cy="254" rx="74" ry="10" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.45" />
      <ellipse cx="195" cy="256" rx="112" ry="17" fill="none" stroke="#fff" strokeWidth="2" opacity="0.22" />
      <path d="M195 36 C195 36 120 124 120 166 C120 208 154 238 195 238 C236 238 270 208 270 166 C270 124 195 36 195 36 Z" fill="#fff" />
      <path d="M236 140 Q262 172 248 212" fill="none" className="stroke-soft" strokeWidth="10" strokeLinecap="round" />
      <path d="M146 158 Q150 128 170 102" fill="none" className="stroke-soft" strokeWidth="8" strokeLinecap="round" />
      <Face x={195} y={174} s={1} />
      <path d="M96 120 Q104 112 104 104 Q104 112 112 120 Q104 128 104 136 Q104 128 96 120 Z" fill="#fff" opacity="0.7" />
      <path d="M284 90 Q290 84 290 78 Q290 84 296 90 Q290 96 290 102 Q290 96 284 90 Z" fill="#fff" opacity="0.6" />
    </svg>
  );
}

/** The small waving drop for headers (Home, Polls). */
export function WavingDrop({ className }: { className?: string }) {
  return (
    <svg viewBox="-20 -6 108 120" className={className} aria-hidden>
      <path d="M44 0 C44 0 4 48 4 72 C4 96 22 112 44 112 C66 112 84 96 84 72 C84 48 44 0 44 0 Z" fill="#fff" />
      <path d="M64 50 Q78 68 70 92" fill="none" className="stroke-soft" strokeWidth="6" strokeLinecap="round" />
      <Face x={44} y={70} s={0.55} />
      <path d="M2 64 Q-14 50 -10 36" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** The two-layer wave at the bottom of a coloured header, ending in the page colour. */
export function Waves() {
  return (
    <svg viewBox="0 0 390 70" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[70px] w-full" aria-hidden>
      <path d="M0 30 C70 6 140 54 210 30 C280 8 330 40 390 22 L390 70 L0 70 Z" className="fill-sky" />
      <path d="M0 46 C80 24 150 66 220 44 C290 24 340 56 390 40 L390 70 L0 70 Z" className="fill-page" />
    </svg>
  );
}

/** Your order: the truck with the drop on its way to the shop. */
export function TruckArt() {
  return (
    <svg viewBox="0 0 354 78" className="h-auto w-full" aria-hidden>
      <rect width="354" height="78" rx="16" className="fill-faint" />
      <line x1="14" y1="64" x2="340" y2="64" stroke="#c9d4e3" strokeWidth="3" strokeDasharray="10 8" strokeLinecap="round" />
      <g className="fill-mid">
        <path d="M30 44 Q34 39 34 35 Q34 39 38 44 a4 4 0 0 1 -8 0 Z" />
        <path d="M50 48 Q53 44 53 41 Q53 44 56 48 a3 3 0 0 1 -6 0 Z" />
        <path d="M66 42 Q68 39 68 37 Q68 39 70 42 a2 2 0 0 1 -4 0 Z" />
      </g>
      <g transform="translate(84 18)">
        <rect y="4" width="76" height="38" rx="6" className="fill-brand" />
        <path d="M38 12 C38 12 30 21 30 26 a8 8 0 0 0 16 0 C46 21 38 12 38 12 Z" fill="#fff" />
        <path d="M78 14 L98 14 Q102 14 104 18 L112 30 L112 42 L78 42 Z" className="fill-brand" />
        <path d="M84 18 L97 18 L104 29 L84 29 Z" fill="#fff" opacity="0.85" />
        <circle cx="20" cy="45" r="8" fill="#0f1b33" />
        <circle cx="20" cy="45" r="3" fill="#fff" />
        <circle cx="94" cy="45" r="8" fill="#0f1b33" />
        <circle cx="94" cy="45" r="3" fill="#fff" />
      </g>
      <g transform="translate(270 10)">
        <rect x="6" y="18" width="62" height="34" rx="3" fill="#fff" stroke="#c9d4e3" strokeWidth="2" />
        <path d="M0 18 L74 18 L68 6 L6 6 Z" fill="#f59e0b" />
        <path d="M14 6 L12 18 M26 6 L25 18 M37 6 L37 18 M48 6 L49 18 M60 6 L62 18" stroke="#fff" strokeWidth="4" />
        <rect x="28" y="30" width="18" height="22" rx="2" className="fill-soft" />
        <rect x="12" y="26" width="10" height="10" rx="2" className="fill-soft" />
        <rect x="52" y="26" width="10" height="10" rx="2" className="fill-soft" />
      </g>
    </svg>
  );
}

export type Kind = "jar" | "bottle" | "small" | "tiny";
/** Which picture a product gets, from its size / unit ("20L" or a jar → jar; up to 300 ml → tiny; other ml → small;
 *  else the 1 L bottle). */
export function kindOf(size: string, unit = ""): Kind {
  const s = `${size} ${unit}`.toLowerCase();
  if (/jar|can|\b(1[5-9]|2\d)\s*l/.test(s)) return "jar";
  const ml = /(\d+)\s*ml/.exec(s);
  if (ml) return Number(ml[1]) <= 300 ? "tiny" : "small";
  return "bottle";
}

const BOTTLE_H: Record<Exclude<Kind, "jar">, number> = { bottle: 1, small: 0.8, tiny: 0.62 };

/** The square ribbed bottle (cap, ribs, a tall label with the plant's colour at its foot and the water wave). */
export function Bottle({ kind, height }: { kind: Exclude<Kind, "jar">; height: number }) {
  const h = height * BOTTLE_H[kind];
  return (
    <svg viewBox="0 0 40 100" style={{ height: h, width: h * 0.4 }} aria-hidden>
      <rect x="13" y="2" width="14" height="9" rx="2" className="fill-brand" />
      <path d="M15 11 H25 V17 L32 30 V94 Q32 98 28 98 H12 Q8 98 8 94 V30 L15 17 Z" fill="#fff" className="stroke-sky" strokeWidth="1.6" />
      <path d="M8 40H32M8 47H32M8 54H32M8 61H32M8 68H32M8 75H32M8 82H32M8 89H32" className="stroke-sky-soft" strokeWidth="1.2" />
      <rect x="15" y="34" width="10" height="56" rx="1.5" fill="#fff" className="stroke-sky" strokeWidth="1" />
      <path d="M15 66 Q18 63 20 66 T25 66 V72 H15 Z" className="fill-sky" />
      <rect x="15" y="72" width="10" height="18" className="fill-brand" />
    </svg>
  );
}

/** A product picture in a tinted square (order lines): the jar, or the bottle in its size. */
export function ProductIcon({ kind }: { kind: Kind }) {
  return (
    <span className="flex h-12 w-11 shrink-0 items-end justify-center rounded-xl bg-sky-soft pb-0.5">
      {kind === "jar" ? (
        <svg viewBox="0 0 24 24" className="mb-1.5 h-8 w-8" aria-hidden>
          <g className="fill-brand">
            <rect x="9" y="1" width="6" height="3" rx="1" />
            <path d="M8 4.5 L16 4.5 L17 7 Q21 8 21 12 L21 21 Q21 23 19 23 L5 23 Q3 23 3 21 L3 12 Q3 8 7 7 Z" />
            <path d="M3 15 L21 15 M3 19 L21 19" stroke="#fff" strokeWidth="1.4" opacity="0.7" />
          </g>
        </svg>
      ) : (
        <Bottle kind={kind} height={44} />
      )}
    </span>
  );
}

/** The points banner's drop with a gift in it. */
export function GiftDrop() {
  return (
    <svg viewBox="0 0 64 70" className="h-[70px] w-16 shrink-0" aria-hidden>
      <path d="M32 2 C32 2 4 34 4 48 C4 61 16 68 32 68 C48 68 60 61 60 48 C60 34 32 2 32 2 Z" className="fill-brand" />
      <rect x="16" y="38" width="32" height="22" rx="3" fill="#fff" />
      <rect x="14" y="32" width="36" height="8" rx="2" fill="#fcd34d" />
      <rect x="29" y="32" width="6" height="28" fill="#f59e0b" />
      <path d="M32 32 Q24 22 20 28 Q18 32 32 32 Z M32 32 Q40 22 44 28 Q46 32 32 32 Z" fill="#f59e0b" />
    </svg>
  );
}

/** Points: a drop that fills with water as the points grow (progress 0–1 towards the next free box). */
export function DropGauge({ progress, label }: { progress: number; label: string }) {
  const p = Math.max(0, Math.min(1, progress));
  const level = 8 + (1 - p) * 244;
  return (
    <svg viewBox="0 0 220 260" className="h-[260px] w-[220px]" role="img" aria-label={label}>
      <defs>
        <clipPath id="drop-gauge">
          <path d={DROP} />
        </clipPath>
      </defs>
      <path d={DROP} fill="#fff" />
      <g clipPath="url(#drop-gauge)">
        <path transform={`translate(0 ${level - 18})`} d="M-20 12 C20 0 50 24 90 12 C130 0 160 24 200 12 C220 6 232 10 250 12 L250 320 L-20 320 Z" className="fill-sky" />
        <g transform={`translate(0 ${level - 10})`}>
          <path d="M-30 10 C10 22 40 -2 80 10 C120 22 150 -2 190 10 C215 18 232 12 250 10 L250 320 L-30 320 Z" className="fill-brand" />
          <g fill="#fff">
            <circle cx="60" cy="70" r="6" opacity="0.35" />
            <circle cx="150" cy="110" r="9" opacity="0.25" />
            <circle cx="90" cy="150" r="4" opacity="0.4" />
            <circle cx="170" cy="60" r="4" opacity="0.35" />
          </g>
        </g>
      </g>
      <path d={DROP} fill="none" className="stroke-brand" strokeWidth="5" />
      <path d="M56 140 Q62 104 86 74" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** A free-box reward: the bottle in its size, or a 20 L jar. */
export function RewardArt({ kind, className = "h-14 w-[60px]" }: { kind: Kind; className?: string }) {
  return (
    <svg viewBox="0 0 60 56" className={`shrink-0 ${className}`} aria-hidden>
      {kind === "jar" ? (
        <>
          <rect x="24" y="2" width="12" height="6" rx="2" className="fill-brand" />
          <path d="M22 8 L38 8 L40 13 Q52 15 52 26 L52 50 Q52 54 48 54 L12 54 Q8 54 8 50 L8 26 Q8 15 20 13 Z" className="fill-mid" />
          <path d="M8 34 L52 34 M8 44 L52 44" stroke="#fff" strokeWidth="2" opacity="0.8" />
          <path d="M16 22 Q16 18 20 17" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <g transform={`translate(${30 - 20 * 0.56 * BOTTLE_H[kind]} ${56 - 100 * 0.56 * BOTTLE_H[kind]}) scale(${0.56 * BOTTLE_H[kind]})`}>
          <rect x="13" y="2" width="14" height="9" rx="2" className="fill-brand" />
          <path d="M15 11 H25 V17 L32 30 V94 Q32 98 28 98 H12 Q8 98 8 94 V30 L15 17 Z" fill="#fff" className="stroke-sky" strokeWidth="1.6" />
          <path d="M8 40H32M8 47H32M8 54H32M8 61H32M8 68H32M8 75H32M8 82H32M8 89H32" className="stroke-sky-soft" strokeWidth="1.2" />
          <rect x="15" y="34" width="10" height="56" rx="1.5" fill="#fff" className="stroke-sky" strokeWidth="1" />
          <path d="M15 66 Q18 63 20 66 T25 66 V72 H15 Z" className="fill-sky" />
          <rect x="15" y="72" width="10" height="18" className="fill-brand" />
        </g>
      )}
    </svg>
  );
}

/** Polls header: a question card in a speech bubble. */
export function PollBubble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 142 90" className={className} aria-hidden>
      <path d="M24 0 L118 0 Q132 0 132 14 L132 56 Q132 70 118 70 L60 70 L40 88 L42 70 L24 70 Q10 70 10 56 L10 14 Q10 0 24 0 Z" fill="#fff" />
      <rect x="26" y="20" width="16" height="16" rx="4" className="fill-soft" />
      <rect x="50" y="22" width="62" height="5" rx="2.5" className="fill-mid" />
      <rect x="50" y="31" width="40" height="5" rx="2.5" className="fill-soft" />
      <rect x="26" y="42" width="16" height="16" rx="4" className="fill-brand" />
      <path d="M30 50 l3 3 l6 -6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="50" y="44" width="56" height="5" rx="2.5" className="fill-mid" />
      <rect x="50" y="53" width="34" height="5" rx="2.5" className="fill-soft" />
    </svg>
  );
}

/** Thank-you: the drop cheering with confetti. */
export function CheerArt() {
  return (
    <svg viewBox="0 0 200 130" className="h-[130px] w-[200px]" aria-hidden>
      <rect x="22" y="22" width="10" height="5" rx="2" transform="rotate(-25 27 24)" fill="#fcd34d" />
      <rect x="160" y="18" width="10" height="5" rx="2" transform="rotate(30 165 20)" fill="#ffb4c2" />
      <rect x="176" y="70" width="9" height="5" rx="2" transform="rotate(-15 180 72)" className="fill-mid" />
      <rect x="14" y="80" width="9" height="5" rx="2" transform="rotate(40 18 82)" className="fill-mid" />
      <g className="fill-brand">
        <path d="M48 46 Q52 41 52 37 Q52 41 56 46 a4 4 0 0 1 -8 0 Z" />
        <path d="M146 50 Q150 45 150 41 Q150 45 154 50 a4 4 0 0 1 -8 0 Z" />
      </g>
      <path d="M38 112 Q41 108 41 105 Q41 108 44 112 a3 3 0 0 1 -6 0 Z" fill="#fcd34d" />
      <path d="M160 106 Q163 102 163 99 Q163 102 166 106 a3 3 0 0 1 -6 0 Z" fill="#ffb4c2" />
      <ellipse cx="100" cy="124" rx="40" ry="5" className="fill-soft" />
      <path d="M100 8 C100 8 64 52 64 76 C64 100 80 118 100 118 C120 118 136 100 136 76 C136 52 100 8 100 8 Z" className="fill-brand" />
      <path d="M120 58 Q132 74 126 98" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.45" />
      <path d="M84 76 l4 -8 l4 8 M108 76 l4 -8 l4 8" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M86 88 Q100 104 114 88 Z" fill="#fff" />
      <path d="M62 70 Q46 56 50 40 M138 70 Q154 56 150 40" fill="none" className="stroke-brand" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** No order on the way: an empty, dashed jar. */
export function EmptyJarArt() {
  return (
    <svg viewBox="0 0 160 120" className="h-[120px] w-40" aria-hidden>
      <ellipse cx="80" cy="112" rx="50" ry="6" className="fill-well" />
      <rect x="68" y="6" width="24" height="10" rx="3" fill="none" stroke="#9aa6bc" strokeWidth="3" strokeDasharray="6 5" />
      <path d="M64 18 L96 18 L100 26 Q124 30 124 50 L124 100 Q124 108 116 108 L44 108 Q36 108 36 100 L36 50 Q36 30 60 26 Z" fill="none" stroke="#9aa6bc" strokeWidth="3" strokeDasharray="8 6" strokeLinejoin="round" />
      <path d="M80 54 C80 54 70 66 70 72 a10 10 0 0 0 20 0 C90 66 80 54 80 54 Z" className="fill-soft" />
      <circle cx="132" cy="22" r="5" className="fill-soft" />
      <circle cx="24" cy="40" r="4" className="fill-soft" />
    </svg>
  );
}

/** No internet: a crossed-out cloud and a worried little drop. */
export function OfflineArt() {
  return (
    <svg viewBox="0 0 180 120" className="h-[120px] w-[180px]" aria-hidden>
      <path d="M50 70 a22 22 0 0 1 8 -42 a30 30 0 0 1 56 -4 a24 24 0 0 1 16 46 Z" className="fill-well" />
      <line x1="40" y1="16" x2="140" y2="96" stroke="#9aa6bc" strokeWidth="5" strokeLinecap="round" />
      <path d="M90 66 C90 66 72 88 72 98 C72 108 80 116 90 116 C100 116 108 108 108 98 C108 88 90 66 90 66 Z" className="fill-brand" />
      <circle cx="84" cy="98" r="2.8" fill="#fff" />
      <circle cx="96" cy="98" r="2.8" fill="#fff" />
      <path d="M85 108 Q90 104 95 108" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The plant's mark when it has no logo: a drop in a white circle. */
export function DropMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden>
      <path d="M12 2 C12 2 5 10 5 14.5 a7 7 0 0 0 14 0 C19 10 12 2 12 2 Z" className="fill-brand" />
    </svg>
  );
}
