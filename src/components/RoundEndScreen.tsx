import { useState } from 'react';
import type { CardId, GameState, IngredientCard, OrderRequirement } from '../game/types';
import type { Ingredient } from '../game/ingredients';
import { INGREDIENTS, INGREDIENT_LABEL } from '../game/ingredients';
import { PERSONAL_INGREDIENT, playerBadge } from '../game/colors';
import { IngredientCardView, OrderCardView } from './Card';
import { LogPanel } from './TurnScreen';
import { RecipeChecklist } from './RecipeChecklist';

interface Actions {
  revealNext: () => void;
  chooseJoker: (ingredient: Ingredient) => void;
  chooseMinimaleIngredient: (ingredient: Ingredient) => void;
  resolveHandTopUp: (cardIds: CardId[] | null) => void;
}

export function RoundEndScreen({ state, actions, error }: { state: GameState; actions: Actions; error: string | null }) {
  const [selectedHandCards, setSelectedHandCards] = useState<CardId[]>([]);

  if (!state.roundEnd) {
    // Guaranteed populated synchronously by the drawCards action; this is
    // only a type-narrowing guard, not a real runtime state.
    return null;
  }
  const { roundEnd } = state;
  const holder = state.players.find((p) => p.id === roundEnd.holderId)!;
  const pending = roundEnd.pending;

  // With exactly one human at the table, keep their hand on screen the whole
  // reveal — you need it to judge joker / Minimale picks and hand top-ups.
  const humans = state.players.filter((p) => !p.isBot);
  const me = humans.length === 1 ? humans[0] : null;
  const myHandCounts = countIngredients(me?.hand ?? []);

  function toggleHandCard(id: CardId) {
    setSelectedHandCards((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="text-center">
        <h1 className="font-script text-4xl text-[var(--tomato)]">Rundenauswertung – Runde {state.round}</h1>
        <p className="text-sm opacity-75">
          {playerBadge(holder)}{holder.name} deckt den Ofen Karte für Karte auf.
        </p>
      </header>

      {error && <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>}

      <section className="flex flex-wrap items-start justify-center gap-4">
        {INGREDIENTS.map((ingredient) => {
          const count = roundEnd.sortedIngredients[ingredient].length;
          const overlapStep = 6;
          return (
            <div key={ingredient} className="flex flex-col items-center gap-1">
              <div
                className="relative w-16"
                style={{ height: 96 + Math.max(0, count - 1) * overlapStep }}
              >
                {roundEnd.sortedIngredients[ingredient].map((_, i) => (
                  <div key={i} className="absolute inset-x-0" style={{ top: i * overlapStep }}>
                    <IngredientCardView ingredient={ingredient} />
                  </div>
                ))}
              </div>
              <span className="text-xs opacity-70">
                {INGREDIENT_LABEL[ingredient]}: {count}
              </span>
            </div>
          );
        })}
      </section>

      {!pending && roundEnd.lastRevealed && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm opacity-70">Zuletzt aufgedeckt:</p>
          {roundEnd.lastRevealed.kind === 'ingredient' ? (
            <IngredientCardView ingredient={roundEnd.lastRevealed.ingredient} />
          ) : (
            <OrderCardView
              color={roundEnd.lastRevealed.color}
              name={roundEnd.lastRevealed.name}
              requirement={roundEnd.lastRevealed.requirement}
            />
          )}
        </div>
      )}

      {!pending && roundEnd.queue.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm opacity-70">Verbleibende Karten im Ofen: {roundEnd.queue.length}</p>
          <button type="button" onClick={() => actions.revealNext()} className="btn-primary px-6 py-3">
            Nächste Karte aufdecken
          </button>
        </div>
      )}

      {!pending && roundEnd.queue.length === 0 && (
        <section className="pizzeria-panel flex flex-col items-center gap-3 p-4">
          <h2 className="font-script text-2xl text-[var(--tomato)]">Rundenübersicht nach Runde {state.round}</h2>
          <div className="w-full max-w-md overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--crust-border)' }}>
                  <th className="py-1">Spieler</th>
                  <th className="py-1">Lieferungen gesamt</th>
                  <th className="py-1">Handkarten</th>
                </tr>
              </thead>
              <tbody>
                {[...state.players]
                  .sort((a, b) => b.delivered.length - a.delivered.length)
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="py-1">{playerBadge(p)}{p.name}</td>
                      <td className="py-1">{p.delivered.length}</td>
                      <td className="py-1">{p.hand.length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => actions.revealNext()} className="btn-primary px-6 py-3">
            {state.round >= state.maxRounds ? 'Endergebnis anzeigen' : 'Nächste Runde beginnen'}
          </button>
        </section>
      )}

      {pending?.type === 'awaitingJokerChoice' && (
        <PendingCard
          title={`${pending.order.name}: Joker-Zutat wählen`}
          order={pending.order}
          subtitle="Du brauchst 6 Karten dieser Zutat (Tisch + Hand-Ergänzung)."
        >
          <div className="flex flex-wrap justify-center gap-2">
            {INGREDIENTS.filter((i) => i !== PERSONAL_INGREDIENT[pending.order.color]).map((ingredient) => (
              <ChoiceButton
                key={ingredient}
                ingredient={ingredient}
                table={roundEnd.sortedIngredients[ingredient].length}
                hand={myHandCounts[ingredient] ?? 0}
                need={6}
                showHand={me !== null}
                onClick={() => actions.chooseJoker(ingredient)}
              />
            ))}
          </div>
        </PendingCard>
      )}

      {pending?.type === 'awaitingMinimaleChoice' && (
        <PendingCard
          title={`${pending.order.name}: seltenste Zutat wählen (Gleichstand)`}
          order={pending.order}
          subtitle="Du brauchst 3 Karten dieser Zutat (Tisch + Hand-Ergänzung)."
        >
          <div className="flex flex-wrap justify-center gap-2">
            {pending.candidates.map((ingredient) => (
              <ChoiceButton
                key={ingredient}
                ingredient={ingredient}
                table={roundEnd.sortedIngredients[ingredient].length}
                hand={myHandCounts[ingredient] ?? 0}
                need={3}
                showHand={me !== null}
                onClick={() => actions.chooseMinimaleIngredient(ingredient)}
              />
            ))}
          </div>
        </PendingCard>
      )}

      {pending?.type === 'awaitingHandTopUp' && (
        <PendingCard
          title={`${pending.order.name}: Zutaten fehlen`}
          order={pending.order}
          subtitle={`Fehlend: ${Object.entries(pending.shortfall)
            .map(([i, n]) => `${n}x ${INGREDIENT_LABEL[i as Ingredient]}`)
            .join(', ')}`}
        >
          <HandTopUpPicker
            hand={ownerHand(state, pending.order.color)}
            selected={selectedHandCards}
            onToggle={toggleHandCard}
          />
          <p className="text-xs opacity-60">
            Ausgewählt: {describeSelection(state, pending.order.color, selectedHandCards)}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                actions.resolveHandTopUp(null);
                setSelectedHandCards([]);
              }}
              className="btn-secondary px-4 py-2"
            >
              Nicht möglich
            </button>
            <button
              type="button"
              disabled={!matchesShortfall(state, pending.order.color, selectedHandCards, pending.shortfall)}
              onClick={() => {
                actions.resolveHandTopUp(selectedHandCards);
                setSelectedHandCards([]);
              }}
              className="btn-primary px-4 py-2"
            >
              Ergänzen und liefern
            </button>
          </div>
        </PendingCard>
      )}

      {me && <MyHandStrip player={me} />}
      {me && (
        <RecipeChecklist
          player={me}
          oven={[...roundEnd.queue, ...(pending ? [pending.order] : [])]}
        />
      )}

      <LogPanel state={state} />
    </div>
  );
}

