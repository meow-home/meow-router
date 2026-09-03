# Meow Gateway Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single self-contained `docs/index.html` landing page for Meow Gateway and deploy it to GitHub Pages via a GitHub Actions workflow, so the page loads exactly one file and no external resources.

**Architecture:** A single static HTML file (`docs/index.html`) with all CSS inline in `<style>`, all JS inline in `<script>`, and the logo embedded as a `data:image/png;base64` URI. GitHub Pages serves `docs/` as the site root via a `deploy-pages.yml` workflow using `actions/upload-pages-artifact` (path `docs`).

**Tech Stack:** Static HTML/CSS (vanilla, no framework), GitHub Actions (`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), base64-embedded PNG logo.

## Global Constraints

Copy verbatim from the spec; every task implicitly includes these.

- **Product name:** Meow Gateway (NOT Meow Router — this is a hard constraint).
- **Language:** English only.
- **Self-contained:** The page MUST NOT load any external resource — no `link` stylesheet, no `script src`, no `style` referencing a URL, no external image, no CDN, no Google Fonts. Exactly one document is loaded: `docs/index.html`.
- **Logo:** Must be embedded as a `data:image/png;base64,` URI from `meow-router-logo.png` (1254×1254, ~1.46 MB base64). Rendered element is sized via CSS only.
- **Style:** Dark theme — background `#0b0e14`, card `#151a24`, border `#232a38`. Text primary `#e6edf3`, secondary `#9aa7b5`. Accent teal/cyan `#2dd4bf`, hover `#0d9488`. System font stack (`-apple-system, Segoe UI, Roboto, Inter, sans-serif`). Responsive, max-width ~1080px.
- **Endpoint (exact string):** `http://127.0.0.1:8317/v1`.
- **Install requirements (exact):** Node 20+, pnpm (`npm i -g pnpm`). Commands: `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- **Sections (all 8, in order):** Hero; Problem/Solution; Features; How it works; Coding agents; Download/Install; Roadmap; Footer.
- **Repo:** `github.com/meow-home/meow-router`.

---

### Task 1: Create the GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: a workflow that uploads the `docs/` directory as a Pages artifact and deploys it.

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['docs/**']
  workflow_dispatch:

permissions:
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy-pages:
    name: Deploy docs to Pages
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify the YAML syntax**

Run: `node -e "const yaml=require('js-yaml'); const fs=require('fs'); console.log('YAML OK:', !!yaml.load(fs.readFileSync('.github/workflows/deploy-pages.yml','utf8')))"`

Expected: prints `YAML OK: true`. (If `js-yaml` is unavailable, verify by eye against the CI workflow structure.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-pages.yml
git commit -m "ci: add GitHub Pages deploy workflow for docs"
```

---

### Task 2: Generate the base64 logo placeholder data

**Files:**
- Create: `.meow/generated/logo-base64.txt` (temporary, gitignored output — NOT committed)

**Interfaces:**
- Consumes: `meow-router-logo.png` (repo root).
- Produces: a base64 string to embed into `docs/index.html` in Task 3.

- [ ] **Step 1: Generate the base64 string**

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('meow-router-logo.png').toString('base64');fs.mkdirSync('.meow/generated',{recursive:true});fs.writeFileSync('.meow/generated/logo-base64.txt',b);console.log('len',b.length)"
```

Expected: prints `len 1456800` (base64 character length).

- [ ] **Step 2: Confirm the output is gitignored**

Check that `.meow/` is already in `.gitignore` (it is: `.worktrees/` is listed; confirm `.meow/`). If not present, verify the file won't be committed in Task 3.

---

### Task 3: Build `docs/index.html` — single self-contained landing page

**Files:**
- Create: `docs/index.html`

**Interfaces:**
- Consumes: base64 string from `.meow/generated/logo-base64.txt`; content from `README.md`, `docs/PRD.md`, `docs/ROADMAP.md`, `docs/UX_SPEC.md`.
- Produces: the complete self-contained landing page served at the Pages root.

- [ ] **Step 1: Create the HTML skeleton with inline styles**

Write `docs/index.html` with:
- `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- A single `<style>` block defining the dark theme and teal accent per Global Constraints. Use CSS custom properties.
- A single `<script>` block (minimal JS; only add if needed for mobile nav / smooth scroll).
- Embedded `<img alt="Meow Gateway logo" src="data:image/png;base64,<BASE64>">` where `<BASE64>` is the full string from Task 2. Rendered with CSS `width: 120px; height: 120px; object-fit: contain;`.

Provide the CSS design tokens:

```css
:root {
  --bg: #0b0e14;
  --card: #151a24;
  --border: #232a38;
  --text: #e6edf3;
  --muted: #9aa7b5;
  --accent: #2dd4bf;
  --accent-hover: #0d9488;
}
```

Container settings: `max-width: 1080px; margin: 0 auto; padding: 2rem 1.5rem;`.

- [ ] **Step 2: Add the 8 sections with content**

1. **Hero** — logo, `h1` "Meow Gateway", tagline ("The local AI gateway for your coding agents."), CTAs: "Download" (anchor to `#install`) and "Get Started" (anchor to `#how-it-works`).
2. **Problem / Solution** — two-column or stacked: "Multiple providers, multiple agents, fragmented config" → "One OpenAI-compatible local endpoint." Endpoint `http://127.0.0.1:8317/v1`.
3. **Features** — six cards: Provider management; Secure credentials; Virtual models; Local OpenAI-compatible API; Observability (usage/cost); Routing & fallback. Each card: `h3` + short paragraph (use PRD capabilities).
4. **How it works** — diagram `Agent -> Meow Gateway -> Providers`. Show the endpoint, note that Meow Gateway handles auth, model selection, protocol translation, routing, streaming, retries, usage tracking.
5. **Coding agents** — list: Meow Coding, Claude Code, OpenCode, Cline/Roo Code, Aider. Note: "point your agent at `http://127.0.0.1:8317/v1` and use the gateway API key."
6. **Download / Install** — Prerequisites Node 20+, pnpm; code block with `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
7. **Roadmap** — v0.4 Routing (primary/fallback, retry policy, model groups); v0.5 Agent integration (config snippets, per-client gateway keys); v1.0 production installers, migration guarantees, security audit.
8. **Footer** — "Meow Gateway" + link to the repo (`https://github.com/meow-home/meow-router`), version `0.4.0`, copyright.

- [ ] **Step 3: Inject the base64 logo into the HTML**

Use a Node script to replace a `<!--LOGO_DATA-->` placeholder token in the file with the base64 string (avoids pasting 1.4 MB manually):

```bash
node -e "const fs=require('fs');const b64=fs.readFileSync('.meow/generated/logo-base64.txt','utf8').trim();let h=fs.readFileSync('docs/index.html','utf8');h=h.replace('<!--LOGO_DATA-->',b64);fs.writeFileSync('docs/index.html',h);console.log('logo injected', b64.length)"
```

The `<img>` in Step 1 uses `src="data:image/png;base64,<!--LOGO_DATA-->"`.

- [ ] **Step 4: Verify self-containment — no external references**

```bash
grep -nE '<link|<script[^>]*src|url\(|@import|http://|https://|src="[^"]*\.(png|jpg|css|js|woff)' docs/index.html | grep -v 'data:image/png;base64' || echo 'NO_EXTERNAL_REFS'
```

Expected: `NO_EXTERNAL_REFS`. (The only `http`/`https` allowed are plain text links in the Footer / anchors — those are `<a href>` links, not loaded resources. Re-run after Step 3.)

- [ ] **Step 5: Verify the single-document load**

Confirm there is exactly one `<img>` with `src="data:image/png;base64,` and no other `<img>`/`<link>`/`<script src>`:

```bash
grep -c '<img' docs/index.html && grep -cE '<script[^>]*src' docs/index.html && grep -c '<link' docs/index.html
```

Expected: `<img` = 1 (or the logo only), `<script src` = 0, `<link` = 0.

- [ ] **Step 6: Verify rendered structure & file size**

Run: `ls -la docs/index.html` — expect ~1.5 MB (the base64 logo dominates). Confirm the file parses (open in a browser or use a quick HTML sanity check).

- [ ] **Step 7: Commit**

```bash
git add docs/index.html
git commit -m "feat(docs): add self-contained Meow Gateway landing page for GitHub Pages"
```

---

### Task 4: Verify the page in a browser and finalize

**Files:**
- Modify: `docs/index.html` (if fixes needed)

- [ ] **Step 1: Serve and visually check**

Run a local static server and open it:

```bash
cd docs && npx serve . -p 8318
```

(Or `python -m http.server 8318 -d docs`.) Open `http://127.0.0.1:8318/index.html` and confirm: logo renders, all 8 sections read, dark theme + teal accent correct, responsive at narrow width.

- [ ] **Step 2: Confirm no console/network errors**

Note: only use if a browser tool is available. Confirm the console shows no failed requests and the network panel shows exactly one document request (the HTML) — no external asset requests.

- [ ] **Step 3: Commit any fixes**

```bash
git add docs/index.html
git commit -m "fix(docs): refine landing page after visual review"
```

- [ ] **Step 4: Check final git status**

Run: `git status` — confirm only intended files (`docs/index.html`, `.github/workflows/deploy-pages.yml`) are changed/added, and the pre-existing dirty PNG files (icon.png, logo.png, meow-router-logo.png) are NOT touched by this plan.

---

## Self-Review

**1. Spec coverage:**
- Single self-contained `docs/index.html` → Task 3. ✅
- GitHub Actions deploy → Task 1. ✅
- Logo base64 embed → Tasks 2+3. ✅
- Dark + teal accent, 8 sections, responsive → Task 3. ✅
- "Only load index.html", no external refs → Task 3 Steps 4-5. ✅

**2. Placeholder scan:** No "TBD/TODO/implement later" placeholders; the logo is handled via a script step rather than a manual paste placeholder. The `<!--LOGO_DATA-->` token is intentional and replaced in Step 3. ✅

**3. Type/property consistency:** No function signatures cross tasks (static HTML + workflow only). Endpoint string and install commands are copied verbatim in Global Constraints and reused in Task 3. ✅

**Note:** Tasks 1 (workflow) and 3 (page) are independent and produce testable deliverables on their own. Task 2 is a helper step folded into Task 3's logo injection.
