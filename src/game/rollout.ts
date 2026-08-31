import { INGREDIENTS, INGREDIENT_COUNT_PER_KIND, type Ingredient } from './ingredients';
import { REMOVAL_PER_KIND_BY_PLAYER_COUNT } from './setup';
import { makeIngredientCard, makeMammaMiaCard } from './cards';
import { shuffle, type RandomFn } from './random';
import {
  confirmPassDevice,
  drawCards,
  placeIngredients,
  placeNoIngredients,
  placeOrder,
} from './engine';
import {
  chooseJoker,
  chooseMinimaleIngredient,
  resolveHandTopUp,
  revealNext,
  startRoundEnd,
} from './scoring';
import {
  botIngredientHandCounts,
  botPersonalIngredient,
  chooseDrawSource,
  chooseHandTopUp,
  chooseIngredientsToPlay,
  chooseJokerIngredient,
  chooseMinimaleTieBreak,
  choosePlaceOrder,
} from './bot';
import type { CardId, GameState, IngredientCard, Player } from './types';

/**
 * The "strong" bot. At each of its own turn decisions it:
 *
 *   1. Determinizes the hidden state — samples a full concrete game
 *      consistent with everything an attentive player legitimately knows
 *      (its own hand, the exact announced oven contents, every pile's size,
 *      the set of order cards each opponent could still hold) but nothing it
 *      shouldn't (opponents' actual hands, the supply order). See
 *      `determinize`.
 *   2. Plays that determinized game to the end with the fast heuristic
 *      (`bot.ts`) driving every seat, once per candidate action, many times.
 *   3. Picks the action with the best average outcome (delivered pizzas
 *      plus a win bonus).
 *
 * Round-end choices (joker / Minimale / hand top-up) keep using the
 * heuristic — they're lower-leverage and the mid-reveal state doesn't
 * rollout cleanly.
 */

const WIN_BONUS = 3;
/** Total heuristic playouts to spend per decision, split across the candidate actions. */
const PLAYOUT_BUDGET = 420;
const MIN_SAMPLES = 24;
const MAX_SAMPLES = 90;

// ---------------------------------------------------------------------------
// Determinization
// ---------------------------------------------------------------------------

function totalPerKind(playerCount: number): number {
  return INGREDIENT_COUNT_PER_KIND - (REMOVAL_PER_KIND_BY_PLAYER_COUNT[playerCount] ?? 0);
}

/**
 * A new GameState where every opponent's hand + waiter and the supply pile
 * have been re-sampled from public information, keeping `me`'s own cards and
 * the (legitimately known) oven exactly as they are.
 */
export function determinize(state: GameState, meId: string, random: RandomFn): GameState {
  const me = state.players.find((p) => p.id === meId)!;
  const perKind = totalPerKind(state.players.length);
  const myHand = botIngredientHandCounts(me);

  // Every ingredient card not in the oven and not in my hand is somewhere in
  // {opponents' hands, supply}. Build that multiset and shuffle it.
  const pool: Ingredient[] = [];
  for (const ingredient of INGREDIENTS) {
    const unknown = Math.max(0, perKind - state.ovenIngredientTally[ingredient] - myHand[ingredient]);
    for (let i = 0; i < unknown; i += 1) pool.push(ingredient);
  }
  const shuffled = shuffle(pool, random);

  let cursor = 0;
  const players = state.players.map((p) => {
    if (p.id === meId) return p;
    const handSize = p.hand.length; // hand holds only ingredient cards (Mamma Mia is set aside)
    const newHand: IngredientCard[] = shuffled
      .slice(cursor, cursor + handSize)
      .map((ingredient) => makeIngredientCard(ingredient));
    cursor += handSize;
    // The *set* of orders an opponent could hold (hand ∪ waiter) is public;
    // only the hand/waiter split and the waiter order are hidden.
    const orderPool = shuffle([...p.handOrders, ...p.waiter], random);
    return {
      ...p,
      hand: newHand,
      handOrders: orderPool.slice(0, p.handOrders.length),
      waiter: orderPool.slice(p.handOrders.length),
    };
  });

  let supply = shuffled.slice(cursor).map((ingredient) => makeIngredientCard(ingredient)) as GameState['supply'];
  const mammaMiaInSupply = !state.players.some((p) => p.hasMammaMia);
  if (mammaMiaInSupply) {
    const at = Math.floor(random() * (supply.length + 1));
    supply = [...supply.slice(0, at), makeMammaMiaCard(), ...supply.slice(at)];
  }
  // Reconcile any drift from the card-counting assumptions (e.g. an opponent
  // holding fewer than 7 late in a round) so the pile size stays honest.
  if (supply.length > state.supply.length) {
    supply = supply.slice(0, state.supply.length);
  } else {
    while (supply.length < state.supply.length) {
      supply.push(makeIngredientCard('salami'));
    }
  }

  return { ...state, players, supply };
}

