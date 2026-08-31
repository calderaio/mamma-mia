import { useState } from 'react';
import type { CardId, GameState, IngredientCard } from '../game/types';
import type { Ingredient } from '../game/ingredients';
import type { Preferences } from '../game/preferences';
import { PLAYER_COLOR_CLASS, PLAYER_LABEL, playerBadge } from '../game/colors';
import { FaceDownStack, IngredientCardView, OrderCardView, OvenStackView } from './Card';

interface Actions {
  placeIngredients: (cardIds: CardId[]) => void;
  placeNoIngredients: () => void;
  placeOrder: (cardId: CardId | null) => void;
  drawCards: (source: 'supply' | 'waiter') => void;
}

export function TurnScreen({
  state,
  actions,
  error,
  preferences,
}: {
  state: GameState;
  actions: Actions;
  error: string | null;
  preferences: Preferences;
}) {
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<CardId[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<CardId | null>(null);
  if (state.phase.name !== 'turn') return null;
  const player = state.players[state.currentPlayerIndex];

  const ingredientCards = player.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
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
        <div>
          <span className="text-sm opacity-70">Runde {state.round} / {state.maxRounds}</span>
          <h1 className={`ml-3 inline-block rounded-full border-2 px-4 py-1 font-bold ${PLAYER_COLOR_CLASS[player.color]}`}>
            {playerBadge(player)}{player.name} ist am Zug
          </h1>
        </div>
      </header>

      <section className="pizzeria-panel flex flex-wrap items-end justify-center gap-6 p-4">
        <FaceDownStack count={state.supply.length} label="Nachziehstapel" />
        <OvenStackView count={state.oven.length} topCard={state.oven.at(-1) ?? null} messy={preferences.messyPile} />
        <FaceDownStack count={player.waiter.length} label="Mein Kellner-Stapel" />
        <FaceDownStack count={player.delivered.length} label="Meine Lieferungen" />
      </section>

      <section className="flex flex-wrap justify-center gap-3">
        {state.players
          .filter((p) => p.id !== player.id)
          .map((p) => (
            <div
              key={p.id}
              className={`rounded-lg border px-3 py-2 text-xs ${PLAYER_COLOR_CLASS[p.color]} bg-opacity-30`}
            >
              <div className="font-semibold">
                {playerBadge(p)}
                {PLAYER_LABEL[p.color]} – {p.name}
              </div>
              <div>Kellner: {p.waiter.length} · Lieferungen: {p.delivered.length}</div>
            </div>
          ))}
      </section>

      {error && <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>}

      {state.phase.step === 'ingredients' && (
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

      {state.phase.step === 'order' && (
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-script text-2xl text-[var(--tomato)]">2. Optional: eine Bestellkarte legen</h2>
          <div className="flex flex-wrap justify-center gap-2">
            {player.handOrders.map((order) => (
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

      {state.phase.step === 'draw' && (
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
              disabled={player.waiter.length === 0}
              onClick={() => actions.drawCards('waiter')}
              className="btn-primary px-5 py-2"
            >
              Vom Kellner-Stapel ({player.waiter.length})
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold opacity-70">Meine Bestellkarte(n) – welche Zutaten du sammeln willst</h2>
        <div className="flex flex-wrap gap-2">
          {player.handOrders.length === 0 && <p className="text-sm opacity-50">Keine Bestellkarte auf der Hand.</p>}
          {player.handOrders.map((order) => (
            <OrderCardView key={order.id} color={order.color} name={order.name} requirement={order.requirement} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold opacity-70">Zutatenkarten auf der Hand</h2>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((c) =>
            c.kind === 'ingredient' ? <IngredientCardView key={c.id} ingredient={c.ingredient} /> : null,
          )}
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
