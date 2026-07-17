# COPO Emergence — Toolkit

A single-page collection of six generative drawing tools, built with Vite +
React and hosted as a static site on GitHub Pages. Pick a tool from the tabs at
the top; each renders to a canvas you can export as PNG, SVG, or MP4.

## Tools

| Tab | What it does |
| --- | --- |
| **Root Brush** | Root-system engine with switchable brushes — organic taper or technical 45° engineered traces. Optional image input. |
| **Fingerprint** | A noise-driven vector field traced into flowing streamlines. |
| **Jagged Fingerprint** | The Fingerprint engine on circular whorls — faceted, mitered loops. |
| **Contour** | Nested topographic iso-lines of a warped noise field. Optional image input. |
| **Map** | A city's real road network from OpenStreetMap, each road colored by designation. |
| **Roots + Text** | Roots creep in and wreathe a word you type, weaving around the letterforms. |

## Develop locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # outputs static site to dist/
npm run preview  # serve the production build locally
```

## Deploy (GitHub Pages)

The included workflow (`.github/workflows/deploy.yml`) builds and deploys on
every push to `main`. One-time setup:

1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages → Build and deployment** and set
   **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab). The site
   publishes to `https://<user>.github.io/<repo>/`.

The app uses a relative asset base (`base: './'` in `vite.config.ts`) and has no
client-side router, so it works at that subpath with no extra configuration.

## Notes

- **Map** ships with a pre-baked San Francisco / Bay Area road snapshot, so the
  default view loads with no network call. Searching another location fetches
  live data from the public OpenStreetMap Overpass and Nominatim APIs.
- **Root Brush** and **Contour** can optionally pull reference imagery from a
  public [Are.na](https://www.are.na) channel (CORS-enabled, no key required).
- No backend, API keys, or environment variables are needed — everything runs
  in the browser.
