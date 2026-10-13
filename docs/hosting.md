# Hosting providers

Where a site deploys is chosen **per client** in `clients.json`, so different
clients can live on different hosts. Netlify and Cloudflare Pages ship today;
the deploy port is pluggable so more can be added without touching the core.

```jsonc
// Netlify
"hosting": {
  "provider": "netlify",
  "netlify": { "siteName": "acme-cafe", "siteId": "<site API ID>" }
}

// Cloudflare Pages
"hosting": {
  "provider": "cloudflare",
  "cloudflare": { "projectName": "jane-studio", "accountId": "<optional, or env>" }
}
```

## How deploys happen

Both providers use **git-triggered builds**: the agent pushes a branch and opens
a PR, the host builds a **deploy preview** automatically, and merging to the
production branch triggers the production build. The deploy port only *observes*
state and resolves URLs — it does not push the bits itself.

| | Preview trigger | Production trigger | URL source |
|---|---|---|---|
| **Netlify** | PR / branch deploy | push to production branch | deploy's `deploy_ssl_url`, or `deploy-preview-<PR>--<site>.netlify.app` |
| **Cloudflare Pages** | push to a non-production branch | push to production branch | deployment `aliases[0]` / `url` (`*.pages.dev`) |

So the per-site prerequisite is the same idea on either host: connect the repo
and enable preview deployments for branches/PRs.

## Credentials (.env)

| Provider | Env | Scope |
|---|---|---|
| Netlify | `NETLIFY_AUTH_TOKEN` | personal access token |
| Cloudflare | `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID` or per-client `accountId`) | token with Cloudflare Pages read |

## The deploy port contract

`bin/mailsite-deploy` exposes two subcommands; each prints `{state, url}` where
`state ∈ ready | error | building | timeout`:

- `preview <clientId> --branch <b> [--pr <n>]` — block until the branch's preview
  is ready.
- `publish <clientId>` — block until the latest production deploy is ready.

A `--dir <path>` flag is accepted and ignored by the git-triggered providers; it
exists so a future **direct-upload** provider (e.g. `wrangler pages deploy`,
`netlify deploy`, S3, FTP) can implement the same two subcommands by uploading a
built directory instead of observing a git build.

## Adding a provider

Create `bin/lib/deploy/<name>.js` exporting `preview(cfg, client, host, opts,
poll)` and `publish(cfg, client, host, opts, poll)`, each returning `{state,
url}`. Add the name to the `provider` enum in `clients.schema.json`. Nothing else
changes — see [ports-and-adapters.md](ports-and-adapters.md).
