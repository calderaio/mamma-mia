import { PLAYER_COLOR_CLASS } from '../game/colors';
import type { Player } from '../game/types';

export function PassDeviceScreen({ player, onReady }: { player: Player; onReady: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 p-8 text-center">
      <div className={`rounded-full border-4 px-6 py-2 text-lg font-bold ${PLAYER_COLOR_CLASS[player.color]}`}>
        {player.name}
      </div>
      <h2 className="font-script text-3xl text-[var(--tomato)]">Bildschirm bitte an {player.name} übergeben</h2>
      <p className="text-sm opacity-75">
        Alle anderen sollten kurz wegschauen, damit die Handkarten geheim bleiben.
      </p>
      <button type="button" onClick={onReady} className="btn-primary px-6 py-3">
        Ich bin {player.name} – weiter
      </button>
    </div>
  );
}
