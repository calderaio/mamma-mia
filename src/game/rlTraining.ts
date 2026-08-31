import { createGame } from './setup';
import { confirmPassDevice, drawCards, placeIngredients, placeNoIngredients, placeOrder } from './engine';
import {
  botIngredientHandCounts,
  chooseHandTopUp as resolveHandTopUpBotChoice,
  chooseDrawSource,
  chooseJokerIngredient,
  chooseMinimaleTieBreak,
  chooseIngredientsToPlay,
  choosePlaceOrder,
  botPersonalIngredient,
  mostCompleteHeldOrder,
} from './bot';
import { chooseJoker, chooseMinimaleIngredient, resolveHandTopUp, revealNext, startRoundEnd } from './scoring';
import { applyEpisodeReturn, encodeDrawSourceState, encodePlayOrderState, selectAction, type EpisodeStep, type QTable } from './rl';
import type { RandomFn } from './random';
import type { GameState } from './types';

export type PolicyMode = 'rl' | 'heuristic';

export interface EpisodeResult {
  delivered: Record<string, number>;
  winnerIds: string[];
}

/**
 * Plays one full game to completion. Players in `policies` with mode 'rl'
 * make their playOrder/drawSource decisions via epsilon-greedy lookups into
 * `table` (recording a trajectory that gets credited with their final
 * result); 'heuristic' players use the fixed rule-based bot from bot.ts.
 * Ingredient selection and round-end special-order choices always use the
 * fixed heuristics regardless of policy mode.
 */
export function playEpisode(
  playerCount: number,
  policies: PolicyMode[],
  table: QTable,
  epsilon: number,
  random: RandomFn = Math.random,
): EpisodeResult {
  let state: GameState = createGame(
    Array.from({ length: playerCount }, (_, i) => ({ name: `P${i}`, isBot: true })),
    { random, startingPlayerIndex: 0 },
  );

  const trajectories: Record<string, EpisodeStep[]> = {};
  for (const p of state.players) trajectories[p.id] = [];

  let iterations = 0;
  while (state.phase.name !== 'gameEnd' && iterations < 20000) {
    iterations += 1;

    if (state.phase.name === 'passDevice') {
      state = confirmPassDevice(state);
      continue;
    }

    if (state.phase.name === 'turn') {
      const player = state.players[state.currentPlayerIndex];
      const mode = policies[state.currentPlayerIndex];

      if (state.phase.step === 'ingredients') {
        const ids = chooseIngredientsToPlay(state, player);
        state = ids ? placeIngredients(state, ids) : placeNoIngredients(state);
        continue;
      }

      if (state.phase.step === 'order') {
        let orderId: string | null;
        if (player.handOrders.length === 0) {
          orderId = null;
        } else if (mode === 'rl') {
          const stateKey = encodePlayOrderState(state, player);
          const action = selectAction(table, 'playOrder', stateKey, ['yes', 'no'] as const, epsilon, random);
          trajectories[player.id].push({ decision: 'playOrder', stateKey, action });
          // RL owns the timing decision; when it says "play", just place the
          // order it is closest to finishing.
          orderId = action === 'yes' ? mostCompleteHeldOrder(state, player)?.id ?? player.handOrders[0].id : null;
        } else {
          orderId = choosePlaceOrder(state, player);
        }
        state = placeOrder(state, orderId);
        continue;
      }

      // draw step
      let source: 'supply' | 'waiter';
      if (mode === 'rl') {
        const stateKey = encodeDrawSourceState(state, player);
        const options = state.supply.length === 0 ? (['waiter'] as const) : player.waiter.length === 0 ? (['supply'] as const) : (['supply', 'waiter'] as const);
        source = selectAction(table, 'drawSource', stateKey, options, epsilon, random);
        trajectories[player.id].push({ decision: 'drawSource', stateKey, action: source });
      } else {
        source = chooseDrawSource(state, player);
      }
      const afterDraw = drawCards(state, source);
      state = afterDraw.phase.name === 'roundEnd' ? startRoundEnd(afterDraw) : afterDraw;
      continue;
    }

    if (state.phase.name === 'roundEnd') {
      if (!state.roundEnd!.pending) {
        state = revealNext(state);
        continue;
      }
      const pending = state.roundEnd!.pending;
      const owner = state.players.find((p) => p.color === pending.order.color)!;
      switch (pending.type) {
        case 'awaitingJokerChoice': {
          const jokerCount = pending.order.requirement.kind === 'monotoni' ? pending.order.requirement.jokerCount : undefined;
          const ing = chooseJokerIngredient(
            state.roundEnd!.sortedIngredients,
            botPersonalIngredient(owner),
            botIngredientHandCounts(owner),
            jokerCount,
          );
          state = chooseJoker(state, ing);
          break;
        }
        case 'awaitingMinimaleChoice': {
          const otherCount = pending.order.requirement.kind === 'minimale' ? pending.order.requirement.otherCount : undefined;
          const ing = chooseMinimaleTieBreak(
            pending.candidates,
            state.roundEnd!.sortedIngredients,
            botIngredientHandCounts(owner),
            otherCount,
          );
          state = chooseMinimaleIngredient(state, ing);
          break;
        }
        case 'awaitingHandTopUp': {
          const ids = resolveHandTopUpBotChoice(owner, pending.shortfall);
          state = resolveHandTopUp(state, ids);
          break;
        }
      }
    }
  }

  const delivered = Object.fromEntries(state.players.map((p) => [p.id, p.delivered.length]));
  const winnerIds = state.winnerIds ?? [];

  // Credit every RL player's trajectory with their final-game return:
  // delivered pizzas plus a win bonus, so winning is worth more than just
  // maximizing raw delivery count.
  state.players.forEach((player, idx) => {
    if (policies[idx] !== 'rl') return;
    const finalReturn = delivered[player.id] + (winnerIds.includes(player.id) ? 3 : 0);
    applyEpisodeReturn(table, trajectories[player.id], finalReturn);
  });

  return { delivered, winnerIds };
}