function countIngredients(hand: { kind: string; ingredient?: Ingredient }[]): Partial<Record<Ingredient, number>> {
  const counts: Partial<Record<Ingredient, number>> = {};
  for (const card of hand) {
    if (card.kind === 'ingredient' && card.ingredient) counts[card.ingredient] = (counts[card.ingredient] ?? 0) + 1;
  }
  return counts;
}

function ChoiceButton({
  ingredient,
  table,
  hand,
  need,
  showHand,
  onClick,
}: {
  ingredient: Ingredient;
  table: number;
  hand: number;
  need: number;
  showHand: boolean;
  onClick: () => void;
}) {
  const deliverable = table + hand >= need;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-lg border-2 px-4 py-2 hover:border-[var(--tomato)]"
      style={{ borderColor: deliverable ? 'var(--basil, #4a7c2f)' : 'var(--crust-border)' }}
    >
      <span className="font-semibold">{INGREDIENT_LABEL[ingredient]}</span>
      <span className="text-xs opacity-70">
        Tisch: {table}
        {showHand && ` · Hand: ${hand}`}
      </span>
    </button>
  );
}

function MyHandStrip({ player }: { player: GameState['players'][number] }) {
  const ingredients = player.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide uppercase opacity-60">Meine Handkarten ({ingredients.length})</h2>
      <div className="pizzeria-panel flex flex-col gap-3 p-4">
        {player.handOrders.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {player.handOrders.map((order) => (
              <OrderCardView key={order.id} color={order.color} name={order.name} requirement={order.requirement} />
            ))}
          </div>
        )}
        {ingredients.length === 0 ? (
          <p className="text-center text-sm opacity-50">Keine Zutatenkarten auf der Hand.</p>
        ) : (
          <div className="flex flex-wrap justify-center">
            {ingredients.map((c, i) => (
              <div key={c.id} className={i > 0 ? '-ml-4' : ''}>
                <IngredientCardView ingredient={c.ingredient} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ownerHand(state: GameState, color: GameState['players'][number]['color']): IngredientCard[] {
  const owner = state.players.find((p) => p.color === color)!;
  return owner.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
}

function groupSelection(state: GameState, color: GameState['players'][number]['color'], selected: CardId[]): Partial<Record<Ingredient, number>> {
  const hand = ownerHand(state, color);
  const grouped: Partial<Record<Ingredient, number>> = {};
  for (const id of selected) {
    const card = hand.find((c) => c.id === id);
    if (card) grouped[card.ingredient] = (grouped[card.ingredient] ?? 0) + 1;
  }
  return grouped;
}

/** Exact-match check mirroring scoring.ts's resolveHandTopUp validation, so the button only enables on a valid selection instead of failing silently after the click. */
function matchesShortfall(
  state: GameState,
  color: GameState['players'][number]['color'],
  selected: CardId[],
  shortfall: Partial<Record<Ingredient, number>>,
): boolean {
  const grouped = groupSelection(state, color, selected);
  const shortfallEntries = Object.entries(shortfall) as [Ingredient, number][];
  if (Object.keys(grouped).length !== shortfallEntries.length) return false;
  return shortfallEntries.every(([ingredient, count]) => grouped[ingredient] === count);
}

function describeSelection(state: GameState, color: GameState['players'][number]['color'], selected: CardId[]): string {
  const grouped = groupSelection(state, color, selected);
  const entries = Object.entries(grouped) as [Ingredient, number][];
  if (entries.length === 0) return 'nichts';
  return entries.map(([ingredient, count]) => `${count}x ${INGREDIENT_LABEL[ingredient]}`).join(', ');
}

function HandTopUpPicker({
  hand,
  selected,
  onToggle,
}: {
  hand: IngredientCard[];
  selected: CardId[];
  onToggle: (id: CardId) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {hand.map((card) => (
        <IngredientCardView
          key={card.id}
          ingredient={card.ingredient}
          selected={selected.includes(card.id)}
          onClick={() => onToggle(card.id)}
        />
      ))}
    </div>
  );
}

function PendingCard({
  title,
  subtitle,
  order,
  children,
}: {
  title: string;
  subtitle?: string;
  order: { color: GameState['players'][number]['color']; name: string; requirement: OrderRequirement };
  children: React.ReactNode;
}) {
  return (
    <section className="pizzeria-panel flex flex-col items-center gap-3 p-4">
      <h2 className="font-script text-xl text-[var(--tomato)]">{title}</h2>
      {subtitle && <p className="text-sm opacity-70">{subtitle}</p>}
      <OrderCardView color={order.color} name={order.name} requirement={order.requirement} />
      {children}
    </section>
  );
}