// ---------------------------------------------------------------------------
// Heuristic playout
// ---------------------------------------------------------------------------

interface PlayoutResult {
  delivered: Record<string, number>;
  winnerIds: string[];
}

/** Advance a game to `gameEnd` with the fixed heuristic driving every seat. */
export function heuristicPlayout(start: GameState): PlayoutResult {
  let s = start;
  let guard = 0;
  while (s.phase.name !== 'gameEnd' && guard < 20000) {
    guard += 1;

    if (s.phase.name === 'passDevice') {
      s = confirmPassDevice(s);
      continue;
    }

    if (s.phase.name === 'turn') {
      const p = s.players[s.currentPlayerIndex];
      if (s.phase.step === 'ingredients') {
        const ids = chooseIngredientsToPlay(s, p);
        s = ids ? placeIngredients(s, ids) : placeNoIngredients(s);
      } else if (s.phase.step === 'order') {
        s = placeOrder(s, p.handOrders.length > 0 ? choosePlaceOrder(s, p) : null);
      } else {
        const after = drawCards(s, chooseDrawSource(s, p));
        s = after.phase.name === 'roundEnd' ? startRoundEnd(after) : after;
      }
      continue;
    }

    // roundEnd
    const roundEnd = s.roundEnd!;
    if (!roundEnd.pending) {
      s = revealNext(s);
      continue;
    }
    const pending = roundEnd.pending;
    const owner = s.players.find((p) => p.color === pending.order.color)!;
    const personal = botPersonalIngredient(owner);
    const ownerHand = botIngredientHandCounts(owner);
    if (pending.type === 'awaitingJokerChoice') {
      const jokerCount = pending.order.requirement.kind === 'monotoni' ? pending.order.requirement.jokerCount : 6;
      s = chooseJoker(s, chooseJokerIngredient(roundEnd.sortedIngredients, personal, ownerHand, jokerCount));
    } else if (pending.type === 'awaitingMinimaleChoice') {
      const otherCount = pending.order.requirement.kind === 'minimale' ? pending.order.requirement.otherCount : 3;
      s = chooseMinimaleIngredient(
        s,
        chooseMinimaleTieBreak(pending.candidates, roundEnd.sortedIngredients, ownerHand, otherCount),
      );
    } else {
      s = resolveHandTopUp(s, chooseHandTopUp(owner, pending.shortfall));
    }
  }

  return {
    delivered: Object.fromEntries(s.players.map((p) => [p.id, p.delivered.length])),
    winnerIds: s.winnerIds ?? [],
  };
}

// ---------------------------------------------------------------------------
// Action evaluation
// ---------------------------------------------------------------------------

function returnFor(result: PlayoutResult, meId: string): number {
  return result.delivered[meId] + (result.winnerIds.includes(meId) ? WIN_BONUS : 0);
}

/**
 * Average heuristic-playout return for applying `apply` to the current
 * decision point, over `samples` fresh determinizations.
 */
function scoreAction(state: GameState, meId: string, apply: (s: GameState) => GameState, samples: number, seed: number): number {
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const rng = mulberry32(seed + i * 2654435761);
    const world = determinize(state, meId, rng);
    total += returnFor(heuristicPlayout(apply(world)), meId);
  }
  return total / samples;
}

interface Candidate<A> {
  action: A;
  apply: (s: GameState) => GameState;
}

function pickBest<A>(state: GameState, meId: string, candidates: Candidate<A>[], seed: number): A {
  if (candidates.length === 1) return candidates[0].action;
  const samples = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(PLAYOUT_BUDGET / candidates.length)));
  let bestAction = candidates[0].action;
  let bestScore = -Infinity;
  candidates.forEach((candidate, idx) => {
    const score = scoreAction(state, meId, candidate.apply, samples, seed + idx * 97);
    if (score > bestScore) {
      bestScore = score;
      bestAction = candidate.action;
    }
  });
  return bestAction;
}

