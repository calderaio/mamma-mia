# Mamma Mia! 🍕

A web implementation of Uwe Rosenberg's card game *Mamma Mia!* (Abacus Spiele, 1999) — 2–5 players, hotseat on one device, with optional rule-based bots and a self-play-trained reinforcement-learning bot.

Built with React, TypeScript, Tailwind CSS, and Vite.

## Features

- Full rules implementation: ingredient placement, order timing, the three special pizzas (Bombastica, Monotoni, Minimale), round-end oven reveal, and multi-round scoring.
- Hotseat pass-device flow for local multiplayer.
- Mix humans, fixed-heuristic bots, and a learning bot (🎓) in any seat.
- The learning bot trains via self-play (tabular Monte Carlo), persists its policy in `localStorage`, and keeps improving from games played against you.
- Pizzeria-themed UI, responsive down to mobile.

## Running locally

```bash
npm install
npm run dev
```

To play from a phone on the same network, Vite will print a network URL (via `server.host: true` in `vite.config.ts`) — open that on your phone's browser.

## Testing

```bash
npm test
```

## Project structure

- `src/game/` — pure, framework-free game logic (types, setup, turn engine, round-end scoring, bot heuristics, RL agent). Fully unit-tested.
- `src/components/` — React screens wired to the game state via `src/game/useGame.ts`.

## Known limitation

The exact ingredient values on the 5 "normal" order cards per color aren't documented in any accessible rulebook/web source — only the mechanics and the 3 special orders are. `src/game/cards.ts` documents the assumption used in place of inventing arbitrary values.
