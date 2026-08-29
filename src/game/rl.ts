import { INGREDIENTS } from './ingredients';
import { PERSONAL_INGREDIENT } from './colors';
import type { GameState, Player } from './types';

/**
 * Tabular Monte-Carlo control over two decision points: whether to play the
 * held order card this turn, and which pile to draw from. Both are encoded
 * as small bucketed feature strings (only information the acting player can
 * actually observe) so the table stays tiny and learns fast.
 *
 * Each full game is one episode. Every (state, action) pair a learning bot
 * visited gets updated with that bot's final-game return once the episode
 * ends (every-visit Monte Carlo, incremental mean) — see `applyEpisodeReturn`.
 */

export type Decision = 'playOrder' | 'drawSource';
export type PlayOrderAction = 'yes' | 'no';
export type DrawSourceAction = 'supply' | 'waiter';
export type RLAction = PlayOrderAction | DrawSourceAction;

interface ActionStats {
  value: number;
  count: number;
}

export type QTable = Record<Decision, Record<string, Record<string, ActionStats>>>;

export function createEmptyQTable(): QTable {
  return { playOrder: {}, drawSource: {} };
}

function bucket(n: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && n >= edges[i]) i += 1;
  return i;
}

/**
 * How close to satisfiable the held order looks, based on the exact
 * (publicly announced) oven ingredient tally — 0 = nothing needed is
 * present yet, 1 = exactly enough, >1 = more than enough.
 */
function readiness(order: Player['handOrders'][number], tally: GameState['ovenIngredientTally'], personal: (typeof INGREDIENTS)[number]): number {
  switch (order.requirement.kind) {
    case 'normal': {
      const reqs = Object.entries(order.requirement.requirements) as [(typeof INGREDIENTS)[number], number][];
      return Math.min(...reqs.map(([ingredient, count]) => (count ? tally[ingredient] / count : 1)));
    }
    case 'bombastica':
      return INGREDIENTS.reduce((sum, i) => sum + tally[i], 0) / 15;
    case 'monotoni': {
      const requirement = order.requirement;
      const personalReady = tally[personal] >= 1 ? 1 : 0;
      const best = Math.max(...INGREDIENTS.filter((i) => i !== personal).map((i) => tally[i] / requirement.jokerCount));
      return Math.min(personalReady, best);
    }
    case 'minimale': {
      const requirement = order.requirement;
      const personalReady = tally[personal] >= 1 ? 1 : 0;
      const best = Math.max(...INGREDIENTS.filter((i) => i !== personal).map((i) => tally[i] / requirement.otherCount));
      return Math.min(personalReady, best);
    }
  }
}

export function encodePlayOrderState(state: GameState, player: Player): string {
  const order = player.handOrders[0];
  if (!order) return 'none';
  const personal = PERSONAL_INGREDIENT[player.color];
  const readinessBucket = bucket(readiness(order, state.ovenIngredientTally, personal), [0.34, 0.67, 1, 1.5]);
  return `r${state.round}-k${order.requirement.kind}-rdy${readinessBucket}`;
}

export function encodeDrawSourceState(state: GameState, player: Player): string {
  const handOrdersBucket = player.handOrders.length;
  const waiterBucket = bucket(player.waiter.length, [1, 4]);
  const supplyBucket = bucket(state.supply.length, [10, 25]);
  return `r${state.round}-h${handOrdersBucket}-w${waiterBucket}-s${supplyBucket}`;
}

function getOrInit(table: QTable, decision: Decision, stateKey: string, actions: readonly string[]): Record<string, ActionStats> {
  const forDecision = table[decision];
  let entry = forDecision[stateKey];
  if (!entry) {
    entry = {};
    for (const a of actions) entry[a] = { value: 0, count: 0 };
    forDecision[stateKey] = entry;
  }
  return entry;
}

export interface EpisodeStep {
  decision: Decision;
  stateKey: string;
  action: string;
}

/** Epsilon-greedy action selection over the given action set. */
export function selectAction<A extends string>(
  table: QTable,
  decision: Decision,
  stateKey: string,
  actions: readonly A[],
  epsilon: number,
  random: () => number = Math.random,
): A {
  const stats = getOrInit(table, decision, stateKey, actions);
  if (random() < epsilon) {
    return actions[Math.floor(random() * actions.length)];
  }
  let best = actions[0];
  for (const a of actions) {
    if (stats[a].value > stats[best].value) best = a;
  }
  return best;
}

/** Applies a single scalar return to every (state, action) visited in an episode (every-visit Monte Carlo, incremental mean). */
export function applyEpisodeReturn(table: QTable, trajectory: EpisodeStep[], finalReturn: number): void {
  for (const step of trajectory) {
    const stats = getOrInit(table, step.decision, step.stateKey, [step.action]);
    const entry = stats[step.action] ?? (stats[step.action] = { value: 0, count: 0 });
    entry.count += 1;
    entry.value += (finalReturn - entry.value) / entry.count;
  }
}

export function tableSize(table: QTable): number {
  return Object.values(table.playOrder).length + Object.values(table.drawSource).length;
}

/** Total number of (state, action) decision-visits ever recorded — a rough proxy for how much the agent has learned from. */
export function totalVisits(table: QTable): number {
  let total = 0;
  for (const decision of [table.playOrder, table.drawSource]) {
    for (const actionStats of Object.values(decision)) {
      for (const stats of Object.values(actionStats)) total += stats.count;
    }
  }
  return total;
}
