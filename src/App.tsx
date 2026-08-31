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

  // Whenever it's a bot's turn to act, show what it would do and require a
  // manual "Weiter" click before applying it — so bot moves are visible
  // step by step instead of happening invisibly.
  if (botStep) {
    return <BotTurnScreen step={botStep} />;
  }

  switch (state.phase.name) {
    case 'passDevice':
      return (
        <PassDeviceScreen
          player={state.players[state.phase.nextPlayerIndex]}
          onReady={actions.confirmPassDevice}
        />
      );
    case 'turn':
      return <TurnScreen state={state} actions={actions} error={error} preferences={preferences} />;
    case 'roundEnd':
      return <RoundEndScreen state={state} actions={actions} error={error} />;
    case 'gameEnd':
      return (
        <GameEndScreen
          state={state}
          onRestart={() => start(state.players.map((p) => ({ name: p.name, isBot: p.isBot, learns: p.learns })))}
        />
      );
  }
}

export default App;
