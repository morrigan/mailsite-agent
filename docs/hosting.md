# Hosting providers

Where a site deploys is chosen per client in `clients.json`, so different clients
can live on different hosts. Netlify, Cloudflare Pages, and Cloudflare Workers
ship today, and the deploy port is pluggable, so more can be added without
touching the core.

```jsonc
// Netlify
"hosting": {
  "provider": "netlify",
  "netlify": { "siteName": "acme-cafe", "siteId": "<site API ID>" }
}

// Cloudflare Pages (the default when type is omitted)
"hosting": {
  "provider": "cloudflare",
  "cloudflare": { "type": "pages", "projectName": "jane-studio", "accountId": "<optional, or env>" }
}

// Cloudflare Workers (incl. Workers with static assets)
"hosting": {
  "provider": "cloudflare",
  "cloudflare": {
    "type": "workers",
    "workerName": "sipa-diving",       // the Worker's script name
    "accountId": "<optional, or env>",
    "subdomain": "<optional>",         // your *.workers.dev subdomain; auto-detected if omitted
    "productionUrl": "<optional>"      // pin the production URL; a custom domain is auto-detected otherwise
  }
}
```

Both Cloudflare types share `provider: "cloudflare"` and the same API token; the
`type` field picks Pages (the default) or Workers. Pages uses `projectName`;
Workers uses `workerName` (`projectName` is still accepted as an alias).

## How deploys happen

Both providers build on git pushes. The agent pushes a branch and opens a PR, the
host builds a deploy preview automatically, and merging to the production branch
triggers the production build. The deploy port only observes state and resolves
URLs; it does not push the files itself.

| | Preview trigger | Production trigger | URL source |
|---|---|---|---|
| **Netlify** | PR / branch deploy | push to production branch | deploy's `deploy_ssl_url`, or `deploy-preview-<PR>--<site>.netlify.app` |
| **Cloudflare Pages** | push to a non-production branch | push to production branch | deployment `aliases[0]` / `url` (`*.pages.dev`) |
| **Cloudflare Workers** | Workers Builds PR build (preview environment) | merge to production branch | preview: per-branch alias `<branch>-<worker>.<subdomain>.workers.dev`; production: custom domain or `<worker>.<subdomain>.workers.dev` |

The per-site setup is the same on either host: connect the repo and enable
preview deployments for branches and PRs.

### A note on the Workers preview match

A Workers Builds PR build deploys to a separate **preview environment**. That
preview does **not** appear in the Worker's production versions/deployments API,
so the provider cannot find it there. Instead it reads the **"Workers Builds"
GitHub check** on the PR (via `gh`, which the agent already uses): once the check
is `SUCCESS` the build and deploy are done, and the provider returns the stable
per-branch alias URL, `<sanitized-branch>-<worker>.<subdomain>.workers.dev`
(slashes and other non-alphanumerics become `-`). This needs the Worker connected
through Workers Builds with preview URLs on (the default when `workers.dev` is
enabled), the repo on GitHub, and `gh` authenticated.

Production uses the real deployment: `publish` waits for the newest production
deployment created since the merge.

With no PR (a manual `wrangler versions upload`), preview falls back to matching
the newest preview-capable version created at or after the run started; pass
`--since <epoch|ISO>` to set that baseline when driving a run by hand.

## Credentials (.env)

| Provider | Env | Scope |
|---|---|---|
| Netlify | `NETLIFY_AUTH_TOKEN` | personal access token |
| Cloudflare | `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID` or per-client `accountId`) | Pages: read on Pages. Workers: read on Workers Scripts (plus the `workers.dev` subdomain, read automatically) |

## The deploy port contract

`bin/mailsite-deploy` has two subcommands. Each prints `{state, url}`, where
`state` is one of `ready`, `error`, `building`, or `timeout`.

- `preview <clientId> --branch <b> [--pr <n>]` blocks until the branch's preview
  is ready.
- `publish <clientId>` blocks until the latest production deploy is ready.

Both poll until the build is ready or the timeout elapses (then `state` is
`timeout`). The wait is `--timeout`/`--interval`, else `MAILSITE_DEPLOY_TIMEOUT`/
`MAILSITE_DEPLOY_INTERVAL` from `.env`, else 300s/10s. A large Next.js build can
take longer than five minutes, so raise `MAILSITE_DEPLOY_TIMEOUT` (e.g. `900`) if
you see a preview `timeout`.

The git-triggered providers accept and ignore a `--dir <path>` flag. It's there
so a future direct-upload provider (`wrangler pages deploy`, `netlify deploy`,
S3, FTP) can implement the same two subcommands by uploading a built directory
instead of watching a git build.

## Adding a provider

Create `bin/lib/deploy/<name>.js` exporting `preview(cfg, client, host, opts,
poll)` and `publish(cfg, client, host, opts, poll)`, each returning `{state,
url}`. Add the name to the `provider` enum in `clients.schema.json`. Nothing else
changes. See [ports-and-adapters.md](ports-and-adapters.md).
