import { useCallback, useRef, useState } from 'react';
import { createGame, type PlayerSetup } from './setup';
import {
  confirmPassDevice,
  drawCards as engineDrawCards,
  GameError,
  placeIngredients,
  placeNoIngredients,
  placeOrder,
} from './engine';
import {
  chooseJoker,
  chooseMinimaleIngredient,
  resolveHandTopUp,
  revealNext as scoringRevealNext,
  startRoundEnd,
} from './scoring';
import {
  botPersonalIngredient,
  chooseDrawSource,
  chooseHandTopUp,
  chooseIngredientsToPlay,
  chooseJokerIngredient,
  choosePlaceOrder,
  chooseMinimaleTieBreak,
} from './bot';
import { applyEpisodeReturn, encodeDrawSourceState, encodePlayOrderState, selectAction, totalVisits, tableSize, type EpisodeStep, type QTable } from './rl';
import { trainSelfPlay } from './rlTraining';
import { loadQTable, saveQTable } from './rlPersistence';
import { INGREDIENT_LABEL, type Ingredient } from './ingredients';
import type { CardId, GameState, OrderCard, Player } from './types';

export type BotStepVisual =
  | { kind: 'ingredient'; ingredient: Ingredient; count: number }
  | { kind: 'order'; order: OrderCard }
  | { kind: 'facedown'; label: string };

export interface BotStep {
  player: Player;
  message: string;
  visual: BotStepVisual | null;
  run: () => void;
}

export interface QTableStats {
  size: number;
  visits: number;
}

export interface WarmupProgress {
  done: number;
  total: number;
}

interface Actions {
  confirmPassDevice: () => void;
  placeIngredients: (cardIds: CardId[]) => void;
  placeNoIngredients: () => void;
  placeOrder: (cardId: CardId | null) => void;
  drawCards: (source: 'supply' | 'waiter') => void;
  revealNext: () => void;
  chooseJoker: (ingredient: Ingredient) => void;
  chooseMinimaleIngredient: (ingredient: Ingredient) => void;
  resolveHandTopUp: (cardIds: CardId[] | null) => void;
}

/**
 * Below this many recorded decision-visits, the learned policy is close to
 * naive, so a fresh game warm-starts it via a quick headless self-play
 * burst (measured: a few hundred ms for thousands of games in-browser).
 * Chunked across setTimeout boundaries purely so the "training…" progress
 * UI gets to paint instead of one frozen block.
 */
const WARM_START_VISIT_THRESHOLD = 200;
const WARM_START_GAMES = 6000;
const WARM_START_CHUNK = 1000;
const WARM_START_EPSILON_START = 0.3;
const WARM_START_EPSILON_END = 0.02;

/** Live play keeps a little exploration so the agent keeps improving from real games, without being obviously random. */
const LIVE_EPSILON = 0.05;

export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warmupProgress, setWarmupProgress] = useState<WarmupProgress | null>(null);

  const qTableRef = useRef<QTable | null>(null);
  if (!qTableRef.current) qTableRef.current = loadQTable();

  const trajectoriesRef = useRef<Record<string, EpisodeStep[]>>({});

  const guard = useCallback((fn: (s: GameState) => GameState) => {
    setState((prev) => {
      if (!prev) return prev;
      try {
        setError(null);
        return settleAutoTransitions(fn(prev));
      } catch (e) {
        setError(e instanceof GameError ? e.message : String(e));
        return prev;
      }
    });
  }, []);

  const start = useCallback((players: (string | PlayerSetup)[]) => {
    setError(null);
    trajectoriesRef.current = {};

    const table = qTableRef.current!;
    const hasLearningPlayer = players.some((p) => typeof p !== 'string' && p.learns);
    if (!hasLearningPlayer || totalVisits(table) >= WARM_START_VISIT_THRESHOLD) {
      setState(settleAutoTransitions(createGame(players)));
      return;
    }

    // First-ever use of a learning bot: rather than starting from a
    // near-degenerate policy (see rl.ts docs — untrained Q-values are all
    // 0, so it always ties toward the first action), run a quick headless
    // self-play burst to warm-start it.
    runChunkedTraining(table, WARM_START_GAMES, setWarmupProgress, () => setState(settleAutoTransitions(createGame(players))));
  }, []);

  /** Lets the user pump up the learning bot from the setup screen before ever playing a game, on top of the automatic warm-start. */
  const trainMore = useCallback((games: number) => {
    runChunkedTraining(qTableRef.current!, games, setWarmupProgress, () => {});
  }, []);

  const actions: Actions = {
    confirmPassDevice: () => guard((s) => confirmPassDevice(s)),
    placeIngredients: (cardIds: CardId[]) => guard((s) => placeIngredients(s, cardIds)),
    placeNoIngredients: () => guard((s) => placeNoIngredients(s)),
    placeOrder: (cardId: CardId | null) => guard((s) => placeOrder(s, cardId)),
    drawCards: (source: 'supply' | 'waiter') =>
      guard((s) => {
        const afterDraw = engineDrawCards(s, source);
        // Initialize round-end state synchronously here (not in a UI effect):
        // React StrictMode double-invokes effects in dev, and startRoundEnd is
        // not idempotent (it reads state.oven, which the first call empties).
        return afterDraw.phase.name === 'roundEnd' ? startRoundEnd(afterDraw) : afterDraw;
      }),
    revealNext: () =>
      guard((s) => {
        const next = scoringRevealNext(s);
        if (next.phase.name === 'gameEnd') {
          const table = qTableRef.current!;
          for (const player of next.players) {
            if (!player.learns) continue;
            const finalReturn = player.delivered.length + (next.winnerIds?.includes(player.id) ? 3 : 0);
            applyEpisodeReturn(table, trajectoriesRef.current[player.id] ?? [], finalReturn);
          }
          saveQTable(table);
        }
        return next;
      }),
    chooseJoker: (ingredient: Ingredient) => guard((s) => chooseJoker(s, ingredient)),
    chooseMinimaleIngredient: (ingredient: Ingredient) => guard((s) => chooseMinimaleIngredient(s, ingredient)),
    resolveHandTopUp: (cardIds: CardId[] | null) => guard((s) => resolveHandTopUp(s, cardIds)),
  };

  // Computed fresh on every render (no timers, no effects): whenever it's a
  // bot's turn to act, this describes what the bot WOULD do, so the UI can
  // show it and wait for the human to click "Weiter" before actually
  // applying it via `run()`. This is what makes bot moves visible/steppable
  // instead of happening invisibly all at once.
  const botStep: BotStep | null = state ? computeBotStep(state, actions, qTableRef.current!, trajectoriesRef.current) : null;

  const qTableStats: QTableStats = { size: tableSize(qTableRef.current), visits: totalVisits(qTableRef.current) };

  return { state, error, start, actions, botStep, qTableStats, warmupProgress, trainMore };
}

