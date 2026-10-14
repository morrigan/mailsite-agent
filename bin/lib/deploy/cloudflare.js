'use strict';
// Cloudflare deploy provider, covering two product types (set per client in
// clients.json as hosting.cloudflare.type):
//
//   "pages"   (default) - Cloudflare Pages. A git push to a connected project
//             builds: the production branch deploys to production, other
//             branches create preview deployments.
//   "workers" - Cloudflare Workers (incl. Workers with static assets). A
//             git-connected Worker builds on push; each build uploads a
//             *version* (which gets a preview URL) and, for the production
//             branch, promotes it to a *deployment*.
//
// In both cases the build is triggered on Cloudflare's side by the push; this
// provider only observes the resulting state and resolves the URL.
//
// Env: CLOUDFLARE_API_TOKEN, (optional) CLOUDFLARE_ACCOUNT_ID
// Config (per client), hosting.cloudflare:
//   Pages:   { type?: "pages", projectName, accountId? }
//   Workers: { type: "workers", workerName (or projectName), accountId?,
//              subdomain?, productionUrl? }

const { die } = require('../common');

const API = 'https://api.cloudflare.com/client/v4';

async function cf(token, p) {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) die(`Cloudflare API ${p} → ${res.status} ${JSON.stringify(j.errors || j)}`);
  return j.result;
}

// Like cf(), but returns null instead of dying. For optional lookups (e.g. a
// custom domain) where a missing scope or 404 should not fail the whole run.
async function cfSoft(token, p) {
  try {
    const res = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) return null;
    return j.result;
  } catch { return null; }
}

function base(host) {
  const token = process.env.CLOUDFLARE_API_TOKEN || die('Missing CLOUDFLARE_API_TOKEN in .env');
  const account = host.cloudflare.accountId || process.env.CLOUDFLARE_ACCOUNT_ID
    || die('hosting.cloudflare.accountId (or CLOUDFLARE_ACCOUNT_ID) required');
  return { token, account };
}

// --- Cloudflare Pages -------------------------------------------------------

function stageStatus(d) { return d.latest_stage && d.latest_stage.status; }
const terminal = (d) => ['success', 'failure', 'canceled'].includes(stageStatus(d));
const normalize = (d) => (stageStatus(d) === 'success' ? 'ready' : terminal(d) ? 'error' : 'building');

function branchOf(d) {
  return d.deployment_trigger && d.deployment_trigger.metadata && d.deployment_trigger.metadata.branch;
}

const pages = {
  async preview(cfg, client, host, { branch }, poll) {
    const { token, account } = base(host);
    const project = host.cloudflare.projectName || die('hosting.cloudflare.projectName required');
    const hit = await poll(async () => {
      const list = await cf(token, `/accounts/${account}/pages/projects/${project}/deployments`);
      const d = (list || []).find((x) => x.environment === 'preview' && branchOf(x) === branch);
      return { done: !!(d && terminal(d)), value: d };
    });
    if (!hit) return { state: 'timeout', url: null };
    const url = (hit.aliases && hit.aliases[0]) || hit.url || null;
    return { state: normalize(hit), url, deployId: hit.id };
  },

  async publish(cfg, client, host, _opts, poll) {
    const { token, account } = base(host);
    const project = host.cloudflare.projectName || die('hosting.cloudflare.projectName required');
    const hit = await poll(async () => {
      const list = await cf(token, `/accounts/${account}/pages/projects/${project}/deployments`);
      const d = (list || []).find((x) => x.environment === 'production');
      return { done: !!(d && terminal(d)), value: d };
    });
    if (!hit) return { state: 'timeout', url: null };
    return { state: normalize(hit), url: hit.url || null, deployId: hit.id };
  },
};

