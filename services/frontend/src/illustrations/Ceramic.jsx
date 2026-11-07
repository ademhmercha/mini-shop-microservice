import { useId } from 'react';

/**
 * Illustrations originales de céramique : silhouettes en aplats de la palette, ombrage par recouvrements
 * translucides et grain de texture (filtre SVG). Aucune image externe.
 */

const INK = '#2B2420';
const PAPER = '#FBF8F3';
const CLAY = '#B5532F';
const SAGE = '#7A8B6F';
const LINE = '#E2D6C6';

const TONES = {
  terracotta: { body: CLAY, backdrop: LINE, backdropOpacity: 1 },
  sauge: { body: SAGE, backdrop: LINE, backdropOpacity: 1 },
  creme: { body: PAPER, backdrop: SAGE, backdropOpacity: 0.32 },
  charbon: { body: INK, backdrop: CLAY, backdropOpacity: 0.28 },
};

/** Filtre de grain partagé : à rendre une seule fois dans l'application. */
export function GrainDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="sr-only">
      <defs>
        <filter id="ma-grain" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="saturate" values="0" result="gray" />
          <feComponentTransfer in="gray">
            <feFuncA type="table" tableValues="0 0.55" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

/** Forme pleine + ombre portée à droite + reflet à gauche, découpés dans la silhouette. */
function Shaded({ d, fill, hl = [128, 235], shade = 0.16, extra, outline }) {
  const id = useId().replace(/:/g, '');
  return (
    <g>
      <clipPath id={`c${id}`}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={fill} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <g clipPath={`url(#c${id})`}>
        <ellipse cx="338" cy="270" rx="150" ry="210" fill={INK} opacity={shade} />
        <ellipse cx={hl[0]} cy={hl[1]} rx="18" ry="70" fill={PAPER} opacity="0.24" transform={`rotate(8 ${hl[0]} ${hl[1]})`} />
        {extra}
      </g>
    </g>
  );
}

const Ground = ({ rx = 120, cy = 342 }) => <ellipse cx="200" cy={cy} rx={rx} ry="9" fill={INK} opacity="0.13" />;

function Bowl({ tone, variant }) {
  const { body } = TONES[tone];
  const outline = tone === 'creme' ? LINE : undefined;
  if (variant === 'fumee') {
    return (
      <g>
        <Ground rx={110} />
        <Shaded fill={body} outline={outline} d="M158 328 L164 348 L236 348 L242 328 Z" shade={0.3} />
        <Shaded
          fill={body}
          outline={outline}
          d="M92 168 C86 280 138 334 200 334 C262 334 314 280 308 168 Z"
          extra={<path d="M90 168 C96 208 110 218 122 202 C130 190 142 216 152 226 C164 238 172 192 178 168 Z" fill={PAPER} opacity="0.2" />}
        />
        <ellipse cx="200" cy="168" rx="108" ry="21" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
        <ellipse cx="200" cy="171" rx="94" ry="15" fill={INK} opacity="0.3" />
      </g>
    );
  }
  return (
    <g>
      <Ground rx={140} />
      <Shaded fill={body} outline={outline} d="M150 326 L158 348 L242 348 L250 326 Z" shade={0.3} />
      <Shaded fill={body} outline={outline} d="M62 188 C62 284 124 332 200 332 C276 332 338 284 338 188 Z" />
      <ellipse cx="200" cy="188" rx="138" ry="25" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <ellipse cx="200" cy="192" rx="122" ry="18" fill={INK} opacity="0.26" />
      <ellipse cx="170" cy="190" rx="50" ry="5" fill={PAPER} opacity="0.12" />
    </g>
  );
}

