import { INGREDIENTS, zeroIngredientRecord, type Ingredient } from './ingredients';
import { PERSONAL_INGREDIENT } from './colors';
import type { CardId, GameState, IngredientCard, OrderCard, Player } from './types';

/**
 * All bot decisions are made from information a real attentive player
 * would also have: their own hand, the running tally of publicly announced
 * oven placements (`state.ovenIngredientTally` — see its doc comment), and
 * the sorted face-up ingredients during round-end reveal. Bots never peek
 * at genuinely hidden state (other players' hands, supply/waiter order).
 *
 * Every choice a bot makes on its turn is optimised toward one goal:
 * deliver as many of its own order cards as possible while feeding the
 * shared oven as little as it can get away with (every ingredient placed
 * also helps opponents' hidden orders).
 *
 *  1. Which ingredients to play  — push toward the order the bot is best
 *     placed to finish; otherwise shed a single spare card.
 *  2. Whether / which order to play — lock in an order the moment the oven
 *     (optionally plus a planned hand top-up) can fill it.
 *  3. Which pile to draw from     — refresh orders when empty, stall the
 *     round when a finishable order is still in hand, else take ingredients.
 *  4. Round-end joker / rare-kind picks — choose the option the bot can
 *     actually deliver from table + hand.
 */

type IngredientCounts = Record<Ingredient, number>;

function ingredientCardsInHand(player: Player): IngredientCard[] {
  return player.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
}

/** Public helper: how many ingredient cards of each kind the player holds. */
export function botIngredientHandCounts(player: Player): IngredientCounts {
  const counts = zeroIngredientRecord();
  for (const card of ingredientCardsInHand(player)) counts[card.ingredient] += 1;
  return counts;
}

export function botPersonalIngredient(player: Player): Ingredient {
  return PERSONAL_INGREDIENT[player.color];
}

function groupByKind(cards: IngredientCard[]): Map<Ingredient, IngredientCard[]> {
  const byKind = new Map<Ingredient, IngredientCard[]>();
  for (const card of cards) {
    const list = byKind.get(card.ingredient) ?? [];
    list.push(card);
    byKind.set(card.ingredient, list);
  }
  return byKind;
}

function tallyTotal(tally: IngredientCounts): number {
  return INGREDIENTS.reduce((sum, i) => sum + tally[i], 0);
}

/** Rough count of ingredient cards an order consumes — used to prefer locking in the "heaviest" order first. */
function requirementWeight(order: OrderCard): number {
  switch (order.requirement.kind) {
    case 'normal':
      return Object.values(order.requirement.requirements).reduce((sum, n) => sum + (n ?? 0), 0);
    case 'bombastica':
      return 15;
    case 'monotoni':
      return 1 + order.requirement.jokerCount;
    case 'minimale':
      return 1 + order.requirement.otherCount;
  }
}

/** The non-personal kind the bot should treat as the Monotoni joker: whichever it is closest to covering from oven, then hand. */
function bestJokerKind(personal: Ingredient, tally: IngredientCounts, hand: IngredientCounts, jokerCount: number): Ingredient {
  const others = INGREDIENTS.filter((i) => i !== personal);
  const score = (i: Ingredient) => Math.min(jokerCount, tally[i]) * 100 + Math.min(jokerCount, tally[i] + hand[i]);
  return others.reduce((best, i) => (score(i) > score(best) ? i : best));
}

/**
 * The non-personal kind the bot should aim at for Pizza Minimale. The
 * engine ultimately forces the *rarest* positive non-personal kind at
 * reveal, so the bot can only steer this via what it puts in the oven —
 * it targets whichever kind it is best able to push to the required count.
 */
function minimaleTargetKind(personal: Ingredient, tally: IngredientCounts, hand: IngredientCounts): Ingredient {
  const others = INGREDIENTS.filter((i) => i !== personal);
  return others.reduce((best, i) => (tally[i] + hand[i] > tally[best] + hand[best] ? i : best));
}

