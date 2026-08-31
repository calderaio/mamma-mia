import { INGREDIENT_COLOR, INGREDIENT_LABEL, type Ingredient } from '../game/ingredients';
import { PLAYER_COLOR_CLASS, PLAYER_LABEL, type PlayerColor } from '../game/colors';
import type { OrderRequirement, OvenCard } from '../game/types';

export function IngredientCardView({
  ingredient,
  selected,
  onClick,
}: {
  ingredient: Ingredient;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-24 w-16 shrink-0 flex-col items-center justify-center whitespace-normal break-words hyphens-auto rounded-lg border-2 px-0.5 text-center text-[10px] leading-tight font-medium shadow transition-transform ${INGREDIENT_COLOR[ingredient]} ${
        selected ? '-translate-y-2 ring-4 ring-white' : ''
      } ${onClick ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'}`}
    >
      {INGREDIENT_LABEL[ingredient]}
    </button>
  );
}

function describeRequirement(req: OrderRequirement): string {
  switch (req.kind) {
    case 'normal':
      return Object.entries(req.requirements)
        .map(([ing, n]) => `${n}x ${INGREDIENT_LABEL[ing as Ingredient]}`)
        .join(' + ');
    case 'bombastica':
      return 'mind. 15 beliebige Zutaten';
    case 'monotoni':
      return `1x eigene Zutat + ${req.jokerCount}x frei wählbar (Joker)`;
    case 'minimale':
      return `1x eigene Zutat + ${req.otherCount}x seltenste Zutat im Ofen`;
  }
}

export function OrderCardView({
  color,
  name,
  requirement,
  selected,
  onClick,
  struck,
  note,
}: {
  color: PlayerColor;
  name: string;
  requirement: OrderRequirement;
  selected?: boolean;
  onClick?: () => void;
  /** Render as already delivered: dimmed with the name struck through. */
  struck?: boolean;
  /** Replaces the player-colour label in the card footer (e.g. a status line). */
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-40 shrink-0 flex-col gap-1 rounded-lg border-2 p-2 text-left text-xs shadow transition-transform ${PLAYER_COLOR_CLASS[color]} ${
        selected ? '-translate-y-2 ring-4 ring-white' : ''
      } ${struck ? 'opacity-55' : ''} ${onClick ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'}`}
    >
      <div className={`font-bold ${struck ? 'line-through' : ''}`}>{name}</div>
      <div className="opacity-90">{describeRequirement(requirement)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-75">{note ?? PLAYER_LABEL[color]}</div>
    </button>
  );
}

export function FaceDownStack({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-24 w-16 items-center justify-center rounded-lg border-2 border-slate-500 bg-slate-700 text-lg font-bold text-white shadow">
        {count}
      </div>
      <div className="text-xs opacity-70">{label}</div>
    </div>
  );
}

/**
 * Fixed little offsets/rotations for the face-down tabs peeking out from
 * behind the oven's top card — just enough to read as "a messy pile", not
 * a precise fan. Each tab is bottom-anchored to the top card and then
 * pushed down by `y` px, so `y` is directly how much of it pokes out below
 * the card's bottom edge (small y = mostly hidden, which is why this needs
 * to be a decent fraction of the tab's own height to actually read as
 * peeking rather than a sliver).
 */
const PEEK_OFFSETS = [
  { x: -26, y: 18, rotate: -12 },
  { x: 22, y: 22, rotate: 9 },
  { x: -6, y: 26, rotate: -4 },
];

/**
 * The oven is a discard stack: cards are covered as new ones are placed on
 * top, but the physical topmost card is always visible to everyone at the
 * table (per the official rules) — so if someone plays an order card, its
 * recipe stays visible until the next player's mandatory ingredient
 * placement covers it back up. The rest of the pile is genuinely hidden, so
 * it's drawn as plain face-down tabs peeking out behind the top card,
 * purely to read visually as "a pile", not to leak any real information.
 */
export function OvenStackView({ count, topCard, messy = true }: { count: number; topCard: OvenCard | null; messy?: boolean }) {
  const peekCount = messy ? Math.min(Math.max(count - 1, 0), PEEK_OFFSETS.length) : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative inline-block">
        {PEEK_OFFSETS.slice(0, peekCount).map((offset, i) => (
          <div
            key={i}
            className="absolute bottom-0 left-1/2 h-9 w-12 rounded-md border-2 border-slate-500 bg-slate-700 shadow"
            style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px) rotate(${offset.rotate}deg)`, zIndex: i }}
          />
        ))}
        <div className="relative" style={{ zIndex: 10 }}>
          {topCard ? (
            topCard.kind === 'ingredient' ? (
              <IngredientCardView ingredient={topCard.ingredient} />
            ) : (
              <OrderCardView color={topCard.color} name={topCard.name} requirement={topCard.requirement} />
            )
          ) : (
            <div className="flex h-24 w-16 items-center justify-center rounded-lg border-2 border-slate-500 bg-slate-700 text-lg font-bold text-white shadow">
              0
            </div>
          )}
        </div>
      </div>
      <div className="text-xs opacity-70">Ofen: {count} (nur oberste Karte sichtbar)</div>
    </div>
  );
}