export interface TrainingOptions {
  games: number;
  playerCount?: number;
  epsilonStart?: number;
  epsilonEnd?: number;
  random?: RandomFn;
}

/** Runs many self-play games (all seats using the same shared, evolving table) with linearly decaying exploration. */
export function trainSelfPlay(table: QTable, options: TrainingOptions): void {
  const playerCount = options.playerCount ?? 3;
  const random = options.random ?? Math.random;
  const epsilonStart = options.epsilonStart ?? 0.3;
  const epsilonEnd = options.epsilonEnd ?? 0.02;
  const policies: PolicyMode[] = Array.from({ length: playerCount }, () => 'rl');

  for (let i = 0; i < options.games; i += 1) {
    const epsilon = epsilonStart + ((epsilonEnd - epsilonStart) * i) / Math.max(1, options.games - 1);
    playEpisode(playerCount, policies, table, epsilon, random);
  }
}

export interface EvaluationResult {
  rlWinRate: number;
  heuristicWinRate: number;
  rlAvgDelivered: number;
  heuristicAvgDelivered: number;
  games: number;
}

/** Plays the learned greedy policy against fixed-heuristic bots to measure whether training actually helped. */
export function evaluateAgainstHeuristic(table: QTable, games: number, playerCount = 3, random: RandomFn = Math.random): EvaluationResult {
  let rlWins = 0;
  let heuristicWins = 0;
  let rlDeliveredTotal = 0;
  let heuristicDeliveredTotal = 0;
  let rlCount = 0;
  let heuristicCount = 0;

  for (let i = 0; i < games; i += 1) {
    // Seat 0 is RL (greedy), the rest are fixed heuristic.
    const policies: PolicyMode[] = Array.from({ length: playerCount }, (_, idx) => (idx === 0 ? 'rl' : 'heuristic'));
    const result = playEpisode(playerCount, policies, table, 0, random);
    const ids = Object.keys(result.delivered);
    for (let idx = 0; idx < ids.length; idx += 1) {
      const id = ids[idx];
      const isRl = policies[idx] === 'rl';
      if (result.winnerIds.includes(id)) {
        if (isRl) rlWins += 1;
        else heuristicWins += 1;
      }
      if (isRl) {
        rlDeliveredTotal += result.delivered[id];
        rlCount += 1;
      } else {
        heuristicDeliveredTotal += result.delivered[id];
        heuristicCount += 1;
      }
    }
  }

  return {
    rlWinRate: rlWins / games,
    heuristicWinRate: heuristicWins / games,
    rlAvgDelivered: rlDeliveredTotal / rlCount,
    heuristicAvgDelivered: heuristicDeliveredTotal / heuristicCount,
    games,
  };
}