function Cup({ tone, variant }) {
  const { body } = TONES[tone];
  const outline = tone === 'creme' ? LINE : undefined;
  if (variant === 'sillon') {
    return (
      <g>
        <Ground rx={92} cy={344} />
        <Shaded
          fill={body}
          outline={outline}
          d="M132 124 L268 124 L257 324 C256 335 247 342 237 342 L163 342 C153 342 144 335 143 324 Z"
          extra={[170, 202, 234, 266, 298].map((y) => (
            <path key={y} d={`M120 ${y} C170 ${y + 7} 230 ${y + 7} 280 ${y}`} stroke={INK} strokeWidth="3" fill="none" opacity="0.2" />
          ))}
        />
        <ellipse cx="200" cy="124" rx="68" ry="12" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
        <ellipse cx="200" cy="126" rx="58" ry="8" fill={INK} opacity="0.3" />
      </g>
    );
  }
  const saucer = variant === 'brume';
  const bodyPath = saucer
    ? 'M126 150 L274 150 L258 300 C256 320 240 332 222 332 L178 332 C160 332 144 320 142 300 Z'
    : 'M118 162 L282 162 L272 296 C270 318 252 332 230 332 L170 332 C148 332 130 318 128 296 Z';
  const handle = saucer ? 'M268 178 C314 172 320 246 262 252' : 'M279 190 C338 184 344 276 270 284';
  const top = saucer ? 150 : 162;
  const rx = saucer ? 74 : 82;
  return (
    <g>
      <Ground rx={saucer ? 130 : 110} cy={saucer ? 346 : 344} />
      {saucer && (
        <g>
          <ellipse cx="200" cy="336" rx="118" ry="17" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
          <ellipse cx="200" cy="333" rx="82" ry="9" fill={INK} opacity="0.2" />
        </g>
      )}
      <path d={handle} stroke={body} strokeWidth={saucer ? 14 : 18} strokeLinecap="round" fill="none" />
      <path d={handle} stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.12" transform="translate(2 4)" />
      <Shaded fill={body} outline={outline} d={bodyPath} />
      <ellipse cx="200" cy={top} rx={rx} ry="15" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <ellipse cx="200" cy={top + 3} rx={rx - 10} ry="10" fill={INK} opacity="0.3" />
    </g>
  );
}

function Vase({ tone, variant }) {
  const { body } = TONES[tone];
  const outline = tone === 'creme' ? LINE : undefined;
  if (variant === 'souffle') {
    return (
      <g>
        <Ground rx={100} />
        <path d="M200 60 C196 30 214 10 238 -2" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />
        <path d="M198 60 C182 34 170 22 150 14" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55" />
        <path d="M202 60 C214 40 246 30 262 18" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55" />
        <Shaded
          fill={body}
          outline={outline}
          d="M172 62 C180 64 186 68 188 78 L190 162 C128 186 100 238 116 290 C130 336 270 336 284 290 C300 238 272 186 210 162 L212 78 C214 68 220 64 228 62 Z"
        />
        <ellipse cx="200" cy="62" rx="28" ry="6" fill={INK} opacity="0.3" />
      </g>
    );
  }
  if (variant === 'colline') {
    return (
      <g>
        <Ground rx={86} />
        <Shaded
          fill={body}
          outline={outline}
          d="M146 336 L146 160 C146 100 254 100 254 160 L254 336 Z"
          hl={[166, 220]}
          extra={
            <g>
              <path d="M140 262 C176 224 214 240 260 198 L260 340 L140 340 Z" fill={SAGE} opacity="0.9" />
              <path d="M140 296 C186 268 222 286 260 256 L260 340 L140 340 Z" fill={CLAY} opacity="0.85" />
              <circle cx="200" cy="162" r="15" fill={PAPER} opacity="0.55" />
            </g>
          }
        />
      </g>
    );
  }
  return (
    <g>
      <Ground rx={128} />
      <path d="M204 152 C206 112 236 82 276 56" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      {[[222, 112, -30], [246, 88, 20], [268, 66, -20], [214, 134, 40]].map(([x, y, r]) => (
        <ellipse key={`${x}${y}`} cx={x} cy={y} rx="13" ry="5" fill={INK} opacity="0.75" transform={`rotate(${r} ${x} ${y})`} />
      ))}
      <Shaded
        fill={body}
        outline={outline}
        d="M200 150 C152 150 150 166 156 176 C92 206 78 258 98 298 C118 340 282 340 302 298 C322 258 308 206 244 176 C250 166 248 150 200 150 Z"
      />
      <ellipse cx="200" cy="151" rx="44" ry="9" fill={INK} opacity="0.32" />
    </g>
  );
}

