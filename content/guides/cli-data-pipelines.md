+++
title = "Data pipelines from the command line"
description = "Compose `dataglot query` with jq, csvkit, psql, cron, and CI — governed, federated SQL as a well-behaved Unix citizen."
weight = 30

[extra]
topic = "CLI"
level = "Intermediate"
+++

`dataglot query` is built to sit in a pipe: results go to stdout, noise
goes to stderr, the exit code tells the truth, and `--format csv` /
`--format json` speak the two dialects every other CLI tool understands.
Because the engine runs in-process with plan-time governance, every trick
on this page works **without a server** — and nothing you extract can
bypass a mask or row filter.

All examples assume a config (see the [quickstart](/docs/getting-started/)):

```bash
dataglot init          # writes dataglot.toml — point it at your sources
```

## JSON pipelines with `jq`

`--format json` emits one JSON object per row (NDJSON), which is exactly
what `jq` eats:

```bash
dataglot query -c dataglot.toml --format json \
  "SELECT segment, count(*) AS n FROM mysql_demo.demo.customer_segments GROUP BY segment" \
  | jq -r '"\(.segment): \(.n)"'
```

Slurp the stream into a single array when a downstream tool wants one
document:

```bash
dataglot query -c dataglot.toml --format json "SELECT * FROM users" | jq -s . > users.json
```

A federated join across two databases, filtered in `jq`, is one line:

```bash
dataglot query -c dataglot.toml --format json \
  "SELECT u.email, o.amount FROM users u JOIN pg_orders.public.orders o ON u.id = o.user_id" \
  | jq 'select(.amount > 100)'
```

Note the `email` values arrive **already masked** — the policy is compiled
into the plan, so the extract can't out-run governance.

## CSV pipelines: csvkit, awk, spreadsheets

`--format csv` includes a header row, so csvkit tools work directly:

```bash
dataglot query -c dataglot.toml --format csv \
  "SELECT segment, region, count(*) AS n FROM mysql_demo.demo.customer_segments GROUP BY 1, 2" \
  | csvlook
```

Prefer coreutils? The header is one `tail` away:

{% <code_tabs labels="awk, cut"> %}
```bash
dataglot query -c dataglot.toml --format csv "SELECT amount FROM pg_orders.public.orders" \
  | tail -n +2 | awk -F, '{ s += $1 } END { print s }'
```

```bash
dataglot query -c dataglot.toml --format csv "SELECT email, amount FROM report_view" \
  | tail -n +2 | cut -d, -f1
```
{% </code_tabs> %}

And a governed extract for a spreadsheet or a partner is just a redirect —
masks ride along:

```bash
dataglot query -c dataglot.toml --format csv \
  "SELECT email, segment, amount FROM customer_360 ORDER BY amount DESC" > extract.csv
```

## Load results into Postgres with `\copy`

Materialize a federated result into a plain Postgres table — no ETL tool,
two commands:

```bash
dataglot query -c dataglot.toml --format csv \
  "SELECT u.id, u.email, s.segment FROM users u JOIN mysql_demo.demo.customer_segments s ON u.id = s.user_id" \
  > segments.csv
psql "$TARGET_DSN" -c "\copy customer_segments FROM 'segments.csv' CSV HEADER"
```

## Data-quality gates in cron and CI

The exit code is the contract: `0` on success, non-zero on any failure.
Combine it with a threshold check and you have a data-quality gate:

```bash
#!/usr/bin/env bash
set -euo pipefail

orphans=$(dataglot query -c dataglot.toml --format csv \
  "SELECT count(*) FROM pg_orders.public.orders o
   LEFT JOIN users u ON o.user_id = u.id WHERE u.id IS NULL" | tail -n +2)

if [ "$orphans" -gt 0 ]; then
  echo "FAIL: $orphans orphaned orders" >&2
  exit 1
fi
echo "OK: no orphaned orders"
```

Run it wherever you already run checks:

{% <code_tabs labels="cron, GitHub Actions"> %}
```bash
# crontab -e — every morning at 07:00, mail on failure (cron default)
0 7 * * * /opt/checks/orphaned-orders.sh
```

{% raw %}
```yaml
# .github/workflows/data-quality.yml
on:
  schedule: [{ cron: "0 7 * * *" }]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          docker run --rm -v "$PWD:/w" -w /w \
            -e PG_DSN="${{ secrets.PG_DSN }}" \
            ghcr.io/dataglotai/dataglot:latest \
            query -c dataglot.toml --format csv \
            "SELECT count(*) FROM pg.public.orders WHERE ordered_at > now() - interval '1 day'" \
            | tail -n +2 | xargs test 0 -lt
```
{% endraw %}
{% </code_tabs> %}

A failing query — bad SQL, an unreachable source — also exits non-zero, so
the gate catches infrastructure drift, not just bad data. If a flaky
source shouldn't fail the whole check, add
`--tolerate-unreachable-catalogs`.

## Run SQL files, keep queries in git

`-f` reads the statement from a file, so reports live next to the code
that reviews them:

```bash
dataglot query -c dataglot.toml -f reports/weekly-revenue.sql --format csv > weekly-revenue.csv
```

## Interactive exploration

When a pipeline surprises you, drop into the REPL with the same config and
poke at the sources directly — `\q` to quit:

```bash
dataglot shell -c dataglot.toml
```

## Tab completion

Working in the terminal all day? Install completions once:

{% <code_tabs labels="bash, zsh, fish"> %}
```bash
dataglot completions bash > /etc/bash_completion.d/dataglot
```

```bash
dataglot completions zsh > "${fpath[1]}/_dataglot"
```

```bash
dataglot completions fish > ~/.config/fish/completions/dataglot.fish
```
{% </code_tabs> %}

## Where next

- [Command line & REPL reference](/docs/cli/) — every flag, format, and
  exit-code detail used above.
- [Plan-time governance](/guides/plan-time-governance/) — why the masks in
  these extracts can't be bypassed.
