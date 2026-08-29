import { PLAYER_COLOR_CLASS, playerBadge } from '../game/colors';
import type { GameState } from '../game/types';

export function GameEndScreen({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  const winners = new Set(state.winnerIds ?? []);
  const ranked = [...state.players].sort((a, b) => b.delivered.length - a.delivered.length || b.hand.length - a.hand.length);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-8 text-center">
      <h1 className="font-script text-5xl text-[var(--tomato)]">Spielende! 🍕</h1>
      <p className="text-lg">
        {ranked.filter((p) => winners.has(p.id)).map((p) => p.name).join(' & ')} gewinnt mit{' '}
        {ranked.find((p) => winners.has(p.id))?.delivered.length} Lieferungen!
      </p>

      <div className="pizzeria-panel w-full overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--crust-border)' }}>
              <th className="px-3 py-2">Spieler</th>
              <th className="px-3 py-2">Lieferungen</th>
              <th className="px-3 py-2">Handkarten</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={winners.has(p.id) ? 'font-bold' : ''}>
                <td className="px-3 py-1">
                  <span className={`rounded px-2 py-0.5 ${PLAYER_COLOR_CLASS[p.color]}`}>
                    {playerBadge(p)}{p.name}
                  </span>
                </td>
                <td className="px-3 py-1">{p.delivered.length}</td>
                <td className="px-3 py-1">{p.hand.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={onRestart} className="btn-primary px-6 py-3">
        Neues Spiel
      </button>
    </div>
  );
}