// ---------------------------------------------------------------------------
// The three turn decisions
// ---------------------------------------------------------------------------

function ingredientCardsInHand(player: Player): IngredientCard[] {
  return player.hand.filter((c): c is IngredientCard => c.kind === 'ingredient');
}

/** Distinct candidate ingredient plays: {1, half, all} of each kind held, plus the heuristic's pick. */
export function strongChooseIngredients(state: GameState, player: Player): CardId[] | null {
  const cards = ingredientCardsInHand(player);
  if (cards.length === 0) return null;

  const byKind = new Map<Ingredient, CardId[]>();
  for (const card of cards) {
    const list = byKind.get(card.ingredient) ?? [];
    list.push(card.id);
    byKind.set(card.ingredient, list);
  }

  const seen = new Set<string>();
  const candidates: Candidate<CardId[]>[] = [];
  const add = (ids: CardId[]) => {
    if (ids.length === 0) return;
    const key = [...ids].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ action: ids, apply: (s) => placeIngredients(s, ids) });
  };

  for (const ids of byKind.values()) {
    add(ids.slice(0, 1));
    if (ids.length >= 3) add(ids.slice(0, Math.ceil(ids.length / 2)));
    if (ids.length >= 2) add(ids);
  }
  const heuristic = chooseIngredientsToPlay(state, player);
  if (heuristic) add(heuristic);

  return pickBest(state, player.id, candidates, seedFor(state, 'ing'));
}

/** Candidate order plays: skip, or play any one held order. */
export function strongChooseOrder(state: GameState, player: Player): CardId | null {
  if (player.handOrders.length === 0) return null;
  const candidates: Candidate<CardId | null>[] = [{ action: null, apply: (s) => placeOrder(s, null) }];
  for (const order of player.handOrders) {
    candidates.push({ action: order.id, apply: (s) => placeOrder(s, order.id) });
  }
  return pickBest(state, player.id, candidates, seedFor(state, 'order'));
}

/** Candidate draw sources, constrained to what's actually available. */
export function strongChooseDraw(state: GameState, player: Player): 'supply' | 'waiter' {
  const canSupply = state.supply.length > 0;
  const canWaiter = player.waiter.length > 0;
  if (!canWaiter) return 'supply';
  if (!canSupply) return 'waiter';

  const draw = (src: 'supply' | 'waiter') => (s: GameState) => {
    const after = drawCards(s, src);
    return after.phase.name === 'roundEnd' ? startRoundEnd(after) : after;
  };
  const candidates: Candidate<'supply' | 'waiter'>[] = [
    { action: 'supply', apply: draw('supply') },
    { action: 'waiter', apply: draw('waiter') },
  ];
  return pickBest(state, player.id, candidates, seedFor(state, 'draw'));
}

// ---------------------------------------------------------------------------
// Memoization + seeding
// ---------------------------------------------------------------------------

/**
 * `state.log` grows by at least one entry on every applied action, so its
 * length plus the turn step uniquely identifies a decision point. This lets
 * the (expensive) rollout run once per decision even though the hook
 * recomputes the bot step on every React render.
 */
function decisionKey(state: GameState, tag: string): string {
  const step = state.phase.name === 'turn' ? state.phase.step : state.phase.name;
  return `${tag}:${state.currentPlayerIndex}:${step}:${state.log.length}`;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedFor(state: GameState, tag: string): number {
  return hashString(decisionKey(state, tag));
}

function mulberry32(a: number): RandomFn {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const decisionCache = new Map<string, unknown>();

/** Clear the per-decision rollout cache. Call when a fresh game starts — decision keys (which include `state.log.length`) otherwise collide across games. */
export function resetDecisionCache(): void {
  decisionCache.clear();
}

/** Run `compute` once per distinct decision point, caching across re-renders. */
export function memoizedDecision<T>(state: GameState, tag: string, compute: () => T): T {
  const key = decisionKey(state, tag);
  if (decisionCache.has(key)) return decisionCache.get(key) as T;
  if (decisionCache.size > 400) decisionCache.clear();
  const value = compute();
  decisionCache.set(key, value);
  return value;
}
