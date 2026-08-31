import { useState } from 'react';
import type { CardId, GameState, IngredientCard, Player } from '../game/types';
import type { Ingredient } from '../game/ingredients';
import type { Preferences } from '../game/preferences';
import type { BotStep } from '../game/useGame';
import { PLAYER_COLOR_CLASS, PLAYER_LABEL, playerBadge } from '../game/colors';
import { FaceDownStack, IngredientCardView, OrderCardView, OvenStackView } from './Card';
import { BotStepVisual } from './BotTurnScreen';
import { RecipeChecklist } from './RecipeChecklist';

interface Actions {
  placeIngredients: (cardIds: CardId[]) => void;
  placeNoIngredients: () => void;
  placeOrder: (cardId: CardId | null) => void;
  drawCards: (source: 'supply' | 'waiter') => void;
}

/**
 * The persistent table view. Whether it's your turn or a bot's, this stays
 * on screen: the shared table (supply + oven) in the middle, the other
 * guests' stacks along the top, and your own hand/orders/stacks always
 * visible at the bottom — like actually sitting at the table. A bot's move
 * shows up as a banner at the table instead of swapping the whole screen
 * away from your hand.
 */
export function TurnScreen({
  state,
  actions,
  error,
  preferences,
  botStep,
}: {
  state: GameState;
  actions: Actions;
  error: string | null;
  preferences: Preferences;
  botStep: BotStep | null;
}) {
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<CardId[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<CardId | null>(null);
  if (state.phase.name !== 'turn' && state.phase.name !== 'passDevice') return null;

  const actingPlayer: Player =
    state.phase.name === 'turn' ? state.players[state.currentPlayerIndex] : state.players[state.phase.nextPlayerIndex];
  // With exactly one human at the table, always show THEIR hand regardless
  // of whose turn it is. With 2+ humans (real hotseat), fall back to
  // whoever's actually acting, since hiding hands between different
  // people still matters there.
  const humans = state.players.filter((p) => !p.isBot);
  const me = humans.length === 1 ? humans[0] : actingPlayer;
  const isMyTurn = state.phase.name === 'turn' && actingPlayer.id === me.id;
  const myStep = isMyTurn && state.phase.name === 'turn' ? state.phase.step : null;

  const ingredientCards = me.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
  const hasIngredients = ingredientCards.length > 0;
  const selectedKind: Ingredient | null =
    selectedIngredientIds.length > 0
      ? (ingredientCards.find((c) => c.id === selectedIngredientIds[0])?.ingredient ?? null)
      : null;

  function toggleIngredient(card: IngredientCard) {
    setSelectedIngredientIds((prev) => {
      if (prev.includes(card.id)) return prev.filter((id) => id !== card.id);
      if (selectedKind && card.ingredient !== selectedKind) return [card.id];
      return [...prev, card.id];
    });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <span className="text-sm opacity-70">Runde {state.round} / {state.maxRounds}</span>
        <h1 className={`inline-block rounded-full border-2 px-4 py-1 font-bold ${PLAYER_COLOR_CLASS[actingPlayer.color]}`}>
          {playerBadge(actingPlayer)}{actingPlayer.name} ist am Zug
        </h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide uppercase opacity-60">Der Tisch</h2>
        <div className="pizzeria-panel flex flex-wrap items-end justify-center gap-6 p-4">
          <FaceDownStack count={state.supply.length} label="Nachziehstapel" />
          <OvenStackView count={state.oven.length} topCard={state.oven.at(-1) ?? null} messy={preferences.messyPile} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide uppercase opacity-60">Die anderen Gäste</h2>
        <div className="flex flex-wrap justify-center gap-3">
          {state.players
            .filter((p) => p.id !== me.id)
            .map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2 text-xs ${PLAYER_COLOR_CLASS[p.color]} bg-opacity-30 ${
                  p.id === actingPlayer.id ? 'ring-2 ring-white' : ''
                }`}
              >
                <div className="font-semibold">
                  {playerBadge(p)}
                  {PLAYER_LABEL[p.color]} – {p.name}
                </div>
                <div>Kellner: {p.waiter.length} · Lieferungen: {p.delivered.length}</div>
              </div>
            ))}
        </div>
      </section>

      {error && <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>}

      {!isMyTurn && botStep && (
        <section className="pizzeria-panel flex flex-col items-center gap-3 p-4">
          <h2 className="font-script text-xl text-[var(--tomato)]">
            {playerBadge(actingPlayer)}{actingPlayer.name} spielt…
          </h2>
          {botStep.visual && <BotStepVisual visual={botStep.visual} />}
          <p>{botStep.message}</p>
          <button type="button" onClick={botStep.run} className="btn-primary px-6 py-3">
            Weiter
          </button>
        </section>
      )}

      {isMyTurn && state.phase.name === 'turn' && state.phase.step === 'ingredients' && (
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-script text-2xl text-[var(--tomato)]">1. Zutaten in den Ofen legen (Pflicht, alle gleich)</h2>
          {!hasIngredients ? (
            <>
              <p className="text-sm opacity-70">Keine Zutatenkarte auf der Hand – du musst aussetzen.</p>
              <button type="button" onClick={() => actions.placeNoIngredients()} className="btn-secondary px-5 py-2">
                Aussetzen
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap justify-center gap-2">
                {ingredientCards.map((card) => (
                  <IngredientCardView
                    key={card.id}
                    ingredient={card.ingredient}
                    selected={selectedIngredientIds.includes(card.id)}
                    onClick={() => toggleIngredient(card)}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={selectedIngredientIds.length === 0}
                onClick={() => {
                  actions.placeIngredients(selectedIngredientIds);
                  setSelectedIngredientIds([]);
                }}
                className="btn-primary px-5 py-2"
              >
                {selectedIngredientIds.length}x in den Ofen legen
              </button>
            </>
          )}
        </section>
      )}

      {isMyTurn && state.phase.name === 'turn' && state.phase.step === 'order' && (
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-script text-2xl text-[var(--tomato)]">2. Optional: eine Bestellkarte legen</h2>
          <div className="flex flex-wrap justify-center gap-2">
            {me.handOrders.map((order) => (
              <OrderCardView
                key={order.id}
                color={order.color}
                name={order.name}
                requirement={order.requirement}
                selected={selectedOrderId === order.id}
                onClick={() => setSelectedOrderId((prev) => (prev === order.id ? null : order.id))}
              />
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => actions.placeOrder(null)} className="btn-secondary px-5 py-2">
              Überspringen
            </button>
            <button
              type="button"
              disabled={!selectedOrderId}
              onClick={() => {
                actions.placeOrder(selectedOrderId);
                setSelectedOrderId(null);
              }}
              className="btn-primary px-5 py-2"
            >
              Bestellung legen
            </button>
          </div>
        </section>
      )}

      {isMyTurn && state.phase.name === 'turn' && state.phase.step === 'draw' && (
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-script text-2xl text-[var(--tomato)]">3. Nachziehen auf 7 Karten (nur ein Stapel)</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              disabled={state.supply.length === 0}
              onClick={() => actions.drawCards('supply')}
              className="btn-primary px-5 py-2"
            >
              Vom Nachziehstapel ({state.supply.length})
            </button>
            <button
              type="button"
              disabled={me.waiter.length === 0}
              onClick={() => actions.drawCards('waiter')}
              className="btn-primary px-5 py-2"
            >
              Vom Kellner-Stapel ({me.waiter.length})
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide uppercase opacity-60">Mein Platz</h2>
        <div className="pizzeria-panel flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end justify-center gap-6">
            <FaceDownStack count={me.waiter.length} label="Mein Kellner-Stapel" />
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold opacity-70">Meine gelieferten Pizzen ({me.delivered.length})</h3>
            {me.delivered.length === 0 ? (
              <p className="text-center text-sm opacity-50">Noch keine Pizza geliefert.</p>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {me.delivered.map((order) => (
                  <OrderCardView
                    key={order.id}
                    color={order.color}
                    name={order.name}
                    requirement={order.requirement}
                    note="✓ geliefert"
                  />
                ))}
              </div>
            )}
          </div>

          {myStep !== 'order' && (
            <div>
              <h3 className="mb-1 text-sm font-semibold opacity-70">Meine Bestellkarte(n)</h3>
              <div className="flex flex-wrap justify-center gap-2">
                {me.handOrders.length === 0 && <p className="text-sm opacity-50">Keine Bestellkarte auf der Hand.</p>}
                {me.handOrders.map((order) => (
                  <OrderCardView key={order.id} color={order.color} name={order.name} requirement={order.requirement} />
                ))}
              </div>
            </div>
          )}

          {myStep !== 'ingredients' && (
            <div>
              <h3 className="mb-1 text-sm font-semibold opacity-70">Meine Handkarten</h3>
              {/* Slight overlap so the hand reads like cards actually held in hand, not a grid. */}
              <div className="flex flex-wrap justify-center">
                {me.hand.map((c, i) =>
                  c.kind === 'ingredient' ? (
                    <div key={c.id} className={i > 0 ? '-ml-4' : ''}>
                      <IngredientCardView ingredient={c.ingredient} />
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}

          <RecipeChecklist player={me} oven={state.oven} />
        </div>
      </section>

      <LogPanel state={state} />
    </div>
  );
}

export function LogPanel({ state }: { state: GameState }) {
  return (
    <details className="pizzeria-panel p-3 text-sm">
      <summary className="cursor-pointer font-semibold">📜 Ereignisprotokoll</summary>
      <ul className="mt-2 max-h-48 overflow-y-auto opacity-80">
        {[...state.log]
          .slice(-30)
          .reverse()
          .map((entry) => (
            <li key={entry.id}>· {entry.message}</li>
          ))}
      </ul>
    </details>
  );
}
