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
import type { CardId, GameState, Player } from './types';

export interface BotStep {
  player: Player;
  message: string;
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
        return fn(prev);
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
      setState(createGame(players));
      return;
    }

    // First-ever use of a learning bot: rather than starting from a
    // near-degenerate policy (see rl.ts docs — untrained Q-values are all
    // 0, so it always ties toward the first action), run a quick headless
    // self-play burst to warm-start it. This is run in small chunks via
    // setTimeout so the "training..." progress UI actually gets to paint
    // between chunks instead of freezing the tab for several seconds with
    // no feedback (measured ~4ms/game in-browser, well over Node's speed).
    setWarmupProgress({ done: 0, total: WARM_START_GAMES });
    const epsilonAt = (progress: number) => WARM_START_EPSILON_START + (WARM_START_EPSILON_END - WARM_START_EPSILON_START) * progress;

    const runChunk = (done: number) => {
      const batch = Math.min(WARM_START_CHUNK, WARM_START_GAMES - done);
      trainSelfPlay(table, {
        games: batch,
        epsilonStart: epsilonAt(done / WARM_START_GAMES),
        epsilonEnd: epsilonAt((done + batch) / WARM_START_GAMES),
      });
      const newDone = done + batch;
      setWarmupProgress({ done: newDone, total: WARM_START_GAMES });
      if (newDone < WARM_START_GAMES) {
        setTimeout(() => runChunk(newDone), 0);
      } else {
        saveQTable(table);
        setWarmupProgress(null);
        setState(createGame(players));
      }
    };
    setTimeout(() => runChunk(0), 0);
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

  return { state, error, start, actions, botStep, qTableStats, warmupProgress };
}

function recordStep(trajectories: Record<string, EpisodeStep[]>, playerId: string, step: EpisodeStep): void {
  (trajectories[playerId] ??= []).push(step);
}

function computeBotStep(s: GameState, actions: Actions, qTable: QTable, trajectories: Record<string, EpisodeStep[]>): BotStep | null {
  if (s.phase.name === 'passDevice') {
    const next = s.players[s.phase.nextPlayerIndex];
    if (!next.isBot) return null;
    return { player: next, message: `${next.name} ist am Zug.`, run: () => actions.confirmPassDevice() };
  }

  if (s.phase.name === 'turn') {
    const player = s.players[s.currentPlayerIndex];
    if (!player.isBot) return null;
    switch (s.phase.step) {
      case 'ingredients': {
        const ids = chooseIngredientsToPlay(player);
        if (!ids) {
          return { player, message: `${player.name} hat keine Zutatenkarte und setzt aus.`, run: () => actions.placeNoIngredients() };
        }
        const card = player.hand.find((c) => c.id === ids[0]);
        const kind = card && card.kind === 'ingredient' ? INGREDIENT_LABEL[card.ingredient] : '';
        return { player, message: `${player.name} legt ${ids.length}x ${kind} in den Ofen.`, run: () => actions.placeIngredients(ids) };
      }
      case 'order': {
        if (player.handOrders.length === 0) {
          return { player, message: `${player.name} hat keine Bestellkarte.`, run: () => actions.placeOrder(null) };
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
        return { player, message, run: () => actions.placeOrder(id) };
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
            run: () => {
              recordStep(trajectories, player.id, { decision: 'drawSource', stateKey, action: source });
              actions.drawCards(source);
            },
          };
        }
        const source = chooseDrawSource(player);
        const label = source === 'supply' ? 'Nachziehstapel' : 'Kellner-Stapel';
        return { player, message: `${player.name} zieht vom ${label}.`, run: () => actions.drawCards(source) };
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
          run: () => actions.chooseJoker(ingredient),
        };
      }
      case 'awaitingMinimaleChoice': {
        const ingredient = chooseMinimaleTieBreak(pending.candidates);
        return {
          player: owner,
          message: `${owner.name} wählt ${INGREDIENT_LABEL[ingredient]}.`,
          run: () => actions.chooseMinimaleIngredient(ingredient),
        };
      }
      case 'awaitingHandTopUp': {
        const ids = chooseHandTopUp(owner, pending.shortfall);
        const message = ids
          ? `${owner.name} ergänzt aus der Hand und liefert ${pending.order.name} aus!`
          : `${owner.name} kann ${pending.order.name} nicht vervollständigen.`;
        return { player: owner, message, run: () => actions.resolveHandTopUp(ids) };
      }
    }
  }

  return null;
}