/**
 * When there's exactly one human in the game (the common "me vs N bots"
 * setup), the pass-device hand-off screen is pointless — there's no one
 * else to hide the hand from, it's the same person at the screen the whole
 * game. So any passDevice transition landing on that sole human is
 * auto-confirmed immediately, keeping their hand continuously visible.
 * A bot's passDevice turn is deliberately NOT auto-skipped here — that one
 * stays gated behind the BotTurnScreen's "Weiter" click so bot moves stay
 * visible/steppable. With 2+ humans, passDevice is left alone entirely: a
 * real hotseat hand-off is still needed between different people.
 */
function settleAutoTransitions(state: GameState): GameState {
  let s = state;
  while (s.phase.name === 'passDevice') {
    const next = s.players[s.phase.nextPlayerIndex];
    const humanCount = s.players.filter((p) => !p.isBot).length;
    if (next.isBot || humanCount !== 1) break;
    s = confirmPassDevice(s);
  }
  return s;
}

/**
 * Runs `totalGames` self-play games against the shared Q-table in chunks
 * (via setTimeout boundaries) so a "training…" progress UI can paint
 * between chunks instead of one long frozen block. Shared by the automatic
 * first-use warm-start and the manual "train more" control on the setup
 * screen.
 */
function runChunkedTraining(
  table: QTable,
  totalGames: number,
  setProgress: (p: WarmupProgress | null) => void,
  onComplete: () => void,
): void {
  setProgress({ done: 0, total: totalGames });
  const epsilonAt = (progress: number) => WARM_START_EPSILON_START + (WARM_START_EPSILON_END - WARM_START_EPSILON_START) * progress;

  const runChunk = (done: number) => {
    const batch = Math.min(WARM_START_CHUNK, totalGames - done);
    trainSelfPlay(table, {
      games: batch,
      epsilonStart: epsilonAt(done / totalGames),
      epsilonEnd: epsilonAt((done + batch) / totalGames),
    });
    const newDone = done + batch;
    setProgress({ done: newDone, total: totalGames });
    if (newDone < totalGames) {
      setTimeout(() => runChunk(newDone), 0);
    } else {
      saveQTable(table);
      setProgress(null);
      onComplete();
    }
  };
  setTimeout(() => runChunk(0), 0);
}

function recordStep(trajectories: Record<string, EpisodeStep[]>, playerId: string, step: EpisodeStep): void {
  (trajectories[playerId] ??= []).push(step);
}

