# Meow Gateway — Landing Page (GitHub Pages) Design

Date: 2026-09-03
Status: Approved

## 1. Goal

Provide a public product landing page for **Meow Gateway**, served by GitHub
Pages from the repo's `docs/` directory. The page advertises the product to
developers and coding-agent users, and points them to download/configure.

## 2. Decisions (confirmed with user)

- **Product name:** Meow Gateway (NOT Meow Router).
- **Language:** English.
- **Target:** GitHub Pages serving `docs/` as the site root.
- **"Only load index.html, nothing else":** the site root is `docs/index.html`,
  a **single self-contained HTML file**. All CSS is inline in `<style>`, any JS is
  inline in `<script>`, and the logo is embedded as a `data:` URI. There are NO
  external stylesheets, scripts, fonts, images, or CDN dependencies. Thus the
  page loads exactly one resource: `docs/index.html`.
- **Deployment:** GitHub Actions workflow (`.github/workflows/deploy-pages.yml`)
  using `actions/upload-pages-artifact` (path `docs`) + `actions/deploy-pages`.
  No manual Settings configuration required.
- **Logo:** embedded via `data:image/png;base64,` from `meow-router-logo.png`
  (1254×1254 RGBA PNG, ~1.09 MB source, ~1.46 MB base64). The rendered element is
  sized with CSS; the large embedded payload is an accepted trade-off for
  self-containment.
- **Style:** dark theme (`#0b0e14` background, card `#151a24`, border `#232a38`),
  teal/cyan accent (`#2dd4bf` primary, hover `#0d9488`), system font stack.
  Responsive, max-width ~1080px.

## 3. File layout

```
docs/index.html                      <- the single self-contained landing page
.github/workflows/deploy-pages.yml   <- GitHub Actions Pages deployment
```

No other file is loaded at runtime by the page.

## 4. Sections (all 8)

1. **Hero** — logo + "Meow Gateway", tagline, CTAs (Download, Get Started).
2. **Problem / Solution** — fragmentation across providers/agents; one local endpoint.
3. **Features** — Provider management; Secure credentials; Virtual models;
   Local OpenAI-compatible API; Observability (usage/cost); Routing & fallback.
4. **How it works** — diagram `Agent -> Meow Gateway -> Providers`, endpoint
   `http://127.0.0.1:8317/v1`.
5. **Coding agents** — Meow Coding, Claude Code, OpenCode, Cline/Roo Code, Aider.
6. **Download / Install** — Node 20+, `pnpm install && pnpm dev`, endpoint info.
7. **Roadmap** — v0.4 routing/fallback, v0.5 agent integration, v1.0 production.
8. **Footer** — repo link, version, copyright.

## 5. Content sources

- `README.md` — product vision, providers, endpoint, coding agents.
- `docs/PRD.md` — problem statement, personas, capabilities.
- `docs/ROADMAP.md` — roadmap items.
- `docs/UX_SPEC.md` — visual conventions (dark, developer-first).
- `docs/BUILD_RELEASE.md` — install/run commands (Node 20, pnpm).

## 6. GitHub Actions workflow

`.github/workflows/deploy-pages.yml`:

- Trigger: `push` to `main` (paths: `docs/**`) and `workflow_dispatch`.
- Permissions: `pages: write`, `id-token: write`.
- Concurrency: `pages` group, cancel in-progress.
- Steps:
  1. `actions/checkout@v4`
  2. `actions/configure-pages@v5`
  3. `actions/upload-pages-artifact@v3` with `path: docs`
  4. `actions/deploy-pages@v4`
- Environment: `github-pages`.

## 7. Acceptance criteria

- [ ] `docs/index.html` exists and is a single self-contained file.
- [ ] Page loads exactly one document; no external network requests for
      styles/scripts/fonts/images/CDN.
- [ ] Logo appears (embedded base64), not as an external `<img src>`.
- [ ] All 8 sections present.
- [ ] Dark theme + teal/cyan accent; responsive on the target max-width.
- [ ] `.github/workflows/deploy-pages.yml` present and correct.
- [ ] No impact on the Electron app source/build/tests.
- [ ] README points to the live Pages URL (optional stretch).

## 8. Out of scope / non-goals

- Renaming the product to "Meow Router" (explicitly set aside; stays "Meow Gateway").
- Any change to the Electron app source, package names, lockfile, or tests.
- A build pipeline that compiles/bundles the page (self-contained HTML only).
- Analytics, tracking, or third-party embeds.