/**
 * Concrete per-ingredient target for one of the bot's own orders, with the
 * Monotoni joker / Minimale rare slot resolved. Returns null for Bombastica
 * (no per-kind shape — handled separately).
 */
function concreteRequirement(
  order: OrderCard,
  personal: Ingredient,
  tally: IngredientCounts,
  hand: IngredientCounts,
): Partial<Record<Ingredient, number>> | null {
  switch (order.requirement.kind) {
    case 'normal':
      return order.requirement.requirements;
    case 'bombastica':
      return null;
    case 'monotoni': {
      const joker = bestJokerKind(personal, tally, hand, order.requirement.jokerCount);
      return { [personal]: 1, [joker]: order.requirement.jokerCount };
    }
    case 'minimale': {
      const rare = minimaleTargetKind(personal, tally, hand);
      return { [personal]: 1, [rare]: order.requirement.otherCount };
    }
  }
}

/**
 * Whether `order` would actually be delivered given this oven tally,
 * optionally letting the bot's hand cover a shortfall (never allowed for
 * Bombastica). Mirrors the engine's round-end resolution, including the
 * fact that Minimale consumes the rarest positive non-personal kind.
 */
function orderDeliverable(
  order: OrderCard,
  personal: Ingredient,
  tally: IngredientCounts,
  hand: IngredientCounts,
  allowHandTopUp: boolean,
): boolean {
  const backup = (i: Ingredient) => (allowHandTopUp ? hand[i] : 0);

  if (order.requirement.kind === 'bombastica') {
    return tallyTotal(tally) >= 15;
  }

  if (order.requirement.kind === 'minimale') {
    const others = INGREDIENTS.filter((i) => i !== personal);
    const positive = others.filter((i) => tally[i] > 0);
    if (positive.length === 0) return false;
    const min = Math.min(...positive.map((i) => tally[i]));
    const forced = positive.filter((i) => tally[i] === min);
    const need = order.requirement.otherCount;
    return tally[personal] + backup(personal) >= 1 && forced.some((i) => tally[i] + backup(i) >= need);
  }

  const required = concreteRequirement(order, personal, tally, hand)!;
  return (Object.entries(required) as [Ingredient, number][]).every(([i, n]) => tally[i] + backup(i) >= n);
}

/** How many ingredient slots the order is still missing from the oven alone. */
function shortfallTotal(order: OrderCard, personal: Ingredient, tally: IngredientCounts): number {
  if (order.requirement.kind === 'bombastica') return Math.max(0, 15 - tallyTotal(tally));
  const required = concreteRequirement(order, personal, tally, zeroIngredientRecord())!;
  return (Object.entries(required) as [Ingredient, number][]).reduce((sum, [i, n]) => sum + Math.max(0, n - tally[i]), 0);
}

/** The held order with the smallest remaining gap after the bot's own hand is taken into account (tie: the heaviest). */
export function mostCompleteHeldOrder(state: GameState, player: Player): OrderCard | null {
  if (player.handOrders.length === 0) return null;
  const personal = botPersonalIngredient(player);
  const tally = state.ovenIngredientTally;
  const hand = botIngredientHandCounts(player);

  const residual = (order: OrderCard): number => {
    if (order.requirement.kind === 'bombastica') {
      return Math.max(0, 15 - tallyTotal(tally) - Math.min(tallyTotal(hand), 15));
    }
    const required = concreteRequirement(order, personal, tally, hand)!;
    return (Object.entries(required) as [Ingredient, number][]).reduce(
      (sum, [i, n]) => sum + Math.max(0, n - tally[i] - hand[i]),
      0,
    );
  };

  return player.handOrders.reduce((best, order) => {
    const delta = residual(order) - residual(best);
    if (delta < 0) return order;
    if (delta === 0 && requirementWeight(order) > requirementWeight(best)) return order;
    return best;
  });
}

/**
 * Which ingredient cards to place this turn, or null if the bot has none
 * and must pass. Priority: flood for a held Bombastica, otherwise push
 * toward the order the bot is closest to finishing, otherwise shed a single
 * spare card (keeping larger sets and the personal ingredient intact).
 */
