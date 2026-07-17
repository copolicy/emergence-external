import { useState } from 'react';
import wordmark from './assets/copo-watermark.png';
import RootBrush from './tools/RootBrush';
import FlowField from './tools/FlowField';
import Jagged from './tools/Jagged';
import Contour from './tools/Contour';
import RoadColors from './tools/RoadColors';
import RootsText from './tools/RootsText';

// Host for active-tool controls — they portal into the mode-rail panel under the
// Branch/Field (and brush/tool) toggles so nav + settings read as one unit.

interface ToolDef {
  id: string;
  label: string;
  Component: (props: { controlsTarget?: HTMLElement | null }) => React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { id: 'root-brush', label: 'Root Brush', Component: RootBrush },
  { id: 'flow-field', label: 'Fingerprint', Component: FlowField },
  { id: 'jagged', label: 'Jagged Fingerprint', Component: Jagged },
  { id: 'contour', label: 'Contour', Component: Contour },
  { id: 'road-colors', label: 'Map', Component: RoadColors },
  { id: 'roots-text', label: 'Roots + Text', Component: RootsText },
];

type Family = 'branch' | 'field';
type Brush = 'organic' | 'engineered';

/** Field tools mirror Branch's brush toggle: Organic → Fingerprint, Engineered → Jagged. */
const FIELD_BY_BRUSH: Record<Brush, string> = {
  organic: 'flow-field',
  engineered: 'jagged',
};

export default function App() {
  // Nested-toggle nav state. `family` is Branch vs Field; under either, the
  // brush toggle (organic/engineered) picks the tool. Engineered + Topographic
  // routes to Map on both Branch and Field.
  const [family, setFamily] = useState<Family>('branch');
  const [brush, setBrush] = useState<Brush>('organic');
  const [topographic, setTopographic] = useState(false);
  const [toolControlsHost, setToolControlsHost] = useState<HTMLElement | null>(null);

  const showTopoSwitch = brush === 'engineered';
  const showMap = showTopoSwitch && topographic;
  // Keep the wide rail + panel card when Topographic opens Map so the layout
  // doesn't jump (Map controls portal into the same host as other tools).
  const withToolPanel = family === 'branch' || family === 'field';

  // Organic never carries a topographic view, so drop it when leaving engineered.
  const selectBrush = (b: Brush) => {
    setBrush(b);
    if (b !== 'engineered') setTopographic(false);
  };

  // Resolve the nav state to the active tool.
  const activeId = showMap
    ? 'road-colors'
    : family === 'field'
      ? FIELD_BY_BRUSH[brush]
      : 'root-brush';
  const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const Active = active.Component;

  const topoSwitch = showTopoSwitch && (
    <div className="mode-rail__group">
      <div className="switch-row">
        <span className="switch-row__label">Topographic</span>
        <button
          type="button"
          role="switch"
          aria-checked={topographic}
          className={`switch${topographic ? ' is-on' : ''}`}
          onClick={() => setTopographic((v) => !v)}
        >
          <span className="switch__knob" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img
            src="/emergence-logo.png"
            alt="Emergence"
            className="app-header__logo"
          />
        </div>
      </header>

      <div className="app-body">
        <aside
          className={`mode-rail${withToolPanel ? ' mode-rail--with-tool' : ''}`}
          aria-label="Mode"
        >
          <div className="mode-rail__group">
            <span className="mode-rail__label">mode</span>
            <div className="seg" role="group" aria-label="Branch or field">
              {(['branch', 'field'] as Family[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`seg__opt${f === family ? ' seg__opt--active' : ''}`}
                  aria-pressed={f === family}
                  onClick={() => setFamily(f)}
                >
                  {f === 'branch' ? 'Branch' : 'Field'}
                </button>
              ))}
            </div>
          </div>

          {family === 'branch' && (
            <div className="mode-rail__panel mode-rail__panel--tool">
              <div className="mode-rail__group">
                <span className="mode-rail__label">brush</span>
                <div className="seg" role="group" aria-label="Brush">
                  {(['organic', 'engineered'] as Brush[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`seg__opt${b === brush ? ' seg__opt--active' : ''}`}
                      aria-pressed={b === brush}
                      onClick={() => selectBrush(b)}
                    >
                      {b === 'organic' ? 'Organic' : 'Engineered'}
                    </button>
                  ))}
                </div>
              </div>

              {topoSwitch}

              {/* Active tool sliders / actions land here via portal. */}
              <div
                ref={setToolControlsHost}
                className="mode-rail__tool-controls"
              />
            </div>
          )}

          {family === 'field' && (
            <div className="mode-rail__panel mode-rail__panel--tool">
              <div className="mode-rail__group">
                <span className="mode-rail__label">brush</span>
                <div className="seg" role="group" aria-label="Brush">
                  {(['organic', 'engineered'] as Brush[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`seg__opt${b === brush ? ' seg__opt--active' : ''}`}
                      aria-pressed={b === brush}
                      onClick={() => selectBrush(b)}
                    >
                      {b === 'organic' ? 'Organic' : 'Engineered'}
                    </button>
                  ))}
                </div>
              </div>

              {topoSwitch}

              {/* Active tool sliders / actions land here via portal. */}
              <div
                ref={setToolControlsHost}
                className="mode-rail__tool-controls"
              />
            </div>
          )}
        </aside>

        <main className="app-main">
          {/* Remount on tool change so each engine resets its canvas/state cleanly.
              Root Brush's brush is controlled here so it survives the remount. */}
          {active.id === 'root-brush' ? (
            <RootBrush
              key="root-brush"
              brush={brush}
              onBrushChange={selectBrush}
              hideBrushToggle
              controlsTarget={toolControlsHost}
            />
          ) : active.id === 'road-colors' ? (
            <RoadColors key="road-colors" controlsTarget={toolControlsHost} />
          ) : (
            <Active key={active.id} controlsTarget={toolControlsHost} />
          )}
        </main>
      </div>

      <footer className="app-footer">
        <p className="app-footer__credit">
          Created by
          <img src={wordmark} alt="Company Policy" className="app-footer__wordmark" />
        </p>
      </footer>
    </div>
  );
}