// --- Cloudflare Workers -----------------------------------------------------
//
// Workers versions carry no branch metadata (the branch/commit mapping lives in
// the Workers Builds API, which needs a separate token scope). So we identify
// "our" build by time: the newest version/deployment created at or after `since`
// is the one this run's push produced. The run is single-flight (the cron
// wrapper holds a lock), so there is only ever one build in progress, which
// makes the newest-since-push match unambiguous. `since` defaults to the moment
// the deploy CLI was invoked, minus a small skew; override with --since.

const WORKER_SINCE_SKEW_MS = 60 * 1000;

function workerName(host) {
  return host.cloudflare.workerName || host.cloudflare.scriptName
    || host.cloudflare.projectName || die('hosting.cloudflare.workerName required');
}

function sinceMs(opts) {
  if (opts.since) {
    const n = /^\d+$/.test(String(opts.since)) ? Number(opts.since) : Date.parse(opts.since);
    if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n; // accept epoch seconds or ms
  }
  return Date.now() - WORKER_SINCE_SKEW_MS;
}

async function workerSubdomain(token, account, host) {
  if (host.cloudflare.subdomain) return host.cloudflare.subdomain;
  const r = await cfSoft(token, `/accounts/${account}/workers/subdomain`);
  return r && r.subdomain;
}

function versionPreviewUrl(name, versionId, sub) {
  if (!sub) return null;
  const prefix = String(versionId).split('-')[0]; // first 8 hex chars of the UUID
  return `https://${prefix}-${name}.${sub}.workers.dev`;
}

async function productionUrl(token, account, name, host, sub) {
  if (host.cloudflare.productionUrl) return host.cloudflare.productionUrl;
  const domains = await cfSoft(token, `/accounts/${account}/workers/domains?service=${encodeURIComponent(name)}&environment=production`);
  const dom = (domains || []).find((d) => d.hostname);
  if (dom) return `https://${dom.hostname}`;
  if (sub) return `https://${name}.${sub}.workers.dev`;
  return null;
}

const workers = {
  async preview(cfg, client, host, opts, poll) {
    const { token, account } = base(host);
    const name = workerName(host);
    const since = sinceMs(opts);
    const hit = await poll(async () => {
      const r = await cf(token, `/accounts/${account}/workers/scripts/${name}/versions`);
      const items = (r && r.items) || r || [];
      const ours = items
        .filter((v) => v.metadata && v.metadata.has_preview && Date.parse(v.metadata.created_on) >= since)
        .sort((a, b) => Date.parse(b.metadata.created_on) - Date.parse(a.metadata.created_on))[0];
      return { done: !!ours, value: ours };
    });
    if (!hit) return { state: 'timeout', url: null };
    const sub = await workerSubdomain(token, account, host);
    return { state: 'ready', url: versionPreviewUrl(name, hit.id, sub), versionId: hit.id };
  },

  async publish(cfg, client, host, opts, poll) {
    const { token, account } = base(host);
    const name = workerName(host);
    const since = sinceMs(opts);
    const hit = await poll(async () => {
      const r = await cf(token, `/accounts/${account}/workers/scripts/${name}/deployments`);
      const items = (r && r.deployments) || r || [];
      const ours = items
        .filter((d) => Date.parse(d.created_on) >= since)
        .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
      return { done: !!ours, value: ours };
    });
    if (!hit) return { state: 'timeout', url: null };
    const sub = await workerSubdomain(token, account, host);
    return { state: 'ready', url: await productionUrl(token, account, name, host, sub), deployId: hit.id };
  },
};

// --- dispatch ---------------------------------------------------------------

function impl(host) {
  const type = (host.cloudflare && host.cloudflare.type) || 'pages';
  if (type === 'pages') return pages;
  if (type === 'workers') return workers;
  return die(`Unknown hosting.cloudflare.type: "${type}" (use "pages" or "workers")`);
}

module.exports = {
  preview: (cfg, client, host, opts, poll) => impl(host).preview(cfg, client, host, opts, poll),
  publish: (cfg, client, host, opts, poll) => impl(host).publish(cfg, client, host, opts, poll),
};