export function chooseIngredientsToPlay(state: GameState, player: Player): CardId[] | null {
  const cards = ingredientCardsInHand(player);
  if (cards.length === 0) return null;

  const personal = botPersonalIngredient(player);
  const tally = state.ovenIngredientTally;
  const byKind = groupByKind(cards);

  const largestGroup = (): IngredientCard[] =>
    [...byKind.values()].reduce((best, group) => (group.length > best.length ? group : best), [] as IngredientCard[]);

  // A held Bombastica only pays off if the oven can plausibly still reach
  // 15 — until then, dump the biggest set to drive the total up.
  const bombastica = player.handOrders.find((o) => o.requirement.kind === 'bombastica');
  if (bombastica && tallyTotal(tally) + cards.length + 6 >= 15) {
    return largestGroup().map((c) => c.id);
  }

  const target = mostCompleteHeldOrder(state, player);
  if (target && target.requirement.kind !== 'bombastica') {
    const contribution = ingredientsTowardOrder(target, personal, tally, byKind);
    if (contribution.length > 0) return contribution.map((c) => c.id);
  }

  return [minimalSpareCard(byKind, personal).id];
}

/** Cards from hand that make the most progress toward `order` this turn (one kind only, capped at the remaining need). */
function ingredientsTowardOrder(
  order: OrderCard,
  personal: Ingredient,
  tally: IngredientCounts,
  byKind: Map<Ingredient, IngredientCard[]>,
): IngredientCard[] {
  const required = concreteRequirement(order, personal, tally, zeroIngredientRecord());
  if (!required) return [];
  let bestKind: Ingredient | null = null;
  let bestPlay = 0;
  for (const [ingredient, count] of Object.entries(required) as [Ingredient, number][]) {
    const shortfall = Math.max(0, count - tally[ingredient]);
    if (shortfall === 0) continue;
    const held = byKind.get(ingredient)?.length ?? 0;
    const play = Math.min(held, shortfall);
    if (play > bestPlay) {
      bestPlay = play;
      bestKind = ingredient;
    }
  }
  if (!bestKind || bestPlay === 0) return [];
  return (byKind.get(bestKind) ?? []).slice(0, bestPlay);
}

/** A single card to shed when nothing needs building: from the smallest set, preferring not to break into the personal ingredient. */
function minimalSpareCard(byKind: Map<Ingredient, IngredientCard[]>, personal: Ingredient): IngredientCard {
  const groups = [...byKind.entries()].filter(([, cards]) => cards.length > 0);
  groups.sort((a, b) => {
    if (a[1].length !== b[1].length) return a[1].length - b[1].length;
    return (a[0] === personal ? 1 : 0) - (b[0] === personal ? 1 : 0);
  });
  return groups[0][1][0];
}

/**
 * Whether to play a held order this turn, and which one. The bot can't see
 * the physical oven pile, but it CAN track exactly what's in it: every
 * ingredient placement is publicly announced ("3x Salami!") and nothing
 * leaves the oven until round-end, so `state.ovenIngredientTally` is an
 * exact count of what's currently sitting in there.
 *
 * It locks in an order as soon as the oven alone can fill it (earlier in
 * the oven = revealed earlier = first claim on shared ingredients). It will
 * also place an order it can only finish with a round-end hand top-up, but
 * only once the round is nearly over (no more time to let the oven fill) or
 * the gap is a single card. Among candidates it takes the heaviest order.
 */
export function choosePlaceOrder(state: GameState, player: Player): CardId | null {
  if (player.handOrders.length === 0) return null;
  const personal = botPersonalIngredient(player);
  const tally = state.ovenIngredientTally;
  const hand = botIngredientHandCounts(player);
  const supplyLow = state.supply.length <= state.players.length * 2;

  const heaviest = (orders: OrderCard[]): OrderCard =>
    orders.reduce((best, o) => (requirementWeight(o) > requirementWeight(best) ? o : best));

  const safe = player.handOrders.filter((o) => orderDeliverable(o, personal, tally, hand, false));
  if (safe.length > 0) return heaviest(safe).id;

  const withTopUp = player.handOrders.filter(
    (o) =>
      o.requirement.kind !== 'bombastica' &&
      orderDeliverable(o, personal, tally, hand, true) &&
      (supplyLow || shortfallTotal(o, personal, tally) <= 1),
  );
  if (withTopUp.length > 0) return heaviest(withTopUp).id;

  return null;
}

