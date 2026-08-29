import { INGREDIENTS, type Ingredient } from './ingredients';
import { PERSONAL_INGREDIENT } from './colors';
import { GameError } from './engine';
import { makeMammaMiaCard } from './cards';
import { shuffle, type RandomFn } from './random';
import type {
  CardId,
  GameState,
  IngredientCard,
  OrderCard,
  Player,
  RoundEndState,
} from './types';

function emptySorted(): Record<Ingredient, IngredientCard[]> {
  const record = {} as Record<Ingredient, IngredientCard[]>;
  for (const ingredient of INGREDIENTS) record[ingredient] = [];
  return record;
}

function addLog(state: GameState, message: string): GameState {
  return {
    ...state,
    log: [...state.log, { id: state.nextLogId, round: state.round, message }],
    nextLogId: state.nextLogId + 1,
  };
}

function replacePlayer(state: GameState, playerId: string, update: (player: Player) => Player): GameState {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? update(p) : p)) };
}

/** Begins round-end scoring: the Mamma Mia! holder reveals the oven stack in original placement order. */
export function startRoundEnd(state: GameState): GameState {
  if (state.phase.name !== 'roundEnd') throw new GameError('Not in roundEnd phase');
  const holder = state.players.find((p) => p.hasMammaMia);
  if (!holder) throw new GameError('No Mamma Mia! holder found');

  // `oven` was built by appending cards as they were played (index 0 =
  // first placed, physically at the bottom; last index = most recently
  // placed, physically on top). Per the rules, the Mamma Mia player picks
  // up the whole stack and "turns it over in his hand" as one motion before
  // dealing one at a time from the new top. Flipping an entire packet
  // inverts which end is "top" — so the reveal order is exactly the
  // original placement order: the first card ever placed this round is
  // revealed first, the most recent one last. This also matches the rules'
  // own framing ("place order cards when you believe the ingredients are
  // ALREADY in the oven") — only what was placed before an order counts,
  // never what gets added after it.
  const queue = [...state.oven];

  const roundEnd: RoundEndState = {
    holderId: holder.id,
    queue,
    sortedIngredients: emptySorted(),
    usedIngredients: [],
    pending: null,
    lastRevealed: null,
  };
  return addLog({ ...state, oven: [], roundEnd }, `${holder.name} deckt den Ofen auf.`);
}

function totalSorted(sorted: Record<Ingredient, IngredientCard[]>): number {
  return INGREDIENTS.reduce((sum, i) => sum + sorted[i].length, 0);
}

function shortfallFor(
  required: Partial<Record<Ingredient, number>>,
  sorted: Record<Ingredient, IngredientCard[]>,
): Partial<Record<Ingredient, number>> {
  const shortfall: Partial<Record<Ingredient, number>> = {};
  for (const [ingredient, count] of Object.entries(required) as [Ingredient, number][]) {
    const available = sorted[ingredient].length;
    if (available < count) shortfall[ingredient] = count - available;
  }
  return shortfall;
}

function isEmptyShortfall(shortfall: Partial<Record<Ingredient, number>>): boolean {
  return Object.values(shortfall).every((v) => !v);
}

/** Fulfil an order using table ingredients only (no shortfall); returns updated state. */
function fulfillFromTable(
  state: GameState,
  order: OrderCard,
  required: Partial<Record<Ingredient, number>>,
): GameState {
  const roundEnd = state.roundEnd!;
  const sorted = { ...roundEnd.sortedIngredients };
  const used: IngredientCard[] = [];
  for (const [ingredient, count] of Object.entries(required) as [Ingredient, number][]) {
    const pile = [...sorted[ingredient]];
    const taken = pile.splice(0, count);
    used.push(...taken);
    sorted[ingredient] = pile;
  }
  const owner = state.players.find((p) => p.color === order.color)!;
  let next = replacePlayer(state, owner.id, (p) => ({ ...p, delivered: [...p.delivered, order] }));
  next = {
    ...next,
    roundEnd: {
      ...next.roundEnd!,
      sortedIngredients: sorted,
      usedIngredients: [...next.roundEnd!.usedIngredients, ...used],
      pending: null,
    },
  };
  return addLog(next, `${owner.name} liefert ${order.name} aus!`);
}

function failOrder(state: GameState, order: OrderCard): GameState {
  const owner = state.players.find((p) => p.color === order.color)!;
  let next = replacePlayer(state, owner.id, (p) => ({ ...p, waiter: [...p.waiter, order] }));
  next = { ...next, roundEnd: { ...next.roundEnd!, pending: null } };
  return addLog(next, `${owner.name} kann ${order.name} nicht fertigstellen. Zurück in den Kellner-Stapel.`);
}

function beginResolution(state: GameState, order: OrderCard, required: Partial<Record<Ingredient, number>>): GameState {
  const roundEnd = state.roundEnd!;
  const shortfall = shortfallFor(required, roundEnd.sortedIngredients);
  if (isEmptyShortfall(shortfall)) {
    return fulfillFromTable(state, order, required);
  }
  return {
    ...state,
    roundEnd: { ...roundEnd, pending: { type: 'awaitingHandTopUp', order, required, shortfall } },
  };
}

