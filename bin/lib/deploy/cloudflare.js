'use strict';
// Cloudflare Pages deploy provider. Like Netlify, deploys are triggered by git
// push (the repo is connected to a Pages project; pushes to the production
// branch deploy to production, other branches create preview deployments). This
// provider observes deployment state via the API and resolves the URL.
//
// Env: CLOUDFLARE_API_TOKEN, (optional) CLOUDFLARE_ACCOUNT_ID
// Hosting config (per client): hosting.cloudflare = { accountId?, projectName }

const { die } = require('../common');

const API = 'https://api.cloudflare.com/client/v4';

function creds(host) {
  const token = process.env.CLOUDFLARE_API_TOKEN || die('Missing CLOUDFLARE_API_TOKEN in .env');
  const account = host.cloudflare.accountId || process.env.CLOUDFLARE_ACCOUNT_ID
    || die('hosting.cloudflare.accountId (or CLOUDFLARE_ACCOUNT_ID) required');
  const project = host.cloudflare.projectName || die('hosting.cloudflare.projectName required');
  return { token, account, project };
}

async function cf(token, p) {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) die(`Cloudflare API ${p} → ${res.status} ${JSON.stringify(j.errors || j)}`);
  return j.result;
}

function stageStatus(d) { return d.latest_stage && d.latest_stage.status; }
const terminal = (d) => ['success', 'failure', 'canceled'].includes(stageStatus(d));
const normalize = (d) => (stageStatus(d) === 'success' ? 'ready' : terminal(d) ? 'error' : 'building');

function branchOf(d) {
  return d.deployment_trigger && d.deployment_trigger.metadata && d.deployment_trigger.metadata.branch;
}

module.exports = {
  async preview(cfg, client, host, { branch }, poll) {
    const { token, account, project } = creds(host);
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
    const { token, account, project } = creds(host);
    const hit = await poll(async () => {
      const list = await cf(token, `/accounts/${account}/pages/projects/${project}/deployments`);
      const d = (list || []).find((x) => x.environment === 'production');
      return { done: !!(d && terminal(d)), value: d };
    });
    if (!hit) return { state: 'timeout', url: null };
    return { state: normalize(hit), url: hit.url || null, deployId: hit.id };
  },
};