function computeBotStep(s: GameState, actions: Actions, qTable: QTable, trajectories: Record<string, EpisodeStep[]>): BotStep | null {
  if (s.phase.name === 'passDevice') {
    const next = s.players[s.phase.nextPlayerIndex];
    if (!next.isBot) return null;
    return { player: next, message: `${next.name} ist am Zug.`, visual: null, run: () => actions.confirmPassDevice() };
  }

  if (s.phase.name === 'turn') {
    const player = s.players[s.currentPlayerIndex];
    if (!player.isBot) return null;
    switch (s.phase.step) {
      case 'ingredients': {
        const ids = chooseIngredientsToPlay(player);
        if (!ids) {
          return {
            player,
            message: `${player.name} hat keine Zutatenkarte und setzt aus.`,
            visual: null,
            run: () => actions.placeNoIngredients(),
          };
        }
        const card = player.hand.find((c) => c.id === ids[0]);
        const ingredient = card && card.kind === 'ingredient' ? card.ingredient : null;
        const kind = ingredient ? INGREDIENT_LABEL[ingredient] : '';
        return {
          player,
          message: `${player.name} legt ${ids.length}x ${kind} in den Ofen.`,
          visual: ingredient ? { kind: 'ingredient', ingredient, count: ids.length } : null,
          run: () => actions.placeIngredients(ids),
        };
      }
      case 'order': {
        if (player.handOrders.length === 0) {
          return { player, message: `${player.name} hat keine Bestellkarte.`, visual: null, run: () => actions.placeOrder(null) };
        }
        if (player.learns) {
          const stateKey = encodePlayOrderState(s, player);
          const action = selectAction(qTable, 'playOrder', stateKey, ['yes', 'no'] as const, LIVE_EPSILON);
          const order = action === 'yes' ? player.handOrders[0] : null;
          const message = order
            ? `${player.name} legt die Bestellkarte "${order.name}" in den Ofen.`
            : `${player.name} überspringt die Bestellung.`;
          return {
            player,
            message,
            visual: order ? { kind: 'order', order } : null,
            run: () => {
              recordStep(trajectories, player.id, { decision: 'playOrder', stateKey, action });
              actions.placeOrder(order ? order.id : null);
            },
          };
        }
        const id = choosePlaceOrder(s, player);
        const order = id ? player.handOrders.find((o) => o.id === id) : null;
        const message = order
          ? `${player.name} legt die Bestellkarte "${order.name}" in den Ofen.`
          : `${player.name} überspringt die Bestellung.`;
        return { player, message, visual: order ? { kind: 'order', order } : null, run: () => actions.placeOrder(id) };
      }
      case 'draw': {
        if (player.learns) {
          const stateKey = encodeDrawSourceState(s, player);
          const options: readonly ('supply' | 'waiter')[] =
            s.supply.length === 0 ? (['waiter'] as const) : player.waiter.length === 0 ? (['supply'] as const) : (['supply', 'waiter'] as const);
          const source = selectAction(qTable, 'drawSource', stateKey, options, LIVE_EPSILON);
          const label = source === 'supply' ? 'Nachziehstapel' : 'Kellner-Stapel';
          return {
            player,
            message: `${player.name} zieht vom ${label}.`,
            visual: { kind: 'facedown', label },
            run: () => {
              recordStep(trajectories, player.id, { decision: 'drawSource', stateKey, action: source });
              actions.drawCards(source);
            },
          };
        }
        const source = chooseDrawSource(player);
        const label = source === 'supply' ? 'Nachziehstapel' : 'Kellner-Stapel';
        return {
          player,
          message: `${player.name} zieht vom ${label}.`,
          visual: { kind: 'facedown', label },
          run: () => actions.drawCards(source),
        };
      }
    }
  }

  if (s.phase.name === 'roundEnd' && s.roundEnd?.pending) {
    const pending = s.roundEnd.pending;
    const owner = s.players.find((p) => p.color === pending.order.color)!;
    if (!owner.isBot) return null;
    switch (pending.type) {
      case 'awaitingJokerChoice': {
        const ingredient = chooseJokerIngredient(s.roundEnd.sortedIngredients, botPersonalIngredient(owner));
        return {
          player: owner,
          message: `${owner.name} wählt ${INGREDIENT_LABEL[ingredient]} als Joker-Zutat.`,
          visual: { kind: 'ingredient', ingredient, count: 1 },
          run: () => actions.chooseJoker(ingredient),
        };
      }
      case 'awaitingMinimaleChoice': {
        const ingredient = chooseMinimaleTieBreak(pending.candidates);
        return {
          player: owner,
          message: `${owner.name} wählt ${INGREDIENT_LABEL[ingredient]}.`,
          visual: { kind: 'ingredient', ingredient, count: 1 },
          run: () => actions.chooseMinimaleIngredient(ingredient),
        };
      }
      case 'awaitingHandTopUp': {
        const ids = chooseHandTopUp(owner, pending.shortfall);
        const message = ids
          ? `${owner.name} ergänzt aus der Hand und liefert ${pending.order.name} aus!`
          : `${owner.name} kann ${pending.order.name} nicht vervollständigen.`;
        return { player: owner, message, visual: { kind: 'order', order: pending.order }, run: () => actions.resolveHandTopUp(ids) };
      }
    }
  }

  return null;
}
