import { Component, useEffect, type ReactNode } from 'react';
import { GameCanvas, webglAvailable } from './scene/Scene';
import { Hud } from './ui/Hud';
import { Modals } from './ui/Modals';
import { Setup, Title } from './ui/Screens';
import { getState, toggleCamera, useStore } from './store';
import { audio } from './audio/audio';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <NoWebGL reason="The 3D board could not start on this device." /> : this.props.children;
  }
}

function NoWebGL({ reason }: { reason?: string }) {
  return (
    <div className="nowebgl" role="alert">
      <h1>One More Room</h1>
      <p>{reason ?? 'This game needs WebGL to draw the 3D mansion, and it isn’t available in this browser.'}</p>
      <p>Try a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is turned on.</p>
    </div>
  );
}

const hasWebGL = webglAvailable();

export function App() {
  const screen = useStore((s) => s.screen);

  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = getState();
      if ((e.key === 'v' || e.key === 'V') && s.screen === 'game' && !s.modal) {
        e.preventDefault();
        toggleCamera();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!hasWebGL) return <NoWebGL />;
  return (
    <div className="app">
      <SceneBoundary>
        <GameCanvas />
      </SceneBoundary>
      <div className="overlay">
        {screen === 'title' && <Title />}
        {screen === 'setup' && <Setup />}
        {screen === 'game' && <Hud />}
        <div className="landscape-hint" aria-hidden="true">
          Turn your device sideways for the best view.
        </div>
      </div>
      <Modals />
    </div>
  );
}
