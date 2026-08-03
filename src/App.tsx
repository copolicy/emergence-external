import { useState } from 'react';
import wordmark from './assets/copo-watermark.png';
import logo from './assets/emergence-logo.png';
import RootBrush from './tools/RootBrush';
import FlowField from './tools/FlowField';
import Jagged from './tools/Jagged';
import Hatch from './tools/Hatch';
import Contour from './tools/Contour';
import RoadColors from './tools/RoadColors';
import Mesh from './tools/Mesh';
import Signal from './tools/Signal';
import Network from './tools/Network';
import RootsText from './tools/RootsText';

// Host for active-tool controls — they portal into the mode-rail panel under the
// Core Brand / Verticals (and vertical) toggles so nav + settings read as one unit.

interface ToolDef {
  id: string;
  label: string;
  Component: (props: { controlsTarget?: HTMLElement | null }) => React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { id: 'root-brush', label: 'Root Brush', Component: RootBrush },
  { id: 'flow-field', label: 'Fingerprint', Component: FlowField },
  { id: 'jagged', label: 'Circuit Traces', Component: Jagged },
  { id: 'hatch', label: 'Hatch', Component: Hatch },
  { id: 'contour', label: 'Contour', Component: Contour },
  { id: 'road-colors', label: 'Map', Component: RoadColors },
  { id: 'mesh', label: 'Mesh', Component: Mesh },
  { id: 'signal', label: 'Signal', Component: Signal },
  { id: 'network', label: 'Network', Component: Network },
  { id: 'roots-text', label: 'Roots + Text', Component: RootsText },
];

type Family = 'branch' | 'field';

/** Industry verticals — each maps to a Field generator. */
type VerticalId =
  | 'healthcare'
  | 'infrastructure'
  | 'supply-chain'
  | 'automotive'
  | 'fintech'
  | 'financial-services'
  | 'telecom'
  | 'education';

interface VerticalDef {
  id: VerticalId;
  label: string;
  toolId: string;
}

const VERTICALS: VerticalDef[] = [
  { id: 'healthcare', label: 'Healthcare', toolId: 'flow-field' },
  { id: 'infrastructure', label: 'Infrastructure', toolId: 'jagged' },
  { id: 'supply-chain', label: 'Supply Chain', toolId: 'contour' },
  { id: 'automotive', label: 'Automotive', toolId: 'road-colors' },
  { id: 'fintech', label: 'FinTech', toolId: 'mesh' },
  // Short hatch / matchstick field — scattered sticks on a facet lattice.
  { id: 'financial-services', label: 'Financial Services', toolId: 'hatch' },
  { id: 'telecom', label: 'Telecom', toolId: 'signal' },
  { id: 'education', label: 'Education', toolId: 'network' },
];

export default function App() {
  // Core Brand = parent brand (Root Brush). Verticals = pick an industry vertical.
  const [family, setFamily] = useState<Family>('branch');
  const [vertical, setVertical] = useState<VerticalId>('healthcare');
  const [toolControlsHost, setToolControlsHost] = useState<HTMLElement | null>(null);

  const withToolPanel = family === 'branch' || family === 'field';

  const activeVertical =
    VERTICALS.find((v) => v.id === vertical) ?? VERTICALS[0];
  const activeId =
    family === 'field' ? activeVertical.toolId : 'root-brush';
  const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const Active = active.Component;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img
            src={logo}
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
          {withToolPanel && (
            <div className="mode-rail__panel mode-rail__panel--tool">
              <div className="mode-rail__group">
                <span className="mode-rail__label">Mode</span>
                <div className="seg" role="group" aria-label="Core brand or verticals">
                  {(['branch', 'field'] as Family[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`seg__opt${f === family ? ' seg__opt--active' : ''}`}
                      aria-pressed={f === family}
                      onClick={() => setFamily(f)}
                    >
                      {f === 'branch' ? 'Core Brand' : 'Verticals'}
                    </button>
                  ))}
                </div>
              </div>

              {family === 'field' && (
                <div className="mode-rail__group">
                  <span className="mode-rail__label">Vertical</span>
                  <div
                    className="seg seg--alt seg--vertical"
                    role="group"
                    aria-label="Industry vertical"
                  >
                    {VERTICALS.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`seg__opt${v.id === vertical ? ' seg__opt--active' : ''}`}
                        aria-pressed={v.id === vertical}
                        onClick={() => setVertical(v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
              Root Brush is always Organic (Core Brand has no Engineered brush). */}
          {active.id === 'root-brush' ? (
            <RootBrush
              key="root-brush"
              brush="organic"
              hideBrushToggle
              controlsTarget={toolControlsHost}
            />
          ) : active.id === 'road-colors' ? (
            <RoadColors key="road-colors" controlsTarget={toolControlsHost} />
          ) : (
            <Active
              key={`${active.id}-${family === 'field' ? vertical : 'branch'}`}
              controlsTarget={toolControlsHost}
            />
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