function Plate({ tone, variant }) {
  const { body } = TONES[tone];
  const outline = tone === 'creme' ? LINE : undefined;
  const deep = variant === 'mie';
  const specks = [[110, 250], [150, 280], [230, 286], [292, 256], [262, 232], [170, 228], [200, 292], [322, 272]];
  return (
    <g>
      <Ground rx={160} cy={318} />
      <ellipse cx="200" cy={deep ? 262 : 268} rx={deep ? 150 : 160} ry={deep ? 54 : 58} fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <ellipse cx="200" cy={deep ? 262 : 268} rx={deep ? 150 : 160} ry={deep ? 54 : 58} fill={INK} opacity="0.32" />
      <ellipse cx="200" cy={deep ? 246 : 252} rx={deep ? 150 : 160} ry={deep ? 54 : 58} fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <ellipse cx="200" cy={deep ? 250 : 254} rx={deep ? 100 : 112} ry={deep ? 34 : 38} fill={INK} opacity={deep ? 0.26 : 0.1} />
      <ellipse cx="200" cy={deep ? 246 : 252} rx={deep ? 128 : 142} ry={deep ? 46 : 51} fill="none" stroke={PAPER} strokeWidth="2" opacity="0.28" />
      {!deep && specks.map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.4" fill={INK} opacity="0.3" />)}
      <ellipse cx="124" cy={deep ? 236 : 240} rx="38" ry="6" fill={PAPER} opacity="0.2" transform="rotate(-8 124 238)" />
    </g>
  );
}

function Teapot({ tone, variant }) {
  const { body } = TONES[tone];
  const outline = tone === 'creme' ? LINE : undefined;
  if (variant === 'matin') {
    return (
      <g>
        <Ground rx={110} cy={344} />
        <path d="M124 214 C58 200 54 300 130 298" stroke={body} strokeWidth="17" fill="none" strokeLinecap="round" />
        <Shaded fill={body} outline={outline} d="M270 248 C322 244 342 196 354 150 C338 144 326 152 320 168 C306 198 292 212 268 216 Z" />
        <Shaded fill={body} outline={outline} d="M120 192 C98 262 120 336 196 336 C272 336 294 262 272 192 Z" />
        <Shaded fill={body} outline={outline} d="M134 194 L258 194 C256 182 250 172 238 168 L154 168 C142 172 136 182 134 194 Z" shade={0.22} />
        <circle cx="196" cy="156" r="14" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
        <circle cx="191" cy="152" r="4" fill={PAPER} opacity="0.35" />
      </g>
    );
  }
  return (
    <g>
      <Ground rx={128} cy={346} />
      <path d="M294 216 C362 206 366 304 290 302" stroke={body} strokeWidth="21" fill="none" strokeLinecap="round" />
      <Shaded fill={body} outline={outline} d="M100 252 C62 244 56 202 48 168 C62 162 74 170 80 186 C92 212 102 226 112 228 Z" />
      <Shaded fill={body} outline={outline} d="M196 164 C130 164 88 206 88 262 C88 320 138 342 196 342 C254 342 304 320 304 262 C304 206 262 164 196 164 Z" />
      <path d="M142 166 C150 150 244 150 252 166 Z" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <path d="M142 166 C150 150 244 150 252 166 Z" fill={INK} opacity="0.18" />
      <circle cx="196" cy="146" r="12" fill={body} stroke={outline} strokeWidth={outline ? 2 : 0} />
      <path d="M118 160 C116 66 276 66 274 160" stroke={INK} strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M126 150 C132 90 262 90 268 150" stroke={INK} strokeWidth="2" fill="none" opacity="0.35" strokeDasharray="3 5" />
    </g>
  );
}

const SHAPES = {
  'bowl-aube': [Bowl, 'aube'], 'bowl-fumee': [Bowl, 'fumee'],
  'cup-sieste': [Cup, 'sieste'], 'cup-brume': [Cup, 'brume'], 'cup-sillon': [Cup, 'sillon'],
  'vase-lune': [Vase, 'lune'], 'vase-souffle': [Vase, 'souffle'], 'vase-colline': [Vase, 'colline'],
  'plate-ecume': [Plate, 'ecume'], 'plate-mie': [Plate, 'mie'],
  'teapot-serenade': [Teapot, 'serenade'], 'teapot-matin': [Teapot, 'matin'],
};

const BACKDROPS = {
  'bowl-aube': 'arch', 'bowl-fumee': 'circle', 'cup-sieste': 'sun', 'cup-brume': 'slab', 'cup-sillon': 'arch',
  'vase-lune': 'circle', 'vase-souffle': 'slab', 'vase-colline': 'sun', 'plate-ecume': 'arch', 'plate-mie': 'circle',
  'teapot-serenade': 'sun', 'teapot-matin': 'arch',
};

function Backdrop({ kind, tone }) {
  const { backdrop, backdropOpacity } = TONES[tone];
  const props = { fill: backdrop, opacity: backdropOpacity };
  if (kind === 'arch') return <path d="M82 400 V176 a118 118 0 0 1 236 0 V400 Z" {...props} />;
  if (kind === 'circle') return <circle cx="200" cy="196" r="142" {...props} />;
  if (kind === 'sun') return <circle cx="262" cy="148" r="96" {...props} />;
  return <rect x="70" y="58" width="260" height="342" {...props} />;
}

export function Illustration({ name, tone = 'terracotta', title, className }) {
  const entry = SHAPES[name] ?? SHAPES['bowl-aube'];
  const [Shape, variant] = entry;
  const t = TONES[tone] ? tone : 'terracotta';
  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="400" height="400" fill={PAPER} />
      <Backdrop kind={BACKDROPS[name] ?? 'arch'} tone={t} />
      <Shape tone={t} variant={variant} />
      <rect width="400" height="400" filter="url(#ma-grain)" opacity="0.2" className="grain" />
    </svg>
  );
}