function minimaleCandidates(
  sorted: Record<Ingredient, IngredientCard[]>,
  personal: Ingredient,
): Ingredient[] {
  const withCounts = INGREDIENTS.filter((i) => i !== personal && sorted[i].length > 0);
  if (withCounts.length === 0) return [];
  const min = Math.min(...withCounts.map((i) => sorted[i].length));
  return withCounts.filter((i) => sorted[i].length === min);
}

/** Reveal the next card from the oven queue. Throws if a pending decision is outstanding. */
export function revealNext(state: GameState): GameState {
  const roundEnd = state.roundEnd;
  if (!roundEnd) throw new GameError('No round-end in progress');
  if (roundEnd.pending) throw new GameError('A decision is pending; resolve it before revealing further');

  if (roundEnd.queue.length === 0) {
    return finalizeRound(state);
  }

  const [card, ...rest] = roundEnd.queue;
  let next: GameState = { ...state, roundEnd: { ...roundEnd, queue: rest, lastRevealed: card } };

  if (card.kind === 'ingredient') {
    const sorted = { ...next.roundEnd!.sortedIngredients };
    sorted[card.ingredient] = [...sorted[card.ingredient], card];
    next = { ...next, roundEnd: { ...next.roundEnd!, sortedIngredients: sorted } };
    return addLog(next, `Aufgedeckt: ${card.ingredient}.`);
  }

  const order = card;
  next = addLog(next, `Aufgedeckt: Bestellkarte (${order.name}).`);
  const owner = next.players.find((p) => p.color === order.color)!;
  const personal = PERSONAL_INGREDIENT[owner.color];

  switch (order.requirement.kind) {
    case 'normal':
      return beginResolution(next, order, order.requirement.requirements);
    case 'bombastica': {
      // No hand top-up for Bombastica per the rules: the oven must already
      // hold 15+ ingredients on its own, or the order fails outright.
      const total = totalSorted(next.roundEnd!.sortedIngredients);
      if (total < 15) {
        return failOrder(next, order);
      }
      // Takes everything currently sorted, regardless of exact excess over 15.
      const sorted = next.roundEnd!.sortedIngredients;
      const required: Partial<Record<Ingredient, number>> = {};
      for (const ingredient of INGREDIENTS) required[ingredient] = sorted[ingredient].length;
      return fulfillFromTable(next, order, required);
    }
    case 'monotoni':
      return {
        ...next,
        roundEnd: { ...next.roundEnd!, pending: { type: 'awaitingJokerChoice', order } },
      };
    case 'minimale': {
      const candidates = minimaleCandidates(next.roundEnd!.sortedIngredients, personal);
      if (candidates.length === 0) {
        return failOrder(next, order);
      }
      if (candidates.length === 1) {
        const required: Partial<Record<Ingredient, number>> = {
          [personal]: 1,
          [candidates[0]]: order.requirement.otherCount,
        };
        return beginResolution(next, order, required);
      }
      return {
        ...next,
        roundEnd: { ...next.roundEnd!, pending: { type: 'awaitingMinimaleChoice', order, candidates } },
      };
    }
  }
}

export function chooseJoker(state: GameState, ingredient: Ingredient): GameState {
  const pending = state.roundEnd?.pending;
  if (!pending || pending.type !== 'awaitingJokerChoice') throw new GameError('No joker choice pending');
  const owner = state.players.find((p) => p.color === pending.order.color)!;
  const personal = PERSONAL_INGREDIENT[owner.color];
  if (ingredient === personal) throw new GameError('Cannot choose personal ingredient as joker');
  if (pending.order.requirement.kind !== 'monotoni') throw new GameError('Order is not a Monotoni pizza');
  const required: Partial<Record<Ingredient, number>> = { [personal]: 1, [ingredient]: pending.order.requirement.jokerCount };
  return beginResolution(state, pending.order, required);
}

export function chooseMinimaleIngredient(state: GameState, ingredient: Ingredient): GameState {
  const pending = state.roundEnd?.pending;
  if (!pending || pending.type !== 'awaitingMinimaleChoice') throw new GameError('No Minimale choice pending');
  if (!pending.candidates.includes(ingredient)) throw new GameError('Ingredient is not a valid Minimale choice');
  const owner = state.players.find((p) => p.color === pending.order.color)!;
  const personal = PERSONAL_INGREDIENT[owner.color];
  if (pending.order.requirement.kind !== 'minimale') throw new GameError('Order is not a Minimale pizza');
  const required: Partial<Record<Ingredient, number>> = { [personal]: 1, [ingredient]: pending.order.requirement.otherCount };
  return beginResolution(state, pending.order, required);
}

function takeCardsFromHand(owner: Player, cardIds: CardId[]): IngredientCard[] {
  return cardIds.map((id) => {
    const card = owner.hand.find((c) => c.id === id);
    if (!card || card.kind !== 'ingredient') throw new GameError(`Card ${id} is not an ingredient card in hand`);
    return card;
  });
}

