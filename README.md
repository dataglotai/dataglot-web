# dataglot-web

The static site for [dataglot.ai](https://dataglot.ai) — built with
[Zola](https://www.getzola.org/), searched with
[Pagefind](https://pagefind.app/), agent-readable via `llms.txt`.

## Layout

```
config.toml        dev config (base_url = localhost)
config.prod.toml   prod config (base_url = https://dataglot.ai)
content/           docs/, guides/, blog/, about.md
templates/         hand-written Tera templates (no theme)
templates/data/docs-nav.json   the docs sidebar tree (hand-maintained)
sass/              token-driven SCSS (_tokens.scss is the only place raw values live)
static/            brand pack (favicons, OG image, octopus marks) + js/
build-pipeline.js  post-build llms.txt / per-page .md generator
build.sh           full prod build → ./public
deploy.sh          rsync ./public to the GCS bucket + CDN invalidation
```

## Develop

```bash
zola serve          # http://127.0.0.1:1111 — search is disabled in dev
```

## Build & deploy

```bash
./build.sh          # zola (prod config) + llms.txt pipeline + 3 pagefind indexes
./deploy.sh         # rsync ./public to the hosting bucket + CDN invalidation
```

Every push to `main` builds and deploys automatically via GitHub Actions
(keyless GCP auth through Workload Identity Federation). Hosting: a GCS
bucket behind a global HTTPS load balancer with Cloud CDN; `dataglot.org`,
`dataglot.io`, and all `www.` hosts 301 to `dataglot.ai`.

## Conventions

- Brand values (repo URL, image, tagline, parent company) live in
  `[extra]` in the configs — templates never hardcode them.
- Zola 0.23 removed classic shortcodes. Content components (callout, cards,
  tabs, steps, …) are Tera 2 components defined in `templates/components.html`
  and invoked as `{% <callout type="info" title="..."> %}body{% </callout> %}`.
  Literal `{{` / `{%` inside content must sit in `{% raw %}…{% endraw %}`.
- Docs pages: front matter `title`, `description`, `weight`; body starts at
  H2; sidebar entries are added in `templates/data/docs-nav.json`.
- Blog posts: `date`, `[taxonomies] category`, `[extra] author`.
- Guides can form a series via `[extra] series` + `series_part`.
- GitHub links point at `github.com/dataglotai/dataglot`.