const place = (Shape, tone, variant, x, y, s) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <Shape tone={tone} variant={variant} />
  </g>
);

/** Composition de l'accueil : vases, bol et tasse devant une arche. */
export function HeroArt({ title = 'Une composition de vases, d’un bol et d’une tasse en céramique' }) {
  return (
    <svg viewBox="0 0 400 500" role="img" aria-label={title} preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="500" fill={PAPER} />
      <path d="M40 500 V210 a160 160 0 0 1 320 0 V500 Z" fill={LINE} />
      <circle cx="292" cy="130" r="54" fill={CLAY} opacity="0.9" />
      <rect x="0" y="388" width="400" height="112" fill={SAGE} opacity="0.28" />
      {place(Vase, 'sauge', 'souffle', 40, 36, 0.98)}
      {place(Vase, 'charbon', 'colline', 196, 110, 0.7)}
      {place(Bowl, 'terracotta', 'aube', 2, 218, 0.62)}
      {place(Cup, 'creme', 'sieste', 236, 262, 0.5)}
      <rect width="400" height="500" filter="url(#ma-grain)" opacity="0.2" className="grain" />
    </svg>
  );
}

/** Illustration des pages d'authentification (colonne de droite). */
export function AuthArt({ variant = 'a' }) {
  const alt = variant === 'b';
  return (
    <svg viewBox="0 0 400 600" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="600" fill={PAPER} />
      <rect x="0" y="0" width="400" height="600" fill={alt ? SAGE : LINE} opacity={alt ? 0.35 : 0.65} />
      <circle cx={alt ? 130 : 270} cy="190" r="118" fill={alt ? CLAY : SAGE} opacity={alt ? 0.9 : 0.5} />
      <rect x="0" y="470" width="400" height="130" fill={INK} opacity="0.07" />
      {alt ? place(Teapot, 'terracotta', 'serenade', 70, 150, 0.95) : place(Vase, 'terracotta', 'lune', 30, 180, 0.95)}
      {alt ? place(Cup, 'creme', 'brume', 214, 292, 0.52) : place(Bowl, 'creme', 'fumee', 188, 336, 0.5)}
      {!alt && place(Vase, 'sauge', 'souffle', 168, 60, 0.62)}
      {alt && place(Plate, 'charbon', 'ecume', 4, 330, 0.5)}
      <rect width="400" height="600" filter="url(#ma-grain)" opacity="0.22" className="grain" />
    </svg>
  );
}

/** Bol vide, pour les états « panier vide » et « rien à afficher ». */
export function EmptyBowl({ className }) {
  return (
    <svg viewBox="0 0 400 300" className={className} aria-hidden="true">
      <circle cx="200" cy="150" r="120" fill={LINE} />
      <g transform="translate(40 -40) scale(0.8)">
        <Bowl tone="creme" variant="aube" />
      </g>
      <rect width="400" height="300" filter="url(#ma-grain)" opacity="0.18" className="grain" />
    </svg>
  );
}
