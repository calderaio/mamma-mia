import { useState } from 'react';
import type { PlayerSetup } from '../game/setup';
import type { QTableStats } from '../game/useGame';
import type { Preferences } from '../game/preferences';

type SeatKind = 'human' | 'bot' | 'learning' | 'strong';

const SEAT_CYCLE: SeatKind[] = ['human', 'bot', 'learning', 'strong'];
const SEAT_LABEL: Record<SeatKind, string> = {
  human: '🙂 Mensch',
  bot: '🤖 Bot',
  learning: '🎓 Lernender Bot',
  strong: '🧠 Starker Bot',
};

export function SetupScreen({
  onStart,
  qTableStats,
  onTrainMore,
  preferences,
  onUpdatePreferences,
}: {
  onStart: (players: PlayerSetup[]) => void;
  qTableStats: QTableStats;
  onTrainMore: (games: number) => void;
  preferences: Preferences;
  onUpdatePreferences: (patch: Partial<Preferences>) => void;
}) {
  const [count, setCount] = useState(3);
  const [names, setNames] = useState<string[]>(['Spieler 1', 'Alberto', 'Giulia', 'Marco', 'Sofia']);
  // Standard setup: you vs N bots — no hotseat hand-off needed for the sole human.
  const [seats, setSeats] = useState<SeatKind[]>(['human', 'strong', 'strong', 'strong', 'strong']);

  function cycleSeat(i: number) {
    setSeats((prev) => prev.map((s, idx) => (idx === i ? SEAT_CYCLE[(SEAT_CYCLE.indexOf(s) + 1) % SEAT_CYCLE.length] : s)));
  }

  const hasLearningSeat = seats.slice(0, count).includes('learning');

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-8 text-center">
      <div>
        <h1 className="font-script text-6xl text-[var(--tomato)] drop-shadow-sm">Mamma Mia!</h1>
        <div className="mx-auto mt-1 h-1 w-40 rounded-full bg-[linear-gradient(90deg,var(--basil)_0%,var(--basil)_33%,#fff8ea_33%,#fff8ea_66%,var(--tomato)_66%)]" />
      </div>
      <p className="text-sm opacity-75">
        Standard: du gegen bis zu 4 Bots. Für Hotseat mit mehreren Menschen einfach weitere Spieler auf 🙂 Mensch
        stellen. 🍕
      </p>

      <div className="flex justify-center gap-2">
        {[2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            className={`h-12 w-12 rounded-full border-2 font-bold ${
              count === n
                ? 'border-[var(--tomato)] bg-[var(--tomato)] text-white'
                : 'border-[var(--crust-border)] opacity-70'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={names[i]}
              onChange={(e) => setNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))}
              className="pizzeria-panel min-w-0 flex-1 px-3 py-2 text-[var(--ink)]"
              placeholder={`Spieler ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => cycleSeat(i)}
              className={`w-full shrink-0 rounded-lg border-2 px-3 py-2 text-sm font-semibold sm:w-40 ${
                seats[i] === 'human' ? 'border-[var(--crust-border)] opacity-70' : 'border-[var(--tomato)] bg-[var(--tomato)] text-white'
              }`}
            >
              {SEAT_LABEL[seats[i]]}
            </button>
          </div>
        ))}
      </div>

      <label className="flex cursor-pointer items-center justify-center gap-2 text-sm opacity-75">
        <input
          type="checkbox"
          checked={preferences.messyPile}
          onChange={(e) => onUpdatePreferences({ messyPile: e.target.checked })}
        />
        🗂️ Unordentlicher Ofen-Stapel (Kartenränder sichtbar)
      </label>

      <div className="pizzeria-panel flex flex-col gap-2 p-3 text-xs">
        <p className="opacity-75">
          🧠 Der Starke Bot denkt jeden Zug durch: er würfelt die verdeckten Karten plausibel aus und simuliert
          hunderte Spielverläufe pro möglichem Zug. Kein Training nötig, aber er überlegt kurz.
        </p>
        <p className="opacity-75">
          🎓 Der Lernende Bot merkt sich Ergebnisse über Spiele hinweg (im Browser gespeichert) und wird dadurch
          langsam besser.{' '}
          {qTableStats.visits > 0
            ? `Bisher gelernt aus ${qTableStats.visits.toLocaleString('de-DE')} Entscheidungen (${qTableStats.size} bekannte Situationen).`
            : 'Noch ungetrainiert.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => onTrainMore(5000)} className="btn-secondary px-3 py-1.5 text-xs">
            +5.000 Spiele trainieren
          </button>
          <button type="button" onClick={() => onTrainMore(20000)} className="btn-secondary px-3 py-1.5 text-xs">
            +20.000 Spiele trainieren
          </button>
        </div>
        {!hasLearningSeat && (
          <p className="opacity-50">Tipp: Wähle unten mindestens einen 🎓 Lernenden Bot, um gegen ihn zu spielen.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() =>
          onStart(
            names.slice(0, count).map((n, i) => ({
              name: n.trim() || `Spieler ${i + 1}`,
              isBot: seats[i] !== 'human',
              learns: seats[i] === 'learning',
              strong: seats[i] === 'strong',
            })),
          )
        }
        className="btn-primary px-6 py-3"
      >
        Spiel starten
      </button>
    </div>
  );
}
