import { useGame } from './game/useGame';
import { usePreferences } from './game/preferences';
import { SetupScreen } from './components/SetupScreen';
import { PassDeviceScreen } from './components/PassDeviceScreen';
import { BotTurnScreen } from './components/BotTurnScreen';
import { WarmupScreen } from './components/WarmupScreen';
import { TurnScreen } from './components/TurnScreen';
import { RoundEndScreen } from './components/RoundEndScreen';
import { GameEndScreen } from './components/GameEndScreen';

function App() {
  const { state, error, start, actions, botStep, qTableStats, warmupProgress, trainMore } = useGame();
  const { preferences, updatePreferences } = usePreferences();

  if (warmupProgress) {
    return <WarmupScreen progress={warmupProgress} />;
  }

  if (!state) {
    return (
      <SetupScreen
        onStart={start}
        qTableStats={qTableStats}
        onTrainMore={trainMore}
        preferences={preferences}
        onUpdatePreferences={updatePreferences}
      />
    );
  }

  // The persistent table view covers your own turn AND a bot's turn
  // starting up (passDevice landing on a bot) — your hand/stacks stay on
  // screen the whole time, with the bot's move shown as a banner at the
  // table instead of a full-screen swap. Bot decisions during round-end
  // scoring (joker/minimale/top-up) don't have a hand view to fold into, so
  // those still use the full-screen BotTurnScreen.
  if (state.phase.name === 'turn' || (state.phase.name === 'passDevice' && botStep)) {
    return <TurnScreen state={state} actions={actions} error={error} preferences={preferences} botStep={botStep} />;
  }

  switch (state.phase.name) {
    case 'passDevice':
      return (
        <PassDeviceScreen
          player={state.players[state.phase.nextPlayerIndex]}
          onReady={actions.confirmPassDevice}
        />
      );
    case 'roundEnd':
      if (botStep) return <BotTurnScreen step={botStep} />;
      return <RoundEndScreen state={state} actions={actions} error={error} />;
    case 'gameEnd':
      return (
        <GameEndScreen
          state={state}
          onRestart={() => start(state.players.map((p) => ({ name: p.name, isBot: p.isBot, learns: p.learns })))}
        />
      );
    default:
      return null;
  }
}

export default App;
