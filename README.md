# Emergence — Toolkit

A set of generative brand tools that treat a mark the way we treat a company:
as latent potential waiting to unfold. Each tool lives in a tab at the top and
renders to a canvas you can export as PNG, SVG, or MP4. A small system for
compounding simple inputs into something that grows.

## Tools
Parent Brand : Organic Branching
8 Verticals :
- Healthcare
- Infrastructure
- Supply chain
- Automotive
- FinTech
- Financial Services
- Telecom
- Education

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
