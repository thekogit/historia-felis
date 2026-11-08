# Historia Felis — The Cat in Art History

*A collection of cats in art from cultures all over the world, from the earliest known depictions to today.*

Presented as a single, self-contained, high-performance interactive reference library ([`index.html`](index.html)) with a quiet, monochrome editorial design.

---

## Curatorial Scope & Structure

- **Catalogued Artworks**: Spanning from the earliest known feline burial at Shillourokambos, Cyprus (c. 7500 BCE) through ancient Egyptian tomb paintings, Greco-Roman mosaics, Medieval manuscript drolleries, Chinese Song/Ming scrolls, Korean Joseon paintings, Japanese ukiyo-e, Islamic miniatures, Renaissance and Baroque masterpieces, 18th-century still lifes, Victorian feline portraits, Impressionism, Symbolism, 20th-century Modernism, and contemporary art through 2026.
- **Rights recorded per image**: Every entry carries its image licence, credit and rights status. Most works are public domain; copyrighted contemporary work (e.g. Lola Dupré) is shown with credit, hotlinked from the artist, never copied.
- **Two Feline Roles**: Catalogs works where the cat is the **Main Subject** and where the cat appears as a **Secondary or Symbolic Element**.
- **48 Categorized Eras & Movements**: Organized with a historical pigment colour palette (Red Ochre, Egyptian Blue, Terracotta, Lapis Lazuli, Cinnabar, Prussian Blue, Persian Turquoise, Verdigris, Raw Umber, Rose Madder, Chrome Yellow, Viridian, Tyrian Aubergine, Cadmium Red).
- **100 Curated Archival Japanese Cat Haikus**: Featuring masterworks by Matsuo Bashō, Yosa Buson, Kobayashi Issa, Masaoka Shiki, Natsume Sōseki, and Kaga no Chiyo-ni.
- **Search Everything**: The Categories page searches every field at once: artist, title, movement, era, type, culture, medium, museum, tags and descriptions. Accents are optional ("catalhoyuk", "mloda polska"), typos are corrected, and dates work as `1475`, `1800s`, `19th century`, `1500-1600` or `3000 bce`. Use `"quotes"` for phrases and qualifiers such as `artist:wain`, `type:print`, `era:egypt` or `museum:louvre`. Searches are shareable as `#/categories?q=…`.

---

## Architecture & Project Structure

The project cleanly separates source code (`src/`) and canonical data (`data/`) from the production distribution bundle (`index.html`).

```text
art_cats/
├── index.html                  # Standalone production distribution (zero-dependency release)
├── editor.html                 # Visual in-browser catalog editor (GUI)
├── package.json                # Standard npm tasks (edit, build, test, serve)
├── README.md                   # Project documentation & maintainer guide
├── DEPLOYMENT.md               # Production deployment guide (GitHub Pages, Docker, Nginx)
├── .nojekyll                   # GitHub Pages Jekyll bypass
│
├── data/                       # Canonical structured datasets
│   ├── artworks.json           # Catalog of all 739 artworks (metadata, dates, licenses, URLs)
│   ├── categories.json         # Taxonomy of 48 eras and art movements
│   ├── haiku_pool.json         # Curated pool of 100 archival haikus with translations
│   └── poets.json              # The 12 poet pages (#/poet/<slug>): life, asides, timeline, portraits + rights
│
├── src/                        # Modular human-maintainable source code
│   ├── template.html           # Clean HTML skeleton & semantic layout
│   ├── css/
│   │   └── style.css           # Monochrome design system & responsive styles
│   └── js/
│       └── app.js              # Application logic, PhotoSwipe, loupe, router & audio intro
│
├── assets/                     # Media & audio assets
│   └── audio/
│       └── intro_swell.wav     # Cinematic first-session orchestral audio swell
│
└── scripts/                    # Core automation tooling
    ├── editor_server.js        # Local backend server for the Visual Catalog Editor
    ├── build.js                # Node.js bundler (compiles src/ + data/ -> index.html in ~20ms)
    ├── poet_images.js          # Resolves poet portraits on Wikimedia Commons (licence, credit) + local WebP copies
    └── validate.js             # Automated schema, taxonomy & bundle health validator
```

---

## Modifying Artworks: Visual In-Browser Catalog Editor

You never have to manually edit JSON files. You can modify, add, or delete artworks using the visual GUI:

