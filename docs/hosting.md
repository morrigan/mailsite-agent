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
| **Cloudflare Workers** | branch build uploads a version | production build promotes a deployment | version preview `<id-prefix>-<worker>.<subdomain>.workers.dev`; production custom domain or `<worker>.<subdomain>.workers.dev` |

The per-site setup is the same on either host: connect the repo and enable
preview deployments for branches and PRs.

### A note on the Workers preview match

Worker versions carry no branch name (that mapping lives in the Workers Builds
API, which needs a separate token scope). So the Workers provider identifies a
build by time: the newest version created at or after the run started is the one
this run's push produced. The cron wrapper holds a lock, so only one build is
ever in flight, which keeps the match unambiguous. If you drive a run by hand
long after the push, pass `--since <epoch|ISO>` to `mailsite-deploy` to set that
baseline yourself. Preview URLs must be enabled for the Worker (they are, by
default, whenever `workers.dev` is on).

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

The git-triggered providers accept and ignore a `--dir <path>` flag. It's there
so a future direct-upload provider (`wrangler pages deploy`, `netlify deploy`,
S3, FTP) can implement the same two subcommands by uploading a built directory
instead of watching a git build.

## Adding a provider

Create `bin/lib/deploy/<name>.js` exporting `preview(cfg, client, host, opts,
poll)` and `publish(cfg, client, host, opts, poll)`, each returning `{state,
url}`. Add the name to the `provider` enum in `clients.schema.json`. Nothing else
changes. See [ports-and-adapters.md](ports-and-adapters.md).