/**
 * Which pile to draw from. Refresh the order hand from the waiter when it's
 * empty; stall the round (draw orders instead of ingredients) when this
 * supply draw would end the round but the bot still holds an order it could
 * finish next turn with a hand top-up; otherwise take ingredients.
 */
export function chooseDrawSource(state: GameState, player: Player): 'supply' | 'waiter' {
  if (player.handOrders.length === 0) {
    return player.waiter.length > 0 ? 'waiter' : 'supply';
  }
  if (player.waiter.length === 0) return 'supply';

  const needed = Math.max(0, 7 - (player.hand.length + player.handOrders.length));
  const supplyDrawEndsRound = state.supply.length > 0 && state.supply.length <= needed;
  if (!supplyDrawEndsRound) return 'supply';

  // This supply draw would empty the pile and end the round — hold it off by
  // drawing orders instead if we still have one we could finish next turn.
  const personal = botPersonalIngredient(player);
  const tally = state.ovenIngredientTally;
  const hand = botIngredientHandCounts(player);
  const unplacedButFinishable = player.handOrders.some(
    (o) =>
      o.requirement.kind !== 'bombastica' &&
      orderDeliverable(o, personal, tally, hand, true) &&
      !orderDeliverable(o, personal, tally, hand, false),
  );
  return unplacedButFinishable ? 'waiter' : 'supply';
}

/**
 * Joker ingredient for Pizza Monotoni. Prefer a kind the owner can actually
 * deliver (face-up table cards plus a hand top-up), then the one needing
 * the fewest hand cards, then the most already on the table.
 */
export function chooseJokerIngredient(
  sortedIngredients: Record<Ingredient, IngredientCard[]>,
  personal: Ingredient,
  ownerHandCounts: IngredientCounts = zeroIngredientRecord(),
  jokerCount = 6,
): Ingredient {
  const candidates = INGREDIENTS.filter((i) => i !== personal);
  const score = (i: Ingredient): number => {
    const table = sortedIngredients[i].length;
    const deliverable = table + ownerHandCounts[i] >= jokerCount ? 1 : 0;
    return deliverable * 1000 + Math.min(table, jokerCount) * 10 - Math.max(0, jokerCount - table);
  };
  return candidates.reduce((best, i) => (score(i) > score(best) ? i : best));
}

/**
 * Minimale tie-break: the engine hands over only the kinds tied for rarest
 * on the table (equal table counts), so the owner's own hand is the
 * deciding factor — pick whichever tied kind it can best top up to the
 * required count.
 */
export function chooseMinimaleTieBreak(
  candidates: Ingredient[],
  sortedIngredients?: Record<Ingredient, IngredientCard[]>,
  ownerHandCounts?: IngredientCounts,
  otherCount = 3,
): Ingredient {
  if (!sortedIngredients || !ownerHandCounts) return candidates[0];
  const cover = (i: Ingredient) => Math.min(otherCount, sortedIngredients[i].length + ownerHandCounts[i]);
  return candidates.reduce((best, i) => (cover(i) > cover(best) ? i : best));
}

/** Cards to add from hand to exactly cover a normal/Monotoni/Minimale shortfall, or null if the bot can't. */
export function chooseHandTopUp(owner: Player, shortfall: Partial<Record<Ingredient, number>>): CardId[] | null {
  const cards = ingredientCardsInHand(owner);
  const picked: CardId[] = [];
  for (const [ingredient, count] of Object.entries(shortfall) as [Ingredient, number][]) {
    const matching = cards.filter((c) => c.ingredient === ingredient && !picked.includes(c.id));
    if (matching.length < count) return null;
    picked.push(...matching.slice(0, count).map((c) => c.id));
  }
  return picked;
}