### Starting the Editor
```bash
npm run edit
```
Open **[http://localhost:3000/editor.html](http://localhost:3000/editor.html)** in your browser.

### Key Capabilities:
- **Search & Filter**: Search instantaneously by title, artist name, accession number, or slug, and filter by historical era.
- **Live Image Preview**: Visual thumbnail renders immediately as you paste or change image URLs.
- **Taxonomy Dropdowns**: Era and Movement dropdowns are populated directly from `data/categories.json` to prevent typos or broken category links.
- **Tag Editor**: Add and remove tags with interactive tag pills.
- **One-Click Save**: Click **"Save Changes"** to update `data/artworks.json` and immediately regenerate `index.html`.
- **Add Artworks from links**: Click **"+ Add Artworks"** and paste one or more links (museum pages, Google Arts & Culture, Wikipedia, Wikimedia Commons, WikiArt). Each link is read, searched on the web, and turned into a filled-in draft with short, museum-label-style texts. Drafts that might be duplicates, show no cat, or are low-confidence are flagged for review. Text after a link on the same line is used as a hint. The Met, the Art Institute of Chicago and Wikipedia are read through their open APIs. Web search uses the Ollama key in `.env` and falls back to Wikipedia search without one.
- **Flags**: each artwork in the list shows small flags, and the flag filter lists every kind:
  red = the red-flag check found a problem; orange = no image; yellow = two or more information fields missing;
  grey = one missing. The information fields are title, artist, date, era, movement, medium, collection,
  description (8+ words, not just the title), context and source link. Dimensions and feline symbolism don't count.
- **Red-flag check**: finds one trusted source and stops at the first hit. It tries, in order, the entry's own link
  (if on a site in `data/trusted_sources.json`), a web search kept to those sites, the Met / Art Institute of
  Chicago / Cleveland search APIs, the image's own Commons record, and Wikidata. It then compares the image and asks
  the configured model whether the source describes the same work. A search hit that turns out to be a different work
  is skipped, not held against the entry. Red means a clear contradiction in artist, date, title, collection,
  object type or image, or a broken or duplicated image.
  Run it per artwork ("Red-flag check"), on the listed artworks ("Check shown"), or for the whole catalogue:
  `npm run check` (new or edited entries), `npm run check -- --all`, `--status problem`, `--ids a,b`, `--concurrency 3`.
  Results are stored in `data/checks.json` and stop counting once the entry is edited.
- **Blank entries & Delete**: "Blank entry" in the same window starts an empty draft; **"Delete Artwork"** removes one.
- **Standalone Mode**: Can also be opened directly via `file:///` without a server to browse and export/download `artworks.json`.

---

## Catalogue Audit (agent system)

Every entry is checked against seven curatorial rules, shown as chips **a b c d e f ©** in the editor:

| Rule | What it checks | Who checks it |
| :--- | :--- | :--- |
| **a** Subject | A real cultural work with a cat or cat-like felid. Lions and tigers don't count; biographies of real cats, folklore ideas and festivals without a specific work are purged. | Ollama research agent + Claude reviewer |
| **b** Image | Reachable; long edge ≥ 1600 px good, < 1000 px fails | deterministic |
| **c** Prose | Description + context in a lively, loosely academic voice with a sourced fun fact; machine-sounding phrases flagged | Claude reviewer (editor: agent "Prose" mode) |
| **d** Link | `source_url` points at the holding institution's own record | deterministic + agents |
| **e** Taxonomy | Era / movement / submovement correct | agents |
| **f** Image set | As many photos as exist, but all from **one** shoot or catalogue record (e.g. the Met's open-access record), none mixed in | deterministic (Met / AIC / Cleveland APIs, Commons same photographer + camera + date) |
| **©** Rights | `license`, `license_url`, `rights_status` (public-domain · open-license · copyrighted · unverified), `image_credit` for every image | deterministic (Commons metadata, museum open-access flags) + agent "Rights" mode |

```bash
npm run audit                 # deterministic checks for all entries → data/audit.json
npm run audit:deep            # + Ollama research agent (subject, best link, taxonomy); resumable
npm run audit:report          # failing-rule counts and purge proposals
npm run audit:apply -- --reviews <dir>   # merge audit + reviewer JSON into artworks.json, writes data/audit_report.md
```

Purged entries move to `data/purged_artworks.json` with the reason, never deleted.

**Copyrighted works shown with credit** (e.g. Lola Dupré's collages, `npm run import:lola`) carry `hotlink: true`: their images load from the artist's own site and are never downloaded, and `text_policy: "attribution-only"` keeps them free of description and context. The validator requires a licence notice, credit and source link on every copyrighted entry.

### Research agent (editor)
The editor's right rail runs the configured Ollama model (`OLLAMA_MODEL`, default `beam:cloud`) as a tool-calling agent. Its tools are museum open-access APIs (Met, Art Institute of Chicago, Cleveland), SearXNG + Ollama web search, page reading, Wikidata, Wikimedia Commons (licence, photographer, same-shoot sets), image size and URL checks, the taxonomy, a catalogue lookup and, optionally, **Reddit** (read-only, through `../../mcps/reddit-mcp-server`, override with `REDDIT_MCP_DIR`, disable with `REDDIT_MCP=off`). Modes: **Audit**, **Images**, **Rights**, **Prose**, **Ask**. Tool calls stream in as cards; results come back as a per-field diff you apply or reject. The status strip at the bottom shows audit progress, model, SearXNG and Reddit status; **Ctrl+J** opens the activity console (tool calls, audits, saves, errors).

---

## Maintainer & Developer Guide

### Commands

| Task | Command | Description |
| :--- | :--- | :--- |
| **Launch Visual Editor** | `npm run edit` | Starts local visual editor server at `localhost:3000` |
| **Build Release Bundle** | `npm run build` | Compiles `src/` and `data/` into `index.html` (~20ms) |
| **Validate Catalog** | `npm test` | Checks schema, IDs, taxonomy relations, and bundle health |
| **Local Preview Server** | `npm run serve` | Starts local HTTP server for testing `index.html` |

### Making Code Modifications

- **To edit UI styles**: Edit [`src/css/style.css`](src/css/style.css) with full CSS syntax highlighting and formatting.
- **To edit application logic or routing**: Edit [`src/js/app.js`](src/js/app.js) with standard ES6+ features and IDE autocomplete.
- **To edit HTML layout or meta tags**: Edit [`src/template.html`](src/template.html).
- **To rebuild the site**: Run `npm run build`.

---

## Deployment (GitHub Pages)

The repository includes [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) and [`.nojekyll`](.nojekyll) for turnkey GitHub Pages hosting.

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: clean architecture and visual catalog editor"
   git push origin master
   ```
2. In your GitHub repository, go to **Settings > Pages**.
3. Under **Build and deployment > Source**, choose **GitHub Actions** (or select **Deploy from branch** $\rightarrow$ `master` / `/ (root)`).
4. Your site will be published at `https://<username>.github.io/<repo-name>/`.

For complete deployment details (Docker, Nginx, Cloudflare Pages, Netlify), see [DEPLOYMENT.md](DEPLOYMENT.md).