function deliverWithHandCards(
  state: GameState,
  order: OrderCard,
  owner: Player,
  required: Partial<Record<Ingredient, number>>,
  handCards: IngredientCard[],
): GameState {
  const roundEnd = state.roundEnd!;
  const sorted = { ...roundEnd.sortedIngredients };
  const usedFromTable: IngredientCard[] = [];
  for (const [ingredient, count] of Object.entries(required) as [Ingredient, number][]) {
    const pile = [...sorted[ingredient]];
    const taken = pile.splice(0, count);
    usedFromTable.push(...taken);
    sorted[ingredient] = pile;
  }

  const usedCardIds = new Set(handCards.map((c) => c.id));
  let next = replacePlayer(state, owner.id, (p) => ({
    ...p,
    hand: p.hand.filter((c) => !usedCardIds.has(c.id)),
    delivered: [...p.delivered, order],
  }));
  next = {
    ...next,
    roundEnd: {
      ...next.roundEnd!,
      sortedIngredients: sorted,
      usedIngredients: [...next.roundEnd!.usedIngredients, ...usedFromTable, ...handCards],
      pending: null,
    },
  };
  return addLog(next, `${owner.name} ergänzt aus der Hand und liefert ${order.name} aus!`);
}

/**
 * Resolve an "awaitingHandTopUp" decision for a normal/Monotoni/Minimale
 * order. Pass the ids of ingredient cards from the order owner's hand that
 * exactly cover the shortfall, or `null`/empty to give up (the order fails).
 */
export function resolveHandTopUp(state: GameState, cardIds: CardId[] | null): GameState {
  const pending = state.roundEnd?.pending;
  if (!pending || pending.type !== 'awaitingHandTopUp') throw new GameError('No hand top-up pending');
  const order = pending.order;
  const owner = state.players.find((p) => p.color === order.color)!;

  if (cardIds === null || cardIds.length === 0) {
    return failOrder(state, order);
  }

  const cards = takeCardsFromHand(owner, cardIds);
  const grouped: Partial<Record<Ingredient, number>> = {};
  for (const card of cards) grouped[card.ingredient] = (grouped[card.ingredient] ?? 0) + 1;
  for (const [ingredient, count] of Object.entries(pending.shortfall) as [Ingredient, number][]) {
    if (grouped[ingredient] !== count) {
      throw new GameError(`Must add exactly ${count}x ${ingredient} from hand`);
    }
  }
  if (Object.keys(grouped).length !== Object.keys(pending.shortfall).length) {
    throw new GameError('Added cards do not match the shortfall');
  }

  return deliverWithHandCards(state, order, owner, pending.required, cards);
}

export interface FinalizeRoundOptions {
  random?: RandomFn;
}

/** Called once the reveal queue is empty: sets up the next round or ends the game. */
export function finalizeRound(state: GameState, options: FinalizeRoundOptions = {}): GameState {
  const roundEnd = state.roundEnd;
  if (!roundEnd) throw new GameError('No round-end in progress');
  const random = options.random ?? Math.random;

  const holderIndex = state.players.findIndex((p) => p.id === roundEnd.holderId);
  const leftoverIngredients = INGREDIENTS.flatMap((i) => roundEnd.sortedIngredients[i]);

  // The leftover cards' composition is exactly known at this instant (everyone
  // just watched them get sorted during the reveal), so the tally for the new
  // round starts from that snapshot rather than zero.
  const leftoverTally = {} as Record<Ingredient, number>;
  for (const ingredient of INGREDIENTS) leftoverTally[ingredient] = roundEnd.sortedIngredients[ingredient].length;

  let next = addLog(state, 'Der Ofen wurde vollständig ausgewertet.');
  next = {
    ...next,
    players: next.players.map((p) => ({ ...p, hasMammaMia: false })),
    oven: leftoverIngredients,
    ovenIngredientTally: leftoverTally,
    roundEnd: undefined,
  };

  if (state.round >= state.maxRounds) {
    const maxDelivered = Math.max(...next.players.map((p) => p.delivered.length));
    const topByDelivered = next.players.filter((p) => p.delivered.length === maxDelivered);
    const maxHand = Math.max(...topByDelivered.map((p) => p.hand.length));
    const winners = topByDelivered.filter((p) => p.hand.length === maxHand);
    return addLog(
      { ...next, phase: { name: 'gameEnd' }, winnerIds: winners.map((w) => w.id) },
      `Spielende! Gewinner: ${winners.map((w) => w.name).join(', ')}.`,
    );
  }

  const newSupply = shuffle([...roundEnd.usedIngredients, makeMammaMiaCard()], random);
  return addLog(
    { ...next, round: next.round + 1, supply: newSupply, phase: { name: 'passDevice', nextPlayerIndex: holderIndex } },
    `Runde ${next.round + 1} beginnt.`,
  );
}
