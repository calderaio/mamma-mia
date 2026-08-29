import type { CardId, GameState, IngredientCard, Player, SupplyCard } from './types';

export class GameError extends Error {}

function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

function replacePlayer(state: GameState, playerId: string, update: (player: Player) => Player): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? update(p) : p)),
  };
}

function addLog(state: GameState, message: string): GameState {
  return {
    ...state,
    log: [...state.log, { id: state.nextLogId, round: state.round, message }],
    nextLogId: state.nextLogId + 1,
  };
}

function assertPhaseStep(state: GameState, step: 'ingredients' | 'order' | 'draw'): void {
  if (state.phase.name !== 'turn' || state.phase.step !== step) {
    throw new GameError(`Expected phase turn/${step}, got ${JSON.stringify(state.phase)}`);
  }
}

export function playerHasIngredientInHand(player: Player): boolean {
  return player.hand.some((c) => c.kind === 'ingredient');
}

/**
 * Special case: a player with zero ingredient cards in hand must skip both
 * the ingredient-placement and order-placement steps, going straight to draw.
 */
export function placeNoIngredients(state: GameState): GameState {
  assertPhaseStep(state, 'ingredients');
  const player = currentPlayer(state);
  if (playerHasIngredientInHand(player)) {
    throw new GameError('Player has ingredient cards and must play at least one');
  }
  let next = addLog(state, `${player.name} hat keine Zutatenkarte und setzt aus.`);
  next = { ...next, phase: { name: 'turn', step: 'draw' } };
  return next;
}

/** Place one or more ingredient cards of the same kind from hand onto the oven. */
export function placeIngredients(state: GameState, cardIds: CardId[]): GameState {
  assertPhaseStep(state, 'ingredients');
  if (cardIds.length === 0) {
    throw new GameError('Must place at least one ingredient card');
  }
  const player = currentPlayer(state);
  const cards = cardIds.map((id) => {
    const card = player.hand.find((c) => c.id === id);
    if (!card) throw new GameError(`Card ${id} not in hand`);
    if (card.kind !== 'ingredient') throw new GameError(`Card ${id} is not an ingredient card`);
    return card;
  });
  const kind = cards[0].ingredient;
  if (!cards.every((c): c is IngredientCard => c.kind === 'ingredient' && c.ingredient === kind)) {
    throw new GameError('All placed ingredient cards must be of the same kind');
  }

  const idsToRemove = new Set(cardIds);
  let next = replacePlayer(state, player.id, (p) => ({
    ...p,
    hand: p.hand.filter((c) => !idsToRemove.has(c.id)),
  }));
  next = {
    ...next,
    oven: [...next.oven, ...cards],
    ovenIngredientTally: { ...next.ovenIngredientTally, [kind]: next.ovenIngredientTally[kind] + cards.length },
  };
  next = addLog(next, `${player.name} legt ${cards.length}x ${kind} in den Ofen.`);
  next = { ...next, phase: { name: 'turn', step: 'order' } };
  return next;
}

/** Optionally place one order card face up on the oven, or pass by omitting cardId. */
export function placeOrder(state: GameState, cardId: CardId | null): GameState {
  assertPhaseStep(state, 'order');
  const player = currentPlayer(state);
  if (cardId === null) {
    return { ...state, phase: { name: 'turn', step: 'draw' } };
  }
  const order = player.handOrders.find((o) => o.id === cardId);
  if (!order) throw new GameError(`Order ${cardId} not in hand`);

  let next = replacePlayer(state, player.id, (p) => ({
    ...p,
    handOrders: p.handOrders.filter((o) => o.id !== cardId),
  }));
  next = { ...next, oven: [...next.oven, order] };
  next = addLog(next, `${player.name} legt die Bestellkarte "${order.name}" in den Ofen.`);
  next = { ...next, phase: { name: 'turn', step: 'draw' } };
  return next;
}

const HAND_SIZE = 7;

/**
 * Draw cards to refill the current player's hand to 7, taking cards only
 * from the supply or only from the player's own waiter pile (never both).
 * If the chosen pile runs out, the player simply ends up with fewer cards.
 * Draws the Mamma Mia! card is handled inline: it is set aside face up and
 * an extra replacement card is drawn immediately from the same pile.
 */
export function drawCards(state: GameState, source: 'supply' | 'waiter'): GameState {
  assertPhaseStep(state, 'draw');
  const player = currentPlayer(state);
  const currentHandCount = player.hand.length + player.handOrders.length;
  const needed = Math.max(0, HAND_SIZE - currentHandCount);

  let next = state;
  let drawnCount = 0;
  let supplyExhausted = false;

  if (source === 'supply') {
    const supply = [...next.supply];
    const drawnIngredients: SupplyCard[] = [];
    let remainingToDraw = needed;
    while (remainingToDraw > 0 && supply.length > 0) {
      const card = supply.shift()!;
      if (card.kind === 'mammamia') {
        next = replacePlayer(next, player.id, (p) => ({ ...p, hasMammaMia: true }));
        next = addLog(next, `${player.name} zieht die Mamma-Mia!-Karte.`);
        // Drawing Mamma Mia does not count toward the hand; draw a replacement.
        continue;
      }
      drawnIngredients.push(card);
      remainingToDraw -= 1;
    }
    if (supply.length === 0) supplyExhausted = true;
    drawnCount = drawnIngredients.length;
    next = { ...next, supply };
    next = replacePlayer(next, player.id, (p) => ({ ...p, hand: [...p.hand, ...drawnIngredients] }));
  } else {
    const waiter = [...player.waiter];
    const take = Math.min(needed, waiter.length);
    const drawn = waiter.splice(0, take);
    drawnCount = drawn.length;
    next = replacePlayer(next, player.id, (p) => ({
      ...p,
      waiter,
      handOrders: [...p.handOrders, ...drawn],
    }));
  }

  next = addLog(
    next,
    `${player.name} zieht ${drawnCount} Karte(n) vom ${source === 'supply' ? 'Nachziehstapel' : 'Kellner-Stapel'}.`,
  );

  if (supplyExhausted) {
    next = addLog(next, 'Der Nachziehstapel ist leer. Die Runde endet.');
    return { ...next, phase: { name: 'roundEnd' } };
  }

  const nextIndex = (next.currentPlayerIndex + 1) % next.players.length;
  return {
    ...next,
    currentPlayerIndex: nextIndex,
    phase: { name: 'passDevice', nextPlayerIndex: nextIndex },
  };
}

export function confirmPassDevice(state: GameState): GameState {
  if (state.phase.name !== 'passDevice') {
    throw new GameError('Not in passDevice phase');
  }
  return {
    ...state,
    currentPlayerIndex: state.phase.nextPlayerIndex,
    phase: { name: 'turn', step: 'ingredients' },
  };
}
